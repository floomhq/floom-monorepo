# Floom launch surface inventory v1

Last verified: 2026-04-29.

Sources used for this inventory:

- Source routes: `apps/web/src/main.tsx`, `apps/server/src/index.ts`, `apps/server/src/routes/*`.
- Public docs: `README.md`, `docs/SELF_HOST.md`, `docs/TRIGGERS.md`, `docs/connections.md`, `docs/agents/quickstart.md`, `docs/monetization.md`.
- Live probes on 2026-04-29:
  - `https://floom.dev/api/health` returned `status=ok`, version `0.4.0-mvp.5`, `apps=170`.
  - `https://preview.floom.dev/api/health` returned `status=ok`, version `0.4.0-mvp.5`, `apps=131`.
  - `https://floom.dev/api/session/me` returned `cloud_mode=true`, `deploy_enabled=false`.
  - `https://preview.floom.dev/api/session/me` returned `cloud_mode=true`, `deploy_enabled=true`.
  - `https://floom.dev/api/hub` returned 23 public apps; `https://preview.floom.dev/api/hub` returned 25 public apps.
  - `https://floom.dev/api/projects` returned 200; `https://preview.floom.dev/api/projects` returned 404 during the final smoke run.

## Status classes

| Class | Meaning |
|---|---|
| Live waitlist launch | Public launch surface available on `floom.dev`; publishing/account creation is waitlist-gated on prod. |
| Preview/full-platform beta | Available on preview or to signed-in beta users; not a general prod launch promise. |
| Self-host | Available to operators running the Docker image or local server. |
| Roadmap/deferred | Code or docs exist, but launch copy does not promise general availability. |

## Continuous smoke coverage

The continuous matrix is implemented in `test/stress/test-launch-surface-smoke.mjs` and exposed as `pnpm test:launch-surface-smoke`.

The smoke matrix covers:

- `GET /api/health`
- `GET /api/healthz`
- `GET /api/session/me`
- `GET /api/projects`
- `GET /api/hub`
- `GET /api/hub/<slug>`
- `GET /p/<slug>`
- `POST /mcp` initialize
- `POST /mcp/search` tools/list
- `POST /mcp/app/<slug>` initialize
- `POST /api/<slug>/run` plus `GET /api/run/<id>` with the issued device cookie
- `POST /api/waitlist` invalid-email rejection
- local CLI `floom --version`

Default target slug: `uuid`.

## Inventory

