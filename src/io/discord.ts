import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Client,
	Events,
	GatewayIntentBits,
	type Interaction,
	type Message,
	Partials,
	type TextBasedChannel,
} from "discord.js";
import { message as errorMessage, type Logger, userError } from "../core/log.js";
import { chunkText } from "../render/chunk.js";
import { type Attachment, type AttachmentStore, responseBytes } from "./attachments.js";
import { type DeliveryConfig, DeliveryQueue } from "./delivery.js";
import type { Adapter, AdapterStart, AdapterTarget, Outbound } from "./handler.js";
import { DraftReplyStream, type ReplyStreamOption } from "./reply-stream.js";

const APPROVE = "heypi_approve";
const DENY = "heypi_deny";
const DISCORD_TEXT_LIMIT = 2000;

export type DiscordConfig = {
	token: string;
	allow?: DiscordAllow;
	trigger?: DiscordTrigger;
	progress?: DiscordProgress | false;
	streaming?: ReplyStreamOption;
	delivery?: DeliveryConfig | false;
};

export type DiscordTrigger = "mention" | "message";

export type DiscordAllow = {
	guilds?: string[];
	channels?: string[];
	users?: string[];
	dms?: boolean;
};

export type DiscordProgress = {
	message?: string | false;
	delayMs?: number;
};

/** Creates a Discord gateway adapter. Requires Message Content Intent for non-mention message text. */
export function discord(input: DiscordConfig): Adapter {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.MessageContent,
		],
		partials: [Partials.Channel, Partials.Message],
	});
	let activeLogger: Logger | undefined;
	let delivery = new DeliveryQueue(input.delivery);

	return {
		name: "discord",
		async start(start: AdapterStart): Promise<void> {
			activeLogger = start.logger;
			delivery = new DeliveryQueue(input.delivery, start.logger);
			start.logger.info("adapter.start", { adapter: "discord" });
			client.on(Events.MessageCreate, (msg) => {
				void handleMessage({ client, start, config: input, delivery, msg });
			});
			client.on(Events.InteractionCreate, (interaction) => {
				void handleInteraction({ start, delivery, interaction });
			});
			await client.login(input.token);
		},
		async stop(): Promise<void> {
			client.removeAllListeners();
			client.destroy();
			activeLogger?.info("adapter.stop", { adapter: "discord" });
		},
		async send(target: AdapterTarget, out: Outbound, start?: AdapterStart): Promise<void> {
			const log = start?.logger ?? activeLogger;
			const channel = await discordTargetChannel(client, target);
			await sendDiscordOutput({
				channel,
				store: start?.attachments,
				out,
				logger: log ?? noopLogger,
				context: { adapter: "discord", channel: target.channel, user: target.user },
				delivery,
			});
			log?.debug("adapter.send", {
				adapter: "discord",
				channel: target.channel,
				user: target.user,
				chars: out.text.length,
			});
		},
	};
}

