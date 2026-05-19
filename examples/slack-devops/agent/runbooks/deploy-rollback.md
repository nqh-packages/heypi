# Deploy Rollback Runbook

Service: atlas-api
Primary hosts: api-1, api-2

## When to consider rollback

- Error rate or latency increased immediately after a deploy.
- The bad version is known.
- Dependency health is normal.
- The on-call owner agrees rollback is lower risk than forward fix.

## Safe checks

1. Search runbooks for `server inventory`.
2. Confirm the affected service and deploy window.
3. Inspect local example logs or release notes if available.
4. State what evidence links the deploy to the incident.

## Approval boundary

Rollback, restart, deploy, config writes, database changes, and cache flushes require approval.

This demo does not include a real deploy tool. If asked to roll back, explain the evidence needed and the approval path instead of pretending to perform a rollback.
