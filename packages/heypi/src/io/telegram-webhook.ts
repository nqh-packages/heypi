import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../core/log.js";
import type { AdapterStart } from "./handler.js";
import type { TelegramGroupAutomationConfig } from "./telegram-moderation.js";

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEDUPE_TTL_MS = 5 * 60_000;

export type TelegramWebhookSettings = {
	url: string;
	secret?: string;
	path?: string;
	maxBodyBytes?: number;
};

/** Resolves webhook secret from config or env; requires at least 32 bytes. */
export function resolveTelegramWebhookSecret(input?: { secret?: string; env?: NodeJS.ProcessEnv }): string {
	const env = input?.env ?? process.env;
	const secret = input?.secret?.trim() || env.HEYPI_TELEGRAM_WEBHOOK_SECRET?.trim();
	if (!secret) throw new Error("Telegram webhook mode requires HEYPI_TELEGRAM_WEBHOOK_SECRET or webhook.secret");
	if (Buffer.byteLength(secret, "utf8") < 32) {
		throw new Error("Telegram webhook secret must be at least 32 bytes");
	}
	return secret;
}

export function telegramWebhookAuthorized(req: IncomingMessage, secret: string): boolean {
	const header = req.headers["x-telegram-bot-api-secret-token"];
	const value = Array.isArray(header) ? header[0] : header;
	return typeof value === "string" && safeEqual(value, secret);
}

export function telegramAllowedUpdates(groupAutomation?: TelegramGroupAutomationConfig): string[] {
	const updates = ["message", "callback_query"];
	if (groupAutomation?.welcome) updates.push("my_chat_member", "chat_member");
	if (groupAutomation?.editedMessages && groupAutomation.editedMessages !== "ignore") {
		updates.push("edited_message");
	}
	return updates;
}

export class TelegramUpdateDedupe {
	private readonly seen = new Map<number, number>();

	check(updateId: number, now = Date.now()): boolean {
		this.prune(now);
		if (this.seen.has(updateId)) return false;
		this.seen.set(updateId, now);
		return true;
	}

	private prune(now: number): void {
		for (const [id, at] of this.seen) {
			if (now - at > DEDUPE_TTL_MS) this.seen.delete(id);
		}
	}
}

export function registerTelegramWebhook(input: {
	start: AdapterStart;
	name: string;
	path?: string;
	secret: string;
	maxBodyBytes?: number;
	logger: Logger;
	onUpdate: (update: TelegramWebhookUpdate) => Promise<void>;
}): void {
	if (!input.start.http) throw new Error("Telegram webhook mode requires shared HTTP registrar");
	const routePath = normalizePath(input.path ?? `/telegram/${input.name}`);
	const maxBodyBytes = input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	input.start.http.register({
		method: "POST",
		path: routePath,
		reserved: true,
		handler: async (req, res) => {
			try {
				if (!telegramWebhookAuthorized(req, input.secret)) {
					json(res, 401, { ok: false });
					return;
				}
				const update = await readTelegramWebhookBody(req, maxBodyBytes);
				try {
					await input.onUpdate(update);
				} catch (error: unknown) {
					input.logger.warn("telegram.webhook_update_failed", {
						adapter: input.name,
						kind: "telegram",
						error: error instanceof Error ? error.message : String(error),
					});
				}
				json(res, 200, { ok: true });
			} catch (error) {
				const status = error instanceof TelegramWebhookHttpError ? error.status : 500;
				const message = error instanceof Error ? error.message : "webhook failed";
				input.logger.warn("telegram.webhook_request_failed", {
					adapter: input.name,
					kind: "telegram",
					status,
					error: message,
				});
				json(res, status, { ok: false, error: message });
			}
		},
	});
	input.logger.info("telegram.webhook.registered", {
		adapter: input.name,
		kind: "telegram",
		path: routePath,
	});
}

export type TelegramWebhookUpdate = {
	update_id: number;
	message?: TelegramWebhookMessage;
	edited_message?: TelegramWebhookMessage;
	callback_query?: TelegramWebhookCallbackQuery;
	my_chat_member?: TelegramWebhookChatMember;
	chat_member?: TelegramWebhookChatMember;
};

type TelegramWebhookMessage = {
	message_id: number;
	message_thread_id?: number;
	from?: { id: number; is_bot?: boolean; username?: string; first_name?: string };
	chat: { id: number; type?: string; title?: string; username?: string; first_name?: string };
	text?: string;
	caption?: string;
	sticker?: { file_id: string };
	location?: { latitude: number; longitude: number };
	voice?: { file_id: string; file_unique_id?: string; mime_type?: string; file_size?: number };
	audio?: {
		file_id: string;
		file_unique_id?: string;
		file_name?: string;
		mime_type?: string;
		file_size?: number;
	};
	document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
	photo?: Array<{ file_id: string; file_unique_id?: string; file_size?: number }>;
};

type TelegramWebhookCallbackQuery = {
	id: string;
	from: { id: number; username?: string; first_name?: string };
	data?: string;
	message?: TelegramWebhookMessage;
};

type TelegramWebhookChatMember = {
	chat: { id: number; type?: string; title?: string };
	from?: { id: number };
	new_chat_member?: { id: number; is_bot?: boolean; username?: string };
	old_chat_member?: { id: number; is_bot?: boolean };
};

export function resolveTelegramIngressMode(mode?: "poll" | "webhook"): "poll" | "webhook" {
	return mode ?? "poll";
}

export function resolveTelegramWebhookUrl(input?: { url?: string; env?: NodeJS.ProcessEnv }): string | undefined {
	const env = input?.env ?? process.env;
	return input?.url?.trim() || env.HEYPI_TELEGRAM_WEBHOOK_URL?.trim() || undefined;
}

async function readTelegramWebhookBody(req: IncomingMessage, maxBytes: number): Promise<TelegramWebhookUpdate> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += next.byteLength;
		if (total > maxBytes) throw new TelegramWebhookHttpError(413, "body too large");
		chunks.push(next);
	}
	if (!chunks.length) throw new TelegramWebhookHttpError(400, "empty body");
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		throw new TelegramWebhookHttpError(400, "invalid json body");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new TelegramWebhookHttpError(400, "body must be an object");
	}
	const update = parsed as TelegramWebhookUpdate;
	if (typeof update.update_id !== "number") throw new TelegramWebhookHttpError(400, "update_id required");
	return update;
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function normalizePath(path: string): string {
	const value = `/${path.trim().replace(/^\/+|\/+$/g, "")}`;
	return value === "/" ? "" : value;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

class TelegramWebhookHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
