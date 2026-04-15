# Stripe Checkout demo (W3.3)

A Floom example app that exposes 3 Stripe Connect operations as a proxied
HTTP sidecar. Built to validate the W3.3 Stripe Connect partner ramp end
to end with a real Stripe test-mode key.

## What it does

| Operation | Verb + path | Purpose |
|---|---|---|
| `create_checkout` | `POST /create_checkout` | Create a Stripe Checkout Session (test mode), return hosted URL + 5% application fee |
| `list_payments` | `GET /list_payments?limit=10` | List the caller's recent payment intents |
| `refund_payment` | `POST /refund_payment` | Refund a payment intent + 5% fee within 30d |

The sidecar holds **no secrets**. Every request must include
`Authorization: Bearer sk_test_...`. Floom's runner builds that header
from the merged secret stack:

1. Operator-level secrets (`secrets` table, app-scoped)
2. Per-user persisted secrets (`user_secrets` table, W2.1)
3. Per-call MCP `_auth.STRIPE_SECRET_KEY` override (highest precedence)

This matches the auth precedence in `apps/server/src/services/runner.ts`.

## Run it locally

```bash
# 1. Start the sidecar
node examples/stripe-checkout/server.mjs
# → http://localhost:4120/openapi.json

# 2. Boot Floom server pointed at this app
FLOOM_APPS_CONFIG=examples/stripe-checkout/apps.yaml \
  DATA_DIR=/tmp/floom-stripe-demo \
  STRIPE_SECRET_KEY=sk_test_REDACTED \
  STRIPE_WEBHOOK_SECRET=whsec_REDACTED \
  node apps/server/dist/index.js
# → http://localhost:3051/api/hub  (stripe-checkout app appears)

# 3. (One time) Save your per-user Stripe key into user_secrets
curl -s -X POST http://localhost:3051/api/secrets \
  -H 'content-type: application/json' \
  -d '{"key":"STRIPE_SECRET_KEY","value":"sk_test_REDACTED"}'

# 4. Run the create_checkout action
curl -s -X POST http://localhost:3051/api/stripe-checkout/run \
  -H 'content-type: application/json' \
  -d '{
    "action":"create_checkout",
    "inputs":{"amount":2000,"currency":"usd","product_name":"Demo Product"}
  }' | jq .

# 5. Open the returned `checkout_url` in a browser, complete with Stripe
#    test card 4242 4242 4242 4242 / any future expiry / any CVC.
```

## Run it via MCP (Yash)

```bash
# 1. List tools
curl -s http://localhost:3051/mcp/app/stripe-checkout/tools/list | jq .

# 2. Invoke create_checkout with per-call auth override
curl -s -X POST http://localhost:3051/mcp/app/stripe-checkout/tools/call \
  -H 'content-type: application/json' \
  -d '{
    "name":"create_checkout",
    "arguments":{"amount":2000,"currency":"usd","product_name":"Demo"},
    "_meta":{"_auth":{"STRIPE_SECRET_KEY":"sk_test_REDACTED"}}
  }' | jq .
```

## Why a separate sidecar?

Floom's W3.3 service primitives (`apps/server/src/services/stripe-connect.ts`)
own the **platform** Stripe Connect surface: creating Express accounts,
direct charges with `application_fee_amount = floor(amount * 5%)`, refunds,
subscriptions, webhook ledger.

This sidecar is the **creator** surface. It demonstrates how a creator with
their own Stripe key (test or live) can ship a payments app on Floom
without touching the platform code. The two surfaces compose: creators
onboard via the W3.3 platform routes, then ship apps like this one.

## Files

- `server.mjs` — the HTTP sidecar (stdlib only, no deps)
- `apps.yaml` — Floom registration (`auth: bearer`, `secrets: [STRIPE_SECRET_KEY]`)
- `README.md` — this file
