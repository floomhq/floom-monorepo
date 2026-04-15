#!/usr/bin/env node
// W3.3 stripe routes tests. Drives the Hono router directly (no server boot).
//
// Covers:
//   - POST /connect/onboard happy path + bad body + bad country
//   - GET /connect/status: 404 when not onboarded, 200 after onboard
//   - POST /payments happy path + bad body + missing onboarding
//   - POST /refunds happy path
//   - POST /subscriptions happy path
//   - POST /webhook: bad sig 400, happy 200, dedupe 200
//   - Auth boundary: caller A cannot read caller B's account
//   - Error envelope shape: every error path returns {error, code}
//
// Run: node test/stress/test-w33-stripe-routes.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w33-routes-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_CONNECT_ONBOARDING_RETURN_URL = 'https://floom.test/return';
process.env.STRIPE_CONNECT_ONBOARDING_REFRESH_URL = 'https://floom.test/refresh';

const { db } = await import('../../apps/server/dist/db.js');
const { stripeRouter } = await import('../../apps/server/dist/routes/stripe.js');
const stripe = await import('../../apps/server/dist/services/stripe-connect.js');

let passed = 0;
let failed = 0;
function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

console.log('W3.3 stripe routes tests');

// ---- in-memory fake Stripe client (smaller version) ----
function makeFakeClient() {
  const state = {
    accounts: new Map(),
    paymentIntents: new Map(),
    nextAcct: 1,
    nextPi: 1,
    nextRefund: 1,
    nextSub: 1,
  };
  const client = {
    accounts: {
      async create(params) {
        const id = `acct_test_${state.nextAcct++}`;
        const obj = {
          id,
          type: params.type || 'express',
          country: params.country || 'US',
          email: params.email ?? null,
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: null,
          metadata: params.metadata,
        };
        state.accounts.set(id, obj);
        return obj;
      },
      async retrieve(id) {
        const a = state.accounts.get(id);
        if (!a) throw new Error('not found');
        return a;
      },
    },
    accountLinks: {
      async create(params) {
        return {
          url: `https://connect.stripe.com/setup/e/${params.account}/abc`,
          expires_at: Math.floor(Date.now() / 1000) + 300,
        };
      },
    },
    paymentIntents: {
      async create(params, options) {
        const id = `pi_test_${state.nextPi++}`;
        const obj = {
          id,
          amount: params.amount,
          currency: params.currency,
          application_fee_amount: params.application_fee_amount,
          status: 'requires_payment_method',
          client_secret: `${id}_secret`,
          on_behalf_of: options?.stripeAccount || null,
          transfer_data: null,
          metadata: params.metadata,
          latest_charge: null,
          created: Math.floor(Date.now() / 1000),
        };
        state.paymentIntents.set(`${options?.stripeAccount}::${id}`, obj);
        return obj;
      },
      async retrieve(id, options) {
        const k = `${options?.stripeAccount}::${id}`;
        const obj = state.paymentIntents.get(k);
        if (!obj) throw new Error('not found');
        return obj;
      },
    },
    charges: {
      async retrieve() {
        return { id: 'ch_x', amount: 1000, currency: 'usd', payment_intent: null, created: Math.floor(Date.now() / 1000) };
      },
    },
    refunds: {
      async create(params) {
        const id = `re_test_${state.nextRefund++}`;
        return {
          id,
          amount: params.amount ?? 1000,
          currency: 'usd',
          payment_intent: params.payment_intent,
          status: 'succeeded',
          metadata: params.metadata,
        };
      },
    },
    subscriptions: {
      async create(params) {
        const id = `sub_test_${state.nextSub++}`;
        return {
          id,
          customer: params.customer,
          status: 'active',
          application_fee_percent: params.application_fee_percent ?? null,
          metadata: params.metadata,
          items: { data: [{ id: 'si_test', price: { id: params.items[0].price } }] },
        };
      },
    },
    webhooks: {
      constructEvent(payload, header, secret) {
        if (!header) throw new Error('missing sig');
        if (header === 'bad') throw new Error('bad sig');
        if (secret !== 'whsec_test') throw new Error('wrong secret');
        const raw = typeof payload === 'string' ? payload : payload.toString('utf-8');
        return JSON.parse(raw);
      },
    },
  };
  return { client, state };
}

const { client } = makeFakeClient();
stripe.setStripeClient(client);

// ---- helper: issue a request through the Hono router ----
async function fetchRoute(router, method, path, body, cookie, extraHeaders) {
  const url = `http://localhost${path}`;
  const init = { method };
  const headers = { ...(extraHeaders || {}) };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (typeof body !== 'string') headers['content-type'] = 'application/json';
    else if (!headers['content-type']) headers['content-type'] = 'application/json';
  }
  if (cookie) headers.cookie = cookie;
  init.headers = headers;
  const req = new Request(url, init);
  const res = await router.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

