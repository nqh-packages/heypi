import { agentFrom, coreTools, createHeypi, type HeypiConfig, telegram, workspace } from "@hunvreus/heypi";
import { createCofounderTools, type ToolFactoryOptions } from "./tools/index.js";
import type { ActorAccess } from "./tools/policy.js";

export const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
export const DEV_APP_LOCK_DRAIN_MS = 1_000;
export const DEFAULT_HOST_RUNTIME = "guarded-bash";
export const STATE_ROOT = "./state";
export const WORKSPACE_ROOT = "./workspace";

export type Env = Record<string, string | undefined>;

export function listEnv(env: Env, name: string): string[] {
	return (env[name] ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

export function requiredEnv(env: Env, name: string): string {
	const value = env[name];
	if (!value) throw new Error(`Missing env var: ${name}`);
	return value;
}

export function telegramBotToken(env: Env = process.env): string {
	const value = env === process.env ? process.env.TELEGRAM_BOT_TOKEN : env.TELEGRAM_BOT_TOKEN;
	if (!value) throw new Error("Missing env var: TELEGRAM_BOT_TOKEN");
	return value;
}

export function telegramChats(env: Env = process.env): string[] {
	const raw = env === process.env ? process.env.HEYPI_TELEGRAM_CHATS : env.HEYPI_TELEGRAM_CHATS;
	return listEnv({ HEYPI_TELEGRAM_CHATS: raw }, "HEYPI_TELEGRAM_CHATS");
}

export function telegramUsers(env: Env = process.env): string[] {
	const raw = env === process.env ? process.env.HEYPI_TELEGRAM_USERS : env.HEYPI_TELEGRAM_USERS;
	return listEnv({ HEYPI_TELEGRAM_USERS: raw }, "HEYPI_TELEGRAM_USERS");
}

export function telegramSttModelPath(env: Env = process.env): string | undefined {
	const raw = env === process.env ? process.env.HEYPI_STT_MODEL_PATH : env.HEYPI_STT_MODEL_PATH;
	return raw?.trim() || undefined;
}

export function devAppLock(env: Env = process.env): HeypiConfig["appLock"] {
	const appEnv = env === process.env ? process.env.APP_ENV : env.APP_ENV;
	const localDev = env === process.env ? process.env.HEYPI_LOCAL_DEV_MUTATIONS : env.HEYPI_LOCAL_DEV_MUTATIONS;
	if (appEnv === "development" || localDev === "true") return { drainMs: DEV_APP_LOCK_DRAIN_MS, replace: true };
	return undefined;
}

export function runtimeConfig(env: Env = process.env): HeypiConfig["runtime"] {
	const rawRoot = env === process.env ? process.env.HEYPI_RUNTIME_ROOT : env.HEYPI_RUNTIME_ROOT;
	const rawName = env === process.env ? process.env.HEYPI_RUNTIME_NAME : env.HEYPI_RUNTIME_NAME;
	if (!rawRoot) return { root: workspace(WORKSPACE_ROOT) };
	const name = rawName || DEFAULT_HOST_RUNTIME;
	if (name !== "just-bash" && name !== "guarded-bash" && name !== "host-bash")
		throw new Error(`Invalid HEYPI_RUNTIME_NAME: ${name}`);
	return { root: workspace(rawRoot), name };
}

export function trustedWorkspaceRoots(env: Env = process.env): string[] {
	const rawRoots = env === process.env ? process.env.HEYPI_TRUSTED_WORKSPACE_ROOTS : env.HEYPI_TRUSTED_WORKSPACE_ROOTS;
	const roots = (rawRoots ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return roots.length > 0 ? roots : [process.cwd()];
}

export function trustedOperatorAccess(env: Env = process.env): ActorAccess {
	return {
		trusted: telegramUsers(env).length > 0 || telegramChats(env).length > 0,
		localDev: env.HEYPI_LOCAL_DEV_MUTATIONS === "true",
	};
}

export function createTelegramCofounderConfig(
	env: Env = process.env,
	toolOptions: ToolFactoryOptions = {},
): HeypiConfig {
	const sttModelPath = telegramSttModelPath(env);
	return {
		state: { root: STATE_ROOT },
		adapters: [
			telegram({
				token: telegramBotToken(env),
				allow: {
					chats: telegramChats(env),
					dms: true,
					users: telegramUsers(env),
				},
				trigger: "message",
				streaming: true,
				stt: sttModelPath ? { enabled: true, local: { modelPath: sttModelPath } } : undefined,
			}),
		],
		agent: agentFrom("./agent", {
			model: env.HEYPI_MODEL ?? DEFAULT_MODEL,
			tools: [
				...coreTools(),
				...createCofounderTools({
					access: trustedOperatorAccess(env),
					trustedWorkspaceRoots: trustedWorkspaceRoots(env),
					...toolOptions,
				}),
			],
		}),
		runtime: runtimeConfig(env),
		appLock: devAppLock(env),
	};
}

export function createTelegramCofounderApp(env: Env = process.env, toolOptions: ToolFactoryOptions = {}) {
	return createHeypi(createTelegramCofounderConfig(env, toolOptions));
}
