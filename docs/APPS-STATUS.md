# Bundled apps status · v0.3.0

Authoritative audit of the 15 apps in the Floom self-host story, updated for
v0.3.0 (W2.4a-c · 2026-04-15). Of the 15 apps:

- **5** are now **proxied** (converted in W2.4a: pure Node.js HTTP sidecars)
- **9** remain **hosted-mode** (docker-hosted, require `/var/run/docker.sock`)
- **1** is **blocked** (flyfast: internal infra dependency)

The 15-app hub is opt-in via `FLOOM_SEED_APPS=true` (see `docs/SELF_HOST.md`).
The default self-host story is an empty hub populated via `apps.yaml` plus the
5 converted proxied examples in `examples/apps-proxied.yaml`.

## Summary

| Metric | v0.2.0 | v0.3.0 |
|--------|--------|--------|
| Apps in hub | 15 | 15 |
| Proxied (HTTP) | 0 | 5 |
| Hosted (docker-runner) | 15 | 9 |
| Blocked (internal infra) | 0 | 1 |
| Work without secrets | 4 | 4 |
| Need at least one secret | 11 | 11 |
| Work on self-host without `docker.sock` | 0 | 5 |
| Work via MCP `_auth` per-user extension | 11 | 11 |

## Per-app status

| Slug | State | Secrets | Port | OpenAPI | Example dir | Notes |
|------|-------|---------|------|---------|-------------|-------|
| blast-radius | **proxied (v0.3)** | none | 4113 | `examples/blast-radius/server.mjs` | `examples/blast-radius/` | Shells out to `git` via child_process; no API keys |
| claude-wrapped | **proxied (v0.3)** | none | 4111 | `examples/claude-wrapped/server.mjs` | `examples/claude-wrapped/` | Pure parser over pasted JSONL |
| dep-check | **proxied (v0.3)** | none | 4114 | `examples/dep-check/server.mjs` | `examples/dep-check/` | Shells out to `git`; no API keys |
| hook-stats | **proxied (v0.3)** | none | 4110 | `examples/hook-stats/server.mjs` | `examples/hook-stats/` | Pure parser over bash-commands.log |
| session-recall | **proxied (v0.3)** | none | 4112 | `examples/session-recall/server.mjs` | `examples/session-recall/` | 3 ops: search, recent, report |
| bouncer | hosted-mode | GEMINI_API_KEY | — | — | `examples/bouncer/floom.yaml` | Needs Gemini API; v0.4 candidate (thin wrapper) |
| openanalytics | hosted-mode | GEMINI_API_KEY | — | — | `examples/openanalytics/floom.yaml` | FastAPI source already HTTP-shaped; v0.4 candidate (Python sidecar) |
| openblog | hosted-mode | GEMINI_API_KEY | — | — | `examples/openblog/floom.yaml` | Heavy Python deps (markdownify, openpyxl); v0.5 |
| opencontext | hosted-mode | GEMINI_API_KEY | — | — | `examples/opencontext/floom.yaml` | Gemini + Search grounding; v0.4 candidate |
| opendraft | hosted-mode | GOOGLE_API_KEY | — | — | `examples/opendraft/floom.yaml` | v0.4 candidate (thin Gemini wrapper) |
| opengtm | hosted-mode | none | — | — | `examples/opengtm/floom.yaml` | v0.4 candidate (no secrets, would be simple) |
| openkeyword | hosted-mode | GEMINI_API_KEY | — | — | `examples/openkeyword/floom.yaml` | 5-stage pipeline, non-trivial; v0.5 |
| openpaper | hosted-mode | OPENPAPER_API_TOKEN | — | — | `examples/openpaper/floom.yaml` | Already calls `api.openpaper.dev`; v0.4 — just needs a public OpenAPI spec at that URL |
| openslides | hosted-mode | GEMINI_API_KEY | — | — | `examples/openslides/floom.yaml` | Ships PDFs via `PyPDF2`, `python-pptx`, `colorthief`; v0.5 (heavy deps) |
| **flyfast** | **BLOCKED** | FLYFAST_INTERNAL_TOKEN | — | — | `examples/flyfast/floom.yaml` | Internal flight-search API; requires Federico's infra. Store card shows a "hosted-mode only" warning pill |

## W2.4a: what was converted

Five **no-secret pure-compute** apps were converted to proxied-HTTP mode in
branch `wave/W2.4-apps-migration`. Each one is:

1. A standalone Node.js HTTP server (`server.mjs`) with zero external npm
   dependencies.
2. An OpenAPI 3.0 spec served at `GET /openapi.json` that the server itself
   generates at module-load time.
