import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createTelegramCofounderConfig,
	DEFAULT_MODEL,
	DEV_APP_LOCK_DRAIN_MS,
	devAppLock,
	listEnv,
	requiredEnv,
	telegramBotToken,
	telegramChats,
	telegramUsers,
	trustedOperatorAccess,
	trustedWorkspaceRoots,
} from "./app.js";

test("app uses Pi-managed default model without OPENAI_API_KEY", () => {
	const config = createTelegramCofounderConfig({ TELEGRAM_BOT_TOKEN: "telegram-token" });
	assert.deepEqual(config.agent.model, { provider: "openai-codex", name: "gpt-5.4-mini" });
});

test("app allows HEYPI_MODEL override", () => {
	const config = createTelegramCofounderConfig({
		TELEGRAM_BOT_TOKEN: "telegram-token",
		HEYPI_MODEL: "openai/gpt-5-mini",
	});
	assert.deepEqual(config.agent.model, { provider: "openai", name: "gpt-5-mini" });
	assert.equal(DEFAULT_MODEL, "openai-codex/gpt-5.4-mini");
});

test("allowlist env parsing trims empty values", () => {
	assert.deepEqual(listEnv({ HEYPI_TELEGRAM_USERS: " 42, , 43 " }, "HEYPI_TELEGRAM_USERS"), ["42", "43"]);
	assert.deepEqual(telegramUsers({ HEYPI_TELEGRAM_USERS: " 42, , 43 " }), ["42", "43"]);
	assert.deepEqual(telegramChats({ HEYPI_TELEGRAM_CHATS: " -10042, , -10043 " }), ["-10042", "-10043"]);
});

test("trusted workspace roots parse explicit roots and default to current cwd", () => {
	assert.deepEqual(trustedWorkspaceRoots({ HEYPI_TRUSTED_WORKSPACE_ROOTS: " /work/a, ,/work/b " }), [
		"/work/a",
		"/work/b",
	]);
	assert.deepEqual(trustedWorkspaceRoots({}), [process.cwd()]);
});

test("trusted operator access follows Telegram allowlists and local dev flag", () => {
	assert.deepEqual(trustedOperatorAccess({}), { trusted: false, localDev: false });
	assert.deepEqual(trustedOperatorAccess({ HEYPI_TELEGRAM_USERS: "8285331265" }), {
		trusted: true,
		localDev: false,
	});
	assert.deepEqual(trustedOperatorAccess({ HEYPI_TELEGRAM_CHATS: "-10042" }), { trusted: true, localDev: false });
	assert.deepEqual(trustedOperatorAccess({ HEYPI_LOCAL_DEV_MUTATIONS: "true" }), {
		trusted: false,
		localDev: true,
	});
});

test("dev app lock replaces an old local process only for development contexts", () => {
	assert.deepEqual(devAppLock({ APP_ENV: "development" }), { drainMs: DEV_APP_LOCK_DRAIN_MS, replace: true });
	assert.deepEqual(devAppLock({ HEYPI_LOCAL_DEV_MUTATIONS: "true" }), {
		drainMs: DEV_APP_LOCK_DRAIN_MS,
		replace: true,
	});
	assert.equal(devAppLock({ APP_ENV: "production", HEYPI_LOCAL_DEV_MUTATIONS: "false" }), undefined);
});

test("app requires Telegram token only at config creation", () => {
	assert.throws(() => requiredEnv({}, "TELEGRAM_BOT_TOKEN"), /Missing env var: TELEGRAM_BOT_TOKEN/);
	assert.throws(() => telegramBotToken({}), /Missing env var: TELEGRAM_BOT_TOKEN/);
});
