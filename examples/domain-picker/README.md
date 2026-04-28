# Domain Picker

Score bare domain name candidates with Gemini and cross-check live availability + price via the Dynadot API. Founders pick names weekly; this turns "AI rates your candidates" into "AI tells you which are buyable today and how much."

## What it does

Two concurrent steps:

1. **Gemini scoring** — one batched call with all candidates. Each name is scored 1-10 on memorability, brand fit, typeability, and search-friendliness. Model: `gemini-2.5-flash-lite`. Mandatory JSON schema response.

2. **Dynadot availability + price** — one batched API call covering all candidate x TLD combos (up to 100 domains per request). Returns `available` (bool) and `price` (string, e.g. `"$14.99"`). 4-second timeout with graceful degradation if the key is missing or the API fails.

Both steps run concurrently. Target end-to-end latency: under 8 seconds for 10 candidates x 8 TLDs.

## Port

`4230` (4200 = fast-apps, 4120 = launch-scorecards, 4220 = boring-pack)

## Run

```bash
node examples/domain-picker/server.mjs
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Used for AI scoring. Omitting returns HTTP 503. |
| `DYNADOT_API_KEY` | No | Omitting skips availability checks; all TLD rows return `availability: "key_missing"` so Gemini scores still come through. |
| `PORT` | No | Default `4230`. |
| `HOST` | No | Default `127.0.0.1`. |

## Creator-secret setup for production

Set `DYNADOT_API_KEY` as a creator-secret so it is injected at runtime without being exposed to users:

```
POST /api/me/apps/domain-picker/creator-secrets/DYNADOT_API_KEY
```

See the Floom creator-secret API at `apps/server/src/routes/me_apps.ts:659`.

`GEMINI_API_KEY` is a server-level environment variable, not a per-app creator-secret.

## API

### `GET /health`

Returns `{ ok: true, gemini_key: bool, dynadot_key: bool }`.

### `GET /openapi/domain-picker.json`

Returns the OpenAPI 3.0 spec.

### `POST /domain-picker/run`

**Request body:**

```json
{
  "candidates": ["acmehub", "rocketflow", "baseloop"],
  "tlds": [".com", ".io", ".dev", ".ai"],
  "audience": "B2B SaaS for operations teams"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `candidates` | string[] | Yes | 2-10 bare names, 3-30 chars each, alphanumeric + hyphens, no dots |
| `tlds` | string[] | No | Default `[".com", ".io", ".dev", ".ai"]`, max 8 |
| `audience` | string | No | Context for brand-fit scoring |

**Response:**

```json
{
  "ranked": [
    {
      "name": "acmehub",
      "score": 8,
      "score_breakdown": { "memorability": 9, "brand_fit": 7, "typeability": 9, "search": 7 },
      "tlds": [
        { "tld": ".com", "available": false, "price": null },
        { "tld": ".io", "available": true, "price": "$35.99" },
        { "tld": ".dev", "available": true, "price": "$14.99" },
        { "tld": ".ai", "available": true, "price": "$79.99" }
      ],
      "best_buyable": ".dev"
    }
  ],
  "top_pick": {
    "name": "acmehub",
    "tld": ".dev",
    "price": "$14.99",
    "reason": "highest score with cheapest available extension"
  },
  "screenshot_card_summary": "acmehub.dev — $14.99 available — score 8/10."
}
```

When `DYNADOT_API_KEY` is not set, each TLD row includes `"availability": "key_missing"` and `available: null, price: null`. Gemini scores still populate normally.

## Dynadot API notes

Dynadot `command=search` with `show_price=1&currency=USD` returns a `SearchResponse.SearchResults` array. Each item has `DomainName`, `Available` ("yes"/"no"), and `Price` (numeric string in USD). The sidecar normalises price to `"$X.XX"` format.

If the response format changes or the API is unreachable within 4 seconds, the sidecar degrades gracefully: all TLD rows get `availability: "timeout"` or `"api_error"`, and Gemini scores are unaffected.
