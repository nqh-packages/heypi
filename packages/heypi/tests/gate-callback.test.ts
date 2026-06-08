import assert from "node:assert/strict";
import { test } from "node:test";
import type { Logger } from "../src/core/log.js";
import { DeliveryQueue } from "../src/io/delivery.js";
import { handleDiscordInteraction } from "../src/io/discord.js";
import { inboundAllowed } from "../src/io/gate.js";
import type { Handler } from "../src/io/handler.js";
import { handleSlackAction, slackAllowed } from "../src/io/slack.js";
import { handleTelegramCallback, telegramAllowed } from "../src/io/telegram.js";

const noopLogger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

function telegramCallbackFixture(input?: { userId?: number; chatId?: number; isDm?: boolean }) {
	const chatId = input?.chatId ?? -1001;
	const userId = input?.userId ?? 42;
	return {
		id: "cb-1",
		from: { id: userId, is_bot: false },
		data: "heypi:approve:approval-1",
		message: {
			message_id: 10,
			chat: { id: chatId, type: input?.isDm ? "private" : "supergroup" },
		},
	};
}

test("inboundAllowed applies Telegram callback allow matrix", () => {
	const check = (ctx: { channel: string; actor: string; isDm: boolean }) =>
		telegramAllowed({ users: [43] }, { chat: ctx.channel, user: ctx.actor, isDm: ctx.isDm });
	assert.deepEqual(inboundAllowed(check, { channel: "-1001", actor: "42", isDm: false }), {
		ok: false,
		reason: "user_not_allowed",
	});
	assert.deepEqual(inboundAllowed(check, { channel: "-1001", actor: "43", isDm: false }), { ok: true });
	assert.deepEqual(
		inboundAllowed((ctx) => telegramAllowed({ dms: false }, { chat: ctx.channel, user: ctx.actor, isDm: ctx.isDm }), {
			channel: "42",
			actor: "43",
			isDm: true,
		}),
		{ ok: false, reason: "dm_not_allowed" },
	);
});

test("inboundAllowed applies Slack groups-only allow on actions", () => {
	const check = (ctx: { channel: string; actor: string; isDm: boolean; groups?: string[] }) =>
		slackAllowed({ groups: ["S1"] }, { channel: ctx.channel, user: ctx.actor, groups: ctx.groups, isDm: ctx.isDm });
	assert.deepEqual(inboundAllowed(check, { channel: "C1", actor: "U1", isDm: false, groups: ["S1"] }), { ok: true });
	assert.deepEqual(inboundAllowed(check, { channel: "C1", actor: "U1", isDm: false, groups: ["S2"] }), {
		ok: false,
		reason: "actor_not_allowed",
	});
});

test("handleTelegramCallback denies disallowed actor before handler runs", async () => {
	const answers: Array<Record<string, unknown>> = [];
	let handlerCalls = 0;
	const handler: Handler = async () => {
		handlerCalls += 1;
		return { text: "should not run" };
	};
	const client = {
		answerCallbackQuery: async (input: Record<string, unknown>) => {
			answers.push(input);
		},
		editMessageText: async () => undefined,
		sendMessage: async () => ({ message_id: 1 }),
	} as never;
	await handleTelegramCallback({
		client,
		handler,
		logger: noopLogger,
		callback: telegramCallbackFixture({ userId: 42 }),
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		allow: { users: [99] },
		callbackRegistry: new Map(),
	});
	assert.equal(handlerCalls, 0);
	assert.equal(answers.length, 1);
	assert.match(String(answers[0]?.text), /Not allowed/);
});

test("handleTelegramCallback invokes handler for allowlisted actor", async () => {
	let handlerCalls = 0;
	const handler: Handler = async () => {
		handlerCalls += 1;
		return undefined;
	};
	const client = {
		answerCallbackQuery: async () => undefined,
		editMessageText: async () => undefined,
		sendMessage: async () => ({ message_id: 1 }),
	} as never;
	await handleTelegramCallback({
		client,
		handler,
		logger: noopLogger,
		callback: telegramCallbackFixture({ userId: 42 }),
		delivery: new DeliveryQueue(false),
		provider: "telegram",
		kind: "telegram",
		allow: { users: [42] },
		callbackRegistry: new Map(),
	});
	assert.equal(handlerCalls, 1);
});

test("handleSlackAction denies disallowed actor with ephemeral response", async () => {
	let handlerCalls = 0;
	const ephemerals: Array<Record<string, unknown>> = [];
	const handler: Handler = async () => {
		handlerCalls += 1;
		return { text: "nope" };
	};
	const client = {
		chat: {
			postEphemeral: async (input: Record<string, unknown>) => {
				ephemerals.push(input);
			},
			update: async () => ({ ok: true }),
		},
	} as never;
	const groups = { forUser: async () => [] as string[] } as never;
	await handleSlackAction({
		kind: "approve",
		body: {
			channel: { id: "C1", type: "channel" },
			user: { id: "U1" },
			message: { ts: "1.0", thread_ts: "1.0" },
		},
		action: { value: "approval-1" },
		client,
		handler,
		logger: noopLogger,
		delivery: new DeliveryQueue(false),
		provider: "slack",
		adapterKind: "slack",
		groups,
		allow: { users: ["U2"] },
	});
	assert.equal(handlerCalls, 0);
	assert.equal(ephemerals.length, 1);
	assert.match(String(ephemerals[0]?.text), /Not allowed/);
});

test("handleDiscordInteraction denies disallowed actor before handler runs", async () => {
	let handlerCalls = 0;
	const replies: Array<Record<string, unknown>> = [];
	const interaction = {
		isButton: () => true,
		customId: "heypi_approve:approval-1",
		id: "int-1",
		channelId: "C1",
		guildId: "G1",
		user: { id: "U1" },
		channel: { type: 1 },
		deferUpdate: async () => undefined,
		editReply: async () => undefined,
		followUp: async () => undefined,
		reply: async (input: Record<string, unknown>) => {
			replies.push(input);
		},
		message: { id: "m1" },
	} as never;
	await handleDiscordInteraction({
		start: {
			handler: async () => {
				handlerCalls += 1;
				return undefined;
			},
			logger: noopLogger,
		},
		delivery: new DeliveryQueue(false),
		provider: "discord",
		kind: "discord",
		groups: { forInteraction: async () => [] as string[] } as never,
		interaction,
		allow: { users: ["U2"] },
	});
	assert.equal(handlerCalls, 0);
	assert.equal(replies.length, 1);
	assert.match(String(replies[0]?.content), /Not allowed/);
});
