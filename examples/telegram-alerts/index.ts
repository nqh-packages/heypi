import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { agentFrom, createHeypi, runHeypi, telegram, webhook, workspace } from "@hunvreus/heypi";

loadEnv(".env");

function loadEnv(path: string): void {
	if (existsSync(path)) loadEnvFile(path);
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing env var: ${name}`);
	return value;
}

function list(name: string): string[] {
	return (process.env[name] ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

const app = createHeypi({
	state: { root: "./state" },
	http: {
		host: "127.0.0.1",
		port: Number(process.env.HEYPI_WEBHOOK_PORT ?? 3000),
	},
	adapters: [
		webhook({
			name: "alerts",
			secret: required("HEYPI_WEBHOOK_SECRET"),
		}),
		telegram({
			token: required("TELEGRAM_BOT_TOKEN"),
			allow: { chats: list("HEYPI_TELEGRAM_CHATS"), users: list("HEYPI_TELEGRAM_USERS") },
			parseMode: "plain",
		}),
	],
	agent: agentFrom("./agent", {
		model: "openai/gpt-5-mini",
	}),
	runtime: {
		root: workspace("./workspace"),
	},
});

await runHeypi(app);
