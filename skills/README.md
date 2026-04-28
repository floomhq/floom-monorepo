# Floom agent packages

Floom CLI works from any shell or agent. These packages add first-class support for
Claude Code and Cursor. Codex CLI, Aider, Continue, and any bash-capable agent can
shell out to `floom` directly.

## Packages

| Agent | Directory | What it provides |
|-------|-----------|-----------------|
| Claude Code | `skills/claude-code/` | `/floom-init`, `/floom-deploy`, `/floom-status` slash commands |
| Cursor | `skills/cursor/` | `floom.mdc` rules file; agent shells out to `floom` CLI |

## CLI first

All packages call the `floom` CLI. Install it once:

```bash
curl -fsSL https://floom.dev/install.sh | bash
floom login
```

Mint an Agent token at https://floom.dev/home, then run the command printed by
`floom login`. Agent tokens look like `floom_agent_...`.

## Any other agent

Shell out to `floom` directly:

```bash
floom init
floom deploy --dry-run
floom deploy
floom status
floom account context get
floom account secrets list
```

Works with Codex CLI, Aider, Continue, or any agent that can run bash.
