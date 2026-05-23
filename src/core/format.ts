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
			"Commands:",
			"- bash <shell command>",
			"- approvals: list pending approvals",
			"- approve <approval-id>",
			"- deny <approval-id>",
			"- cancel <turn-id>",
			"- status: show this thread status",
			"- status <call-id>: show one call status",
			"- any other text: handled by the assistant",
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
	const busyMs = input.lock ? Math.max(0, input.lock.expiresAt - Date.now()) : 0;
	lines.push(
		input.active
			? `Active: \`${input.active.state}\` for ${formatDuration(Date.now() - input.active.updatedAt)}`
			: "Active: none",
	);
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
	if (input.lock) lines.push("", `Busy for up to ${formatDuration(busyMs)}.`);
	if (input.active && !input.approvals.length && !input.calls.length) {
		lines.push("", "Current activity: waiting for model or tool output.");
	} else if (!input.active && !input.lock && !input.approvals.length && !input.calls.length) {
		lines.push("", "Nothing needs action.");
	}
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
	instructions?: boolean;
}): Reply {
	if (input.state === "pending_approval") {
		const command = input.command ? redact(input.command) : undefined;
		const tool = input.runtime === "tool" && command ? toolCall(command) : undefined;
		const showCommand = command && input.runtime !== "tool";
		const reason = input.reason ? redact(input.reason) : "Policy requires approval.";
		return {
			text: [
				"*Approval required*",
				reason,
				...(tool ? toolLines(tool) : []),
				showCommand ? ["", "Command:", codeBlock(command)].join("\n") : undefined,
				input.approvers?.length ? `Approvers: ${input.approvers.join(", ")}` : undefined,
				input.instructions === false ? undefined : "Use the buttons below to continue.",
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
					? `Action \`${input.callId}\` rejected.`
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

function toolCall(value: string): { name: string; args: Record<string, unknown> } | undefined {
	const index = value.indexOf(" ");
	if (index <= 0) return { name: value, args: {} };
	const name = value.slice(0, index);
	const raw = value.slice(index + 1).trim();
	if (!raw) return { name, args: {} };
	try {
		const parsed = JSON.parse(raw) as unknown;
		return {
			name,
			args:
				parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {},
		};
	} catch {
		return { name, args: { input: raw } };
	}
}

function toolLines(input: { name: string; args: Record<string, unknown> }): string[] {
	const lines = [""];
	const target = toolTarget(input.args);
	if (target) lines.push(`Target: ${target}`);
	if (typeof input.args.command === "string") lines.push("Command:", codeBlock(input.args.command));
	const rest = Object.fromEntries(
		Object.entries(input.args).filter(
			([key]) => key !== "command" && key !== "host" && key !== "hosts" && key !== "purpose",
		),
	);
	if (Object.keys(rest).length > 0) lines.push("Input:", codeBlock(JSON.stringify(rest, null, 2)));
	return lines;
}

function toolTarget(args: Record<string, unknown>): string | undefined {
	if (typeof args.host === "string") return `\`${args.host}\``;
	if (Array.isArray(args.hosts) && args.hosts.length > 0) {
		return args.hosts
			.filter((item): item is string => typeof item === "string")
			.map((item) => `\`${item}\``)
			.join(", ");
	}
	return undefined;
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
