import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export const DEFAULT_WORKSPACE_ROOT = "./state";
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_WRITE_BYTES = 256 * 1024;

const SECRET_PATTERNS = [
	/\b[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*\S+/i,
	/\b[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*[:=]\s*\S+/i,
	/\b[A-Za-z0-9_]*PASSWORD[A-Za-z0-9_]*\s*[:=]\s*\S+/i,
	/\bsk-[A-Za-z0-9_-]{16,}\b/,
	/\b[A-Za-z0-9+]{32,}={0,2}\b/,
];

export type FrontmatterValue = string | boolean | string[] | undefined;
export type Frontmatter = Record<string, FrontmatterValue>;

export type MarkdownFile = {
	path: string;
	meta: Frontmatter;
	body: string;
};

export type WorkspaceOptions = {
	root?: string;
	repoRoot?: string;
	now?: () => Date;
	maxFileBytes?: number;
	maxWriteBytes?: number;
};

export type CreateTaskInput = {
	title: string;
	body: string;
	owner?: string;
	related?: string[];
	recurring?: boolean;
	schedule?: RecurringSchedule;
};

export type RecurringSchedule = {
	cadence: string;
	timezone: string;
	next_due: string;
	owner: string;
	enabled: boolean;
	safe_execution_note: string;
};

export type WorkspaceContext = {
	profile: string;
	learnings: string[];
	tasks: string[];
	reports: string[];
	dashboard: string;
};

type ArtifactKind = "tasks" | "reports" | "documents" | "memory" | "dashboard" | "handoffs";

export class WorkspaceError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
	}
}

export class CofounderWorkspace {
	private readonly root: string;
	private readonly repoRoot: string;
	private readonly maxFileBytes: number;
	private readonly maxWriteBytes: number;
	private readonly now: () => Date;

	constructor(options: WorkspaceOptions = {}) {
		this.repoRoot = resolve(options.repoRoot ?? process.cwd());
		this.root = resolve(this.repoRoot, options.root ?? DEFAULT_WORKSPACE_ROOT);
		this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
		this.maxWriteBytes = options.maxWriteBytes ?? MAX_WRITE_BYTES;
		this.now = options.now ?? (() => new Date());
	}

	getRoot(): string {
		return this.root;
	}

	repoPath(path: string): string {
		return relative(this.repoRoot, path).split(sep).join("/");
	}

	async ensureRoot(): Promise<void> {
		await mkdir(this.root, { recursive: true });
	}

	async saveProfile(input: Record<string, string>): Promise<MarkdownFile> {
		const body = Object.entries(input)
			.filter(([, value]) => value.trim().length > 0)
			.map(([key, value]) => `- ${key}: ${value}`)
			.join("\n");
		return this.writeMarkdown(
			"memory",
			"profile.md",
			{ updated: this.now().toISOString(), kind: "profile" },
			`# Company profile\n\n${body}\n`,
		);
	}

	async appendLearning(input: { text: string; kind?: string }): Promise<MarkdownFile> {
		const title = input.text.split(/\s+/).slice(0, 8).join(" ");
		const path = `learnings/${slug(title)}.md`;
		return this.writeMarkdown(
			"memory",
			path,
			{ created: this.now().toISOString(), kind: input.kind ?? "learning" },
			`# ${title}\n\n${input.text}\n`,
		);
	}

	async createTask(input: CreateTaskInput): Promise<MarkdownFile> {
		const base = slug(input.title);
		const path = await this.uniquePath("tasks", `${base}.md`);
		const meta: Frontmatter = {
			title: input.title,
			created: this.now().toISOString(),
			owner: input.owner,
			related: input.related,
			recurring: input.recurring,
		};
		if (input.schedule) {
			Object.assign(meta, input.schedule);
		}
		return this.writeMarkdown("tasks", path, meta, `# ${input.title}\n\n${input.body}\n`);
	}

	async createReport(input: { title: string; type: string; body: string }): Promise<MarkdownFile> {
		const date = this.now().toISOString().slice(0, 10);
		const path = `${date}-${slug(input.title)}.md`;
		return this.writeMarkdown(
			"reports",
			path,
			{ title: input.title, type: input.type, created: this.now().toISOString() },
			`# ${input.title}\n\n${input.body}\n`,
		);
	}

	async writeDocument(input: { path: string; title: string; body: string }): Promise<MarkdownFile> {
		const name = ensureMarkdown(input.path);
		return this.writeMarkdown(
			"documents",
			name,
			{ title: input.title, updated: this.now().toISOString() },
			`# ${input.title}\n\n${input.body}\n`,
		);
	}

