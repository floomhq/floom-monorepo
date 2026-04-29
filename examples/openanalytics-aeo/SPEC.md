---
slug: openanalytics-aeo
display_name: AEO Analytics
category: marketing
viral_hook: "Brand + competitors -> AI answer visibility score and recommendations."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: RESTORE
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"brand":"Floom","competitors":["n8n","Make"]}
golden_outputs:
  - {"required_keys":["brand","score","mentions","competitors","recommendations"],"deterministic":true}
---

# AEO Analytics

Brand + competitors -> AI answer visibility score and recommendations.

```json
{
  "golden_inputs": [
    {
      "brand": "Floom",
      "competitors": [
        "n8n",
        "Make"
      ]
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "brand",
        "score",
        "mentions",
        "competitors",
        "recommendations"
      ],
      "deterministic": true
    }
  ]
}
```
