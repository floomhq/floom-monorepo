#!/usr/bin/env node
// Auth-flow rate limiting: public signup + password reset both send email.
// This test boots a local cloud-mode server and verifies the per-IP cap
// trips before Better Auth can process the request.

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
      server.close((err) => {
        if (err) reject(err);
        else resolve(address.port);
      });
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message || 'no response'}`);
}

async function bootServer() {
  const tmp = mkdtempSync(join(tmpdir(), 'floom-auth-ratelimit-'));
  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  const port = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    BETTER_AUTH_URL: `http://localhost:${port}`,
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    DATA_DIR: dataDir,
    FLOOM_CLOUD_MODE: 'true',
    FLOOM_REQUIRE_EMAIL_VERIFY: 'true',
    FLOOM_SEED_APPS: 'false',
    FLOOM_SEED_LAUNCH_DEMOS: 'false',
    FLOOM_FAST_APPS: 'false',
    FLOOM_DISABLE_JOB_WORKER: 'true',
    FLOOM_DISABLE_TRIGGERS_WORKER: 'true',
    FLOOM_DISABLE_ZOMBIE_SWEEPER: 'true',
  };
  delete env.FLOOM_AUTH_TOKEN;
  delete env.FLOOM_RATE_LIMIT_DISABLED;
  delete env.RESEND_API_KEY;

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

  await waitForHttp(`http://127.0.0.1:${port}/api/healthz`, 20_000);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    origin: `http://localhost:${port}`,
    proc,
    tmp,
    logs: () => ({ stdout, stderr }),
  };
}

async function postJson(baseUrl, origin, path, body, ip) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, retryAfter: res.headers.get('retry-after') };
}

function rateLimited(res) {
  return (
    res.status === 429 &&
    res.json?.error === 'rate_limited' &&
    typeof res.json?.retry_after_seconds === 'number' &&
    Number(res.retryAfter) === res.json.retry_after_seconds
  );
}

console.log('Auth flow rate limiting');

const server = await bootServer();
try {
  const seed = `${Date.now()}-${process.pid}`;
  const signupIp = '203.0.113.44';
  const signupResults = [];
  for (let i = 1; i <= 6; i++) {
    signupResults.push(
      await postJson(
        server.baseUrl,
        server.origin,
        '/auth/sign-up/email',
        {
          email: `auth-rate-signup-${seed}-${i}@example.com`,
          password: `AuthRate${seed}${i}!`,
          name: `Rate Limit ${i}`,
        },
        signupIp,
      ),
    );
  }
  log(
    'first 5 signup requests pass',
    signupResults.slice(0, 5).every((r) => r.status === 200),
    signupResults.map((r) => r.status).join('/'),
  );
  log(
    '6th signup request returns structured 429',
    rateLimited(signupResults[5]) && signupResults[5].json.reason === 'per_ip_per_hour',
    `status=${signupResults[5].status} body=${signupResults[5].text}`,
  );

  const resetIp = '203.0.113.45';
  const resetResults = [];
  for (let i = 1; i <= 4; i++) {
    resetResults.push(
      await postJson(
        server.baseUrl,
        server.origin,
        '/auth/request-password-reset',
        { email: `auth-rate-reset-${seed}-${i}@example.com` },
        resetIp,
      ),
    );
  }
  log(
    'first 3 password reset requests pass',
    resetResults.slice(0, 3).every((r) => r.status === 200),
    resetResults.map((r) => r.status).join('/'),
  );
  log(
    '4th password reset request returns structured 429',
    rateLimited(resetResults[3]) && resetResults[3].json.reason === 'per_ip_per_hour',
    `status=${resetResults[3].status} body=${resetResults[3].text}`,
  );
} finally {
  server.proc.kill('SIGTERM');
  await new Promise((resolve) => server.proc.once('exit', resolve));
  rmSync(server.tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
