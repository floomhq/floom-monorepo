#!/usr/bin/env node
// Regression coverage for trigger listing tenant isolation.
// Same user, two workspaces, two tokens: REST and MCP list only the token's
// active workspace rows.

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-trigger-scope-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
delete process.env.FLOOM_CLOUD_MODE;
delete process.env.FLOOM_AUTH_TOKEN;

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

function insertWorkspace(id, slug) {
  db.prepare(
    `INSERT INTO workspaces (id, slug, name, plan)
     VALUES (?, ?, ?, 'oss')`,
  ).run(id, slug, slug);
}

function insertToken({ id, raw, workspaceId, userId }) {
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, ?, 'read-write', ?, ?, ?, NULL, NULL, 1000)`,
  ).run(
    id,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    id,
    workspaceId,
    userId,
    new Date().toISOString(),
  );
}

function insertApp({ id, slug, workspaceId, userId }) {
  const manifest = {
    name: slug,
    description: slug,
    actions: { run: { label: 'Run', inputs: [], outputs: [] } },
    runtime: 'python',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    manifest_version: '2.0',
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, code_path, app_type,
        workspace_id, author, is_async, status)
     VALUES (?, ?, ?, ?, ?, ?, 'proxied', ?, ?, 1, 'active')`,
  ).run(id, slug, slug, slug, JSON.stringify(manifest), `proxied:${slug}`, workspaceId, userId);
}

function insertTrigger({ id, appId, workspaceId, userId }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO triggers
       (id, app_id, user_id, workspace_id, action, inputs, trigger_type,
        cron_expression, tz, next_run_at, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'run', '{}', 'schedule', '*/5 * * * *', 'UTC',
        ?, 1, ?, ?)`,
  ).run(id, appId, userId, workspaceId, now + 60_000, now, now);
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

async function getRestTriggers(port, token) {
  const res = await fetch(`http://localhost:${port}/api/me/triggers`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

async function patchRestTrigger(port, token, triggerId) {
  const res = await fetch(`http://localhost:${port}/api/me/triggers/${triggerId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enabled: false }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

async function deleteRestTrigger(port, token, triggerId) {
  const res = await fetch(`http://localhost:${port}/api/me/triggers/${triggerId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

async function callMcpTriggerList(port, token) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'trigger_list', arguments: {} },
    }),
  });
  const text = await res.text();
  let json = null;
  let payload = null;
  try {
    json = JSON.parse(text);
    payload = JSON.parse(json?.result?.content?.[0]?.text);
  } catch {}
  return { res, text, json, payload };
}

function ids(rows) {
  return (rows || []).map((row) => row.id).sort();
}

console.log('trigger workspace scoping');

let server = null;
try {
  const userId = 'usr_trigger_scope';
  const wsA = 'ws_trigger_scope_a';
  const wsB = 'ws_trigger_scope_b';
  const tokenA = agentTokens.generateAgentToken();
  const tokenB = agentTokens.generateAgentToken();

  insertWorkspace(wsA, 'trigger-scope-a');
  insertWorkspace(wsB, 'trigger-scope-b');
  db.prepare(
    `INSERT INTO users (id, workspace_id, email, name, auth_provider)
     VALUES (?, ?, 'trigger-scope@example.com', 'Trigger Scope', 'test')`,
  ).run(userId, wsA);
  db.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES (?, ?, 'admin'), (?, ?, 'admin')`,
  ).run(wsA, userId, wsB, userId);
  insertToken({ id: 'agtok_trigger_scope_a', raw: tokenA, workspaceId: wsA, userId });
  insertToken({ id: 'agtok_trigger_scope_b', raw: tokenB, workspaceId: wsB, userId });
  insertApp({ id: 'app_trigger_scope_a', slug: 'trigger-scope-a', workspaceId: wsA, userId });
  insertApp({ id: 'app_trigger_scope_b', slug: 'trigger-scope-b', workspaceId: wsB, userId });
  insertTrigger({ id: 'tgr_trigger_scope_a', appId: 'app_trigger_scope_a', workspaceId: wsA, userId });
  insertTrigger({ id: 'tgr_trigger_scope_b', appId: 'app_trigger_scope_b', workspaceId: wsB, userId });
  db.pragma('wal_checkpoint(TRUNCATE)');

  server = await bootServer();
  log('server boots + /api/health = 200', true);

  const restA = await getRestTriggers(server.port, tokenA);
  const restB = await getRestTriggers(server.port, tokenB);
  log('REST token A returns 200', restA.res.status === 200, restA.text);
  log('REST token B returns 200', restB.res.status === 200, restB.text);
  log(
    'REST token A lists only workspace A trigger',
    JSON.stringify(ids(restA.json?.triggers)) === JSON.stringify(['tgr_trigger_scope_a']),
    restA.text,
  );
  log(
    'REST token B lists only workspace B trigger',
    JSON.stringify(ids(restB.json?.triggers)) === JSON.stringify(['tgr_trigger_scope_b']),
    restB.text,
  );
  const patchForeign = await patchRestTrigger(server.port, tokenA, 'tgr_trigger_scope_b');
  log(
    'REST token A cannot patch workspace B trigger',
    patchForeign.res.status === 403 && patchForeign.json?.code === 'not_owner',
    patchForeign.text,
  );
  log(
    'REST foreign patch leaves workspace B trigger enabled',
    db.prepare('SELECT enabled FROM triggers WHERE id = ?').get('tgr_trigger_scope_b')?.enabled === 1,
  );
  const deleteForeign = await deleteRestTrigger(server.port, tokenA, 'tgr_trigger_scope_b');
  log(
    'REST token A cannot delete workspace B trigger',
    deleteForeign.res.status === 403 && deleteForeign.json?.code === 'not_owner',
    deleteForeign.text,
  );
  log(
    'REST foreign delete leaves workspace B trigger present',
    Boolean(db.prepare('SELECT id FROM triggers WHERE id = ?').get('tgr_trigger_scope_b')),
  );

  const mcpA = await callMcpTriggerList(server.port, tokenA);
  const mcpB = await callMcpTriggerList(server.port, tokenB);
  log('MCP token A trigger_list returns 200', mcpA.res.status === 200, mcpA.text);
  log('MCP token B trigger_list returns 200', mcpB.res.status === 200, mcpB.text);
  log(
    'MCP token A lists only workspace A trigger',
    JSON.stringify(ids(mcpA.payload?.triggers)) === JSON.stringify(['tgr_trigger_scope_a']),
    mcpA.text,
  );
  log(
    'MCP token B lists only workspace B trigger',
    JSON.stringify(ids(mcpB.payload?.triggers)) === JSON.stringify(['tgr_trigger_scope_b']),
    mcpB.text,
  );
} catch (err) {
  console.error('trigger workspace scoping test threw:', err);
  failed++;
} finally {
  if (server) await stopServer(server);
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
