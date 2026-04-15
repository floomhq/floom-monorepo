#!/usr/bin/env node
// Stripe Checkout — Floom example app demonstrating per-user Stripe key
// injection via W2.1's user_secrets pattern + the W3.3 Stripe primitives.
//
// This is a tiny HTTP sidecar that exposes 3 OpenAPI 3.0 operations:
//   - create_checkout: open a Stripe Checkout Session in test mode
//   - list_payments:   list the caller's recent payment intents
//   - refund_payment:  refund a payment intent (+ application fee within 30d)
//
// Floom proxies into these operations as a normal proxied app. The
// `STRIPE_SECRET_KEY` is brought in by Floom from one of:
//   1. Per-call MCP `_auth.STRIPE_SECRET_KEY` (Yash invocation pattern)
//   2. Per-user persisted secret in user_secrets table (Maria, post-W2.1)
//   3. Operator-level secret (rare; OSS smoke-test path)
//
// Run: node examples/stripe-checkout/server.mjs
// Env:
//   PORT=4120 (default)
//   FLOOM_PLATFORM_FEE_PERCENT=5 (default; matches W3.3 service)
//
// The server holds NO secrets of its own. Every request must supply the
// Stripe key via the `Authorization: Bearer ...` header (Floom builds it
// from the merged secrets stack, see services/proxied-runner.ts:buildAuthHeaders).

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4120);
const PLATFORM_FEE_PERCENT = Number(
  process.env.FLOOM_PLATFORM_FEE_PERCENT || 5,
);

// ---------- OpenAPI 3.0 spec ----------
//
// Three operationIds map 1:1 to the apps.yaml secrets contract. The
// `securitySchemes.bearerAuth` declaration tells Floom's openapi-ingest
// to detect this app as `auth_type=bearer`, so the runner injects the
// `STRIPE_SECRET_KEY` secret as `Authorization: Bearer sk_test_...`.
//
// We intentionally keep the schemas tiny so the demo stays readable.

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Stripe Checkout Demo',
    version: '0.1.0',
    description:
      'Floom example app: create Stripe Checkout sessions and manage payments using a per-user Stripe Connect key.',
  },
  servers: [{ url: `http://localhost:${PORT}` }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'sk_test_...',
        description:
          'Per-user Stripe Secret Key. Brought in by Floom via the user_secrets table (W2.1) or the MCP _auth meta param. NEVER hard-coded in apps.yaml.',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/create_checkout': {
      post: {
        operationId: 'create_checkout',
        summary: 'Create a Stripe Checkout Session in test mode',
        description:
          'Opens a Stripe Checkout Session and returns the hosted-checkout URL. Requires the calling user to have onboarded via /api/stripe/connect/onboard first.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount', 'currency', 'product_name'],
                properties: {
                  amount: {
                    type: 'integer',
                    minimum: 50,
                    description: 'Amount in the smallest currency unit (cents).',
                  },
                  currency: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 3,
                    description: 'ISO 4217 currency code (e.g. usd, eur).',
                  },
                  product_name: {
                    type: 'string',
                    maxLength: 250,
                    description: 'Display name shown on the Stripe Checkout page.',
                  },
                  success_url: {
                    type: 'string',
                    description: 'URL Stripe redirects the buyer to after success. Defaults to the Floom thank-you page.',
                  },
                  cancel_url: {
                    type: 'string',
                    description: 'URL Stripe redirects the buyer to on cancel.',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Checkout session created.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    session_id: { type: 'string' },
                    checkout_url: { type: 'string' },
                    amount: { type: 'integer' },
                    currency: { type: 'string' },
                    application_fee_amount: { type: 'integer' },
                    expires_at: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid request.' },
          401: { description: 'Missing or invalid Stripe API key.' },
        },
      },
    },
    '/list_payments': {
      get: {
        operationId: 'list_payments',
        summary: "List the caller's recent payment intents",
        description:
          'Returns up to `limit` (default 10) recent payment intents on the connected account, ordered newest first.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          },
        ],
        responses: {
          200: {
            description: 'Recent payment intents.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    payments: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          amount: { type: 'integer' },
                          currency: { type: 'string' },
                          status: { type: 'string' },
                          created: { type: 'integer' },
                          application_fee_amount: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Missing or invalid Stripe API key.' },
        },
      },
    },
    '/refund_payment': {
      post: {
        operationId: 'refund_payment',
        summary: 'Refund a payment intent',
        description:
          "Refunds the given payment intent. If the original charge was created within 30 days, Floom's 5% application fee is refunded too.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['payment_intent_id'],
                properties: {
                  payment_intent_id: {
                    type: 'string',
                    description: 'Stripe payment intent id (pi_...).',
                  },
                  amount: {
                    type: 'integer',
                    minimum: 1,
                    description:
                      'Amount to refund, in the smallest currency unit. Omit for a full refund.',
                  },
                  reason: {
                    type: 'string',
                    enum: ['duplicate', 'fraudulent', 'requested_by_customer'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Refund issued.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    refund_id: { type: 'string' },
                    amount: { type: 'integer' },
                    currency: { type: 'string' },
                    status: { type: 'string' },
                    application_fee_refunded: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid request.' },
          401: { description: 'Missing or invalid Stripe API key.' },
          404: { description: 'Payment intent not found on this account.' },
        },
      },
    },
  },
};

