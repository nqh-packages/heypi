import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachmentPrompt, responseBytes, runtimeAttachments } from "../src/io/attachments.js";
import type { Runtime } from "../src/runtime/types.js";

test("attachmentPrompt appends stable paths and metadata", () => {
	assert.equal(
		attachmentPrompt("review this", [
			{ name: "report.txt", path: "/incoming/report.txt", mimeType: "text/plain", size: 5 },
		]),
		"review this\nAttachments:\n- report.txt: /incoming/report.txt (text/plain, 5 bytes)",
	);
});

test("runtimeAttachments writes sanitized files under runtime root", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-attachments-"));
	const store = runtimeAttachments(runtime(root, "just-bash"));

	const file = await store.save({
		provider: "slack",
		id: "../F123",
		name: "../hello world.txt",
		data: new TextEncoder().encode("hello"),
		mimeType: "text/plain",
		messageId: "1700.1",
	});

	assert.equal(file.path, "/incoming/slack/1700.1/F123-hello_world.txt");
	assert.equal(file.size, 5);
	assert.equal(await readFile(join(root, "incoming/slack/1700.1/F123-hello_world.txt"), "utf8"), "hello");
});

test("runtimeAttachments rejects oversized inbound files", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-attachments-limit-"));
	const store = runtimeAttachments(runtime(root, "just-bash"), { maxBytes: 4 });

	await assert.rejects(
		() =>
			store.save({
				provider: "slack",
				name: "hello.txt",
				data: new TextEncoder().encode("hello"),
			}),
		/exceeds limit/,
	);
});

test("runtimeAttachments resolves outbound files under runtime root", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-outbound-"));
	await writeFile(join(root, "report.txt"), "hello");
	const store = runtimeAttachments(runtime(root, "host-bash"));

	const file = await store.resolve({ path: "report.txt", name: "../final report.txt", mimeType: "text/plain" });

	assert.equal(file.path, await realpath(join(root, "report.txt")));
	assert.equal(file.name, "final_report.txt");
	assert.equal(file.mimeType, "text/plain");
	assert.equal(file.size, 5);
	await assert.rejects(() => store.resolve({ path: "../outside.txt" }), /escapes runtime root/);
});

test("runtimeAttachments rejects symlink escapes", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-outbound-link-"));
	const outside = await mkdtemp(join(tmpdir(), "heypi-outside-"));
	await writeFile(join(outside, "secret.txt"), "secret");
	await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
	const store = runtimeAttachments(runtime(root, "host-bash"));

	await assert.rejects(() => store.resolve({ path: "link.txt" }), /escapes runtime root/);
});

test("responseBytes stops reading above the byte limit", async () => {
	const response = new Response("hello");

	await assert.rejects(() => responseBytes(response, 4), /exceeds limit/);
});

function runtime(root: string, name: Runtime["name"]): Runtime {
	return { name, root, capabilities: {} };
}
