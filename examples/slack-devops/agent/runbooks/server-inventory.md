# Server Inventory

The agent only knows about the servers listed here. If a user names another host, ask them to add it to the runbook inventory outside Slack before acting on it.

## Services

| Service | Hosts | Owner | Notes |
| --- | --- | --- | --- |
| atlas-api | api-1, api-2 | api-platform | Public API workers behind gateway |
| gateway | gw-1 | edge-platform | Routes external traffic to atlas-api |
| atlas-postgres | db-1 | data-platform | Primary PostgreSQL instance |
| atlas-redis | cache-1 | data-platform | Shared API cache |

## Hosts

| Host | Role | Environment | Safe diagnostics |
| --- | --- | --- | --- |
| api-1 | atlas-api worker | production | logs, error rate, latency summary |
| api-2 | atlas-api worker | production | logs, error rate, latency summary |
| gw-1 | gateway | production | routing errors, upstream timeout counts |
| db-1 | postgres | production | connection saturation, slow query count |
| cache-1 | redis | production | hit rate, evictions, latency |

## Rules

- Do not invent host names.
- Do not run commands against hosts that are not listed here.
- Do not restart, deploy, roll back, or change config without explicit approval.
- Prefer service-level diagnosis before host-level remediation.
