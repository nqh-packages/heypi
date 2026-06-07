# AGENTS.md

## Scope

This file governs `packages/heypi-runtime-gondolin/`.

## Local responsibility

This package owns the Gondolin VM runtime provider for heypi. It maps runtime scopes to warm VMs and implements bash, file, search, status, restart, stop, and cleanup behavior through Gondolin.

## Working method

| Situation | Required method |
| --- | --- |
| Changing command execution | Prove commands run through the scoped VM, not the host filesystem. |
| Changing file/search tools | Preserve mounted workspace containment and file size/scan limits. |
| Changing lifecycle behavior | Test VM reuse, timeout/crash cleanup, idle stop, and active-command protection. |
| Changing secrets or mounts | Keep secret exposure narrow and update README examples with the exact boundary. |

## Current gotchas

| Gotcha | Why it matters | Correct action |
| --- | --- | --- |
| Gondolin requires Node 23.6+ and QEMU. | Local verification may fail for environment reasons unrelated to provider logic. | Report missing QEMU/Node evidence separately from test failures. |
| VM egress is open by default. | This differs from Docker's documented safe network default. | Call out network behavior when changing runtime docs or examples. |
| `dist/` is generated package output. | Manual edits will be overwritten by build. | Edit `src/`, then run the build. |

## Local verification

| Change | Command |
| --- | --- |
| Runtime provider source | `pnpm --filter @hunvreus/heypi-runtime-gondolin run check` |
| Runtime behavior | `pnpm --filter @hunvreus/heypi-runtime-gondolin run test` |
| Package output | `pnpm --filter @hunvreus/heypi-runtime-gondolin run build:package` |
