---
name: floom
description: >
  Build and run Floom AI apps from Claude Code. Use when the user says
  "deploy to Floom", "publish to Floom", "run <app> on Floom",
  "/floom-new", "/floom-deploy", "/floom-run", "/floom-list", or
  "/floom-share". Scaffolds floom.yaml manifests, deploys apps, runs
  them via the REST API, lists the store, and manages sharing — all
  from the CLI if installed, or via direct REST calls if not.
---

# Floom skill for Claude Code

Source: https://floom.dev  
CLI package: `npm i -g @floomhq/cli@latest` (`@floomhq/cli`)  
Docs: https://floom.dev/docs  
Token: https://floom.dev/me/agent-keys

---

## Setup (one-time)

Check CLI availability and auth before any command:

```bash
if command -v floom &>/dev/null; then
  floom auth --show 2>/dev/null || echo "NOT_CONFIGURED"
else
  echo "CLI_MISSING"
fi
```

**If CLI is missing**, tell the user:

```
Floom CLI is not installed. To install:
  npm i -g @floomhq/cli@latest
  # or without npm:
  curl -fsSL https://floom.dev/install.sh | bash

Then run: floom auth login --token=floom_agent_...
Get your token at: https://floom.dev/me/agent-keys
```

**If CLI is installed but not configured**, resolve auth in order:
1. `FLOOM_API_KEY` env var
2. `~/.floom/config.json` (written by `floom auth login`)
3. If neither: ask the user to paste their token, then run:
   `floom auth login --token=<paste>`

Verify with `floom status` — expects JSON or "No apps yet", not an auth error.

---

## `/floom-new <slug>`

Scaffold a `floom.yaml` + starter handler in the current directory.

Ask one question at a time:
1. "App name? (e.g. 'Lead Scorer')" — derive slug: lowercase, dashes only, `^[a-z0-9][a-z0-9-]{0,47}$`
2. "One-sentence description?"
3. "Type: (a) wraps an existing OpenAPI service, or (b) custom Python code"
4. If `a`: "OpenAPI spec URL?"
5. If `b`: "Secrets needed? (comma-separated, e.g. GEMINI_API_KEY)"

Then run:

```bash
floom init
```

Stop after scaffolding. Do NOT deploy from `/floom-new`.

---

## `/floom-deploy`

Publish the current directory's app to Floom.

```bash
floom deploy
```

Dry run first if the user wants a preview:

```bash
floom deploy --dry-run
```

On success the CLI prints the app page URL, MCP URL, and Studio URL. Show them.

On `409 slug_taken`: show the `suggestions` array, ask the user to pick one, update `floom.yaml`, retry.

---

## `/floom-run <slug> [--input k=v ...]`

Run an app and stream the result. Prefers the CLI; falls back to REST.

**With CLI:**
```bash
floom run <slug> --input <key>=<value>
# multi-input:
floom run <slug> --input key1=val1 --input key2=val2
```

**Without CLI** (REST fallback — requires `FLOOM_API_KEY`):
```bash
curl -sS -X POST "https://floom.dev/api/<slug>/run" \
  -H "Authorization: Bearer ${FLOOM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"<key>":"<value>"}'
```

Show the response. If the run returns a `run_id`, poll `GET /api/me/runs/<run_id>` until `status` is `done` or `error`.

---

## `/floom-list`

List apps in the Floom store.

**With CLI:**
```bash
floom apps list
```

**Without CLI:**
```bash
curl -sS "https://floom.dev/api/hub/apps" \
  -H "Authorization: Bearer ${FLOOM_API_KEY}"
```

Render as a table: `slug / name / description / visibility`.

---

## `/floom-share <state>`

Set the sharing state of the current app (must be in a directory with `floom.yaml`).

Valid states: `private` | `link` | `public`

**With CLI:**
```bash
# read slug from floom.yaml:
SLUG=$(grep '^slug:' floom.yaml | awk '{print $2}')
floom apps sharing set "$SLUG" --state <state>
```

**Without CLI:**
```bash
SLUG=$(grep '^slug:' floom.yaml | awk '{print $2}')
curl -sS -X PATCH "https://floom.dev/api/apps/${SLUG}/sharing" \
  -H "Authorization: Bearer ${FLOOM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"state":"<state>"}'
```

---

## Error handling

| HTTP | Code | Response |
|------|------|----------|
| 401 | auth_required | "Token isn't working. Run \`floom auth logout\` then \`floom auth login\`." |
| 400 | invalid_body | Show \`details\` from response, point at the bad field. |
| 400 | detect_failed | "Couldn't reach or parse the spec URL. Does \`curl <url>\` return valid JSON/YAML?" |
| 409 | slug_taken | Show \`suggestions\`, ask user to pick, retry. |
| 5xx | — | "Floom returned <code>. Retry in a minute or check https://floom.dev/status." |

Never retry on 4xx. 5xx: retry once with 2 s backoff.
