# The Floom Protocol

Floom is the protocol + runtime for agentic work. Build agents, workflows, and scripts with AI — Floom deploys them as MCP, API, web, or CLI, production-grade, live in 30 seconds. This spec defines how a tool becomes a Floom app.

## One spec, every surface

A tool becomes a Floom app by providing an **OpenAPI spec** — either as a URL (proxied mode) or embedded in a repo (hosted mode). From that spec, Floom derives every agent-callable surface and wraps it in a full production layer.

## The manifest

Two modes:

### Proxied — wrap an existing API

```yaml
name: stripe
type: proxied
openapi_spec_url: https://docs.stripe.com/api/openapi.json
base_url: https://api.stripe.com
auth: bearer
secrets: [STRIPE_SECRET_KEY]
```

### Hosted — Floom runs your app

```yaml
name: flyfast
type: hosted
runtime: python3.12      # optional, auto-detected from pyproject.toml/requirements.txt
openapi_spec: ./openapi.yaml
build: pip install .
run: uvicorn flyfast.server:app --port 8000
```

## What gets generated automatically

From the OpenAPI spec, Floom derives:

- **MCP server**: each OpenAPI operation becomes an MCP tool, with the operation's parameters as the tool's inputs and the response schema as the output.
- **HTTP API**: Floom proxies requests to the underlying service, injecting secrets at runtime and enforcing rate limits / access control.
- **CLI**: each operation becomes a command. `floom run stripe list-customers --limit=10`.
- **Web**: inputs are rendered as a form (typed by the OpenAPI schema) and outputs are piped through a built-in renderer. Long-running operations stream output.
- **Typed SDKs**: openapi-generator spits out clients in any language.

## Plumbing layers (auto-applied)

Every Floom app gets:

- Secrets vault (injected as env vars at runtime)
- Rate limiting (global + per-IP, custom per-operation)
- Streaming output for long-running operations
- Run history + audit log
- (Coming soon) Access control, staging environments, version control, per-app databases, OAuth, payment / billing

## Self-hosting

Floom is MIT licensed. Floom.dev is the hosted flagship, but you can run the full stack yourself.

**Via Docker** (one command):
```bash
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=... \
  ghcr.io/floomhq/floom:latest
```

**Via npm** (embed the runtime in your own Node server):
```bash
npm install @floom/runtime
```

```typescript
import { runApp } from '@floom/runtime';

const result = await runApp({
  manifest,
  inputs,
  secrets,
  onStream: (chunk) => console.log(chunk),
});
```

**Same runtime on cloud and self-host.** v1 runs Docker everywhere. v1.1 adds Cloud Run scale-to-zero on floom.dev (invisible to creators, manifest format unchanged).

## Why OpenAPI?

OpenAPI is the industry-standard contract for describing an API. Every serious SaaS publishes one. Every code-generator tool reads one. Floom meeting creators at the OpenAPI layer means:

1. **Zero new format to learn** — you probably already have an OpenAPI spec
2. **Single source of truth** — the spec is the contract; every surface is derived mechanically
3. **No drift** — when the spec changes, every surface updates
4. **Instant ecosystem compatibility** — works with every tool that speaks OpenAPI

## Vendor extensions (`x-floom-*`)

Floom uses OpenAPI vendor extensions (keys prefixed with `x-floom-`) to carry rendering hints and runtime policy the core OpenAPI grammar does not express. Every extension is optional; Floom derives sensible defaults when absent.

### Operation-level

| Extension | Values | Default | Purpose |
|-----------|--------|---------|---------|
| `x-floom-shape` | `prompt` / `form` / `auto` | `auto` | UX mode on the web surface. `prompt` = textarea composer + thread history. `form` = schema form + run-log history. `auto` = `prompt` if the operation has exactly one `textarea`-shaped field, else `form`. |
| `x-floom-stream` | `true` / `false` | `false` | Mark the response as a token stream. Switches the renderer to `stream` shape and enables SSE on the web surface. |
| `x-floom-user-secrets` | `string[]` | `[]` | List of env-var names the end-user must provide (e.g. `FLYFAST_API_KEY`). Triggers the credentials-required state on `/run` before the app can execute. |

### Parameter / request-body-level

