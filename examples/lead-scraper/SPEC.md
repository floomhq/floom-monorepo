---
slug: lead-scraper
display_name: Lead Scraper
category: sales
viral_hook: "Country + business type -> public lead table with emails as CSV-ready JSON."
latency_target_ms: 5000
runtime_kind: deterministic
handles_money: false
build_strategy: WRAP
upstream_engine_kind: node-deterministic
golden_inputs:
  - {"country":"Germany","business_type":"dentists","limit":5}
golden_outputs:
  - {"required_keys":["leads","count","query","export_filename"],"deterministic":true}
---

# Lead Scraper

Country + business type -> public lead table with emails as CSV-ready JSON.

```json
{
  "golden_inputs": [
    {
      "country": "Germany",
      "business_type": "dentists",
      "limit": 5
    }
  ],
  "golden_outputs": [
    {
      "required_keys": [
        "leads",
        "count",
        "query",
        "export_filename"
      ],
      "deterministic": true
    }
  ]
}
```
