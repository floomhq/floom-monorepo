# API reference

Base URL:

- **Cloud:** `https://floom.dev`
- **Self-host:** `http://localhost:3051`

## Auth

Authenticated REST and MCP endpoints accept Agent tokens:

```http
Authorization: Bearer floom_agent_...
```

Mint tokens at `https://floom.dev/me/agent-keys`. Public catalog reads and public app runs also work without a token.

## Health

```http
GET /api/health
```

Open even when global auth is enabled.

## App catalog

```http
GET /api/hub
GET /api/hub/:slug
GET /api/hub/:slug/source
GET /api/apps/:slug/reviews
POST /api/apps/:slug/reviews
```

Private, pending-review, and changes-requested apps are hidden from public catalog reads.

## Publish

```http
POST /api/hub/detect
POST /api/hub/detect/inline
POST /api/hub/ingest
```

`/api/hub/ingest` accepts exactly one source:

- `openapi_url`
- `openapi_spec`
- `docker_image_ref` when Docker publish is enabled

User-ingested OpenAPI URLs and runtime server URLs are blocked from local/private networks.

## Run apps

```http
POST /api/:slug/run
POST /api/run
GET /api/run/:id
GET /api/run/:id/stream
POST /api/run/:id/share
```

Slug form:

```bash
curl -X POST https://floom.dev/api/uuid/run \
  -H "Content-Type: application/json" \
  -d '{"version":"v4","count":1}'
```

Generic form:

```bash
curl -X POST https://floom.dev/api/run \
  -H "Authorization: Bearer floom_agent_..." \
  -H "Content-Type: application/json" \
  -d '{"app_slug":"uuid","action":"generate","inputs":{"version":"v4","count":1}}'
```

Run reads are owner-gated. Shared runs expose outputs only; inputs and logs stay private.

## Async jobs

```http
POST /api/:slug/jobs
GET /api/:slug/jobs/:job_id
POST /api/:slug/jobs/:job_id/cancel
```

## Account and workspace

```http
GET /api/session/me
GET /api/session/context
PATCH /api/session/context

GET /api/secrets
POST /api/secrets
DELETE /api/secrets/:key

GET /api/me/agent-keys
POST /api/me/agent-keys
POST /api/me/agent-keys/:id/revoke
```

Profile context stores JSON for user and workspace profiles. Secrets are encrypted and write-only.
Agent-token key management requires a browser user session; Agent-token auth receives `401 session_required` for create/list/revoke.

## Studio app management

```http
GET /api/hub/mine
DELETE /api/hub/:slug

GET /api/me/apps/:slug/sharing
PATCH /api/me/apps/:slug/sharing
POST /api/me/apps/:slug/sharing/submit-review
POST /api/me/apps/:slug/sharing/withdraw-review
GET /api/me/apps/:slug/rate-limit
PATCH /api/me/apps/:slug/rate-limit
GET /api/me/apps/:slug/secret-policies
PUT /api/me/apps/:slug/secret-policies/:key
PUT /api/me/apps/:slug/creator-secrets/:key
DELETE /api/me/apps/:slug/creator-secrets/:key
```

## MCP

- `https://floom.dev/mcp` — account, Studio, run, context, secrets
- `https://floom.dev/mcp/search` — public app discovery
- `https://floom.dev/mcp/app/:slug` — per-app tools

See [/docs/mcp-install](/docs/mcp-install).

## Rate limits and emergency gate

Run surfaces return `X-RateLimit-*` headers. The emergency gate can temporarily return `503 server_overloaded` on run/MCP/write surfaces while health and metrics remain available.

## Related pages

- [/docs/cli](/docs/cli)
- [/docs/mcp-install](/docs/mcp-install)
- [/docs/runtime-specs](/docs/runtime-specs)
