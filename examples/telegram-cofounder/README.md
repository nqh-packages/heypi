# Telegram co-founder

A Telegram co-founder that manages local Markdown company operations and selected tool handoffs. It saves company profile and learnings, creates Markdown tasks and recurring templates, writes reports/documents/dashboard notes, and routes browser, X/Twitter, research, and engineering/source work through explicit handoff boundaries.

Markdown under `examples/telegram-cofounder/state/` is the operator-visible source of truth. Generated indexes or manifests are derived.

## Run

```bash
cp examples/telegram-cofounder/.env.example examples/telegram-cofounder/.env
pnpm run dev:telegram:cofounder
```

Required:

```bash
TELEGRAM_BOT_TOKEN=...
```

Optional:

```bash
HEYPI_MODEL=openai-codex/gpt-5.4-mini
HEYPI_TELEGRAM_CHATS=
HEYPI_TELEGRAM_USERS=
HEYPI_LOCAL_DEV_MUTATIONS=false
HEYPI_TRUSTED_WORKSPACE_ROOTS=
HEYPI_RUNTIME_ROOT=
HEYPI_RUNTIME_NAME=guarded-bash
```

The default model is `openai-codex/gpt-5.4-mini`. Pi resolves model auth through its configured provider/subscription path, so this example does not require `OPENAI_API_KEY` in the default setup path. Override with `HEYPI_MODEL=provider/name`.

Mutating tools and handoffs are default-deny unless a trusted Telegram user allowlist is configured or `HEYPI_LOCAL_DEV_MUTATIONS=true` is set for local development.

For local development against a real repo, set `HEYPI_RUNTIME_ROOT` to that repo and keep `HEYPI_RUNTIME_NAME=guarded-bash`:

```bash
HEYPI_RUNTIME_ROOT=/Volumes/BIWIN/CODES/company-runner
HEYPI_TRUSTED_WORKSPACE_ROOTS=/Volumes/BIWIN/CODES
```

## Selected features

- Co-founder voice and action-grounded replies.
- Company profile, memory/learnings, documents, reports, dashboard/inbox notes.
- Markdown task creation, duplicate checks, ambiguity gates, related-task metadata.
- Recurring task templates with safe schedule metadata only.
- Capability discovery for direct tools, selected routes, unavailable operations, and excluded features.
- Browser route through `agent-browser`.
- X/Twitter route through `bird`.
- Research route through Markdown task prompts.
- Engineering/source/GitHub route through `handoff` plus Hermes Codex, trusted approval, and runner evidence.
- Meta Ads pitch as the selected growth recommendation without Polsia pricing or targeting claims.

## Excluded features

Bug reporting, support tickets, feature requests, agent creation/disablement, email sending, cold outreach, image handoff, domain guidance, billing/God Mode, legal/retaliation advice, direct DB clients, deploy commands, cloud APIs, broad GitHub mutation tools, browser cookie export, browser profile copying, and unapproved X/Twitter account mutation.

## Handoff states

- `prepared`: artifacts and command boundary exist; no external action has run.
- `approved`: trusted operator approval exists, but runner has not returned start evidence.
- `blocked`: validation, approval, copy, or runner startup failed.
- `started`: copied-skill validation passed, trusted approval was present, and the runner returned successful start evidence in the same turn.

## Smoke scenarios

1. Send company name, offer, target customer, current focus, and one constraint. Confirm the reply summarizes saved context and ends with `Next:`.
2. Ask for a specific task. Confirm a Markdown task path is returned.
3. Ask for the same task again. Confirm the existing path is returned.
4. Ask for vague work. Confirm 2-3 options are returned and no task is created.
5. Create a recurring task. Confirm schedule metadata is saved and no automatic loop starts.
6. Create a report, document, and dashboard note.
7. Ask for browser work and confirm `agent-browser` route preparation.
8. Ask for X/Twitter work and confirm `bird` route preparation.
9. Ask for engineering/source work and confirm `prepared` unless trusted approval and runner evidence are both present.
10. Ask for an excluded feature or secret capture. Confirm refusal and a supported alternative when available.