	async writeDashboard(input: { section: string; body: string }): Promise<MarkdownFile> {
		return this.writeMarkdown(
			"dashboard",
			`${slug(input.section)}.md`,
			{ section: input.section, updated: this.now().toISOString() },
			`# ${input.section}\n\n${input.body}\n`,
		);
	}

	async writeHandoff(input: { title: string; body: string; meta?: Frontmatter }): Promise<MarkdownFile> {
		const path = `${this.now().toISOString().replace(/[:.]/g, "-")}-${slug(input.title)}.md`;
		return this.writeMarkdown(
			"handoffs",
			path,
			{ title: input.title, created: this.now().toISOString(), ...input.meta },
			`# ${input.title}\n\n${input.body}\n`,
		);
	}

	async readDocument(path: string): Promise<MarkdownFile> {
		return this.readMarkdown("documents", ensureMarkdown(path));
	}

	async readMarkdown(kind: ArtifactKind, path: string): Promise<MarkdownFile> {
		const fullPath = await this.safePath(kind, path, { forWrite: false });
		const size = (await stat(fullPath)).size;
		if (size > this.maxFileBytes)
			throw new WorkspaceError(`File is too large: ${this.repoPath(fullPath)}`, "file_too_large");
		const raw = await readFile(fullPath, "utf8");
		const parsed = parseMarkdown(raw);
		return { path: this.repoPath(fullPath), ...parsed };
	}

	async writeMarkdown(kind: ArtifactKind, path: string, meta: Frontmatter, body: string): Promise<MarkdownFile> {
		const raw = renderMarkdown(meta, body);
		if (Buffer.byteLength(raw, "utf8") > this.maxWriteBytes)
			throw new WorkspaceError("Markdown write exceeds workspace limit.", "write_too_large");
		const redacted = redactSecrets(raw);
		if (redacted !== raw) throw new WorkspaceError("Refusing to persist secret-shaped content.", "secret_detected");
		const fullPath = await this.safePath(kind, path, { forWrite: true });
		await mkdir(dirname(fullPath), { recursive: true });
		const tempPath = `${fullPath}.${process.pid}.tmp`;
		await writeFile(tempPath, raw, "utf8");
		await rename(tempPath, fullPath);
		return { path: this.repoPath(fullPath), meta, body };
	}

	async list(kind: ArtifactKind): Promise<MarkdownFile[]> {
		await this.ensureRoot();
		const directory = await this.safePath(kind, ".", { forWrite: true });
		try {
			await access(directory, constants.F_OK);
		} catch {
			return [];
		}
		const entries: string[] = [];
		for await (const entry of walk(directory)) entries.push(entry);
		const files = entries.filter((entry) => extname(entry) === ".md").sort();
		return Promise.all(files.map((file) => this.readMarkdown(kind, relative(directory, file))));
	}

	async context(): Promise<WorkspaceContext> {
		const [profile, learnings, tasks, reports, dashboard] = await Promise.all([
			this.readOptional("memory", "profile.md"),
			this.list("memory"),
			this.list("tasks"),
			this.list("reports"),
			this.list("dashboard"),
		]);
		return {
			profile: profile?.body.trim() || "No company profile saved.",
			learnings: learnings
				.filter((item) => item.path.includes("/learnings/"))
				.slice(-5)
				.map(summary),
			tasks: tasks.slice(0, 10).map((item) => `${item.meta.title ?? heading(item.body)} (${item.path})`),
			reports: reports.slice(-5).map((item) => `${item.meta.title ?? heading(item.body)} (${item.path})`),
			dashboard: dashboard.map(summary).join("\n") || "No dashboard notes saved.",
		};
	}

	async readOptional(kind: ArtifactKind, path: string): Promise<MarkdownFile | undefined> {
		try {
			return await this.readMarkdown(kind, path);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			return undefined;
		}
	}

	async makeSymlinkForTest(kind: ArtifactKind, target: string, linkPath: string): Promise<void> {
		const fullPath = await this.safePath(kind, linkPath, { forWrite: true, allowMissingParent: true });
		await mkdir(dirname(fullPath), { recursive: true });
		await symlink(target, fullPath);
	}

	private async uniquePath(kind: ArtifactKind, desired: string): Promise<string> {
		let candidate = desired;
		let suffix = 2;
		while (await this.exists(kind, candidate)) {
			const base = desired.replace(/\.md$/, "");
			candidate = `${base}-${suffix}.md`;
			suffix += 1;
		}
		return candidate;
	}

