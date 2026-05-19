import { resolve } from "node:path";
import type { RuntimeConfig } from "../config.js";
import { dockerBash } from "./docker-bash.js";
import { hostBash } from "./host-bash.js";
import { justBash } from "./just-bash.js";
import { safeRoot } from "./path.js";
import type { Runtime, RuntimeName } from "./types.js";

export function runtimeName(input?: string): RuntimeName {
	const value = (input ?? "just-bash").trim().toLowerCase();
	if (value === "just-bash" || value === "docker-bash" || value === "guarded-bash" || value === "host-bash")
		return value;
	throw new Error(`unknown runtime: ${value}`);
}

export function createRuntime(input: RuntimeConfig & { app: string; agent?: string }): Runtime {
	const name = runtimeName(input.name);
	const root = safeRoot({ root: input.root, app: input.app, agent: input.agent });
	if (name === "just-bash")
		return justBash({ root, timeoutMs: input.timeoutMs, options: input.justBash, limits: input.limits });
	if (name === "docker-bash")
		return dockerBash({ root, timeoutMs: input.timeoutMs, limits: input.limits, config: input.docker });
	return hostBash({
		root,
		guarded: name === "guarded-bash",
		timeoutMs: input.timeoutMs,
		env: input.hostEnv,
		limits: input.limits,
	});
}

export function workspace(path = "./workspace"): string {
	return resolve(path);
}
