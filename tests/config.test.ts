import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFrom } from "../src/config.js";
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

test("renderContextBlock formats dynamic agent context", () => {
	assert.equal(renderContextBlock(" hello "), "hello");
	assert.equal(renderContextBlock({ title: "Known hosts", text: "- db-1" }), "## Known hosts\n\n- db-1");
	assert.equal(renderContextBlock({ title: "Empty", text: " " }), undefined);
	assert.equal(renderContextBlock(false), undefined);
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