// ---- 1. POST /connect/onboard happy path ----
let r = await fetchRoute(stripeRouter, 'POST', '/connect/onboard', {
  country: 'DE',
  email: 'a@example.com',
});
log('POST /connect/onboard 200', r.status === 200, `got ${r.status}`);
log('POST /connect/onboard returns account_id', !!r.json?.account_id);
log('POST /connect/onboard returns onboarding_url', !!r.json?.onboarding_url);
log('POST /connect/onboard returns expires_at', !!r.json?.expires_at);
log('POST /connect/onboard returns account.country', r.json?.account?.country === 'DE');

// Capture cookie for caller A
const setCookie = r.headers.get('set-cookie') || '';
const m = /floom_device=([^;]+)/.exec(setCookie);
const cookieA = m ? `floom_device=${m[1]}` : null;
log('POST /connect/onboard mints session cookie', !!cookieA);

// ---- 2. POST /connect/onboard with empty body ----
r = await fetchRoute(stripeRouter, 'POST', '/connect/onboard', undefined, cookieA);
log('POST /connect/onboard empty body 200', r.status === 200, `got ${r.status}`);

// ---- 3. POST /connect/onboard with bad country ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/connect/onboard',
  { country: 'NOT_AN_ISO_CODE' },
  cookieA,
);
log('POST /connect/onboard bad country 400', r.status === 400);
log("POST /connect/onboard bad country code='invalid_body'", r.json?.code === 'invalid_body');

// ---- 4. POST /connect/onboard with bad email ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/connect/onboard',
  { email: 'not-an-email' },
  cookieA,
);
log('POST /connect/onboard bad email 400', r.status === 400);

// ---- 5. GET /connect/status ----
r = await fetchRoute(stripeRouter, 'GET', '/connect/status', undefined, cookieA);
log('GET /connect/status 200', r.status === 200);
log('GET /connect/status returns account', !!r.json?.account);
log(
  'GET /connect/status returns charges_enabled',
  r.json?.account?.charges_enabled === true,
);

// ---- 6. GET /connect/status?refresh=false (cached path) ----
r = await fetchRoute(stripeRouter, 'GET', '/connect/status?refresh=false', undefined, cookieA);
log('GET /connect/status?refresh=false 200', r.status === 200);

// ---- 7. GET /connect/status: caller B (no account) → 404 ----
r = await fetchRoute(stripeRouter, 'GET', '/connect/status'); // no cookie → mints fresh device
log('GET /connect/status caller B 404', r.status === 404);
log("GET /connect/status caller B code='stripe_account_not_found'", r.json?.code === 'stripe_account_not_found');

// ---- 8. POST /payments happy path ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/payments',
  { amount: 2000, currency: 'USD', description: 'test' },
  cookieA,
);
log('POST /payments 200', r.status === 200, `got ${r.status} body=${r.text}`);
log('POST /payments returns payment_intent_id', !!r.json?.payment_intent_id);
log('POST /payments returns client_secret', !!r.json?.client_secret);
log(
  'POST /payments application_fee_amount = 100 (5% of 2000)',
  r.json?.application_fee_amount === 100,
);
const piId = r.json.payment_intent_id;

// ---- 9. POST /payments bad body ----
r = await fetchRoute(stripeRouter, 'POST', '/payments', { amount: -5 }, cookieA);
log('POST /payments negative amount 400', r.status === 400);

r = await fetchRoute(stripeRouter, 'POST', '/payments', { amount: 1000, currency: 'usdx' }, cookieA);
log('POST /payments bad currency 400', r.status === 400);

r = await fetchRoute(stripeRouter, 'POST', '/payments', 'not json', cookieA, { 'content-type': 'application/json' });
log('POST /payments bad JSON 400', r.status === 400);

// ---- 10. POST /payments without onboarding (fresh device) ----
r = await fetchRoute(stripeRouter, 'POST', '/payments', {
  amount: 1000,
  currency: 'USD',
});
log('POST /payments no account 404', r.status === 404, `got ${r.status}`);
log("POST /payments no account code='stripe_account_not_found'", r.json?.code === 'stripe_account_not_found');

// ---- 11. POST /refunds happy path ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/refunds',
  { payment_intent_id: piId },
  cookieA,
);
log('POST /refunds 200', r.status === 200, `got ${r.status} body=${r.text}`);
log('POST /refunds returns refund_id', !!r.json?.refund_id);
log(
  'POST /refunds application_fee_refunded = true (in window)',
  r.json?.application_fee_refunded === true,
);

// ---- 12. POST /refunds bad body ----
r = await fetchRoute(stripeRouter, 'POST', '/refunds', { payment_intent_id: '' }, cookieA);
log('POST /refunds empty pi 400', r.status === 400);

