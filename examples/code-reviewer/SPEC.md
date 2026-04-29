---
slug: code-reviewer
display_name: Code Reviewer
category: developer-tools
viral_hook: "Paste a diff and get PR-style findings with severity tags."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: RESTORE
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"diff":"diff --git a/app.js b/app.js\n+console.log(process.env.SECRET)"}
golden_outputs:
  - {"required_keys":["findings","summary","risk_score"],"deterministic":true}
---

# Code Reviewer

Paste a diff and get PR-style findings with severity tags.

```json
{
  "golden_inputs": [
    {
      "diff": "diff --git a/app.js b/app.js\n+console.log(process.env.SECRET)"
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "findings",
        "summary",
        "risk_score"
      ],
      "deterministic": true
    }
  ]
}
```
