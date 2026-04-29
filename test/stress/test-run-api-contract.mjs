#!/usr/bin/env node
// Run API launch contract regressions:
// - non-empty run bodies must be JSON (`Content-Type: application/json`)
// - `/api/me/runs` supports deterministic offset pagination
//
// Run: node test/stress/test-run-api-contract.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-run-api-contract-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.BETTER_AUTH_URL = 'http://localhost:3051';

const { Hono } = await import('../../apps/server/node_modules/hono/dist/hono.js');
const { db, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } = await import('../../apps/server/dist/db.js');
const { runRouter, slugRunRouter, meRouter } = await import('../../apps/server/dist/routes/run.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');
const byokGate = await import('../../apps/server/dist/lib/byok-gate.js');
const rateLimit = await import('../../apps/server/dist/lib/rate-limit.js');

const app = new Hono();
app.use('*', agentTokens.agentTokenAuthMiddleware);
app.use('*', agentTokens.agentTokenHttpScopeMiddleware);
app.route('/api/run', runRouter);
app.route('/api/me', meRouter);
app.route('/api/:slug/run', slugRunRouter);

let passed = 0;
let failed = 0;

function log(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (token) h.set('authorization', `Bearer ${token}`);
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: h,
      body,
    }),
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Leave as null.
  }
  return { status: res.status, text, json, headers: res.headers };
}

function mintAgentToken() {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, 'run-api-contract', 'read-write', ?, ?, ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_run_api_contract_${Date.now()}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    DEFAULT_WORKSPACE_ID,
    DEFAULT_USER_ID,
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

function seedAppAndRuns() {
  const manifest = {
    name: 'Contract App',
    description: 'Run API contract fixture',
    runtime: 'python',
    actions: {
      run: {
        label: 'Run',
        inputs: [],
        outputs: [],
      },
    },
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, app_type,
        author, workspace_id, visibility, publish_status, is_async)
     VALUES ('app_run_api_contract', 'contract-app', 'Contract App',
        'Run API contract fixture', ?, 'active', 'proxied:contract-app',
        'proxied', ?, ?, 'public', 'published', 1)`,
  ).run(JSON.stringify(manifest), DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID);

  for (let i = 0; i < 5; i++) {
    db.prepare(
      `INSERT INTO runs
         (id, app_id, action, status, inputs, outputs, duration_ms,
          started_at, finished_at, workspace_id, user_id, device_id)
       VALUES (?, 'app_run_api_contract', 'run', 'success', '{}', '{}', 1,
          ?, ?, ?, ?, ?)`,
    ).run(
      `run_contract_${i}`,
      `2026-04-29T05:00:0${4 - i}.000Z`,
      `2026-04-29T05:00:0${4 - i}.000Z`,
      DEFAULT_WORKSPACE_ID,
      DEFAULT_USER_ID,
      DEFAULT_USER_ID,
    );
  }
}

function seedByokApp() {
  const manifest = {
    name: 'Competitor Lens',
    description: 'BYOK contract fixture',
    runtime: 'python',
    manifest_version: '2.0',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: ['GEMINI_API_KEY'],
    actions: {
      run: {
        label: 'Run',
        inputs: [],
        outputs: [],
        secrets_needed: ['GEMINI_API_KEY'],
      },
    },
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, app_type,
        base_url, author, workspace_id, visibility, publish_status)
     VALUES ('app_run_api_byok_contract', 'competitor-lens', 'Competitor Lens',
        'BYOK contract fixture', ?, 'active', '', 'proxied',
        'http://127.0.0.1:9', ?, ?, 'public', 'published')`,
  ).run(JSON.stringify(manifest), DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID);
}