// ---- 13. POST /subscriptions happy path ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/subscriptions',
  { customer_id: 'cus_test_1', price_id: 'price_test_metered' },
  cookieA,
);
log('POST /subscriptions 200', r.status === 200, `got ${r.status} body=${r.text}`);
log('POST /subscriptions returns subscription_id', !!r.json?.subscription_id);
log(
  'POST /subscriptions returns application_fee_percent = 5',
  r.json?.application_fee_percent === 5,
);

// ---- 14. POST /subscriptions bad body ----
r = await fetchRoute(stripeRouter, 'POST', '/subscriptions', { price_id: 'p1' }, cookieA);
log('POST /subscriptions missing customer_id 400', r.status === 400);

// ---- 15. POST /webhook happy path ----
const event1 = {
  id: 'evt_route_test_1',
  type: 'account.updated',
  livemode: false,
  data: {
    object: {
      id: 'acct_test_1', // first account created above
      type: 'express',
      country: 'DE',
      email: null,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: null,
    },
  },
  created: Math.floor(Date.now() / 1000),
};
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/webhook',
  JSON.stringify(event1),
  null,
  { 'stripe-signature': 'good_sig', 'content-type': 'application/json' },
);
log('POST /webhook 200', r.status === 200, `got ${r.status} body=${r.text}`);
log('POST /webhook ok=true', r.json?.ok === true);
log('POST /webhook first_seen=true', r.json?.first_seen === true);
log('POST /webhook event_id echoed', r.json?.event_id === 'evt_route_test_1');

// ---- 16. POST /webhook dedupe ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/webhook',
  JSON.stringify(event1),
  null,
  { 'stripe-signature': 'good_sig', 'content-type': 'application/json' },
);
log('POST /webhook dedupe 200', r.status === 200);
log('POST /webhook dedupe first_seen=false', r.json?.first_seen === false);

// ---- 17. POST /webhook bad signature ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/webhook',
  JSON.stringify(event1),
  null,
  { 'stripe-signature': 'bad', 'content-type': 'application/json' },
);
log('POST /webhook bad sig 400', r.status === 400);
log("POST /webhook bad sig code='stripe_webhook_signature_failed'", r.json?.code === 'stripe_webhook_signature_failed');

// ---- 18. POST /webhook missing signature header ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/webhook',
  JSON.stringify(event1),
  null,
  { 'content-type': 'application/json' },
);
log('POST /webhook missing sig 400', r.status === 400);

// ---- 19. Auth boundary: caller B cannot read caller A's account by guessing ----
// We onboard caller B as a separate device, then verify GET /connect/status
// returns B's row (or 404), never A's.
let rB = await fetchRoute(stripeRouter, 'POST', '/connect/onboard', { country: 'GB' });
const cookieBMatch = /floom_device=([^;]+)/.exec(rB.headers.get('set-cookie') || '');
const cookieB = cookieBMatch ? `floom_device=${cookieBMatch[1]}` : null;
log('POST /connect/onboard caller B 200', rB.status === 200);

const statusA = await fetchRoute(stripeRouter, 'GET', '/connect/status', undefined, cookieA);
const statusB = await fetchRoute(stripeRouter, 'GET', '/connect/status', undefined, cookieB);
log(
  'auth boundary: A and B see different stripe_account_id',
  statusA.json?.account?.stripe_account_id !== statusB.json?.account?.stripe_account_id,
);
log(
  'auth boundary: A sees its country DE',
  statusA.json?.account?.country === 'DE',
);
log(
  'auth boundary: B sees its country GB',
  statusB.json?.account?.country === 'GB',
);

// ---- 20. Auth boundary: B cannot refund A's payment intent ----
r = await fetchRoute(
  stripeRouter,
  'POST',
  '/refunds',
  { payment_intent_id: piId },
  cookieB,
);
// The fake throws "not found" because B's stripe_account_id doesn't have piId.
// The route surfaces this as a stripe_client_error (502) — not a 200, which
// is the load-bearing assertion: B cannot operate on A's PI.
log('auth boundary: B refund of A pi is NOT 200', r.status !== 200, `got ${r.status}`);

// ---- 21. Error envelope shape on every failure ----
const errorPaths = [
  { method: 'POST', path: '/connect/onboard', body: { email: 'bad' } },
  { method: 'POST', path: '/payments', body: { amount: 0 } },
  { method: 'POST', path: '/refunds', body: {} },
  { method: 'POST', path: '/subscriptions', body: {} },
];
let envOk = true;
for (const ep of errorPaths) {
  const rr = await fetchRoute(stripeRouter, ep.method, ep.path, ep.body, cookieA);
  if (!rr.json || typeof rr.json.error !== 'string' || typeof rr.json.code !== 'string') {
    envOk = false;
    console.log(`    bad envelope on ${ep.path}: ${JSON.stringify(rr.json)}`);
  }
}
log('error envelope: every error returns {error, code}', envOk);

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
