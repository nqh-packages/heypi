import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Logger } from "../src/core/log.js";
import type { AppMessages } from "../src/core/messages.js";
import type { AttachmentStore } from "../src/io/attachments.js";
import { DeliveryQueue } from "../src/io/delivery.js";
import { BoundedQueue } from "../src/io/stt/queue.js";
import {
	handleTelegramCallback,
	handleTelegramUpdate,
	resolveTelegramSttAudioPath,
	sttEnabled,
	sttUnavailableUserMessage,
	TELEGRAM_STT_BUSY_MESSAGE,
	TELEGRAM_STT_DISABLED_MESSAGE,
	telegramDeliverAttachments,
} from "../src/io/telegram.js";

const testMessages = { error: "error" } as AppMessages;

const noopLogger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

function voiceMessage(input?: { chatId?: number; messageId?: number }) {
	const chatId = input?.chatId ?? -1001;
	const messageId = input?.messageId ?? 1;
	return {
		message_id: messageId,
		from: { id: 42, is_bot: false },
		chat: { id: chatId, type: "supergroup" as const },
		voice: {
			file_id: "voice-file",
			file_unique_id: "voice-unique",
			mime_type: "audio/ogg",
			file_size: 128,
		},
	};
}

function createSttState(maxPending = 32) {
	return {
		queue: new BoundedQueue({ maxConcurrent: 2, maxPerChat: 1, maxPending }),
		generations: new Map<string, number>(),
		abortControllers: new Map<string, AbortController>(),
	};
}

function telegramHarnessExtras(sttState = createSttState()) {
	return {
		sttState,
		moderationState: {
			flood: new Map<string, number[]>(),
			spam: new Map<string, { text: string; mentions: number; count: number }>(),
		},
		callbackRegistry: new Map<string, Record<string, unknown>>(),
	};
}

function mockClient(calls: { sent?: string[]; photos?: number; documents?: number }) {
	return {
		sendMessage: async (input: { text: string }) => {
			calls.sent?.push(input.text);
			return { message_id: 99 };
		},
		editMessageText: async () => undefined,
		deleteMessage: async () => undefined,
		answerCallbackQuery: async () => undefined,
		getFile: async () => ({ file_path: "voice.ogg" }),
		downloadFile: async () => new TextEncoder().encode("audio-bytes"),
		sendPhoto: async () => {
			calls.photos = (calls.photos ?? 0) + 1;
		},
		sendDocument: async () => {
			calls.documents = (calls.documents ?? 0) + 1;
		},
	} as never;
}

function voiceAttachmentStore(root: string): AttachmentStore {
	return {
		async save(input) {
			const path = join(root, input.name);
			await writeFile(path, input.data);
			return { name: input.name, path, size: input.data.byteLength };
		},
		async resolve(input) {
			return { path: input.path, name: input.name ?? "voice.ogg", size: 1 };
		},
	};
}

async function writeExecutable(path: string): Promise<void> {
	await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
	await chmod(path, 0o755);
}

test("sttEnabled requires explicit opt-in", () => {
	assert.equal(sttEnabled(undefined), false);
	assert.equal(sttEnabled(false), false);
	assert.equal(sttEnabled(true), true);
	assert.equal(sttEnabled({ enabled: true }), true);
	assert.equal(sttEnabled({ enabled: false }), false);
});

test("voice with stt disabled sends concise reply and skips handler", async () => {
	const sent: string[] = [];
	let handlerCalls = 0;
	await handleTelegramUpdate({
		client: mockClient({ sent }),
		start: {
			handler: async () => {
				handlerCalls += 1;
				return { text: "nope" };
			},
			logger: noopLogger,
			messages: testMessages,
		},
		config: { token: "t", trigger: "mention", stt: { enabled: false } },
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 1, message: voiceMessage() },
		stopped: () => false,
		...telegramHarnessExtras(),
	});
	assert.equal(handlerCalls, 0);
	assert.deepEqual(sent, [TELEGRAM_STT_DISABLED_MESSAGE]);
});

