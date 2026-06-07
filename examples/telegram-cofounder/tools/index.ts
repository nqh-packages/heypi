import { tool } from "@hunvreus/heypi";
import { Type } from "@sinclair/typebox";
import { capabilityReport, classifyCapability } from "./capabilities.js";
import { prepareEngineeringHandoff } from "./handoff.js";
import { type ActorAccess, mutatingAllowed } from "./policy.js";
import { routeBrowser, routeMetaAds, routeResearch, routeTwitter } from "./routes.js";
import { type CodexRunner, FakeCodexRunner } from "./runner.js";
import { SkillCatalog, type SkillSource } from "./skill-catalog.js";
import { CofounderWorkspace, type RecurringSchedule } from "./workspace.js";

export type ToolFactoryOptions = {
	workspace?: CofounderWorkspace;
	access?: ActorAccess;
	skills?: SkillSource[];
	runner?: CodexRunner;
	trustedWorkspaceRoots?: string[];
};

export function createCofounderTools(options: ToolFactoryOptions = {}) {
	const workspace = options.workspace ?? new CofounderWorkspace();
	const access = options.access ?? { trusted: false, localDev: process.env.HEYPI_LOCAL_DEV_MUTATIONS === "true" };
	const catalog = new SkillCatalog({ skills: options.skills ?? [] });
	const runner =
		options.runner ??
		new FakeCodexRunner({ started: false, command: "hermes-codex", error: "no runtime runner configured" });
	const trustedWorkspaceRoots = options.trustedWorkspaceRoots ?? [process.cwd()];

	return [
		tool({
			name: "get_context",
			description: "Read compact company profile, memory, tasks, reports, and dashboard context.",
			parameters: Type.Object({}),
			execute: async () => JSON.stringify(await workspace.context(), null, 2),
		}),
		tool<{ name: string; offer: string; customer: string; focus: string; constraint: string }>({
			name: "save_company_profile",
			description: "Save company profile facts after the operator provides them.",
			parameters: Type.Object({
				name: Type.String(),
				offer: Type.String(),
				customer: Type.String(),
				focus: Type.String(),
				constraint: Type.String(),
			}),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const file = await workspace.saveProfile(input);
				await workspace.appendLearning({
					text: `Company profile saved for ${input.name}: focus=${input.focus}; constraint=${input.constraint}`,
				});
				return `saved company profile: ${file.path}\nNext: pick the highest-leverage operating task.`;
			},
		}),
		tool<{ text: string; kind?: string }>({
			name: "append_learning",
			description: "Persist a decision, lesson, operator preference, or reusable context note.",
			parameters: Type.Object({ text: Type.String(), kind: Type.Optional(Type.String()) }),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const file = await workspace.appendLearning(input);
				return `saved learning: ${file.path}`;
			},
		}),
		tool<{ title: string; body: string; owner?: string; related?: string[] }>({
			name: "create_task",
			description: "Create a non-duplicate Markdown task or return concrete clarification options.",
			parameters: Type.Object({
				title: Type.String(),
				body: Type.String(),
				owner: Type.Optional(Type.String()),
				related: Type.Optional(Type.Array(Type.String())),
			}),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const ambiguous = ambiguityOptions(input.title, input.body);
				if (ambiguous) return ambiguous;
				const duplicate = await findDuplicate(workspace, input.title);
				if (duplicate) return `existing task found: ${duplicate.path}`;
				const file = await workspace.createTask(input);
				return `created task: ${file.path}`;
			},
		}),
		tool<{
			title: string;
			body: string;
			cadence: string;
			timezone: string;
			next_due: string;
			owner: string;
			enabled: boolean;
			safe_execution_note: string;
		}>({
			name: "create_recurring_task",
			description: "Create a recurring task template with safe schedule metadata only.",
			parameters: Type.Object({
				title: Type.String(),
				body: Type.String(),
				cadence: Type.String(),
				timezone: Type.String(),
				next_due: Type.String(),
				owner: Type.String(),
				enabled: Type.Boolean(),
				safe_execution_note: Type.String(),
			}),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const schedule: RecurringSchedule = input;
				const unsafe = validateSchedule(schedule);
				if (unsafe) return `blocked: ${unsafe}`;
				const file = await workspace.createTask({
					title: input.title,
					body: input.body,
					owner: input.owner,
					recurring: true,
					schedule,
				});
				return `created recurring template: ${file.path}`;
			},
		}),
		tool<{ path: string; title: string; body: string }>({
			name: "write_document",
			description: "Create or update a local company document.",
			parameters: Type.Object({ path: Type.String(), title: Type.String(), body: Type.String() }),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const file = await workspace.writeDocument(input);
				return `wrote document: ${file.path}`;
			},
		}),
		tool<{ title: string; type: string; body: string }>({
			name: "create_report",
			description: "Create a local business report.",
			parameters: Type.Object({ title: Type.String(), type: Type.String(), body: Type.String() }),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const file = await workspace.createReport(input);
				return `created report: ${file.path}`;
			},
		}),
		tool<{ section: string; body: string }>({
			name: "update_dashboard",
			description: "Record asks, owner replies, task completions, current focus, or alerts.",
			parameters: Type.Object({ section: Type.String(), body: Type.String() }),
			execute: async (input) => {
				const decision = mutatingAllowed(access);
				if (!decision.allowed) return `blocked: ${decision.reason}`;
				const file = await workspace.writeDashboard(input);
				return `updated dashboard: ${file.path}`;
			},
		}),
		tool({
			name: "list_capabilities",
			description: "List direct tools, selected routes, unavailable operations, and excluded features.",
			parameters: Type.Object({}),
			execute: async () => capabilityReport(),
		}),
		tool<{ request: string }>({
			name: "classify_capability",
			description: "Classify a requested capability as direct, selected-route, unavailable, or excluded.",
			parameters: Type.Object({ request: Type.String() }),
			execute: async ({ request }) => classifyCapability(request),
		}),
		tool<{ request: string; confirmed?: boolean }>({
			name: "route_browser",
			description: "Prepare browser automation through agent-browser without claiming it ran.",
			parameters: Type.Object({ request: Type.String(), confirmed: Type.Optional(Type.Boolean()) }),
			execute: async ({ request, confirmed }) => routeBrowser(workspace, request, { ...access, confirmed }),
		}),
		tool<{ request: string; confirmed?: boolean }>({
			name: "route_twitter",
			description: "Prepare X/Twitter work through bird without claiming it ran.",
			parameters: Type.Object({ request: Type.String(), confirmed: Type.Optional(Type.Boolean()) }),
			execute: async ({ request, confirmed }) => routeTwitter(workspace, request, { ...access, confirmed }),
		}),
		tool<{ request: string }>({
			name: "route_research",
			description: "Create a Markdown research task prompt and handoff metadata.",
			parameters: Type.Object({ request: Type.String() }),
			execute: async ({ request }) => routeResearch(workspace, request, access),
		}),
		tool<{ request: string }>({
			name: "recommend_meta_ads",
			description: "Create the selected Meta Ads growth recommendation task without Polsia claims.",
			parameters: Type.Object({ request: Type.String() }),
			execute: async ({ request }) => routeMetaAds(workspace, request, access),
		}),
		tool<{ title: string; request: string; targetCwd: string; confirmed?: boolean }>({
			name: "route_engineering",
			description:
				"Prepare or start a Hermes Codex engineering handoff after selected skill-copy validation and approval.",
			parameters: Type.Object({
				title: Type.String(),
				request: Type.String(),
				targetCwd: Type.String(),
				confirmed: Type.Optional(Type.Boolean()),
			}),
			execute: async (input) => {
				const result = await prepareEngineeringHandoff(workspace, catalog, runner, {
					...input,
					access: { ...access, confirmed: input.confirmed },
					trustedWorkspaceRoots,
				});
				return result.text;
			},
		}),
	];
}

