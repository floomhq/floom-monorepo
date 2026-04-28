# Install Floom in an MCP client

Every public Floom app exposes an MCP server. Add the endpoint to Claude Desktop, Claude Code, Cursor, Codex CLI, or any MCP client, and the agent can run the app as a tool.

## MCP URLs

| Surface | URL | What it does | Auth |
|---|---|---|---|
| **Run one app** | `https://floom.dev/mcp/app/<slug>` | One MCP server per published app. | Public apps work without auth. Private/workspace apps require an Agent token. |
| **Discover apps** | `https://floom.dev/mcp/search` | Search public apps from an agent. | None. |
| **Account + Studio tools** | `https://floom.dev/mcp` | Discover, run, inspect runs, manage Studio apps, secrets, profile context, sharing, and rate limits. | `Authorization: Bearer floom_agent_...` |

Mint Agent tokens at `https://floom.dev/home`.

## Claude Desktop

Open the config file and add entries under `mcpServers`.

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "floom-search": { "url": "https://floom.dev/mcp/search" },
    "floom-lead-scorer": { "url": "https://floom.dev/mcp/app/lead-scorer" },
    "floom-account": {
      "url": "https://floom.dev/mcp",
      "headers": { "Authorization": "Bearer floom_agent_..." }
    }
  }
}
```

Quit Claude Desktop, reopen it, then ask it to list Floom tools.

## Claude Code

```bash
claude mcp add --transport http floom-lead-scorer https://floom.dev/mcp/app/lead-scorer
claude mcp add --transport http floom-account https://floom.dev/mcp \
  --header "Authorization: Bearer floom_agent_..."
```

The verified argument order is:

```bash
claude mcp add --transport http <name> <url>
```

## Cursor

Cursor reads `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "floom-lead-scorer": { "url": "https://floom.dev/mcp/app/lead-scorer" },
    "floom-account": {
      "url": "https://floom.dev/mcp",
      "transport": "http",
      "headers": { "Authorization": "Bearer floom_agent_..." }
    }
  }
}
```

Reload Cursor after editing.

## Codex CLI

Codex uses TOML:

```toml
[mcp_servers.floom]
url = "https://floom.dev/mcp"
http_headers = { Authorization = "Bearer floom_agent_..." }
```

For a single public app:

```toml
[mcp_servers.floom_lead_scorer]
url = "https://floom.dev/mcp/app/lead-scorer"
```

## Any other MCP client

- Specific app: `https://floom.dev/mcp/app/<slug>`
- Discovery: `https://floom.dev/mcp/search`
- Account/Studio: `https://floom.dev/mcp` with `Authorization: Bearer floom_agent_...`

Floom uses Streamable HTTP. Clients must send `Accept: application/json, text/event-stream`.

## Related pages

- [/docs/cli](/docs/cli)
- [/docs/api-reference](/docs/api-reference)
- [/docs/self-host](/docs/self-host)