async function handleMessage(input: {
	client: Client;
	start: AdapterStart;
	config: DiscordConfig;
	delivery: DeliveryQueue;
	msg: Message;
}): Promise<void> {
	const msg = input.msg;
	if (msg.author.bot || !msg.channel) return;
	const channel = msg.channelId;
	const actor = msg.author.id;
	const team = msg.guildId ?? undefined;
	const trace = `discord:${msg.id}`;
	const dm = isDm(msg);
	const allow = discordAllowed(input.config.allow, { guild: team, channel, user: actor, isDm: dm });
	if (!allow.ok) {
		input.start.logger.debug("adapter.drop", { trace, adapter: "discord", channel, actor, reason: allow.reason });
		return;
	}
	const trigger = discordTriggered(input.config.trigger, {
		text: msg.content,
		isDm: dm,
		mentioned: input.client.user ? msg.mentions.has(input.client.user) : false,
	});
	if (!trigger.ok) {
		input.start.logger.debug("adapter.drop", { trace, adapter: "discord", channel, actor, reason: trigger.reason });
		return;
	}
	const streaming = streamingEnabled(input.config.streaming);
	const progress = discordProgress(input.config.progress, streaming);
	const stream = discordReplyStream({
		config: input.config.streaming,
		message: msg,
		logger: input.start.logger,
		context: { trace, adapter: "discord", channel },
		delivery: input.delivery,
	});
	const pending = startProgress({
		message: msg,
		progress,
		cancelId: trace,
		logger: input.start.logger,
		context: { trace, adapter: "discord", channel },
		delivery: input.delivery,
	});
	try {
		const attachments = await discordAttachments({
			store: input.start.attachments,
			message: msg,
			trace,
			logger: input.start.logger,
		});
		const out = await input.start.handler({
			trace,
			provider: "discord",
			eventId: msg.id,
			team,
			channel,
			actor,
			thread: threadKey(msg),
			text: msg.content,
			attachments,
			data: {
				guildId: msg.guildId,
				channelId: msg.channelId,
				messageId: msg.id,
				attachments: msg.attachments.map((item) => ({ id: item.id, name: item.name, size: item.size })),
			},
			stream,
		});
		if (!out) return;
		if (out.private) await stream?.clear?.();
		if (stream?.complete?.() && !out.approval) {
			await pending.stop();
			await uploadDiscordAttachments({
				channel: msg.channel,
				store: input.start.attachments,
				attachments: out.attachments,
				logger: input.start.logger,
				context: { trace, adapter: "discord", channel },
				delivery: input.delivery,
			});
			return;
		}
		const edited = await pending.update(out);
		const target = out.private ? await msg.author.createDM() : msg.channel;
		await sendDiscordOutput({
			channel: target,
			store: input.start.attachments,
			out,
			replyTo: out.private ? undefined : msg,
			skipFirst: edited,
			logger: input.start.logger,
			context: { trace, adapter: "discord", channel },
			delivery: input.delivery,
		});
	} catch (error) {
		input.start.logger.error("adapter.error", { trace, adapter: "discord", channel, error: errorMessage(error) });
		const text = userError("handler");
		const edited = await pending.update({ text });
		await sendTextChunks({
			channel: msg.channel,
			text,
			replyTo: msg,
			skipFirst: edited,
			context: { trace, adapter: "discord", channel },
			delivery: input.delivery,
		});
	} finally {
		await pending.stop();
	}
}

async function handleInteraction(input: {
	start: AdapterStart;
	delivery: DeliveryQueue;
	interaction: Interaction;
}): Promise<void> {
	if (!input.interaction.isButton()) return;
	const action = parseAction(input.interaction.customId);
	if (!action) return;
	const trace = `discord:${input.interaction.id}`;
	const channel = input.interaction.channelId ?? "unknown";
	const team = input.interaction.guildId ?? undefined;
	const actor = input.interaction.user.id;
	await input.interaction.deferUpdate();
	try {
		const out = await input.start.handler({
			trace,
			provider: "discord",
			eventId: input.interaction.id,
			team,
			channel,
			actor,
			thread: channel,
			text: `${action.kind} ${action.id}`,
			data: { customId: input.interaction.customId, messageId: input.interaction.message.id },
		});
		if (!out) return;
		const target = out.private ? await input.interaction.user.createDM() : input.interaction.channel;
		if (!target) return;
		await sendDiscordOutput({
			channel: target,
			store: input.start.attachments,
			out,
			logger: input.start.logger,
			context: { trace, adapter: "discord", channel },
			delivery: input.delivery,
		});
	} catch (error) {
		input.start.logger.error("adapter.error", { trace, adapter: "discord", channel, error: errorMessage(error) });
		await input.interaction.followUp({ content: userError("handler"), ephemeral: true }).catch(() => undefined);
	}
}

async function discordTargetChannel(client: Client, target: AdapterTarget): Promise<TextBasedChannel> {
	if (target.channel) {
		const channel = await client.channels.fetch(target.channel);
		if (!channel?.isTextBased()) throw new Error(`Discord channel is not text-capable: ${target.channel}`);
		return channel;
	}
	if (!target.user) throw new Error("Discord scheduled target requires channel or user");
	const user = await client.users.fetch(target.user);
	return user.createDM();
}

