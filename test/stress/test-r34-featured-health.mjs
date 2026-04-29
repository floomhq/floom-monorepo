#!/usr/bin/env node
// Regression guard: GET /api/admin/featured-health returns a structured list
// of featured apps with their health status (ok / broken / error).
//
// Covers fix #4 from the r34 codex audit: no runtime health-check existed
// for featured apps — broken ones stayed visible in the catalog until a human
// noticed.
//
// Run: node test/stress/test-r34-featured-health.mjs
// Prereq: pnpm run build

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-r34-featured-health-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

const ADMIN_TOKEN = 'test-admin-token-r34';

process.env.DATA_DIR = dataDir;
process.env.FLOOM_AUTH_TOKEN = ADMIN_TOKEN;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
process.env.FLOOM_RATE_LIMIT_USER_PER_HOUR = '1000';
process.env.FLOOM_RATE_LIMIT_IP_PER_HOUR = '1000';
delete process.env.FLOOM_CLOUD_MODE;

const { db } = await import('../../apps/server/dist/db.js');

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

async function getFreePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate port')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message || 'no response'}`);
}

async function bootServer(port) {
  const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHttp(`http://localhost:${port}/api/health`, 20_000);
  } catch (err) {
    proc.kill('SIGTERM');
    throw new Error(`${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { port, proc };
}

async function stopServer(server) {
  server.proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 150));
}

console.log('r34 fix #4: /api/admin/featured-health');

// Seed workspace + users
db.prepare(
  `INSERT INTO workspaces (id, slug, name, plan) VALUES ('ws-r34h', 'ws-r34h', 'ws-r34h', 'oss') ON CONFLICT(id) DO NOTHING`,
).run();
db.prepare(
  `INSERT INTO users (id, workspace_id, email, name, auth_provider) VALUES ('u-r34h', 'ws-r34h', 'r34h@example.com', 'r34h', 'test') ON CONFLICT(id) DO NOTHING`,
).run();

const manifest = JSON.stringify({
  name: 'Featured Test',
  description: 'test',
  runtime: 'python',
  manifest_version: '2.0',
  secrets_needed: [],
  actions: { run: { label: 'Run', description: '', inputs: [], outputs: [], secrets_needed: [] } },
});

// App 1: featured + active + published → should be 'ok'
db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, app_type, base_url, code_path,
      visibility, workspace_id, author, publish_status, featured)
   VALUES ('app-r34h-ok', 'r34h-featured-ok', 'R34H Featured OK', 'test', ?, 'active', 'proxied',
      'http://127.0.0.1:9', '', 'public', 'ws-r34h', 'u-r34h', 'published', 1)`,
).run(manifest);

// App 2: featured but status='build_failed' → should be 'broken'
db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, app_type, base_url, code_path,
      visibility, workspace_id, author, publish_status, featured)
   VALUES ('app-r34h-broken', 'r34h-featured-broken', 'R34H Featured Broken', 'test', ?, 'build_failed',
      'proxied', 'http://127.0.0.1:9', '', 'public', 'ws-r34h', 'u-r34h', 'published', 1)`,
).run(manifest);

// App 3: featured but not published → should be 'broken'
db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, app_type, base_url, code_path,
      visibility, workspace_id, author, publish_status, featured)
   VALUES ('app-r34h-draft', 'r34h-featured-draft', 'R34H Featured Draft', 'test', ?, 'active',
      'proxied', 'http://127.0.0.1:9', '', 'public', 'ws-r34h', 'u-r34h', 'draft', 1)`,
).run(manifest);

// App 4: NOT featured, active + published → must NOT appear
db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, app_type, base_url, code_path,
      visibility, workspace_id, author, publish_status, featured)
   VALUES ('app-r34h-nonfeatured', 'r34h-nonfeatured', 'R34H Non-Featured', 'test', ?, 'active',
      'proxied', 'http://127.0.0.1:9', '', 'public', 'ws-r34h', 'u-r34h', 'published', 0)`,
).run(manifest);
db.pragma('wal_checkpoint(TRUNCATE)');

const port = await getFreePort();
const server = await bootServer(port);

const BASE = `http://localhost:${port}`;

// 1. Unauthenticated → 401
const unauth = await fetch(`${BASE}/api/admin/featured-health`);
log('unauthenticated request returns 401', unauth.status === 401, `got ${unauth.status}`);

// 2. Authenticated → 200 with results
const auth = await fetch(`${BASE}/api/admin/featured-health`, {
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});
const body = await auth.json().catch(() => null);
log('authenticated request returns 200', auth.status === 200, `got ${auth.status}: ${JSON.stringify(body)}`);
log('response has results array', Array.isArray(body?.results), JSON.stringify(body));
log('response has checked_at', typeof body?.checked_at === 'string', JSON.stringify(body));
log('response has total count', typeof body?.total === 'number', JSON.stringify(body));

// 3. Only featured apps included
const slugs = (body?.results || []).map((r) => r.slug);
log('featured active published app included', slugs.includes('r34h-featured-ok'), JSON.stringify(slugs));
log('featured broken app included', slugs.includes('r34h-featured-broken'), JSON.stringify(slugs));
log('featured draft app included', slugs.includes('r34h-featured-draft'), JSON.stringify(slugs));
log('non-featured app NOT included', !slugs.includes('r34h-nonfeatured'), JSON.stringify(slugs));

// 4. Status values are correct
const okResult = (body?.results || []).find((r) => r.slug === 'r34h-featured-ok');
const brokenResult = (body?.results || []).find((r) => r.slug === 'r34h-featured-broken');
const draftResult = (body?.results || []).find((r) => r.slug === 'r34h-featured-draft');
log(
  'active+published app has status ok or error (probe reached server)',
  okResult && (okResult.status === 'ok' || okResult.status === 'error'),
  JSON.stringify(okResult),
);
log(
  'build_failed app reports broken status',
  brokenResult && brokenResult.status === 'broken',
  JSON.stringify(brokenResult),
);
log(
  'draft app reports broken status',
  draftResult && draftResult.status === 'broken',
  JSON.stringify(draftResult),
);

// 5. latencyMs is a number on every result
const allHaveLatency = (body?.results || []).every((r) => typeof r.latencyMs === 'number');
log('all results have numeric latencyMs', allHaveLatency, JSON.stringify(body?.results));

// 6. broken count matches
const brokenCount = (body?.results || []).filter((r) => r.status !== 'ok').length;
log(
  'broken field matches non-ok count',
  body?.broken === brokenCount,
  `body.broken=${body?.broken}, computed=${brokenCount}`,
);

await stopServer(server);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
