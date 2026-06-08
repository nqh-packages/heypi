import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTelegramSetupCommands, DEFAULT_TELEGRAM_COMMANDS } from "../src/cli.js";

test("buildTelegramSetupCommands uses defaults when config is empty", () => {
	assert.deepEqual(buildTelegramSetupCommands(), DEFAULT_TELEGRAM_COMMANDS);
});

test("buildTelegramSetupCommands validates command names", () => {
	assert.throws(
		() => buildTelegramSetupCommands({ commands: [{ command: "Bad Name", description: "x" }] }),
		/Invalid Telegram command name/,
	);
});

test("buildTelegramSetupCommands accepts custom command menus", () => {
	const commands = buildTelegramSetupCommands({
		commands: [{ command: "ping", description: "Ping the bot" }],
	});
	assert.deepEqual(commands, [{ command: "ping", description: "Ping the bot" }]);
});