test("voice with stt enabled transcribes and invokes handler", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-telegram-stt-"));
	const modelPath = join(root, "model.bin");
	const ffmpegPath = join(root, "ffmpeg");
	const whisperPath = join(root, "whisper");
	await writeFile(modelPath, Buffer.from("model"));
	await writeExecutable(ffmpegPath);
	await writeExecutable(whisperPath);
	const store: AttachmentStore = {
		async save(input) {
			const path = join(root, input.name);
			await writeFile(path, input.data);
			return { name: input.name, path, size: input.data.byteLength };
		},
		async resolve(input) {
			return { path: input.path, name: input.name ?? "voice.ogg", size: 1 };
		},
	};
	let inboundText = "";
	await handleTelegramUpdate({
		client: mockClient({}),
		start: {
			handler: async (input) => {
				inboundText = input.text;
				return { text: "ack" };
			},
			logger: noopLogger,
			attachments: store,
			messages: testMessages,
		},
		config: {
			token: "t",
			trigger: "mention",
			progress: false as const,
			stt: { enabled: true, local: { modelPath, ffmpeg: ffmpegPath, binary: whisperPath } },
			sttRunner: async (file, args) => {
				if (file.endsWith("ffmpeg")) return { stdout: "", stderr: "", code: 0 };
				if (file.endsWith("whisper")) {
					const ofIndex = args.indexOf("-of");
					const outputBase = ofIndex >= 0 ? args[ofIndex + 1] : join(root, "out");
					if (outputBase) await writeFile(`${outputBase}.txt`, "status report", "utf8");
					return { stdout: "", stderr: "", code: 0 };
				}
				return { stdout: "", stderr: "", code: 1 };
			},
		},
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 2, message: voiceMessage({ messageId: 2 }) },
		stopped: () => false,
		...telegramHarnessExtras(),
	});
	for (let attempt = 0; attempt < 50 && !inboundText; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.equal(inboundText, "status report");
});

test("voice STT resolves runtime-relative attachment paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-telegram-stt-runtime-"));
	const runtimeRoot = join(root, "runtime");
	const modelPath = join(root, "model.bin");
	const ffmpegPath = join(root, "ffmpeg");
	const whisperPath = join(root, "whisper");
	await writeFile(modelPath, Buffer.from("model"));
	await writeExecutable(ffmpegPath);
	await writeExecutable(whisperPath);
	const relativeVoicePath = join("attachments", "incoming", "telegram", "2", "voice-unique.ogg");
	const stateRoot = join(root, "state");
	const voiceFullPath = join(stateRoot, relativeVoicePath);
	await mkdir(dirname(voiceFullPath), { recursive: true });
	await writeFile(voiceFullPath, Buffer.from("audio-bytes"));
	const store: AttachmentStore = {
		async save(input) {
			return { name: input.name, path: relativeVoicePath, size: input.data.byteLength };
		},
		async resolve(input) {
			return { path: input.path, name: input.name ?? "voice.ogg", size: 1 };
		},
	};
	let inboundText = "";
	await handleTelegramUpdate({
		client: mockClient({}),
		start: {
			handler: async (input) => {
				inboundText = input.text;
				return { text: "ack" };
			},
			logger: noopLogger,
			attachments: store,
			messages: testMessages,
			app: {
				agent: "agent",
				runtime: { name: "guarded-bash", root: runtimeRoot },
				state: { root: stateRoot },
				attachments: { root: stateRoot },
				memory: { enabled: false, scope: "agent", writePolicy: "off", maxChars: 4000 },
				adapters: [{ name: "telegram", kind: "telegram" }],
				startedAt: Date.now(),
			},
		},
		config: {
			token: "t",
			trigger: "mention",
			progress: false as const,
			stt: { enabled: true, local: { modelPath, ffmpeg: ffmpegPath, binary: whisperPath } },
			sttRunner: async (file, args) => {
				if (file.endsWith("ffmpeg")) return { stdout: "", stderr: "", code: 0 };
				if (file.endsWith("whisper")) {
					const ofIndex = args.indexOf("-of");
					const outputBase = ofIndex >= 0 ? args[ofIndex + 1] : join(root, "out");
					if (outputBase) await writeFile(`${outputBase}.txt`, "runtime voice ok", "utf8");
					return { stdout: "", stderr: "", code: 0 };
				}
				return { stdout: "", stderr: "", code: 1 };
			},
		},
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 20, message: voiceMessage({ messageId: 2 }) },
		stopped: () => false,
		...telegramHarnessExtras(),
	});
	for (let attempt = 0; attempt < 50 && !inboundText; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.equal(inboundText, "runtime voice ok");
});

