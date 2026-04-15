# Floom monetization — Stripe Connect Express partner app

_v0.4.0-alpha.2+ — `/api/stripe/*` routes (W3.3)._

Floom turns creators into sellers. A creator publishes an app on Floom, users
install and pay, and Stripe routes the money: Floom keeps a 5% platform fee
and the creator gets the rest, payouts straight to their bank.

This is the **operator + creator** reference. For the Stripe SDK demo app,
see `examples/stripe-checkout/README.md`. For the architectural rationale
(Express vs Standard, Connect vs Paddle, MoR liability, VAT), see
`research/stripe-connect-validation.md` (P.3).

## TL;DR

| Question | Answer |
|---|---|
| Who is the merchant of record? | **The creator.** Floom is a facilitator, never touches the funds. |
| Platform fee | **5%** flat, `floor(amount * 0.05)`. Configurable via `STRIPE_APPLICATION_FEE_PERCENT`. |
| Refund window for the platform fee | **30 days** from the original charge. After that the fee is retained (Stripe's processing fee is also gone, so the math stops working otherwise). |
| Payout schedule | Stripe defaults: **daily rolling**. Creators can switch to weekly/monthly in their Express dashboard. Floom never holds creator money. |
| Tax / VAT / 1099-K | **Stripe Tax Basic**, attached to each connected account. Each creator files their own returns. Floom files zero VAT or 1099-Ks. |
| Disputes | Direct charges only → **the creator bears the chargeback**. Stripe debits their balance. Floom's 5% is left intact unless the creator asks for `application_fee_refund`. |
| Self-host considerations | Each self-hosted Floom needs its own Stripe Connect platform application (10-min sign-up at dashboard.stripe.com → Connect). Without one, all `/api/stripe/*` routes return `400 stripe_config_missing`. |

## Architecture

```
                  ┌─────────────┐
buyer ───── pay ─►│  Stripe     │── auto-transfers ─┐
                  │  Checkout   │   (direct charge) │
                  └─────────────┘                   │
                          ▲                         │
                          │                         ▼
                  ┌─────────────┐         ┌──────────────────┐
                  │  Floom      │ webhook │ Creator's        │
                  │  /api/      │◄────────│ Stripe Connect   │
                  │  stripe/    │         │ Express account  │
                  │  webhook    │         └──────────────────┘
                  └─────────────┘                   │
                          ▲                         │ payout
                          │                         ▼
                          │                 ┌──────────────────┐
                          │                 │ Creator's bank   │
                          │                 │ account (IBAN)   │
                          │                 └──────────────────┘
                          │
              5% application_fee_amount ┐
                                        ▼
                              ┌──────────────────┐
                              │ Floom platform   │
                              │ Stripe balance   │
                              └──────────────────┘
```

Three things to note:
1. **The buyer pays the creator's connected account directly.** Floom never has the funds in its own balance, only the 5% platform fee.
2. **Floom's only Stripe responsibility is the 5% fee.** Everything else (KYC, AML, payout schedule, dispute handling, refund logic, tax invoices, 1099-K filing) lives on the connected account. Stripe owns it.
3. **Webhooks are the source of truth for state changes.** Floom's `/api/stripe/webhook` ledger dedupes by event id and dispatches reducers. The local `stripe_accounts` table is a cache.

## How a creator enables monetization

```bash
# 1. Onboard. Returns an account id + a hosted onboarding URL that the
#    creator opens in a new tab. Stripe runs KYC in the background.
curl -X POST https://your-floom.example.com/api/stripe/connect/onboard \
  -H 'content-type: application/json' \
  -d '{"country":"DE","email":"creator@example.com"}'
# → {
#     "account_id": "acct_1abc...",
#     "onboarding_url": "https://connect.stripe.com/setup/e/acct_1abc.../...",
#     "expires_at": "2026-04-15T08:05:23.000Z",
#     "account": { "stripe_account_id": "acct_1abc...",
#                  "charges_enabled": false, "payouts_enabled": false, ... }
#   }

# 2. Open onboarding_url, fill the form, submit. Stripe sends an
#    `account.updated` webhook to /api/stripe/webhook when KYC passes.
#    Floom flips charges_enabled + payouts_enabled to true.

# 3. Verify status (cached → 1ms; ?refresh=true polls Stripe live).
curl https://your-floom.example.com/api/stripe/connect/status
# → { "account": { "charges_enabled": true, "payouts_enabled": true, ... } }

# 4. Create a payment intent for a buyer. Floom adds a 5% application fee
#    and routes the charge to the creator's connected account.
curl -X POST https://your-floom.example.com/api/stripe/payments \
  -H 'content-type: application/json' \
  -d '{"amount":2000,"currency":"USD","description":"App run"}'
# → { "payment_intent_id": "pi_3xxx",
#     "client_secret": "pi_3xxx_secret_...",
#     "amount": 2000, "currency": "usd",
#     "application_fee_amount": 100,
#     "destination": "acct_1abc..." }

# 5. Issue a refund. Within 30d the 5% fee is refunded too.
curl -X POST https://your-floom.example.com/api/stripe/refunds \
  -H 'content-type: application/json' \
  -d '{"payment_intent_id":"pi_3xxx"}'
# → { "refund_id": "re_xxx", "status": "succeeded",
#     "application_fee_refunded": true }

# 6. (Optional) Create a recurring subscription with the same 5% fee.
curl -X POST https://your-floom.example.com/api/stripe/subscriptions \
  -H 'content-type: application/json' \
  -d '{"customer_id":"cus_xxx","price_id":"price_xxx"}'
# → { "subscription_id": "sub_xxx", "status": "active",
#     "application_fee_percent": 5, "destination": "acct_1abc..." }
```

## Operator setup

Five env vars wire the whole flow up:

| Env var | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | Platform Stripe key from your Connect platform application. `sk_test_*` for sandbox, `sk_live_*` for production. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Webhook signing secret. Get it from `dashboard.stripe.com/webhooks` after registering your `/api/stripe/webhook` endpoint. |
| `STRIPE_CONNECT_ONBOARDING_RETURN_URL` | Recommended | Where Stripe redirects creators after they finish onboarding. Defaults to `https://cloud.floom.dev/billing/return` which 404s on self-hosts. |
| `STRIPE_CONNECT_ONBOARDING_REFRESH_URL` | Recommended | Where Stripe redirects creators if their onboarding session expires. Same default and same self-host caveat. |
| `STRIPE_APPLICATION_FEE_PERCENT` | No | Override the platform fee. Default 5. Range 0-100. |

Add them to your `.env`, then restart the Floom container. Without
`STRIPE_SECRET_KEY` set, every `/api/stripe/*` route returns
`400 stripe_config_missing`.

### Self-host vs Floom Cloud — do creators need their own Connect app?

**No.** A self-hosted Floom acts as a single Stripe Connect platform. The
operator (you) signs up for Stripe Connect once, drops the platform key
into `STRIPE_SECRET_KEY`, and every creator on your instance becomes a
connected Express account on your platform. Each creator never sees a
Stripe API key — they just complete the onboarding form once.

This is intentional and matches Stripe Connect's design. The alternative
(every creator brings their own Stripe Connect platform) doesn't compose
with the marketplace topology and would make `application_fee_amount`
meaningless.

If you want creators to bring their **own raw Stripe key** (test or live)
and skip the platform/Connect layer entirely, that's what the
`examples/stripe-checkout/` demo app shows. It's a creator-side surface,
orthogonal to the platform routes here.

### Floom Cloud creators

On Floom Cloud (`cloud.floom.dev`), the operator is Floom Inc. and the
platform Connect application is owned by Floom. Creators sign up via the
hosted Cloud workspace (W3.1) and onboard against Floom's platform key —
no env var setup needed.

## Webhook setup

Stripe webhooks are the source of truth for state changes. Floom's webhook
ledger (`stripe_webhook_events` table) dedupes by event id, so re-deliveries
are idempotent.

```bash
# 1. Expose your Floom instance to the public internet (or use ngrok)
ngrok http 3051

# 2. Register the webhook in Stripe
#    Dashboard → Developers → Webhooks → Add endpoint
#    URL: https://<your-tunnel>.ngrok.io/api/stripe/webhook
#    Events to listen for:
#      account.updated
#      payment_intent.succeeded
#      charge.refunded
#      invoice.paid
#      payout.created
#      payout.paid
#      payout.failed
#
# 3. Stripe shows the signing secret. Copy whsec_xxx into STRIPE_WEBHOOK_SECRET
#    and restart the container.
#
# 4. Test the webhook from the Stripe dashboard:
#    Webhook → Send test webhook → account.updated
#    Floom logs: "POST /api/stripe/webhook → 200 first_seen=true"
```

## Tax handling

Floom uses **Stripe Tax Basic (API)** at €0.45 per transaction. Each
creator's connected account is responsible for filing its own VAT / GST /
sales tax returns. Floom files **zero** tax forms on behalf of creators —
neither 1099-Ks nor VAT returns.

For B2B EU sales, Stripe Tax detects reverse charge automatically when the
buyer provides a VAT ID. For B2C EU sales, Stripe Tax calculates
destination-country VAT. Once a creator crosses €10,000/year cross-border,
they must register for OSS (One Stop Shop) in their home country — the
creator dashboard surfaces this as a warning when sales approach the cap.

For US creators, Stripe files 1099-K forms automatically for any connected
account that crosses the reporting threshold ($20,000 / 200 transactions
for 2025). The creator receives the 1099-K from Stripe directly. Floom is
not in the loop.

## Refund policy and fee handling

| Scenario | Buyer refund | Floom 5% fee |
|---|---|---|
| Refund within 30 days | Full or partial | Refunded automatically (`refund_application_fee=true`) |
| Refund after 30 days | Full or partial | **Retained** (Stripe's processing fee is also gone — Floom can't keep the math working) |
| Chargeback | Stripe debits the creator's balance + €15 fee | Retained (Stripe leaves it intact unless explicitly clawed back) |
| Failed payout | N/A | N/A (creator's bank rejects, Stripe retries) |

The 30-day window is hard-coded in `apps/server/src/services/stripe-connect.ts`
as `APPLICATION_FEE_REFUND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000`. The cutoff
is checked against the original `payment_intent.created` timestamp, not the
refund request time — so a refund issued late on day 30 still includes the
fee, but day 31 does not.

## Subscriptions and metered billing

Floom supports flat-rate and metered subscriptions out of the box:

```bash
# Create a flat-rate subscription
curl -X POST https://your-floom.example.com/api/stripe/subscriptions \
  -H 'content-type: application/json' \
  -d '{
    "customer_id": "cus_xxx",
    "price_id": "price_monthly_29eur",
    "trial_period_days": 14
  }'
```

For metered billing ("charge per run"), the creator declares a metered
price object on Stripe (`usage_type=metered`), references it in the
`/api/stripe/subscriptions` body, and the Floom runner reports usage via
Stripe's `subscription_items.create_usage_record` API on every successful
run. Reference implementation lives in W4.x — Wave 4 plugs the metering
middleware into the runner.

## Direct vs destination charges

Floom uses **direct charges** only. The connected account charges the
buyer's card via the Stripe-Account header (`stripeAccount` SDK option).
The application fee auto-transfers to Floom's platform balance.

We rejected destination charges and "separate charges and transfers" for
two reasons:
1. Destination charges make the platform (Floom) the merchant of record,
   shifting tax + dispute liability to Floom.
2. Separate charges + transfers add latency and a manual reconciliation
   step that direct charges avoid entirely.

This is the same architecture Substack, Patreon, and Etsy use under the
hood. P.3 research has the full tradeoff matrix.

## What ships in v0.4.0-alpha.2 (W3.3)

| Surface | File | Notes |
|---|---|---|
| Express account onboarding | `services/stripe-connect.ts:createExpressAccount` | Idempotent — second call recycles the existing Stripe id and just mints a fresh onboarding link |
| Status refresh | `services/stripe-connect.ts:getAccountStatus` | Polls Stripe live and persists the result |
| Direct charge with 5% fee | `services/stripe-connect.ts:createPaymentIntent` | `application_fee_amount = floor(amount * 0.05)` |
| Refund + 30d fee window | `services/stripe-connect.ts:refundPayment` | Auto-refunds the 5% fee within window |
| Subscription with 5% fee | `services/stripe-connect.ts:createSubscription` | Sets `application_fee_percent=5` |
| Webhook receiver | `routes/stripe.ts` POST `/webhook` | Raw body, signature verified via `stripe.webhooks.constructEvent` |
| Webhook ledger + dedupe | `services/stripe-connect.ts:handleWebhookEvent` | UNIQUE on `event_id`, idempotent across at-least-once delivery |
| Reducer: `account.updated` | dispatches `persistAccountState` | Flips `charges_enabled`, `payouts_enabled`, `details_submitted` on local row |
| Auth boundary | All routes scope by `(workspace_id, owner_id)` | `owner_id = is_authenticated ? user_id : "device:" + device_id`. User A cannot read or refund user B's payments even by guessing ids. |
| 163 unit + integration tests | `test/stress/test-w33-*.mjs` | Schema, service, routes, webhook |

What's deferred to W4.x and W5.x:
- Per-run metered billing middleware in the runner
- Stripe Managed Payments (premium MoR tier)
- Creator dashboard billing tab UI (W4.1)
- User dashboard payment methods + invoices (W4.2)

## Reference

- W3.3 source: `apps/server/src/services/stripe-connect.ts`
- W3.3 routes: `apps/server/src/routes/stripe.ts`
- W3.3 schema: `apps/server/src/db.ts` (`stripe_accounts`, `stripe_webhook_events`, `user_version=6`)
- W3.3 tests: `test/stress/test-w33-*.mjs`
- Demo app: `examples/stripe-checkout/`
- Architecture rationale: `research/stripe-connect-validation.md` (P.3)
- Self-host operator setup: `docs/SELF_HOST.md`
