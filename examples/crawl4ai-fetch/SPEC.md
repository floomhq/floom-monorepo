---
slug: crawl4ai-fetch
display_name: Crawl4AI Fetch
category: developer-tools
viral_hook: "Paste any URL — get the full page content as clean Markdown, ready for AI pipelines"
audience: Developers, AI engineers, agent builders who need clean web content at scale
latency_target_ms: 10000
runtime_kind: oss-wrap
handles_money: false
upstream_repo: unclecode/crawl4ai
upstream_loc: 12000
build_strategy: WRAP
upstream_engine_kind: http-container-persistent
input_schema:
  url:
    type: string
    description: URL to fetch and convert to Markdown (must start with http:// or https://)
    max_length: 2048
    required: true
  wait_for:
    type: string
    description: Optional CSS selector to wait for before extracting content
    max_length: 200
    required: false
  include_links:
    type: boolean
    description: Whether to include hyperlinks in the output (default true)
    required: false
output_schema:
  markdown:
    type: string
    description: Clean Markdown content from the page
  title:
    type: string
    description: Page title
  url:
    type: string
    description: Final URL after redirects
  links:
    type: array
    items: string
    description: Links found on the page (if include_links is true)
  word_count:
    type: integer
    description: Word count of the Markdown output
test_inputs:
  - { url: "https://example.com" }
  - { url: "https://news.ycombinator.com" }
golden_inputs:
  - { url: "https://example.com" }
  - { url: "https://news.ycombinator.com" }
  - { url: "https://github.com/unclecode/crawl4ai" }
golden_outputs:
  - { required_keys: [markdown, title, url, word_count], markdown_min_length: 10 }
  - { required_keys: [markdown, title, url, word_count], markdown_min_length: 50 }
  - { required_keys: [markdown, title, url, word_count], markdown_min_length: 50 }
blocked: job_queue_pending
notes: |
  Crawl4AI uses a persistent Chromium browser pool for JS-heavy sites.
  Container cold start is 10-20s. Warm requests are 2-5s.
  Gate 6 (latency) runs AFTER warmup. Full async mode with job queue in Phase 2.
  Current implementation: synchronous with 15s timeout.
---

# Crawl4AI Fetch

Fetch any URL and get clean Markdown content, ready for AI pipelines.
Handles JavaScript-heavy pages that simple HTTP clients can't read.

Built on top of [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) — the #1 ranked
tool in our ICE matrix.

## Why it works

Simple `curl` or `requests` calls miss most modern web pages. They use JavaScript to render content.
Crawl4AI uses a headless browser pool, extracts the content, and converts it to clean Markdown
that LLMs can process without HTML noise.

## Input

- `url` (required): URL to fetch
- `wait_for` (optional): CSS selector to wait for before extracting
- `include_links` (optional): Whether to include links (default true)

## Output

- `markdown`: Clean page content as Markdown
- `title`: Page title
- `url`: Final URL after redirects
- `links`: Extracted links
- `word_count`: Words in output

## Build strategy

WRAP (unclecode/crawl4ai, ~12,000 LOC Python) — http-container-persistent sub-pattern.
Container maintains a warm Chromium browser pool; Node.js proxy handles Floom contract.
Requires Docker + the crawl4ai container running at UPSTREAM_URL.
Falls back to simple fetch (no JS rendering) if upstream unavailable.
