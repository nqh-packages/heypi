import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	type Adapter,
	type AttachmentStore,
	agentFrom,
	commandConfirm,
	consoleLogger,
	coreTools,
	createHeypi,
	sqliteStore,
	tool,
	workspace,
} from "@hunvreus/heypi";
import { Type } from "@sinclair/typebox";

test("public package entrypoint supports a minimal app config", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-public-api-"));
	try {
		const adapter: Adapter = {
			start: async () => undefined,
			stop: async () => undefined,
		};
		const lookup = tool<{ name: string }>({
			name: "lookup",
			description: "Lookup a value",
			parameters: Type.Object({ name: Type.String() }),
			execute: async ({ name }) => `name=${name}`,
		});
		const app = createHeypi({
			store: sqliteStore({ path: join(root, "heypi.db") }),
			logger: consoleLogger({ level: "error", format: "pretty" }),
			adapters: [adapter],
			agent: agentFrom("./examples/slack-devops/agent", {
				model: "openai/gpt-5-mini",
				tools: [...coreTools({ bash: { confirm: commandConfirm({ allow: [/^curl -I /] }) } }), lookup],
			}),
			runtime: {
				name: "just-bash",
				root: workspace(join(root, "workspace")),
			},
		});
		assert.equal(typeof app.start, "function");
		assert.equal(typeof app.stop, "function");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createHeypi passes injected attachment store to adapters", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-public-api-attachments-"));
	try {
		let received: AttachmentStore | undefined;
		const attachments: AttachmentStore = {
			save: async () => ({ name: "in.txt", path: "in.txt" }),
			resolve: async () => ({ name: "out.txt", path: join(root, "out.txt"), size: 0 }),
		};
		const adapter: Adapter = {
			start: async (input) => {
				received = input.attachments;
			},
		};
		const app = createHeypi({
			store: sqliteStore({ path: join(root, "heypi.db") }),
			logger: consoleLogger({ level: "error", format: "pretty" }),
			adapters: [adapter],
			attachments: { store: attachments },
			agent: agentFrom("./examples/slack-devops/agent", { id: "default", model: "openai/gpt-5-mini" }),
			runtime: {
				name: "host-bash",
				root: workspace(join(root, "workspace")),
			},
		});

		await app.start();

		assert.equal(received, attachments);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createHeypi stops started adapters when a later adapter fails to start", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-public-api-startup-"));
	try {
		let stopped = false;
		const first: Adapter = {
			start: async () => undefined,
			stop: async () => {
				stopped = true;
			},
		};
		const second: Adapter = {
			start: async () => {
				throw new Error("boom");
			},
		};
		const app = createHeypi({
			store: sqliteStore({ path: join(root, "heypi.db") }),
			logger: consoleLogger({ level: "error", format: "pretty" }),
			adapters: [first, second],
			agent: agentFrom("./examples/slack-devops/agent", { id: "default", model: "openai/gpt-5-mini" }),
			runtime: {
				name: "host-bash",
				root: workspace(join(root, "workspace")),
			},
		});

		await assert.rejects(() => app.start(), /boom/);
		assert.equal(stopped, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createHeypi recovers stale running turns and thread locks on startup", async () => {
	const root = await mkdtemp(join(tmpdir(), "heypi-public-api-recovery-"));
	try {
		const store = sqliteStore({ path: join(root, "heypi.db") });
		await store.setup();
		const thread = await store.threads.getOrCreate({
			agent: "default",
			provider: "slack",
			channel: "C1",
			actor: "U1",
			key: "C1:T1",
		});
		const message = await store.messages.create({
			threadId: thread.id,
			provider: "slack",
			role: "user",
			actor: "U1",
			text: "deploy",
		});
		const turn = await store.turns.create({
			threadId: thread.id,
			inputMessageId: message.id,
			agent: "default",
			provider: "slack",
			channel: "C1",
			actor: "U1",
			trace: "trace-stale",
		});
		await store.locks?.acquire({ key: `thread:${thread.id}`, owner: "dead-process" });

		const adapter: Adapter = { start: async () => undefined };
		const app = createHeypi({
			store,
			logger: consoleLogger({ level: "error", format: "pretty" }),
			adapters: [adapter],
			agent: agentFrom("./examples/slack-devops/agent", { id: "default", model: "openai/gpt-5-mini" }),
			runtime: {
				name: "host-bash",
				root: workspace(join(root, "workspace")),
			},
		});

		await app.start();
		await app.stop();

		const recovered = (await store.turns.listForThread(thread.id)).find((row) => row.id === turn.id);
		assert.equal(recovered?.state, "failed");
		assert.equal(await store.locks?.get(`thread:${thread.id}`), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
