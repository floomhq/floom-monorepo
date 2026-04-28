# MCP Agent Tools

When a request to `POST /mcp` uses `Authorization: Bearer floom_agent_<token>`, `tools/list` exposes the agent-token tool surface instead of the unauthenticated admin toolset.

All examples use Streamable HTTP JSON-RPC:

```bash
curl -sS https://floom.dev/mcp \
  -H 'accept: application/json, text/event-stream' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer floom_agent_<token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Scope Rules

- `read`: discovery, app skill reads, run reads, run history, and running `public_live` apps.
- `read-write`: all `read` access plus owned/private app runs, studio lifecycle tools, account secrets, triggers, workspaces, feedback, and owned run management.
- `publish-only`: studio publish/update/share/secret-policy tools without run/read tools.

`public_live` means `status=active`, `visibility=public`, and `publish_status=published`. Private or auth-required apps are visible to the token user only when the app is owned by that user.

Agent-token management is intentionally excluded from MCP agent-token auth. A read-write agent token can manage workspace secrets, but it cannot list, create, or revoke other agent tokens. Token mint/revoke stays behind a user session.

## Current Tool Groups

The exact list is contract-tested in `test/stress/test-mcp-server.mjs`.

Read/run:

- `discover_apps`
- `get_app_skill`
- `get_app_details`
- `get_app_about`
- `get_app_source`
- `list_app_reviews`
- `run_app`
- `get_run`
- `list_my_runs`
- `share_run`
- `delete_run`
- `create_job`
- `get_job`
- `cancel_job`
- `get_app_quota`

Studio:

- `studio_detect_app`
- `studio_ingest_hint`
- `studio_publish_app`
- `studio_list_my_apps`
- `studio_fork_app`
- `studio_claim_app`
- `studio_install_app`
- `studio_uninstall_app`
- `studio_update_app`
- `studio_delete_app`
- `studio_get_app_rate_limit`
- `studio_set_app_rate_limit`
- `studio_get_app_sharing`
- `studio_set_app_sharing`
- `studio_search_app_share_users`
- `studio_invite_app_user`
- `studio_revoke_app_invite`
- `studio_submit_app_review`
- `studio_withdraw_app_review`
- `studio_list_secret_policies`
- `studio_set_secret_policy`
- `studio_set_creator_secret`
- `studio_delete_creator_secret`

Account, workspace, triggers, feedback:

- `account_get`
- `account_list_secrets`
- `account_set_secret`
- `account_delete_secret`
- `workspace_get`
- `workspace_list`
- `workspace_create`
- `workspace_update`
- `workspace_delete`
- `workspace_switch`
- `workspace_list_members`
- `workspace_set_member_role`
- `workspace_remove_member`
- `workspace_create_invite`
- `workspace_list_invites`
- `workspace_revoke_invite`
- `workspace_accept_invite`
- `workspace_delete_runs`
- `trigger_create`
- `trigger_list`
- `trigger_update`
- `trigger_delete`
- `feedback_submit`

## `discover_apps`

Args:

```json
{ "category": "data", "q": "summarize", "limit": 50, "cursor": "0" }
```

Returns:

```json
{
  "apps": [
    {
      "slug": "lead-scorer",
      "name": "Lead Scorer",
      "description": "Score a lead",
      "category": "sales",
      "visibility": "public_live",
      "runtime": "python",
      "public_link": "https://floom.dev/p/lead-scorer"
    }
  ],
  "next_cursor": null
}
```

REST:

```bash
curl -sS 'https://floom.dev/api/agents/apps?q=summarize&limit=20' \
  -H 'authorization: Bearer floom_agent_<token>'
```

## `get_app_skill`

Args:

```json
{ "slug": "lead-scorer" }
```

Returns:

```json
{ "slug": "lead-scorer", "skill_md": "# Lead Scorer\n...", "etag": "sha256hex" }
```

REST equivalent for the wrapped shape:

```bash
curl -sS https://floom.dev/api/agents/apps/lead-scorer/skill \
  -H 'authorization: Bearer floom_agent_<token>'
```

The public markdown route remains:

```bash
curl -sS https://floom.dev/p/lead-scorer/skill.md
```

## `run_app`

Args:

```json
{ "slug": "lead-scorer", "action": "run", "inputs": { "company": "Acme" } }
```

Returns after the run reaches a terminal state:

```json
{
  "run_id": "run_...",
  "slug": "lead-scorer",
  "action": "run",
  "status": "success",
  "output": { "score": 87 },
  "dry_run": false,
  "model": "python",
  "duration_ms": 1240,
  "started_at": "2026-04-26 12:00:00",
  "completed_at": "2026-04-26 12:00:01"
}
```

REST:

```bash
curl -sS -X POST https://floom.dev/api/agents/run \
  -H 'authorization: Bearer floom_agent_<token>' \
  -H 'content-type: application/json' \
  -d '{"slug":"lead-scorer","inputs":{"company":"Acme"}}'
```

BYOK-gated launch apps (`lead-scorer`, `competitor-analyzer`, `resume-screener`) share the same 5 free runs per user/IP across web, MCP, and REST. After that budget is used, agents must pass `gemini_api_key` in `inputs`, forward `X-User-Api-Key`, or rely on a `GEMINI_API_KEY` already configured in the user's account secrets.

## `get_run`

Args:

```json
{ "run_id": "run_..." }
```

Returns:

```json
{
  "run_id": "run_...",
  "slug": "lead-scorer",
  "status": "success",
  "output": { "score": 87 },
  "started_at": "2026-04-26 12:00:00",
  "completed_at": "2026-04-26 12:00:01",
  "duration_ms": 1240
}
```

REST:

```bash
curl -sS https://floom.dev/api/agents/runs/run_... \
  -H 'authorization: Bearer floom_agent_<token>'
```

The token user must own the run. Explicitly shared runs from public live apps can be read through this endpoint.

## `list_my_runs`

Args:

```json
{ "slug": "lead-scorer", "limit": 20, "cursor": "opaque", "since_ts": "2026-04-26 00:00:00" }
```

Returns:

```json
{
  "runs": [
    {
      "run_id": "run_...",
      "slug": "lead-scorer",
      "status": "success",
      "started_at": "2026-04-26 12:00:00",
      "duration_ms": 1240,
      "dry_run": false
    }
  ],
  "next_cursor": null
}
```

REST:

```bash
curl -sS 'https://floom.dev/api/agents/runs?slug=lead-scorer&limit=20' \
  -H 'authorization: Bearer floom_agent_<token>'
```

## Error Types

REST endpoints return HTTP status plus:

```json
{ "error": "forbidden_scope", "message": "..." }
```

MCP tool calls return `isError: true` with the same JSON object in text content.

Error codes:

- `auth_required` (`401`)
- `forbidden_scope` (`403`)
- `not_found` (`404`)
- `not_accessible` (`403`)
- `invalid_input` (`400`)
- `rate_limit_exceeded` (`429`)
- `runtime_error` (`500`)
- `illegal_transition` (`409`, returned as `invalid_input` with `code: "illegal_transition"`)

## Secrets

Agents can manage reusable workspace BYOK/API keys through:

- `account_list_secrets`
- `account_set_secret`
- `account_delete_secret`

Secret values are write-only: Floom stores encrypted ciphertext and never returns plaintext from list/get-style surfaces. See [Secrets and Context](./secrets-and-context.md).
