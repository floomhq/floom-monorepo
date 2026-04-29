# AI Visibility Check

Paste a public HTTPS URL and get a five-metric AI visibility audit.

This sidecar wraps the Signaldash audit engine from `federicodeponte/signaldash`
`supabase/functions/run-audit/`:

- the crawl extracts title, meta description, Open Graph tags, JSON-LD, links,
  footer text, response headers, and body text from one public HTTPS page
- the Gemini request uses the Signaldash `Signal Viewer` system prompt, crawl
  context, and mandatory JSON response schema
- the response schema is the five-metric Floom app shape:
  `kg_density`, `sentiment_delta`, `nap_consistency`, `eeat_strength`, and
  `entity_disambiguation`

## Run standalone

```bash
export GEMINI_API_KEY="$(python3 -c 'import json;print(json.load(open("/root/.config/ai-sidecar/keys.json")).get("gemini",""))')"
node examples/ai-visibility/server.mjs
```

Health check:

```bash
curl -s http://localhost:4390/health | jq
```

OpenAPI spec:

```bash
curl -s http://localhost:4390/openapi/ai-visibility.json | jq .info.title
```

Run an audit:

```bash
curl -sS -X POST http://localhost:4390/ai-visibility/run \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com"}' | jq
```

## Run via Floom

```bash
node examples/ai-visibility/server.mjs &
FLOOM_APPS_CONFIG=examples/ai-visibility/apps.yaml \
  DATA_DIR=/tmp/floom-ai-visibility \
  node apps/server/dist/index.js
```

The app is exposed as:

- `ai-visibility` -> `http://localhost:4390/openapi/ai-visibility.json`
