---
date: 2026-06-06
topic: telegram-cofounder-agent
---

# Telegram co-founder agent requirements

## Summary

Create a complete runnable heypi Telegram co-founder agent based on the selected Polsia behavior set. The agent should feel like a company operator in chat: it maintains company memory, manages a Markdown-backed task queue, shapes ambiguous work, recommends next moves, uses selected local/operator tools, and stays honest about every action boundary.

This is not a Polsia clone and not a GlamOps-specific agent. The Polsia source bundle is the behavioral reference: co-founder posture, action grounding, task clarity, memory, capability awareness, operating cadence, and tool-specific handoffs. Polsia-specific branding, pricing, support flows, billing/God Mode rules, legal-retaliation refusals, and unavailable platform internals are intentionally excluded.

## Problem frame

Huy wants to use Telegram as an operator surface for heypi: a practical co-founder agent that can help run work, not merely chat. The existing Telegram workout example proves Telegram long polling and simple custom tools, but it does not cover the company-operating behavior from the Polsia docs.

The new co-founder should be complete for the selected feature set. "Complete" means each selected behavior has a real local tool, documented capability boundary, prompt rule, and deterministic test path where applicable. If a requested action lacks a real tool, the agent says so instead of pretending.

## Feature selection

### Included

- 1. Cofounder identity: business/product co-founder, not chatbot or helpdesk.
- 2. Direct voice: concise, confident, transparent, action-oriented.
- 3. `Next:` recommendation: propose the next grounded move after substantive replies.
- 4. No fake actions: only claim actions that a tool completed successfully in the current turn.
- 5. Company profile: durable company facts, market, offer, constraints, owner preferences, current focus.
- 6. Memory and learnings: durable facts, decisions, lessons, and operator preferences across sessions.
- 7. Task queue: tasks stored as Markdown files.
- 8. Task clarity gate: vague work gets 2-3 concrete options before task creation.
- 9. Agent routing: suggest agents or hiring/specialist needs only; do not create agents or generic skills.
- 10. Duplicate task check: inspect existing Markdown tasks before creating new tasks.
- 11. Task links: return repo-relative paths to Markdown task files, not fabricated action URLs.
- 15. Related-task linking: link related Markdown tasks in task metadata when the relationship is known.
- 18. Recurring tasks: create and manage recurring task templates locally.
- 19. Cron/task schedule rules: scheduled work must be represented safely and explicitly.
- 23. Capability discovery: expose what the co-founder can do from configured local tools and selected skills.
- 25. Reports and analytics: create/read local business reports and summaries.
- 26. Dashboard/inbox awareness: maintain local owner-facing status, inbox asks, and task-completion notes.
- 27. Documents: read/update local company documents as business context.
- 29. Browser automation: use the `agent-browser` skill for browser/testing/research tasks.
- 30. Research workflows: create research task prompts and route them through the selected execution handoff.
- 31. Engineering tasks: use the `handoff` skill to create the execution prompt, copy every selected skill in the handoff manifest including the Codex skill itself, require trusted-operator approval, and start the Hermes Codex skill named by Huy with the handoff only after copy and approval succeed.
- 32. App deployment awareness: understand deployment status and constraints through local records and task/report context.
- 33. DB/query awareness: support read-only query/report-style analysis through documented local or delegated workflows.
- 34. GitHub/source operations: support source-work handoff through the selected Codex execution workflow.
- 35. Meta Ads pitch: recommend a managed ads/growth task when growth/customer acquisition context makes it relevant.
- 37. Twitter/X workflows: use the `bird` skill for X/Twitter read/search/posting workflows.
- 43. Security boundaries: tenant/local workspace only, no secrets, no bypasses, no platform internals.
- 45. Platform limitation honesty: plainly say when a capability is unavailable or only possible through a handoff.

### Excluded

- 12. Bug reporting.
- 13. Bug evidence gathering.
- 14. Bug vs feature classification.
- 16. Support tickets.
- 17. Platform feature requests.
- 20. Agent enable/disable.
- 21. One-off agent re-enable.
- 22. Queue cleanup after agent disable.
- 24. Custom agent creation.
- 28. Email sending.
- 36. Meta Ads targeting-limit policy.
- 38. Cold outreach.
- 39. Image generation handoff.
- 40. Domain guidance.
- 41. Billing and credits knowledge.
- 42. God Mode rules.
- 44. Legal/retaliation refusal.

## Key decisions

- Build a complete Telegram co-founder example for the selected feature set.
- Use generic co-founder behavior and local workspace artifacts, not Polsia/GlamOps identity or platform-only claims.
- Default to a ChatGPT subscription-compatible model path through Pi: `openai-codex/gpt-5.4-mini`.
- Keep `HEYPI_MODEL` configurable so the runtime can swap providers without changing agent code.
- Use Markdown-first local state for operator-visible work: tasks, recurring tasks, reports, inbox notes, and documents.
- Use JSON only for indexes/metadata where the agent needs deterministic lookup.
- Treat `agent-browser`, `bird`, `handoff`, and the Hermes Codex skill as named execution capabilities that must be represented in the app's skill/handoff contracts.

