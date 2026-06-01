<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/heypi/docs/assets/heypi-white.png">
    <source media="(prefers-color-scheme: light)" srcset="packages/heypi/docs/assets/heypi-black.png">
    <img alt="heypi" src="packages/heypi/docs/assets/heypi-black.png" width="320">
  </picture>
</p>

# heypi

Chat agents for your team, with approvals, durable state, and sandboxed tools. Slack, Discord, Telegram, and webhooks.

This repo contains the core heypi package, optional runtime providers, and runnable examples.

## Start Here

- Use heypi in an app: [`packages/heypi`](packages/heypi/README.md)
- Add Docker runtime isolation: [`packages/heypi-runtime-docker`](packages/heypi-runtime-docker/README.md)
- Add Gondolin VM runtime isolation: [`packages/heypi-runtime-gondolin`](packages/heypi-runtime-gondolin/README.md)

## What Is In This Repo

| Path | What it is |
| --- | --- |
| [`packages/heypi`](packages/heypi) | Core framework: adapters, tools, approvals, state, admin UI, scheduler, CLI. |
| [`packages/heypi-runtime-docker`](packages/heypi-runtime-docker) | Experimental Docker runtime provider with one warm container per runtime scope. |
| [`packages/heypi-runtime-gondolin`](packages/heypi-runtime-gondolin) | Experimental Gondolin runtime provider with one warm VM per runtime scope. |
| [`examples/slack-devops`](examples/slack-devops) | Slack DevOps assistant with runtime tools, runbooks, memory, secrets, SSH host inventory, and approvals. |
| [`examples/discord-project`](examples/discord-project) | Discord project assistant with Gondolin, memory, scoped skills, secret requests, and file attachments. |
| [`examples/telegram-workout`](examples/telegram-workout) | Telegram fitness coach with saved profile/plan and heartbeat check-ins. |
| [`examples/webhook-github-docker`](examples/webhook-github-docker) | GitHub issue automation with webhook input, Docker repo inspection, and trusted GitHub writeback. |

## Local Development

```bash
pnpm install
pnpm run check
pnpm run typecheck
pnpm run test
pnpm run build:all
```

Run examples:

```bash
pnpm run dev:slack
pnpm run dev:discord
pnpm run dev:telegram
pnpm run dev:webhook
```

Dry-run packages before publishing:

```bash
pnpm run pack:dry:packages
pnpm run publish:dry:packages
```

## License

[MIT](LICENSE)
