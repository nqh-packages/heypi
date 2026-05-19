# API Latency Runbook

Service: atlas-api
Primary hosts: api-1, api-2
Dependencies: atlas-postgres, atlas-redis, gateway

## Symptoms

- Elevated p95 and p99 latency
- Increased timeout rate from gateway
- Customer reports slow responses

## Initial checks

1. Verify deploy timeline and recent config changes.
2. Check process saturation (CPU, memory, file descriptors).
3. Check downstream dependency latency (DB/cache/external API).
4. Compare API host symptoms before assuming a single-host failure.

## Safe diagnostics

- `runbook_search`: search `server inventory` for host names and ownership.
- `bash`: inspect local example logs if present.
- `runbook_search`: lookup service-specific timeout guidance.

## Remediation hints

- Roll back recent high-risk deploy if correlated.
- Scale read replicas or cache capacity if dependency bottleneck is confirmed.
- Use restart/redeploy only with approval and clear rollback path.

## Example workspace checks

- `find . -maxdepth 3 -type f`
- `grep -R "timeout\\|latency\\|5xx" -n .`