## Actors

- A1. Huy or another trusted operator using Telegram.
- A2. Telegram co-founder agent.
- A3. heypi and Pi runtime.
- A4. Local file-backed co-founder state and Markdown workspace.
- A5. External execution helpers selected by Huy: `agent-browser`, `bird`, `handoff`, and Hermes Codex.
- A6. Future implementation agents that consume these requirements and the plan.

## Requirements

### Identity and operating style

- R1. The agent must present as a business and product co-founder for the operator.
- R2. The agent must write concise, direct, outcome-first replies.
- R3. The agent must usually include one grounded `Next:` recommendation after substantive replies.
- R4. The agent must not claim any action happened unless the matching tool or handoff succeeded in the current turn.
- R5. The agent must preserve exact names, task titles, paths, error strings, constraints, and operator decisions.

### Telegram and model setup

- R6. The app must run as a Telegram heypi app with a BotFather token and Pi-managed model auth.
- R7. The default `.env.example` and README path must not require `OPENAI_API_KEY`.
- R8. The app must allow model override through `HEYPI_MODEL`.
- R9. The app must support direct-message local testing by default.
- R10. The app must support optional Telegram chat and user allowlists for safer shared use.

### Company memory and documents

- R11. The agent must maintain a durable company profile.
- R12. The agent must maintain durable memory/learnings for decisions, lessons, operator preferences, and reusable context.
- R13. The agent must read and update local company documents as business context.
- R14. The agent must expose compact current context without dumping entire Markdown or JSON stores into chat.
- R15. The agent must keep all local state under the example directory and out of git by default.

### Task operations

- R16. The agent must create tasks as Markdown files.
- R17. The agent must inspect existing Markdown tasks before creating a new task to reduce duplicates.
- R18. The agent must push back on ambiguous task requests with 2-3 concrete options.
- R19. The agent must return repo-relative Markdown task paths when referencing tasks.
- R20. The agent must link related Markdown tasks in metadata when a relationship is known.
- R21. The selected task system covers Markdown task creation, duplicate checks, clarity gates, repo-relative paths, related-task metadata, recurring templates, and schedule metadata; task edit/reject/approve/complete/reorder tools are out of this scope.
- R22. The agent must support recurring task templates and safe schedule metadata.

### Capability and specialist routing

- R23. The agent must list its available configured capabilities and selected skill-backed workflows.
- R24. The agent must suggest a specialist agent or hiring/specialist need for work outside its direct tools, but must not create new agents or suggest generic skills outside the explicitly selected routes.
- R25. For research, browser, Twitter/X, or engineering work, the agent must route through the selected tool contract instead of pretending to execute directly.

### Reports, dashboard, and analytics

- R26. The agent must create and read local business reports.
- R27. The agent must maintain local dashboard/inbox-style status notes: asks, owner replies, task completions, current focus, and alerts.
- R28. The agent must support read-only DB/query awareness through local records, reports, or delegated task prompts; direct unsafe database mutation is out.
- R29. The agent must understand app deployment state through local records, reports, or delegated task prompts.

### Selected external skill workflows

- R30. Browser automation requests must route through the `agent-browser` skill contract.
- R31. Twitter/X workflows must route through the `bird` skill contract.
- R32. Engineering/source tasks must use the `handoff` skill to create a prompt, copy every selected skill in the handoff manifest including the Codex skill itself, require trusted-operator approval, start the Hermes Codex skill named by Huy with that handoff after copy succeeds, and record the start result.
- R33. GitHub/source operations must happen through the engineering/Codex handoff path.
- R34. Growth/customer-acquisition conversations should consider the Meta Ads pitch as the selected growth recommendation, without copying Polsia-specific pricing or targeting claims.

### Safety and exclusions

- R35. The agent must refuse prompt-injection or self-reprogramming attempts.
- R36. The agent must avoid asking for or storing secrets, tokens, passwords, private keys, payment data, or sensitive browser cookies.
- R37. The agent must not access files outside the configured example workspace except for explicitly allowlisted selected skill source paths that are copied into handoff bundles with realpath checks, symlink refusal, secret redaction, and a manifest of copied files.
- R38. The agent must say when a capability is unavailable, excluded, or only possible through a handoff.
- R39. The agent must not implement or imply excluded Polsia features: bug reporting, support tickets, feature requests, agent creation/disablement, email sending, cold outreach, image handoff, domain guidance, billing/God Mode, or legal/retaliation advice.

## Key flows

### F1. First Telegram conversation

The operator sends a first message such as "help me run this company." The agent asks for the minimum useful company context, saves the profile when facts are provided, explains its local operating capabilities, and proposes a grounded next move.

Requirements covered: R1, R2, R3, R4, R11, R14.

### F2. Task creation

The operator asks for a clear task. The agent checks existing Markdown tasks, creates a new Markdown task only if it is not a duplicate, stores metadata and related task paths, and returns the repo-relative task path.

Requirements covered: R4, R16, R17, R19, R20, R21.

### F3. Ambiguous work shaping