	private async exists(kind: ArtifactKind, path: string): Promise<boolean> {
		try {
			await this.safePath(kind, path, { forWrite: false });
			return true;
		} catch {
			return false;
		}
	}

	private async safePath(
		kind: ArtifactKind,
		path: string,
		options: { forWrite: boolean; allowMissingParent?: boolean },
	): Promise<string> {
		await this.ensureRoot();
		if (
			path.includes("\0") ||
			path.includes("%2f") ||
			path.includes("%2F") ||
			path.includes("%5c") ||
			path.includes("%5C")
		) {
			throw new WorkspaceError("Path contains encoded or invalid separators.", "unsafe_path");
		}
		const base = resolve(this.root, kind);
		const target = resolve(base, path);
		if (!inside(base, target)) throw new WorkspaceError("Path escapes the co-founder workspace.", "workspace_escape");
		if (path === ".") {
			await mkdir(base, { recursive: true });
			return base;
		}
		if (options.forWrite) {
			const parent = dirname(target);
			if (!inside(base, parent))
				throw new WorkspaceError("Path escapes the co-founder workspace.", "workspace_escape");
			if (!options.allowMissingParent) await mkdir(parent, { recursive: true });
			await assertNoSymlinkChain(base, target);
			return target;
		}
		await assertNoSymlinkChain(base, target);
		const [realBase, real] = await Promise.all([realpathSafe(base), realpathSafe(target)]);
		if (!inside(resolve(realBase), resolve(real)))
			throw new WorkspaceError("Resolved path escapes the co-founder workspace.", "workspace_escape");
		return target;
	}
}

export function parseMarkdown(raw: string): Omit<MarkdownFile, "path"> {
	if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
	const end = raw.indexOf("\n---\n", 4);
	if (end === -1) throw new WorkspaceError("Malformed frontmatter: missing closing fence.", "malformed_frontmatter");
	const lines = raw.slice(4, end).split("\n");
	const meta: Frontmatter = {};
	for (const line of lines) {
		if (!line.trim()) continue;
		const [key, ...rest] = line.split(":");
		if (!key || rest.length === 0)
			throw new WorkspaceError(`Malformed frontmatter line: ${line}`, "malformed_frontmatter");
		const value = rest.join(":").trim();
		meta[key.trim()] = parseValue(value);
	}
	return { meta, body: raw.slice(end + 5) };
}

export function renderMarkdown(meta: Frontmatter, body: string): string {
	const lines = Object.entries(meta)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}: ${renderValue(value)}`);
	return `---\n${lines.join("\n")}\n---\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function slug(input: string): string {
	const value = input
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72);
	return value || `item-${hash(input).slice(0, 8)}`;
}

export function redactSecrets(input: string): string {
	return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED_SECRET]"), input);
}

export function hash(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function ensureMarkdown(path: string): string {
	return path.endsWith(".md") ? path : `${path}.md`;
}

function renderValue(value: FrontmatterValue): string {
	if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
	if (typeof value === "boolean") return value ? "true" : "false";
	return JSON.stringify(value ?? "");
}

function parseValue(value: string): FrontmatterValue {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value.startsWith("[") && value.endsWith("]")) {
		const trimmed = value.slice(1, -1).trim();
		if (!trimmed) return [];
		return trimmed.split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
	}
	return value.replace(/^"|"$/g, "");
}

function inside(base: string, target: string): boolean {
	const rel = relative(base, target);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

async function realpathSafe(path: string): Promise<string> {
	const { realpath } = await import("node:fs/promises");
	return realpath(path);
}

async function assertNoSymlinkChain(base: string, target: string): Promise<void> {
	let current = target;
	const parts: string[] = [];
	while (inside(base, current) && current !== base) {
		parts.push(current);
		current = dirname(current);
	}
	for (const part of parts.reverse()) {
		try {
			const info = await lstat(part);
			if (info.isSymbolicLink()) throw new WorkspaceError(`Refusing symlink path: ${part}`, "symlink_refused");
		} catch (error) {
			if (error instanceof WorkspaceError) throw error;
		}
	}
}

async function* walk(directory: string): AsyncGenerator<string> {
	const { readdir } = await import("node:fs/promises");
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) yield* walk(fullPath);
		else yield fullPath;
	}
}

function summary(file: MarkdownFile): string {
	return `${file.meta.title ?? file.meta.kind ?? heading(file.body)}: ${file.body.replace(/\s+/g, " ").trim().slice(0, 160)}`;
}

function heading(body: string): string {
	return (
		body
			.split("\n")
			.find((line) => line.startsWith("# "))
			?.replace(/^#\s+/, "") ?? "Untitled"
	);
}
