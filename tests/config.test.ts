import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFrom } from "../src/config.js";
import { renderContextBlock } from "../src/runtime/pi-agent.js";

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
