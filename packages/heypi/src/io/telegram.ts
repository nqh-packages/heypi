import { randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ApprovalConfig } from "../config.js";
import {
	approvalStateLine,
	approvalStateTitle,
	codeFence,
	redactedApprovalPendingText,
	redactedApprovalResolvedText,
} from "../core/approval-view.js";
import { type ActorPolicy, actorUsers } from "../core/approvers.js";
import { message as errorMessage, type Logger, userError } from "../core/log.js";
import type { AppMessages } from "../core/messages.js";
import type { ScopedKey } from "../core/scope.js";
import type { ReplyAttachment } from "../core/types.js";
import { chunkText } from "../render/chunk.js";
import { hostRealPath } from "../runtime/path.js";
import { resolveOutboundAttachments, saveInboundAttachments } from "./attachment-policy.js";
import {
	type Attachment,
	type AttachmentStore,
	attachmentHostRoot,
	type ResolvedAttachment,
	responseBytes,
} from "./attachments.js";
import { runChatMessage } from "./chat-message.js";
import { type DeliveryConfig, DeliveryQueue } from "./delivery.js";
import { allowByDimensions, inboundAllowed, messageTriggered } from "./gate.js";
import type { Adapter, AdapterStart, AdapterTarget, Handler, Outbound } from "./handler.js";
import { logCtx } from "./log-context.js";
import type { ReplyStreamOption } from "./reply-stream.js";
import { DraftReplyStream } from "./reply-stream.js";
import { type ExecRunner, transcribeLocal } from "./stt/local-whisper.js";
import { BoundedQueue } from "./stt/queue.js";
import type { SttConfig, SttLocalConfig } from "./stt/types.js";
import {
	chunkTelegramFormattedText,
	formatTelegramText,
	plainFallbackChunk,
	type TelegramParseMode,
	type TelegramTextChunk,
	telegramParseModeApiValue,
} from "./telegram-format.js";

import {
	editedMessagesMode,
	floodDrop,
	linkDrop,
	pruneModerationState,
	shouldSendWelcome,
	spamDrop,
	type TelegramGroupAutomationConfig,
	type TelegramModerationDrop,
	telegramStickerOnly,
	telegramUnsupportedTypeReply,
	welcomeTemplate,
} from "./telegram-moderation.js";
import {
	registerTelegramWebhook,
	resolveTelegramIngressMode,
	resolveTelegramWebhookSecret,
	resolveTelegramWebhookUrl,
	TelegramUpdateDedupe,
	telegramAllowedUpdates,
} from "./telegram-webhook.js";

const HEYPI_PREFIX = "heypi";
const APPROVE = `${HEYPI_PREFIX}:approve`;
const DENY = `${HEYPI_PREFIX}:deny`;
const CANCEL = `${HEYPI_PREFIX}:cancel`;
const STATUS = `${HEYPI_PREFIX}:status`;
const CUSTOM = `${HEYPI_PREFIX}:custom`;
const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CALLBACK_ANSWER_LIMIT = 200;
const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
const STT_MAX_PENDING = 32;
const CALLBACK_REGISTRY_MAX = 512;

export const TELEGRAM_STT_DISABLED_MESSAGE =
	"Voice transcription is disabled. Set stt.enabled to use local transcription.";
export const TELEGRAM_STT_BUSY_MESSAGE = "Voice transcription is busy. Try again shortly.";
export const TELEGRAM_STT_UNAVAILABLE_MESSAGE =
	"Voice transcription is unavailable. Install ffmpeg and whisper-cpp and configure stt.local.modelPath.";
export const TELEGRAM_PHOTO_ONLY_DEFAULT = "Photo received";

export const TELEGRAM_UNSUPPORTED_TYPE_MESSAGE = telegramUnsupportedTypeReply();

export type { TelegramGroupAutomationConfig };

export type TelegramWebhookConfig = {
	url?: string;
	secret?: string;
	path?: string;
	maxBodyBytes?: number;
};

export type TelegramConfig = {
	name?: string;
	token: string;
	apiUrl?: { override: string };
	mode?: "poll" | "webhook";
	webhook?: TelegramWebhookConfig;
	groupAutomation?: TelegramGroupAutomationConfig;
	pollTimeoutSeconds?: number;
	allow?: TelegramAllow;
	trigger?: TelegramTrigger;
	threadTrigger?: TelegramTrigger | false;
	progress?: TelegramProgress | false;
	streaming?: ReplyStreamOption;
	delivery?: DeliveryConfig | false;
	parseMode?: TelegramParseMode;
	stt?: SttConfig;
	photoOnlyText?: string;
	/** @internal Mock subprocess runner for STT tests. */
	sttRunner?: ExecRunner;
};

export type TelegramTrigger = "mention" | "message";

export type TelegramAllow = {
	chats?: Array<string | number>;
	users?: Array<string | number>;
	dms?: boolean;
};

export type TelegramProgress = {
	message?: string | false;
	delayMs?: number;
};

/** Creates a Telegram adapter (long-poll by default; optional webhook ingress). */
export function telegram(input: TelegramConfig): Adapter {
	const name = input.name ?? "telegram";
	const kind = "telegram";
	const client = new TelegramClient(input.token, input.apiUrl);
	let stopped = false;
	let loop: Promise<void> | undefined;
	let activeLogger: Logger | undefined;
	let delivery = new DeliveryQueue(input.delivery);
	const sttState = createTelegramSttState();
	const updateDedupe = new TelegramUpdateDedupe();
	const moderationState = {
		flood: new Map<string, number[]>(),
		spam: new Map<string, { text: string; mentions: number; count: number }>(),
	};
	const callbackRegistry = new Map<string, Record<string, unknown>>();

	return {
		name,
		kind,
		async start(start: AdapterStart): Promise<void> {
			activeLogger = start.logger;
			delivery = new DeliveryQueue(input.delivery, start.logger);
			stopped = false;
			const mode = resolveTelegramIngressMode(input.mode);
			const allowedUpdates = telegramAllowedUpdates(input.groupAutomation);
			start.logger.info("adapter.start", { adapter: name, kind, mode });
			if (!telegramAllowConfigured(input.allow)) {
				start.logger.warn("security.adapter_allow_missing", {
					adapter: name,
					kind,
					reason: "without allow, delivered DMs and mentioned group messages can trigger the agent",
				});
			}
			if (input.apiUrl) start.logger.warn("telegram.api_url_override", { adapter: name, kind });
			const shared = {
				client,
				start,
				config: input,
				delivery,
				provider: name,
				kind,
				stopped: () => stopped,
				sttState,
				updateDedupe,
				moderationState,
				callbackRegistry,
			};
			if (mode === "webhook") {
				if (!start.http) throw new Error("Telegram webhook mode requires shared HTTP registrar (http config)");
				const webhookUrl = resolveTelegramWebhookUrl({
					url: input.webhook?.url,
					env: process.env,
				});
				if (!webhookUrl) {
					throw new Error("Telegram webhook mode requires webhook.url or HEYPI_TELEGRAM_WEBHOOK_URL");
				}
				const secret = resolveTelegramWebhookSecret({
					secret: input.webhook?.secret,
					env: process.env,
				});
				const bot = await client.getMe().catch((error) => {
					start.logger.warn("telegram.get_me_failed", {
						adapter: name,
						kind,
						error: errorMessage(error),
					});
					return undefined;
				});
				registerTelegramWebhook({
					start,
					name,
					path: input.webhook?.path,
					secret,
					maxBodyBytes: input.webhook?.maxBodyBytes,
					logger: start.logger,
					onUpdate: async (update) => {
						if (!updateDedupe.check(update.update_id)) return;
						await handleTelegramUpdate({
							...shared,
							update: update as TelegramUpdate,
							botUsername: bot?.username,
							botUserId: bot?.id,
						});
					},
				});
				await client.setWebhook({
					url: webhookUrl,
					secret_token: secret,
					allowed_updates: allowedUpdates,
				});
				return;
			}
			await client.deleteWebhook().catch((error) => {
				start.logger.debug("telegram.delete_webhook_failed", {
					adapter: name,
					kind,
					error: errorMessage(error),
				});
			});
			loop = poll({ ...shared, allowedUpdates });
		},
		async stop(): Promise<void> {
			stopped = true;
			for (const controller of sttState.abortControllers.values()) controller.abort();
			await loop;
			activeLogger?.info("adapter.stop", { adapter: name, kind, mode: resolveTelegramIngressMode(input.mode) });
		},
		async send(target: AdapterTarget, out: Outbound, start?: AdapterStart): Promise<void> {
			const chatId = telegramTargetChat(target);
			const threadId = numberOrUndefined(target.thread);
			const log = start?.logger ?? activeLogger;
			await sendTargetChunks({
				client,
				chatId,
				threadId,
				text: out.text,
				approval: out.approval,
				logger: log,
				context: { adapter: name, kind, channel: String(chatId), thread: target.thread },
				delivery,
				parseMode: input.parseMode,
				allow: input.allow,
				approvalConfig: start?.approval,
			});
			if (out.poll) {
				await sendTelegramPoll({
					client,
					chatId,
					threadId,
					poll: out.poll,
				});
			}
			if (out.attachments?.length) {
				await deliverTelegramAttachments({
					client,
					store: start?.attachments,
					chatId,
					threadId,
					attachments: out.attachments,
					scope: out.attachmentScope,
					logger: log ?? noopLogger,
					context: { adapter: name, kind, channel: String(chatId), thread: target.thread },
					delivery,
				});
			}
			log?.debug("adapter.send", {
				adapter: name,
				kind,
				channel: String(chatId),
				thread: target.thread,
				chars: out.text.length,
			});
		},
	};
}

