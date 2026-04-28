# Crawl4AI Fetch

Fetch any URL and get clean Markdown content for AI pipelines.
Handles JavaScript-heavy pages (React, Next.js, Angular) that simple `curl` can't read.

Built on top of [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) — rank #1 in the
Floom ICE matrix with an ice_score of 6.4.

## Run (standalone, without upstream)

```bash
node examples/crawl4ai-fetch/server.mjs
```

Without the crawl4ai container, falls back to simple Node.js fetch (no JS rendering).
JS-heavy pages will return partial content in fallback mode.

## Run (with crawl4ai upstream)

```bash
# Start crawl4ai container (see unclecode/crawl4ai README)
docker run -d -p 11235:11235 unclecode/crawl4ai:latest
export UPSTREAM_URL=http://127.0.0.1:11235

node examples/crawl4ai-fetch/server.mjs
```

## Test

```bash
curl -X POST http://127.0.0.1:4330/crawl4ai-fetch/run \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Output

```json
{
  "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
  "title": "Example Domain",
  "url": "https://example.com",
  "links": ["https://www.iana.org/domains/example"],
  "word_count": 28,
  "method": "simple-fetch-fallback"
}
```

When crawl4ai is running:
```json
{
  "markdown": "# Full rendered page content here...",
  "title": "...",
  "url": "https://example.com",
  "links": ["..."],
  "word_count": 250,
  "method": "crawl4ai"
}
```

## Build strategy

WRAP (unclecode/crawl4ai, ~12,000 LOC Python) — http-container-persistent sub-pattern.
Container maintains a warm Chromium browser pool; Node.js proxy handles the Floom contract.
Graceful fallback to simple fetch when container is unavailable.

## Gate -1 search trail

- `gh federicodeponte repos` filtered by "crawl": no matches
- `gh floomhq repos` filtered by "crawl4ai": no matches
- `~/floom/examples/crawl4ai-fetch/`: exists as empty placeholder
- `git log --diff-filter=D`: no deleted files matching "crawl4ai"
- 106-CSV rank 1: `unclecode/crawl4ai` (best obvious wedge, verified)
- GH PRs: no prior PRs

Result: WRAP (found unclecode/crawl4ai as rank 1 in 106-CSV)
