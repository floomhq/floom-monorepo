#!/usr/bin/env node
// Actionable-hint audit for every 401/403 auth response (#536, ax-eval
// baseline 2026-04-23). Asserts that:
//
//   1. The exported AUTH_* constants exist and point callers at a concrete
//      next step (CLI command, env var, or docs URL).
//   2. The canonical `notOwnerResponse` helper emits a body that contains
//      the hint and docs_url fields.
//   3. POST /api/hub/ingest in Cloud mode returns a 401 whose body carries
//      `hint` (mentioning `floom auth`) and `docs_url`.
//   4. The global-auth middleware (FLOOM_AUTH_TOKEN set) returns a 401
//      whose body carries the self-host hint (`FLOOM_AUTH_TOKEN`).
//
// The server build step must run first:
//   pnpm --filter server build
//   node test/stress/test-auth-401-hints.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate DB + env so this test never sees another test's state.
const tmp = mkdtempSync(join(tmpdir(), 'floom-auth-hints-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
// Cloud mode gates /api/hub/ingest behind authentication; we want that
// path to fire so we can assert the 401 hint shape.
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || 'a'.repeat(64);
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || 'http://localhost:3051';

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

// ---------- 1. Constants ----------

const authMod = await import('../../apps/server/dist/lib/auth.js');

console.log('auth constants');
log(
  'AUTH_DOCS_URL points to the docs site',
  typeof authMod.AUTH_DOCS_URL === 'string' &&
    authMod.AUTH_DOCS_URL.startsWith('https://floom.dev/docs/'),
);
log(
  'AUTH_HINT_CLOUD mentions `floom auth`',
  typeof authMod.AUTH_HINT_CLOUD === 'string' &&
    authMod.AUTH_HINT_CLOUD.includes('floom auth'),
);
log(
  'AUTH_HINT_CLOUD mentions FLOOM_API_KEY',
  authMod.AUTH_HINT_CLOUD.includes('FLOOM_API_KEY'),
);
log(
  'AUTH_HINT_SELFHOST mentions FLOOM_AUTH_TOKEN',
  typeof authMod.AUTH_HINT_SELFHOST === 'string' &&
    authMod.AUTH_HINT_SELFHOST.includes('FLOOM_AUTH_TOKEN'),
);
log(
  'AUTH_HINT_NOT_OWNER is actionable (mentions sign in)',
  typeof authMod.AUTH_HINT_NOT_OWNER === 'string' &&
    /sign in/i.test(authMod.AUTH_HINT_NOT_OWNER),
);

// Hints must NEVER leak internal details. Cheap sanity net.
const FORBIDDEN_LEAK = [
  'stack',
  'node_modules',
  'better-sqlite3',
  'process.env',
  'Error:',
  '/root/',
  'apps/server',
];
for (const hint of [
  authMod.AUTH_HINT_CLOUD,
  authMod.AUTH_HINT_SELFHOST,
  authMod.AUTH_HINT_SIGNATURE,
  authMod.AUTH_HINT_NOT_OWNER,
]) {
  for (const needle of FORBIDDEN_LEAK) {
    log(
      `hint does not leak "${needle}"`,
      !hint.includes(needle),
      `hint="${hint}"`,
    );
  }
}

// ---------- 2. notOwnerResponse helper ----------

console.log('\nnotOwnerResponse helper');

// Build a minimal Hono-like context stub. `c.json(body, status)` is the
// only surface used by the helper, so that's all we need to mock.
function makeCtx() {
  return {
    json(body, status) {
      return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

{
  const res = authMod.notOwnerResponse(makeCtx());
  log('notOwnerResponse returns 403', res.status === 403);
  const body = await res.json();
  log('notOwnerResponse body.code === not_owner', body.code === 'not_owner');
  log(
    'notOwnerResponse body.hint is actionable',
    typeof body.hint === 'string' && body.hint.length > 10,
  );
  log(
    'notOwnerResponse body.docs_url is set',
    typeof body.docs_url === 'string' && body.docs_url.startsWith('https://'),
  );
}

// ---------- 3. /api/hub/ingest 401 shape ----------

console.log('\n/api/hub/ingest 401 shape (Cloud mode, anon)');

const { hubRouter } = await import('../../apps/server/dist/routes/hub.js');

async function callRouter(router, method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const req = new Request(`http://localhost${path}`, init);
  const res = await router.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, raw: text };
}

{
  const r = await callRouter(hubRouter, 'POST', '/ingest', {
    openapi_url: 'https://example.com/openapi.yaml',
  });
  log('POST /ingest returns 401 for anon in Cloud mode', r.status === 401);
  log('body.code === auth_required', r.body && r.body.code === 'auth_required');
  log(
    'body.hint mentions `floom auth`',
    r.body && typeof r.body.hint === 'string' && r.body.hint.includes('floom auth'),
    `hint=${r.body && r.body.hint}`,
  );
  log(
    'body.hint mentions FLOOM_API_KEY',
    r.body && r.body.hint && r.body.hint.includes('FLOOM_API_KEY'),
  );
  log(
    'body.docs_url is set to a floom.dev URL',
    r.body &&
      typeof r.body.docs_url === 'string' &&
      r.body.docs_url.startsWith('https://floom.dev/'),
  );
  // Never leak internals through the error message either.
  const serialized = JSON.stringify(r.body || {});
  for (const needle of FORBIDDEN_LEAK) {
    log(
      `401 body does not leak "${needle}"`,
      !serialized.includes(needle),
      `body=${serialized}`,
    );
  }
}

// ---------- 4. Global-auth middleware (FLOOM_AUTH_TOKEN) ----------

console.log('\nglobalAuthMiddleware 401 shape');

// Fresh Hono app with the middleware mounted, so we don't need to reboot
// the full server. The middleware reads FLOOM_AUTH_TOKEN at call time.
process.env.FLOOM_AUTH_TOKEN = 'test-token-xyz';

const { Hono } = await import('../../apps/server/node_modules/hono/dist/index.js');
const app = new Hono();
app.use('*', authMod.globalAuthMiddleware);
app.get('/api/probe', (c) => c.json({ ok: true }));

{
  const res = await app.fetch(new Request('http://localhost/api/probe'));
  log('global auth rejects missing token with 401', res.status === 401);
  const body = await res.json();
  log('body.code === auth_required', body.code === 'auth_required');
  log(
    'body.hint mentions FLOOM_AUTH_TOKEN',
    typeof body.hint === 'string' && body.hint.includes('FLOOM_AUTH_TOKEN'),
    `hint=${body.hint}`,
  );
  log(
    'body.docs_url set',
    typeof body.docs_url === 'string' && body.docs_url.startsWith('https://'),
  );
}

{
  const res = await app.fetch(
    new Request('http://localhost/api/probe', {
      headers: { authorization: 'Bearer test-token-xyz' },
    }),
  );
  log('global auth accepts valid token (200)', res.status === 200);
}

// ---------- Teardown ----------

try {
  rmSync(tmp, { recursive: true, force: true });
} catch {}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
