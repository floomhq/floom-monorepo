# Agent Tokens Quickstart

Agent tokens are the backend primitive for headless Floom agents: one token, one workspace, one coarse scope, one per-token rate limit.

## Mint a token

Today, mint from an authenticated browser session by pasting this request while logged into `floom.dev`:

```bash
curl -sS -X POST https://floom.dev/api/me/agent-keys \
  -H 'content-type: application/json' \
  -d '{"label":"local-agent","scope":"read-write"}'
```

Optional fields:

```json
{
  "label": "clawdbot-prod",
  "scope": "read-write",
  "workspace_id": "workspace_id_here",
  "rate_limit_per_minute": 60
}
```

If `workspace_id` is omitted, Floom binds the token to the user's active workspace. The response includes `raw_token` once:

```json
{
  "id": "agtok_...",
  "prefix": "floom_agent_AbCd1234",
  "label": "local-agent",
  "scope": "read-write",
  "workspace_id": "local",
  "raw_token": "floom_agent_..."
}
```

Store `raw_token` immediately. Floom persists only the SHA-256 hash and the display prefix.

In the hosted product, mint tokens from `/me/agent-keys`. The curl flow is useful for local development and operator testing.

## Use a token

Send the token as a bearer credential:

```bash
curl -sS https://floom.dev/api/hub \
  -H "Authorization: Bearer floom_agent_<32-char-base62-token>"
```

Authenticated request context includes the token's `user_id`, `workspace_id`, `scope`, and `agent_token_id` for downstream enforcement.

## Use the MCP Tools

Point an MCP client at the same host where the token was minted, for example `https://mvp.floom.dev/mcp` for tokens minted on `mvp.floom.dev`. With an agent token, `tools/list` returns the scoped agent toolset:

```bash
curl -sS https://floom.dev/mcp \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  -H "authorization: Bearer floom_agent_<32-char-base62-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Run an app:

```bash
curl -sS https://floom.dev/mcp \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  -H "authorization: Bearer floom_agent_<32-char-base62-token>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_app","arguments":{"slug":"lead-scorer","inputs":{"company":"Acme"}}}}'
```

REST parity routes are available under `/api/agents/*`:

- `GET /api/agents/apps`
- `GET /api/agents/apps/:slug/skill`
- `POST /api/agents/run`
- `GET /api/agents/runs/:run_id`
- `GET /api/agents/runs`

Full tool reference: `docs/agents/mcp-tools.md`.

## Revoke a token

```bash
curl -sS -X POST https://floom.dev/api/me/agent-keys/agtok_.../revoke
```

Revocation sets `revoked_at`. Reusing that bearer token returns `401 {"error":"invalid_agent_token"}`.

## Scopes

- `read`: discovery and read contexts.
- `read-write`: discovery, run, studio, account secrets, workspaces, triggers, feedback, and owned run management.
- `publish-only`: studio publish/update/share/secret-policy operations without run/read tools.

Agent-token management is not exposed to agent-token MCP auth. A read-write agent token can set encrypted workspace secrets, but creating/revoking other agent tokens remains a user-session operation.

## Rate limits

Agent tokens carry a per-minute quota. The default is `60` requests/minute and can be set at mint time with `rate_limit_per_minute`.

This quota stacks on top of existing IP and user limits. A limited request returns `429`, `Retry-After`, and the standard `X-RateLimit-*` headers.

## Secrets

Stored workspace secrets are encrypted at rest and write-only from the API/MCP/CLI point of view. Floom can decrypt them server-side at run time to inject only the keys declared by the app manifest. See `docs/agents/secrets-and-context.md`.

## Context Profiles

Agents and CLI users can store nested JSON user/workspace profiles for app input autofill:

```bash
floom account context get
floom account context set-user --json '{"person":{"name":"Ada","defaults":{"currency":"EUR"}}}'
floom account context set-workspace --json-file ./workspace-profile.json --mode replace
```

MCP exposes the same surface as `account_get_context`, `account_set_user_profile`, and `account_set_workspace_profile`.

Apps can declare manifest input bindings to profile paths. Run calls only use
those bindings when the caller opts in:

```bash
floom run invoice-generator --use-context --inputs-json '{"client":"Acme"}'
```
