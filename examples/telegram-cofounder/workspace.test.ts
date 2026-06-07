import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	CofounderWorkspace,
	parseMarkdown,
	redactSecrets,
	renderMarkdown,
	slug,
	WorkspaceError,
} from "./tools/workspace.js";

async function tempWorkspace() {
	const repoRoot = await mkdtemp(join(tmpdir(), "telegram-cofounder-"));
	return new CofounderWorkspace({ repoRoot, now: () => new Date("2026-06-06T12:00:00.000Z") });
}

test("workspace renders compact empty context", async () => {
	const workspace = await tempWorkspace();
	const context = await workspace.context();
	assert.equal(context.profile, "No company profile saved.");
	assert.deepEqual(context.learnings, []);
	assert.deepEqual(context.tasks, []);
	assert.deepEqual(context.reports, []);
	assert.equal(context.dashboard, "No dashboard notes saved.");
});

test("workspace preserves exact profile and learning strings", async () => {
	const workspace = await tempWorkspace();
	await workspace.saveProfile({
		name: "BookNow",
		offer: "AI booking ops",
		customer: "salons",
		focus: "launch Telegram co-founder",
		constraint: "no OPENAI_API_KEY default path",
	});
	await workspace.appendLearning({ text: "Preserve exact error: Missing env var: TELEGRAM_BOT_TOKEN" });
	const context = await workspace.context();
	assert.match(context.profile, /BookNow/);
	assert.match(context.profile, /no OPENAI_API_KEY default path/);
	assert.match(context.learnings.join("\n"), /Missing env var: TELEGRAM_BOT_TOKEN/);
});

test("workspace refuses path escape, encoded separators, and symlink paths", async () => {
	const workspace = await tempWorkspace();
	await assert.rejects(() => workspace.writeDocument({ path: "../escape", title: "Escape", body: "x" }), /escapes/);
	await assert.rejects(() => workspace.writeDocument({ path: "a%2fb", title: "Escape", body: "x" }), /encoded/);

	const outside = join(tmpdir(), `outside-${Date.now()}.md`);
	await writeFile(outside, "outside", "utf8");
	await workspace.makeSymlinkForTest("documents", outside, "linked.md");
	await assert.rejects(() => workspace.readDocument("linked.md"), /symlink/i);
});

test("workspace rejects oversized writes and secret-shaped content", async () => {
	const workspace = new CofounderWorkspace({
		repoRoot: await mkdtemp(join(tmpdir(), "telegram-cofounder-")),
		maxWriteBytes: 20,
	});
	await assert.rejects(
		() => workspace.writeDocument({ path: "huge", title: "Huge", body: "x".repeat(100) }),
		/exceeds/,
	);

	const secure = await tempWorkspace();
	await assert.rejects(
		() => secure.writeDocument({ path: "secret", title: "Secret", body: "API_TOKEN=abc123def456ghi789" }),
		/secret/i,
	);
});

test("secret redaction does not treat absolute workspace paths as bare secrets", () => {
	const path = "/Volumes/BIWIN/CODES/company-runner";
	assert.equal(redactSecrets(path), path);
	assert.equal(redactSecrets("API_TOKEN=abc123def456ghi789"), "[REDACTED_SECRET]");
});

test("frontmatter parser preserves scalar, boolean, and string array values", () => {
	const raw = renderMarkdown({ title: "Task", enabled: true, related: ["a.md", "b.md"] }, "# Task\n\nBody\n");
	assert.deepEqual(parseMarkdown(raw), {
		meta: { title: "Task", enabled: true, related: ["a.md", "b.md"] },
		body: "# Task\n\nBody\n",
	});
	assert.throws(() => parseMarkdown("---\ntitle: bad\n"), /Malformed frontmatter/);
});

test("task slugs are stable and unique", async () => {
	const workspace = await tempWorkspace();
	const first = await workspace.createTask({ title: "Launch Telegram co-founder", body: "one" });
	const second = await workspace.createTask({ title: "Launch Telegram co-founder", body: "two" });
	assert.equal(slug("Launch Telegram co-founder"), "launch-telegram-co-founder");
	assert.equal(first.path, "state/tasks/launch-telegram-co-founder.md");
	assert.equal(second.path, "state/tasks/launch-telegram-co-founder-2.md");
});

test("workspace errors carry structured codes", () => {
	const error = new WorkspaceError("Nope", "unsafe_path");
	assert.equal(error.code, "unsafe_path");
});
