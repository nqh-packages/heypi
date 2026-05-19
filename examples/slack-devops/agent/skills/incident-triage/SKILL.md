---
name: incident-triage
description: Triage Atlas API production incidents by checking bundled runbooks, resolving known servers, running safe diagnostics, and proposing a minimal remediation plan.
---

# Incident Triage

Use this skill when the user reports an Atlas API outage, degraded service, elevated errors, deployment issue, host issue, or unknown production behavior.

## Objectives

1. Confirm impact and scope quickly.
2. Gather only the minimum diagnostics needed.
3. Prefer safe, read-only checks first.
4. Use approvals for risky or mutating actions.
5. End with a short remediation proposal and next verification checks.

## Workflow

1. Clarify incident context
- Ask for service/system name, observed symptom, start time, and impact.
- If unknown, state assumptions explicitly.

2. Load relevant runbook context
- Use `runbook_search` with concrete keywords (`api`, `gateway`, `worker`, `postgres`, `redis`, `error`, `timeout`, `deployment`, etc.).
- Prefer runbook procedures over ad-hoc steps.
- Use only the services and servers listed in the bundled runbooks.

3. Execute safe diagnostics first
- Use `bash` for read-only checks against the configured workspace (`ls`, `cat`, `grep`, `find`, log inspection).
- Keep commands scoped and auditable.

4. Propose minimal remediation
- If action is risky (deploy/restart/write/network changes), ask for approval and explain why.
- If blocked or denied, offer fallback checks and escalation steps.

5. Close with status
- Summarize: observed facts, likely cause, actions taken, current state, and next checks.

## Guardrails

- Do not execute destructive commands unless explicitly required and approved.
- Do not modify the agent's own files, prompts, runbooks, package files, or source code.
- Keep command blast radius as small as possible.
- Prefer deterministic, reversible changes.
- Keep output concise and operational.