test("resolveTelegramSttAudioPath maps inbound attachment paths to storage root", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-telegram-stt-resolve-"));
	const storageRoot = join(root, "state");
	const runtimeRoot = join(root, "runtime");
	const relative = join("attachments", "incoming", "telegram", "1", "voice.ogg");
	const full = join(storageRoot, relative);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, Buffer.from("voice"));
	const roots = { storage: storageRoot, runtime: runtimeRoot };
	const resolved = await resolveTelegramSttAudioPath(relative, roots);
	assert.ok(resolved?.endsWith("attachments/incoming/telegram/1/voice.ogg"));
	assert.equal(await resolveTelegramSttAudioPath(`/attachments/incoming/telegram/1/voice.ogg`, roots), resolved);
});

test("missing STT prerequisites send AE4 message without handler", async () => {
	const sent: string[] = [];
	let handlerCalls = 0;
	const store: AttachmentStore = {
		async save(input) {
			const path = join(tmpdir(), input.name);
			await writeFile(path, input.data);
			return { name: input.name, path, size: input.data.byteLength };
		},
		async resolve(input) {
			return { path: input.path, name: input.name ?? "voice.ogg", size: 1 };
		},
	};
	await handleTelegramUpdate({
		client: mockClient({ sent }),
		start: {
			handler: async () => {
				handlerCalls += 1;
				return { text: "nope" };
			},
			logger: noopLogger,
			attachments: store,
			messages: testMessages,
		},
		config: {
			token: "t",
			trigger: "mention",
			stt: { enabled: true, local: { modelPath: "/missing/model.bin", ffmpeg: "/missing/ffmpeg" } },
		},
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 3, message: voiceMessage({ messageId: 3 }) },
		stopped: () => false,
		...telegramHarnessExtras(),
	});
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(handlerCalls, 0);
	assert.equal(sent.length, 1);
	assert.match(sent[0] ?? "", /Voice transcription is unavailable/);
	assert.match(sent[0] ?? "", /model file is missing/);
});

