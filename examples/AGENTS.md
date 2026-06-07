# AGENTS.md

## Scope

This file governs `examples/` unless a nested `AGENTS.md` is closer to the changed file.

## Local responsibility

Examples are runnable reference apps for heypi. They should prove real app shapes without becoming hidden framework code.

## Working method

| Situation | Required method |
| --- | --- |
| Adding an example | Add a root `dev:*` or `start:*` script only if the example is meant to be run from the repo root. |
| Changing an example env var | Update the example `.env.example`, README, and root `.env.schema` if the code reads the variable directly. |
| Adding durable local state | Keep state under the example folder and covered by root `.gitignore` patterns. |
| Adding tools | Keep tool code small and example-owned; shared framework behavior belongs in `packages/heypi/`. |
| Changing prompt files under `agent/` | Treat those as runtime agent behavior, not repo law for coding agents. |

## Current gotchas

| Gotcha | Why it matters | Correct action |
| --- | --- | --- |
| Example `agent/AGENTS.md` files are prompts. | They govern runtime agents, not coding agents editing this repo. | Put coding-agent instructions in `examples/AGENTS.md` or a nested app-level `AGENTS.md`. |
| `examples/*/state/` and `examples/*/workspace/` are ignored runtime output. | Committing them can leak local data. | Do not stage runtime state, local DBs, workspaces, or logs. |
| Existing examples vary in complexity. | A simple example should not absorb advanced DevOps/co-founder patterns accidentally. | Keep changes local to the example's product purpose. |

## Local verification

| Example | Command |
| --- | --- |
| Slack DevOps | `pnpm run dev:slack` for manual smoke; root tests cover shared framework behavior. |
| Discord Gondolin | `pnpm run dev:discord` for manual smoke; runtime package tests cover provider behavior. |
| Telegram workout | `pnpm run dev:telegram` for manual smoke. |
| Telegram co-founder | `pnpm run test:telegram:cofounder` |
| Webhook GitHub Docker | `pnpm run dev:webhook` for manual smoke; Docker runtime tests cover provider behavior. |
