import { agentFrom, coreTools, createHeypi, type HeypiConfig, telegram, workspace } from "@hunvreus/heypi";
import { createCofounderTools, type ToolFactoryOptions } from "./tools/index.js";

export const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
export const STATE_ROOT = "./state";

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

export function createTelegramCofounderConfig(
	env: Env = process.env,
	toolOptions: ToolFactoryOptions = {},
): HeypiConfig {
	return {
		state: { root: STATE_ROOT },
		adapters: [
			telegram({
				token: requiredEnv(env, "TELEGRAM_BOT_TOKEN"),
				allow: {
					chats: listEnv(env, "HEYPI_TELEGRAM_CHATS"),
					dms: true,
					users: listEnv(env, "HEYPI_TELEGRAM_USERS"),
				},
				trigger: "message",
				streaming: true,
			}),
		],
		agent: agentFrom("./agent", {
			model: env.HEYPI_MODEL ?? DEFAULT_MODEL,
			tools: [...coreTools(), ...createCofounderTools(toolOptions)],
		}),
		runtime: { root: workspace("./workspace") },
	};
}

export function createTelegramCofounderApp(env: Env = process.env, toolOptions: ToolFactoryOptions = {}) {
	return createHeypi(createTelegramCofounderConfig(env, toolOptions));
}
