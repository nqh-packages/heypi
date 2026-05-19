# Gateway 5xx Runbook

Service: gateway
Primary host: gw-1
Upstream service: atlas-api

## Symptoms

- Elevated HTTP 502 or 504 responses.
- Upstream timeout messages.
- API workers appear healthy but clients still fail.

## Initial checks

1. Confirm whether 5xxs are gateway-wide or isolated to one upstream.
2. Check whether atlas-api latency is elevated.
3. Check whether a recent gateway config change happened.

## Safe diagnostics

- Search `server inventory` before naming hosts.
- Inspect local example gateway logs if present.
- Compare 502 versus 504 patterns.

## Remediation hints

- If upstream latency is high, use the API latency runbook.
- If gateway config changed recently, propose rollback with approval.
- If only one upstream is failing, drain that upstream only with approval.
