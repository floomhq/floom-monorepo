# TOS Red Flag Scanner

Paste any Terms of Service and get the 5 scariest clauses explained in plain English.

## Setup

```bash
export GEMINI_API_KEY="your-key-here"
PORT=4360 node examples/tos-red-flag/server.mjs
```

## Run

```bash
curl http://127.0.0.1:4360/openapi/tos-red-flag.json
curl -s http://127.0.0.1:4360/tos-red-flag/run \
  -H 'content-type: application/json' \
  -d '{"text":"We may share your personal data with third parties for marketing purposes.","source":"ExampleApp"}'
```

## Output

```json
{
  "red_flags": [
    {
      "clause": "We may share your personal data with third parties for marketing purposes.",
      "risk_type": "data-sharing",
      "plain_english": "They can sell or share your personal information with advertisers and partners without asking you each time.",
      "severity": "high"
    }
  ],
  "risk_level": "high",
  "plain_english_summary": "This TOS allows broad data sharing without explicit consent. Your information may be used for advertising by third parties you have no relationship with.",
  "red_flag_count": 1,
  "dry_run": false,
  "cache_hit": false,
  "model": "gemini-2.5-flash-lite"
}
```

## Build strategy

BUILD_FRESH - no upstream repo. Pure Gemini 2.5 Flash Lite analysis with `response_json_schema`.

## Gate -1 search trail

- `gh federicodeponte repos` filtered by "tos red-flag": no matches
- `gh floomhq repos` filtered by "tos": no matches
- `~/floom/examples/tos-red-flag/`: exists as empty placeholder
- `git log --diff-filter=D`: no deleted files matching "tos"
- 106-CSV: no match
- GH PRs: no prior PRs

Result: BUILD_FRESH (empty placeholder + no prior work found)
