#!/usr/bin/env node
// Cloud-mode gate for /api/hub/detect:
//
//   - anonymous callers get 401 auth_required
//   - verified callers reach the detect code path
//   - unverified sessions are treated as anonymous

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-hub-detect-auth-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

const betterAuth = await import('../../apps/server/dist/lib/better-auth.js');
const { hubRouter } = await import('../../apps/server/dist/routes/hub.js');
const { db } = await import('../../apps/server/dist/db.js');

betterAuth._resetAuthForTests();
const auth = betterAuth.getAuth();

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

async function fetchDetect(body) {
  const req = new Request('http://localhost/detect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await hubRouter.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, text, json };
}

console.log('Hub detect auth gate');

try {
  auth.api.getSession = async () => null;
  let res = await fetchDetect({ openapi_url: 'http://127.0.0.1/openapi.json' });
  log(
    'anonymous caller: 401 auth_required',
    res.status === 401 && res.json?.code === 'auth_required',
    res.text,
  );

  auth.api.getSession = async () => ({
    user: {
      id: 'detect_user',
      email: 'detect@example.com',
      name: 'Detect User',
      emailVerified: true,
    },
    session: { id: 'sess_detect' },
  });
  res = await fetchDetect({ openapi_url: 'http://127.0.0.1/openapi.json' });
  log(
    'verified caller: reaches detect logic and fails on loopback URL',
    res.status === 400 && res.json?.code === 'detect_failed',
    res.text,
  );

  auth.api.getSession = async () => ({
    user: {
      id: 'detect_uv',
      email: 'detect-unverified@example.com',
      name: 'Detect UV',
      emailVerified: false,
    },
    session: { id: 'sess_detect_uv' },
  });
  res = await fetchDetect({ openapi_url: 'http://127.0.0.1/openapi.json' });
  log(
    'unverified caller: treated as anonymous and rejected',
    res.status === 401 && res.json?.code === 'auth_required',
    res.text,
  );
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