async function sendDiscordOutput(input: {
	channel: TextBasedChannel;
	store?: AttachmentStore;
	out: Outbound;
	replyTo?: Message;
	skipFirst?: boolean;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	await sendTextChunks({
		channel: input.channel,
		text: input.out.text,
		approval: input.out.approval,
		replyTo: input.replyTo,
		skipFirst: input.skipFirst,
		context: input.context,
		delivery: input.delivery,
	});
	await uploadDiscordAttachments({
		channel: input.channel,
		store: input.store,
		attachments: input.out.attachments,
		logger: input.logger,
		context: input.context,
		delivery: input.delivery,
	});
}

async function sendTextChunks(input: {
	channel: TextBasedChannel;
	text: string;
	approval?: Outbound["approval"];
	replyTo?: Message;
	skipFirst?: boolean;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	const chunks = chunkText(input.text, DISCORD_TEXT_LIMIT);
	for (let index = input.skipFirst ? 1 : 0; index < chunks.length; index++) {
		const components = index === 0 && input.approval ? approvalComponents(input.approval) : undefined;
		await input.delivery.run(
			() =>
				sendTo(input.channel, input.replyTo, {
					content: chunks[index],
					components,
				}),
			{ ...input.context, retry: "send" },
		);
	}
}

function discordReplyStream(input: {
	config?: ReplyStreamOption;
	message: Message;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}) {
	if (!input.config || (typeof input.config === "object" && input.config.enabled === false)) return undefined;
	return new DraftReplyStream(
		{
			limit: DISCORD_TEXT_LIMIT,
			create: async (text) => {
				const sent = await input.delivery.run(() => input.message.reply({ content: text }), {
					...input.context,
					retry: "send",
				});
				return sent.id;
			},
			edit: async (id, text) => {
				const sent = await input.message.channel.messages.fetch(id);
				await input.delivery.run(() => sent.edit({ content: text }), input.context);
			},
			delete: async (id) => {
				const sent = await input.message.channel.messages.fetch(id);
				await input.delivery.run(() => sent.delete(), input.context);
			},
		},
		input.config,
		input.logger,
		input.context,
	);
}

function startProgress(input: {
	message: Message;
	progress?: DiscordProgress;
	cancelId?: string;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}) {
	let id: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const text = input.progress?.message === false ? undefined : (input.progress?.message ?? "Thinking...");
	if (text) {
		timer = setTimeout(() => {
			void input.delivery
				.run(() => input.message.reply({ content: text }), { ...input.context, retry: "send" })
				.then((msg) => {
					id = msg.id;
				})
				.catch((error) =>
					input.logger.warn("discord.progress.message_failed", { ...input.context, error: errorMessage(error) }),
				);
		}, input.progress?.delayMs ?? 1000);
	}
	return {
		async update(out: Outbound): Promise<boolean> {
			if (!id) return false;
			try {
				const msg = await input.message.channel.messages.fetch(id);
				await input.delivery.run(
					() =>
						msg.edit({
							content: firstChunk(out.text),
							components: out.approval ? approvalComponents(out.approval) : [],
						}),
					input.context,
				);
				return true;
			} catch (error) {
				input.logger.warn("discord.progress.update_failed", { ...input.context, error: errorMessage(error) });
				return false;
			}
		},
		async stop(): Promise<void> {
			if (timer) clearTimeout(timer);
			if (!id) return;
			try {
				const msg = await input.message.channel.messages.fetch(id);
				await input.delivery.run(() => msg.delete(), input.context);
			} catch {
				// Progress deletion is best effort.
			}
		},
	};
}

async function discordAttachments(input: {
	store?: AttachmentStore;
	message: Message;
	trace: string;
	logger: Logger;
}): Promise<Attachment[] | undefined> {
	if (!input.store || input.message.attachments.size === 0) return undefined;
	const attachments: Attachment[] = [];
	for (const item of input.message.attachments.values()) {
		try {
			if (input.store.maxBytes !== undefined && item.size > input.store.maxBytes) {
				input.logger.warn("discord.attachment_too_large", {
					trace: input.trace,
					adapter: "discord",
					attachment: item.id,
					size: item.size,
					maxBytes: input.store.maxBytes,
				});
				continue;
			}
			assertDiscordAttachmentUrl(item.url);
			const response = await fetch(item.url);
			if (!response.ok) throw new Error(`Discord attachment download failed: ${response.status}`);
			const data = await responseBytes(response, input.store.maxBytes);
			attachments.push(
				await input.store.save({
					provider: "discord",
					messageId: input.message.id,
					id: item.id,
					name: item.name,
					mimeType: item.contentType ?? undefined,
					data,
					sourceUrl: item.url,
				}),
			);
		} catch (error) {
			input.logger.warn("discord.attachment_failed", {
				trace: input.trace,
				adapter: "discord",
				attachment: item.id,
				error: errorMessage(error),
			});
		}
	}
	return attachments.length ? attachments : undefined;
}

export function assertDiscordAttachmentUrl(input: string): void {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error("invalid Discord attachment URL");
	}
	if (url.protocol !== "https:") throw new Error("invalid Discord attachment URL protocol");
	if (url.hostname !== "cdn.discordapp.com" && url.hostname !== "media.discordapp.net") {
		throw new Error("invalid Discord attachment URL host");
	}
}

async function uploadDiscordAttachments(input: {
	channel: TextBasedChannel;
	store?: AttachmentStore;
	attachments?: Array<{ path: string; name?: string; mimeType?: string }>;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	if (!input.attachments?.length) return;
	if (!input.store) {
		input.logger.warn("discord.attachments_missing_store", input.context);
		return;
	}
	const files: AttachmentBuilder[] = [];
	for (const attachment of input.attachments) {
		try {
			const file = await input.store.resolve(attachment);
			files.push(new AttachmentBuilder(file.path, { name: file.name }));
		} catch (error) {
			input.logger.warn("discord.attachment_resolve_failed", {
				...input.context,
				path: attachment.path,
				error: errorMessage(error),
			});
		}
	}
	if (!files.length) return;
	await input.delivery.run(() => sendTo(input.channel, undefined, { files }), { ...input.context, retry: "send" });
}

function approvalComponents(approval: NonNullable<Outbound["approval"]>) {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`${APPROVE}:${approval.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`${DENY}:${approval.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
		),
	];
}

function parseAction(input: string): { kind: "approve" | "deny"; id: string } | undefined {
	const [kind, id] = input.split(":");
	if (kind === APPROVE && id) return { kind: "approve", id };
	if (kind === DENY && id) return { kind: "deny", id };
	return undefined;
}

function firstChunk(text: string): string {
	return chunkText(text, DISCORD_TEXT_LIMIT)[0] ?? "";
}

function sendTo(
	channel: TextBasedChannel,
	replyTo: Message | undefined,
	input: Parameters<Message["reply"]>[0],
): Promise<Message> {
	if (replyTo) return replyTo.reply(input);
	if (!("send" in channel) || typeof channel.send !== "function") {
		throw new Error("Discord channel cannot send messages");
	}
	return channel.send(input);
}

function threadKey(msg: Message): string {
	return msg.channelId;
}

function isDm(msg: Message): boolean {
	return msg.channel.type === ChannelType.DM;
}

function streamingEnabled(input?: ReplyStreamOption): boolean {
	return Boolean(input && (input === true || typeof input !== "object" || input.enabled !== false));
}

function discordProgress(input: DiscordConfig["progress"], streaming: boolean): DiscordProgress | undefined {
	if (input === false || streaming) return undefined;
	return input;
}

export function discordAllowed(
	input: DiscordAllow | undefined,
	event: { guild?: string; channel: string; user: string; isDm: boolean },
): { ok: true } | { ok: false; reason: string } {
	if (event.isDm && input?.dms === false) return { ok: false, reason: "dm disabled" };
	if (input?.guilds?.length && (!event.guild || !input.guilds.includes(event.guild))) {
		return { ok: false, reason: "guild not allowed" };
	}
	if (input?.channels?.length && !input.channels.includes(event.channel))
		return { ok: false, reason: "channel not allowed" };
	if (input?.users?.length && !input.users.includes(event.user)) return { ok: false, reason: "user not allowed" };
	return { ok: true };
}

export function discordTriggered(
	input: DiscordTrigger | undefined,
	event: { text?: string; isDm: boolean; mentioned: boolean },
): { ok: true } | { ok: false; reason: string } {
	const mode = input ?? (event.isDm ? "message" : "mention");
	if (mode === "message") return { ok: true };
	if (event.mentioned) return { ok: true };
	return { ok: false, reason: "mention required" };
}

const noopLogger: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};
