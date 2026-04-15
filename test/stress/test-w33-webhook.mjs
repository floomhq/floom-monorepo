#!/usr/bin/env node
// W3.3 webhook handling tests. Covers:
//   - verifyAndParseWebhook: missing secret, missing header, bad sig
//   - verifyAndParseWebhook: happy path
//   - handleWebhookEvent: first_seen on first delivery
//   - handleWebhookEvent: dedupe on second delivery (same event_id)
//   - handleWebhookEvent dispatch: account.updated → persistAccountState
//   - handleWebhookEvent dispatch: payment_intent.succeeded → recorded
//   - handleWebhookEvent dispatch: charge.refunded → recorded
//   - handleWebhookEvent dispatch: invoice.paid → recorded
//   - listWebhookEvents + getWebhookEventById helpers
//
// Run: node test/stress/test-w33-webhook.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w33-webhook-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { db, DEFAULT_WORKSPACE_ID } = await import('../../apps/server/dist/db.js');
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

console.log('W3.3 stripe webhook tests');

// ---- fake Stripe client whose constructEvent honors a sentinel header ----
function makeFakeClient() {
  const calls = [];
  return {
    calls,
    client: {
      accounts: {
        async create() {
          throw new Error('not used in webhook tests');
        },
        async retrieve(id) {
          return {
            id,
            type: 'express',
            country: 'US',
            email: null,
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements: null,
          };
        },
      },
      accountLinks: { async create() { throw new Error('unused'); } },
      paymentIntents: {
        async create() { throw new Error('unused'); },
        async retrieve() { throw new Error('unused'); },
      },
      charges: { async retrieve() { throw new Error('unused'); } },
      refunds: { async create() { throw new Error('unused'); } },
      subscriptions: { async create() { throw new Error('unused'); } },
      webhooks: {
        constructEvent(payload, header, secret) {
          calls.push({ header, secret });
          if (!header) throw new Error('missing signature');
          if (header === 'bad') throw new Error('signature does not match');
          if (secret !== 'whsec_test') throw new Error('wrong secret');
          const raw =
            typeof payload === 'string'
              ? payload
              : payload.toString('utf-8');
          return JSON.parse(raw);
        },
      },
    },
  };
}

const { client, calls } = makeFakeClient();
stripe.setStripeClient(client);

// Seed an account row so the account.updated reducer has something to update.
db.prepare(
  `INSERT INTO stripe_accounts
     (id, workspace_id, user_id, stripe_account_id, account_type,
      country, charges_enabled, payouts_enabled, details_submitted)
   VALUES (?, ?, ?, ?, 'express', 'US', 0, 0, 0)`,
).run('sa_seed', DEFAULT_WORKSPACE_ID, 'user_a', 'acct_seed_1');

// ---- 1. verifyAndParseWebhook: missing header → throws ----
let missingHeader = false;
try {
  await stripe.verifyAndParseWebhook('{"id":"evt_1"}', null);
} catch (err) {
  missingHeader = err.name === 'StripeWebhookSignatureError';
}
log('verify: missing header → StripeWebhookSignatureError', missingHeader);

// ---- 2. verifyAndParseWebhook: bad sig → throws ----
let badSig = false;
try {
  await stripe.verifyAndParseWebhook('{"id":"evt_1"}', 'bad');
} catch (err) {
  badSig = err.name === 'StripeWebhookSignatureError';
}
log('verify: bad signature → StripeWebhookSignatureError', badSig);

// ---- 3. verifyAndParseWebhook: missing secret env → StripeConfigError ----
const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;
let missingSecret = false;
try {
  await stripe.verifyAndParseWebhook('{}', 'sig');
} catch (err) {
  missingSecret = err.name === 'StripeConfigError';
}
log('verify: missing STRIPE_WEBHOOK_SECRET → StripeConfigError', missingSecret);
process.env.STRIPE_WEBHOOK_SECRET = savedSecret;

// ---- 4. verifyAndParseWebhook: happy path ----
const validEvent = {
  id: 'evt_test_account_updated_1',
  type: 'account.updated',
  livemode: false,
  data: {
    object: {
      id: 'acct_seed_1',
      type: 'express',
      country: 'US',
      email: null,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: null,
    },
  },
  created: Math.floor(Date.now() / 1000),
};
const parsed = await stripe.verifyAndParseWebhook(JSON.stringify(validEvent), 'good_sig');
log('verify: parses event id', parsed.id === validEvent.id);
log('verify: parses event type', parsed.type === 'account.updated');
log(
  'verify: forwards header to constructEvent',
  calls.some((c) => c.header === 'good_sig'),
);
log(
  'verify: forwards secret to constructEvent',
  calls.some((c) => c.secret === 'whsec_test'),
);