function telegramTargetChat(target: AdapterTarget): number {
	const raw = target.channel ?? target.user;
	if (!raw) throw new Error("Telegram scheduled target requires channel");
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) throw new Error(`Invalid Telegram channel: ${raw}`);
	return parsed;
}

function telegramAllowConfigured(allow: TelegramAllow | undefined): boolean {
	return Boolean(allow?.chats?.length || allow?.users?.length || allow?.dms === false);
}

function numberOrUndefined(input?: string): number | undefined {
	if (!input) return undefined;
	const parsed = Number(input);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function poll(input: {
	client: TelegramClient;
	start: AdapterStart;
	config: TelegramConfig;
	delivery: DeliveryQueue;
	provider: string;
	kind: string;
	stopped: () => boolean;
	sttState: TelegramSttState;
	updateDedupe: TelegramUpdateDedupe;
	moderationState: {
		flood: Map<string, number[]>;
		spam: Map<string, { text: string; mentions: number; count: number }>;
	};
	callbackRegistry: Map<string, Record<string, unknown>>;
	allowedUpdates: string[];
}): Promise<void> {
	let offset = 0;
	const timeout = input.config.pollTimeoutSeconds ?? 25;
	let backoffMs = 1000;
	const bot = await input.client.getMe().catch((error) => {
		input.start.logger.warn("telegram.get_me_failed", {
			adapter: input.provider,
			kind: input.kind,
			error: errorMessage(error),
		});
		return undefined;
	});
	while (!input.stopped()) {
		try {
			const updates = await input.client.getUpdates({
				offset,
				timeout,
				allowed_updates: input.allowedUpdates,
			});
			for (const update of updates) {
				offset = Math.max(offset, update.update_id + 1);
				if (!input.updateDedupe.check(update.update_id)) continue;
				await handleTelegramUpdate({ ...input, update, botUsername: bot?.username, botUserId: bot?.id });
			}
			backoffMs = 1000;
		} catch (error) {
			input.start.logger.warn("telegram.poll_failed", {
				adapter: input.provider,
				kind: input.kind,
				error: errorMessage(error),
				retryMs: backoffMs,
			});
			await sleep(backoffMs);
			backoffMs = Math.min(backoffMs * 2, 60_000);
		}
	}
}

type TelegramSttState = {
	queue: BoundedQueue;
	generations: Map<string, number>;
	abortControllers: Map<string, AbortController>;
};

function createTelegramSttState(): TelegramSttState {
	return {
		queue: new BoundedQueue({ maxConcurrent: 2, maxPerChat: 1, maxPending: STT_MAX_PENDING }),
		generations: new Map(),
		abortControllers: new Map(),
	};
}

const noopLogger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

/** Returns true when local STT is explicitly enabled in Telegram config. */
export function sttEnabled(config?: SttConfig): boolean {
	if (config === undefined || config === false) return false;
	if (config === true) return true;
	return config.enabled === true;
}

export function telegramVoiceOrAudio(msg: TelegramMessage): boolean {
	return Boolean(msg.voice || msg.audio);
}

export function telegramPhotoOnly(msg: TelegramMessage): boolean {
	return Boolean(msg.photo?.length && !textOf(msg).trim());
}

/** Voice, audio, and photo-only messages bypass mention-mode trigger gates. */
export function telegramMediaTriggerBypass(msg: TelegramMessage): boolean {
	return telegramVoiceOrAudio(msg) || telegramPhotoOnly(msg);
}

export function resolveTelegramInboundText(
	msg: TelegramMessage,
	photoOnlyText?: string,
	fallbackText?: string,
): string {
	if (telegramPhotoOnly(msg)) return photoOnlyText ?? TELEGRAM_PHOTO_ONLY_DEFAULT;
	return fallbackText ?? textOf(msg);
}

export function isTelegramImageMime(mimeType?: string, name?: string): boolean {
	const mime = mimeType?.toLowerCase();
	if (mime?.startsWith("image/")) return true;
	const ext = extname(name ?? "").toLowerCase();
	return ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".gif" || ext === ".webp";
}

export function sttUnavailableUserMessage(reason: string): string {
	return `${TELEGRAM_STT_UNAVAILABLE_MESSAGE} (${reason})`;
}

/** Resolves stored attachment paths to host paths ffmpeg/whisper can read. */
export async function resolveTelegramSttAudioPath(
	path: string | undefined,
	roots?: string | { storage?: string; runtime?: string },
): Promise<string | undefined> {
	if (!path) return undefined;
	const resolved =
		typeof roots === "string"
			? { storage: roots, runtime: roots }
			: { storage: roots?.storage, runtime: roots?.runtime };
	const hostRoots = [
		attachmentHostRoot(path, { storage: resolved.storage ?? "", runtime: resolved.runtime ?? "" }),
		resolved.storage,
		resolved.runtime,
	].filter((root, index, list): root is string => Boolean(root) && list.indexOf(root) === index);
	for (const root of hostRoots) {
		try {
			return await hostRealPath(root, path);
		} catch {
			// Fall through for host-absolute custom store paths outside known roots.
		}
	}
	try {
		await access(path);
		return path;
	} catch {
		return undefined;
	}
}

function resolveTelegramSttLocal(config?: SttConfig): SttLocalConfig | undefined {
	if (typeof config === "object" && config !== null) return config.local;
	return undefined;
}

function supersedeTelegramSttChat(state: TelegramSttState, chat: string): number {
	const next = (state.generations.get(chat) ?? 0) + 1;
	state.generations.set(chat, next);
	state.abortControllers.get(chat)?.abort();
	const controller = new AbortController();
	state.abortControllers.set(chat, controller);
	return next;
}

function telegramSttStale(state: TelegramSttState, chat: string, generation: number): boolean {
	return (state.generations.get(chat) ?? 0) !== generation;
}

export async function handleTelegramUpdate(input: {
	client: TelegramClient;
	start: AdapterStart;
	config: TelegramConfig;
	delivery: DeliveryQueue;
	provider: string;
	kind: string;
	update: TelegramUpdate;
	stopped: () => boolean;
	botUsername?: string;
	botUserId?: number;
	sttState: TelegramSttState;
	moderationState: {
		flood: Map<string, number[]>;
		spam: Map<string, { text: string; mentions: number; count: number }>;
	};
	callbackRegistry: Map<string, Record<string, unknown>>;
}): Promise<void> {
	const member = input.update.my_chat_member ?? input.update.chat_member;
	if (member?.new_chat_member?.is_bot && member.chat) {
		if (
			shouldSendWelcome({
				config: input.config.groupAutomation,
				newMemberIsBot: member.new_chat_member.is_bot,
				botUserId: input.botUserId,
			}) &&
			member.new_chat_member.id === input.botUserId
		) {
			const template = welcomeTemplate(input.config.groupAutomation);
			if (template) {
				await input.delivery.run(
					() =>
						input.client.sendMessage({
							chat_id: member.chat.id,
							text: template,
						}),
					{ adapter: input.provider, kind: input.kind, channel: String(member.chat.id) },
				);
			}
		}
		return;
	}
	const callback = input.update.callback_query;
	if (callback) {
		await handleTelegramCallback({
			client: input.client,
			handler: input.start.handler,
			logger: input.start.logger,
			store: input.start.attachments,
			messages: input.start.messages,
			callback,
			delivery: input.delivery,
			provider: input.provider,
			kind: input.kind,
			allow: input.config.allow,
			parseMode: input.config.parseMode,
			approvalConfig: input.start.approval,
			callbackRegistry: input.callbackRegistry,
		});
		return;
	}
	const editedMode = editedMessagesMode(input.config.groupAutomation);
	const msg =
		(input.update.edited_message && editedMode !== "ignore" ? input.update.edited_message : undefined) ??
		input.update.message;
	if (!msg?.chat || msg.from?.is_bot) return;
	if (input.update.edited_message && editedMode === "log") {
		input.start.logger.info("telegram.edited_message", {
			adapter: input.provider,
			kind: input.kind,
			channel: String(msg.chat.id),
			messageId: msg.message_id,
			actor: String(msg.from?.id ?? "unknown"),
		});
		return;
	}
	const channel = String(msg.chat.id);
	const actor = String(msg.from?.id ?? "unknown");
	const thread = threadKey(msg);
	const trace = `telegram:${msg.message_id}`;
	const sttActive = input.sttState.abortControllers.has(thread);
	let sttGeneration: number | undefined;
	if (telegramVoiceOrAudio(msg) || sttActive) {
		sttGeneration = supersedeTelegramSttChat(input.sttState, thread);
	}
	const context = (extra?: Record<string, unknown>) =>
		logCtx({ trace, adapter: input.provider, kind: input.kind, channel, thread }, extra);
	const allow = telegramAllowed(input.config.allow, { chat: channel, user: actor, isDm: telegramDm(msg) });
	if (!allow.ok) {
		input.start.logger.debug(
			"adapter.drop",
			context({
				actor,
				reason: allow.reason,
			}),
		);
		return;
	}
	const rawText = textOf(msg);
	const text = stripTelegramMention(rawText, input.botUsername);
	const mediaBypass = telegramMediaTriggerBypass(msg);
	const trigger = mediaBypass
		? ({ ok: true } as const)
		: telegramTriggered(input.config.trigger, {
				text: rawText,
				isDm: telegramDm(msg),
				botUsername: input.botUsername,
				thread: Boolean(msg.message_thread_id),
				threadTrigger: input.config.threadTrigger,
			});
	if (!trigger.ok) {
		input.start.logger.debug(
			"adapter.drop",
			context({
				actor,
				reason: trigger.reason,
			}),
		);
		return;
	}
	const moderationCtx = { channel, actor, text: rawText || text };
	const drop =
		floodDrop(input.config.groupAutomation, input.moderationState.flood, moderationCtx) ??
		linkDrop(input.config.groupAutomation, moderationCtx) ??
		spamDrop(input.config.groupAutomation, input.moderationState.spam, moderationCtx);
	if (drop) {
		logModerationDrop(input.start.logger, input.config.groupAutomation, context(), drop);
		return;
	}
	pruneModerationState(input.moderationState, input.config.groupAutomation);
	if (telegramStickerOnly(msg)) {
		await sendTelegramNotice({
			client: input.client,
			message: msg,
			text: TELEGRAM_UNSUPPORTED_TYPE_MESSAGE,
			logger: input.start.logger,
			context: context(),
			delivery: input.delivery,
			parseMode: input.config.parseMode,
		});
		return;
	}
	if (telegramVoiceOrAudio(msg)) {
		if (!sttEnabled(input.config.stt)) {
			await sendTelegramNotice({
				client: input.client,
				message: msg,
				text: TELEGRAM_STT_DISABLED_MESSAGE,
				logger: input.start.logger,
				context: context(),
				delivery: input.delivery,
				parseMode: input.config.parseMode,
			});
			return;
		}
		const submit = input.sttState.queue.trySubmit(
			thread,
			() =>
				runTelegramSttJob({
					...input,
					msg,
					thread,
					channel,
					actor,
					trace,
					context,
					generation: sttGeneration as number,
				}),
			input.sttState.abortControllers.get(thread)?.signal,
		);
		if (!submit.ok) {
			await sendTelegramNotice({
				client: input.client,
				message: msg,
				text: TELEGRAM_STT_BUSY_MESSAGE,
				logger: input.start.logger,
				context: context(),
				delivery: input.delivery,
				parseMode: input.config.parseMode,
			});
			return;
		}
		void submit.job
			.then(({ waitMs }) => {
				input.start.logger.debug("telegram.stt.complete", context({ waitMs }));
			})
			.catch((error: unknown) => {
				input.start.logger.warn("telegram.stt.failed", context({ error: errorMessage(error) }));
			});
		return;
	}
	const inboundText = resolveTelegramInboundText(msg, input.config.photoOnlyText, text);
	const location = msg.location ? { latitude: msg.location.latitude, longitude: msg.location.longitude } : undefined;
	await processTelegramMessage({
		...input,
		msg,
		channel,
		actor,
		thread,
		trace,
		context,
		text: inboundText,
		location,
		callbackRegistry: input.callbackRegistry,
	});
}

function logModerationDrop(
	logger: Logger,
	config: TelegramGroupAutomationConfig | undefined,
	context: Record<string, unknown>,
	drop: TelegramModerationDrop,
): void {
	const payload = { ...context, rule: drop.rule, reason: drop.reason };
	if (config?.auditDrops) logger.info("telegram.moderation.drop", payload);
	else logger.debug("telegram.moderation.drop", payload);
}

async function runTelegramSttJob(input: {
	client: TelegramClient;
	start: AdapterStart;
	config: TelegramConfig;
	delivery: DeliveryQueue;
	provider: string;
	kind: string;
	msg: TelegramMessage;
	channel: string;
	actor: string;
	thread: string;
	trace: string;
	context: (extra?: Record<string, unknown>) => Record<string, unknown>;
	generation: number;
	sttState: TelegramSttState;
	callbackRegistry: Map<string, Record<string, unknown>>;
}): Promise<void> {
	if (telegramSttStale(input.sttState, input.thread, input.generation)) return;
	const scope = input.start.handler.attachmentScope?.({
		provider: input.provider,
		kind: input.kind,
		channel: input.channel,
		actor: input.actor,
	});
	const attachments = await telegramAttachments({
		client: input.client,
		store: input.start.attachments,
		scope,
		message: input.msg,
		provider: input.provider,
		kind: input.kind,
		messageId: String(input.msg.message_id),
		trace: input.trace,
		logger: input.start.logger,
	});
	if (telegramSttStale(input.sttState, input.thread, input.generation)) return;
	const savedPath = attachments?.[0]?.path;
	const audioPath = await resolveTelegramSttAudioPath(savedPath, {
		storage: input.start.app?.attachments?.root ?? input.start.app?.state.root,
		runtime: input.start.app?.runtime.root,
	});
	if (!audioPath) {
		await sendTelegramNotice({
			client: input.client,
			message: input.msg,
			text: sttUnavailableUserMessage(savedPath ? "audio file not found" : "voice attachment was not saved"),
			logger: input.start.logger,
			context: input.context(),
			delivery: input.delivery,
			parseMode: input.config.parseMode,
		});
		return;
	}
	const result = await transcribeLocal({
		audioPath,
		config: resolveTelegramSttLocal(input.config.stt),
		env: process.env,
		runner: input.config.sttRunner,
	});
	if (telegramSttStale(input.sttState, input.thread, input.generation)) return;
	if (!result.ok) {
		await sendTelegramNotice({
			client: input.client,
			message: input.msg,
			text: sttUnavailableUserMessage(result.reason),
			logger: input.start.logger,
			context: input.context(),
			delivery: input.delivery,
			parseMode: input.config.parseMode,
		});
		return;
	}
	await processTelegramMessage({
		...input,
		text: result.text,
		preloadedAttachments: attachments,
	});
}

async function processTelegramMessage(input: {
	client: TelegramClient;
	start: AdapterStart;
	config: TelegramConfig;
	delivery: DeliveryQueue;
	provider: string;
	kind: string;
	msg: TelegramMessage;
	channel: string;
	actor: string;
	thread: string;
	trace: string;
	context: (extra?: Record<string, unknown>) => Record<string, unknown>;
	text: string;
	preloadedAttachments?: Attachment[];
	location?: { latitude: number; longitude: number };
	callbackRegistry: Map<string, Record<string, unknown>>;
}): Promise<void> {
	const msg = input.msg;
	const streaming = streamingEnabled(input.config.streaming);
	const progress = telegramProgress(input.config.progress, streaming);
	const stream = telegramReplyStream({
		config: input.config.streaming,
		client: input.client,
		message: msg,
		logger: input.start.logger,
		context: input.context(),
		delivery: input.delivery,
	});
	const pending = startProgress({
		client: input.client,
		chatId: msg.chat.id,
		threadId: msg.message_thread_id,
		replyTo: msg.message_id,
		cancelId: input.trace,
		progress,
		isDm: telegramDm(msg),
		allow: input.config.allow,
		approvalConfig: input.start.approval,
		logger: input.start.logger,
		context: input.context({ event: msg.message_id }),
		delivery: input.delivery,
	});
	await runChatMessage({
		logger: input.start.logger,
		context: input.context,
		handler: input.start.handler,
		stream,
		progress: pending,
		loadAttachments: input.preloadedAttachments
			? async () => input.preloadedAttachments
			: (scope) =>
					telegramAttachments({
						client: input.client,
						store: input.start.attachments,
						scope,
						message: msg,
						provider: input.provider,
						kind: input.kind,
						messageId: String(msg.message_id),
						trace: input.trace,
						logger: input.start.logger,
					}),
		inbound: () => ({
			trace: input.trace,
			provider: input.provider,
			kind: input.kind,
			eventId: String(msg.message_id),
			channel: input.channel,
			channelName: telegramChatName(msg.chat),
			actor: input.actor,
			actorName: telegramUserName(msg.from),
			thread: input.thread,
			threadName: msg.message_thread_id ? `topic ${msg.message_thread_id}` : undefined,
			text: input.text,
			data: {
				...msg,
				location: input.location,
			},
		}),
		placement: {
			fresh: async (out) => {
				await sendTelegramOutput({
					client: input.client,
					store: input.start.attachments,
					message: msg,
					out,
					skipFirst: false,
					logger: input.start.logger,
					context: input.context(),
					delivery: input.delivery,
					parseMode: input.config.parseMode,
					allow: input.config.allow,
					approvalConfig: input.start.approval,
					callbackRegistry: input.callbackRegistry,
				});
			},
			streamed: async (out) => {
				await uploadTelegramAttachments({
					client: input.client,
					store: input.start.attachments,
					message: msg,
					attachments: out.attachments,
					scope: out.attachmentScope,
					logger: input.start.logger,
					context: input.context(),
					delivery: input.delivery,
				});
			},
			progress: async (out) => {
				const edited = await pending.update(out, input.config.parseMode);
				await sendTelegramOutput({
					client: input.client,
					store: input.start.attachments,
					message: msg,
					out,
					skipFirst: edited,
					logger: input.start.logger,
					context: input.context(),
					delivery: input.delivery,
					parseMode: input.config.parseMode,
					allow: input.config.allow,
					approvalConfig: input.start.approval,
					callbackRegistry: input.callbackRegistry,
				});
			},
		},
		sendError: async () => {
			const text = userError(input.start.messages?.error);
			const edited = await pending.update({ text }, input.config.parseMode);
			await sendChunks({
				client: input.client,
				message: msg,
				text,
				skipFirst: edited,
				logger: input.start.logger,
				context: input.context(),
				delivery: input.delivery,
				parseMode: input.config.parseMode,
			});
		},
	});
}

export async function handleTelegramCallback(input: {
	client: TelegramClient;
	handler: Handler;
	logger: Logger;
	store?: AttachmentStore;
	messages?: AppMessages;
	callback: TelegramCallbackQuery;
	delivery: DeliveryQueue;
	provider: string;
	kind: string;
	allow?: TelegramAllow;
	parseMode?: TelegramParseMode;
	approvalConfig?: ApprovalConfig;
	callbackRegistry: Map<string, Record<string, unknown>>;
}): Promise<void> {
	const msg = input.callback.message;
	const action = parseTelegramCallback(input.callback.data);
	if (!msg || !action) {
		await input.client.answerCallbackQuery({ callback_query_id: input.callback.id, text: "Unknown action" });
		return;
	}
	const channel = String(msg.chat.id);
	const actor = String(input.callback.from.id);
	const thread = threadKey(msg);
	const trace = `telegram:${input.callback.id}`;
	const context = (extra?: Record<string, unknown>) =>
		logCtx({ trace, adapter: input.provider, kind: input.kind, channel }, extra);
	const allow = inboundAllowed(
		(ctx) => telegramAllowed(input.allow, { chat: ctx.channel, user: ctx.actor, isDm: ctx.isDm }),
		{ channel, actor, isDm: telegramDm(msg) },
	);
	if (!allow.ok) {
		input.logger.debug(
			"adapter.drop",
			context({
				actor,
				reason: allow.reason,
			}),
		);
		await input.delivery.run(
			() =>
				input.client.answerCallbackQuery({
					callback_query_id: input.callback.id,
					text: "Not allowed",
					show_alert: true,
				}),
			context(),
		);
		return;
	}
	if (action.kind === "custom") {
		await input.delivery.run(
			() => input.client.answerCallbackQuery({ callback_query_id: input.callback.id }),
			context(),
		);
		const payload = input.callbackRegistry.get(action.token);
		input.callbackRegistry.delete(action.token);
		await input.handler({
			trace,
			provider: input.provider,
			kind: input.kind,
			eventId: input.callback.id,
			channel,
			actor,
			actorName: telegramUserName(input.callback.from),
			thread,
			text: `callback:${action.token}`,
			data: {
				type: "telegram_callback",
				token: action.token,
				payload,
				callbackData: input.callback.data,
			},
		});
		return;
	}
	let answered = false;
	let acknowledged = false;
	const answer = async () => {
		if (answered) return;
		await input.delivery.run(
			() => input.client.answerCallbackQuery({ callback_query_id: input.callback.id }),
			context(),
		);
		answered = true;
	};
	const isDm = telegramDm(msg);
	const mode = input.parseMode ?? "plain";
	const resolvedChunk = (out: Outbound, state: Outbound["approvalResolution"], actor?: string, original?: string) =>
		firstFormattedChunk(
			telegramVisibleResolvedText(out, state, actor, original, isDm),
			Boolean(out.approval) && isDm,
			mode,
		);
	const acknowledge = async (out: Outbound) => {
		await answer();
		await editTelegramText({
			client: input.client,
			chatId: msg.chat.id,
			messageId: msg.message_id,
			chunk: resolvedChunk(out, "approved", telegramActor(input.callback.from)),
			replyMarkup: emptyMarkup(),
			logger: input.logger,
			context: context(),
			delivery: input.delivery,
		});
		acknowledged = true;
	};
	const replace = async (out: Outbound) => {
		await answer();
		await editTelegramText({
			client: input.client,
			chatId: msg.chat.id,
			messageId: msg.message_id,
			chunk: resolvedChunk(
				out,
				out.approvalResolution ?? (action.kind === "deny" ? "rejected" : "approved"),
				telegramActor(input.callback.from),
				msg.text,
			),
			replyMarkup: emptyMarkup(),
			logger: input.logger,
			context: context(),
			delivery: input.delivery,
		});
	};
	try {
		const out = await input.handler({
			trace,
			provider: input.provider,
			kind: input.kind,
			eventId: input.callback.id,
			channel,
			actor,
			thread,
			text: actionText(action),
			data: input.callback,
			ack: action.kind === "approve" ? (out) => acknowledge(out) : undefined,
			replace: action.kind === "approve" || action.kind === "deny" ? replace : undefined,
		});
		if (!out) {
			await answer();
			return;
		}
		if (out.private) {
			if (out.replaceOriginal) {
				await answer();
				await editTelegramText({
					client: input.client,
					chatId: msg.chat.id,
					messageId: msg.message_id,
					chunk: resolvedChunk(out, out.approvalResolution, undefined, msg.text),
					replyMarkup: emptyMarkup(),
					logger: input.logger,
					context: context(),
					delivery: input.delivery,
				});
				return;
			}
			answered = true;
			await input.delivery.run(
				() =>
					input.client.answerCallbackQuery({
						callback_query_id: input.callback.id,
						text: truncate(out.text, TELEGRAM_CALLBACK_ANSWER_LIMIT),
						show_alert: true,
					}),
				context(),
			);
			return;
		}
		await answer();
		if (acknowledged) {
			await sendTelegramOutput({
				client: input.client,
				store: input.store,
				message: msg,
				out,
				logger: input.logger,
				context: context({ thread }),
				delivery: input.delivery,
				parseMode: mode,
				allow: input.allow,
				approvalConfig: input.approvalConfig,
				callbackRegistry: input.callbackRegistry,
			});
			return;
		}
		if (action.kind === "deny" && out.approvalResolution) {
			await editTelegramText({
				client: input.client,
				chatId: msg.chat.id,
				messageId: msg.message_id,
				chunk: resolvedChunk(out, out.approvalResolution, telegramActor(input.callback.from), msg.text),
				replyMarkup: emptyMarkup(),
				logger: input.logger,
				context: context(),
				delivery: input.delivery,
			});
			return;
		}
		if (action.kind === "approve") {
			await sendTelegramOutput({
				client: input.client,
				store: input.store,
				message: msg,
				out,
				logger: input.logger,
				context: context({ thread }),
				delivery: input.delivery,
				parseMode: mode,
				allow: input.allow,
				approvalConfig: input.approvalConfig,
				callbackRegistry: input.callbackRegistry,
			});
			return;
		}
		const approval = out.approval;
		const plan = telegramApprovalDisplayPlan({ text: out.text, approval, isDm });
		await editTelegramText({
			client: input.client,
			chatId: msg.chat.id,
			messageId: msg.message_id,
			chunk: firstFormattedChunk(plan.visibleText, plan.showMarkup, mode),
			replyMarkup: plan.showMarkup && approval ? approvalMarkup(approval) : emptyMarkup(),
			logger: input.logger,
			context: context(),
			delivery: input.delivery,
		});
		if (plan.groupApproval && approval) {
			await dmTelegramApprovers({
				client: input.client,
				allow: input.allow,
				approvalConfig: input.approvalConfig,
				approval,
				text: out.text,
				parseMode: mode,
				logger: input.logger,
				context: context(),
				delivery: input.delivery,
			});
		}
		await sendTelegramOutput({
			client: input.client,
			store: input.store,
			message: msg,
			out,
			skipFirst: true,
			logger: input.logger,
			context: context({ thread }),
			delivery: input.delivery,
			parseMode: mode,
			allow: input.allow,
			approvalConfig: input.approvalConfig,
			callbackRegistry: input.callbackRegistry,
		});
	} catch (error) {
		input.logger.error(
			"adapter.error",
			context({
				thread,
				error: errorMessage(error),
			}),
		);
		await input.delivery.run(
			() =>
				input.client.answerCallbackQuery({
					callback_query_id: input.callback.id,
					text: userError(input.messages?.error),
					show_alert: true,
				}),
			context(),
		);
	}
}

async function sendTelegramOutput(input: {
	client: TelegramClient;
	store?: AttachmentStore;
	message: TelegramMessage;
	out: Outbound;
	skipFirst?: boolean;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
	parseMode?: TelegramParseMode;
	allow?: TelegramAllow;
	approvalConfig?: ApprovalConfig;
	callbackRegistry?: Map<string, Record<string, unknown>>;
}): Promise<void> {
	await sendChunks({
		client: input.client,
		message: input.message,
		text: input.out.text,
		approval: input.out.approval,
		replyMarkup: input.out.replyMarkup,
		skipFirst: input.skipFirst,
		logger: input.logger,
		context: input.context,
		delivery: input.delivery,
		parseMode: input.parseMode,
		allow: input.allow,
		approvalConfig: input.approvalConfig,
		callbackRegistry: input.callbackRegistry,
	});
	if (input.out.poll) {
		await sendTelegramPoll({
			client: input.client,
			chatId: input.message.chat.id,
			threadId: input.message.message_thread_id,
			poll: input.out.poll,
		});
	}
	await uploadTelegramAttachments({
		client: input.client,
		store: input.store,
		message: input.message,
		attachments: input.out.attachments,
		scope: input.out.attachmentScope,
		logger: input.logger,
		context: input.context,
		delivery: input.delivery,
	});
}

async function sendTelegramPoll(input: {
	client: TelegramClient;
	chatId: number;
	threadId?: number;
	poll: NonNullable<Outbound["poll"]>;
}): Promise<void> {
	await input.client.sendPoll({
		chat_id: input.chatId,
		message_thread_id: input.threadId,
		question: input.poll.question,
		options: input.poll.options,
		is_anonymous: input.poll.isAnonymous,
	});
}

async function sendChunks(input: {
	client: TelegramClient;
	message: TelegramMessage;
	text: string;
	approval?: Outbound["approval"];
	replyMarkup?: Outbound["replyMarkup"];
	skipFirst?: boolean;
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
	parseMode?: TelegramParseMode;
	allow?: TelegramAllow;
	approvalConfig?: ApprovalConfig;
	callbackRegistry?: Map<string, Record<string, unknown>>;
}): Promise<void> {
	const isDm = telegramDm(input.message);
	const mode = input.parseMode ?? "plain";
	const plan = telegramApprovalDisplayPlan({
		text: input.text,
		approval: input.approval,
		isDm,
	});
	const chunks = chunkTelegramFormattedText(plan.visibleText, mode);
	const customMarkup =
		input.replyMarkup && input.callbackRegistry
			? normalizeTelegramReplyMarkup(input.replyMarkup, input.callbackRegistry)
			: undefined;
	for (let index = input.skipFirst ? 1 : 0; index < chunks.length; index++) {
		let markup = emptyMarkup();
		if (index === 0) {
			if (plan.showMarkup && input.approval) markup = approvalMarkup(input.approval);
			else if (customMarkup) markup = customMarkup;
		}
		await sendTelegramChunk({
			client: input.client,
			chatId: input.message.chat.id,
			threadId: input.message.message_thread_id,
			replyTo: input.message.message_id,
			chunk: chunks[index],
			replyMarkup: markup,
			logger: input.logger,
			context: input.context,
			delivery: input.delivery,
		});
	}
	if (plan.groupApproval && input.approval) {
		await dmTelegramApprovers({
			client: input.client,
			allow: input.allow,
			approvalConfig: input.approvalConfig,
			approval: input.approval,
			text: input.text,
			parseMode: mode,
			logger: input.logger,
			context: input.context,
			delivery: input.delivery,
		});
	}
}

async function sendTargetChunks(input: {
	client: TelegramClient;
	chatId: number;
	threadId?: number;
	text: string;
	approval?: Outbound["approval"];
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
	parseMode?: TelegramParseMode;
	allow?: TelegramAllow;
	approvalConfig?: ApprovalConfig;
}): Promise<void> {
	const isDm = telegramDirectChat(input.chatId);
	const mode = input.parseMode ?? "plain";
	const plan = telegramApprovalDisplayPlan({
		text: input.text,
		approval: input.approval,
		isDm,
	});
	const chunks = chunkTelegramFormattedText(plan.visibleText, mode);
	for (let index = 0; index < chunks.length; index++) {
		await sendTelegramChunk({
			client: input.client,
			chatId: input.chatId,
			threadId: input.threadId,
			chunk: chunks[index],
			replyMarkup: index === 0 && plan.showMarkup && input.approval ? approvalMarkup(input.approval) : emptyMarkup(),
			logger: input.logger,
			context: input.context,
			delivery: input.delivery,
		});
	}
	if (plan.groupApproval && input.approval) {
		await dmTelegramApprovers({
			client: input.client,
			allow: input.allow,
			approvalConfig: input.approvalConfig,
			approval: input.approval,
			text: input.text,
			parseMode: mode,
			logger: input.logger,
			context: input.context,
			delivery: input.delivery,
		});
	}
}

async function sendTelegramChunk(input: {
	client: TelegramClient;
	chatId: number;
	threadId?: number;
	replyTo?: number;
	chunk: TelegramTextChunk;
	replyMarkup?: TelegramReplyMarkup;
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	await deliverTelegramFormattedText({
		chunk: input.chunk,
		delivery: input.delivery,
		context: input.context ?? {},
		retry: "send",
		plainRetry: "send_plain",
		deliver: (chunk) =>
			input.client.sendMessage({
				chat_id: input.chatId,
				message_thread_id: input.threadId,
				reply_to_message_id: input.replyTo,
				text: chunk.text,
				parse_mode: telegramParseModeApiValue(chunk.parseMode),
				reply_markup: input.replyMarkup,
			}),
	});
}

async function editTelegramText(input: {
	client: TelegramClient;
	chatId: number;
	messageId: number;
	chunk: TelegramTextChunk;
	replyMarkup?: TelegramReplyMarkup;
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	await deliverTelegramFormattedText({
		chunk: input.chunk,
		delivery: input.delivery,
		context: input.context ?? {},
		plainRetry: "edit_plain",
		deliver: (chunk) =>
			input.client.editMessageText({
				chat_id: input.chatId,
				message_id: input.messageId,
				text: chunk.text,
				parse_mode: telegramParseModeApiValue(chunk.parseMode),
				reply_markup: input.replyMarkup,
			}),
	});
}

async function deliverTelegramFormattedText(input: {
	chunk: TelegramTextChunk;
	delivery: DeliveryQueue;
	context: Record<string, unknown>;
	retry?: "send";
	plainRetry: "send_plain" | "edit_plain";
	deliver: (chunk: TelegramTextChunk) => Promise<unknown>;
}): Promise<void> {
	const firstContext = input.retry ? { ...input.context, retry: input.retry } : input.context;
	try {
		await input.delivery.run(() => input.deliver(input.chunk), firstContext);
	} catch (error) {
		if (!telegramParseError(error) || input.chunk.parseMode === "plain") throw error;
		await input.delivery.run(() => input.deliver(plainFallbackChunk(input.chunk)), {
			...input.context,
			retry: input.plainRetry,
		});
	}
}

function telegramParseError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return message.includes("parse") || message.includes("can't parse");
}

function resolveTelegramApproverUserIds(allow: TelegramAllow | undefined, approvers?: ActorPolicy): string[] {
	const configured = actorUsers(approvers);
	const allowedUsers = allow?.users?.map(String) ?? [];
	if (configured.length) {
		if (allowedUsers.length) return configured.filter((user) => allowedUsers.includes(user));
		return configured;
	}
	return allowedUsers;
}

async function dmTelegramApprovers(input: {
	client: TelegramClient;
	allow?: TelegramAllow;
	approvalConfig?: ApprovalConfig;
	approval: NonNullable<Outbound["approval"]>;
	text: string;
	parseMode?: TelegramParseMode;
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	const recipients = resolveTelegramApproverUserIds(input.allow, input.approvalConfig?.approvers);
	if (!recipients.length) {
		input.logger?.warn("telegram.approval_dm_recipients_missing", input.context);
		return;
	}
	const mode = input.parseMode ?? "plain";
	const body = telegramApprovalText(input.text, input.approval);
	const chunk = chunkTelegramFormattedText(body, mode)[0] ?? { text: body, parseMode: mode };
	for (const userId of recipients) {
		try {
			await sendTelegramChunk({
				client: input.client,
				chatId: Number(userId),
				chunk,
				replyMarkup: approvalMarkup(input.approval),
				logger: input.logger,
				context: { ...input.context, approvalDm: userId },
				delivery: input.delivery,
			});
		} catch (error) {
			input.logger?.error("telegram.approval_dm_failed", {
				...input.context,
				userId,
				error: errorMessage(error),
			});
		}
	}
}

function telegramReplyStream(input: {
	config?: ReplyStreamOption;
	client: TelegramClient;
	message: TelegramMessage;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}) {
	if (!input.config || (typeof input.config === "object" && input.config.enabled === false)) return undefined;
	return new DraftReplyStream(
		{
			limit: TELEGRAM_TEXT_LIMIT,
			create: async (text) => {
				const res = await input.delivery.run(
					() =>
						input.client.sendMessage({
							chat_id: input.message.chat.id,
							message_thread_id: input.message.message_thread_id,
							text,
							reply_to_message_id: input.message.message_id,
						}),
					{ ...input.context, retry: "send" },
				);
				return String(res.message_id);
			},
			edit: async (id, text) => {
				await input.delivery.run(
					() =>
						input.client.editMessageText({
							chat_id: input.message.chat.id,
							message_id: Number(id),
							text,
						}),
					input.context,
				);
			},
			delete: async (id) => {
				await input.delivery.run(
					() => input.client.deleteMessage({ chat_id: input.message.chat.id, message_id: Number(id) }),
					input.context,
				);
			},
		},
		input.config,
		input.logger,
		input.context,
	);
}

function streamingEnabled(input?: ReplyStreamOption): boolean {
	return Boolean(input && (input === true || typeof input !== "object" || input.enabled !== false));
}

function telegramProgress(input: TelegramConfig["progress"], streaming: boolean): TelegramProgress | undefined {
	if (input === false || streaming) return undefined;
	return input ?? { delayMs: 0 };
}

async function sendTelegramNotice(input: {
	client: TelegramClient;
	message: TelegramMessage;
	text: string;
	logger?: Logger;
	context?: Record<string, unknown>;
	delivery: DeliveryQueue;
	parseMode?: TelegramParseMode;
}): Promise<void> {
	await sendChunks({
		client: input.client,
		message: input.message,
		text: input.text,
		logger: input.logger,
		context: input.context,
		delivery: input.delivery,
		parseMode: input.parseMode,
	});
}

async function uploadTelegramAttachments(input: {
	client: TelegramClient;
	store?: AttachmentStore;
	message: TelegramMessage;
	attachments?: Array<{ path: string; name?: string; mimeType?: string }>;
	scope?: ScopedKey;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	await deliverTelegramAttachments({
		client: input.client,
		store: input.store,
		chatId: input.message.chat.id,
		threadId: input.message.message_thread_id,
		replyTo: input.message.message_id,
		attachments: input.attachments,
		scope: input.scope,
		logger: input.logger,
		context: input.context,
		delivery: input.delivery,
	});
}

async function deliverTelegramAttachments(input: {
	client: TelegramClient;
	store?: AttachmentStore;
	chatId: number;
	threadId?: number;
	replyTo?: number;
	attachments?: ReplyAttachment[];
	scope?: ScopedKey;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}): Promise<void> {
	if (!input.attachments?.length) return;
	const files = await resolveOutboundAttachments({
		provider: "telegram",
		store: input.store,
		attachments: input.attachments,
		scope: input.scope,
		logger: input.logger,
		context: input.context,
	});
	for (const file of files) {
		try {
			await input.delivery.run(
				() =>
					isTelegramImageMime(file.mimeType, file.name)
						? input.client.sendPhoto({
								chat_id: input.chatId,
								message_thread_id: input.threadId,
								reply_to_message_id: input.replyTo,
								photo: file,
							})
						: input.client.sendDocument({
								chat_id: input.chatId,
								message_thread_id: input.threadId,
								reply_to_message_id: input.replyTo,
								document: file,
							}),
				{ ...input.context, retry: "send" },
			);
		} catch (error) {
			input.logger.warn("telegram.attachment_upload_failed", { ...input.context, error: errorMessage(error) });
		}
	}
}

function startProgress(input: {
	client: TelegramClient;
	chatId: number;
	threadId?: number;
	replyTo: number;
	cancelId: string;
	progress?: TelegramProgress;
	isDm: boolean;
	allow?: TelegramAllow;
	approvalConfig?: ApprovalConfig;
	logger: Logger;
	context: Record<string, unknown>;
	delivery: DeliveryQueue;
}) {
	let active = true;
	let placeholder: number | undefined;
	let task: Promise<void> | undefined;
	let message = input.progress ? (input.progress.message ?? "Working...") : false;
	if (message) {
		task = new Promise((resolve) => {
			setTimeout(() => {
				if (!active) {
					resolve();
					return;
				}
				const progressText = message;
				if (progressText === false) {
					resolve();
					return;
				}
				input.delivery
					.run(
						() =>
							input.client.sendMessage({
								chat_id: input.chatId,
								message_thread_id: input.threadId,
								reply_to_message_id: input.replyTo,
								text: progressText,
								reply_markup: progressMarkup(input.cancelId),
							}),
						{ ...input.context, delivery: "progress", retry: "send" },
					)
					.then((out) => {
						placeholder = out.message_id;
					})
					.catch((error) => {
						input.logger.warn("telegram.progress.message_failed", {
							...input.context,
							error: errorMessage(error),
						});
					})
					.finally(resolve);
			}, input.progress?.delayMs ?? 750);
		});
	}
	return {
		async notify(text: string): Promise<void> {
			if (message === false) return;
			message = text;
			if (!placeholder) return;
			await input.delivery
				.run(
					() =>
						input.client.editMessageText({
							chat_id: input.chatId,
							message_id: placeholder as number,
							text,
							reply_markup: progressMarkup(input.cancelId),
						}),
					{ ...input.context, delivery: "progress_notify" },
				)
				.catch((error) => {
					input.logger.warn("telegram.progress.notify_failed", {
						...input.context,
						error: errorMessage(error),
					});
				});
		},
		async update(out: Outbound, parseMode?: TelegramParseMode): Promise<boolean> {
			active = false;
			await task;
			if (!placeholder) return false;
			const messageId = placeholder;
			placeholder = undefined;
			const mode = parseMode ?? "plain";
			const plan = telegramApprovalDisplayPlan({
				text: out.text,
				approval: out.approval,
				approvalResolution: out.approvalResolution,
				isDm: input.isDm,
			});
			try {
				await editTelegramText({
					client: input.client,
					chatId: input.chatId,
					messageId,
					chunk: firstFormattedChunk(plan.visibleText, plan.showMarkup, mode),
					replyMarkup: plan.showMarkup && out.approval ? approvalMarkup(out.approval) : emptyMarkup(),
					logger: input.logger,
					context: { ...input.context, delivery: "progress_update" },
					delivery: input.delivery,
				});
				if (plan.groupApproval && out.approval) {
					await dmTelegramApprovers({
						client: input.client,
						allow: input.allow,
						approvalConfig: input.approvalConfig,
						approval: out.approval,
						text: out.text,
						parseMode: mode,
						logger: input.logger,
						context: { ...input.context, delivery: "progress_update" },
						delivery: input.delivery,
					});
				}
				return true;
			} catch (error) {
				input.logger.warn("telegram.progress.update_failed", { ...input.context, error: errorMessage(error) });
				return false;
			}
		},
		async stop(): Promise<void> {
			active = false;
			await task;
			if (!placeholder) return;
			const messageId = placeholder;
			placeholder = undefined;
			await input.delivery
				.run(() => input.client.deleteMessage({ chat_id: input.chatId, message_id: messageId }), {
					...input.context,
					delivery: "progress_delete",
				})
				.catch((error) => {
					input.logger.warn("telegram.progress.delete_failed", { ...input.context, error: errorMessage(error) });
				});
		},
	};
}

async function telegramAttachments(input: {
	client: TelegramClient;
	store?: AttachmentStore;
	scope?: ScopedKey;
	message: TelegramMessage;
	provider: string;
	kind: string;
	messageId: string;
	trace: string;
	logger: Logger;
}): Promise<Attachment[] | undefined> {
	const files = filesOf(input.message);
	const maxBytes = input.store?.maxBytes;
	return await saveInboundAttachments({
		provider: input.provider,
		kind: input.kind,
		store: input.store,
		scope: input.scope,
		messageId: input.messageId,
		trace: input.trace,
		logItemField: "file",
		logger: input.logger,
		refs: files,
		download: async (file) => {
			const found = await input.client.getFile({ file_id: file.id });
			return await input.client.downloadFile(found.file_path, maxBytes);
		},
	});
}

function textOf(msg: TelegramMessage): string {
	return msg.text ?? msg.caption ?? "";
}

function threadKey(msg: TelegramMessage): string {
	return `${msg.chat.id}:${msg.message_thread_id ?? msg.chat.id}`;
}

function telegramDm(msg: TelegramMessage): boolean {
	return msg.chat.type === "private";
}

/** True for private Telegram chats (positive chat id). */
export function telegramDirectChat(chatId: number): boolean {
	return chatId > 0;
}

export function telegramApprovalDisplayPlan(input: {
	text: string;
	approval?: Outbound["approval"];
	approvalResolution?: Outbound["approvalResolution"];
	actor?: string;
	isDm: boolean;
}): { groupApproval: boolean; visibleText: string; showMarkup: boolean } {
	const groupApproval = Boolean(input.approval && !input.isDm);
	let visibleText: string;
	if (groupApproval) {
		visibleText = input.approvalResolution
			? redactedApprovalResolvedText(input.approvalResolution, input.actor)
			: redactedApprovalPendingText();
	} else {
		visibleText = telegramApprovalText(input.text, input.approval, input.approvalResolution, input.actor);
	}
	const showMarkup = Boolean(input.approval && input.isDm && !input.approvalResolution);
	return { groupApproval, visibleText, showMarkup };
}

export function telegramAllowed(
	allow: TelegramAllow | undefined,
	event: { chat: string; user: string; isDm: boolean },
): { ok: true } | { ok: false; reason: string } {
	return allowByDimensions({
		dms: allow?.dms,
		isDm: event.isDm,
		dmReason: "dm_not_allowed",
		dimensions: [
			{ allowlist: allow?.chats?.map(String), value: event.chat, reason: "chat_not_allowed", skip: event.isDm },
			{ allowlist: allow?.users?.map(String), value: event.user, reason: "user_not_allowed" },
		],
	});
}

export function telegramTriggered(
	trigger: TelegramTrigger | undefined,
	event: {
		text?: string;
		isDm: boolean;
		botUsername?: string;
		thread?: boolean;
		threadTrigger?: TelegramTrigger | false;
	},
): { ok: true } | { ok: false; reason: string } {
	return messageTriggered({
		trigger,
		isDm: event.isDm,
		thread: event.thread,
		threadTrigger: event.threadTrigger,
		mentioned: Boolean(event.botUsername && telegramMentions(event.text, event.botUsername)),
		text: event.text,
		reason: "mention_required",
	});
}

function telegramMentions(text = "", username: string): boolean {
	const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|\\s)@${escaped}\\b`, "i").test(text);
}

function stripTelegramMention(text: string, username?: string): string {
	if (!username) return text;
	const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text.replace(new RegExp(`(^|\\s)@${escaped}\\b`, "gi"), "$1").trim();
}

function actionText(action: TelegramAction): string {
	if (action.kind === "status") return "status";
	if (action.kind === "custom") return `callback ${action.token}`;
	return `${action.kind} ${action.id}`;
}

function telegramResolvedApprovalText(
	out: Outbound,
	state: Outbound["approvalResolution"],
	actor?: string,
	original?: string,
): string {
	if (out.approval && state) return telegramApprovalText(out.text, out.approval, state, actor);
	if (original) return [original, out.text].filter(Boolean).join("\n\n");
	return out.text;
}

function telegramVisibleResolvedText(
	out: Outbound,
	state: Outbound["approvalResolution"],
	actor?: string,
	original?: string,
	isDm = true,
): string {
	if (state && !isDm) return redactedApprovalResolvedText(state, actor);
	return telegramResolvedApprovalText(out, state, actor, original);
}

function firstFormattedChunk(text: string, hasMarkup: boolean, mode: TelegramParseMode = "plain"): TelegramTextChunk {
	const chunks = chunkTelegramFormattedText(text, hasMarkup && mode !== "plain" ? mode : "plain");
	return chunks[0] ?? { text: formatTelegramText(text, mode), parseMode: mode };
}

function telegramActor(user: TelegramUser): string {
	return user.username ? `@${user.username}` : `user ${user.id}`;
}

export function telegramChunks(text: string, hasMarkup = false): string[] {
	return chunkText(text, hasMarkup ? 3800 : TELEGRAM_TEXT_LIMIT);
}

export function telegramApprovalText(
	text: string,
	approval?: Outbound["approval"],
	state?: Outbound["approvalResolution"],
	actor?: string,
): string {
	if (!approval) return text;
	return [
		`*${approvalStateTitle(state)}*`,
		approval.reason ? ["Reason:", approval.reason].join("\n") : undefined,
		...(approval.details ?? []).map((detail) =>
			[`${detail.label}:`, detail.format === "code" ? codeFence(detail.value) : detail.value].join("\n"),
		),
		`Approval ID: ${approval.id}`,
		approval.requestedBy ? `Requested by: ${approval.requestedBy}` : undefined,
		state ? approvalStateLine(state, actor) : undefined,
	]
		.filter((line): line is string => typeof line === "string")
		.join("\n\n");
}

function progressMarkup(id: string): TelegramReplyMarkup {
	return {
		inline_keyboard: [
			[
				{ text: "Cancel", callback_data: `${CANCEL}:${id}` },
				{ text: "Status", callback_data: STATUS },
			],
		],
	};
}

function approvalMarkup(approval: NonNullable<Outbound["approval"]>): TelegramReplyMarkup {
	return {
		inline_keyboard: [
			[
				{ text: "Approve", callback_data: `${APPROVE}:${approval.id}` },
				{ text: "Reject", callback_data: `${DENY}:${approval.id}` },
			],
		],
	};
}

function emptyMarkup(): TelegramReplyMarkup {
	return { inline_keyboard: [] };
}

type TelegramAction =
	| { kind: "approve"; id: string }
	| { kind: "deny"; id: string }
	| { kind: "cancel"; id: string }
	| { kind: "status" }
	| { kind: "custom"; token: string };

export function parseTelegramCallback(input?: string): TelegramAction | undefined {
	if (!input) return undefined;
	if (input === STATUS) return { kind: "status" };
	if (!input.startsWith(`${HEYPI_PREFIX}:`)) return undefined;
	const rest = input.slice(HEYPI_PREFIX.length + 1);
	const index = rest.indexOf(":");
	if (index < 0) return undefined;
	const kind = rest.slice(0, index);
	const id = rest.slice(index + 1);
	if (!id) return undefined;
	if (kind === "approve" || kind === "deny" || kind === "cancel") return { kind, id };
	if (kind === "custom") return { kind: "custom", token: id };
	return undefined;
}

function normalizeTelegramReplyMarkup(
	markup: Record<string, unknown>,
	registry: Map<string, Record<string, unknown>>,
): TelegramReplyMarkup {
	const rows = markup.inline_keyboard;
	if (!Array.isArray(rows)) throw new Error("Telegram replyMarkup requires inline_keyboard");
	const inline_keyboard = rows.map((row) => {
		if (!Array.isArray(row)) throw new Error("Telegram inline_keyboard rows must be arrays");
		return row.map((button) => {
			if (!button || typeof button !== "object")
				throw new Error("Telegram inline keyboard button must be an object");
			const record = button as { text?: string; callback_data?: string };
			if (!record.text || !record.callback_data) {
				throw new Error("Telegram inline keyboard button requires text and callback_data");
			}
			if (record.callback_data.startsWith(`${HEYPI_PREFIX}:`) && !record.callback_data.startsWith(`${CUSTOM}:`)) {
				throw new Error(`Telegram callback_data uses reserved prefix: ${record.callback_data}`);
			}
			let callback_data = record.callback_data;
			const customToken = callback_data.startsWith(`${CUSTOM}:`);
			const heypiReserved = callback_data.startsWith(`${HEYPI_PREFIX}:`);
			if (!customToken && (callback_data.length > TELEGRAM_CALLBACK_DATA_LIMIT || !heypiReserved)) {
				const token = randomBytes(8).toString("hex");
				registerCallbackToken(registry, token, { callback_data });
				callback_data = `${CUSTOM}:${token}`;
			}
			return { text: record.text, callback_data };
		});
	});
	return { inline_keyboard };
}

function registerCallbackToken(
	registry: Map<string, Record<string, unknown>>,
	token: string,
	payload: Record<string, unknown>,
): void {
	while (registry.size >= CALLBACK_REGISTRY_MAX) {
		const oldest = registry.keys().next().value;
		if (oldest === undefined) break;
		registry.delete(oldest);
	}
	registry.set(token, payload);
}

function filesOf(msg: TelegramMessage): Array<{ id: string; name: string; mimeType?: string; size?: number }> {
	const out: Array<{ id: string; name: string; mimeType?: string; size?: number }> = [];
	if (msg.voice) {
		out.push({
			id: msg.voice.file_id,
			name: `${msg.voice.file_unique_id ?? msg.voice.file_id}.ogg`,
			mimeType: msg.voice.mime_type ?? "audio/ogg",
			size: msg.voice.file_size,
		});
	}
	if (msg.audio) {
		out.push({
			id: msg.audio.file_id,
			name: msg.audio.file_name ?? `${msg.audio.file_unique_id ?? msg.audio.file_id}.mp3`,
			mimeType: msg.audio.mime_type ?? "audio/mpeg",
			size: msg.audio.file_size,
		});
	}
	if (msg.document) {
		out.push({
			id: msg.document.file_id,
			name: msg.document.file_name ?? `${msg.document.file_id}.bin`,
			mimeType: msg.document.mime_type,
			size: msg.document.file_size,
		});
	}
	if (msg.photo?.length) {
		const photo = [...msg.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
		if (photo)
			out.push({
				id: photo.file_id,
				name: `${photo.file_unique_id ?? photo.file_id}.jpg`,
				mimeType: "image/jpeg",
				size: photo.file_size,
			});
	}
	return out;
}

function truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class TelegramClient {
	private readonly base: string;

	constructor(
		private readonly token: string,
		apiUrl?: TelegramConfig["apiUrl"],
	) {
		this.base = `${telegramApiUrl(apiUrl).replace(/\/+$/, "")}/bot${token}`;
	}

	async getUpdates(input: { offset: number; timeout: number; allowed_updates?: string[] }): Promise<TelegramUpdate[]> {
		const out = await this.call<{ result: TelegramUpdate[] }>("getUpdates", input);
		return out.result;
	}

	async setWebhook(input: { url: string; secret_token: string; allowed_updates: string[] }): Promise<void> {
		await this.call("setWebhook", input);
	}

	async deleteWebhook(): Promise<void> {
		await this.call("deleteWebhook", {});
	}

	async sendPoll(input: {
		chat_id: number;
		message_thread_id?: number;
		question: string;
		options: string[];
		is_anonymous?: boolean;
	}): Promise<void> {
		await this.call("sendPoll", compact(input));
	}

	async getMe(): Promise<TelegramUser> {
		const out = await this.call<{ result: TelegramUser }>("getMe", {});
		return out.result;
	}

	async sendMessage(input: TelegramSendMessage): Promise<TelegramMessage> {
		const out = await this.call<{ result: TelegramMessage }>("sendMessage", compact(input));
		return out.result;
	}

	async editMessageText(input: TelegramEditMessageText): Promise<void> {
		await this.call("editMessageText", compact(input));
	}

	async deleteMessage(input: { chat_id: number; message_id: number }): Promise<void> {
		await this.call("deleteMessage", input);
	}

	async answerCallbackQuery(input: TelegramAnswerCallbackQuery): Promise<void> {
		await this.call("answerCallbackQuery", compact(input));
	}

	async getFile(input: { file_id: string }): Promise<{ file_path: string }> {
		const out = await this.call<{ result: { file_path: string } }>("getFile", input);
		return out.result;
	}

	async downloadFile(path: string, maxBytes?: number): Promise<Uint8Array> {
		const url = `${this.baseFile}/${path}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
		return await responseBytes(response, maxBytes);
	}

	async sendDocument(input: {
		chat_id: number;
		message_thread_id?: number;
		reply_to_message_id?: number;
		document: ResolvedAttachment;
	}): Promise<void> {
		const form = new FormData();
		const data = await readFile(input.document.path);
		form.set("chat_id", String(input.chat_id));
		if (input.message_thread_id !== undefined) form.set("message_thread_id", String(input.message_thread_id));
		if (input.reply_to_message_id !== undefined) form.set("reply_to_message_id", String(input.reply_to_message_id));
		form.set("document", new Blob([data], { type: input.document.mimeType }), input.document.name);
		await this.callForm("sendDocument", form);
	}

	async sendPhoto(input: {
		chat_id: number;
		message_thread_id?: number;
		reply_to_message_id?: number;
		photo: ResolvedAttachment;
	}): Promise<void> {
		const form = new FormData();
		const data = await readFile(input.photo.path);
		form.set("chat_id", String(input.chat_id));
		if (input.message_thread_id !== undefined) form.set("message_thread_id", String(input.message_thread_id));
		if (input.reply_to_message_id !== undefined) form.set("reply_to_message_id", String(input.reply_to_message_id));
		form.set("photo", new Blob([data], { type: input.photo.mimeType }), input.photo.name);
		await this.callForm("sendPhoto", form);
	}

	private get baseFile(): string {
		const root = this.base.slice(0, this.base.indexOf(`/bot${this.token}`));
		return `${root}/file/bot${this.token}`;
	}

	private async call<T = unknown>(method: string, body: unknown): Promise<T> {
		const response = await fetch(`${this.base}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = (await response.json()) as TelegramResponse<T>;
		if (!response.ok || !parsed.ok) throw telegramError(parsed, response.status);
		return parsed as T;
	}

	private async callForm(method: string, body: FormData): Promise<void> {
		const response = await fetch(`${this.base}/${method}`, { method: "POST", body });
		const parsed = (await response.json()) as TelegramResponse<unknown>;
		if (!response.ok || !parsed.ok) throw telegramError(parsed, response.status);
	}
}

function telegramApiUrl(input?: TelegramConfig["apiUrl"]): string {
	if (input === undefined) return "https://api.telegram.org";
	if (typeof input === "object" && typeof input.override === "string") return input.override;
	throw new Error("Telegram apiUrl override must be explicit: { override: url }");
}

function telegramError(input: TelegramResponse<unknown>, status: number): Error {
	const error = new Error(input.description ?? `Telegram API failed: ${status}`) as Error & { retryAfter?: number };
	error.retryAfter = input.parameters?.retry_after;
	return error;
}

function compact<T extends Record<string, unknown>>(input: T): T {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
	return out as T;
}

type TelegramResponse<T> = T & { ok?: boolean; description?: string; parameters?: { retry_after?: number } };

type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
	my_chat_member?: TelegramChatMemberUpdate;
	chat_member?: TelegramChatMemberUpdate;
};

type TelegramChatMemberUpdate = {
	chat: { id: number; type?: string; title?: string };
	from?: TelegramUser;
	new_chat_member?: TelegramUser & { is_bot?: boolean };
	old_chat_member?: TelegramUser & { is_bot?: boolean };
};

type TelegramCallbackQuery = {
	id: string;
	from: TelegramUser;
	data?: string;
	message?: TelegramMessage;
};

type TelegramUser = {
	id: number;
	is_bot?: boolean;
	username?: string;
	first_name?: string;
};

type TelegramMessage = {
	message_id: number;
	message_thread_id?: number;
	from?: TelegramUser;
	chat: { id: number; type?: string; title?: string; username?: string; first_name?: string };
	text?: string;
	caption?: string;
	voice?: {
		file_id: string;
		file_unique_id?: string;
		mime_type?: string;
		file_size?: number;
		duration?: number;
	};
	audio?: {
		file_id: string;
		file_unique_id?: string;
		file_name?: string;
		mime_type?: string;
		file_size?: number;
		duration?: number;
	};
	document?: {
		file_id: string;
		file_name?: string;
		mime_type?: string;
		file_size?: number;
	};
	photo?: Array<{
		file_id: string;
		file_unique_id?: string;
		file_size?: number;
	}>;
	sticker?: { file_id: string };
	location?: { latitude: number; longitude: number };
};

function telegramUserName(user: TelegramUser | undefined): string | undefined {
	if (!user) return undefined;
	return user.username ? `@${user.username}` : user.first_name;
}

function telegramChatName(chat: TelegramMessage["chat"]): string | undefined {
	return chat.title ?? (chat.username ? `@${chat.username}` : chat.first_name);
}

type TelegramReplyMarkup = {
	inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type TelegramSendMessage = {
	chat_id: number;
	message_thread_id?: number;
	reply_to_message_id?: number;
	text: string;
	parse_mode?: string;
	reply_markup?: TelegramReplyMarkup;
};

type TelegramEditMessageText = {
	chat_id: number;
	message_id: number;
	text: string;
	parse_mode?: string;
	reply_markup?: TelegramReplyMarkup;
};

type TelegramAnswerCallbackQuery = {
	callback_query_id: string;
	text?: string;
	show_alert?: boolean;
};

export { deliverTelegramAttachments as telegramDeliverAttachments };
