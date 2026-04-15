# Claude Wrapped — proxied-mode example

Spotify Wrapped for Claude Code. Parses one or more pasted `~/.claude/projects/.../<session>.jsonl`
files and returns a styled HTML report with headline stats (sessions, user
messages, assistant messages, top tools).

Pure Node.js HTTP server that exposes an OpenAPI 3.0 spec at `/openapi.json`
and one operation at `POST /generate`. No external dependencies, no API keys,
no docker.sock.

## Run standalone

```bash
node examples/claude-wrapped/server.mjs &
curl -sX POST http://localhost:4111/generate \
  -H 'content-type: application/json' \
  -d '{"jsonl_sessions":"{\"type\":\"user\",\"timestamp\":\"2026-04-15T10:00:00Z\"}","author":"Fede","project_slug":"demo"}' | jq .sessions
```

## Run via Floom

```bash
node examples/claude-wrapped/server.mjs &
FLOOM_APPS_CONFIG=examples/claude-wrapped/apps.yaml \
  DATA_DIR=/tmp/floom-claude-wrapped \
  node apps/server/dist/index.js &
curl -sX POST http://localhost:3051/api/claude-wrapped/run \
  -H 'content-type: application/json' \
  -d '{"action":"generate","inputs":{"jsonl_sessions":"{\"type\":\"user\"}"}}' | jq
```

## Docker

```bash
docker build -t floom-example-claude-wrapped -f examples/claude-wrapped/Dockerfile examples/claude-wrapped
docker run -p 4111:4111 floom-example-claude-wrapped
```
