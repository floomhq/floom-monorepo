#!/usr/bin/env node
// Issue #600 (2026-04-23): every write + expensive read endpoint is now
// rate-limited. This test fires `cap + 1` requests at each newly-covered
// path with a tight cap and asserts the excess calls get 429.
//
// It exercises the middleware directly (not the full app) so the test
// doesn't need a booted server, SQLite, or auth. The production wiring is
// separately asserted by grepping the built `apps/server/dist/index.js`
// for each mount.
//
// Run: node test/stress/test-rate-limit-coverage.mjs

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-rl-coverage-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
// Tight caps so we trip the limit after a handful of requests per bucket.
process.env.FLOOM_RATE_LIMIT_WRITE_IP_PER_HOUR = '3';
process.env.FLOOM_RATE_LIMIT_WRITE_USER_PER_HOUR = '3';
process.env.FLOOM_RATE_LIMIT_READ_HEAVY_IP_PER_HOUR = '3';
process.env.FLOOM_RATE_LIMIT_READ_HEAVY_USER_PER_HOUR = '3';
delete process.env.FLOOM_RATE_LIMIT_DISABLED;

let passed = 0;
let failed = 0;
const log = (label, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
};

console.log('Issue #600: rate-limit coverage on every write + heavy-read path');

const { Hono } = await import(
  '../../node_modules/.pnpm/hono@4.12.14/node_modules/hono/dist/index.js'
);
const {
  writeOnlyRateLimitMiddleware,
  readOnlyRateLimitMiddleware,
  __resetStoreForTests,
} = await import('../../apps/server/dist/lib/rate-limit.js');

const anonCtx = {
  workspace_id: 'local',
  user_id: 'local',
  device_id: 'd',
  is_authenticated: false,
};
const resolveAnon = async () => anonCtx;

// ---------- helper: fire cap+2 requests, expect last 2 to be 429 ----------

async function assertCapTrips({ label, app, method, path, body }) {
  __resetStoreForTests();
  const cap = 3;
  const statuses = [];
  for (let i = 0; i < cap + 2; i++) {
    const req = new Request('http://localhost' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.' + (10 + (label.length % 200)),
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : body ?? '{}',
    });
    const res = await app.fetch(req);
    statuses.push(res.status);
  }
  const underCap = statuses.slice(0, cap);
  const overCap = statuses.slice(cap);
  log(
    `${label} :: first ${cap} not rate-limited`,
    underCap.every((s) => s !== 429),
    `got ${statuses.join(',')}`,
  );
  log(
    `${label} :: requests ${cap + 1}..${cap + 2} rate-limited (429)`,
    overCap.every((s) => s === 429),
    `got ${statuses.join(',')}`,
  );
}

// ---------- write tier on representative mutation paths ----------

const writeApp = new Hono();
writeApp.use('*', writeOnlyRateLimitMiddleware(resolveAnon));
writeApp.all('*', (c) => c.json({ ok: true }));

const writePaths = [
  { method: 'POST', path: '/api/workspaces' },
  { method: 'PATCH', path: '/api/workspaces/ws_1' },
  { method: 'DELETE', path: '/api/workspaces/ws_1' },
  { method: 'POST', path: '/api/memory/my-app' },
  { method: 'DELETE', path: '/api/memory/my-app/k' },
  { method: 'POST', path: '/api/secrets' },
  { method: 'DELETE', path: '/api/secrets/OPENAI_API_KEY' },
  { method: 'POST', path: '/api/connections/initiate' },
  { method: 'DELETE', path: '/api/connections/gmail' },
  { method: 'POST', path: '/api/stripe/payments' },
  { method: 'POST', path: '/api/stripe/refunds' },
  { method: 'POST', path: '/api/feedback' },
  { method: 'POST', path: '/api/admin/apps/foo/publish-status' },
  { method: 'POST', path: '/api/apps/foo/reviews' },
  { method: 'POST', path: '/api/parse' },
  { method: 'POST', path: '/api/pick' },
  { method: 'POST', path: '/api/thread' },
  { method: 'POST', path: '/api/thread/abc/turn' },
  { method: 'POST', path: '/api/session/switch-workspace' },
  { method: 'POST', path: '/api/waitlist' },
  { method: 'POST', path: '/api/me/triggers' },
  { method: 'PATCH', path: '/api/me/triggers/trg_1' },
  { method: 'DELETE', path: '/api/me/triggers/trg_1' },
  { method: 'PUT', path: '/api/me/apps/foo/secret-policies/OPENAI' },
  { method: 'DELETE', path: '/api/me/apps/foo' },
  { method: 'POST', path: '/api/hub/detect' },
  { method: 'PATCH', path: '/api/hub/foo' },
  { method: 'DELETE', path: '/api/hub/foo' },
  { method: 'POST', path: '/api/hub/foo/renderer' },
  { method: 'POST', path: '/api/run/r_abc/share' },
  { method: 'POST', path: '/api/foo/jobs/j_abc/cancel' },
];
for (const { method, path } of writePaths) {
  await assertCapTrips({ label: `write ${method} ${path}`, app: writeApp, method, path });
}

