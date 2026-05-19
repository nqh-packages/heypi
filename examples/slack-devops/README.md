# Slack DevOps

Slack incident-response assistant for a small fictional Atlas API platform. It demonstrates scoped Slack behavior, runbook search, governed bash, approvals, and server inventory from files.

This example uses Slack Socket Mode so it can run locally without a public HTTPS URL.

## Run

```bash
cp examples/slack-devops/.env.example examples/slack-devops/.env
pnpm run dev:slack
```

Required env vars:

```bash
SLACK_BOT_TOKEN=...
SLACK_APP_TOKEN=...
OPENAI_API_KEY=...
```

Optional env vars:

```bash
HEYPI_APPROVERS=U123456,U234567
HEYPI_SLACK_TEAMS=
HEYPI_SLACK_CHANNELS=
HEYPI_SLACK_USERS=
```

Leave the `HEYPI_SLACK_*` allowlists empty to accept every event Slack delivers. Set comma-separated IDs to restrict which teams, channels, or users may trigger the agent.

`SLACK_SIGNING_SECRET` is only required for HTTP mode. Socket Mode uses `SLACK_APP_TOKEN`.

This example enables `streaming: true`, so Slack replies are posted as draft messages and edited while Pi emits text. Delivery pacing and rate-limit retries use heypi's defaults.

Check setup:

```bash
pnpm heypi slack check --env examples/slack-devops/.env
pnpm heypi slack manifest --url https://<host>/slack/events
```

Try:

```text
help
Search runbooks for server inventory
Which servers run atlas-api?
Search runbooks for gateway 5xx
We are seeing elevated p95 latency on atlas-api
bash find . -maxdepth 3 -type f
```

The demo knows servers from `examples/slack-devops/agent/runbooks/server-inventory.md`. It does not discover live infrastructure.

## Slack HTTP Mode

For production-style Slack HTTP mode, use the commented block in `index.ts`:

```ts
slack({
	botToken: required("SLACK_BOT_TOKEN"),
	signingSecret: required("SLACK_SIGNING_SECRET"),
	mode: "http",
	port: Number(process.env.PORT ?? 3000),
	path: "/slack/events",
	allow: {
		teams: list("HEYPI_SLACK_TEAMS"),
		channels: list("HEYPI_SLACK_CHANNELS"),
		users: list("HEYPI_SLACK_USERS"),
	},
	trigger: "mention",
	reply: "thread",
	streaming: true,
});
```

In Slack app settings, set Event Subscriptions and Interactivity URLs to `https://<host>/slack/events`, or to the custom `path` you configured.
