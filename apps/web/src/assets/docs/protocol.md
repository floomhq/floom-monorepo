# Protocol

The Floom protocol is the small contract every app follows so one description turns into a web form, an MCP tool, and an HTTP endpoint. It is designed to be boring: JSON in, JSON (or stream) out, bearer-token auth, one output marker.

This page covers what you need to ship a working app. The wire-level spec lives at [`spec/protocol.md`](https://github.com/floomhq/floom/blob/main/spec/protocol.md) and the TypeScript surface on the [`/protocol`](/protocol) page.

## The contract

Every Floom app, hosted or proxied, speaks the same protocol at the edge.

| Direction | Shape |
|---|---|
| **In** | `POST` with `Content-Type: application/json`, body `{ "action": "<name>", "inputs": { ... } }` |
| **Auth** | `Authorization: Bearer <key>` - either a per-operator token (`FLOOM_AUTH_TOKEN`) or a per-user key issued by Floom cloud |
| **Out (sync)** | `200 OK` with `{ "ok": true, "outputs": { ... } }` or `{ "ok": false, "error": "..." }` |
| **Out (stream)** | Server-Sent Events at `/api/run/<run_id>/stream` with `status`, `log`, `result` events |

Hosted apps produce their output by printing one line on stdout starting with `__FLOOM_RESULT__`. Everything before that marker is treated as logs; the JSON payload after it is the structured result.

## Two kinds of Floom app

### Proxied - wrap an existing API

Point Floom at an OpenAPI spec. It turns every operation into a form, MCP tool, and HTTP endpoint. Floom injects your secret at runtime; the key never leaves the Floom process.

```yaml
# floom.yaml (proxied)
name: Resend
slug: resend
type: proxied
openapi_spec_url: https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml
base_url: https://api.resend.com
auth: bearer
secrets_needed: [RESEND_API_KEY]
```

Use when the work already lives behind a documented API.

### Hosted - Floom runs your code

Write Python or Node. Declare inputs + outputs in `floom.yaml`. Floom builds a sandboxed container, injects your secrets, runs the script per call.

```yaml
# floom.yaml (hosted)
name: Lead Scorer
slug: lead-scorer
description: Score a CSV of leads against an ICP with Gemini.
category: growth
runtime: python
python_dependencies:
  - google-genai==1.64.0
secrets_needed:
  - GEMINI_API_KEY
actions:
  score:
    label: Score Leads
    inputs:
      - name: data
        label: Leads CSV
        type: file/csv
        required: true
      - name: icp
        label: Ideal Customer Profile
        type: textarea
        required: true
    outputs:
      - name: rows
        type: table
      - name: score_distribution
        type: json
manifest_version: "2.0"
```

Use when you're building something new - scoring, scraping, document processing, LLM chains.

## `floom.yaml` fields

Top-level:

| Field | Required | What it is |
|---|---|---|
| `name` | yes | Human-readable app name shown in the UI. |
| `slug` | yes | Lowercase, hyphen-safe. Used in URLs (`/p/<slug>`, `/api/<slug>/run`). |
| `description` | yes | One-paragraph summary shown in the directory. Supports multi-line. |
| `category` | no | Bucket in the app directory (e.g. `growth`, `dev-tools`). |
| `runtime` | hosted only | `python` or `node`. |
| `type` | proxied only | `proxied`. Omit for hosted. |
| `openapi_spec_url` | proxied only | HTTP(S) URL to the OpenAPI document. |
| `base_url` | proxied only | Origin Floom proxies requests to. |
| `auth` | proxied only | `bearer`, `apiKey`, or `none`. |
| `python_dependencies` | python only | Pinned pip requirements (list of strings). |
| `node_dependencies` | node only | npm package map. |
| `secrets_needed` | no | Names of env vars Floom injects at runtime. |
| `actions` | hosted only | Map of action name to `{label, inputs[], outputs[]}`. |
| `manifest_version` | yes | `"2.0"`. |

### Action `inputs[]` entries

| Field | Required | Values |
|---|---|---|
| `name` | yes | Identifier your code reads. |
| `type` | yes | `string`, `textarea`, `number`, `boolean`, `json`, `file`, `file/csv`, `file/pdf`, `file/png`, `file/jpg`, `file/mp3` |
| `label` | no | Label shown on the form. Defaults to `name`. |
| `required` | no | Defaults to `false`. |
| `description` | no | Helper text under the field. |
| `placeholder` | no | Placeholder text for the input. |
| `default` | no | Pre-filled value. |

### Action `outputs[]` entries

| Field | Values |
|---|---|
| `name` | Key in your result payload. |
| `type` | `text`, `number`, `markdown`, `json`, `table`, `html`, `file` |
| `label` | Column or section header in the rendered output. |

## The Python harness (hosted mode)

Your script receives one argument - the run config as JSON - does its work, and prints one `__FLOOM_RESULT__` line before exiting. That is the whole protocol.

```python
# main.py
import json
import sys

def score(data, icp, **_):
    # your logic here - open(data) reads the uploaded file,
    # os.environ["GEMINI_API_KEY"] reads the injected secret.
    return {"rows": [...], "score_distribution": {...}}

if __name__ == "__main__":
    config = json.loads(sys.argv[1])
    inputs = config.get("inputs") or {}
    try:
        outputs = score(**inputs)
        sys.stdout.write("__FLOOM_RESULT__" + json.dumps({"ok": True, "outputs": outputs}) + "\n")
    except Exception as exc:
        sys.stdout.write("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": str(exc)}) + "\n")
```

Node apps follow the same shape - read `process.argv[2]`, write `console.log("__FLOOM_RESULT__" + JSON.stringify({...}))`.

Full runnable example: [examples/lead-scorer/main.py](https://github.com/floomhq/floom/blob/main/examples/lead-scorer/main.py).

## File uploads (`__file` envelope)

Inputs declared as `type: file/*` are uploaded by the browser and materialized on disk before your script runs. The wire format is a JSON envelope:

```json
{
  "__file": true,
  "name": "leads.csv",
  "mime_type": "text/csv",
  "size": 4281,
  "content_b64": "Y29tcGFueSx3ZWJzaXRlLC4uLg=="
}
```

Floom decodes it, writes the file to `/floom/inputs/<name>.<ext>` inside the container, and passes the in-container path to your script:

```python
def score(data, icp, **_):
    with open(data) as f:   # data == "/floom/inputs/data.csv"
        ...
```

Limits: **6 MB max** per file, decoded. Larger uploads fail fast at the edge with a structured error. See [Limits](./limits).

## Calling an app from code

Every hosted or proxied app exposes `POST https://floom.dev/api/<slug>/run`. The request body is the same `{"action", "inputs"}` shape the form uses.

### curl

```bash
curl -X POST https://floom.dev/api/lead-scorer/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOOM_API_KEY" \
  -d '{
    "action": "score",
    "inputs": {
      "icp": "B2B SaaS CFOs at 100-500 employee fintechs in EU",
      "data": {
        "__file": true,
        "name": "leads.csv",
        "mime_type": "text/csv",
        "size": 1024,
        "content_b64": "Y29tcGFueSx3ZWJzaXRlLC4uLg=="
      }
    }
  }'
```

### Python

```python
import base64, json, requests

with open("leads.csv", "rb") as f:
    content_b64 = base64.b64encode(f.read()).decode()

resp = requests.post(
    "https://floom.dev/api/lead-scorer/run",
    headers={"Authorization": f"Bearer {FLOOM_API_KEY}"},
    json={
        "action": "score",
        "inputs": {
            "icp": "B2B SaaS CFOs at 100-500 employee fintechs in EU",
            "data": {
                "__file": True,
                "name": "leads.csv",
                "mime_type": "text/csv",
                "size": len(content_b64),
                "content_b64": content_b64,
            },
        },
    },
    timeout=300,
)
print(resp.json())
```

### JavaScript (fetch)

```javascript
const csv = await file.arrayBuffer();
const content_b64 = btoa(String.fromCharCode(...new Uint8Array(csv)));

const resp = await fetch("https://floom.dev/api/lead-scorer/run", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${FLOOM_API_KEY}`,
  },
  body: JSON.stringify({
    action: "score",
    inputs: {
      icp: "B2B SaaS CFOs at 100-500 employee fintechs in EU",
      data: {
        __file: true,
        name: file.name,
        mime_type: file.type,
        size: file.size,
        content_b64,
      },
    },
  }),
});