| Extension | Values | Purpose |
|-----------|--------|---------|
| `x-floom-input-shape` | `InputShape` | Force the input renderer shape. Wins over any schema-derived discrimination. |
| `x-floom-multiline` | `true` / `false` | Force `textarea` rendering for a short string. |
| `x-floom-language` | e.g. `python`, `typescript`, `sql` | Render a string input as a syntax-highlighted code editor. |
| `x-floom-max-size` | e.g. `2MB`, `50MB` | Size cap on `file`/`image`/`csv`/`multifile` inputs. Validated client-side and server-side. |

### Response-level

| Extension | Values | Purpose |
|-----------|--------|---------|
| `x-floom-output-shape` | `OutputShape` | Force the output renderer shape. Wins over any schema-derived discrimination. |
| `x-floom-language` | e.g. `python` | Render a string response as a syntax-highlighted code block. |

## Renderer contract

`packages/renderer` ships a schema-driven renderer for both sides of the run. The single source of truth is the OpenAPI JSON Schema plus the vendor extensions above; there are no parallel type unions.

### Input shapes

14 canonical shapes: `text`, `textarea`, `code`, `url`, `number`, `enum`, `boolean`, `date`, `datetime`, `file`, `image`, `csv`, `multifile`, `json`.

Derivation precedence (first match wins, catch-all is always `text`):

```text
1. x-floom-input-shape: <shape>                              — wins outright
2. type:string + format:binary + contentMediaType:text/csv   → csv
3. type:string + format:binary + contentMediaType:image/*    → image
4. type:string + format:binary                               → file
5. type:array  + items.format:binary                         → multifile
6. type:string + format:date                                 → date
7. type:string + format:date-time                            → datetime
8. type:string + format:uri                                  → url
9. type:string + enum                                        → enum
10. type:string + contentMediaType:application/json          → json
11. type:string + x-floom-language                           → code
12. type:string + (maxLength > 200 or x-floom-multiline)     → textarea
13. type:string                                              → text
14. type:number | type:integer                               → number
15. type:boolean                                             → boolean
```

Discriminator: `pickInputShape(schema: ParameterSchema): InputShape` in `@floom/renderer`.

### Output shapes

10 canonical shapes: `text`, `markdown`, `code`, `table`, `object`, `image`, `pdf`, `audio`, `stream`, `error`.

Derivation precedence (first match wins, catch-all is `text`):

```text
1. x-floom-output-shape: <shape>                             — wins outright
2. contentType: text/event-stream | application/x-ndjson     → stream
3. contentType: image/*                                      → image
4. contentType: application/pdf                              → pdf
5. contentType: audio/*                                      → audio
6. contentType: text/markdown                                → markdown
7. type:array (uniform object items)                         → table
8. type:object                                               → object
9. type:string + format:markdown                             → markdown
10. type:string + x-floom-language                           → code
11. type:string                                              → text
12. state === "output-error"                                 → error (pseudo-shape)
```

Discriminator: `pickOutputShape(schema: ResponseSchema): OutputShape` in `@floom/renderer`.

### State machine

Every Floom run moves through three states; the same component tree stays mounted across all three.

```text
input-available  → output-available
                 → output-error
```

The renderer contract (`RenderProps`) is the only shape custom renderers need to know about. Treat it as stable: additive changes only.

### Visual contract

The locked design system for every shape × state combination lives at [`wireframes.floom.dev/v15/schema-components.html`](https://wireframes.floom.dev/v15/schema-components.html).

## API surface

```
GET  /api/hub                       -> list all apps
GET  /api/hub/:slug                 -> app detail + manifest
POST /api/pick  { prompt, limit }   -> ranked app picks for a query
POST /api/parse { prompt, app_slug, action } -> structured inputs from prose
POST /api/run   { app_slug, inputs, action, thread_id } -> { run_id, status }
GET  /api/run/:id                   -> run snapshot
GET  /api/run/:id/stream            -> SSE: log lines + status transitions
POST /api/thread                    -> create thread
POST /api/thread/:id/turn           -> save turn
GET  /api/health                    -> { ok: true, ... }
```

## MCP surface

Each app exposes a per-app MCP server at `/mcp/app/{slug}`. The MCP server uses HTTP+SSE transport (MCP spec 2024-11-05). Tools are generated from the OpenAPI spec: each operation becomes one MCP tool, with the operation's parameters mapped to JSON Schema properties.

```
GET  /mcp/app/stripe          -> SSE stream (MCP notifications)
POST /mcp/app/stripe          -> MCP JSON-RPC (tool calls, initialize, etc.)
```

## License

MIT. Open source. Self-hostable. Fork welcome.

---

<sub>Positioning · 2026-04-17 · <em>The protocol + runtime for agentic work.</em></sub>
