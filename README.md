<div align="center">
  <img src="./docs/assets/hero-landing.png" alt="Floom" width="900" />

  <h1>Floom</h1>

  <p><strong>Ship AI apps fast.</strong><br/>
  The protocol and runtime for agentic work.<br/>
  Run published AI apps today. Cloud publishing, MCP creator tooling, and agent-token workflows are in beta access while the public site is in waitlist mode.</p>

  <p>
    <a href="https://github.com/floomhq/floom/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/floomhq/floom/ci.yml?branch=main&label=CI" alt="CI status"/></a>
    <a href="https://github.com/floomhq/floom/stargazers"><img src="https://img.shields.io/github/stars/floomhq/floom?style=flat&color=111" alt="Stars"/></a>
    <a href="https://github.com/floomhq/floom/blob/main/LICENSE"><img src="https://img.shields.io/github/license/floomhq/floom?color=111&label=license" alt="License"/></a>
    <a href="https://github.com/floomhq/floom/pkgs/container/floom-monorepo"><img src="https://img.shields.io/badge/ghcr.io-floom--monorepo-0969da" alt="Docker image"/></a>
    <a href="https://discord.gg/8fXGXjxcRz"><img src="https://img.shields.io/discord/1494746428403089590?label=discord&logo=discord&logoColor=white&color=5865F2" alt="Discord"/></a>
    <a href="https://floom.dev"><img src="https://img.shields.io/badge/live-floom.dev-22c55e" alt="Live at floom.dev"/></a>
  </p>

  <p>
    <a href="https://floom.dev/apps">Try it</a> ·
    <a href="./docs/SELF_HOST.md">Self-host</a> ·
    <a href="https://floom.dev/waitlist">Waitlist</a> ·
    <a href="./spec/protocol.md">Protocol</a> ·
    <a href="./docs/ROADMAP.md">Roadmap</a> ·
    <a href="https://discord.gg/8fXGXjxcRz">Discord</a>
  </p>
</div>

---

```
OpenAPI spec ──▶ Floom ──▶ 3 surfaces
                           ├─ MCP server    (/mcp/app/:slug)
                           ├─ HTTP endpoint (/api/:slug/run)
                           └─ Web form      (/p/:slug)
```

