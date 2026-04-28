#!/usr/bin/env node
// R15be — get_app_logs MCP tool stress test.
//
// Verifies (a) tool appears in tools/list when authed, (b) returns logs
// for an owned slug, (c) returns empty logs (no error) for a slug not
// owned by the caller's workspace, (d) honors limit + since params.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-mcp-get-app-logs-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
process.env.FLOOM_RATE_LIMIT_USER_PER_HOUR = '1000';
process.env.FLOOM_RATE_LIMIT_IP_PER_HOUR = '1000';
delete process.env.FLOOM_CLOUD_MODE;
delete process.env.FLOOM_AUTH_TOKEN;
delete process.env.FLOOM_RATE_LIMIT_DISABLED;

const { db } = await import('../../apps/server/dist/db.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');

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

async function bootServer() {
  const port = await getFreePort();
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
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
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

async function callMcp(port, token, name, args) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  let payload = null;
  const raw = json?.result?.content?.[0]?.text;
  try {
    payload = JSON.parse(raw);
  } catch {}
  return { res, text, json, payload };
}

async function listMcpTools(port, token) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {},
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

function createUser(id, workspaceId) {
  db.prepare(
    `INSERT INTO workspaces (id, slug, name, plan)
     VALUES (?, ?, ?, 'oss')
     ON CONFLICT(id) DO NOTHING`,
  ).run(workspaceId, workspaceId, workspaceId);
  db.prepare(
    `INSERT INTO users (id, workspace_id, email, name, auth_provider)
     VALUES (?, ?, ?, ?, 'test')
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, workspaceId, `${id}@example.com`, id);
  db.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES (?, ?, 'admin')
     ON CONFLICT(workspace_id, user_id) DO NOTHING`,
  ).run(workspaceId, id);
}

function createToken({ id, userId, workspaceId, scope, rateLimit = 1000 }) {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    id,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    id,
    scope,
    workspaceId,
    userId,
    new Date().toISOString(),
    rateLimit,
  );
  return raw;
}

