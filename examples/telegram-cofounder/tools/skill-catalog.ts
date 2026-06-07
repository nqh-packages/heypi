import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { hash, redactSecrets, WorkspaceError } from "./workspace.js";

export type SkillSource = {
	name: string;
	root: string;
};

export type CopiedSkill = {
	name: string;
	source: string;
	target: string;
	sha256: string;
	bytes: number;
};

export type CopyManifest = {
	skills: CopiedSkill[];
};

export type SkillCatalogOptions = {
	skills: SkillSource[];
	maxFileBytes?: number;
};

export class SkillCatalog {
	private readonly skills: SkillSource[];
	private readonly maxFileBytes: number;

	constructor(options: SkillCatalogOptions) {
		this.skills = options.skills.map((skill) => ({ name: skill.name, root: resolve(skill.root) }));
		this.maxFileBytes = options.maxFileBytes ?? 128 * 1024;
	}

	async copySelected(names: string[], targetRoot: string): Promise<CopyManifest> {
		const copied: CopiedSkill[] = [];
		for (const name of names) {
			const skill = this.skills.find((candidate) => candidate.name === name);
			if (!skill) throw new WorkspaceError(`Missing selected skill: ${name}`, "missing_skill");
			const info = await lstat(skill.root);
			if (info.isSymbolicLink()) throw new WorkspaceError(`Refusing symlink skill root: ${name}`, "symlink_refused");
			const skillTarget = resolve(targetRoot, "skills", name);
			await mkdir(skillTarget, { recursive: true });
			for await (const source of walk(skill.root)) {
				const rel = relative(skill.root, source);
				const target = resolve(skillTarget, rel);
				if (!inside(skillTarget, target))
					throw new WorkspaceError("Skill copy target escaped bundle.", "workspace_escape");
				const fileInfo = await lstat(source);
				if (fileInfo.isSymbolicLink())
					throw new WorkspaceError(`Refusing symlink skill file: ${rel}`, "symlink_refused");
				if (fileInfo.size > this.maxFileBytes)
					throw new WorkspaceError(`Skill file too large: ${name}/${rel}`, "file_too_large");
				const content = await readFile(source, "utf8");
				if (redactSecrets(content) !== content)
					throw new WorkspaceError(`Secret-shaped content in selected skill: ${name}/${rel}`, "secret_detected");
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content, "utf8");
				copied.push({
					name,
					source: `${basename(skill.root)}/${rel}`.split(sep).join("/"),
					target: relative(targetRoot, target).split(sep).join("/"),
					sha256: hash(content),
					bytes: Buffer.byteLength(content, "utf8"),
				});
			}
		}
		return { skills: copied };
	}
}

async function* walk(directory: string): AsyncGenerator<string> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else yield full;
	}
}

function inside(base: string, target: string): boolean {
	const rel = relative(base, target);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}
