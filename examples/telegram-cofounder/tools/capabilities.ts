export const SELECTED_SKILLS = ["agent-browser", "bird", "handoff", "codex"] as const;

export const EXCLUDED_FEATURES = [
	"bug reporting",
	"support tickets",
	"feature requests",
	"agent creation",
	"agent disablement",
	"email sending",
	"cold outreach",
	"image handoff",
	"domain guidance",
	"billing",
	"God Mode",
	"legal or retaliation advice",
];

export function capabilityReport(): string {
	return [
		"Direct local tools: profile, memory, Markdown tasks, recurring templates, reports, documents, dashboard, local DB/deployment records.",
		`Selected routes: ${SELECTED_SKILLS.join(", ")}.`,
		"Growth recommendation: Meta Ads pitch can be shaped as a task without Polsia pricing or targeting claims.",
		"Unavailable direct operations: browser execution, X/Twitter mutation, research execution, engineering/source/GitHub work, DB mutation, deploy commands.",
		`Excluded features: ${EXCLUDED_FEATURES.join(", ")}.`,
	].join("\n");
}

export function classifyCapability(request: string): "excluded" | "selected-route" | "direct" | "unavailable" {
	const text = request.toLowerCase();
	if (EXCLUDED_FEATURES.some((feature) => text.includes(feature.toLowerCase()))) return "excluded";
	if (/browser|tweet|twitter|x\/twitter|research|github|source|codex|engineering/.test(text)) return "selected-route";
	if (/profile|memory|task|recurring|report|document|dashboard|inbox|deployment|db|database/.test(text))
		return "direct";
	return "unavailable";
}
