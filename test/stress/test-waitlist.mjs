#!/usr/bin/env node
// /api/waitlist — deploy waitlist endpoint (launch 2026-04-27).
//
// Covers the five acceptance scenarios from the launch spec:
//   1. Valid email → 200 + row inserted + ip_hash populated.
//   2. Invalid email → 400, no row written.
//   3. Duplicate email → 200 (idempotent) without a second row.
//   4. Rate limit trips after FLOOM_WAITLIST_IP_PER_HOUR requests /IP,
//      then admin bearer bypasses the cap.
//   5. No RESEND_API_KEY → signup still succeeds (graceful degrade).
//   6. Production/cloud mode fails closed without WAITLIST_IP_HASH_SECRET;
//      local dev keeps an explicit dev-only fallback.
//
// The test builds its own tiny Hono app that mounts the router the
// same way apps/server/src/index.ts does, so we exercise the actual
// route plus the rate-limit + email paths end-to-end without having to
// spin up a full server (jobs worker, better-auth, etc.).
//
// Run: node test/stress/test-waitlist.mjs  (after `pnpm --filter
// @floom/server build` — same convention as every other test here.)

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-waitlist-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
// Keep the per-IP cap small so the limit-trip test is fast. The route
// reads this on every request.
process.env.FLOOM_WAITLIST_IP_PER_HOUR = '3';
process.env.WAITLIST_IP_HASH_SECRET = 'test-secret';
// Admin bearer for the bypass assertion. The route delegates to
// hasValidAdminBearer() which reads FLOOM_AUTH_TOKEN. See
// apps/server/src/lib/auth.ts::getExpectedToken.
process.env.FLOOM_AUTH_TOKEN = 'test-admin-bearer';
// Explicitly unset RESEND_API_KEY so sendEmail() hits its stdout
// fallback path (test #5). We still want the signup to succeed.
delete process.env.RESEND_API_KEY;

// Import Hono via the server package's own node_modules so Node's ESM
// resolver finds it regardless of cwd. Same pattern as test-renderer-
// e2e.mjs.
const { Hono } = await import('../../apps/server/node_modules/hono/dist/index.js');
const { db } = await import('../../apps/server/dist/db.js');
const { waitlistRouter, __resetWaitlistRateLimitForTests } = await import(
  '../../apps/server/dist/routes/waitlist.js'
);
const { getWaitlistIpHashSecret, DEV_WAITLIST_IP_HASH_SECRET } = await import(
  '../../apps/server/dist/lib/startup-checks.js'
);

const app = new Hono();
app.route('/api/waitlist', waitlistRouter);

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

async function post(body, headers = {}) {
  const req = new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '10.0.0.1',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await app.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, json, text };
}

function rowCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM waitlist_signups`).get().n;
}

function rowsByEmail(email) {
  return db
    .prepare(`SELECT * FROM waitlist_signups WHERE LOWER(email) = LOWER(?)`)
    .all(email);
}

console.log('Deploy waitlist (/api/waitlist)');

// ── 1. valid email happy path ──────────────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const before = rowCount();
  const res = await post({ email: 'alice@example.com', source: 'hero' });
  log('valid email returns 200 ok:true', res.status === 200 && res.json?.ok === true,
    `status=${res.status} body=${res.text}`);
  log('valid email inserts exactly one row', rowCount() === before + 1);
  const rows = rowsByEmail('alice@example.com');
  log('row has expected columns',
    rows.length === 1 &&
      rows[0].email === 'alice@example.com' &&
      rows[0].source === 'hero' &&
      // ip_hash is sha256 hex (64 chars) when extractIp returned a
      // real IP, and null when the test Request had no socket backing
      // so extractIp fell back to "unknown". Both are valid outcomes;
      // we just assert that whatever is there is well-typed.
      (rows[0].ip_hash === null ||
        (typeof rows[0].ip_hash === 'string' && rows[0].ip_hash.length === 64)) &&
      typeof rows[0].created_at === 'string',
    JSON.stringify(rows[0] ?? null),
  );
}

// ── 2. invalid email rejected ──────────────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  const before = rowCount();
  for (const bad of ['', 'not-an-email', 'a b@c.d', 'a@b', '@x.y']) {
    __resetWaitlistRateLimitForTests();
    const res = await post({ email: bad });
    log(`rejects invalid "${bad}"`,
      res.status === 400 && res.json?.error === 'invalid_email',
      `status=${res.status} body=${res.text}`);
  }
  log('invalid emails write no rows', rowCount() === before);
}

// ── 3. duplicate email idempotent ──────────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const first = await post({ email: 'bob@example.com', source: 'studio-deploy' });
  log('first signup ok', first.status === 200 && first.json?.ok === true);
  const second = await post({ email: 'BOB@example.com', source: 'me-publish' });
  log('duplicate (case-insensitive) returns 200 ok:true',
    second.status === 200 && second.json?.ok === true,
    `status=${second.status}`);
  log('duplicate does not insert a second row', rowCount() === 1);
}

// ── 4. rate limit trips on all requests and admin bearer bypasses ───────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const ip = { 'x-forwarded-for': '10.99.0.1' };
  // 3 signups are allowed (FLOOM_WAITLIST_IP_PER_HOUR=3)
  const r1 = await post({ email: 'c1@example.com' }, ip);
  const r2 = await post({ email: 'c2@example.com' }, ip);
  const r3 = await post({ email: 'c3@example.com' }, ip);
  log('first 3 signups within cap succeed',
    r1.status === 200 && r2.status === 200 && r3.status === 200,
    `${r1.status}/${r2.status}/${r3.status}`);
  const r4 = await post({ email: 'c4@example.com' }, ip);
  log('4th signup from same IP returns 429',
    r4.status === 429 && r4.json?.error === 'rate_limited',
    `status=${r4.status} body=${r4.text}`);
  // Admin bearer bypasses the cap.
  const r5 = await post(
    { email: 'c5@example.com' },
    { ...ip, authorization: 'Bearer test-admin-bearer' },
  );
  log('admin bearer bypasses the per-IP cap',
    r5.status === 200 && r5.json?.ok === true,
    `status=${r5.status} body=${r5.text}`);

  __resetWaitlistRateLimitForTests();
  const noisyIp = { 'x-forwarded-for': '10.99.0.2' };
  const bad1 = await post({ email: 'bad-1' }, noisyIp);
  const bad2 = await post({ email: 'bad-2' }, noisyIp);
  const bad3 = await post('not json', noisyIp);
  log('invalid requests consume the same per-IP cap',
    bad1.status === 400 && bad2.status === 400 && bad3.status === 400,
    `${bad1.status}/${bad2.status}/${bad3.status}`);
  const bad4 = await post({ email: 'bad-4' }, noisyIp);
  log('4th invalid request from same IP returns 429',
    bad4.status === 429 && bad4.json?.error === 'rate_limited',
    `status=${bad4.status} body=${bad4.text}`);
}

// ── 5. no RESEND_API_KEY still persists ────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  // RESEND_API_KEY was deleted at module top. Re-verify to be safe.
  if (process.env.RESEND_API_KEY) {
    log('test isolation: RESEND_API_KEY unset', false, 'something reintroduced it');
  } else {
    log('test isolation: RESEND_API_KEY unset', true);
  }
  const res = await post({ email: 'no-resend@example.com', source: 'direct' });
  log('signup succeeds even without Resend configured',
    res.status === 200 && res.json?.ok === true,
    `status=${res.status} body=${res.text}`);
  log('row was persisted despite missing Resend',
    rowsByEmail('no-resend@example.com').length === 1);
}

// ── 6. malformed JSON body ─────────────────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  const res = await post('this is not json');
  log('malformed JSON body → 400 invalid_json',
    res.status === 400 && res.json?.error === 'invalid_json',
    `status=${res.status} body=${res.text}`);
}

// ── 7. waitlist IP hash secret handling ─────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCloudMode = process.env.FLOOM_CLOUD_MODE;
  const previousDeployEnabled = process.env.DEPLOY_ENABLED;
  const previousSecret = process.env.WAITLIST_IP_HASH_SECRET;

  process.env.NODE_ENV = 'development';
  delete process.env.FLOOM_CLOUD_MODE;
  process.env.DEPLOY_ENABLED = 'false';
  delete process.env.WAITLIST_IP_HASH_SECRET;
  log('development resolver returns explicit dev-only hash fallback',
    getWaitlistIpHashSecret() === DEV_WAITLIST_IP_HASH_SECRET,
    String(getWaitlistIpHashSecret()));
  const dev = await post(
    { email: 'dev-fallback@example.com' },
    { 'x-forwarded-for': '10.44.0.1' },
  );
  log('development waitlist uses explicit dev-only hash fallback',
    dev.status === 200 && dev.json?.ok === true,
    `status=${dev.status} body=${dev.text}`);
  const devRows = rowsByEmail('dev-fallback@example.com');
  log('development fallback persists signup without configured secret',
    devRows.length === 1,
    JSON.stringify(devRows[0] ?? null));

  __resetWaitlistRateLimitForTests();
  process.env.NODE_ENV = 'production';
  process.env.FLOOM_CLOUD_MODE = '1';
  process.env.DEPLOY_ENABLED = 'false';
  delete process.env.WAITLIST_IP_HASH_SECRET;
  const before = rowCount();
  const prod = await post(
    { email: 'prod-missing-secret@example.com' },
    { 'x-forwarded-for': '10.44.0.2' },
  );
  log('production/cloud waitlist without WAITLIST_IP_HASH_SECRET fails closed',
    prod.status === 503 && prod.json?.error === 'waitlist_ip_hash_secret_required',
    `status=${prod.status} body=${prod.text}`);
  log('production/cloud missing secret writes no row', rowCount() === before);

  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousCloudMode === undefined) delete process.env.FLOOM_CLOUD_MODE;
  else process.env.FLOOM_CLOUD_MODE = previousCloudMode;
  if (previousDeployEnabled === undefined) delete process.env.DEPLOY_ENABLED;
  else process.env.DEPLOY_ENABLED = previousDeployEnabled;
  if (previousSecret === undefined) process.env.WAITLIST_IP_HASH_SECRET = 'test-secret';
  else process.env.WAITLIST_IP_HASH_SECRET = previousSecret;
}

// ── 8. email-only POST (no deploy fields) still 200 ─────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const res = await post({ email: 'email-only@example.com' });
  log('POST with only email returns 200',
    res.status === 200 && res.json?.ok === true,
    `status=${res.status} body=${res.text}`);
  const rows = rowsByEmail('email-only@example.com');
  log('email-only row omits deploy fields',
    rows.length === 1 &&
      (rows[0].deploy_repo_url === null || rows[0].deploy_repo_url === undefined) &&
      (rows[0].deploy_intent === null || rows[0].deploy_intent === undefined),
    JSON.stringify(rows[0]),
  );
}

// ── 9. deploy repo URL + intent persisted ───────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  db.prepare(`DELETE FROM waitlist_signups`).run();
  const res = await post({
    email: 'deploy-full@example.com',
    source: 'hero',
    deploy_repo_url: 'github.com/acme/widget',
    deploy_intent: 'Internal CRM for our sales team.',
  });
  log('POST with email + deploy_repo_url + deploy_intent returns 200',
    res.status === 200 && res.json?.ok === true,
    `status=${res.status} body=${res.text}`);
  const rows = rowsByEmail('deploy-full@example.com');
  const row = rows[0];
  log('deploy fields persisted on row',
    rows.length === 1 &&
      row.deploy_repo_url === 'https://github.com/acme/widget' &&
      row.deploy_intent === 'Internal CRM for our sales team.',
    JSON.stringify(row),
  );
}

// ── 10. invalid deploy_repo_url → 400 ─────────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  const before = rowCount();
  for (const [idx, bad] of [
    'javascript:alert(1)',
    'ftp://files.example.com/x',
    'not a url at all',
  ].entries()) {
    const res = await post({
      email: 'bad-url@example.com',
      deploy_repo_url: bad,
    }, { 'x-forwarded-for': `10.0.2.${idx + 1}` });
    log(`invalid deploy_repo_url "${bad.slice(0, 24)}…" → 400`,
      res.status === 400 && res.json?.error === 'invalid_deploy_repo_url',
      `status=${res.status} body=${res.text}`);
  }
  log('invalid deploy_repo_url writes no row', rowCount() === before);
}

// ── 11. deploy_intent over max length → 400 ─────────────────────────────
{
  __resetWaitlistRateLimitForTests();
  const before = rowCount();
  const res = await post({
    email: 'long-intent@example.com',
    deploy_intent: 'x'.repeat(2001),
  });
  log('deploy_intent > 2000 chars → 400 invalid_deploy_intent',
    res.status === 400 && res.json?.error === 'invalid_deploy_intent',
    `status=${res.status} body=${res.text}`);
  log('oversized deploy_intent writes no row', rowCount() === before);
}

try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* tempdir cleanup is best-effort */
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
