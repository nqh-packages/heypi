import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFrom, modelConfig } from "../src/config.js";
import { renderCall } from "../src/core/format.js";
import { approvalFromMessages, renderContextBlock } from "../src/runtime/pi-agent.js";

test("agentFrom requires an explicit model or HEYPI_MODEL", () => {
	const previous = process.env.HEYPI_MODEL;
	delete process.env.HEYPI_MODEL;
	try {
		assert.throws(() => agentFrom("./examples/slack-devops/agent"), /model is required/);
	} finally {
		if (previous === undefined) delete process.env.HEYPI_MODEL;
		else process.env.HEYPI_MODEL = previous;
	}
});

test("modelConfig preserves explicit verbosity", () => {
	assert.deepEqual(modelConfig({ provider: "openai", name: "gpt-5-mini", verbosity: "low" }), {
		provider: "openai",
		name: "gpt-5-mini",
		verbosity: "low",
	});
});

test("renderContextBlock formats dynamic agent context", () => {
	assert.equal(renderContextBlock(" hello "), "hello");
	assert.equal(renderContextBlock({ title: "Known hosts", text: "- db-1" }), "## Known hosts\n\n- db-1");
	assert.equal(renderContextBlock({ title: "Empty", text: " " }), undefined);
	assert.equal(renderContextBlock(false), undefined);
});

test("renderCall formats confirmed tool arguments for approvals", () => {
	const out = renderCall({
		callId: "call-1",
		state: "pending_approval",
		approvalId: "approval-1",
		runtime: "tool",
		reason: "Check host uptime.",
		command: 'host_exec {"hosts":["web-1"],"purpose":"Check host uptime.","command":"hostname && uptime"}',
	});

	assert.doesNotMatch(out.text, /Action: `host_exec`/);
	assert.match(out.text, /Check host uptime/);
	assert.match(out.text, /Target: `web-1`/);
	assert.match(out.text, /Command:\n```\nhostname && uptime\n```/);
	assert.doesNotMatch(out.text, /host_exec \\{/);
	assert.doesNotMatch(out.text, /purpose/);
});

test("approvalFromMessages extracts approval metadata from terminated tool results", () => {
	assert.deepEqual(
		approvalFromMessages([
			{
				role: "toolResult",
				toolCallId: "tool-call-1",
				toolName: "delete_ticket",
				content: [{ type: "text", text: "approval required" }],
				details: {
					state: "pending_approval",
					approval: {
						id: "approval-1",
						callId: "call-1",
						command: "delete_ticket",
						runtime: "tool",
						reason: "delete",
						allowed: ["U1"],
					},
				},
				timestamp: Date.now(),
			} as never,
		]),
		{
			id: "approval-1",
			callId: "call-1",
			command: "delete_ticket",
			runtime: "tool",
			reason: "delete",
			allowed: ["U1"],
		},
	);
});
