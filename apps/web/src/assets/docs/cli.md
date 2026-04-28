# Floom CLI

The Floom CLI scaffolds, validates, publishes, runs, and manages apps from the terminal.

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

Mint an Agent token at `https://floom.dev/home`, then run the command printed by the CLI:

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

`floom deploy` publishes one of these manifest sources:

- `openapi_spec_url` or `openapi_url`
- inline/file-backed `openapi_spec`
- gated `docker_image_ref` when the target instance enables Docker publish

Successful deploy output includes the app page, MCP URL, Studio owner URL, and Claude Desktop MCP JSON.

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

## Apps, runs, jobs

```bash
floom apps list
floom apps get <slug>
floom apps update <slug> --visibility private
floom apps update <slug> --primary-action run
floom apps update <slug> --run-rate-limit-per-hour 120
floom apps sharing get <slug>
floom apps rate-limit set <slug> --per-hour 120

floom runs list
floom runs get <run-id>
floom runs share <run-id>
floom runs delete <run-id>

floom jobs create <slug> '{"input":"hello"}'
floom jobs get <slug> <job-id>
floom jobs cancel <slug> <job-id>
```

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
