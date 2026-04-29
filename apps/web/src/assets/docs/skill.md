# Claude Code Skill

The Floom Claude Code Skill is a beta publisher helper. Drop it once into `~/.claude/skills/floom/SKILL.md` and it teaches Claude Code the Floom slash commands for creating, publishing, running, listing, and sharing apps. Public Cloud is in waitlist mode; publish/share/account commands require beta access, while public apps can still be run from the browser or via MCP.

## Install

One-liner:

```bash
mkdir -p ~/.claude/skills/floom && \
  curl -fsSL https://floom.dev/skill.md \
  -o ~/.claude/skills/floom/SKILL.md
```

Then install and auth the CLI once if your account has beta publishing access:

```bash
npm i -g @floomhq/cli@latest
floom auth login --token=floom_agent_...
```

Get your beta Agent token at [floom.dev/settings/agent-tokens](https://floom.dev/settings/agent-tokens). If that page is not enabled for your account, join the waitlist or use a self-host instance.

## Commands

### `/floom-new <slug>`

Scaffolds a `floom.yaml` manifest and a starter handler in the current directory. The skill asks you the app name, description, and type (OpenAPI wrapper or custom Python), then runs `floom init`.

```
/floom-new competitor-lens
```

### `/floom-deploy`

Publishes the current directory's app for beta publishers and returns the live app page URL, MCP URL, and Studio link.

```
/floom-deploy
```

### `/floom-run <slug> [--input k=v]`

Runs a Floom app and streams the result inline. Uses the CLI if installed; falls back to a direct REST call if not.

```
/floom-run pitch-coach --input deck_url=https://example.com/deck.pdf
```

### `/floom-list`

Lists apps in the Floom store, rendered as a table of slug, name, description, and visibility.

```
/floom-list
```

### `/floom-share <state>`

Sets the sharing state of the app in the current directory. Valid states: `private`, `link`, or `public`.

```
/floom-share link
```

## Skill vs CLI vs MCP

| | Skill | CLI | MCP |
|---|---|---|---|
| **Setup** | Copy one file | `npm i -g @floomhq/cli` | Edit config + restart |
| **Where it runs** | Inside Claude Code chat | Any terminal | Any MCP-capable agent |
| **Best for** | Building and deploying from Claude Code | CI/CD, scripts, shell | Running apps from Claude Desktop, Cursor |
| **Auth** | Reads `~/.floom/config.json` or `FLOOM_API_KEY` | Same | Bearer token in config |

Use the **Skill** when you are already in Claude Code and have beta publishing access or a self-host instance.

Use the **CLI** directly when automating from a script or CI pipeline.

Use **MCP** when you want to call a specific app as a tool from Claude Desktop or Cursor.

## Auth

The skill checks for a token in this order:

1. `FLOOM_API_KEY` environment variable
2. `~/.floom/config.json` (written by `floom auth login`)

If neither is found, the skill prints the setup instructions and stops.

## Related

- [Install the CLI](/docs/cli)
- [MCP install](/docs/mcp-install)
- [Quickstart](/docs/quickstart)
