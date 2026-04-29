# Code Reviewer

Paste a diff and get PR-style findings with severity tags.

## Run

```bash
PORT=15405 node examples/code-reviewer/server.mjs
curl -X POST http://127.0.0.1:15405/code-reviewer/run -H 'content-type: application/json' -d '{"diff":"diff --git a/app.js b/app.js\n+console.log(process.env.SECRET)"}'
```
