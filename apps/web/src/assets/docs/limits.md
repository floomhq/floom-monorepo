# Limits

The hard numbers before you build on Floom. Everything below is what the code that runs floom.dev enforces today (verified 2026-04-22).

**TL;DR** - Free during beta: 5 runs per AI demo per IP per 24 h on Floom's Gemini key, then paste your own key for unlimited runs. General apps: 150 runs/hour anonymous, 300/hour signed in. Runs cap at 5 minutes sync. Files cap at 6 MB. Self-hosters can override all of it.

## Pricing (TBD post-launch)

Cloud pricing for the paid tier lands after launch week. The hosted beta is free. When paid tiers open:

- **Hobby** - stays free. Unlimited runs with your own API keys (BYOK).
- **Team / Pro** - flat monthly + pooled usage credit + higher platform-side rate limits.
- **Self-host** - always free. No usage limits we impose.

Subscribe to [github.com/floomhq/floom/releases](https://github.com/floomhq/floom/releases) for the announcement. Until then, the numbers below are what you get.

## Runs

Each run of a hosted-mode app executes inside a sandboxed Docker container.

| What | Default | Override |
|---|---|---|
| Max runtime per run | **5 minutes (300 s)** | `RUNNER_TIMEOUT` (ms) |
| Memory per run | **512 MB** | `RUNNER_MEMORY` |
| CPU per run | **1 core** | `RUNNER_CPUS` |
| Build timeout | **10 minutes (600 s)** | `BUILD_TIMEOUT` |
| Output size | Bounded by Docker stdout buffer (a few MB) | - |

Runs that exceed the timeout are killed and marked `timeout`. Runs that run out of memory are killed and marked `oom`. The caller sees a specific error code, not a generic 500.

For work that takes longer than 5 minutes (scraping, batch scoring, long LLM chains), use the async **job queue** - runs persist up to **30 minutes** with webhook delivery on completion, retries, and cancellation. Declare `is_async: true` in your manifest. See [Protocol](./protocol) for the wire shape.

## Rate limits

Three buckets, applied to every run. The tightest bucket wins.

| Scope | Limit | Override |
|---|---|---|
| Per IP (anonymous) | **150 runs / hour** | `FLOOM_RATE_LIMIT_IP_PER_HOUR` |
| Per user (signed in) | **300 runs / hour** | `FLOOM_RATE_LIMIT_USER_PER_HOUR` |
| Per (IP, app) pair | **500 runs / hour** | `FLOOM_RATE_LIMIT_APP_PER_HOUR` |

Every rate-limited response sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `X-RateLimit-Scope`. A 429 also sets `Retry-After`.

Signed-in users get roughly 2x the anon headroom. Authenticating gets you more room for free.

## AI demos: free then BYOK

Three launch apps - **lead-scorer**, **competitor-analyzer**, **resume-screener** - call Gemini and cost real money per run. They are free for **5 runs per visitor IP per 24 hours** on Floom's key. After that, the UI prompts you to paste your own Gemini key, which Floom uses for that call only and does not persist.

Each gated app has its own 5-run budget, so burning through lead-scorer doesn't eat into competitor-analyzer.

Bring your own key:

1. Get a free API key at [ai.google.dev/gemini-api](https://ai.google.dev/gemini-api).
2. Paste it into the run form when the quota modal appears.
3. That run uses your key and returns (Floom doesn't store it, doesn't log it).

The utility launch apps (**jwt-decode**, **json-format**, **password**, **uuid**) do no AI calls and have no 5-run gate - only the general rate limits apply.

## Input and file sizes

| What | Limit |
|---|---|
| Max JSON request body | **5 MB** |
| Max file size per upload | **6 MB** (decoded) |
| Browser-side pre-check | 5 MB (slack margin to avoid edge reject) |
| Accepted file types | Anything the app's `floom.yaml` declares as `type: file/<kind>` (e.g. `file/csv`, `file/pdf`, `file/png`, `file/jpg`, `file/mp3`) |

Files arrive mounted read-only at `/floom/inputs/<name>.<ext>` inside your container. Your script reads them with `open(path)`. See the [`__file` envelope](./protocol#file-uploads-__file-envelope).

## API rate limits (separate from runs)

- **MCP `ingest_app`** (creating a new app from an OpenAPI spec via an agent) - **10 per user per day** (anon: per IP). Override: `FLOOM_RATE_LIMIT_MCP_INGEST_PER_DAY`.
- Admin endpoints on `/api/hub/*` (publishing, editing, deleting apps) - gated by session, not a per-hour count.

## Models

For hosted-mode apps, Floom runs whatever your code calls. Nothing is pinned at the platform level.

The launch-day demos default to **Gemini 3.1 Flash Lite** (free-tier friendly, fast, cheap) and let you override with **Gemini 3.1 Pro** via environment variable if you bring a paid-tier key. OpenAI and Anthropic models work too - pip-install the SDK, point your code at the right key name in `secrets_needed`, and Floom injects the key at runtime.

## Self-host: no imposed limits

Every number on this page is a default in the Docker image, all tunable via environment variables. **Self-hosters have no run quotas, no BYOK gate, no per-user rate limits Floom imposes.** The bottlenecks are your hardware and whatever API keys you ship in.

Set an env var to change a default, or unset `FLOOM_RATE_LIMIT_*` entirely to disable a bucket. See [Deploy](./deploy) and the [self-host guide](https://github.com/floomhq/floom/blob/main/docs/SELF_HOST.md).

## Beta caveats (read this)

Floom is pre-1.0. We run on a single replica on a Hetzner box. This is not enterprise infra yet.

- **No SLA.** We work hard to stay up but make no uptime promise.
- **No 99.9% guarantee.** Expect occasional short windows of downtime during deploys.
- **Single replica.** We haven't scaled horizontally yet. Every request hits one process. Fine for launch-day traffic; not fine at scale, and we'll cross that bridge publicly.
- **SQLite storage.** Fast and reliable for our current load. Postgres swap is on the roadmap.
- **Streaming output** - tokens don't stream to the UI yet. The full output lands when the run finishes. Server-side event streaming (logs + status) already works on the HTTP API.

If you need enterprise reliability today, **self-host**. The runtime is the same code and you get to put it behind your own load balancer.

## Next

- [Deploy](./deploy) - run Floom yourself if these limits don't fit.
- [Protocol](./protocol) - `floom.yaml` shape, `__FLOOM_RESULT__` contract, HTTP surface.
- [Getting started](./getting-started) - run and publish your first app.
