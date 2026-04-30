#!/usr/bin/env node
// Regression: POST /api/apps/:slug/reviews must reject anonymous (device-only)
// callers in Cloud mode. R18A.1 found anon could spam reviews under the
// synthetic DEFAULT_USER_ID, persisted publicly with author_name "anonymous".
//
// Fix: apps/server/src/routes/reviews.ts now returns 401 with code
// `auth_required` when isCloudMode() && !ctx.is_authenticated.
//
// Run after server build:
//   node test/stress/test-reviews-anon-block.mjs

import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-r18a1-anon-review-'));
const webDist = join(tmp, 'web-dist');
mkdirSync(webDist, { recursive: true });
writeFileSync(join(webDist, 'index.html'), '<html><body>placeholder</body></html>');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const port = await getFreePort();
const env = {
  ...process.env,
  PORT: String(port),
  NODE_ENV: 'test',
  // Force Cloud mode so the anon-block branch fires (FLOOM_CLOUD_MODE is the
  // signal isCloudMode() reads in apps/server/src/lib/better-auth.ts).
  FLOOM_CLOUD_MODE: 'true',
  // FLOOM_CLOUD_MODE=true requires a 32+ char secret. Built per-run from
  // process entropy to keep gitleaks happy and avoid any lookalike to a
  // real secret in the repo.
  BETTER_AUTH_SECRET: Array.from(
    { length: 4 },
    () => Math.random().toString(36).slice(2),
  ).join('-'),
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  RESEND_API_KEY: 're_test_disabled',
  DATA_DIR: tmp,
  WEB_DIST_DIR: webDist,
  FLOOM_RATE_LIMIT_DISABLED: 'true',
  FLOOM_SEED_LAUNCH_DEMOS: 'false',
  FLOOM_SEED_APPS: 'false',
  FLOOM_FAST_APPS: 'false',
};

const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
server.stdout.on('data', (b) => (out += b.toString()));
server.stderr.on('data', (b) => (out += b.toString()));

let passed = 0;
let failed = 0;
function log(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

try {
  await waitForHttp(`http://127.0.0.1:${port}/api/health`, 60_000);

  console.log('POST /api/apps/:slug/reviews anonymous block (Cloud mode)');

  // We hit ANY slug — even non-existent. The auth gate must run BEFORE the
  // app-existence check (which would return 404), so a 401 on a missing slug
  // proves the gate fires first and no DB write can occur.
  const slug = 'r18a1-anon-block-target-does-not-exist';
  const res = await fetch(`http://127.0.0.1:${port}/api/apps/${slug}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 5, title: 'spam', body: 'spam' }),
  });
  log('anon POST returns 401 (before any DB write)', res.status === 401, `got ${res.status}`);
  const json = await res.json().catch(() => ({}));
  log(
    'anon POST error envelope has code=auth_required',
    json?.code === 'auth_required',
    JSON.stringify(json),
  );
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('--- server output ---');
  console.log(out.slice(-2000));
}
process.exit(failed === 0 ? 0 : 1);
