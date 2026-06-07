import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createCofounderTools } from "./tools/index.js";
import { FakeCodexRunner } from "./tools/runner.js";
import { CofounderWorkspace } from "./tools/workspace.js";

type CofounderTools = ReturnType<typeof createCofounderTools>;

async function setup() {
	await mkdir(resolve("tmp/verify"), { recursive: true });
	const repoRoot = await mkdtemp(resolve("tmp/verify/telegram-cofounder-tools-"));
	const workspace = new CofounderWorkspace({ repoRoot, now: () => new Date("2026-06-06T12:00:00.000Z") });
	const trustedRoot = join(repoRoot, "trusted-root");
	const skills = ["agent-browser", "bird", "handoff", "hermes-codex"].map((name) => ({
		name,
		root: resolve("examples/telegram-cofounder/fixtures/skills", name),
	}));
	const tools = createCofounderTools({
		workspace,
		access: { trusted: true, localDev: false },
		skills,
		runner: new FakeCodexRunner(),
		trustedWorkspaceRoots: [process.cwd(), trustedRoot],
	});
	return { trustedRoot, workspace, tools };
}

async function run(tools: CofounderTools, name: string, input: Record<string, unknown> = {}) {
	const found = tools.find((item) => item.name === name);
	assert.ok(found, `missing tool ${name}`);
	const result = await found.execute("call-1", input, undefined, undefined, undefined as never);
	if (typeof result === "string") return result;
	return result.content.map((item) => ("text" in item ? item.text : "")).join("\n");
}

test("profile, learning, reports, documents, dashboard, and context tools write Markdown", async () => {
	const { tools } = await setup();
	assert.match(
		await run(tools, "save_company_profile", {
			name: "BookNow",
			offer: "AI booking ops",
			customer: "salons",
			focus: "ship Telegram co-founder",
			constraint: "small external SSD workspace",
		}),
		/saved company profile: state\/memory\/profile\.md/,
	);
	assert.match(
		await run(tools, "append_learning", { text: "Operator prefers repo-relative paths." }),
		/state\/memory\/learnings\//,
	);
	assert.match(
		await run(tools, "write_document", { path: "strategy", title: "Strategy", body: "Use Markdown as SSOT." }),
		/state\/documents\/strategy\.md/,
	);
	assert.match(
		await run(tools, "create_report", { title: "Launch report", type: "ops", body: "Ready." }),
		/state\/reports\/2026-06-06-launch-report\.md/,
	);
	assert.match(
		await run(tools, "update_dashboard", { section: "Current focus", body: "Finish U8." }),
		/state\/dashboard\/current-focus\.md/,
	);
	assert.match(await run(tools, "get_context"), /BookNow/);
});

test("task tool creates tasks, returns duplicate path, and asks options for ambiguity", async () => {
	const { tools } = await setup();
	assert.match(
		await run(tools, "create_task", {
			title: "Launch Telegram co-founder",
			body: "Add deterministic transcript tests.",
			owner: "Huy",
		}),
		/state\/tasks\/launch-telegram-co-founder\.md/,
	);
	assert.match(
		await run(tools, "create_task", {
			title: "Launch Telegram co-founder",
			body: "Duplicate request.",
			owner: "Huy",
		}),
		/existing task found: state\/tasks\/launch-telegram-co-founder\.md/,
	);
	assert.match(
		await run(tools, "create_task", { title: "Improve growth", body: "make it better" }),
		/clarify before creating task:\n1\./,
	);
});

test("recurring task stores safe metadata and rejects loops", async () => {
	const { tools, workspace } = await setup();
	assert.match(
		await run(tools, "create_recurring_task", {
			title: "Weekly founder report",
			body: "Summarize asks, replies, completions, focus, and alerts.",
			cadence: "weekly",
			timezone: "America/Bogota",
			next_due: "2026-06-13",
			owner: "Huy",
			enabled: true,
			safe_execution_note: "Create a Markdown report when explicitly run.",
		}),
		/created recurring template/,
	);
	const [task] = await workspace.list("tasks");
	assert.equal(task.meta.timezone, "America/Bogota");
	assert.match(
		await run(tools, "create_recurring_task", {
			title: "Loop",
			body: "run forever",
			cadence: "every 1 minute",
			timezone: "America/Bogota",
			next_due: "2026-06-06",
			owner: "Huy",
			enabled: true,
			safe_execution_note: "automatic execution loop",
		}),
		/blocked: recurring templates store schedule metadata only/,
	);
});

