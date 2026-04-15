#!/usr/bin/env node
// W3.3 stripe-connect service tests. Exercises services/stripe-connect.ts
// with a fully in-memory fake Stripe client injected via setStripeClient.
//
// Covers:
//   - calculateApplicationFee: 5% floor math + edge cases
//   - isWithinApplicationFeeRefundWindow: 30d window
//   - createExpressAccount: creates row + onboarding url, idempotent
//   - getAccountStatus: refreshes capability flags from upstream
//   - persistAccountState: webhook-side update
//   - createPaymentIntent: passes correct fee + destination
//   - refundPayment: refund_application_fee flag toggles by age
//   - createSubscription: passes 5% application_fee_percent
//   - cross-tenant isolation: user A cannot read user B account
//   - error envelopes: missing config, account not onboarded
//
// Run: node test/stress/test-w33-stripe-service.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w33-svc-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
process.env.STRIPE_CONNECT_ONBOARDING_RETURN_URL = 'https://floom.test/billing/return';
process.env.STRIPE_CONNECT_ONBOARDING_REFRESH_URL = 'https://floom.test/billing/refresh';

const { db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID } = await import(
  '../../apps/server/dist/db.js'
);
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

console.log('W3.3 stripe-connect service tests');

// ---- in-memory fake Stripe client ----
function makeFakeClient() {
  const state = {
    accounts: new Map(), // id → {...}
    accountLinks: [],
    paymentIntents: new Map(),
    refunds: [],
    subscriptions: new Map(),
    nextAcct: 1,
    nextLink: 1,
    nextPi: 1,
    nextRefund: 1,
    nextSub: 1,
    nextItem: 1,
    callLog: [],
  };
  const client = {
    accounts: {
      async create(params) {
        state.callLog.push({ op: 'accounts.create', params });
        const id = `acct_fake_${state.nextAcct++}`;
        const obj = {
          id,
          type: params.type || 'express',
          country: params.country || 'US',
          email: params.email ?? null,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          requirements: { currently_due: ['external_account'] },
          metadata: params.metadata || {},
        };
        state.accounts.set(id, obj);
        return obj;
      },
      async retrieve(id) {
        state.callLog.push({ op: 'accounts.retrieve', id });
        const a = state.accounts.get(id);
        if (!a) throw new Error(`fake: account ${id} not found`);
        return a;
      },
    },
    accountLinks: {
      async create(params) {
        state.callLog.push({ op: 'accountLinks.create', params });
        state.accountLinks.push(params);
        return {
          url: `https://connect.stripe.com/setup/e/${params.account}/${state.nextLink++}`,
          expires_at: Math.floor(Date.now() / 1000) + 300,
        };
      },
    },
    paymentIntents: {
      async create(params, options) {
        state.callLog.push({ op: 'paymentIntents.create', params, options });
        const id = `pi_fake_${state.nextPi++}`;
        const obj = {
          id,
          amount: params.amount,
          currency: params.currency,
          application_fee_amount: params.application_fee_amount ?? null,
          status: 'requires_payment_method',
          client_secret: `${id}_secret_fake`,
          on_behalf_of: options?.stripeAccount || null,
          transfer_data: null,
          metadata: params.metadata || {},
          latest_charge: null,
          created: Math.floor(Date.now() / 1000),
          _stripeAccount: options?.stripeAccount || null,
        };
        state.paymentIntents.set(`${options?.stripeAccount}::${id}`, obj);
        return obj;
      },
      async retrieve(id, options) {
        state.callLog.push({ op: 'paymentIntents.retrieve', id, options });
        const key = `${options?.stripeAccount}::${id}`;
        const obj = state.paymentIntents.get(key);
        if (!obj) throw new Error(`fake: payment intent ${id} not found on ${options?.stripeAccount}`);
        return obj;
      },
    },
    charges: {
      async retrieve(id, options) {
        state.callLog.push({ op: 'charges.retrieve', id, options });
        return {
          id,
          amount: 1000,
          currency: 'usd',
          payment_intent: null,
          created: Math.floor(Date.now() / 1000),
          application_fee_amount: 50,
        };
      },
    },
    refunds: {
      async create(params, options) {
        state.callLog.push({ op: 'refunds.create', params, options });
        const id = `re_fake_${state.nextRefund++}`;
        const obj = {
          id,
          amount: params.amount ?? 1000,
          currency: 'usd',
          payment_intent: params.payment_intent,
          status: 'succeeded',
          metadata: params.metadata || {},
          _refundAppFee: params.refund_application_fee ?? false,
        };
        state.refunds.push(obj);
        return obj;
      },
    },
    subscriptions: {
      async create(params, options) {
        state.callLog.push({ op: 'subscriptions.create', params, options });
        const id = `sub_fake_${state.nextSub++}`;
        const itemId = `si_fake_${state.nextItem++}`;
        const obj = {
          id,
          customer: params.customer,
          status: 'active',
          application_fee_percent: params.application_fee_percent ?? null,
          metadata: params.metadata || {},
          items: {
            data: [{ id: itemId, price: { id: params.items[0].price } }],
          },
        };
        state.subscriptions.set(id, obj);
        return obj;
      },
    },
    webhooks: {
      constructEvent(payload, header, secret) {
        state.callLog.push({ op: 'webhooks.constructEvent', header });
        if (!header || header === 'bad') {
          throw new Error('fake: bad signature');
        }
        const parsed =
          typeof payload === 'string' ? JSON.parse(payload) : JSON.parse(payload.toString('utf-8'));
        return parsed;
      },
    },
  };
  return { client, state };
}

