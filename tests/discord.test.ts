import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDiscordAttachmentUrl, discordAllowed, discordTriggered } from "../src/io/discord.js";

test("Discord allowlists default to accepting delivered messages", () => {
	assert.deepEqual(discordAllowed(undefined, { guild: "G1", channel: "C1", user: "U1", isDm: false }), { ok: true });
});

test("Discord allowlists reject mismatched dimensions and disabled DMs", () => {
	assert.deepEqual(discordAllowed({ guilds: ["G2"] }, { guild: "G1", channel: "C1", user: "U1", isDm: false }), {
		ok: false,
		reason: "guild not allowed",
	});
	assert.deepEqual(discordAllowed({ channels: ["C2"] }, { guild: "G1", channel: "C1", user: "U1", isDm: false }), {
		ok: false,
		reason: "channel not allowed",
	});
	assert.deepEqual(discordAllowed({ users: ["U2"] }, { guild: "G1", channel: "C1", user: "U1", isDm: false }), {
		ok: false,
		reason: "user not allowed",
	});
	assert.deepEqual(discordAllowed({ dms: false }, { channel: "D1", user: "U1", isDm: true }), {
		ok: false,
		reason: "dm disabled",
	});
});

test("Discord trigger defaults to mention for channels and message for DMs", () => {
	assert.deepEqual(discordTriggered(undefined, { text: "hello", isDm: false, mentioned: false }), {
		ok: false,
		reason: "mention required",
	});
	assert.deepEqual(discordTriggered(undefined, { text: "hello", isDm: false, mentioned: true }), { ok: true });
	assert.deepEqual(discordTriggered(undefined, { text: "hello", isDm: true, mentioned: false }), { ok: true });
	assert.deepEqual(discordTriggered("message", { text: "hello", isDm: false, mentioned: false }), { ok: true });
});

test("Discord attachment URLs are limited to Discord CDN hosts", () => {
	assert.doesNotThrow(() => assertDiscordAttachmentUrl("https://cdn.discordapp.com/attachments/1/2/file.txt"));
	assert.doesNotThrow(() => assertDiscordAttachmentUrl("https://media.discordapp.net/attachments/1/2/file.png"));
	assert.throws(() => assertDiscordAttachmentUrl("http://cdn.discordapp.com/attachments/1/2/file.txt"), /protocol/);
	assert.throws(() => assertDiscordAttachmentUrl("https://example.com/attachments/1/2/file.txt"), /host/);
});
