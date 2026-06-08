import assert from "node:assert/strict";
import { test } from "node:test";
import {
	chunkTelegramFormattedText,
	escapeMarkdownV2,
	formatTelegramText,
	sanitizeHtml,
} from "../src/io/telegram-format.js";

test("escapeMarkdownV2 escapes Telegram special characters", () => {
	assert.equal(escapeMarkdownV2("Approval required"), "Approval required");
	assert.equal(escapeMarkdownV2("a.b(c)"), "a\\.b\\(c\\)");
});

test("sanitizeHtml blocks script tags and unsafe links", () => {
	const sanitized = sanitizeHtml('<script>alert(1)</script><a href="javascript:alert(1)">x</a>');
	assert.doesNotMatch(sanitized, /<script/i);
	assert.doesNotMatch(sanitized, /javascript:/);
});

test("chunkTelegramFormattedText keeps chunks under markup limits", () => {
	const text = "a".repeat(3900);
	const chunks = chunkTelegramFormattedText(text, "MarkdownV2");
	assert.equal(chunks.length, 2);
	assert.equal(
		chunks.every((chunk) => chunk.text.length <= 3800),
		true,
	);
});

test("plain mode preserves literal asterisks", () => {
	assert.equal(formatTelegramText("*literal*", "plain"), "*literal*");
});

test("HTML mode sanitizes unsafe tags and preserves allowed markup", () => {
	assert.equal(formatTelegramText("<b>bold</b>", "HTML"), "<b>bold</b>");
	assert.doesNotMatch(formatTelegramText("<script>x</script><b>bold</b>", "HTML"), /<script/i);
});