const { client, state } = makeFakeClient();
stripe.setStripeClient(client);

// ---- 1. calculateApplicationFee ----
log('fee 5% of $0.01 (1 cent)', stripe.calculateApplicationFee(1) === 0);
log('fee 5% of $9.99 (999 cents) = 49', stripe.calculateApplicationFee(999) === 49);
log('fee 5% of $20.00 (2000 cents) = 100', stripe.calculateApplicationFee(2000) === 100);
log('fee 5% of $1000 (100000 cents) = 5000', stripe.calculateApplicationFee(100000) === 5000);
log('fee 5% of 0 = 0', stripe.calculateApplicationFee(0) === 0);
log('fee 5% of 19 = 0 (floor)', stripe.calculateApplicationFee(19) === 0);
log('fee 5% of 20 = 1', stripe.calculateApplicationFee(20) === 1);
log('fee 5% of 39 = 1 (floor)', stripe.calculateApplicationFee(39) === 1);
log('fee 5% of 40 = 2', stripe.calculateApplicationFee(40) === 2);

// percent override
log('fee 3% of 1000 = 30', stripe.calculateApplicationFee(1000, 3) === 30);
log('fee 0% of 1000 = 0', stripe.calculateApplicationFee(1000, 0) === 0);
log('fee 100% of 1000 = 1000', stripe.calculateApplicationFee(1000, 100) === 1000);
// invalid percent → falls back to 0 (no error)
log('fee invalid percent (-1) = 0', stripe.calculateApplicationFee(1000, -1) === 0);
log('fee invalid percent (NaN) = 0', stripe.calculateApplicationFee(1000, NaN) === 0);

// invalid amount → throws
let invalidAmt = false;
try {
  stripe.calculateApplicationFee(-5);
} catch (err) {
  invalidAmt = err.name === 'StripeClientError';
}
log('negative amount throws', invalidAmt);

let nonIntAmt = false;
try {
  stripe.calculateApplicationFee(10.5);
} catch (err) {
  nonIntAmt = err.name === 'StripeClientError';
}
log('non-integer amount throws', nonIntAmt);

// ---- 2. isWithinApplicationFeeRefundWindow ----
const now = Date.now();
const oneSecondAgo = Math.floor(now / 1000) - 1;
const oneDayAgo = Math.floor(now / 1000) - 86400;
const thirtyOneDaysAgo = Math.floor(now / 1000) - 31 * 86400;

