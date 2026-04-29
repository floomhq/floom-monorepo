---
slug: support-ticket-summarizer
display_name: Support Ticket Summarizer
category: business
viral_hook: "Paste a support ticket and get root cause, urgency, owner, and reply draft."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: BUILD_FRESH
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"ticket":"Customer cannot export CSV after uploading a 20MB file. Error appears after 30 seconds."}
golden_outputs:
  - {"required_keys":["summary","root_cause","urgency","reply"],"deterministic":true}
---

# Support Ticket Summarizer

Paste a support ticket and get root cause, urgency, owner, and reply draft.

```json
{
  "golden_inputs": [
    {
      "ticket": "Customer cannot export CSV after uploading a 20MB file. Error appears after 30 seconds."
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "summary",
        "root_cause",
        "urgency",
        "reply"
      ],
      "deterministic": true
    }
  ]
}
```
