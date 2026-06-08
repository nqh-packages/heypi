import assert from "node:assert/strict";
import { test } from "node:test";
import type { Logger } from "../src/core/log.js";
import { createHttpServerRegistry } from "../src/io/http.js";
import {
	registerTelegramWebhook,
	resolveTelegramIngressMode,
	resolveTelegramWebhookSecret,
	TelegramUpdateDedupe,
	telegramAllowedUpdates,
	telegramWebhookAuthorized,
} from "../src/io/telegram-webhook.js";

const logger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

test("resolveTelegramIngressMode defaults to poll", () => {
	assert.equal(resolveTelegramIngressMode(), "poll");
	assert.equal(resolveTelegramIngressMode("webhook"), "webhook");
});

test("resolveTelegramWebhookSecret enforces minimum length", () => {
	assert.throws(() => resolveTelegramWebhookSecret({ secret: "short" }), /32 bytes/);
	const secret = "x".repeat(32);
	assert.equal(resolveTelegramWebhookSecret({ secret }), secret);
});

test("telegramWebhookAuthorized uses timing-safe secret compare", () => {
	const secret = "x".repeat(32);
	assert.equal(
		telegramWebhookAuthorized({ headers: { "x-telegram-bot-api-secret-token": secret } } as never, secret),
		true,
	);
	assert.equal(
		telegramWebhookAuthorized({ headers: { "x-telegram-bot-api-secret-token": `${secret}nope` } } as never, secret),
		false,
	);
});

test("telegramAllowedUpdates includes optional member and edited types", () => {
	assert.deepEqual(telegramAllowedUpdates(undefined), ["message", "callback_query"]);
	assert.deepEqual(telegramAllowedUpdates({ welcome: true }), [
		"message",
		"callback_query",
		"my_chat_member",
		"chat_member",
	]);
	assert.deepEqual(telegramAllowedUpdates({ editedMessages: "rerun" }), [
		"message",
		"callback_query",
		"edited_message",
	]);
});

test("TelegramUpdateDedupe drops duplicate update ids within ttl", () => {
	const dedupe = new TelegramUpdateDedupe();
	assert.equal(dedupe.check(1, 0), true);
	assert.equal(dedupe.check(1, 1000), false);
	assert.equal(dedupe.check(2, 1000), true);
});

test("telegram webhook handler awaits onUpdate before responding", async () => {
	const secret = "x".repeat(32);
	const registry = createHttpServerRegistry({ logger, listen: { host: "127.0.0.1", port: 0 } });
	let processed = false;
	registerTelegramWebhook({
		start: {
			logger,
			http: registry,
			handler: async () => undefined,
		},
		name: "test",
		secret,
		logger,
		onUpdate: async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
			processed = true;
		},
	});
	await registry.listen();
	try {
		const address = registry.address();
		if (!address) throw new Error("registry is not listening");
		const url = `http://${address.host}:${address.port}/telegram/test`;
		const body = JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: "hi" } });
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-telegram-bot-api-secret-token": secret,
			},
			body,
		});
		assert.equal(response.status, 200);
		assert.equal(processed, true);
	} finally {
		await registry.close();
	}
});