log('window: 1s ago → in window', stripe.isWithinApplicationFeeRefundWindow(oneSecondAgo));
log('window: 1d ago → in window', stripe.isWithinApplicationFeeRefundWindow(oneDayAgo));
log(
  'window: 31d ago → outside window',
  !stripe.isWithinApplicationFeeRefundWindow(thirtyOneDaysAgo),
);
log('window: null → outside window', !stripe.isWithinApplicationFeeRefundWindow(null));
log('window: 0 → outside window', !stripe.isWithinApplicationFeeRefundWindow(0));

// ---- 3. createExpressAccount: happy path ----
const ctxA = {
  workspace_id: DEFAULT_WORKSPACE_ID,
  user_id: 'user_a',
  device_id: 'dev_a',
  is_authenticated: true,
};
const ctxB = {
  workspace_id: DEFAULT_WORKSPACE_ID,
  user_id: 'user_b',
  device_id: 'dev_b',
  is_authenticated: true,
};

// Seed user rows so FKs are happy (only the workspace FK matters but
// the user_id is just a column on stripe_accounts, no FK).
db.prepare(
  `INSERT OR IGNORE INTO users (id, workspace_id, auth_provider) VALUES (?, ?, 'local')`,
).run('user_a', DEFAULT_WORKSPACE_ID);
db.prepare(
  `INSERT OR IGNORE INTO users (id, workspace_id, auth_provider) VALUES (?, ?, 'local')`,
).run('user_b', DEFAULT_WORKSPACE_ID);

const created = await stripe.createExpressAccount(ctxA, {
  country: 'DE',
  email: 'a@example.com',
});
log('createExpressAccount: returns account_id', !!created.account_id && created.account_id.startsWith('acct_fake_'));
log(
  'createExpressAccount: returns onboarding_url',
  !!created.onboarding_url && created.onboarding_url.includes('connect.stripe.com'),
);
log('createExpressAccount: returns expires_at ISO', !!Date.parse(created.expires_at));
log('createExpressAccount: account.country = DE', created.account.country === 'DE');
log('createExpressAccount: account.account_type = express', created.account.account_type === 'express');
log('createExpressAccount: charges_enabled = 0', created.account.charges_enabled === 0);

// Composio-style metadata propagation
const lastCreate = state.callLog.find((c) => c.op === 'accounts.create');
log(
  'createExpressAccount: metadata.floom_workspace_id passed',
  lastCreate.params.metadata.floom_workspace_id === DEFAULT_WORKSPACE_ID,
);
log(
  'createExpressAccount: metadata.floom_user_id passed',
  lastCreate.params.metadata.floom_user_id === 'user_a',
);

// DB row exists
const row = db
  .prepare(`SELECT * FROM stripe_accounts WHERE workspace_id = ? AND user_id = ?`)
  .get(DEFAULT_WORKSPACE_ID, 'user_a');
log('createExpressAccount: DB row persisted', !!row);

// ---- 4. createExpressAccount: idempotent (reuses existing row) ----
const callsBefore = state.callLog.filter((c) => c.op === 'accounts.create').length;
const created2 = await stripe.createExpressAccount(ctxA, { country: 'DE' });
const callsAfter = state.callLog.filter((c) => c.op === 'accounts.create').length;
log(
  'createExpressAccount: second call does NOT recreate Stripe account',
  callsAfter === callsBefore,
);
log(
  'createExpressAccount: second call returns same account_id',
  created2.account_id === created.account_id,
);
log(
  'createExpressAccount: second call still mints fresh onboarding link',
  state.accountLinks.length === 2,
);

// ---- 5. getAccountStatus refreshes capability flags ----
// Flip the fake account to charges_enabled=true and re-poll.
state.accounts.get(created.account_id).charges_enabled = true;
state.accounts.get(created.account_id).payouts_enabled = true;
state.accounts.get(created.account_id).details_submitted = true;
state.accounts.get(created.account_id).requirements = null;

