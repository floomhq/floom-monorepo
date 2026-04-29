# Quickstart

Build and run a Floom app from the terminal.

## 1. Install

```bash
curl -fsSL https://floom.dev/install.sh | bash
floom --version
```

## 2. Authenticate

```bash
floom login
```

Mint an Agent token at `https://floom.dev/me/agent-keys`, then run the printed command:

```bash
floom auth login --token=floom_agent_...
```

## 3. Create a manifest

```bash
floom init
```

For the shell CLI, set `openapi_spec_url` in `floom.yaml`. Inline `openapi_spec`
objects are supported by the API/MCP ingest surfaces, not by `floom deploy`.

## 4. Publish

```bash
floom deploy --dry-run
floom deploy
```

The CLI prints:

- app page: `https://floom.dev/p/<slug>`
- MCP URL: `https://floom.dev/mcp/app/<slug>`
- owner page: `https://floom.dev/studio/<slug>`

## 5. Run

Browser:

```text
https://floom.dev/p/<slug>
```

CLI:

```bash
floom run <slug> '{"input":"hello"}'
floom run <slug> --input input=hello
```

For multi-action apps, include the operation in the JSON body:

```bash
floom run petstore '{"action":"getInventory"}'
```

HTTP:

```bash
curl -X POST https://floom.dev/api/<slug>/run \
  -H "Content-Type: application/json" \
  -d '{"action":"getInventory","input":"hello"}'
```

MCP:

```json
{
  "mcpServers": {
    "floom-app": { "url": "https://floom.dev/mcp/app/<slug>" }
  }
}
```

## 6. Add context and secrets

```bash
floom account context set-user --json '{"name":"Federico"}'
floom account context set-workspace --json '{"company":{"name":"Floom"}}'
floom account secrets set GEMINI_API_KEY --value "$GEMINI_API_KEY"
floom run <slug> --input input=hello --use-context
```

## Next

- [CLI](/docs/cli)
- [MCP install](/docs/mcp-install)
- [API reference](/docs/api-reference)
