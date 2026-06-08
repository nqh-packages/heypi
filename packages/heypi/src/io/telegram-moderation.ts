export type TelegramEditedMessagesMode = "ignore" | "rerun" | "log";

export type TelegramGroupAutomationConfig = {
	welcome?: boolean | { template?: string };
	flood?: boolean | { windowMs?: number; maxMessages?: number };
	linkFilter?: boolean | { allowlist?: string[] };
	spam?: boolean | { maxRepeated?: number; maxMentions?: number };
	editedMessages?: TelegramEditedMessagesMode;
	auditDrops?: boolean;
};

export type TelegramModerationContext = {
	channel: string;
	actor: string;
	text: string;
	now?: number;
};

export type TelegramModerationDrop = {
	rule: "flood" | "link" | "spam";
	reason: string;
};

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<]+|\bt\.me\/[^\s<]+/gi;

export function welcomeTemplate(config: TelegramGroupAutomationConfig | undefined): string | undefined {
	const welcome = config?.welcome;
	if (!welcome) return undefined;
	if (welcome === true) return "Welcome! Message me when you need help.";
	if (typeof welcome === "object" && welcome.template?.trim()) return welcome.template.trim();
	return "Welcome! Message me when you need help.";
}

export function shouldSendWelcome(input: {
	config?: TelegramGroupAutomationConfig;
	newMemberIsBot?: boolean;
	botUserId?: number;
}): boolean {
	if (!input.config?.welcome) return false;
	if (!input.newMemberIsBot) return false;
	return input.botUserId !== undefined;
}

export function floodDrop(
	config: TelegramGroupAutomationConfig | undefined,
	state: Map<string, number[]>,
	ctx: TelegramModerationContext,
): TelegramModerationDrop | undefined {
	if (!config?.flood) return undefined;
	const settings = config.flood === true ? {} : config.flood;
	const windowMs = settings.windowMs ?? 10_000;
	const maxMessages = settings.maxMessages ?? 5;
	const key = `${ctx.channel}:${ctx.actor}`;
	const now = ctx.now ?? Date.now();
	const prior = (state.get(key) ?? []).filter((at) => now - at <= windowMs);
	prior.push(now);
	state.set(key, prior);
	if (prior.length > maxMessages) {
		return { rule: "flood", reason: "flood_limit" };
	}
	return undefined;
}

export function linkDrop(
	config: TelegramGroupAutomationConfig | undefined,
	ctx: TelegramModerationContext,
): TelegramModerationDrop | undefined {
	if (!config?.linkFilter) return undefined;
	const settings = config.linkFilter === true ? {} : config.linkFilter;
	const allowlist = (settings.allowlist ?? []).map((item) => item.toLowerCase());
	const matches = ctx.text.match(URL_PATTERN) ?? [];
	if (!matches.length) return undefined;
	for (const match of matches) {
		const normalized = match.toLowerCase();
		if (allowlist.some((allowed) => normalized.includes(allowed))) continue;
		return { rule: "link", reason: "link_not_allowed" };
	}
	return undefined;
}

export function spamDrop(
	config: TelegramGroupAutomationConfig | undefined,
	state: Map<string, { text: string; mentions: number; count: number }>,
	ctx: TelegramModerationContext,
): TelegramModerationDrop | undefined {
	if (!config?.spam) return undefined;
	const settings = config.spam === true ? {} : config.spam;
	const maxRepeated = settings.maxRepeated ?? 3;
	const maxMentions = settings.maxMentions ?? 8;
	const mentions = (ctx.text.match(/@\w+/g) ?? []).length;
	if (mentions > maxMentions) return { rule: "spam", reason: "mention_density" };
	const key = `${ctx.channel}:${ctx.actor}`;
	const normalized = ctx.text.trim().toLowerCase();
	const prior = state.get(key);
	if (prior && prior.text === normalized && prior.mentions === mentions) {
		const repeated = prior.count + 1;
		state.set(key, { text: normalized, mentions, count: repeated });
		if (repeated >= maxRepeated) return { rule: "spam", reason: "repeated_text" };
		return undefined;
	}
	state.set(key, { text: normalized, mentions, count: 1 });
	return undefined;
}

export function pruneModerationState(
	state: {
		flood: Map<string, number[]>;
		spam: Map<string, { text: string; mentions: number; count: number }>;
	},
	config: TelegramGroupAutomationConfig | undefined,
	now = Date.now(),
): void {
	const floodWindowMs =
		config?.flood === true ? 10_000 : typeof config?.flood === "object" ? (config.flood.windowMs ?? 10_000) : 10_000;
	if (config?.flood) {
		for (const [key, times] of state.flood) {
			const active = times.filter((at) => now - at <= floodWindowMs);
			if (active.length) state.flood.set(key, active);
			else state.flood.delete(key);
		}
	}
	const spamMaxEntries = 256;
	while (state.spam.size > spamMaxEntries) {
		const oldest = state.spam.keys().next().value;
		if (oldest === undefined) break;
		state.spam.delete(oldest);
	}
}

export function editedMessagesMode(config?: TelegramGroupAutomationConfig): TelegramEditedMessagesMode {
	return config?.editedMessages ?? "ignore";
}

export function telegramUnsupportedTypeReply(): string {
	return "I can't process that message type yet. Try text, voice, photos, or documents.";
}

export function telegramStickerOnly(msg: { sticker?: unknown; text?: string; caption?: string }): boolean {
	return Boolean(msg.sticker && !`${msg.text ?? msg.caption ?? ""}`.trim());
}
