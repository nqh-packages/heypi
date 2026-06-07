import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createCofounderTools } from "./tools/index.js";
import { FakeCodexRunner } from "./tools/runner.js";
import { CofounderWorkspace } from "./tools/workspace.js";

type CofounderTools = ReturnType<typeof createCofounderTools>;

async function harness() {
	const repoRoot = await mkdtemp(join(tmpdir(), "telegram-cofounder-transcript-"));
	const workspace = new CofounderWorkspace({ repoRoot, now: () => new Date("2026-06-06T12:00:00.000Z") });
	const skills = ["agent-browser", "bird", "handoff", "codex"].map((name) => ({
		name,
		root: resolve("examples/telegram-cofounder/fixtures/skills", name),
	}));
	return createCofounderTools({
		workspace,
		access: { trusted: true, localDev: false },
		skills,
		runner: new FakeCodexRunner(),
	});
}

async function call(tools: CofounderTools, name: string, input: Record<string, unknown>) {
	const tool = tools.find((candidate) => candidate.name === name);
	assert.ok(tool);
	const result = await tool.execute("call-1", input, undefined, undefined, undefined as never);
	if (typeof result === "string") return result;
	return result.content.map((item) => ("text" in item ? item.text : "")).join("\n");
}

test("mocked first-run loop saves company context and returns a Next recommendation", async () => {
	const tools = await harness();
	const reply = await call(tools, "save_company_profile", {
		name: "BookNow",
		offer: "AI booking assistant",
		customer: "salon owners",
		focus: "prove Telegram co-founder",
		constraint: "no live model credentials in tests",
	});
	assert.match(reply, /saved company profile/);
	assert.match(reply, /Next:/);
});

test("mocked task loop covers create, duplicate, and ambiguous work", async () => {
	const tools = await harness();
	assert.match(
		await call(tools, "create_task", {
			title: "Write operator report",
			body: "Summarize current focus today.",
			owner: "Huy",
		}),
		/created task/,
	);
	assert.match(
		await call(tools, "create_task", { title: "Write operator report", body: "Again.", owner: "Huy" }),
		/existing task found/,
	);
	assert.match(
		await call(tools, "create_task", { title: "Improve growth", body: "make it better" }),
		/clarify before creating task/,
	);
});

test("mocked route handoff, excluded feature, and secret refusal stay honest", async () => {
	const tools = await harness();
	assert.match(
		await call(tools, "route_browser", { request: "Inspect public landing page" }),
		/prepared browser handoff/,
	);
	assert.equal(await call(tools, "classify_capability", { request: "support tickets" }), "excluded");
	assert.match(await call(tools, "route_browser", { request: "store password=supersecretvalue123456" }), /secret/);
});