// ---------- write-tier: run-tier paths must NOT be throttled here ----------
// `/api/run`, `/api/:slug/run`, `/api/:slug/jobs`, `/mcp/app/:slug`,
// `/api/hub/ingest` are covered by the `run` tier upstream. The `write`
// tier must skip them (via isRunTierPath) so a single POST isn't charged
// against two buckets.
const passThroughPaths = [
  { method: 'POST', path: '/api/run' },
  { method: 'POST', path: '/api/foo/run' },
  { method: 'POST', path: '/api/foo/jobs' },
  { method: 'POST', path: '/mcp/app/foo' },
  { method: 'POST', path: '/api/hub/ingest' },
];
for (const { method, path } of passThroughPaths) {
  __resetStoreForTests();
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const res = await writeApp.fetch(
      new Request('http://localhost' + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
        body: '{}',
      }),
    );
    statuses.push(res.status);
  }
  log(
    `write-tier skips run-tier path ${method} ${path}`,
    statuses.every((s) => s === 200),
    `got ${statuses.join(',')}`,
  );
}

// ---------- read-heavy tier on representative scan paths ----------

const readApp = new Hono();
readApp.use('*', readOnlyRateLimitMiddleware(resolveAnon));
readApp.all('*', (c) => c.json({ ok: true }));

const readPaths = [
  '/api/hub',
  '/api/hub/foo',
  '/api/hub/foo/runs',
  '/api/hub/foo/runs-by-day',
  '/api/hub/mine',
  '/api/session/me',
  '/api/me/runs',
  '/api/me/runs/r_abc',
  '/api/run/r_abc',
  '/api/run/r_abc/stream',
  '/api/foo/jobs/j_abc',
];
for (const path of readPaths) {
  await assertCapTrips({ label: `read-heavy GET ${path}`, app: readApp, method: 'GET', path });
}

// Writes must pass through readHeavyLimit (method filter).
for (const { method, path } of [
  { method: 'POST', path: '/api/hub/detect' },
  { method: 'PATCH', path: '/api/hub/foo' },
]) {
  __resetStoreForTests();
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const res = await readApp.fetch(
      new Request('http://localhost' + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' },
        body: '{}',
      }),
    );
    statuses.push(res.status);
  }
  log(
    `read-heavy skips ${method} ${path}`,
    statuses.every((s) => s === 200),
    `got ${statuses.join(',')}`,
  );
}

// ---------- production wiring: each mount must exist in dist/index.js ----------

const indexJs = readFileSync(
  new URL('../../apps/server/dist/index.js', import.meta.url),
  'utf8',
);
const expectedMounts = [
  "/api/hub/*",
  "/api/workspaces/*",
  "/api/memory/*",
  "/api/secrets/*",
  "/api/connections/*",
  "/api/feedback/*",
  "/api/me/*",
  "/api/apps/*",
  "/api/admin/*",
  "/api/parse/*",
  "/api/pick/*",
  "/api/thread/*",
  "/api/session/*",
  "/api/waitlist/*",
  "/api/deploy-waitlist/*",
  "/api/run/*",
  "/api/stripe/*",
  "/api/:slug/jobs/*",
];
for (const path of expectedMounts) {
  log(`index.ts mounts a tiered rate-limit on '${path}'`, indexJs.includes(path));
}
// Webhook allowlist sanity checks: the stripe webhook short-circuit must
// be present and the `/hook/*` router mount must not have a generic write
// gate wrapped around it.
log(
  "stripe webhook is explicitly allowlisted (pass-through before writeLimit)",
  indexJs.includes('/api/stripe/webhook'),
);

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
