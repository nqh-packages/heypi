# Discord Setup

heypi supports Discord through the gateway using `discord.js`.

## Create Bot

1. Open <https://discord.com/developers/applications>.
2. Create an application.
3. Add a bot under **Bot**.
4. Enable **Message Content Intent**.
5. Copy the bot token:

```bash
DISCORD_BOT_TOKEN=...
```

Check:

```bash
pnpm exec heypi discord check --env .env
```

Generate an invite URL:

```bash
pnpm exec heypi discord invite --client-id <application-id>
```

The check command also prints an invite URL using the bot identity.

## Configure Adapter

```ts
discord({
  token: process.env.DISCORD_BOT_TOKEN!,
  allow: {
    guilds: ["123456789012345678"],
    channels: ["234567890123456789"],
    users: ["345678901234567890"],
    dms: true,
  },
  trigger: "mention",
  threadTrigger: "message",
});
```

Required gateway intents:

- Guilds
- Guild Messages
- Direct Messages
- Message Content

## Discover IDs

List visible text channels:

```bash
pnpm exec heypi discord channels --env .env
```

Observe a delivered message:

```bash
pnpm exec heypi discord observe --env .env
```

Then send a DM or post in a channel the bot can read. The CLI prints guild, channel, and user IDs:

```text
guild: 123456789012345678 (Example Server)
channel: 234567890123456789 (ops)
user: 345678901234567890 (alice)
target: { adapter: "discord", channel: "234567890123456789" }
```

Use the user ID in `approval.approvers`:

```bash
HEYPI_APPROVERS=345678901234567890
```

An empty or omitted `approval.approvers` list means any user in the chat scope can approve tool calls.

## Inbound Access

Discord decides which events heypi receives through bot invite, gateway intents, channel permissions, and DM availability. heypi's `allow` config only filters events after Discord delivers them.

Defaults:

- omitted `allow` accepts all delivered events
- omitted `guilds`, `channels`, or `users` accepts all delivered events for that dimension
- `channels` applies to non-DM channels only
- `dms` defaults to `true`; set `dms: false` to drop DMs
- `trigger` defaults to `"mention"` for guild channels
- `trigger: "message"` makes every allowed channel message run the agent
- accepted DMs always run the agent
- Discord thread channel messages do not need to mention the bot by default
- `threadTrigger` defaults to `"message"` for Discord threads; set `threadTrigger: "mention"` to require a mention in follow-up thread replies

`allow.users` controls who may talk to the bot. `approval.approvers` controls who may approve tool calls. `jobs.scope` and `jobs.target` only affect scheduled outbound jobs.

## Streaming And Delivery

```ts
discord({
  token: process.env.DISCORD_BOT_TOKEN!,
  streaming: true,
});
```

`streaming` is off by default. Use `true` for sensible defaults, or pass `{ intervalMs, minChars, maxFailures }` to tune draft edits. Discord progress defaults to an immediate `Thinking...` message when streaming is off. Progress messages are suppressed while streaming is active to avoid duplicate visible replies. Set `progress: false` to disable progress.

Discord delivery calls are serialized by default. Provider rate limits are retried with backoff. Ambiguous timeouts are not retried for non-idempotent sends such as new messages or file uploads. Most apps do not need to configure this. If Discord needs slower pacing, set `delivery: { intervalMs: 500 }`; use `delivery: false` only for development or custom transport control.

## Approvals

Approval cards use Discord buttons. Approved and rejected actions edit the original approval message, keep the approval details visible, and remove the buttons:

```text
✅ Approval `approval-id` approved by <@123>.
```

```text
⛔ Approval `approval-id` rejected by <@123>.
```

Private failure paths, such as unauthorized approval attempts, are sent to the actor and are not prefixed as successful approvals.

Expired approval clicks keep the approval details visible, mark the approval expired, and remove the buttons.

## Conversation Model

Discord thread channels are modeled as their own conversation because Discord gives them their own channel ID. Normal channels and DMs use the channel or DM ID as the conversation key. Discord server ID is stored as the provider `team` value.

## Common Failures

`Used disallowed intents` usually means Message Content Intent is not enabled in the Discord Developer Portal.

No messages in channels usually means the bot lacks channel permissions, Message Content Intent is disabled, or the message did not mention the bot while `trigger` is `"mention"`.