// ---------- Stripe REST helpers ----------
//
// We hit the bare Stripe REST API rather than pulling in the Stripe SDK.
// The demo stays dependency-free and the bytes-on-the-wire are exactly
// what Floom's W3.3 service primitives also speak — so a creator who
// reads this file gets a clean mental model of the underlying calls.

const STRIPE_BASE = 'https://api.stripe.com/v1';

function bearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || typeof auth !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : null;
}

function formEncode(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') {
      // Stripe uses `parent[child]` convention for nested params.
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 === undefined || v2 === null) continue;
        usp.append(`${k}[${k2}]`, String(v2));
      }
    } else {
      usp.append(k, String(v));
    }
  }
  return usp.toString();
}

async function stripeFetch(apiKey, method, path, body) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': '2024-12-18.acacia',
    },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = formEncode(body);
  }
  const res = await fetch(`${STRIPE_BASE}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: { message: text || `HTTP ${res.status}` } };
  }
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------- request helpers ----------

async function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type':
      typeof body === 'string' ? 'text/plain' : 'application/json',
  });
  res.end(text);
}

function calculateApplicationFee(amount) {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor((amount * PLATFORM_FEE_PERCENT) / 100);
}

// ---------- handlers ----------

async function handleCreateCheckout(req, res) {
  const apiKey = bearerToken(req);
  if (!apiKey) {
    return send(res, 401, {
      error: 'missing Authorization: Bearer <STRIPE_SECRET_KEY>',
      hint: 'set STRIPE_SECRET_KEY via Floom user_secrets or MCP _auth',
    });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'bad JSON body' });
  }
  const amount = Number(body.amount);
  const currency = String(body.currency || '').toLowerCase();
  const productName = String(body.product_name || '');

  if (!Number.isInteger(amount) || amount < 50) {
    return send(res, 400, {
      error: 'amount must be an integer >= 50 (cents)',
    });
  }
  if (!/^[a-z]{3}$/.test(currency)) {
    return send(res, 400, {
      error: 'currency must be a 3-letter ISO 4217 code',
    });
  }
  if (!productName || productName.length > 250) {
    return send(res, 400, {
      error: 'product_name is required (1-250 chars)',
    });
  }

  const successUrl =
    body.success_url || 'https://cloud.floom.dev/billing/checkout/success';
  const cancelUrl =
    body.cancel_url || 'https://cloud.floom.dev/billing/checkout/cancel';

  // Build the Stripe Checkout Session create params. We use price_data
  // inline so the demo doesn't need a pre-existing Price object.
  // application_fee_amount = floor(amount * 5%) — same math as the
  // W3.3 service in apps/server/src/services/stripe-connect.ts.
  const fee = calculateApplicationFee(amount);
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][quantity]': '1',
    'payment_intent_data[application_fee_amount]': String(fee),
    'payment_intent_data[metadata][floom_demo]': 'stripe-checkout',
  };
  // Use a plain URL-encoded body since `formEncode` doesn't deeply nest.
  const init = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': '2024-12-18.acacia',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  };
  let session;
  try {
    const r = await fetch(`${STRIPE_BASE}/checkout/sessions`, init);
    const txt = await r.text();
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      parsed = { error: { message: txt } };
    }
    if (!r.ok) {
      return send(res, r.status === 401 ? 401 : 400, {
        error: parsed?.error?.message || `Stripe HTTP ${r.status}`,
        type: parsed?.error?.type || 'stripe_error',
      });
    }
    session = parsed;
  } catch (err) {
    return send(res, 502, {
      error: `failed to call Stripe: ${err.message}`,
    });
  }

  return send(res, 200, {
    session_id: session.id,
    checkout_url: session.url,
    amount,
    currency,
    application_fee_amount: fee,
    expires_at: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null,
  });
}

async function handleListPayments(req, res, url) {
  const apiKey = bearerToken(req);
  if (!apiKey) {
    return send(res, 401, {
      error: 'missing Authorization: Bearer <STRIPE_SECRET_KEY>',
    });
  }
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get('limit') || 10)),
  );
  let json;
  try {
    json = await stripeFetch(apiKey, 'GET', `/payment_intents?limit=${limit}`);
  } catch (err) {
    return send(res, err.status === 401 ? 401 : 502, {
      error: err.message,
    });
  }
  const payments = (json.data || []).map((pi) => ({
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
    created: pi.created,
    application_fee_amount: pi.application_fee_amount ?? null,
  }));
  return send(res, 200, { total: payments.length, payments });
}

async function handleRefundPayment(req, res) {
  const apiKey = bearerToken(req);
  if (!apiKey) {
    return send(res, 401, {
      error: 'missing Authorization: Bearer <STRIPE_SECRET_KEY>',
    });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'bad JSON body' });
  }
  const piId = String(body.payment_intent_id || '');
  if (!piId.startsWith('pi_')) {
    return send(res, 400, {
      error: 'payment_intent_id is required (pi_...)',
    });
  }
  // Look up the original PI to decide whether to refund the application fee.
  let pi;
  try {
    pi = await stripeFetch(apiKey, 'GET', `/payment_intents/${piId}`);
  } catch (err) {
    return send(res, err.status === 404 ? 404 : err.status === 401 ? 401 : 502, {
      error: err.message,
    });
  }
  const ageMs = Date.now() - (pi.created || 0) * 1000;
  const inWindow = ageMs >= 0 && ageMs <= 30 * 24 * 60 * 60 * 1000;

  const params = {
    payment_intent: piId,
    refund_application_fee: inWindow ? 'true' : 'false',
  };
  if (typeof body.amount === 'number' && body.amount > 0) {
    params.amount = String(body.amount);
  }
  if (
    body.reason &&
    ['duplicate', 'fraudulent', 'requested_by_customer'].includes(body.reason)
  ) {
    params.reason = body.reason;
  }

  let refund;
  try {
    refund = await stripeFetch(apiKey, 'POST', '/refunds', params);
  } catch (err) {
    return send(res, err.status === 401 ? 401 : 502, {
      error: err.message,
    });
  }
  return send(res, 200, {
    refund_id: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    application_fee_refunded: inWindow,
  });
}

// ---------- main router ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/openapi.json') {
    return send(res, 200, spec);
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, version: '0.1.0' });
  }

  try {
    if (req.method === 'POST' && url.pathname === '/create_checkout') {
      return await handleCreateCheckout(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/list_payments') {
      return await handleListPayments(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/refund_payment') {
      return await handleRefundPayment(req, res);
    }
  } catch (err) {
    return send(res, 500, { error: err.message || 'internal error' });
  }

  return send(res, 404, { error: 'not found', path: url.pathname });
});

server.listen(PORT, () => {
  console.log(`[stripe-checkout] listening on http://localhost:${PORT}`);
  console.log(`[stripe-checkout] spec at  http://localhost:${PORT}/openapi.json`);
  console.log(
    `[stripe-checkout] platform fee: ${PLATFORM_FEE_PERCENT}% (set FLOOM_PLATFORM_FEE_PERCENT to override)`,
  );
});