// ---- 5. handleWebhookEvent: first_seen on first delivery ----
const result1 = stripe.handleWebhookEvent(parsed);
log('handle: first_seen=true on first delivery', result1.first_seen === true);
log('handle: event_id echoed', result1.event_id === validEvent.id);
log('handle: event_type echoed', result1.event_type === 'account.updated');

// account.updated reducer should have flipped the local row
const updatedRow = db
  .prepare(`SELECT * FROM stripe_accounts WHERE stripe_account_id = ?`)
  .get('acct_seed_1');
log('handle account.updated: charges_enabled flipped to 1', updatedRow.charges_enabled === 1);
log('handle account.updated: payouts_enabled flipped to 1', updatedRow.payouts_enabled === 1);
log(
  'handle account.updated: details_submitted flipped to 1',
  updatedRow.details_submitted === 1,
);

// ---- 6. handleWebhookEvent: dedupe on second delivery (same event_id) ----
const result2 = stripe.handleWebhookEvent(parsed);
log('handle: first_seen=false on second delivery', result2.first_seen === false);

// Ledger row count = 1
const ledgerCount = db
  .prepare(`SELECT COUNT(*) as n FROM stripe_webhook_events WHERE event_id = ?`)
  .get(validEvent.id).n;
log('handle: ledger has exactly one row for the event', ledgerCount === 1);

// ---- 7. handleWebhookEvent: payment_intent.succeeded persisted ----
const piEvent = {
  id: 'evt_pi_1',
  type: 'payment_intent.succeeded',
  livemode: false,
  data: {
    object: {
      id: 'pi_test_succ_1',
      amount: 2000,
      currency: 'usd',
      application_fee_amount: 100,
    },
  },
  created: Math.floor(Date.now() / 1000),
};
const piResult = stripe.handleWebhookEvent(piEvent);
log('handle pi.succeeded: first_seen=true', piResult.first_seen === true);
log(
  'handle pi.succeeded: ledger row persisted',
  !!stripe.getWebhookEventById('evt_pi_1'),
);

// ---- 8. handleWebhookEvent: charge.refunded persisted ----
const chargeEvent = {
  id: 'evt_charge_refunded_1',
  type: 'charge.refunded',
  livemode: false,
  data: { object: { id: 'ch_test_1', amount_refunded: 1000 } },
  created: Math.floor(Date.now() / 1000),
};
const chargeResult = stripe.handleWebhookEvent(chargeEvent);
log('handle charge.refunded: first_seen=true', chargeResult.first_seen === true);

// ---- 9. handleWebhookEvent: invoice.paid persisted ----
const invoiceEvent = {
  id: 'evt_inv_paid_1',
  type: 'invoice.paid',
  livemode: false,
  data: { object: { id: 'in_test_1', amount_paid: 5000 } },
  created: Math.floor(Date.now() / 1000),
};
stripe.handleWebhookEvent(invoiceEvent);
log('handle invoice.paid: ledger row exists', !!stripe.getWebhookEventById('evt_inv_paid_1'));

// ---- 10. handleWebhookEvent: unknown event type still persisted (no crash) ----
const unknownEvent = {
  id: 'evt_unknown_1',
  type: 'something.weird',
  livemode: false,
  data: { object: {} },
  created: Math.floor(Date.now() / 1000),
};
const unknownResult = stripe.handleWebhookEvent(unknownEvent);
log(
  'handle unknown: first_seen=true (recorded but not dispatched)',
  unknownResult.first_seen === true,
);

// ---- 11. listWebhookEvents ----
const events = stripe.listWebhookEvents({ limit: 10 });
log('listWebhookEvents: returns rows', events.length >= 5);
log(
  'listWebhookEvents: ordered desc by received_at',
  events[0].received_at >= events[events.length - 1].received_at,
);

// ---- 12. account.updated for unknown stripe_account_id is a no-op (no crash) ----
const orphanEvent = {
  id: 'evt_acc_orphan_1',
  type: 'account.updated',
  livemode: false,
  data: {
    object: {
      id: 'acct_does_not_exist',
      type: 'express',
      country: 'US',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: null,
    },
  },
  created: Math.floor(Date.now() / 1000),
};
let orphanOk = false;
try {
  const orphanResult = stripe.handleWebhookEvent(orphanEvent);
  orphanOk = orphanResult.first_seen === true;
} catch {
  orphanOk = false;
}
log('handle account.updated for orphan id: no crash', orphanOk);

// ---- 13. live-mode flag is preserved ----
const liveEvent = {
  id: 'evt_live_1',
  type: 'payment_intent.succeeded',
  livemode: true,
  data: { object: { id: 'pi_live_1', amount: 100, currency: 'usd' } },
  created: Math.floor(Date.now() / 1000),
};
stripe.handleWebhookEvent(liveEvent);
const liveRow = stripe.getWebhookEventById('evt_live_1');
log('handle: livemode flag preserved', liveRow && liveRow.livemode === 1);

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