async function findDuplicate(workspace: CofounderWorkspace, title: string) {
	const target = normalize(title);
	const tasks = await workspace.list("tasks");
	return tasks.find((task) => normalize(String(task.meta.title ?? "")) === target);
}

function normalize(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function ambiguityOptions(title: string, body: string): string | undefined {
	const text = `${title} ${body}`.toLowerCase();
	if (
		text.split(/\s+/).filter(Boolean).length > 5 &&
		!/\b(tomorrow|today|owner|customer|metric|deadline|repo|path)\b/.test(text)
	)
		return undefined;
	if (/fix|improve|handle|do this|make it better|growth/.test(text)) {
		return [
			"clarify before creating task:",
			"1. Define the customer-visible outcome and owner.",
			"2. Turn it into an investigation task with acceptance evidence.",
			"3. Split it into a research task plus an implementation task.",
		].join("\n");
	}
	return undefined;
}

function validateSchedule(schedule: RecurringSchedule): string | undefined {
	if (!schedule.timezone) return "recurring templates require timezone";
	if (!schedule.next_due) return "recurring templates require next_due";
	if (!schedule.owner) return "recurring templates require owner";
	if (!schedule.safe_execution_note) return "recurring templates require safe_execution_note";
	if (
		/every\s+\d+\s*(second|minute)|loop|daemon|forever|automatic execution/i.test(
			`${schedule.cadence} ${schedule.safe_execution_note}`,
		)
	) {
		return "recurring templates store schedule metadata only; in-process loops and automatic execution are excluded";
	}
	return undefined;
}