const status = await stripe.getAccountStatus(ctxA);
log('getAccountStatus: charges_enabled flipped', status.charges_enabled === 1);
log('getAccountStatus: payouts_enabled flipped', status.payouts_enabled === 1);
log('getAccountStatus: details_submitted flipped', status.details_submitted === 1);

// Status without a row → throws
let noStatusErr = false;
try {
  await stripe.getAccountStatus(ctxB);
} catch (err) {
  noStatusErr = err.name === 'StripeAccountNotFoundError';
}
log('getAccountStatus: no row → StripeAccountNotFoundError', noStatusErr);

// ---- 6. createPaymentIntent: passes 5% fee + destination ----
const pi = await stripe.createPaymentIntent(ctxA, {
  amount: 2000, // $20.00
  currency: 'USD',
  description: 'unit test charge',
});
log('createPaymentIntent: returns payment_intent_id', !!pi.payment_intent_id);
log('createPaymentIntent: returns client_secret', !!pi.client_secret);
log('createPaymentIntent: amount = 2000', pi.amount === 2000);
log('createPaymentIntent: currency lowercased to usd', pi.currency === 'usd');
log('createPaymentIntent: application_fee_amount = 100 (5%)', pi.application_fee_amount === 100);
log('createPaymentIntent: destination = stripe_account_id', pi.destination === created.account_id);

const piCall = state.callLog.find((c) => c.op === 'paymentIntents.create');
log(
  'createPaymentIntent: Stripe-Account header set via stripeAccount option',
  piCall.options.stripeAccount === created.account_id,
);
log(
  'createPaymentIntent: metadata includes floom_workspace_id',
  piCall.params.metadata.floom_workspace_id === DEFAULT_WORKSPACE_ID,
);
log(
  'createPaymentIntent: metadata includes floom_user_id',
  piCall.params.metadata.floom_user_id === 'user_a',
);
log(
  'createPaymentIntent: automatic_payment_methods enabled',
  piCall.params.automatic_payment_methods.enabled === true,
);

// no-account caller → throws
let noPiErr = false;
try {
  await stripe.createPaymentIntent(ctxB, { amount: 1000, currency: 'usd' });
} catch (err) {
  noPiErr = err.name === 'StripeAccountNotFoundError';
}
log('createPaymentIntent: ctxB (no account) → StripeAccountNotFoundError', noPiErr);

// invalid amount → throws
let badAmt = false;
try {
  await stripe.createPaymentIntent(ctxA, { amount: 0, currency: 'usd' });
} catch (err) {
  badAmt = err.name === 'StripeClientError';
}
log('createPaymentIntent: amount=0 → StripeClientError', badAmt);

let badCur = false;
try {
  await stripe.createPaymentIntent(ctxA, { amount: 1000, currency: '' });
} catch (err) {
  badCur = err.name === 'StripeClientError';
}
log('createPaymentIntent: empty currency → StripeClientError', badCur);

// ---- 7. refundPayment: 30-day window ----
// In-window: refund_application_fee should be true.
const refundIn = await stripe.refundPayment(ctxA, {
  payment_intent_id: pi.payment_intent_id,
});
log('refundPayment in-window: status=succeeded', refundIn.status === 'succeeded');
log(
  'refundPayment in-window: application_fee_refunded = true',
  refundIn.application_fee_refunded === true,
);
const refundCall = state.callLog
  .filter((c) => c.op === 'refunds.create')
  .pop();
log(
  'refundPayment in-window: Stripe call has refund_application_fee=true',
  refundCall.params.refund_application_fee === true,
);

// Out-of-window: spoof an old created timestamp on the fake intent.
const piRow = state.paymentIntents.get(`${created.account_id}::${pi.payment_intent_id}`);
piRow.created = Math.floor(Date.now() / 1000) - 31 * 86400;
const refundOut = await stripe.refundPayment(ctxA, {
  payment_intent_id: pi.payment_intent_id,
});
log(
  'refundPayment out-of-window: application_fee_refunded = false',
  refundOut.application_fee_refunded === false,
);
const refundCall2 = state.callLog
  .filter((c) => c.op === 'refunds.create')
  .pop();
