import { redact } from "./log.js";
import type { Reply } from "./types.js";

export type ApprovalSummary = {
	id: string;
	callId: string;
	channel: string;
	command: string;
	runtime: string;
	reason: string;
	requestedAt: number;
	expiresAt: number | null;
	requestedBy: string | null;
};

export function helpReply(): Reply {
	return {
		text: [
			"heypi commands:",
			"- bash <shell command>",
			"- approvals: list pending approvals",
			"- approve <approval-id>",
			"- deny <approval-id>",
			"- cancel <turn-id>",
			"- status: show this thread status",
			"- status <call-id>: show one call status",
			"- any other text: handled by Pi agent with bash",
		].join("\n"),
	};
}

export function renderApprovals(rows: ApprovalSummary[]): Reply {
	if (!rows.length) return { text: "No pending approvals.", private: true };
	const lines = ["Pending approvals"];
	for (const row of rows) {
		const label = row.runtime === "tool" ? row.command : row.runtime;
		const age = Math.max(0, Date.now() - row.requestedAt);
		lines.push(
			[
				`- \`${row.id}\``,
				`\`${redact(label)}\``,
				row.reason,
				`requested ${formatDuration(age)} ago`,
				row.expiresAt ? `expires in ${formatDuration(Math.max(0, row.expiresAt - Date.now()))}` : undefined,
			]
				.filter((item): item is string => typeof item === "string")
				.join(" — "),
		);
	}
	lines.push("", "Use `approve <approval-id>` or `deny <approval-id>`.");
	return { text: lines.join("\n"), private: true };
}

export function renderThreadStatus(input: {
	active?: { id: string; state: string; trace: string | null; updatedAt: number };
	turns: Array<{ id: string; state: string; trace: string | null; updatedAt: number }>;
	calls: Array<{ id: string; tool: string; state: string; command: string | null; updatedAt: number }>;
	approvals: Array<{
		id: string;
		callId: string;
		command: string;
		runtime: string;
		reason: string;
		state: string;
		requestedAt: number;
	}>;
	lock?: { owner: string; expiresAt: number };
}): Reply {
	const lines = ["Thread status"];
	lines.push(input.active ? `Active: \`${input.active.state}\`` : "Active: none");
	if (input.approvals.length) {
		lines.push("", "Pending approvals:");
		for (const row of input.approvals) {
			const label = row.runtime === "tool" ? row.command : row.runtime;
			lines.push(`- \`${label}\` — ${row.reason}`);
		}
	}
	if (input.calls.length) {
		lines.push("", "Calls needing attention:");
		for (const row of input.calls)
			lines.push(`- \`${row.tool}\` — ${row.state}${row.command ? ` — \`${redact(row.command)}\`` : ""}`);
	}
	if (input.lock) lines.push("", `Thread is busy for another ${Math.max(0, input.lock.expiresAt - Date.now())}ms.`);
	if (!input.approvals.length && !input.calls.length) lines.push("", "Nothing needs action.");
	return { text: lines.join("\n"), private: true };
}

export function renderCall(input: {
	callId: string;
	state: string;
	code?: number;
	out?: string;
	err?: string;
	ms?: number;
	approvalId?: string;
	reason?: string;
	command?: string;
	runtime?: string;
	approvers?: string[];
}): Reply {
	if (input.state === "pending_approval") {
		const command = input.command ? redact(input.command) : undefined;
		const showCommand = command && input.runtime !== "tool";
		return {
			text: [
				"*Approval required*",
				input.reason ?? "Policy requires approval.",
				showCommand ? ["", "Command:", codeBlock(command)].join("\n") : undefined,
				input.approvers?.length ? `Approvers: ${input.approvers.join(", ")}` : undefined,
				"Use the buttons below to continue.",
			]
				.filter((line): line is string => typeof line === "string")
				.join("\n"),
			approval: input.approvalId
				? {
						id: input.approvalId,
						callId: input.callId,
						command: command ?? "",
						runtime: input.runtime ?? "",
						reason: input.reason ?? "policy",
						allowed: input.approvers ?? [],
					}
				: undefined,
		};
	}
	if (input.state === "unauthorized") {
		return {
			text: [
				"You are not allowed to approve this action.",
				input.approvers?.length ? `Allowed approvers: ${input.approvers.join(", ")}` : undefined,
			]
				.filter((line): line is string => typeof line === "string")
				.join("\n"),
			private: true,
		};
	}
	if (input.state === "blocked") {
		return {
			text:
				input.reason === "denied"
					? "Action rejected."
					: ["Action blocked", input.reason ?? "Policy blocked this action."].join("\n"),
		};
	}
	return {
		text: [
			`Result: \`${input.state}\`${typeof input.code === "number" ? ` exit=${input.code}` : ""}${
				typeof input.ms === "number" ? ` ${input.ms}ms` : ""
			}`,
			input.out ? ["", "Output:", codeBlock(input.out)].join("\n") : undefined,
			input.err ? ["", "Error:", codeBlock(input.err)].join("\n") : undefined,
		]
			.filter((line): line is string => typeof line === "string")
			.join("\n"),
	};
}

function codeBlock(value: string): string {
	return ["```", value, "```"].join("\n");
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
