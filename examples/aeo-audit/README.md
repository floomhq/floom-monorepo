# AEO Audit

Check how visible your brand is in AI-generated answers (ChatGPT, Claude, Perplexity, Gemini)
vs your competitors.

Wraps [federicodeponte/openanalytics](https://github.com/federicodeponte/openanalytics) — see
that repo for the full analysis pipeline setup.

## Run (standalone, without upstream)

```bash
node examples/aeo-audit/server.mjs
```

When the openanalytics upstream container is not running, the server returns a dry-run response
so the API still responds. Set `UPSTREAM_URL` to point at a running openanalytics instance for
real results.

## Run (with upstream)

```bash
# Start openanalytics container (see federicodeponte/openanalytics README)
export UPSTREAM_URL=http://127.0.0.1:8080
node examples/aeo-audit/server.mjs
```

## Test

```bash
curl -X POST http://127.0.0.1:4320/aeo-audit/run \
  -H "Content-Type: application/json" \
  -d '{"brand": "floom.dev", "competitors": ["n8n.io"]}'
```

## Output

```json
{
  "brand": "floom.dev",
  "score": 42,
  "mentions": 3,
  "competitors": [{"brand": "n8n.io", "score": 71, "mentions": 12}],
  "verdict": "low",
  "top_queries": ["What is floom.dev?", "Floom alternatives"],
  "recommendations": [
    "Create authoritative content around your top 3 use cases",
    "Build topical authority with FAQ pages",
    "Get mentioned on G2, Capterra, ProductHunt"
  ],
  "dry_run": true,
  "upstream_available": false
}
```

## Build strategy

WRAP (federicodeponte/openanalytics) — http-container sub-pattern.
Node.js proxy + Python upstream in Docker container.

## Gate -1 search trail

- `gh federicodeponte repos` filtered by "analytics aeo": match `openanalytics` (AEO platform)
- `gh floomhq repos` filtered by "aeo audit": no matches
- `~/floom/examples/aeo-audit/`: exists as empty placeholder
- `git log --diff-filter=D`: no deleted files matching "aeo-audit"
- 106-CSV: no direct match (openanalytics is federicodeponte's own repo, not in CSV)
- GH PRs: no prior PRs

Result: WRAP (federicodeponte/openanalytics is the canonical upstream engine)
