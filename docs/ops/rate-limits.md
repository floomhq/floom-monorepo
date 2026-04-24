# Rate limits

Floom's API uses an in-memory sliding-window rate limiter with three tiers.
Limits are per-hour, keyed on IP for anonymous traffic and user ID for
authenticated traffic. When a cap is reached, the server returns
`HTTP 429` with `Retry-After` (clamped at 5 min) and a JSON body:

```json
{ "error": "rate_limit_exceeded", "retry_after_seconds": 42, "scope": "write" }
```

Every successful response also carries `X-RateLimit-*` headers so clients
can pace themselves.

## Tiers

| Tier         | Anon IP / hour | Authed user / hour | Per-(IP, slug) / hour | Use                                                                 |
|--------------|----------------|--------------------|-----------------------|---------------------------------------------------------------------|
| `run`        | 150            | 300                | 500                   | App execution surfaces. One slug can't starve another.              |
| `write`      | 120            | 600                | -                     | All non-run mutations (workspaces, secrets, triggers, admin, etc.). |
| `read-heavy` | 90             | 900                | -                     | Directory / search / identity probes. Scraping protection.          |
| `mcp_ingest` | 10 / day       | 10 / day           | -                     | MCP `ingest_app` tool. Per-user when authed, per-IP otherwise.      |

Every tier can be tuned at boot via env vars (see
`apps/server/src/lib/rate-limit.ts`):

- `FLOOM_RATE_LIMIT_IP_PER_HOUR`, `FLOOM_RATE_LIMIT_USER_PER_HOUR`,
  `FLOOM_RATE_LIMIT_APP_PER_HOUR` — the `run` tier
- `FLOOM_RATE_LIMIT_WRITE_IP_PER_HOUR`, `FLOOM_RATE_LIMIT_WRITE_USER_PER_HOUR`
- `FLOOM_RATE_LIMIT_READ_HEAVY_IP_PER_HOUR`,
  `FLOOM_RATE_LIMIT_READ_HEAVY_USER_PER_HOUR`
- `FLOOM_RATE_LIMIT_MCP_INGEST_PER_DAY`
- `FLOOM_RATE_LIMIT_DISABLED=true` — global kill switch

`FLOOM_AUTH_TOKEN` (admin bearer) bypasses every tier — that's the escape
hatch for ops sweeps, monitoring, and catalog rebuilds.

## Coverage

Every endpoint falls into exactly one tier or the webhook allowlist:

| Path pattern                                                         | Tier         | Notes                                                           |
|----------------------------------------------------------------------|--------------|-----------------------------------------------------------------|
| `POST /api/run`, `POST /api/:slug/run`                                | `run`        | Legacy body-keyed + slug-keyed run                              |
| `POST /api/:slug/jobs` (enqueue), `GET /api/:slug/jobs` (list)       | `run`        | Async queue                                                     |
| `POST /mcp/app/:slug`, `POST /mcp/app/:slug/*`                        | `run`        | Per-app MCP tool calls                                          |
| `POST /api/hub/ingest`                                               | `run`        | HTTP OpenAPI ingest                                             |
| `POST/PATCH/DELETE /api/hub/*` (not ingest)                          | `write`      | Detect, hint, patch, renderer upload/delete                     |
| `POST/PATCH/DELETE /api/workspaces/*`                                | `write`      | Create / edit / delete / member ops / invites                   |
| `POST/PATCH/DELETE /api/memory/*`, `/api/secrets/*`                  | `write`      | W2.1 per-user memory + secrets                                  |
| `POST/PATCH/DELETE /api/connections/*`                               | `write`      | W2.3 Composio OAuth                                             |
| `POST/PATCH/DELETE /api/stripe/*` (not `webhook`)                    | `write`      | Connect onboard, payments, refunds, subscriptions               |
| `POST /api/feedback`                                                 | `write`      | In-app feedback                                                 |
| `POST/PATCH/DELETE /api/me/*`                                        | `write`      | /me/apps secret policies, triggers                              |
| `POST /api/apps/:slug/reviews`                                       | `write`      | Public reviews                                                  |
| `POST /api/admin/*`                                                  | `write`      | Publish-status + future admin surface                           |
| `POST /api/parse`, `POST /api/pick`                                  | `write`      | One-shot helpers                                                |
| `POST /api/thread`, `POST /api/thread/:id/turn`                      | `write`      | Conversation threads                                            |
| `POST /api/session/switch-workspace`                                 | `write`      | Session mutations                                               |
| `POST /api/waitlist`, `POST /api/deploy-waitlist`                    | `write`      | Marketing forms                                                 |
| `POST /api/run/:id/share`                                            | `write`      | Share-link creation (NOT a run-tier path)                       |
| `POST /api/:slug/jobs/:job_id/cancel`                                | `write`      | Cancel an in-flight async job                                   |
| `GET /api/hub`, `GET /api/hub/:slug`, `GET /api/hub/mine`            | `read-heavy` | Directory + search; scraping vector                             |
| `GET /api/hub/:slug/runs`, `/runs-by-day`                            | `read-heavy` | Per-app run history                                             |
| `GET /api/session/me`                                                | `read-heavy` | Identity probe (bot fingerprinting vector)                      |
| `GET /api/me/*`                                                      | `read-heavy` | Own-runs / apps / triggers lists                                |
| `GET /api/run/:id`, `GET /api/run/:id/stream`                        | `read-heavy` | Run-result retrieval + SSE                                      |
| `GET /api/:slug/jobs/:job_id`                                        | `read-heavy` | Async job-result poll                                           |

## Webhook allowlist (explicitly excluded)

Signature-verified provider callbacks are **not** rate-limited. Losing a
webhook means losing a source of truth (Stripe events, tool callbacks),
and the HMAC check already rejects un-authenticated traffic. Current
allowlist:

- `POST /api/stripe/webhook` — Stripe signature (`Stripe-Signature`)
- `POST /hook/:path` — Floom webhook dispatcher with shared-secret HMAC

If you add a new webhook receiver, mount it outside `/api/*` (or add an
explicit pass-through before the tier gate) and document it here.

## Abuse alerting

The limiter tracks 429 bursts per IP in a 5-minute window. When a single
IP trips 10+ rate limits in that window, one Discord alert fires (with a
1-hour cooldown per IP, and the last octet of IPv4 masked). `user`-scope
429s don't count — those are almost always mis-configured clients, not
abuse.

## Storage

Process-local `Map`, resets on restart. Good enough for single-replica
preview. Swap for Redis when Floom goes multi-replica.
