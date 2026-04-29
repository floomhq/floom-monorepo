#!/usr/bin/env node
// Regression guard: discover_apps (agent MCP tool) must include mcp_url in
// every result, and the URL must be the live-callable /mcp/app/<slug> path.
//
// Covers fix #1 from the r34 codex audit: appSummary() in agent_read_tools.ts
// previously returned `public_link` only and omitted `mcp_url`, so MCP clients
// couldn't discover the callable endpoint from search results.
//
// Run: node test/stress/test-r34-search-apps-mcp-url.mjs
// Prereq: pnpm run build

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-r34-mcp-url-'));
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
  try { json = JSON.parse(text); } catch {}
  let payload = null;
  const raw = json?.result?.content?.[0]?.text;
  try { payload = JSON.parse(raw); } catch {}
  return { res, text, json, payload };
}

console.log('r34 fix #1: search_apps / discover_apps mcp_url');

// Seed a public app
db.prepare(
  `INSERT INTO workspaces (id, slug, name, plan) VALUES ('ws-r34', 'ws-r34', 'ws-r34', 'oss') ON CONFLICT(id) DO NOTHING`,
).run();
db.prepare(
  `INSERT INTO users (id, workspace_id, email, name, auth_provider) VALUES ('u-r34', 'ws-r34', 'r34@example.com', 'r34', 'test') ON CONFLICT(id) DO NOTHING`,
).run();
db.prepare(
  `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws-r34', 'u-r34', 'admin') ON CONFLICT(workspace_id, user_id) DO NOTHING`,
).run();

const manifest = JSON.stringify({
  name: 'R34 Test App',
  description: 'mcp_url regression fixture',
  runtime: 'python',
  manifest_version: '2.0',
  secrets_needed: [],
  actions: {
    run: {
      label: 'Run',
      description: 'Test action',
      inputs: [{ name: 'q', type: 'text', label: 'Q', required: false }],
      outputs: [],
      secrets_needed: [],
    },
  },
});
db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, app_type, base_url, code_path, visibility, workspace_id, author, publish_status)
   VALUES ('app-r34', 'r34-test-app', 'R34 Test App', 'mcp_url regression fixture', ?, 'active', 'proxied', 'http://127.0.0.1:9', '', 'public', 'ws-r34', 'u-r34', 'published')`,
).run(manifest);
db.pragma('wal_checkpoint(TRUNCATE)');

const port = await getFreePort();
const server = await bootServer(port);

// Mint an agent token
const tokenRes = await fetch(`http://localhost:${port}/api/me/agent-keys`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'r34-mcp-url-test', scope: 'read' }),
});
const tokenJson = await tokenRes.json();
const token = tokenJson?.raw_token;
log('minted agent read token', typeof token === 'string' && token.startsWith('floom_agent_'), tokenJson);

// Call discover_apps and verify mcp_url
const discover = await callMcp(port, token, 'discover_apps', { q: 'r34-test', limit: 10 });
const apps = discover.payload?.apps || [];
const target = apps.find((a) => a.slug === 'r34-test-app');

log('discover_apps returns r34-test-app', !!target, JSON.stringify(apps.map((a) => a.slug)));
log(
  'discover_apps result has mcp_url field',
  target && 'mcp_url' in target,
  JSON.stringify(target),
);
log(
  'discover_apps mcp_url is /mcp/app/<slug>',
  target && typeof target.mcp_url === 'string' && target.mcp_url.endsWith('/mcp/app/r34-test-app'),
  target?.mcp_url,
);
log(
  'discover_apps mcp_url uses PUBLIC_URL origin',
  target && typeof target.mcp_url === 'string' && target.mcp_url.startsWith(`http://localhost:${port}`),
  target?.mcp_url,
);
log(
  'discover_apps result has public_link field',
  target && typeof target.public_link === 'string' && target.public_link.includes('/p/r34-test-app'),
  target?.public_link,
);

// Verify via /api/agents/apps REST surface as well (needs read-write token)
const rwMinted = await fetch(`http://localhost:${port}/api/me/agent-keys`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'r34-mcp-url-test-rw', scope: 'read-write' }),
});
const rwTokenJson = await rwMinted.json().catch(() => null);
const rwToken = rwTokenJson?.raw_token;
const restRes = await fetch(`http://localhost:${port}/api/agents/apps?q=r34-test&limit=10`, {
  headers: { Authorization: `Bearer ${rwToken}` },
});
const restJson = await restRes.json().catch(() => null);
const restTarget = (restJson?.apps || []).find((a) => a.slug === 'r34-test-app');
log(
  'REST /api/agents/apps also includes mcp_url',
  restTarget && typeof restTarget.mcp_url === 'string' && restTarget.mcp_url.includes('/mcp/app/r34-test-app'),
  `status=${restRes.status} target=${JSON.stringify(restTarget)}`,
);

await stopServer(server);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
