import assert from "node:assert/strict";
import { test } from "node:test";
import { createTelegramCofounderConfig, DEFAULT_MODEL, listEnv, requiredEnv, trustedWorkspaceRoots } from "./app.js";

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
});

test("trusted workspace roots parse explicit roots and default to current cwd", () => {
	assert.deepEqual(trustedWorkspaceRoots({ HEYPI_TRUSTED_WORKSPACE_ROOTS: " /work/a, ,/work/b " }), [
		"/work/a",
		"/work/b",
	]);
	assert.deepEqual(trustedWorkspaceRoots({}), [process.cwd()]);
});

test("app requires Telegram token only at config creation", () => {
	assert.throws(() => requiredEnv({}, "TELEGRAM_BOT_TOKEN"), /Missing env var: TELEGRAM_BOT_TOKEN/);
});