> **Public beta + waitlist.** Floom Cloud is open for running published apps, while Cloud publishing, hosted repo deploys, MCP creator tooling, and agent-token account workflows are gated during beta access. Self-host works today with one Docker command. Three AI apps are live now for anyone to try: [competitor-lens](https://floom.dev/p/competitor-lens), [ai-readiness-audit](https://floom.dev/p/ai-readiness-audit), [pitch-coach](https://floom.dev/p/pitch-coach). [Join the waitlist](https://floom.dev/waitlist) for Cloud publishing.

> **Install the CLI with `curl -fsSL https://floom.dev/install.sh | bash`.** Do NOT run `npm install floom` - the unscoped `floom` npm package is an unrelated third-party streaming tool. Details: [cli/floom/README.md](./cli/floom/README.md).

Point a self-hosted Floom instance at an OpenAPI spec and you get all three, from the same manifest, with auth, rate limits, secret injection, run history, and shareable output pages. The hosted Cloud publish path is waitlist-gated during the beta.

GitHub repo paste currently discovers OpenAPI specs inside a repo and publishes the resulting proxied app for beta users with publish access. Full "Floom hosts my repo code" publishing is tracked separately in [`packages/runtime`](./packages/runtime) as future platform work.

## Quickstart

### Cloud publish beta

Public Cloud is in waitlist mode. The CLI publish flow below is available to beta users with Cloud publishing and Agent-token access enabled.

```bash
curl -fsSL https://floom.dev/install.sh | bash
floom login
floom auth login --token=floom_agent_...
floom init
```

Edit `floom.yaml` so it points at a public OpenAPI spec:

```yaml
name: Petstore
slug: petstore-demo
description: OpenAPI 3.0 reference pet store.
openapi_spec_url: https://petstore3.swagger.io/api/v3/openapi.json
visibility: private
```

Then validate, publish, and run it after your account has beta publishing access:

```bash
floom deploy --dry-run
floom deploy
floom run petstore-demo '{"action":"getInventory"}'
```

For beta publishers, the deploy output prints the web page at `https://floom.dev/p/petstore-demo`, the MCP endpoint, and the Studio owner URL. Without beta publishing access, use the live apps or self-host locally.

### Self-host in one container

```bash
docker run -p 3051:3051 ghcr.io/floomhq/floom-monorepo:latest
```

Or try the live apps at [floom.dev/apps](https://floom.dev/apps) — no install. Full self-host walkthrough: [docs/SELF_HOST.md](./docs/SELF_HOST.md).

## What it is

Floom is a runtime and a protocol for agentic apps. In the beta publish path, you describe an app with an OpenAPI spec; Floom gives you an MCP server an agent can call, a plain HTTP endpoint, and a web form on a shareable URL — all at the same time, all backed by the same auth and rate-limit layer.

The whole stack self-hosts in one Docker container. Source is [MIT](./LICENSE).

## The three surfaces

**MCP** — any client that speaks Model Context Protocol (Claude Desktop, Claude Code, Cursor, Codex CLI) can call your app as a tool.

```json
{
  "mcpServers": {
    "resend": { "url": "http://localhost:3051/mcp/app/resend" }
  }
}
```

**HTTP** — straight JSON-in, JSON-out. Use it from curl, a backend, a cron job.

```bash
curl -X POST http://localhost:3051/api/resend/send-email \
  -H "Authorization: Bearer $FLOOM_API_KEY" \
  -H "content-type: application/json" \
  -d '{"from":"hi@floom.dev","to":"you@example.com","subject":"hi","text":"first"}'
```

**Web form** — a clean page at `/p/:slug` your teammates can fill in, with typed inputs, a shareable result URL, and a run history.

```
https://floom.dev/p/competitor-lens
```

## Who it's for

- **Makers shipping side projects.** In self-host or Cloud beta publishing, paste an OpenAPI URL, publish a shareable page, hand your friends an MCP tool.
- **Teams running internal tools.** Wrap a Stripe-style API in a form your ops team can fill in, with runs logged and outputs rendered cleanly.

Two equal ICPs. Two CTAs on the homepage. Two dashboards (`/me` for runners, `/creator` for publishers).

## Showcase apps

Three apps shipped with Floom to show what it can do:

| App | What it does | Live |
|---|---|---|
| [competitor-lens](./examples/competitor-lens) | Compares your landing page against a competitor and returns positioning, pricing, and angle differences. | [floom.dev/p/competitor-lens](https://floom.dev/p/competitor-lens) |
| [ai-readiness-audit](./examples/ai-readiness-audit) | Audits one site for AI readiness, risks, opportunities, and a concrete next action. | [floom.dev/p/ai-readiness-audit](https://floom.dev/p/ai-readiness-audit) |
| [pitch-coach](./examples/pitch-coach) | Reviews a short startup pitch and returns critiques, rewrites, and a TL;DR. | [floom.dev/p/pitch-coach](https://floom.dev/p/pitch-coach) |

Each one is a real OpenAPI-defined app under [`examples/`](./examples) — fork, rename, tweak the prompt.

<p align="center">
  <img src="./docs/assets/demo-product-page.png" alt="A published Floom app" width="420" />
  &nbsp;
  <img src="./docs/assets/demo-dashboard.png" alt="Creator dashboard" width="420" />
</p>

## Self-host

```yaml
# apps.yaml — one app, wrapped in 10 lines
apps:
  - slug: resend
    type: proxied
    openapi_spec_url: https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml
    base_url: https://api.resend.com
    auth: bearer
    secrets: [RESEND_API_KEY]
    display_name: Resend
    description: "Transactional email API."
```

```bash
docker run -d --name floom \
  -p 3051:3051 \
  -v floom_data:/data \
  -v "$(pwd)/apps.yaml:/app/config/apps.yaml:ro" \
  -e FLOOM_APPS_CONFIG=/app/config/apps.yaml \
  -e RESEND_API_KEY=re_... \
  ghcr.io/floomhq/floom-monorepo:latest
```

Open `http://localhost:3051/p/resend`, or point your agent at `http://localhost:3051/mcp/app/resend`.

Two manifest shapes ship out of the box:

```yaml
# Proxied — wrap an existing API
type: proxied
openapi_spec_url: https://api.example.com/openapi.json
base_url: https://api.example.com
auth: bearer
secrets: [EXAMPLE_API_KEY]
```

```yaml
# Hosted — Floom runs your container
type: hosted
runtime: python3.12
openapi_spec: ./openapi.yaml
build: pip install .
run: uvicorn my_app.server:app --port 8000
```

A single request header can only carry one auth token, so pick one per deployment: `FLOOM_AUTH_TOKEN` (operator-wide kill switch) **or** `FLOOM_CLOUD_MODE=true` (real user sign-in + Agent tokens). Full breakdown: [`docker/.env.example`](./docker/.env.example).

Full self-host guide: [docs/SELF_HOST.md](./docs/SELF_HOST.md) · Protocol spec: [spec/protocol.md](./spec/protocol.md) · More examples: [`examples/`](./examples).

## Repo layout

- `apps/web` — floom.dev web surface (React, form + output renderer)
- `apps/server` — backend (Hono + SQLite + Docker runner + MCP)
- `packages/renderer` — `@floom/renderer`, default + custom output/input renderer library
- `spec/protocol.md` — Floom Protocol spec
- `examples/` — example manifests, including the three current showcase apps above

## Development

```bash
pnpm install
pnpm dev
```

Web on `:5173`, server on `:3051`, hot reload on both.

## Contributing

Short version: pick an issue labelled `good first issue` or drop a new example app under [`examples/`](./examples). Full guide, including how to add a showcase app: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Community & support

- **Discord** — [discord.gg/8fXGXjxcRz](https://discord.gg/8fXGXjxcRz) for help, ideas, and patch-of-the-day.
- **Docs** — [floom.dev/docs](https://floom.dev/docs)
- **Issues** — [github.com/floomhq/floom/issues](https://github.com/floomhq/floom/issues) for bugs, feature requests, docs gaps.
- **Security** — read [SECURITY.md](./SECURITY.md), email `security@floom.dev`.

## License

Floom is released under the [MIT license](./LICENSE). Use it at work, use it at home, fork it, sell products built on top of it. If you ship something cool, we'd love to see it in the Discord.

---

<p align="center">
  <a href="https://star-history.com/#floomhq/floom&Date"><img src="https://api.star-history.com/svg?repos=floomhq/floom&type=Date" alt="Star history" width="640" /></a>
</p>

<p align="center">Built in SF by <a href="https://github.com/federicodeponte">@federicodeponte</a>.</p>
