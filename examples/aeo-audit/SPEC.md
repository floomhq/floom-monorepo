---
slug: aeo-audit
display_name: AEO Audit
category: marketing
viral_hook: "Enter your brand + 2 competitors — see how visible you are in AI answers vs them, scored and screenshot-ready"
audience: SEO professionals, marketers, founders, Scaile customers
latency_target_ms: 8000
runtime_kind: oss-wrap
handles_money: false
upstream_repo: federicodeponte/openanalytics
upstream_loc: 2500
build_strategy: WRAP
upstream_engine_kind: http-container
input_schema:
  brand:
    type: string
    description: Your brand name or domain (e.g. "floom.dev" or "Floom")
    max_length: 100
    required: true
  competitors:
    type: array
    items: string
    description: Up to 3 competitor brands or domains to compare against
    max_items: 3
    required: false
  query_topics:
    type: array
    items: string
    description: Optional topic areas to test (e.g. ["AI app deployment", "no-code platforms"])
    max_items: 5
    required: false
output_schema:
  brand:
    type: string
    description: The brand that was analyzed
  score:
    type: integer
    description: AEO visibility score from 0 to 100
  mentions:
    type: integer
    description: Number of times the brand was mentioned in AI answers
  competitors:
    type: array
    description: Per-competitor scores and mention counts
  verdict:
    type: string
    description: "Overall verdict: invisible | low | medium | high"
  top_queries:
    type: array
    description: Queries where the brand appeared
  recommendations:
    type: array
    description: Top 3 actionable recommendations to improve AEO
test_inputs:
  - { brand: "floom.dev", competitors: ["n8n.io"] }
  - { brand: "anthropic.com", competitors: ["openai.com"] }
golden_inputs:
  - { brand: "floom.dev", competitors: ["n8n.io", "make.com"] }
  - { brand: "anthropic.com", competitors: ["openai.com"] }
  - { brand: "vercel.com", competitors: ["netlify.com"] }
golden_outputs:
  - { brand_score_range: [0, 100], required_keys: [brand, score, mentions, competitors, verdict, recommendations] }
  - { brand_score_range: [0, 100], required_keys: [brand, score, mentions, competitors, verdict, recommendations] }
  - { brand_score_range: [0, 100], required_keys: [brand, score, mentions, competitors, verdict, recommendations] }
---

# AEO Audit

Answer Engine Optimization audit — see how visible your brand is in AI-generated answers (ChatGPT, Claude,
Perplexity, Gemini) vs your competitors. Get a score, mention count, and top 3 recommendations.

Built on top of [federicodeponte/openanalytics](https://github.com/federicodeponte/openanalytics).

## Why it works

SEO is table-stakes. AEO is the next moat. Brands that appear in AI answers get referral traffic
without paying for clicks. This audit shows where you stand today and what to fix.

## Input

- `brand` (required): Your brand name or domain
- `competitors` (optional): Up to 3 competitors to compare against
- `query_topics` (optional): Specific topic areas to test

## Output

- `score` (0-100): AEO visibility score
- `mentions`: Times the brand appeared in AI answers
- `competitors`: Per-competitor breakdown
- `verdict`: invisible / low / medium / high
- `top_queries`: Which queries you appeared in
- `recommendations`: Top 3 fixes

## Build strategy

WRAP (federicodeponte/openanalytics) — Python app with Docker + Node.js proxy.
Upstream container handles the actual AI query analysis; this server.mjs wraps it
for Floom's HTTP contract.

Note: Requires `openanalytics` Docker container running at UPSTREAM_URL.
For Phase 1, returns a dry-run response if the upstream is not available.
