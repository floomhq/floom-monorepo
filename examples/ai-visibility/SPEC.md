# AI Visibility Check Spec

Slug: `ai-visibility`

Display name: `AI Visibility Check`

Category: `marketing`

Hook: `Type your URL. See how AI models see your brand.`

Port: `4390`

## Input

- `url`: required HTTPS URL. Credentials, non-HTTPS schemes, non-default ports,
  private network targets, and unsafe redirects are rejected.

## Output

- `kg_density`: `{ "score": 0-100, "evidence": "string", "recommendation": "string" }`
- `sentiment_delta`: `{ "score": 0-100, "evidence": "string", "recommendation": "string" }`
- `nap_consistency`: `{ "score": 0-100, "evidence": "string", "recommendation": "string" }`
- `eeat_strength`: `{ "score": 0-100, "evidence": "string", "recommendation": "string" }`
- `entity_disambiguation`: `{ "score": 0-100, "evidence": "string", "recommendation": "string" }`
- `overall_score`: integer 0-100
- `summary`: string
- `screenshot_card_summary`: string

The Gemini call uses the Signaldash `Signal Viewer` prompt and crawl context
from `supabase/functions/_shared/audit-engine.ts`. The mandatory structured
JSON schema is the five-metric Floom output shape above.

## Golden Inputs

```json
{
  "golden_inputs": [
    {
      "url": "https://stripe.com"
    }
  ]
}
```

## Acceptance

- `GET /health` returns HTTP 200.
- `GET /openapi/ai-visibility.json` returns an OpenAPI document with
  `/ai-visibility/run`.
- `POST /ai-visibility/run` returns HTTP 200 and valid JSON for the golden
  input when `GEMINI_API_KEY` is configured.
- Invalid URLs return 4xx JSON errors.
- The local audit gates in `/root/floom-internal/launch/floom-build/scripts/audit.sh`
  pass for `ai-visibility`.
