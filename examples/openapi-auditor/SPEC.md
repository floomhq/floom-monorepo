---
slug: openapi-auditor
display_name: OpenAPI Spec Auditor
category: developer-tools
viral_hook: "Paste an OpenAPI document and get ingest readiness, blockers, and fixes."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: WRAP
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"spec":"{\"openapi\":\"3.0.0\",\"paths\":{\"/run\":{\"post\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}"}
golden_outputs:
  - {"required_keys":["ready","score","issues","fixes"],"deterministic":true}
---

# OpenAPI Spec Auditor

Paste an OpenAPI document and get ingest readiness, blockers, and fixes.

```json
{
  "golden_inputs": [
    {
      "spec": "{\"openapi\":\"3.0.0\",\"paths\":{\"/run\":{\"post\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}"
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "ready",
        "score",
        "issues",
        "fixes"
      ],
      "deterministic": true
    }
  ]
}
```
