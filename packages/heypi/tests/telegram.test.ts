import assert from "node:assert/strict";
import { test } from "node:test";
import { redactedApprovalPendingText } from "../src/core/approval-view.js";
import {
	isTelegramImageMime,
	parseTelegramCallback,
	resolveTelegramInboundText,
	TELEGRAM_PHOTO_ONLY_DEFAULT,
	telegramApprovalDisplayPlan,
	telegramApprovalText,
	telegramChunks,
	telegramDirectChat,
	telegramMediaTriggerBypass,
	telegramPhotoOnly,
	telegramTriggered,
	telegramVoiceOrAudio,
} from "../src/io/telegram.js";

test("parseTelegramCallback parses namespaced control actions", () => {
	assert.deepEqual(parseTelegramCallback("heypi:approve:abc"), { kind: "approve", id: "abc" });
	assert.deepEqual(parseTelegramCallback("heypi:deny:def"), { kind: "deny", id: "def" });
	assert.deepEqual(parseTelegramCallback("heypi:cancel:trace-1"), { kind: "cancel", id: "trace-1" });
	assert.deepEqual(parseTelegramCallback("heypi:status"), { kind: "status" });
	assert.deepEqual(parseTelegramCallback("heypi:custom:token1"), { kind: "custom", token: "token1" });
	assert.equal(parseTelegramCallback("approve:abc"), undefined);
	assert.equal(parseTelegramCallback("heypi:approve:"), undefined);
});

test("telegramChunks keeps markup chunks under Telegram edit limits", () => {
	const text = "a".repeat(3900);
	const chunks = telegramChunks(text, true);

	assert.equal(chunks.length, 2);
	assert.equal(
		chunks.every((chunk) => chunk.length <= 3800),
		true,
	);
});

test("Telegram approval resolution preserves approval text and appends status", () => {
	const approval = {
		id: "approval-1",
		callId: "call-1",
		command: "curl --version",
		runtime: "just-bash",
		reason: "Run bash command.",
		allowed: [],
		requestedBy: "42",
		details: [{ label: "Command", value: "curl --version", format: "code" as const }],
	};
	const pending = telegramApprovalText("ignored", approval);
	const approved = telegramApprovalText("ignored", approval, "approved", "user 42");

	assert.match(pending, /^\*Approval required\*/);
	assert.match(pending, /Approval ID: approval-1/);
	assert.match(approved, /^\*Approved\*/);
	assert.match(approved, /Reason:\nRun bash command/);
	assert.match(approved, /Approved by user 42/);
});

test("telegramMediaTriggerBypass covers voice, audio, and photo-only", () => {
	assert.equal(telegramVoiceOrAudio({ message_id: 1, chat: { id: 1 }, voice: { file_id: "v" } }), true);
	assert.equal(telegramVoiceOrAudio({ message_id: 1, chat: { id: 1 }, audio: { file_id: "a" } }), true);
	assert.equal(telegramPhotoOnly({ message_id: 1, chat: { id: 1 }, photo: [{ file_id: "p" }] }), true);
	assert.equal(
		telegramMediaTriggerBypass({ message_id: 1, chat: { id: 1 }, photo: [{ file_id: "p" }], caption: "hi" }),
		false,
	);
});

test("photo-only messages bypass mention trigger but still require mention for plain text", () => {
	const photoOnly = { message_id: 1, chat: { id: 1 }, photo: [{ file_id: "p" }] };
	assert.deepEqual(telegramTriggered(undefined, { text: "", isDm: false, botUsername: "my_bot" }), {
		ok: false,
		reason: "mention_required",
	});
	assert.equal(telegramMediaTriggerBypass(photoOnly), true);
	assert.equal(resolveTelegramInboundText(photoOnly), TELEGRAM_PHOTO_ONLY_DEFAULT);
	assert.equal(resolveTelegramInboundText(photoOnly, "Snapshot"), "Snapshot");
});

test("isTelegramImageMime detects common image types", () => {
	assert.equal(isTelegramImageMime("image/png", "file.bin"), true);
	assert.equal(isTelegramImageMime(undefined, "photo.jpg"), true);
	assert.equal(isTelegramImageMime("application/pdf", "doc.pdf"), false);
});

test("telegramDirectChat treats positive chat ids as DMs", () => {
	assert.equal(telegramDirectChat(42), true);
	assert.equal(telegramDirectChat(-100123), false);
});

test("telegramApprovalDisplayPlan redacts pending approvals in groups", () => {
	const approval = {
		id: "approval-1",
		callId: "call-1",
		command: "curl --version",
		runtime: "just-bash",
		reason: "Run bash command.",
		allowed: [],
		requestedBy: "42",
		details: [{ label: "Command", value: "curl --version", format: "code" as const }],
	};
	const group = telegramApprovalDisplayPlan({ text: "body", approval, isDm: false });
	assert.equal(group.visibleText, redactedApprovalPendingText());
	assert.equal(group.groupApproval, true);
	assert.equal(group.showMarkup, false);

	const dm = telegramApprovalDisplayPlan({ text: "body", approval, isDm: true });
	assert.match(dm.visibleText, /Approval ID: approval-1/);
	assert.equal(dm.groupApproval, false);
	assert.equal(dm.showMarkup, true);

	const resolved = telegramApprovalDisplayPlan({
		text: "body",
		approval,
		approvalResolution: "approved",
		actor: "user 42",
		isDm: false,
	});
	assert.equal(resolved.visibleText, "Approved by user 42.");
	assert.equal(resolved.showMarkup, false);
});
