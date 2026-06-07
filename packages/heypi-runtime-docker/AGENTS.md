# AGENTS.md

## Scope

This file governs `packages/heypi-runtime-docker/`.

## Local responsibility

This package owns the Docker runtime provider for heypi. It maps runtime scopes to warm Docker containers and implements bash, file, search, status, restart, stop, and cleanup behavior through Docker.

## Working method

| Situation | Required method |
| --- | --- |
| Changing command execution | Prove commands run through `docker exec`, not host shortcuts. |
| Changing file/search tools | Preserve container workspace containment and file size/scan limits. |
| Changing lifecycle behavior | Test cached container reuse, recreation, idle stop, and active-command protection. |
| Changing options | Update README option examples and package tests together. |

## Current gotchas

| Gotcha | Why it matters | Correct action |
| --- | --- | --- |
| Docker daemon access is host-trusted. | Anyone controlling Docker can affect the host. | Do not present Docker as a security boundary stronger than the local daemon. |
| Network defaults are security-sensitive. | Agent commands should not get egress unless explicitly configured. | Keep `network: "none"` as the documented safe default. |
| `dist/` is generated package output. | Manual edits will be overwritten by build. | Edit `src/`, then run the build. |

## Local verification

| Change | Command |
| --- | --- |
| Runtime provider source | `pnpm --filter @hunvreus/heypi-runtime-docker run check` |
| Runtime behavior | `pnpm --filter @hunvreus/heypi-runtime-docker run test` |
| Package output | `pnpm --filter @hunvreus/heypi-runtime-docker run build:package` |