3. One `POST /<operation>` route per original manifest action.
4. A `GET /health` liveness probe.
5. A minimal `Dockerfile` based on `node:20-slim`. `blast-radius` and
   `dep-check` additionally `apt-get install -y git`.

The 5 sidecars can be booted together via
`examples/docker-compose.proxied.yml`. Floom then ingests them through the
same proxied-runner path as any third-party OpenAPI (Petstore, Resend,
Stripe), verified end-to-end in W2.4a smoke tests.

### Rationale for the pick

The `WORKPLAN-3DAY.md` W2.4a row named 5 different slugs (`openblog`,
`openanalytics`, `bouncer`, `ingredient-swap`, `openapi-to-floom`). Two of
those (`ingredient-swap`, `openapi-to-floom`) don't exist in the monorepo
as of this commit, and the other three all depend on external API keys
(GEMINI_API_KEY, GOOGLE_API_KEY). Per the task prompt, APPS-STATUS.md is
authoritative over the plan when they disagree.

Converting the 5 **zero-secret** apps was picked because:

- **Cleaner boundary.** No per-user secret forwarding needed to prove the
  concept. The proxied runner already supports `_auth` per-call secrets, but
  debugging secret forwarding in parallel with the OpenAPI ingest would muddy
  the test gate.
- **Safer for self-hosters.** Apps without API keys can be run on any machine
  with no prior setup. Gemini-backed apps fail silently for anyone without a
  key and then blame Floom for the error.
- **Faster smoke-testability.** Pure-compute actions return in <20ms, letting
  the full 5-app E2E run cleanly in <5 seconds of wall-clock time.
- **Proven OpenAPI coverage.** Every converted app has `requestBody` with
  typed properties and `responses.200.content.application/json.schema`, which
  exercises the v0.2.0 ingest fixes end-to-end (auto base_url, typed schema,
  path-prefix preservation).

## W2.4b: what was NOT converted (and why)

### Ready for v0.4 (low effort)

These 5 apps are hosted-mode but the conversion path is straightforward
(thin Node wrapper around existing Python code OR a public HTTPS endpoint
already exists):

- **openpaper** — already talks to `api.openpaper.dev`. Needs a published
  OpenAPI spec at that URL and an apps.yaml entry. No Floom-side work; 30
  minutes of author time to expose the OpenAPI.
- **opendraft** — Gemini client thin wrapper. Port effort: ~1h Node server
  with `@google/generative-ai` SDK.
- **opencontext** — Gemini + httpx scrape. Port effort: ~2h (parsing logic
  is non-trivial but stateless).
- **opengtm** — no secrets, depends on `httpx`, `bs4`, `lxml`. Port effort:
  ~2h (rewriting the AEO 29-check pipeline in Node with cheerio).
- **bouncer** — single Gemini call with a scoring prompt. Port effort: ~1h.

### v0.5 (heavy deps, non-trivial port)

- **openblog** — `markdownify`, `openpyxl`, `defusedxml`, `google-genai`,
  article-quality pipeline. Port effort: ~4-6h, or ship as a Python sidecar
  (the proxied runner doesn't care about the upstream language).
- **openanalytics** — FastAPI app already exists. Could ship as a Python
  sidecar in `examples/openanalytics/` without any rewrite, just a
  Dockerfile. Port effort: ~2h.
- **openkeyword** — 5-stage Gemini pipeline. Port effort: ~4h or sidecar.
- **openslides** — `PyPDF2`, `python-pptx`, `colorthief`, PDF rendering.
  Port effort: ~4-6h or Python sidecar.

### Defer / blocked

- **flyfast** — BLOCKED. Requires Federico's internal flight-search API
  (FLYFAST_INTERNAL_TOKEN) that only federicodeponte.com can access. The
  self-host store card surfaces a `blocked_reason` pill (W2.4c) so users
  see "hosted-mode only" before clicking. Un-block path: (a) publish a
  thin public HTTPS facade, or (b) ship the flight-search core as an
  open-source package and have users BYOK.

### Pattern for v0.4 conversions (for the next agent)

Each future conversion follows the template proven in W2.4a:

1. Copy `examples/hook-stats/` to `examples/<slug>/`.
2. Rewrite `server.mjs` with the app's logic (or swap `node:20-slim` for
   `python:3.12-slim` + a thin `uvicorn` FastAPI wrapper if keeping Python).
3. Write an `openapi.json` at the `/openapi.json` route that matches the
   operationIds in the original `floom.yaml` manifest.
4. Update `examples/apps-proxied.yaml` with a new port allocation (current
   used: 4110-4114; allocate 4115+ for new converts).
5. Test locally: `node examples/<slug>/server.mjs &` + `curl` to verify the
   spec and one operation.
