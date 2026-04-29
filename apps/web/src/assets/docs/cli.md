# Floom CLI

The Floom CLI scaffolds, validates, publishes OpenAPI/proxied apps, runs apps, and manages the app/account surfaces that are wired in the shell package.

## Install

```bash
curl -fsSL https://floom.dev/install.sh | bash
floom --version
```

Manual install:

```bash
git clone https://github.com/floomhq/floom.git ~/.floom/repo
export PATH="$HOME/.floom/repo/cli/floom/bin:$PATH"
floom --help
```

## Auth

```bash
floom login
```

Mint an Agent token at `https://floom.dev/me/agent-keys`, then run the command printed by the CLI:

```bash
floom auth login --token=floom_agent_...
floom auth whoami
```

Self-host:

```bash
floom auth login --token=floom_agent_... --api-url=http://localhost:3051
```

The CLI stores config at `~/.floom/config.json` with mode `0600`.

## Core commands

```bash
floom init
floom deploy --dry-run
floom deploy
floom status
floom run <slug> '{"input":"hello"}'
floom run <slug> '{"invoice_id":"INV-1"}' --use-context
```

`floom deploy` publishes OpenAPI/proxied manifests through `/api/hub/ingest`:

- `openapi_spec_url` in `floom.yaml`

Successful deploy output includes the app page, MCP URL, Studio owner URL, and Claude Desktop MCP JSON. Hosted repo-code publishing is not wired in this CLI path.

## Account context

```bash
floom account context get
floom account context set-user --json '{"name":"Federico"}'
floom account context set-workspace --json '{"company":{"name":"Floom"}}'
```

Apps can mark inputs with profile context paths. `floom run --use-context` fills missing inputs from the user/workspace JSON profile and still lets explicit CLI inputs win.

## Secrets and tokens

```bash
floom account secrets list
floom account secrets set GEMINI_API_KEY --value "$GEMINI_API_KEY"
floom account secrets delete GEMINI_API_KEY

floom account agent-tokens list
floom account agent-tokens create --label "CI" --scope read-write
floom account agent-tokens revoke <token-id>
```

Secret values are write-only. List commands return metadata, not plaintext.
Agent-token management requires a browser user session; Agent-token auth cannot mint or revoke more Agent tokens and returns `session_required`.

## Apps

```bash
floom apps list
floom apps get <slug>
floom apps about <slug>
floom apps installed
floom apps fork <slug> --slug <new-slug>
floom apps claim <slug>
floom apps install <slug>
floom apps uninstall <slug>
floom apps update <slug> --visibility private
floom apps update <slug> --primary-action run
floom apps update <slug> --run-rate-limit-per-hour 120
floom apps delete <slug>

floom apps sharing get <slug>
floom apps sharing set <slug> --state link
floom apps sharing set <slug> --state private
floom apps sharing invite <slug> --email teammate@example.com
floom apps sharing revoke-invite <slug> <invite-id>
floom apps sharing submit-review <slug>
floom apps sharing withdraw-review <slug>

floom apps secret-policies list <slug>
floom apps secret-policies set <slug> GEMINI_API_KEY --policy user_vault
floom apps creator-secrets set <slug> GEMINI_API_KEY --value "$GEMINI_API_KEY"
floom apps creator-secrets delete <slug> GEMINI_API_KEY

floom apps rate-limit get <slug>
floom apps rate-limit set <slug> --per-hour 120

floom apps reviews list <slug>
floom apps reviews submit <slug> --rating 5 --body "Works well"
floom apps source get <slug>
floom apps source openapi <slug>
floom apps renderer get <slug>
floom apps renderer upload <slug> --source-file renderer.tsx
floom apps renderer delete <slug>
```

Pending-review, private, link-shared, and invited apps return `409 app_not_installable` from Store install commands. Owners manage those apps through Studio commands.

Other top-level namespaces advertised by `floom --help` are intentionally not documented here because their shell command files are not present in this checkout. Use the REST API or MCP account tools for those surfaces until the CLI namespaces are wired.

## CI

```bash
export FLOOM_API_KEY=floom_agent_...
export FLOOM_API_URL=https://floom.dev
floom deploy
```

## Agent packages

- Claude Code: `skills/claude-code/`
- Cursor: `skills/cursor/`
- Codex, Aider, Continue, and other terminal agents can shell out to `floom`.

## Related pages

- [/docs/mcp-install](/docs/mcp-install)
- [/docs/api-reference](/docs/api-reference)
- [/docs/runtime-specs](/docs/runtime-specs)