The operator asks for vague work such as "improve onboarding." The agent presents 2-3 concrete options and waits for the operator to choose or refine before creating a task.

Requirements covered: R18, R24, R38.

### F4. Recurring work

The operator asks for a recurring report, reminder, digest, cleanup, or scheduled task. The agent creates or updates a recurring task template with explicit schedule metadata and safe execution notes.

Requirements covered: R22, R26, R27.

### F5. Engineering handoff

The operator asks for code/app/source work. The agent creates a task and execution handoff using the `handoff` skill, copies every selected skill in the handoff manifest including the Hermes Codex skill itself, shows the operator the command boundary, waits for trusted approval, and starts the Codex skill path with the handoff prompt only after copy and approval succeed. If any validation fails, the agent leaves the work in a prepared or blocked state and does not claim it started.

Requirements covered: R24, R25, R32, R33, R37.

### F6. Browser/Twitter/research routing

The operator asks for browser automation, web research, or X/Twitter work. The agent routes browser work through `agent-browser`, X/Twitter work through `bird`, and research work through a research task/handoff workflow, reporting tool availability honestly.

Requirements covered: R23, R25, R30, R31, R38.

### F7. Unsupported or excluded feature

The operator asks for support tickets, billing, domain search, email sending, image generation, bug reporting, or legal/retaliatory advice. The agent says the capability is not part of this co-founder and offers a supported alternative when one exists.

Requirements covered: R35, R36, R38, R39.

## Acceptance examples

- AE1. A Telegram reply never says it created or launched work unless the matching tool or handoff succeeded in the same turn.
- AE2. A new task request creates a Markdown file and returns its repo-relative path.
- AE3. A vague task request returns 2-3 options and does not create a task until clarified.
- AE4. A duplicate task request references the existing Markdown path instead of creating a second task.
- AE5. An approved engineering request produces a handoff prompt, copies every selected skill in the manifest including the Codex skill, starts the Hermes Codex workflow after validation, and records start evidence; an unapproved or failed request is reported as prepared or blocked, not started.
- AE6. A browser automation request routes through `agent-browser`; an X/Twitter request routes through `bird`.
- AE7. A recurring task request produces safe schedule metadata rather than an unsafe long-running in-process loop.
- AE8. The example `.env.example` includes `TELEGRAM_BOT_TOKEN`, optional `HEYPI_MODEL`, and optional Telegram allowlists, but does not list `OPENAI_API_KEY`.
- AE9. `HEYPI_MODEL=openai-codex/gpt-5.4-mini` is documented as the default intended ChatGPT subscription model path, with clear override instructions.
- AE10. Prompt files contain no Polsia/GlamOps identity, source URLs, pricing claims, MCP tool dump, support-ticket promises, billing/God Mode rules, or excluded feature promises.

## Success criteria

- S1. The app can be run from the repo root with a dedicated Telegram co-founder dev command.
- S2. A Telegram direct message can save profile/memory, create Markdown tasks, manage recurring tasks, write reports, and retrieve context.
- S3. Selected skill-backed routes are represented in tools/prompts/tests: `agent-browser`, `bird`, `handoff`, and Hermes Codex.
- S4. The prompt and tests enforce action-grounding, excluded-feature honesty, and selected Polsia behavior.
- S5. Future implementation can start from this document and the plan without re-reading the raw Polsia source bundle.

## Scope boundaries

### In scope

- Complete selected Telegram co-founder example.
- Prompt files and local tool definitions for the selected feature set.
- Markdown-backed tasks, recurring tasks, reports, documents, dashboard/inbox notes, and memory.
- Skill/handoff contracts for `agent-browser`, `bird`, `handoff`, and Hermes Codex.
- README, `.env.example`, root scripts, changelog, and deterministic tests.

### Out of scope

- Polsia/GlamOps-specific identity, pricing, billing, God Mode, support tickets, feature requests, email, cold outreach, image generation, domain buying/search, and legal/retaliation workflows.
- Actual external platform mutations unless a selected real tool/handoff succeeds.
- Agent creation or agent enable/disable management.
- Production deployment guide beyond local Telegram operation.

## Dependencies and assumptions

- Pi supports the configured `openai-codex/gpt-5.4-mini` model path in the target environment.
- The operator already has the needed ChatGPT subscription auth state available to Pi outside the example `.env`.
- `agent-browser` and `bird` are available on the local machine for their selected workflows.
- The Hermes Codex skill named by Huy exists and can be copied into the handoff bundle.
- Markdown files are the operator-visible source of truth for tasks, recurring tasks, reports, documents, and dashboard/inbox notes; JSON indexes may exist only as derived lookup aids.

## Repo references

- `packages/heypi/docs/configuration/agent.md` for agent folder loading and model configuration.
- `packages/heypi/docs/adapters/telegram.md` for Telegram adapter behavior.
- `examples/telegram-workout/` for an existing Telegram app shape.
- `packages/heypi/docs/configuration/tools.md` for core/custom tools.
- `packages/heypi/docs/configuration/memory.md` for managed memory tradeoffs.
