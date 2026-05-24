# Slack Setup

heypi supports Slack Socket Mode and Node HTTP mode.

## Create App

1. Open <https://api.slack.com/apps>.
2. Create a new app from scratch.
3. Choose the target workspace.

## Bot Token Scopes

Add these bot scopes under **OAuth & Permissions**:

```text
app_mentions:read
channels:history
chat:write
chat:write.public
files:read
files:write
im:history
reactions:write
```

Install the app to the workspace and copy the bot token:

```bash
SLACK_BOT_TOKEN=<slack-bot-token>
```

## Signing Secret

HTTP mode requires Slack's signing secret so heypi can verify incoming Slack requests. Socket Mode receives events over the websocket authenticated by `SLACK_APP_TOKEN`, so a signing secret is not required for Socket Mode.

For HTTP mode, copy the signing secret under **Basic Information**:

```bash
SLACK_SIGNING_SECRET=...
```

## Local Development: Socket Mode

1. Enable **Socket Mode**.
2. Create an app-level token with `connections:write`.
3. Set:

```bash
SLACK_APP_TOKEN=<slack-app-token>
```

Use:

```ts
slack({
  botToken: process.env.SLACK_BOT_TOKEN!,
  mode: "socket",
  appToken: process.env.SLACK_APP_TOKEN!,
  allow: { channels: ["C123"] },
  trigger: "mention",
});
```

Check:

```bash
pnpm exec heypi slack check --env examples/slack-devops/.env
```

## Production: HTTP Mode

Configure Event Subscriptions and Interactivity with the same public URL:

```text
https://<host>/slack/events
```

Use:

```ts
slack({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  mode: "http",
  port: Number(process.env.PORT ?? 3000),
  path: "/slack/events",
  allow: { channels: ["C123"] },
  trigger: "mention",
});
```

HTTP mode registers Bolt's receiver on heypi's shared Node HTTP listener. It is for normal hosted Node services. If you run multiple Slack HTTP adapters in one app, give each adapter a unique `name` and `path`.

Generate a starter manifest:

```bash
pnpm exec heypi slack manifest --url https://<host>/slack/events
```

## Events

Subscribe to these bot events:

```text
app_mention
message.channels
message.im
```

For private channels, invite the bot to the channel and add private-channel scopes later if needed.

## Serverless Status

Cloudflare Workers and other Fetch API runtimes are not supported yet. Use Socket Mode for local development and HTTP mode for hosted Node services. Serverless support is planned, but it needs a complete Slack receiver, scheduler, storage, attachment, and deployment story before it should be used.

## Inbound Access

Slack decides which events heypi receives through app installation, OAuth scopes, event subscriptions, and channel membership. heypi's `allow` config only filters events after Slack delivers them. For channel messages, the Slack app must still be subscribed to the right events and invited to the channel; `allow.channels` does not make Slack send events.

```ts
slack({
  // ...tokens and mode
  allow: {
    teams: ["T123"],
    channels: ["C123"],
    users: ["U123"],
    dms: true,
  },
  trigger: "mention",
  threadTrigger: "message",
});
```

Defaults:

- omitted `allow` accepts all delivered events
- omitted `teams`, `channels`, or `users` accepts all delivered events for that dimension
- `channels` applies to non-DM channels only
- `dms` defaults to `true`; set `dms: false` to drop DMs
- `trigger` defaults to `"mention"` for channels
- `trigger: "message"` makes every allowed channel message run the agent
- accepted DMs always run the agent
- thread replies do not need to mention the bot by default
- `threadTrigger` defaults to `"message"` for threads; set `threadTrigger: "mention"` to require a mention in follow-up thread replies
- private Slack replies, including unauthorized approval/status replies, are posted back into the current thread when Slack provides a thread timestamp

`allow.users` controls who may talk to the bot. `approval.approvers` controls who may approve tool calls. `jobs.scope` and `jobs.target` only affect scheduled outbound jobs.

## Streaming And Delivery

```ts
slack({
  // ...tokens and mode
  streaming: true,
});
```

`streaming` is off by default. Use `true` for sensible defaults, or pass `{ intervalMs, minChars, maxFailures }` to tune draft edits. Slack still posts the configured progress message immediately and deletes or replaces it when the final reply is ready.

Slack progress defaults to an immediate `Working...` message. Top-level channel messages also get an `eyes` reaction. Thread replies, DMs, and approval continuations do not get the reaction. Set `progress: false` to disable progress, or pass `progress: { message: false }` to keep only the reaction where reactions apply.

Same-thread messages received while the bot is already working use the global `concurrency.busy` policy. The default is `steer`: Slack receives a public thread acknowledgement, the message is injected into the active Pi session, and the original `Working...` message stays in place until it is deleted at completion. The final answer is posted at the bottom of the thread. Use `followUp` to queue the message for after the active assistant response, or `reject` to ask the user to send it again later. Pending approvals reject new asks until the approval is resolved.

Run cancellation is restricted to the user who started the run, plus configured `approval.approvers`. Unauthorized cancel clicks receive a private reply in the thread.

Slack delivery calls are serialized by default. Provider rate limits are retried with backoff. Ambiguous timeouts are not retried for non-idempotent sends such as new messages or file uploads. Most apps do not need to configure this. If Slack needs slower pacing, set `delivery: { intervalMs: 500 }`; use `delivery: false` only for development or custom transport control.

## Approvals

Approval cards use Slack buttons. When an approver clicks **Approve**, heypi updates the original approval message immediately, keeps the approval details visible, and removes the buttons:

```text
✅ Approval `approval-id` approved by <@U123>.
```

If the approved command or tool continues running, Slack posts a follow-up `Working...` progress message in the same thread and replaces it with the result. Rejections also keep the approval details visible and remove the buttons:

```text
⛔ Approval `approval-id` rejected by <@U123>.
```

Unauthorized approval attempts are private replies in the current thread when Slack provides a thread timestamp.

Expired approval clicks keep the approval details visible, mark the approval expired, and remove the buttons.

## Common Failures

`invalid_auth` means `SLACK_BOT_TOKEN` is wrong or the app was reinstalled.

`not_authed` usually means the token was not sent or was loaded from the wrong `.env` file.

No messages in channels usually means missing `app_mentions:read`, missing `message.channels`, or the app was not invited to the channel.

Buttons not working usually means Interactivity is disabled or points to the wrong URL.