const { ok, outputs, error } = await resp.json();
```

Response shape (both sync and the final message on the stream):

```json
{
  "ok": true,
  "run_id": "run_01H...",
  "outputs": {
    "rows": [ ... ],
    "score_distribution": { ... }
  }
}
```

To follow logs as the run executes, open `GET /api/run/<run_id>/stream` and consume Server-Sent Events.

## What every app gets for free

- **Input validation** - bad types, missing required fields, and size overruns are rejected at the edge with a structured error. Your code never sees garbage.
- **Secrets injection** - names listed in `secrets_needed` are read from an encrypted per-user vault and passed as environment variables at run time. No keys in forms, URLs, or logs.
- **Rate limiting** - per-IP, per-user, per-(IP, app) buckets applied automatically. See [Limits](./limits).
- **Output rendering** - tables render as sortable tables, JSON as collapsible trees, markdown as formatted text, files as downloads. Override with a custom React bundle per app.
- **Run history** - every call is stored with its inputs, outputs, and logs. Share a read-only result at `floom.dev/r/<run_id>`.
- **MCP server** - `floom.dev/mcp/app/<slug>` exposes one tool per action. Drop it into Claude, Cursor, or any MCP-capable agent.
- **HTTP API** - `POST /api/<slug>/run`, logs streamable over Server-Sent Events.

## Phase 2 additions (coming soon)

Part of the protocol, on the roadmap, not all shipped yet.

| Addition | Status | What it is |
|---|---|---|
| **Job queue** | Partial | Long-running runs up to 30 minutes with webhook delivery, retries, cancellation. Declare `is_async: true`. See [W1.2 workplan](https://github.com/floomhq/floom/blob/main/WORKPLAN-20260414-W1.2-job-queue.md). |
| **File uploads** | Shipped | `__file` envelope, 6 MB cap. Larger sizes on the roadmap. |
| **Streaming output** | Coming soon | Token-by-token reveal as your script prints. Server-side SSE for logs and status already works. |
| **Session state** | Coming soon | Multi-turn runs that remember earlier inputs and outputs. |
| **Custom renderers** | Shipped | Override output rendering with a per-app React bundle. Custom input renderers coming. |

**Not on the protocol roadmap for v1.0:** GraphQL, gRPC, WebSocket / AsyncAPI. These are post-v1 extensions and will not hold up launch.

## Next

- [Getting started](./getting-started) - run your first app, publish your first app.
- [Deploy](./deploy) - floom.dev, self-host, or hybrid.
- [Limits](./limits) - hard numbers for runtime, rate limits, and file sizes.
- [Full spec](https://github.com/floomhq/floom/blob/main/spec/protocol.md) - wire-level details for anyone building an alternate server.
