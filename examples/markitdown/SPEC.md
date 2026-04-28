---
slug: markitdown
display_name: MarkItDown
category: developer-tools
viral_hook: "Paste any Office doc, HTML, or PDF text — get clean Markdown ready for AI pipelines in under 5 seconds"
audience: Developers, agent builders, anyone piping documents into AI workflows
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
upstream_repo: microsoft/markitdown
upstream_loc: 450
build_strategy: WRAP
upstream_engine_kind: node-rewrite
input_schema:
  content:
    type: string
    description: Text or HTML content to convert to Markdown (max 100000 chars)
    max_length: 100000
    required: false
  url:
    type: string
    description: URL to fetch and convert (alternative to content)
    max_length: 2048
    required: false
  format:
    type: string
    description: Input format hint (html / text / markdown / auto)
    default: auto
    required: false
output_schema:
  markdown:
    type: string
    description: Clean Markdown output
  title:
    type: string
    description: Extracted document title (or empty string)
  word_count:
    type: integer
    description: Word count of the output Markdown
  format_detected:
    type: string
    description: What format was detected in the input
test_inputs:
  - { content: "# Hello\n\nThis is **bold** text.", format: "markdown" }
  - { content: "<html><body><h1>Test</h1><p>Hello world</p></body></html>", format: "html" }
  - { content: "Just plain text here with no markup." }
golden_inputs:
  - { content: "# Hello\n\nThis is **bold** text.", format: "markdown" }
  - { content: "<html><body><h1>Test</h1><p>Hello <strong>world</strong></p></body></html>", format: "html" }
  - { content: "Just plain text here with no markup." }
golden_outputs:
  - { required_keys: [markdown, title, word_count, format_detected], markdown_contains: Hello }
  - { required_keys: [markdown, title, word_count, format_detected], markdown_contains: Test }
  - { required_keys: [markdown, title, word_count, format_detected] }
---

# MarkItDown

Convert any text, HTML, or document content to clean Markdown — no browser needed, no API key required.
Built on the logic of Microsoft's `markitdown` library, rewritten for sub-second Node.js performance.

## Why it works

AI pipelines need clean text, not raw HTML soup. MarkItDown strips the junk (nav, ads, scripts, inline styles)
and returns structured Markdown that LLMs and embeddings handle much better.

## Input (provide one of)

- `content`: Raw text or HTML string
- `url`: URL to fetch (adds HTTP fetch step, increases latency)
- `format`: `html` | `text` | `markdown` | `auto` (default)

## Output

- `markdown`: Clean Markdown text
- `title`: Extracted page/document title
- `word_count`: Words in output
- `format_detected`: What was detected (html / markdown / plain)

## Build strategy

WRAP (microsoft/markitdown) — Python source is ~450 LOC. Core algorithm is HTML-to-Markdown
conversion using standard regex patterns + heading/link extraction. Rewrote in Node.js
(rewrite-in-Node sub-pattern) to avoid subprocess overhead and stay under 5s.
