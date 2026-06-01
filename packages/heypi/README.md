<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/heypi-white.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/heypi-black.png">
    <img alt="heypi" src="docs/assets/heypi-black.png" width="320">
  </picture>
</p>

# @hunvreus/heypi

Chat-agent framework for running [Pi](https://github.com/earendil-works/pi) in Slack, Discord, Telegram, and webhook workflows.

heypi adds the production shell around an agent: adapters, approvals, scoped runtime tools, persisted threads, memory, scoped skills, encrypted secret handoff, generated-file attachments, scheduling, admin UI, and CLI diagnostics.

## Install

Requirements:

- Node.js 22 or newer.
- Optional for document conversion: Python 3 plus `uv`, or Python 3 with MarkItDown already installed.

```bash
npm install @hunvreus/heypi
```

## Quickstart

```ts
import { agentFrom, createHeypi, runHeypi, slack, workspace } from "@hunvreus/heypi";

const app = createHeypi({
	state: { root: "./state" },
	adapters: [
		slack({
			botToken: process.env.SLACK_BOT_TOKEN!,
			appToken: process.env.SLACK_APP_TOKEN!,
		}),
	],
	agent: agentFrom("./agent", { model: "openai/gpt-5-mini" }),
	runtime: { root: workspace("./workspace") },
});

await runHeypi(app);
```

`OPENAI_API_KEY` is read by Pi through its normal provider auth path. Pass `model` explicitly or set `HEYPI_MODEL`; heypi does not pick a model implicitly.

For production, also configure access rules, approvers, state storage, and runtime/network policy.

## Agent Folder

`agentFrom("./agent")` loads this convention:

```text
agent/
  SOUL.md
  AGENTS.md
  SYSTEM.md
  skills/
  extensions/
```

- `SOUL.md`: identity, role, and voice.
- `AGENTS.md`: operating rules and standing instructions.
- `SYSTEM.md`: advanced full runtime-prompt override. Most agents should not need it.
- `skills/` and `extensions/`: Pi skills/extensions for this agent.

You can also pass `soul`, `prompt`, `context`, `skills`, `extensions`, and `tools` in code. heypi injects basic provider, channel, thread, and sender context automatically.

## Core Concepts

### Adapters

Built-in adapters:

```ts
import { discord, slack, telegram, webhook } from "@hunvreus/heypi";
```

Slack, Telegram, and Discord support allowlists, streaming, approvals, cancel/status commands, attachments, and busy-thread handling. Webhook exposes a generic JSON HTTP API for trusted internal systems.

Guides:

- [`docs/CHAT.md`](docs/CHAT.md): shared chat behavior
- [`docs/SLACK.md`](docs/SLACK.md): Slack setup
- [`docs/TELEGRAM.md`](docs/TELEGRAM.md): Telegram setup
- [`docs/DISCORD.md`](docs/DISCORD.md): Discord setup
- [`docs/WEBHOOK.md`](docs/WEBHOOK.md): webhook HTTP API

### Runtime Tools

heypi exposes Pi-compatible tools for runtime work:

```text
bash, read, write, edit, grep, find, ls, attach, history
```

`just-bash` is the built-in default runtime. It gives agents a virtual bash environment with runtime-backed file/search tools. `host-bash` and `guarded-bash` run on the host and should be used only in trusted deployments.

Optional runtime providers:

- [`@hunvreus/heypi-runtime-docker`](https://www.npmjs.com/package/@hunvreus/heypi-runtime-docker): experimental Docker provider. Requires Docker CLI and a running Docker daemon.
- [`@hunvreus/heypi-runtime-gondolin`](https://www.npmjs.com/package/@hunvreus/heypi-runtime-gondolin): experimental Gondolin VM provider. Requires Node.js 23.6+ and QEMU.

See [`docs/EXTENDING.md`](docs/EXTENDING.md) for custom tools and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for runtime boundaries.

### Tools And Approvals

`coreTools()` configures built-in tools. `bash` uses command confirmation by default; file/search tools run without approval unless you configure them differently.

```ts
import { agentFrom, commandConfirm, coreTools } from "@hunvreus/heypi";

agentFrom("./agent", {
	model: "openai/gpt-5-mini",
	tools: [
		...coreTools({
			bash: {
				confirm: commandConfirm({
					allow: [/^curl -I https:\/\/status\.example\.com\b/],
					approve: [/\bmake deploy\b/],
					block: [/\bgh repo delete\b/],
				}),
			},
			write: false,
			edit: false,
		}),
	],
});
```

Custom tool code runs as trusted host-side JavaScript. If a custom tool needs sandboxed command/file work, call `ctx.runtime` from its execution context.

See [`docs/EXTENDING.md`](docs/EXTENDING.md).

### Scope And Persistence

`scope` controls who shares runtime workspace, memory, skills, and generated files:

- `channel`: one scope per Slack channel, Telegram chat, Discord channel, or webhook channel.
- `user`: one scope per chat user.
- `adapter`: one scope for an adapter instance.
- `agent`: one scope for the configured agent.

Pi sessions, chat history, approvals, and active-run locks remain per thread. See [`docs/SCOPE.md`](docs/SCOPE.md).

### Memory, Skills, Secrets, And Attachments

These features are opt-in:

- Memory: durable scoped facts injected into future turns. See [`docs/MEMORY.md`](docs/MEMORY.md).
- Scoped skills: user-authored scoped procedures exposed through skill tools. See [`docs/SKILLS.md`](docs/SKILLS.md).
- Secret requests: encrypted browser handoff that stores secrets as scoped runtime files without putting plaintext in chat/model context. See [`docs/SECRETS.md`](docs/SECRETS.md).
- Attachments: inbound file handling and outbound generated-file uploads with `attach`. See [`docs/EXTENDING.md`](docs/EXTENDING.md).

### Scheduling

heypi can run proactive `cron` and `heartbeat` jobs. See [`docs/SCHEDULING.md`](docs/SCHEDULING.md).

### State And Admin

Every app needs `state.root`. If you do not pass a custom store, heypi uses SQLite at `<state.root>/heypi.db`.

The optional admin UI shows configuration, activity, threads, calls, approvals, jobs, and memory. See [`docs/ADMIN.md`](docs/ADMIN.md).

## CLI

The `heypi` CLI is for setup checks, diagnostics, migrations, admin links, and job inspection.

```bash
pnpm exec heypi check
npm exec heypi -- check
npx @hunvreus/heypi check
```

Common commands:

```bash
heypi check --db ./state/heypi.db
heypi slack check
heypi slack channels
heypi telegram observe
heypi discord observe
heypi admin link
heypi approvals list --db ./state/heypi.db
heypi jobs list --db ./state/heypi.db --agent slack-devops
```

The CLI loads `./.env` by default when it exists. Pass `--env <path>` to use a different env file. See [`docs/CLI.md`](docs/CLI.md).

## Examples

- [`examples/slack-devops`](https://github.com/hunvreus/heypi/tree/main/examples/slack-devops): Slack DevOps assistant with runtime tools, runbooks, memory, secrets, SSH host inventory, and approvals.
- [`examples/discord-project`](https://github.com/hunvreus/heypi/tree/main/examples/discord-project): Discord assistant with a channel-scoped Gondolin VM, memory, scoped skills, secret requests, and generated-file attachments.
- [`examples/telegram-workout`](https://github.com/hunvreus/heypi/tree/main/examples/telegram-workout): Telegram fitness coach with saved profile/plan and heartbeat check-ins.
- [`examples/webhook-github-docker`](https://github.com/hunvreus/heypi/tree/main/examples/webhook-github-docker): GitHub issue automation with webhook input, Docker repo inspection, and trusted GitHub writeback.

## Docs

- [`docs/CHAT.md`](docs/CHAT.md): shared Slack, Telegram, and Discord behavior
- [`docs/SLACK.md`](docs/SLACK.md): Slack setup
- [`docs/TELEGRAM.md`](docs/TELEGRAM.md): Telegram setup
- [`docs/DISCORD.md`](docs/DISCORD.md): Discord setup
- [`docs/WEBHOOK.md`](docs/WEBHOOK.md): webhook HTTP API
- [`docs/SCOPE.md`](docs/SCOPE.md): scope model and filesystem layout
- [`docs/MEMORY.md`](docs/MEMORY.md): durable memory
- [`docs/SKILLS.md`](docs/SKILLS.md): scoped skills
- [`docs/SECRETS.md`](docs/SECRETS.md): encrypted secret requests
- [`docs/SCHEDULING.md`](docs/SCHEDULING.md): cron and heartbeat jobs
- [`docs/CLI.md`](docs/CLI.md): setup and diagnostic commands
- [`docs/ADMIN.md`](docs/ADMIN.md): local admin panel
- [`docs/EXTENDING.md`](docs/EXTENDING.md): custom tools, adapters, stores, attachments
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): maintainer internals

## License

[MIT](LICENSE)