| Surface | Class | Owner | Canonical URL or command | Auth mode | Expected status | Continuous coverage |
|---|---|---|---|---|---|---|
| Landing page | Live waitlist launch | Web | `GET https://floom.dev/` | Anonymous | HTML 200 | Hub smoke covers browser path indirectly; launch surface script covers APIs only. |
| App directory | Live waitlist launch | Web + Hub API | `GET /apps`, `GET /api/hub` | Anonymous | HTML 200; JSON list with public apps | `GET /api/hub`. |
| Public app page | Live waitlist launch | Web + Runner | `GET /p/uuid`, `GET /p/:slug` | Anonymous for public apps; link token or user session for gated apps | HTML 200 for public apps | `GET /p/uuid`. |
| Public run permalink | Live waitlist launch | Web + Runner | `GET /r/:runId`, `GET /api/run/:id` | Public only after share, owner cookie/session otherwise | HTML 200 for public shared run; JSON 200 for owner/public run | Not in launch surface script; covered by existing run/share tests. |
| Docs hub and docs pages | Live waitlist launch | Web/docs | `GET /docs`, `GET /docs/:slug`, `GET /protocol` | Anonymous | HTML 200 | Not in launch surface script; existing web route tests cover docs rendering. |
| Pricing/about/help/legal/status/changelog pages | Live waitlist launch | Web | `/pricing`, `/about`, `/help`, `/legal`, `/privacy`, `/terms`, `/cookies`, `/status`, `/changelog` | Anonymous | HTML 200 | Not in launch surface script. |
| Waitlist page | Live waitlist launch | Web + Waitlist API | `GET /waitlist`, `POST /api/waitlist` | Anonymous, rate-limited | HTML 200; invalid email returns 400; valid email persists signup | Invalid-email API path covered continuously without creating rows. |
| Sign-up and login pages | Live waitlist launch on prod; preview/full-platform beta on preview | Auth + Web | `GET /signup`, `GET /login`, `POST /auth/*` | Prod waitlist gate when `deploy_enabled=false`; preview allows beta auth | Prod visitor routes to waitlist guard; preview auth pages render | `GET /api/session/me` verifies `deploy_enabled` state. |
| Session/me | Live waitlist launch | Auth/session | `GET /api/session/me` | Anonymous returns guest; session cookie returns user/workspace | JSON 200 with `cloud_mode`, `deploy_enabled`, workspace context | Covered. |
| Health probes | Live waitlist launch | Server/ops | `GET /api/health`, `GET /api/healthz`, `GET /api/health/sidecars` | Anonymous | JSON 200, `status=ok` or `ok=true`; sidecars 200 when healthy | `/api/health` and `/api/healthz` covered. |
| Hub/project catalog alias | Live waitlist launch | Hub API | `GET /api/hub`, `GET /api/projects`, `GET /api/hub/store` | Anonymous | JSON public app list. Current live status on 2026-04-29: prod `/api/projects` 200, preview `/api/projects` 404. | `/api/hub` covered on all targets; `/api/projects` required on primary target and reported as optional preview drift when absent. |
| Hub app detail | Live waitlist launch | Hub API | `GET /api/hub/:slug` | Anonymous for public/link-valid apps; owner session for private | JSON 200 for public app | `GET /api/hub/uuid` covered. |
| Hub source/spec metadata | Live waitlist launch for public app metadata | Hub API | `GET /api/hub/:slug/source`, `GET /api/hub/:slug/openapi.json` | Anonymous for public apps; gated for private apps | JSON 200 for public apps with source/spec | Not in launch surface script. |
| Public REST run | Live waitlist launch | Runner | `POST /api/:slug/run`, `POST /api/run` | Anonymous for public apps; Agent token/session for private or account-scoped apps | JSON 200 with `run_id`, then pollable terminal run for owner cookie/session | `POST /api/uuid/run` and owner-cookie polling covered. |
| Async jobs | Preview/full-platform beta | Runner | `POST /api/:slug/jobs`, `GET /api/:slug/jobs/:job_id`, `POST /api/:slug/jobs/:job_id/cancel` | Same visibility/auth as app run | JSON 202/200 for queued jobs | Existing stress tests cover jobs; not in launch surface script. |
| Quota peek | Live waitlist launch | Runner/BYOK gate | `GET /api/:slug/quota` | Anonymous | JSON 200; `gated=false` or usage payload | Not in launch surface script. |
| Reviews | Preview/full-platform beta | Hub/community | `GET /api/apps/:slug/reviews`, `POST /api/apps/:slug/reviews` | Reads anonymous; writes gated/rate-limited | Read JSON 200 for public app | Existing stress tests cover review auth; not in launch surface script. |
| Product feedback | Preview/full-platform beta | Web/API | `POST /api/feedback` | Session or configured route policy | JSON success/error | Existing stress tests cover; not in launch surface script. |
| MCP root/admin server | Live waitlist launch for discovery; preview/full-platform beta for account/studio tools | MCP | `POST /mcp` | Anonymous returns public read tools; Agent token unlocks account/studio tools | JSON-RPC initialize 200 and tools capability | `POST /mcp` initialize covered. |
| MCP search server | Live waitlist launch | MCP/search | `POST /mcp/search` | Anonymous | JSON-RPC tools/list exposes `search_apps` | Covered. |
| MCP per-app server | Live waitlist launch | MCP/app | `POST /mcp/app/:slug` | Anonymous for public app tools; Agent token for gated apps | JSON-RPC initialize 200 for public app | `POST /mcp/app/uuid` initialize covered. |
| Agent REST tools | Preview/full-platform beta | Agent tooling | `GET /api/agents/apps`, `POST /api/agents/run`, `GET /api/agents/runs`, `GET /api/agents/apps/:slug/skill` | Anonymous/public for discoverable app reads; Agent token for private/account context | JSON 200 on defined subroutes | Not in launch surface script. |
| CLI shell package | Preview/full-platform beta for Cloud publishing; self-host for local operators | CLI | `cli/floom/bin/floom --version`; installed via `curl -fsSL https://floom.dev/install.sh \| bash` | Public apps can run anonymous; publish/account commands need Agent token/session | Local version prints semver; hosted installer returns text 200 | CLI version covered locally. |
| Claude/Cursor skills | Preview/full-platform beta | Agent tooling | `skills/claude-code/`, `skills/cursor/`, `GET /skill.md`, `GET /p/:slug/skill.md` | Public skill docs anonymous; publish commands need Agent token | Markdown 200 for skill surfaces | Not in launch surface script. |
| Self-host Docker | Self-host | Runtime/ops | `docker run -p 3051:3051 ghcr.io/floomhq/floom-monorepo:latest` | Operator-defined; optional `FLOOM_AUTH_TOKEN` gates `/api/*`, `/mcp/*`, `/p/*` | Local `/api/health` 200; app catalog depends on `apps.yaml` | Existing local stress tests cover server boot; not in live smoke script. |
| Proxied OpenAPI publishing | Preview/full-platform beta; self-host unrestricted | Studio/Hub ingest | `POST /api/hub/detect`, `POST /api/hub/detect/inline`, `POST /api/hub/ingest`, `floom deploy` | Prod Cloud requires beta session/Agent token; self-host open unless operator auth set | Prod waitlist-gated; preview beta enabled | Not in launch surface script to avoid writes. |
| Studio build and creator workspace | Preview/full-platform beta | Studio | `/studio/build`, `/studio/apps`, `/studio/:slug/*` | Waitlist guard/session on Cloud | Prod copy points to waitlist; preview beta path available | `GET /api/session/me` verifies deploy flag only. |
| Account home and Agent-token UI | Preview/full-platform beta | Account/auth | `/home`, `/settings/agent-tokens`, `POST /api/me/agent-keys`, `GET /api/me/agent-keys` | User session required for mint/list/revoke | Prod gated by waitlist/session; preview beta enabled | Not in launch surface script to avoid token writes. |
| Account/workspace APIs | Preview/full-platform beta | Account/workspaces | `/api/me/*`, `/api/workspaces/*`, `/api/memory`, `/api/secrets` | User session or Agent token, role-scoped | JSON 200/401/403 depending caller | Existing stress tests cover; not in launch surface script. |
| BYOK/workspace secrets | Preview/full-platform beta; self-host | Account/secrets | `floom account secrets *`, `/api/secrets`, MCP account secret tools | Agent token/session; encrypted at rest | Write-only secret storage, server-side injection at run time | Existing secret tests cover; not in launch surface script. |
| Triggers: schedules and inbound webhooks | Preview/full-platform beta; self-host | Automation | `POST /api/hub/:slug/triggers`, `GET/PATCH/DELETE /api/me/triggers/:id`, `POST /hook/:path` | Trigger management requires account context; `/hook/:path` uses HMAC | Schedules enqueue jobs; webhooks return 204/200/401/404/409 | Existing trigger tests cover; launch surface script avoids writes. |
| Outgoing completion webhooks | Preview/full-platform beta; self-host | Runner/automation | App `webhook_url` in manifest | Configured per app | Completion POST after job/run terminal state | Existing route/service tests cover; not in launch surface script. |
| Composio connections | Preview/full-platform beta; self-host optional | Integrations | `POST /api/connections/initiate`, `POST /api/connections/finish`, `GET /api/connections`, `DELETE /api/connections/:provider` | Session/device context; requires `COMPOSIO_API_KEY` and provider auth config | Config missing returns controlled 400; configured instance starts OAuth flow | Existing W23 tests cover; not in launch surface script. |
| Stripe creator monetization | Roadmap/deferred for launch promise; self-host operator feature when configured | Monetization | `/api/stripe/connect/*`, `/api/stripe/payments`, `/api/stripe/refunds`, `/api/stripe/subscriptions`, `/api/stripe/webhook` | Session/operator config; Stripe webhook signature | Config missing returns controlled 400; webhook signature verified | Existing W33 tests cover; launch docs mark paid tiers roadmap. |
| Custom renderers | Preview/full-platform beta | Studio/renderer | `GET /renderer/:slug/bundle.js`, `GET /renderer/:slug/meta`, `POST/DELETE /api/hub/:slug/renderer` | Public bundle read; owner-gated renderer mutations | Bundle JS/meta 200 when configured | Existing renderer tests cover; not in launch surface script. |
| Admin, metrics, deploy ops | Internal/operator, not public launch | Ops | `/api/admin/*`, `/api/metrics`, deploy workflows/scripts | Admin bearer or metrics token | Hidden/401/403/404 without auth | Existing security tests cover; not in launch surface script. |
| Hosted repo-code runtime | Roadmap/deferred | Runtime | `packages/runtime`, GitHub deploy docs | Beta/operator-only path in progress | OpenAPI/proxied repo discovery is live; full hosted repo-code publishing remains future platform work | Existing runtime tests cover local pieces; not in launch surface script. |

## Remaining untested by continuous smoke

The launch surface smoke intentionally avoids write-heavy, paid-provider, auth-session, and destructive flows. These remain covered by focused stress tests or manual beta gates:

- Authenticated browser sign-up/login/OAuth flows.
- Agent-token mint/revoke and workspace role management.
- Studio ingest/publish/update/delete, custom renderer upload, sharing state changes.
- Private/link visibility, run sharing, installed apps, reviews, feedback.
- Async jobs, schedules, inbound webhooks, outgoing completion webhooks.
- Composio OAuth provider round trips.
- Stripe Connect onboarding, payments, refunds, subscriptions, and Stripe webhooks.
- Self-host Docker boot with a real mounted `apps.yaml`.
- Browser visual verification for landing, app pages, Studio, account pages, and docs.
- Preview `/api/projects` compatibility alias while the canonical `/api/hub` endpoint remains healthy there.
