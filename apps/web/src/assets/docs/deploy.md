# Deploy

Two decisions: where the runtime lives (Floom cloud, your Docker, or a hybrid), and how your app gets there (paste a GitHub URL or an OpenAPI URL).

## Where it runs

### 1. Floom cloud - floom.dev (easiest)

Sign in at [floom.dev/studio/build](https://floom.dev/studio/build). Paste a repo URL or an OpenAPI spec URL. Hit publish. You get a permalink (`floom.dev/p/<slug>`), an MCP server (`floom.dev/mcp/app/<slug>`), and an HTTP endpoint (`floom.dev/api/<slug>/run`). Secrets live in an encrypted per-user vault.

Free during beta. Use this when you want to ship today.

### 2. Self-host - Docker (free, your infrastructure)

One command brings up the full Floom stack - web form, output renderer, MCP server, HTTP endpoint - on any machine with Docker.

```bash
# 1. Describe which proxied apps you want
cat > apps.yaml <<'EOF'
apps:
  - slug: resend
    type: proxied
    openapi_spec_url: https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml
    auth: bearer
    secrets: [RESEND_API_KEY]
    display_name: Resend
    description: Transactional email API.
EOF

# 2. Start Floom
docker run -d --name floom \
  -p 3051:3051 \
  -v floom_data:/data \
  -v "$(pwd)/apps.yaml:/app/config/apps.yaml:ro" \
  -e FLOOM_APPS_CONFIG=/app/config/apps.yaml \
  -e RESEND_API_KEY=re_your_key_here \
  ghcr.io/floomhq/floom-monorepo:latest

# 3. Check it's up
curl http://localhost:3051/api/health
```

Open `http://localhost:3051/p/resend` or point an agent at `http://localhost:3051/mcp/app/resend`.

Use this when you want full control, air-gapped deployments, no third-party data path, or to run Floom for free forever. MIT licensed. No run caps, no BYOK gate, no per-user quotas - your box, your rules. See [Limits](./limits).

Long-form guide: [SELF_HOST.md](https://github.com/floomhq/floom/blob/main/docs/SELF_HOST.md) - every environment variable, auth mode, HTTPS setup, upgrades.

### 3. Hybrid - self-hosted runtime + Floom cloud UI

Run the Floom server on your own box (for data path, secrets, execution) and let your team use [floom.dev](https://floom.dev) as the front door - browsing, sharing runs, installing MCP servers. Setup is identical to self-host; the cloud app points at your runtime URL.

Use this when compliance requires self-hosted execution but you still want a polished team UI.

## How an app gets published

Floom cloud accepts two starting points. Both land at the same publish step.

### Paste a GitHub repo URL

```
https://github.com/floomhq/floom/tree/main/examples/lead-scorer
```

Floom clones, detects the shape, and routes accordingly:

| What Floom looks for (in order) | Outcome |
|---|---|
| `openapi.yaml` / `openapi.json` at repo root | Wraps it as a proxied app. |
| `floom.yaml` at repo root or in subfolder | Uses your declared manifest. Runs through detect + build + smoke test. |
| `Dockerfile` + `requirements.txt` / `package.json` / `pyproject.toml` | Infers a runtime from file signatures and ships a best-guess draft `floom.yaml` you can review before publishing. |
| Nothing recognisable | Stops and shows you the ["prepare with Claude"](/docs/prepare-with-claude) flow - paste the prompt into your agent, let it write the config, push, re-ingest. |

### Paste an OpenAPI URL

```
https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml
```

Floom parses the spec, lists every operation, generates a form per operation, and wraps the whole thing as a proxied app. No code involved - this path never runs a container.

### Upload a zipped folder (roadmap)

Direct ZIP upload is not in v1 - today the repo path is GitHub-only. If you want hosted mode without a public repo, use the Docker self-host path and mount your source directly, or push to a private repo and wait for the private-repo import flow (tracking: [#234](https://github.com/floomhq/floom/issues/234)).

## What happens on push

Apps published from a GitHub URL get a webhook subscription on the source repo. Every push to the default branch (or the tag you pinned) triggers a re-detect + re-build + smoke test. Success publishes a new version; failure keeps the previous version live and surfaces the build log under **Runs → Build history**.

## Publishing states

Apps on Floom cloud move through three states before anyone can see them publicly. Tracked in [#360](https://github.com/floomhq/floom/issues/360).

| State | What it means | Who can run it |
|---|---|---|
| **draft** | You just published. Floom ran build + smoke test and it passed. Not yet listed in the public directory. | You and anyone you share the permalink with. |
| **pending_review** | You submitted the app for audit. Floom runs an automated secret scan + runtime sanity check; a human reviewer approves or rejects. | You. |
| **published** | Approved. Listed at [floom.dev/apps](https://floom.dev/apps), discoverable by search, installable in any MCP client. | Anyone with the link (or anonymously, within rate limits). |

Unlisted apps (private) skip review - only you and anyone you explicitly share the link with can run them.

## The `floom` CLI (coming soon)

The CLI (`@floom/cli`) is currently a stub - `floom deploy <repo>` and `floom run <slug>` both exit with a "not wired yet, use the web UI" message.

Why: the web UI covers the launch-week happy path and the programmatic API (`POST /api/deploy-github`) is still being hardened. Tracking: [#234](https://github.com/floomhq/floom/issues/234). Until it lands, publish through [floom.dev/studio/build](https://floom.dev/studio/build) or self-host via Docker.

What you *can* run today:

```bash
npx @floom/cli init
```

Detects the shape of the current directory (Dockerfile, package.json, requirements.txt, pyproject.toml, existing OpenAPI spec) and writes a best-guess `floom.yaml` you can review before pushing to GitHub. See [Prepare with Claude](/docs/prepare-with-claude) for the full flow.

## Auth (before you deploy)

Floom ships two independent auth layers that share one HTTP header. Enable **one per deployment**.

- **`FLOOM_AUTH_TOKEN`** - a single operator-wide token. Every request must carry `Authorization: Bearer <token>`. Good for a solo box, a CI sandbox, or a staging guard.
- **`FLOOM_CLOUD_MODE=true`** - multi-user sign-in (email + password, GitHub, Google) and per-user API keys. Your teammates each sign up and get their own vault.

One `Authorization` header can only carry one token. If you enable both, signed-in users get locked out of the API. Read the comment block above `FLOOM_AUTH_TOKEN` in [`docker/.env.example`](https://github.com/floomhq/floom/blob/main/docker/.env.example) before turning either on.

## Persistence (self-host)

The default image keeps SQLite and per-app state under `/data`. Mount a volume (`-v floom_data:/data`) to survive restarts.

For production: set `PUBLIC_URL` to the URL your users see (Floom bakes it into MCP install snippets and share links), put Floom behind a TLS-terminating proxy (nginx, Caddy, Traefik), and set `FLOOM_AUTH_TOKEN` or `FLOOM_CLOUD_MODE` before exposing port 3051.

## Next

- [Limits](./limits) - runtime, memory, file size, and rate-limit numbers.
- [Protocol](./protocol) - `floom.yaml` shape, `__FLOOM_RESULT__` contract, HTTP surface.
- [Self-host guide](https://github.com/floomhq/floom/blob/main/docs/SELF_HOST.md) - every environment variable, auth mode, upgrades.
- [Rollback runbook](https://github.com/floomhq/floom/blob/main/docs/ROLLBACK.md) - rolling back a bad floom.dev deploy.
