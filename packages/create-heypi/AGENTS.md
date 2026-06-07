# AGENTS.md

## Scope

This file governs `packages/create-heypi/`.

## Local responsibility

`create-heypi` owns the app scaffolder used by `npm create heypi@latest`. It generates runnable heypi apps, prompts, tools, `.env.example`, and local `.env` files.

## Working method

| Situation | Required method |
| --- | --- |
| Changing generated files | Update scaffolder tests to assert the generated app contract, not just strings in helper functions. |
| Adding an adapter/runtime option | Update prompts, generated imports, package dependencies, env output, README, and tests together. |
| Changing env generation | Never overwrite an existing `.env`; keep generated `.env.example` safe and non-secret by default. |
| Changing model choices | Keep provider env placeholders aligned with the selected model provider. |

## Current gotchas

| Gotcha | Why it matters | Correct action |
| --- | --- | --- |
| Generated `.env` can contain random webhook secrets. | Tests must prove non-empty directory and secret generation behavior without leaking real secrets. | Use temp directories and deterministic assertions around shape only. |
| The package has a `bin/` entrypoint. | Build output and package metadata must stay publishable. | Run the package build before claiming CLI changes are complete. |

## Local verification

| Change | Command |
| --- | --- |
| Any scaffolder source change | `pnpm --filter create-heypi run check` |
| Generated app behavior | `pnpm --filter create-heypi run test` |
| Publish/build shape | `pnpm --filter create-heypi run build` |
