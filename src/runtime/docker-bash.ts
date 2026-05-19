import { homedir } from "node:os";
import type { DockerConfig, RuntimeConfig } from "../config.js";
import { hostBash } from "./host-bash.js";
import { executeProcess } from "./shell.js";
import type { Runtime } from "./types.js";

const PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const WORKDIR = "/workspace";

export function dockerBash(input: {
	root: string;
	timeoutMs?: number;
	limits?: RuntimeConfig["limits"];
	config?: DockerConfig;
}): Runtime {
	const files = hostBash({ root: input.root, timeoutMs: input.timeoutMs, limits: input.limits });
	const timeoutMs = input.timeoutMs ?? 120_000;
	const config = input.config ?? {};
	const image = config.image ?? "ubuntu:24.04";
	return {
		...files,
		name: "docker-bash",
		bash: async ({ command, timeoutMs: override, signal }) => {
			const args = [
				"run",
				"--rm",
				"--workdir",
				WORKDIR,
				"--volume",
				`${input.root}:${WORKDIR}`,
				"--network",
				config.network ?? "none",
				...userArgs(config),
				...envArgs({
					PATH,
					HOME: "/tmp",
					LANG: "C.UTF-8",
					LC_ALL: "C.UTF-8",
					TERM: "xterm-256color",
					...config.env,
				}),
				...(config.args ?? []),
				image,
				"bash",
				"-lc",
				command,
			];
			return await executeProcess("docker", args, {
				cwd: input.root,
				timeoutMs: override ?? timeoutMs,
				env: { PATH: process.env.PATH ?? PATH, HOME: homedir() },
				signal,
			});
		},
	};
}

function envArgs(env: Record<string, string>): string[] {
	const out: string[] = [];
	for (const [key, value] of Object.entries(env)) out.push("--env", `${key}=${value}`);
	return out;
}

function userArgs(config: DockerConfig): string[] {
	if (config.user === false) return [];
	const user = config.user ?? defaultUser();
	return user ? ["--user", user] : [];
}

function defaultUser(): string | undefined {
	if (typeof process.getuid !== "function" || typeof process.getgid !== "function") return undefined;
	return `${process.getuid()}:${process.getgid()}`;
}
