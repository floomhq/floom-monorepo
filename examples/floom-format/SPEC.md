---
slug: floom-format
display_name: Floom Format
category: developer-tools
viral_hook: "Paste messy text, HTML, or JSON and get clean Markdown plus structured metadata."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: RESTORE
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"content":"<h1>Launch Notes</h1><p>Ship the app factory today.</p>"}
golden_outputs:
  - {"required_keys":["markdown","metadata","detected_format"],"deterministic":true}
---

# Floom Format

Paste messy text, HTML, or JSON and get clean Markdown plus structured metadata.

```json
{
  "golden_inputs": [
    {
      "content": "<h1>Launch Notes</h1><p>Ship the app factory today.</p>"
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "markdown",
        "metadata",
        "detected_format"
      ],
      "deterministic": true
    }
  ]
}
```
