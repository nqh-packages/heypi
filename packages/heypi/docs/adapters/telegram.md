# Telegram

The Telegram adapter lets a heypi agent receive Telegram DMs, groups, channels, and forum topics through long polling.

heypi's `allow` config filters what the bot responds to; Telegram controls what it receives. Configure bot membership and group privacy mode in Telegram first.

For a runnable example, see [`examples/telegram-workout`](https://github.com/hunvreus/heypi/tree/main/examples/telegram-workout).

## Options

`telegram()` accepts the shared options documented in [Adapters](index.md), plus Telegram-specific options below.

| Option | Required | Description |
| --- | --- | --- |
| `token` | Yes | Telegram bot token from BotFather. |
| `name` | No | Adapter name. Defaults to `telegram`. |
| `apiUrl` | No | Telegram API URL override. Only use for custom Telegram-compatible gateways. |
| `pollTimeoutSeconds` | No | Long-poll timeout. Defaults to `25`. |
| `allow.chats` | No | Telegram chat IDs where the bot may respond. Applies to groups, channels, and forum topics. |
| `allow.users` | No | Telegram user IDs allowed to talk to the bot. |
| `allow.dms` | No | Whether DMs are accepted. |
| `trigger` | No | `"mention"` or `"message"` for top-level group/channel messages. Defaults to `"mention"` in groups and channels. |
| `threadTrigger` | No | `"message"`, `"mention"`, or `false` for forum topic replies. Defaults to `"message"` in active topics. |
| `progress` | No | Progress message behavior, or `false`. |
| `streaming` | No | Draft reply streaming behavior. |
| `delivery` | No | Telegram send pacing/retry behavior, or `false`. |
| `parseMode` | No | Outbound formatting: `"MarkdownV2"`, `"HTML"`, or `"plain"`. Defaults to `"plain"`. |
| `stt` | No | Local voice transcription config. Explicit opt-in via `stt.enabled`. |
| `photoOnlyText` | No | Synthetic inbound text for photo-only messages. Defaults to `Photo received`. |

Telegram has no Slack user group or Discord role equivalent in heypi. With:

```ts
allow: { chats: ["CHAT1"], users: ["U1"] }
```

`U1` can use the bot in `CHAT1`. DMs require `allow.dms`.

## Setup

### Manual setup

1. Message `@BotFather` in Telegram.
2. Run `/newbot`.
3. Pick a name and username.
4. Copy the bot token into your environment.
5. Add the bot to the chats where it should respond.

Group privacy mode can limit what the bot receives. Use BotFather's `/setprivacy` when the bot needs all group messages instead of only commands and mentions.

### CLI-assisted setup

Verify the token and observe delivered updates:

```bash
npx @hunvreus/heypi telegram check --env .env
npx @hunvreus/heypi telegram observe --env .env
npx @hunvreus/heypi telegram setup-commands --env .env
```

Telegram cannot enumerate chats. `telegram observe` waits for a delivered DM, group, channel, or forum message and prints chat ID, user ID, and copy-paste `allow.chats` / `allow.users` snippets for config and job targets.

`telegram observe` deletes any active webhook for that bot token before polling. Do not run webhook mode or another long-polling process with the same token while observing.

`telegram setup-commands` registers BotFather command menus via `setMyCommands`. Pass `--config ./config.json` with `{ "telegram": { "commands": [{ "command": "status", "description": "Show thread status" }] } }` or use built-in defaults.

## Local voice transcription (STT)

Voice and audio notes require explicit opt-in:

```ts
telegram({
	token: process.env.TELEGRAM_BOT_TOKEN!,
	stt: { enabled: true, local: { modelPath: process.env.HEYPI_STT_MODEL_PATH! } },
})
```

Host prerequisites: `ffmpeg`, `whisper-cpp` or `whisper-cli`, and a ggml model file. Configure `HEYPI_STT_MODEL_PATH` and optionally `HEYPI_LOCAL_STT_COMMAND` in the environment. When prerequisites are missing, users receive a concise unavailable message (AE4) instead of a silent failure.

STT runs on a bounded background queue so long polling stays responsive. When the queue is full, users receive a busy message.

## Approval visibility in groups

Pending approvals in shared chats show a redacted group stub without approval IDs, command details, or actionable buttons. Approvers receive the full approval UI by DM. Group-resolved edits show actor and outcome only.

## Config

```ts
createHeypi({
	state: { root: "./state" },
	adapters: [
		telegram({
			token: process.env.TELEGRAM_BOT_TOKEN!,
			allow: {
				chats: ["-1001234567890"],
				users: ["8734062810"],
				dms: true,
			},
			trigger: "mention",
			threadTrigger: "message",
		}),
	],
});
```

Common environment variables:

| Variable | Required when | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Always | Bot token from BotFather. |

For app-wide config such as `state`, `runtime`, and `agent`, see [Configuration](../configuration/index.md).

## CLI

| Command | Purpose |
| --- | --- |
| `npx @hunvreus/heypi telegram check [--env .env]` | Verify Telegram bot credentials. |
| `npx @hunvreus/heypi telegram observe [--env .env] [--timeout 60]` | Wait for a delivered Telegram update and print IDs/target snippets. |
| `npx @hunvreus/heypi telegram setup-commands [--env .env] [--config ./config.json]` | Register BotFather command menus. |

## Webhook ingress (Bot API)

Long polling remains the default. For production HTTPS deployments, enable Telegram Bot API webhook mode on the shared HTTP listener:

```ts
createHeypi({
	http: { host: "0.0.0.0", port: 3000 },
	adapters: [
		telegram({
			token: process.env.TELEGRAM_BOT_TOKEN!,
			mode: "webhook",
			webhook: {
				url: process.env.HEYPI_TELEGRAM_WEBHOOK_URL!,
				secret: process.env.HEYPI_TELEGRAM_WEBHOOK_SECRET!,
			},
		}),
	],
});
```

Webhook mode requires `HEYPI_TELEGRAM_WEBHOOK_URL`, a cryptographically random `HEYPI_TELEGRAM_WEBHOOK_SECRET` (min 32 bytes), and shared `http` config. Poll and webhook modes are mutually exclusive.

## Group automation (opt-in)

All group automation defaults are off:

```ts
telegram({
	groupAutomation: {
		welcome: true,
		flood: { windowMs: 10_000, maxMessages: 5 },
		linkFilter: { allowlist: ["example.com"] },
		spam: { maxRepeated: 3, maxMentions: 8 },
		editedMessages: "ignore",
		auditDrops: false,
	},
})
```

Gate order: allow → trigger → flood → link → spam → content/STT → agent. Moderation drops are silent (debug log); unsupported types that would reach the agent receive a concise user-visible reply.

## Custom markup and callbacks

Built-in approval/progress callbacks use the `heypi:` namespace. Outbound messages may include `replyMarkup` for custom inline keyboards; agent-supplied callback data is rewritten to short `heypi:custom:` tokens when needed.

## Polls and location

Scheduled or agent replies may include `poll: { question, options }` on `Outbound`. Location messages include structured coordinates in inbound `data.location`.
