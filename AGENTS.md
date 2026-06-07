# AGENTS.md

## Scope

This file governs the repository unless a nested `AGENTS.md` is closer to the changed file.

## Project identity

This repo is the heypi workspace: a TypeScript framework for Pi-backed team chat agents, optional runtime providers, a scaffolder, and runnable examples.

## Canonical owners

| Concern | Owner |
| --- | --- |
| Public framework API, adapters, approvals, state, scheduler, admin, CLI, docs | `packages/heypi/` |
| Docker runtime provider | `packages/heypi-runtime-docker/` |
| Gondolin runtime provider | `packages/heypi-runtime-gondolin/` |
| App scaffolder and generated app templates | `packages/create-heypi/` |
| Runnable example apps | `examples/` |
| Environment schema ownership | `.env.schema` |
| Release notes | `CHANGELOG.md` |

## Scoped instructions

| Path | Local instructions |
| --- | --- |
| `packages/heypi/` | See `packages/heypi/AGENTS.md`. |
| `packages/create-heypi/` | See `packages/create-heypi/AGENTS.md`. |
| `packages/heypi-runtime-docker/` | See `packages/heypi-runtime-docker/AGENTS.md`. |
| `packages/heypi-runtime-gondolin/` | See `packages/heypi-runtime-gondolin/AGENTS.md`. |
| `examples/` | See `examples/AGENTS.md`. |

## Architecture rules

- Keep adapter/channel behavior aligned across Slack, Discord, Telegram, and webhook when the behavior is shared.
- Keep route handlers and app entrypoints thin; put validation, permissions, persistence, and side effects in focused modules.
- Treat generated `dist/`, runtime `state/`, runtime `workspace/`, local databases, and logs as derived output. Do not edit or commit them unless the package build intentionally publishes generated artifacts and the diff is expected.
- Root `package.json` scripts are the canonical workspace commands. Add new root scripts only for stable app/package entrypoints.
- Environment variables must be declared in `.env.schema` when code reads them directly. `.env.example` remains documentation for runnable examples.

## Communication
- Keep answers concise, technical, and to the point.
- Do not use filler or glazing openers (for example: "You're right to push back", "You're totally right", "Great idea").
- Keep responses MECE (mutually exclusive, collectively exhaustive).
- If only part of requested scope is implemented, state exactly what was not included.

## Naming
- Prefer short, one-word names for tables, columns, code symbols, and files when clarity is preserved.
- Use multi-word names only when needed for clarity.

## Architecture and modules
- Keep API route handlers thin.
- Put validation, permissions, and database behavior in server-side service modules.
- Back data models with Drizzle schemas and migrations.
- Prefer function-first modules and small files over class-heavy designs.
- Keep module responsibilities narrow: orchestration in one place, side effects in clear adapters.
- Define explicit boundary contracts (typed inputs/outputs, error shape, side effects) and keep interface surfaces small and stable.
- When changing adapter/channel behavior, align Slack, Telegram, Discord, and webhook where the behavior is shared. If a change is intentionally channel-specific, state why and keep the exception documented in code or docs.

## Code style
- Keep control flow explicit. Favor readable loops and state transitions over clever abstractions.
- Prefer simple data structures (`Map`, arrays, plain objects) and deterministic behavior.
- Use practical error handling and logs with clear failure paths.
- Prefer small, single-purpose composable helpers over large multi-responsibility utilities.
- Normalize loose/variant inputs at module edges into one canonical internal shape; keep normalization deterministic and centralized.

## TypeScript discipline
- Use strict TypeScript at boundaries: explicit types for public APIs, typed imports, and narrow interfaces.
- Do not use `any` unless absolutely necessary. If used, keep scope narrow and document why.
- Check dependency type definitions before guessing external API shapes.
- Do not use inline/dynamic type imports. Use standard top-level imports.
- Do not remove or downgrade behavior to silence type errors from outdated dependencies; prefer upgrading/fixing the dependency path.

## Change management
- Ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless explicitly requested.
- Keep user-facing input bindings/configurable controls data-driven, not hardcoded.
- After finishing a large feature or removing a feature, review changed code and direct dependencies for refactors, dead code removal, and simplifications.

## Docs and comments
- Prefer self-explanatory code. Add comments only for non-obvious intent, invariants, edge cases, and tradeoffs.
- Do not add comments that only restate the code.
- Use sentence case for Markdown headings: capitalize only the first word and proper nouns/acronyms.
- Do not use inline code or HTML `<code>` tags in Markdown headings.
- Public modules/functions should have short doc comments describing contract: inputs, outputs, side effects, and failure conditions.
- Keep docs close to code: update relevant README/docs when behavior, config, or workflow changes.
- Keep examples/snippets aligned with current behavior when code changes.
- If scope is partial, document what was intentionally not implemented.
- Remove stale comments/docs during refactors.
- Keep technical prose concise and actionable; avoid narrative fluff.

## Changelog
- Keep the root `CHANGELOG.md` updated using Keep a Changelog format: https://keepachangelog.com/en/1.1.0/
- Put implemented-but-unreleased changes under `## [Unreleased]`; backlog and incomplete work belong in `TODO.md`.
- When cutting a release, move `[Unreleased]` entries under a version heading and create a fresh empty `## [Unreleased]`.
- Do not maintain per-package changelogs unless explicitly requested.

## Testing rules

| Change | Required verification |
| --- | --- |
| Any TypeScript/source change | `pnpm run check` and `pnpm run typecheck` |
| Core package behavior | `pnpm --filter @hunvreus/heypi run test` |
| Runtime provider behavior | `pnpm --filter "./packages/heypi-runtime-*" run test` or the specific package test |
| Scaffolder behavior | `pnpm --filter create-heypi run test` |
| Telegram co-founder example | `pnpm run test:telegram:cofounder` |
| Full completion gate | `varlock audit`, `qlty check .`, `pnpm run check`, `pnpm run typecheck`, and `pnpm run test` |

## Current enforcement state

| Gate | State |
| --- | --- |
| Biome | `pnpm run check` and `pnpm run fmt` |
| TypeScript | `pnpm run typecheck` |
| Tests | `pnpm run test` |
| Env governance | `varlock audit` against `.env.schema` |
| Version/env hooks | Git commit hooks enforce root package version and Varlock coverage |
| Qlty | Initialized in `.qlty/qlty.toml`. Use `qlty check .` for repo-level security/scanner coverage alongside native gates. Native Biome remains the lint/format owner because the Qlty Biome adapter currently scans `.qlty/out` transient YAML and fails on empty files. |