function seedRateLimitedApp() {
  const manifest = {
    name: 'Rate Contract App',
    description: 'Run API rate-limit fixture',
    runtime: 'python',
    manifest_version: '2.0',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    actions: {
      run: {
        label: 'Run',
        inputs: [],
        outputs: [],
        secrets_needed: [],
      },
    },
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, app_type,
        base_url, author, workspace_id, visibility, publish_status,
        run_rate_limit_per_hour)
     VALUES ('app_run_api_rate_contract', 'rate-contract-app', 'Rate Contract App',
        'Run API rate-limit fixture', ?, 'active', '', 'proxied',
        'http://127.0.0.1:9', ?, ?, 'public', 'published', 1)`,
  ).run(JSON.stringify(manifest), DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID);
}

function exhaustByokQuota(slug, userAgent) {
  byokGate.__resetByokGateForTests();
  const uaHash = byokGate.hashUserAgent(userAgent);
  for (let i = 0; i < 5; i++) {
    byokGate.recordFreeRun('unknown', slug, Date.now(), uaHash);
  }
}

const OWN_GEMINI_KEY = `AIza${'X'.repeat(36)}`;

console.log('Run API contract');

try {
  seedAppAndRuns();
  seedByokApp();
  seedRateLimitedApp();
  const token = mintAgentToken();

  const missingType = await request('/api/run', {
    method: 'POST',
    token,
    body: JSON.stringify({ app_slug: 'contract-app', inputs: {} }),
  });
  log(
    'POST /api/run rejects non-empty body without Content-Type',
    missingType.status === 415 && missingType.json?.code === 'unsupported_media_type',
    missingType.text,
  );

  const textPlain = await request('/api/contract-app/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ inputs: {} }),
  });
  log(
    'POST /api/:slug/run rejects text/plain JSON body',
    textPlain.status === 415 && textPlain.json?.code === 'unsupported_media_type',
    textPlain.text,
  );

  const firstPage = await request('/api/me/runs?limit=2', { token });
  const secondPage = await request('/api/me/runs?limit=2&offset=2', { token });
  const firstIds = (firstPage.json?.runs || []).map((r) => r.id);
  const secondIds = (secondPage.json?.runs || []).map((r) => r.id);
  log('first page returns newest two runs', firstIds.join(',') === 'run_contract_0,run_contract_1', firstPage.text);
  log('offset page returns next two runs', secondIds.join(',') === 'run_contract_2,run_contract_3', secondPage.text);
  log(
    'offset page differs from first page',
    firstIds.length === 2 && secondIds.length === 2 && firstIds.every((id) => !secondIds.includes(id)),
    `${firstIds.join(',')} vs ${secondIds.join(',')}`,
  );

  const validJson = await request('/api/contract-app/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ inputs: {} }),
  });
  log(
    'POST /api/:slug/run still accepts valid JSON bodies',
    validJson.status === 200 && typeof validJson.json?.run_id === 'string',
    validJson.text,
  );

  const userAgent = 'floom-run-api-contract';
  const apiRunHeaders = {
    'content-type': 'application/json',
    'user-agent': userAgent,
  };

  exhaustByokQuota('competitor-lens', userAgent);
  const apiRunNoByok = await request('/api/run', {
    method: 'POST',
    token,
    headers: apiRunHeaders,
    body: JSON.stringify({ app_slug: 'competitor-lens', inputs: {} }),
  });
  log(
    'POST /api/run returns structured byok_required after free quota exhaustion',
    apiRunNoByok.status === 429 &&
      apiRunNoByok.json?.error === 'byok_required' &&
      apiRunNoByok.json?.usage === 5,
    apiRunNoByok.text,
  );

  const apiRunWithByok = await request('/api/run', {
    method: 'POST',
    token,
    headers: { ...apiRunHeaders, 'x-user-api-key': OWN_GEMINI_KEY },
    body: JSON.stringify({ app_slug: 'competitor-lens', inputs: {} }),
  });
  log(
    'POST /api/run accepts x-user-api-key after free quota exhaustion',
    apiRunWithByok.status === 200 && typeof apiRunWithByok.json?.run_id === 'string',
    apiRunWithByok.text,
  );

  exhaustByokQuota('competitor-lens', userAgent);
  const slugRunNoByok = await request('/api/competitor-lens/run', {
    method: 'POST',
    token,
    headers: apiRunHeaders,
    body: JSON.stringify({ inputs: {} }),
  });
  log(
    'POST /api/:slug/run returns structured byok_required after free quota exhaustion',
    slugRunNoByok.status === 429 &&
      slugRunNoByok.json?.error === 'byok_required' &&
      slugRunNoByok.json?.usage === 5,
    slugRunNoByok.text,
  );

  const slugRunWithByok = await request('/api/competitor-lens/run', {
    method: 'POST',
    token,
    headers: { ...apiRunHeaders, 'x-user-api-key': OWN_GEMINI_KEY },
    body: JSON.stringify({ inputs: {} }),
  });
  log(
    'POST /api/:slug/run accepts x-user-api-key after free quota exhaustion',
    slugRunWithByok.status === 200 && typeof slugRunWithByok.json?.run_id === 'string',
    slugRunWithByok.text,
  );

  rateLimit.__resetStoreForTests();
  await request('/api/rate-contract-app/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: {} }),
  });
  const slugRateLimited = await request('/api/rate-contract-app/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: {} }),
  });
  log(
    'POST /api/:slug/run app-rate 429 is structured JSON',
    slugRateLimited.status === 429 &&
      slugRateLimited.json?.error === 'rate_limit_exceeded' &&
      slugRateLimited.json?.scope === 'app' &&
      typeof slugRateLimited.json?.retry_after_seconds === 'number',
    slugRateLimited.text,
  );
  log(
    'POST /api/:slug/run app-rate 429 includes standard rate-limit headers',
    slugRateLimited.headers.get('retry-after') &&
      slugRateLimited.headers.get('x-ratelimit-limit') === '1' &&
      slugRateLimited.headers.get('x-ratelimit-remaining') === '0' &&
      slugRateLimited.headers.get('x-ratelimit-scope') === 'app',
    slugRateLimited.text,
  );

  rateLimit.__resetStoreForTests();
  await request('/api/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_slug: 'rate-contract-app', inputs: {} }),
  });
  const canonicalRateLimited = await request('/api/run', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_slug: 'rate-contract-app', inputs: {} }),
  });
  log(
    'POST /api/run app-rate 429 is structured JSON',
    canonicalRateLimited.status === 429 &&
      canonicalRateLimited.json?.error === 'rate_limit_exceeded' &&
      canonicalRateLimited.json?.scope === 'app' &&
      typeof canonicalRateLimited.json?.retry_after_seconds === 'number',
    canonicalRateLimited.text,
  );
  log(
    'POST /api/run app-rate 429 includes standard rate-limit headers',
    canonicalRateLimited.headers.get('retry-after') &&
      canonicalRateLimited.headers.get('x-ratelimit-limit') === '1' &&
      canonicalRateLimited.headers.get('x-ratelimit-remaining') === '0' &&
      canonicalRateLimited.headers.get('x-ratelimit-scope') === 'app',
    canonicalRateLimited.text,
  );
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