test("capability discovery separates direct, selected, unavailable, and excluded work", async () => {
	const { tools } = await setup();
	const report = await run(tools, "list_capabilities");
	assert.match(report, /Direct local tools/);
	assert.match(report, /agent-browser, bird, handoff, hermes-codex/);
	assert.match(report, /Excluded features/);
	assert.equal(await run(tools, "classify_capability", { request: "support tickets" }), "excluded");
	assert.equal(await run(tools, "classify_capability", { request: "browser research" }), "selected-route");
});

test("selected routes prepare artifacts without claiming external actions ran", async () => {
	const { tools } = await setup();
	assert.match(
		await run(tools, "route_browser", { request: "Open the pricing page" }),
		/prepared browser handoff through agent-browser/,
	);
	assert.match(
		await run(tools, "route_twitter", { request: "Read this tweet thread" }),
		/prepared X\/Twitter handoff through bird/,
	);
	assert.match(
		await run(tools, "route_research", { request: "Research salon booking competitors" }),
		/prepared research task/,
	);
	assert.match(
		await run(tools, "recommend_meta_ads", { request: "Find customer acquisition angle" }),
		/Meta Ads growth recommendation/,
	);
	assert.doesNotMatch(
		await run(tools, "route_browser", { request: "Open the pricing page" }),
		/browsed|opened|launched/,
	);
});

test("routes refuse secret capture and unconfirmed mutations", async () => {
	const { tools } = await setup();
	assert.match(await run(tools, "route_browser", { request: "export cookies from profile" }), /blocked/);
	assert.match(await run(tools, "route_twitter", { request: "post a tweet" }), /blocked/);
	assert.match(await run(tools, "route_browser", { request: "save API_TOKEN=abc123def456ghi789" }), /secret/);
});

test("engineering route copies selected skills and starts only with trusted confirmation", async () => {
	const { tools } = await setup();
	assert.match(
		await run(tools, "route_engineering", {
			title: "Build checkout",
			request: "Implement checkout",
			targetCwd: process.cwd(),
		}),
		/prepared engineering handoff/,
	);
	const started = await run(tools, "route_engineering", {
		title: "Build checkout",
		request: "Implement checkout",
		targetCwd: process.cwd(),
		confirmed: true,
	});
	assert.match(started, /started Hermes Codex/);
	assert.match(started, /fake-runner-started/);
});

test("engineering route allows explicit trusted roots and blocks paths outside them", async () => {
	const { tools, trustedRoot } = await setup();
	assert.match(
		await run(tools, "route_engineering", {
			title: "Work in trusted repo",
			request: "Inspect the trusted repo",
			targetCwd: join(trustedRoot, "company-runner"),
		}),
		/prepared engineering handoff/,
	);
	assert.match(
		await run(tools, "route_engineering", {
			title: "Work outside trusted roots",
			request: "Inspect an untrusted local path",
			targetCwd: "/Users/huy/.ssh",
		}),
		/trusted workspace root/,
	);
});

test("mutating tools are default-deny without trusted allowlist or local dev flag", async () => {
	await mkdir(resolve("tmp/verify"), { recursive: true });
	const repoRoot = await mkdtemp(resolve("tmp/verify/telegram-cofounder-deny-"));
	const tools = createCofounderTools({
		workspace: new CofounderWorkspace({ repoRoot }),
		access: { trusted: false, localDev: false },
	});
	assert.match(
		await run(tools, "create_task", { title: "Launch", body: "Specific owner today", owner: "Huy" }),
		/trusted Telegram user allowlist/,
	);
	assert.match(await run(tools, "route_browser", { request: "Open pricing page" }), /trusted Telegram user allowlist/);
	assert.match(
		await run(tools, "route_twitter", { request: "Read this tweet thread" }),
		/trusted Telegram user allowlist/,
	);
	assert.match(
		await run(tools, "route_research", { request: "Research competitors" }),
		/trusted Telegram user allowlist/,
	);
	assert.match(
		await run(tools, "recommend_meta_ads", { request: "Shape acquisition angle" }),
		/trusted Telegram user allowlist/,
	);
});
