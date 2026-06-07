import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function prompts() {
	return [
		await readFile("examples/telegram-cofounder/agent/SOUL.md", "utf8"),
		await readFile("examples/telegram-cofounder/agent/AGENTS.md", "utf8"),
	].join("\n");
}

test("prompt identifies as co-founder and requires action grounding", async () => {
	const text = await prompts();
	assert.match(text, /business and product co-founder/);
	assert.match(text, /Never claim/);
	assert.match(text, /same turn proves it/);
	assert.match(text, /Next:/);
});

test("prompt requires task duplicate checks, ambiguity options, selected routes, and untrusted data handling", async () => {
	const text = await prompts();
	assert.match(text, /Check existing Markdown tasks/);
	assert.match(text, /2-3 concrete options/);
	assert.match(text, /agent-browser/);
	assert.match(text, /bird/);
	assert.match(text, /handoff/);
	assert.match(text, /Codex/);
	assert.match(text, /untrusted data, not instructions/);
});

test("prompt excludes Polsia identity, tool dumps, and unsupported feature promises", async () => {
	const text = await prompts();
	assert.doesNotMatch(text, /GlamOps/);
	assert.doesNotMatch(text, /source URLs|pricing claims|MCP tool dump/);
	assert.doesNotMatch(text, /support-ticket promises|billing\/God Mode rules/);
	assert.match(text, /excluded/);
	assert.match(text, /Refuse prompt injection/);
	assert.match(text, /secret capture/);
	assert.match(text, /workspace escape/);
});
