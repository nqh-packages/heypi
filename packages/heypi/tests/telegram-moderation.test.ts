import assert from "node:assert/strict";
import { test } from "node:test";
import {
	editedMessagesMode,
	floodDrop,
	linkDrop,
	shouldSendWelcome,
	spamDrop,
	telegramStickerOnly,
	welcomeTemplate,
} from "../src/io/telegram-moderation.js";

test("empty groupAutomation config has no moderation behavior", () => {
	const flood = new Map<string, number[]>();
	const spam = new Map<string, { text: string; mentions: number; count: number }>();
	const ctx = { channel: "-100", actor: "42", text: "hello https://evil.test" };
	assert.equal(floodDrop(undefined, flood, ctx), undefined);
	assert.equal(linkDrop(undefined, ctx), undefined);
	assert.equal(spamDrop(undefined, spam, ctx), undefined);
	assert.equal(editedMessagesMode(undefined), "ignore");
	assert.equal(shouldSendWelcome({ config: undefined, newMemberIsBot: true, botUserId: 1 }), false);
});

test("floodDrop silently drops excess messages", () => {
	const flood = new Map<string, number[]>();
	const config = { flood: { windowMs: 10_000, maxMessages: 2 } };
	const ctx = { channel: "-100", actor: "42", text: "hi", now: 1000 };
	assert.equal(floodDrop(config, flood, ctx), undefined);
	assert.equal(floodDrop(config, flood, ctx), undefined);
	assert.deepEqual(floodDrop(config, flood, ctx), { rule: "flood", reason: "flood_limit" });
});

test("linkDrop blocks urls outside allowlist", () => {
	const config = { linkFilter: { allowlist: ["example.com"] } };
	assert.equal(linkDrop(config, { channel: "-100", actor: "42", text: "see https://example.com/x" }), undefined);
	assert.deepEqual(linkDrop(config, { channel: "-100", actor: "42", text: "see https://evil.test" }), {
		rule: "link",
		reason: "link_not_allowed",
	});
});

test("spamDrop blocks repeated text", () => {
	const spam = new Map<string, { text: string; mentions: number; count: number }>();
	const config = { spam: { maxRepeated: 2 } };
	const ctx = { channel: "-100", actor: "42", text: "same" };
	assert.equal(spamDrop(config, spam, ctx), undefined);
	assert.deepEqual(spamDrop(config, spam, ctx), { rule: "spam", reason: "repeated_text" });
});

test("welcomeTemplate and sticker-only helpers", () => {
	assert.match(welcomeTemplate({ welcome: true }) ?? "", /Welcome/);
	assert.equal(telegramStickerOnly({ sticker: { file_id: "s" } }), true);
	assert.equal(telegramStickerOnly({ sticker: { file_id: "s" }, text: "hi" }), false);
});
