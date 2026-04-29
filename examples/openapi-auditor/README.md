# OpenAPI Spec Auditor

Paste an OpenAPI document and get ingest readiness, blockers, and fixes.

## Run

```bash
PORT=15402 node examples/openapi-auditor/server.mjs
curl -X POST http://127.0.0.1:15402/openapi-auditor/run -H 'content-type: application/json' -d '{"spec":"{\"openapi\":\"3.0.0\",\"paths\":{\"/run\":{\"post\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}"}'
```
