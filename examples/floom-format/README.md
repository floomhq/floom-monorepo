# Floom Format

Paste messy text, HTML, or JSON and get clean Markdown plus structured metadata.

## Run

```bash
PORT=15404 node examples/floom-format/server.mjs
curl -X POST http://127.0.0.1:15404/floom-format/run -H 'content-type: application/json' -d '{"content":"<h1>Launch Notes</h1><p>Ship the app factory today.</p>"}'
```
