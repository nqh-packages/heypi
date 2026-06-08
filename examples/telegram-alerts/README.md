# Telegram alerts

Heypi HTTP webhook **input** adapter receives alert payloads and forwards concise summaries to Telegram via `adapter.send()`.

This example uses the generic Heypi `webhook()` adapter, not Telegram Bot API webhook mode (`telegram({ mode: "webhook" })`).

## Run

```bash
cp examples/telegram-alerts/.env.example examples/telegram-alerts/.env
pnpm run dev:telegram:alerts
```

Post an alert:

```bash
curl -sS -X POST "http://127.0.0.1:3000/webhook/alerts" \
  -H "Authorization: Bearer $HEYPI_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text":"CPU high on api-1","threadId":"alerts"}'
```

Configure `HEYPI_TELEGRAM_CHATS` with the destination chat ID from `pnpm heypi telegram observe`.