test("callback is processed while STT job is still queued", async () => {
	const sttState = createSttState();
	let releaseStt: (() => void) | undefined;
	const sttGate = new Promise<void>((resolve) => {
		releaseStt = resolve;
	});
	let callbackHandled = false;
	const client = mockClient({});
	await handleTelegramUpdate({
		client,
		start: {
			handler: async () => ({ text: "never" }),
			logger: noopLogger,
			messages: testMessages,
		},
		config: {
			token: "t",
			trigger: "mention",
			stt: { enabled: true, local: { modelPath: "/tmp/model.bin" } },
			sttRunner: async () => {
				await sttGate;
				return { stdout: "", stderr: "", code: 0 };
			},
		},
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 4, message: voiceMessage({ messageId: 4 }) },
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	await handleTelegramCallback({
		client,
		handler: async () => {
			callbackHandled = true;
			return undefined;
		},
		logger: noopLogger,
		callback: {
			id: "cb-1",
			from: { id: 42 },
			data: "heypi:status",
			message: { message_id: 10, chat: { id: -1001, type: "supergroup" } },
		},
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		callbackRegistry: new Map(),
	});
	assert.equal(callbackHandled, true);
	releaseStt?.();
});

test("superseded voice STT job does not invoke handler twice", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-telegram-stt-super-"));
	const modelPath = join(root, "model.bin");
	const ffmpegPath = join(root, "ffmpeg");
	const whisperPath = join(root, "whisper");
	await writeFile(modelPath, Buffer.from("model"));
	await writeExecutable(ffmpegPath);
	await writeExecutable(whisperPath);
	const store: AttachmentStore = {
		async save(input) {
			const path = join(root, input.name);
			await writeFile(path, input.data);
			return { name: input.name, path, size: input.data.byteLength };
		},
		async resolve(input) {
			return { path: input.path, name: input.name ?? "voice.ogg", size: 1 };
		},
	};
	let handlerCalls = 0;
	let releaseFirst: (() => void) | undefined;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const blocked = true;
	const sttState = createSttState();
	const sharedConfig = {
		token: "t",
		trigger: "mention" as const,
		progress: false as const,
		stt: { enabled: true, local: { modelPath, ffmpeg: ffmpegPath, binary: whisperPath } },
		sttRunner: async (file: string, args: string[]) => {
			if (file.endsWith("ffmpeg")) {
				if (blocked) await firstGate;
				return { stdout: "", stderr: "", code: 0 };
			}
			if (file.endsWith("whisper")) {
				const ofIndex = args.indexOf("-of");
				const outputBase = ofIndex >= 0 ? args[ofIndex + 1] : join(root, "out");
				if (outputBase) await writeFile(`${outputBase}.txt`, "old voice", "utf8");
				return { stdout: "", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 1 };
		},
	};
	const start = {
		handler: async () => {
			handlerCalls += 1;
			return { text: "ok" };
		},
		logger: noopLogger,
		attachments: store,
		messages: testMessages,
	};
	const client = mockClient({});
	void handleTelegramUpdate({
		client,
		start,
		config: sharedConfig,
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 5, message: voiceMessage({ messageId: 5 }) },
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	await handleTelegramUpdate({
		client,
		start,
		config: { ...sharedConfig, trigger: "message" },
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: {
			update_id: 6,
			message: {
				message_id: 6,
				from: { id: 42, is_bot: false },
				chat: { id: -1001, type: "supergroup" },
				text: "newer text",
			},
		},
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	releaseFirst?.();
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(handlerCalls, 1);
});

test("full STT pending queue returns busy message", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-telegram-stt-busy-"));
	const modelPath = join(root, "model.bin");
	const ffmpegPath = join(root, "ffmpeg");
	const whisperPath = join(root, "whisper");
	await writeFile(modelPath, Buffer.from("model"));
	await writeExecutable(ffmpegPath);
	await writeExecutable(whisperPath);
	const sttState = createSttState(1);
	sttState.queue = new BoundedQueue({ maxConcurrent: 1, maxPerChat: 1, maxPending: 1 });
	const never = new Promise<void>(() => undefined);
	const shared = {
		token: "t",
		trigger: "mention" as const,
		stt: { enabled: true, local: { modelPath, ffmpeg: ffmpegPath, binary: whisperPath } },
		sttRunner: async () => {
			await never;
			return { stdout: "", stderr: "", code: 0 };
		},
	};
	const start = {
		handler: async () => ({ text: "nope" }),
		logger: noopLogger,
		attachments: voiceAttachmentStore(root),
		messages: testMessages,
	};
	void handleTelegramUpdate({
		client: mockClient({}),
		start,
		config: shared,
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 7, message: voiceMessage({ messageId: 7, chatId: -1002 }) },
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	void handleTelegramUpdate({
		client: mockClient({}),
		start,
		config: shared,
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 8, message: voiceMessage({ messageId: 8, chatId: -1003 }) },
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	const sent: string[] = [];
	await handleTelegramUpdate({
		client: mockClient({ sent }),
		start,
		config: shared,
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		update: { update_id: 9, message: voiceMessage({ messageId: 9, chatId: -1004 }) },
		stopped: () => false,
		...telegramHarnessExtras(sttState),
	});
	assert.deepEqual(sent, [TELEGRAM_STT_BUSY_MESSAGE]);
});

test("telegramDeliverAttachments uses sendPhoto for images and sendDocument otherwise", async () => {
	const calls = { photos: 0, documents: 0 };
	const store: AttachmentStore = {
		async save() {
			throw new Error("unused");
		},
		async resolve(input) {
			return {
				path: input.path,
				name: input.path,
				size: 10,
				mimeType: input.path.includes("png") ? "image/png" : "application/pdf",
			};
		},
	};
	await telegramDeliverAttachments({
		client: mockClient(calls),
		store,
		chatId: 1,
		attachments: [{ path: "photo.png" }, { path: "doc.pdf" }],
		logger: noopLogger,
		context: {},
		delivery: new DeliveryQueue(false),
	});
	assert.equal(calls.photos, 1);
	assert.equal(calls.documents, 1);
});

test("sttUnavailableUserMessage includes reason", () => {
	assert.match(sttUnavailableUserMessage("ffmpeg is not installed"), /ffmpeg is not installed/);
});