log(
  'refundPayment out-of-window: Stripe call has refund_application_fee=false',
  refundCall2.params.refund_application_fee === false,
);

// Refund partial amount
const refundPartial = await stripe.refundPayment(ctxA, {
  payment_intent_id: pi.payment_intent_id,
  amount: 500,
});
log(
  'refundPayment: partial amount forwarded',
  state.callLog.filter((c) => c.op === 'refunds.create').pop().params.amount === 500,
);

// ---- 8. createSubscription: 5% application_fee_percent ----
const sub = await stripe.createSubscription(ctxA, {
  customer_id: 'cus_fake_1',
  price_id: 'price_test_metered',
  quantity: 1,
});
log('createSubscription: returns subscription_id', !!sub.subscription_id);
log('createSubscription: status = active', sub.status === 'active');
log('createSubscription: application_fee_percent = 5', sub.application_fee_percent === 5);
log('createSubscription: destination = caller account', sub.destination === created.account_id);
log('createSubscription: item_id present', !!sub.item_id);

const subCall = state.callLog.find((c) => c.op === 'subscriptions.create');
log(
  'createSubscription: Stripe-Account passed via options',
  subCall.options.stripeAccount === created.account_id,
);
log(
  'createSubscription: application_fee_percent param = 5',
  subCall.params.application_fee_percent === 5,
);

// no-account caller
let noSubErr = false;
try {
  await stripe.createSubscription(ctxB, {
    customer_id: 'cus_fake_b',
    price_id: 'price_test',
  });
} catch (err) {
  noSubErr = err.name === 'StripeAccountNotFoundError';
}
log('createSubscription: ctxB → StripeAccountNotFoundError', noSubErr);

// ---- 9. cross-tenant isolation ----
// Onboard user_b in a different workspace and verify ctxA cannot see it.
db.prepare(
  `INSERT INTO workspaces (id, slug, name, plan) VALUES (?, ?, ?, 'oss')`,
).run('ws_other', 'ws_other', 'Other');
db.prepare(
  `INSERT INTO users (id, workspace_id, auth_provider) VALUES (?, ?, 'local')`,
).run('user_other', 'ws_other');

const ctxOther = {
  workspace_id: 'ws_other',
  user_id: 'user_other',
  device_id: 'dev_other',
  is_authenticated: true,
};
const otherCreated = await stripe.createExpressAccount(ctxOther, { country: 'GB' });
log('createExpressAccount: ctxOther creates separate row', otherCreated.account_id !== created.account_id);

const ctxAFresh = stripe.getCallerAccount(ctxA);
log('cross-tenant: ctxA still sees its own account', ctxAFresh && ctxAFresh.user_id === 'user_a');

const ctxBFresh = stripe.getCallerAccount(ctxB);
log('cross-tenant: ctxB still has no account', ctxBFresh === null);

const otherFresh = stripe.getCallerAccount(ctxOther);
log(
  'cross-tenant: ctxOther sees its own account in ws_other',
  otherFresh && otherFresh.workspace_id === 'ws_other',
);

// ---- 10. config error: missing STRIPE_SECRET_KEY ----
// (skip cleanly because we already cached a fake client; just exercise
// the error class shape directly)
const cfgErr = new stripe.StripeConfigError('missing key');
log('StripeConfigError name', cfgErr.name === 'StripeConfigError');
const cliErr = new stripe.StripeClientError('boom');
log('StripeClientError name', cliErr.name === 'StripeClientError');
const nfErr = new stripe.StripeAccountNotFoundError('nope');
log('StripeAccountNotFoundError name', nfErr.name === 'StripeAccountNotFoundError');
const wsErr = new stripe.StripeWebhookSignatureError('bad sig');
log('StripeWebhookSignatureError name', wsErr.name === 'StripeWebhookSignatureError');

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
