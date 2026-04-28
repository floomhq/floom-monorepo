#!/usr/bin/env node
// Regression test for REST async job owner gates:
// GET /api/:slug/jobs/:job_id and POST /api/:slug/jobs/:job_id/cancel
// must not expose or mutate another caller's job by id.

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from '../../apps/server/node_modules/hono/dist/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'floom-jobs-rest-auth-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
delete process.env.FLOOM_CLOUD_MODE;
delete process.env.FLOOM_AUTH_TOKEN;

const { db } = await import('../../apps/server/dist/db.js');
const { jobsRouter } = await import('../../apps/server/dist/routes/jobs.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');
const { agentTokenAuthMiddleware } = agentTokens;

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

const app = new Hono();
app.use('/api/*', agentTokenAuthMiddleware);
app.route('/api/:slug/jobs', jobsRouter);

function seedAsyncApp(slug) {
  const id = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const manifest = JSON.stringify({
    manifest_version: '2.0',
    name: slug,
    description: `${slug} app`,
    actions: {
      run: {
        label: 'Run',
        description: 'run',
        inputs: [],
        outputs: [],
      },
    },
  });
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, app_type,
        is_async, visibility, workspace_id, author)
     VALUES (?, ?, ?, ?, ?, 'active', 'proxied:test', 'proxied',
        1, 'public', 'ws_acl', 'alice')`,
  ).run(id, slug, slug, `${slug} app`, manifest);
  return id;
}

function seedUserAndWorkspace(userId, workspaceId = 'ws_acl') {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, slug, name, plan)
     VALUES (?, ?, ?, 'cloud_free')`,
  ).run(workspaceId, workspaceId, workspaceId);
  db.prepare(
    `INSERT OR IGNORE INTO users (id, workspace_id, email, name, auth_provider, auth_subject)
     VALUES (?, ?, ?, ?, 'test', ?)`,
  ).run(userId, workspaceId, `${userId}@example.test`, userId, userId);
  db.prepare(
    `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role)
     VALUES (?, ?, 'admin')`,
  ).run(workspaceId, userId);
}

function createAgentToken(userId, workspaceId = 'ws_acl') {
  seedUserAndWorkspace(userId, workspaceId);
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, ?, 'read-write', ?, ?, ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_${userId}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    `test-${userId}`,
    workspaceId,
    userId,
    new Date().toISOString(),
  );
  return raw;
}

async function fetchJson(method, path, headers = {}, body = undefined) {
  const init = { method, headers };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...headers };
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, json, text };
}

async function createJob(slug, headers) {
  return fetchJson('POST', `/api/${slug}/jobs`, headers, {
    action: 'run',
    inputs: {},
  });
}

function jobStatus(jobId) {
  return db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)?.status;
}

try {
  console.log('Jobs REST auth · owner gates for GET and cancel');
  const slug = 'job-rest-acl';
  seedAsyncApp(slug);

  const ownerCookie = { cookie: 'floom_device=dev-owner' };
  const otherCookie = { cookie: 'floom_device=dev-other' };
  const anonCreate = await createJob(slug, ownerCookie);
  const anonJobId = anonCreate.json?.job_id;

  log('anonymous owner creates job', anonCreate.status === 202 && typeof anonJobId === 'string', anonCreate.text);
  let r = await fetchJson('GET', `/api/${slug}/jobs/${anonJobId}`, otherCookie);
  log('cross-device anonymous GET returns 404', r.status === 404, `got ${r.status}: ${r.text}`);
  log('cross-device anonymous GET does not leak job id', r.text.indexOf(anonJobId) === -1, r.text);
  r = await fetchJson('POST', `/api/${slug}/jobs/${anonJobId}/cancel`, otherCookie);
  log('cross-device anonymous cancel returns 404', r.status === 404, `got ${r.status}: ${r.text}`);
  log('cross-device anonymous cancel leaves job queued', jobStatus(anonJobId) === 'queued', jobStatus(anonJobId));
  r = await fetchJson('GET', `/api/${slug}/jobs/${anonJobId}`, ownerCookie);
  log('anonymous owner GET returns 200', r.status === 200 && r.json?.id === anonJobId, `got ${r.status}: ${r.text}`);
  log('REST job response omits workspace_id', !Object.hasOwn(r.json || {}, 'workspace_id'), r.text);
  log('REST job response omits user_id', !Object.hasOwn(r.json || {}, 'user_id'), r.text);
  log('REST job response omits device_id', !Object.hasOwn(r.json || {}, 'device_id'), r.text);
  r = await fetchJson('POST', `/api/${slug}/jobs/${anonJobId}/cancel`, ownerCookie);
  log('anonymous owner cancel returns cancelled', r.status === 200 && r.json?.status === 'cancelled', `got ${r.status}: ${r.text}`);

  const aliceToken = createAgentToken('alice');
  const bobToken = createAgentToken('bob');
  const aliceHeaders = {
    authorization: `Bearer ${aliceToken}`,
    cookie: 'floom_device=dev-alice',
  };
  const bobHeaders = {
    authorization: `Bearer ${bobToken}`,
    cookie: 'floom_device=dev-bob',
  };
  const authedCreate = await createJob(slug, aliceHeaders);
  const authedJobId = authedCreate.json?.job_id;

  log('agent-token owner creates job', authedCreate.status === 202 && typeof authedJobId === 'string', authedCreate.text);
  r = await fetchJson('GET', `/api/${slug}/jobs/${authedJobId}`, bobHeaders);
  log('cross-user GET returns 404', r.status === 404, `got ${r.status}: ${r.text}`);
  log('cross-user GET does not leak job id', r.text.indexOf(authedJobId) === -1, r.text);
  r = await fetchJson('POST', `/api/${slug}/jobs/${authedJobId}/cancel`, bobHeaders);
  log('cross-user cancel returns 404', r.status === 404, `got ${r.status}: ${r.text}`);
  log('cross-user cancel leaves job queued', jobStatus(authedJobId) === 'queued', jobStatus(authedJobId));
  r = await fetchJson('GET', `/api/${slug}/jobs/${authedJobId}`, aliceHeaders);
  log('agent-token owner GET returns 200', r.status === 200 && r.json?.id === authedJobId, `got ${r.status}: ${r.text}`);
  r = await fetchJson('POST', `/api/${slug}/jobs/${authedJobId}/cancel`, aliceHeaders);
  log('agent-token owner cancel returns cancelled', r.status === 200 && r.json?.status === 'cancelled', `got ${r.status}: ${r.text}`);
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
