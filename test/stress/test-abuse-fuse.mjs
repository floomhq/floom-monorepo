#!/usr/bin/env node
// Launch security fuse:
// repeated 429s arm a temporary brake that returns 503 on expensive MCP/write
// surfaces while leaving health checks available for uptime monitors.
//
// Run: node test/stress/test-abuse-fuse.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
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
  const tmp = mkdtempSync(join(tmpdir(), 'floom-abuse-fuse-'));
  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  const port = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    DATA_DIR: dataDir,
    FLOOM_SEED_APPS: 'false',
    FLOOM_SEED_LAUNCH_DEMOS: 'false',
    FLOOM_FAST_APPS: 'false',
    FLOOM_DISABLE_JOB_WORKER: 'true',
    FLOOM_DISABLE_TRIGGERS_WORKER: 'true',
    FLOOM_DISABLE_ZOMBIE_SWEEPER: 'true',
    FLOOM_RATE_LIMIT_IP_PER_HOUR: '1',
    FLOOM_RATE_LIMIT_USER_PER_HOUR: '1',
    FLOOM_RATE_LIMIT_APP_PER_HOUR: '100',
    FLOOM_ABUSE_FUSE_429_THRESHOLD: '2',
    FLOOM_ABUSE_FUSE_TTL_SECONDS: '60',
  };
  delete env.FLOOM_AUTH_TOKEN;
  delete env.FLOOM_RATE_LIMIT_DISABLED;
  delete env.FLOOM_ABUSE_FUSE_DISABLED;

  const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
    env,
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
    try {
      proc.kill('SIGTERM');
    } catch {}
    throw new Error(`${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { port, proc, tmp };
}

async function stopServer(server) {
  try {
    server.proc.kill('SIGTERM');
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 150));
  rmSync(server.tmp, { recursive: true, force: true });
}

async function call(port, { method = 'GET', path, ip = '198.51.100.41', body }) {
  const headers = new Headers({ 'x-forwarded-for': ip });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON response is allowed for unrelated route errors
  }
  return { status: res.status, headers: res.headers, text, json };
}

console.log('Launch abuse fuse');
const server = await bootServer();
try {
  const first = await call(server.port, {
    method: 'POST',
    path: '/api/missing-app/jobs',
    body: { input: {} },
  });
  const second = await call(server.port, {
    method: 'POST',
    path: '/api/missing-app/jobs',
    body: { input: {} },
  });
  const third = await call(server.port, {
    method: 'POST',
    path: '/api/missing-app/jobs',
    body: { input: {} },
  });

  log('first expensive request reaches route', first.status !== 429 && first.status !== 503, `status=${first.status}`);
  log('second expensive request is rate-limited', second.status === 429, `status=${second.status}`);
  log('third expensive request arms fuse or sees fuse', third.status === 429 || third.status === 503, `status=${third.status}`);

  const mcp = await call(server.port, {
    method: 'POST',
    path: '/mcp',
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  log('armed fuse blocks MCP with 503', mcp.status === 503, `status=${mcp.status} body=${mcp.text}`);
  log('MCP fuse body is server_overloaded', mcp.json?.error === 'server_overloaded');
  log('MCP fuse includes Retry-After', Number(mcp.headers.get('retry-after')) > 0);

  const write = await call(server.port, {
    method: 'POST',
    path: '/api/parse',
    body: {},
  });
  log('armed fuse blocks generic API writes with 503', write.status === 503, `status=${write.status} body=${write.text}`);

  const health = await call(server.port, { path: '/api/health' });
  log('health remains available during fuse', health.status === 200, `status=${health.status}`);
} finally {
  await stopServer(server);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
