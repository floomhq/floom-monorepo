# Subject Line Scorer

Rate any email subject line on its open-rate potential. Get a score from 1-10, the top problems,
and 3 stronger rewrites in under 3 seconds.

## Setup

```bash
export GEMINI_API_KEY="your-key-here"
PORT=4350 node examples/email-subject-scorer/server.mjs
```

## Run

```bash
curl http://127.0.0.1:4350/openapi/email-subject-scorer.json
curl -s http://127.0.0.1:4350/email-subject-scorer/run \
  -H 'content-type: application/json' \
  -d '{"subject":"Re: Your proposal from last week"}'
```

## Test

```bash
node --check examples/email-subject-scorer/server.mjs
```

## Output

```json
{
  "score": 3,
  "verdict": "weak",
  "issues": ["Vague reference", "No hook", "Feels like a follow-up"],
  "rewrites": [
    {"angle": "curiosity", "subject": "The one gap I noticed in your proposal"},
    {"angle": "value", "subject": "3 ways to strengthen your proposal"},
    {"angle": "directness", "subject": "Feedback: 2 quick points"}
  ],
  "explanation": "Re: prefix gives the reader no reason to open.",
  "dry_run": false,
  "cache_hit": false,
  "model": "gemini-2.5-flash-lite"
}
```

## Build strategy

BUILD_FRESH - no upstream repo. Pure Gemini 2.5 Flash Lite scoring with `response_json_schema`.

## Gate -1 search trail

- `gh federicodeponte repos` filtered by "email subject": no matches
- `gh floomhq repos` filtered by "email subject": no matches
- `~/floom/examples/email-subject-scorer/`: exists as empty placeholder
- `git log --diff-filter=D`: no deleted files matching "email-subject"
- 106-CSV: no match
- GH PRs: no prior PRs

Result: BUILD_FRESH (empty placeholder + no prior work found)
