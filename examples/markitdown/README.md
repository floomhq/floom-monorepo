# MarkItDown

Convert HTML, text, or document content to clean Markdown. No API key needed, no container required.

Built by rewriting the core logic of [microsoft/markitdown](https://github.com/microsoft/markitdown)
in Node.js for sub-second performance.

## Run

```bash
node examples/markitdown/server.mjs
```

## Test

```bash
# HTML to Markdown
curl -X POST http://127.0.0.1:4310/markitdown/run \
  -H "Content-Type: application/json" \
  -d '{"content": "<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>"}'

# URL fetch + convert
curl -X POST http://127.0.0.1:4310/markitdown/run \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Output

```json
{
  "markdown": "# Hello\n\nThis is **bold** text.",
  "title": "Hello",
  "word_count": 5,
  "format_detected": "html"
}
```

## Build strategy

WRAP (microsoft/markitdown, ~450 LOC Python) — rewrite-in-Node sub-pattern.
Core algorithm: HTML tag → Markdown syntax conversion via regex.
No Python subprocess, no Docker, no external dependencies.

## Gate -1 search trail

- `gh federicodeponte repos` filtered by "markitdown": no matches
- `gh floomhq repos` filtered by "markitdown": no matches
- `~/floom/examples/markitdown/`: exists as empty placeholder
- `git log --diff-filter=D`: no deleted files matching "markitdown"
- 106-CSV rank 2: `microsoft/markitdown` (verified match)
- GH PRs: no prior PRs

Result: WRAP (found microsoft/markitdown in 106-CSV as rank 2, verified upstream)
