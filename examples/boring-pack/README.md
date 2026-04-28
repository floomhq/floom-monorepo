# Boring Pack

Five deterministic business utility apps bundled as a single Node.js sidecar on port 4220.

Zero external dependencies. Zero AI calls. Zero secrets. Each handler completes in under 500ms.

## Apps

| Slug | Category | Description |
|------|----------|-------------|
| `receipt` | business | Printable A6 receipt. Integer-cents math, Intl.NumberFormat display. |
| `vcard` | productivity | RFC 6350 v3.0 vCard string and data URL. |
| `ics` | productivity | RFC 5545 calendar event (.ics) with stable UID and attendees. |
| `iban-validate` | finance | IBAN validation via mod-97-10 with country and bank decomposition. |
| `cover-letter-format` | writing | Three length variants (short/medium/long) across three tones (formal/warm/direct). |

## Running locally

```bash
node examples/boring-pack/server.mjs
# or with custom port:
BORING_PACK_PORT=4220 node examples/boring-pack/server.mjs
```

## Endpoints

```
GET  /health                         — service liveness
GET  /openapi/<slug>.json            — OpenAPI 3.0 spec for one app
POST /<slug>/run                     — run handler; body and response are JSON
```

## Registering with Floom

Point Floom at the apps.yaml:

```bash
FLOOM_APPS_CONFIG=examples/boring-pack/apps.yaml \
  DATA_DIR=/tmp/floom-boring \
  node apps/server/dist/index.js
```

Or add the apps.yaml entries to your combined config alongside `fast-apps/apps.yaml`.

## Money handling

All monetary arithmetic uses integer cents. `Intl.NumberFormat` is used only for display strings. No floating-point accumulation in totals.

## Example calls

```bash
# receipt
curl -X POST http://localhost:4220/receipt/run \
  -H "Content-Type: application/json" \
  -d '{"vendor":"Acme","date":"2026-04-28","items":[{"description":"Widget","qty":3,"unit_price_cents":1500,"tax_pct":19}],"payment_method":"Card","currency":"EUR"}'

# vcard
curl -X POST http://localhost:4220/vcard/run \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Ada Lovelace","title":"Mathematician","email":"ada@example.com"}'

# ics
curl -X POST http://localhost:4220/ics/run \
  -H "Content-Type: application/json" \
  -d '{"title":"Team Standup","start":"2026-05-01T09:00:00Z","duration_minutes":30}'

# iban-validate
curl -X POST http://localhost:4220/iban-validate/run \
  -H "Content-Type: application/json" \
  -d '{"iban":"DE89370400440532013000"}'

# cover-letter-format
curl -X POST http://localhost:4220/cover-letter-format/run \
  -H "Content-Type: application/json" \
  -d '{"applicant_name":"Ada Lovelace","role":"Staff Engineer","company":"Floom","your_bullets":["Built the first algorithm in history","Deep expertise in analytical engines"],"tone":"direct"}'
```