6. Test via Floom: `FLOOM_APPS_CONFIG=examples/<slug>/apps.yaml` and
   `curl /api/<slug>/run`.
7. Add a row to the per-app table above and flip the state from
   "hosted-mode" to "proxied".

## W2.4c: flyfast store-card banner

`apps/web/src/pages/BrowsePage.tsx` renders a muted warning pill beneath the
description on any card whose `/api/hub` response carries a `blocked_reason`.
The pill text is `hosted-mode only · <reason>` with a `title=` tooltip
for the full text when it's too long to fit in the card.

The banner copy for flyfast is stored in the seed manifest
(`apps/server/src/db/seed.json`, `flyfast.manifest.blocked_reason`):

> hosted-mode only: requires Federico's internal flight-search API.
> Self-hosters cannot run flyfast directly. See docs/APPS-STATUS.md for
> the v0.4 conversion roadmap.

The banner is data-driven so future blocked apps just need to add
`blocked_reason: "..."` to their `apps.yaml` entry (or seed manifest blob)
and the pill shows up with zero further UI work. End-to-end plumbing:

```
apps.yaml.blocked_reason
  → openapi-ingest.ts (OpenApiAppSpec)
  → NormalizedManifest.blocked_reason
  → sqlite apps.manifest column (inside the existing JSON blob, no schema change)
  → GET /api/hub response (hub.ts)
  → web HubApp type
  → BrowsePage.tsx app-tile-blocked pill
```

**db.ts is not touched** per W2.1 ownership. The annotation lives inside
the existing `apps.manifest` JSON column.

## What changed in v0.3.0 for these apps

1. **5 apps freed from docker.sock** (W2.4a). Self-hosters running
   `docker compose -f examples/docker-compose.proxied.yml up` get a hub of
   5 apps without ever mounting the host Docker socket, on amd64 or arm64.

2. **Manifest-level `blocked_reason`** (W2.4c). Creators can annotate an
   app as blocked without removing it from the hub. Useful for gradual
   migration, transparency, and bundled-app housekeeping.

3. **`examples/apps-proxied.yaml`** as the canonical "5 proxied apps"
   config. Referenced from `docs/SELF_HOST.md` in v0.3 docs.

4. **Docker-compose template**: `examples/docker-compose.proxied.yml`
   spins up the 5 sidecars + Floom in 6 services with correct service-name
   DNS resolution via `examples/apps-proxied.compose.yaml`. This is the
   zero-secret, zero-docker-socket self-host path for v0.3.

## Test coverage

### Stress (regression floor)

`node test/stress/test-ingest-stress.mjs --cache`: 4/4 passing (Stripe,
GitHub, Petstore, Resend).

### Unit

`pnpm --filter @floom/server test`: 77 passing, 0 failed. Breakdown:

- `test-build-url.mjs`: 11
- `test-resolve-base-url.mjs`: 13
- `test-webhook.mjs`: 7
- `test-jobs-service.mjs`: 27
- `test-jobs-e2e.mjs`: 19

### End-to-end (W2.4a smoke)

All 5 converted apps booted as sidecars + ingested by Floom via
`examples/apps-proxied.yaml`. Every `POST /api/<slug>/run` returned
`status=success` in a single Floom process:

| Slug | Action | Duration |
|------|--------|----------|
| hook-stats | analyze | 14ms |
| session-recall | search | 5ms |
| claude-wrapped | generate | 3ms |
| blast-radius | analyze | 650ms (includes live `git clone --depth 50`) |
| dep-check | analyze | 847ms (includes live `git clone --depth 1`) |

MCP `tools/list` verified on session-recall: all 3 operations surface with
typed JSON schemas (`jsonl_session`, `keywords`, `max_results`, `count`)
and correct `required` arrays.

`/api/hub` returns 15 apps with the expected `actions` array per app and
`blocked_reason` populated on flyfast only.

## Still open

- **9 hosted-mode apps** need author-side work (OpenAPI spec + public
  endpoint, or Python sidecar Dockerfile). v0.4 or v0.5 depending on
  complexity. See the W2.4b roadmap above.
- **No integration test runs a docker-hosted bundled app end-to-end.**
  The 5 converted proxied apps are fully tested via the stress + e2e path.
  The 9 hosted-mode apps still rely on manual preview.floom.dev smoke tests.
- **No `/api/hub` schema expansion** for HTTP-first clients (audit #7,
  deferred to v0.4). MCP clients still have to call `tools/list` to
  discover inputs; HTTP clients have to scrape the manifest.
- **flyfast un-block path** is tracked here but not yet spec'd. v0.4
  decision point for Federico.