function insertApp({ id, slug, name, visibility, author, workspaceId, baseUrl }) {
  const spec = {
    openapi: '3.0.0',
    info: { title: name, version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/echo': {
        get: {
          operationId: 'echo',
          parameters: [
            { name: 'message', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  };
  const manifest = {
    name,
    description: `${name} test fixture`,
    runtime: 'python',
    manifest_version: '2.0',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    actions: {
      echo: {
        label: 'Echo',
        description: 'Echo a message',
        inputs: [{ name: 'message', type: 'text', label: 'Message', required: true }],
        outputs: [{ name: 'response', type: 'json', label: 'Response' }],
        secrets_needed: [],
      },
    },
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, docker_image, code_path,
        category, author, icon, app_type, base_url, auth_type, auth_config,
        openapi_spec_url, openapi_spec_cached, visibility, is_async, webhook_url,
        timeout_ms, retries, async_mode, workspace_id, publish_status)
     VALUES (?, ?, ?, ?, ?, 'active', NULL, '', 'testing', ?, NULL, 'proxied',
        ?, NULL, NULL, NULL, ?, ?, 0, NULL, NULL, 0, NULL, ?, 'published')`,
  ).run(
    id,
    slug,
    name,
    `${name} test fixture`,
    JSON.stringify(manifest),
    author,
    baseUrl,
    JSON.stringify(spec),
    visibility,
    workspaceId,
  );
}

function insertRun({ id, appId, workspaceId, userId, startedAt, status, inputs, outputs, durationMs }) {
  db.prepare(
    `INSERT INTO runs
       (id, app_id, action, inputs, outputs, status, workspace_id, user_id, device_id, duration_ms, started_at, finished_at)
     VALUES (?, ?, 'echo', ?, ?, ?, ?, ?, 'test-device', ?, ?, ?)`,
  ).run(
    id,
    appId,
    inputs ?? null,
    outputs ?? null,
    status,
    workspaceId,
    userId,
    durationMs ?? null,
    startedAt,
    startedAt,
  );
}

console.log('MCP get_app_logs');

const upstream = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});
const upstreamPort = await new Promise((resolve) => {
  upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port));
});
const baseUrl = `http://127.0.0.1:${upstreamPort}`;

createUser('owner-user', 'owner-ws');
createUser('other-user', 'other-ws');
insertApp({
  id: 'app_owned_logs',
  slug: 'owned-logs',
  name: 'Owned Logs App',
  visibility: 'public',
  author: 'owner-user',
  workspaceId: 'owner-ws',
  baseUrl,
});
insertApp({
  id: 'app_other_logs',
  slug: 'other-logs',
  name: 'Other Logs App',
  visibility: 'private',
  author: 'other-user',
  workspaceId: 'other-ws',
  baseUrl,
});

// 5 runs for owned app, spaced over 5 days
const longInput = 'x'.repeat(120); // > 80 chars to verify truncation
const longOutput = 'y'.repeat(150);
for (let i = 0; i < 5; i++) {
  const day = new Date(Date.UTC(2026, 3, 20 + i, 12, 0, 0)).toISOString();
  insertRun({
    id: `run_owned_${i}`,
    appId: 'app_owned_logs',
    workspaceId: 'owner-ws',
    userId: 'owner-user',
    startedAt: day,
    status: i === 4 ? 'error' : 'success',
    inputs: JSON.stringify({ message: longInput }),
    outputs: JSON.stringify({ response: longOutput }),
    durationMs: 100 * (i + 1),
  });
}
// 1 run for the other workspace's app
insertRun({
  id: 'run_other_0',
  appId: 'app_other_logs',
  workspaceId: 'other-ws',
  userId: 'other-user',
  startedAt: '2026-04-25T00:00:00.000Z',
  status: 'success',
  inputs: '{}',
  outputs: '{"ok":true}',
  durationMs: 50,
});
db.pragma('wal_checkpoint(TRUNCATE)');

const ownerToken = createToken({
  id: 'agtok_owner_logs',
  userId: 'owner-user',
  workspaceId: 'owner-ws',
  // read-write scope sees the largest tool surface (run + studio + account)
  // so we can assert the new tool is exposed. Read-only also exposes
  // get_app_logs because it lives in the canUseRunTools block, which
  // both read and read-write satisfy.
  scope: 'read-write',
});

const server = await bootServer();

try {
  // (a) tools/list shows get_app_logs
  const tools = await listMcpTools(server.port, ownerToken);
  const toolNames = (tools.json?.result?.tools || []).map((t) => t.name);
  log(
    'tools/list (authed) includes get_app_logs',
    toolNames.includes('get_app_logs'),
    JSON.stringify(toolNames.slice(0, 50)),
  );
  log(
    'tools/list (authed) total tool count >= 39',
    toolNames.length >= 39,
    `count=${toolNames.length}`,
  );

  // (b) returns logs for owned slug
  const owned = await callMcp(server.port, ownerToken, 'get_app_logs', {
    slug: 'owned-logs',
  });
  log(
    'owned slug returns 5 logs',
    Array.isArray(owned.payload?.logs) && owned.payload.logs.length === 5,
    JSON.stringify(owned.payload),
  );
  log(
    'owned slug total = 5',
    owned.payload?.total === 5,
    JSON.stringify(owned.payload?.total),
  );
  log(
    'logs ordered most recent first',
    owned.payload?.logs?.[0]?.run_id === 'run_owned_4',
    JSON.stringify(owned.payload?.logs?.map((l) => l.run_id)),
  );
  log(
    'log row has expected shape',
    owned.payload?.logs?.[0] &&
      typeof owned.payload.logs[0].run_id === 'string' &&
      typeof owned.payload.logs[0].ts === 'string' &&
      typeof owned.payload.logs[0].status === 'string' &&
      typeof owned.payload.logs[0].url === 'string' &&
      owned.payload.logs[0].url.includes('/r/run_owned_4'),
    JSON.stringify(owned.payload?.logs?.[0]),
  );
  log(
    'input_summary truncated to <= 81 chars (80 + ellipsis)',
    typeof owned.payload?.logs?.[0]?.input_summary === 'string' &&
      owned.payload.logs[0].input_summary.length <= 81 &&
      owned.payload.logs[0].input_summary.length >= 80,
    `len=${owned.payload?.logs?.[0]?.input_summary?.length}`,
  );

  // (c) unowned slug returns empty array (NOT an error)
  const unowned = await callMcp(server.port, ownerToken, 'get_app_logs', {
    slug: 'other-logs',
  });
  log(
    'unowned slug returns empty logs array (no error)',
    unowned.json?.result?.isError !== true &&
      Array.isArray(unowned.payload?.logs) &&
      unowned.payload.logs.length === 0,
    JSON.stringify(unowned.payload),
  );
  log(
    'unowned slug total = 0',
    unowned.payload?.total === 0,
    JSON.stringify(unowned.payload),
  );

  // Nonexistent slug also returns empty (helpful, not 404)
  const nope = await callMcp(server.port, ownerToken, 'get_app_logs', {
    slug: 'definitely-not-a-real-slug',
  });
  log(
    'nonexistent slug returns empty logs (no error)',
    nope.json?.result?.isError !== true &&
      Array.isArray(nope.payload?.logs) &&
      nope.payload.logs.length === 0,
    JSON.stringify(nope.payload),
  );

  // (d) honors limit
  const limited = await callMcp(server.port, ownerToken, 'get_app_logs', {
    slug: 'owned-logs',
    limit: 2,
  });
  log(
    'limit=2 returns exactly 2 logs',
    Array.isArray(limited.payload?.logs) && limited.payload.logs.length === 2,
    JSON.stringify(limited.payload?.logs?.length),
  );
  log(
    'limit=2 still reports total = 5',
    limited.payload?.total === 5,
    JSON.stringify(limited.payload?.total),
  );

  // (d2) honors since (only runs after the cutoff)
  const since = await callMcp(server.port, ownerToken, 'get_app_logs', {
    slug: 'owned-logs',
    since: '2026-04-23T00:00:00.000Z',
  });
  log(
    'since filter returns only newer runs',
    Array.isArray(since.payload?.logs) && since.payload.logs.length === 2,
    JSON.stringify(since.payload?.logs?.map((l) => l.run_id)),
  );

  // Sanity: studio_publish_app would be in studio scope; we don't test
  // the publish flow here (covered separately). But verify list_my_runs
  // still works (no regression).
  const myRuns = await callMcp(server.port, ownerToken, 'list_my_runs', {
    slug: 'owned-logs',
    limit: 3,
  });
  log(
    'list_my_runs still works (no regression)',
    Array.isArray(myRuns.payload?.runs),
    JSON.stringify(myRuns.payload?.runs?.length),
  );
} finally {
  await stopServer(server);
  upstream.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
