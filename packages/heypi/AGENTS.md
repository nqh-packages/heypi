# AGENTS.md

## Scope

This file governs `packages/heypi/`.

## Local responsibility

`packages/heypi/` owns the public framework package: app lifecycle, config, adapters, approvals, runtime tool wiring, state/store, memory, skills, secrets, scheduling, admin UI, CLI, docs, Drizzle migrations, and the package build.

## Canonical owners

| Concern | Owner path |
| --- | --- |
| Public exports | `src/api.ts`, `src/index.ts` |
| App lifecycle and security posture warnings | `src/app.ts` |
| Agent/model config and prompt loading | `src/config.ts` |
| Chat adapters | `src/io/` |
| Runtime contracts and built-in workspace runtime | `src/runtime/` |
| State and SQLite store | `src/state.ts`, `src/store/`, `drizzle/` |
| CLI behavior | `src/cli.ts` |
| Admin UI | `src/admin/` |
| User docs | `docs/` |
| Maintainer architecture | `ARCHITECTURE.md` |

## Working method

| Situation | Required method |
| --- | --- |
| Changing adapter behavior | Check whether Slack, Discord, Telegram, and webhook need aligned behavior or an explicit channel-specific exception. |
| Changing tool execution | Verify both raw Pi tool behavior and heypi custom tool behavior. |
| Changing state/store/migrations | Add or update Drizzle SQL and migration tests. Never hand-edit generated schema snapshots without confirming the migration owner. |
| Changing admin UI | Keep server-rendered HTML escaped by default and preserve URL-backed navigation state. |
| Changing CLI output | Keep human output concise and keep machine-readable output stable where JSON/raw modes exist. |

## Current gotchas

| Gotcha | Why it matters | Correct action |
| --- | --- | --- |
| `agentFrom` requires a model or `HEYPI_MODEL`. | Tests and examples fail if config assumes an implicit model. | Pass a model explicitly in app factories or document `HEYPI_MODEL`. |
| Runtime startup errors are user-facing. | Raw daemon/container errors can leak confusing internals. | Use configured runtime messages and tests that hide startup details. |
| Attachment and secret paths are scope-sensitive. | Cross-thread or cross-scope reads leak data. | Preserve scope keys and symlink/path containment tests. |

## Local verification

| Change | Command |
| --- | --- |
| Package source or docs build inputs | `pnpm --filter @hunvreus/heypi run typecheck` |
| Package behavior | `pnpm --filter @hunvreus/heypi run test` |
| Public package build | `pnpm --filter @hunvreus/heypi run build` |
| CLI/docs references | Run the nearest `packages/heypi/tests/*` file plus `pnpm --filter @hunvreus/heypi run test` before completion. |
