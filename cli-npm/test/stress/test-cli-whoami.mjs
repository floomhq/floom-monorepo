#!/usr/bin/env node
/**
 * Stress test: `floom auth whoami`
 *
 * Verifies that `floom auth whoami`:
 *   1. Returns a clean "not logged in" message (exit 1) with no config.
 *   2. Returns a clean error message (exit 1) with an invalid token — no
 *      shell-out to curl, no missing-dependency errors.
 *   3. Correctly parses the /api/session/me response shape when a valid
 *      token is present (mocked via FLOOM_API_URL redirect if available).
 *
 * Run with: node test/stress/test-cli-whoami.mjs
 *
 * Against prod (no token needed for cases 1+2):
 *   node test/stress/test-cli-whoami.mjs
 *
 * Against prod with a real token (case 3):
 *   FLOOM_AGENT_TOKEN=floom_agent_... node test/stress/test-cli-whoami.mjs
 */

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI = new URL('../../dist/index.js', import.meta.url).pathname;

let passed = 0;
let failed = 0;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? -1,
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Case 1: no config → "not logged in" with exit 1, no curl error
// ---------------------------------------------------------------------------
console.log('\nCase 1: no config file');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['auth', 'whoami'], { FLOOM_CONFIG: join(tmp, 'missing.json'), FLOOM_API_KEY: '' });
  rmSync(tmp, { recursive: true });

  assert('exits with code 1', r.status === 1, `got ${r.status}`);
  assert('contains "not logged in"', r.combined.includes('not logged in'), JSON.stringify(r.combined.trim()));
  assert('no "command not found" error', !r.combined.includes('command not found'), r.combined.trim());
  assert('no "curl" dependency error', !r.combined.toLowerCase().includes('curl: not found') && !r.combined.includes("'curl'"), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 2: invalid token → error from server, clean exit 1, no curl needed
// ---------------------------------------------------------------------------
console.log('\nCase 2: invalid token against prod');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    api_key: 'floom_agent_test1234567890abcdefghij123456',
    api_url: 'https://floom.dev',
  }));
  const r = run(['auth', 'whoami'], { FLOOM_CONFIG: configPath });
  rmSync(tmp, { recursive: true });

  assert('exits with code 1', r.status === 1, `got ${r.status}`);
  assert('contains "token rejected" or "error:"', r.combined.includes('token rejected') || r.combined.includes('error:'), r.combined.trim());
  assert('no "command not found" error', !r.combined.includes('command not found'), r.combined.trim());
  assert('no curl dependency error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('reports HTTP status or error code', r.combined.includes('HTTP 401') || r.combined.includes('invalid_token') || r.combined.includes('401'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 3: valid token (optional — only when FLOOM_AGENT_TOKEN is set)
// ---------------------------------------------------------------------------
const realToken = process.env.FLOOM_AGENT_TOKEN;
if (realToken) {
  console.log('\nCase 3: real token against prod');
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    api_key: realToken,
    api_url: 'https://floom.dev',
  }));
  const r = run(['auth', 'whoami'], { FLOOM_CONFIG: configPath });
  rmSync(tmp, { recursive: true });

  assert('exits with code 0', r.status === 0, `got ${r.status}\n${r.combined}`);
  assert('contains "logged in"', r.combined.includes('logged in'), r.combined.trim());
  assert('contains "identity:"', r.combined.includes('identity:'), r.combined.trim());
  assert('contains "workspace:"', r.combined.includes('workspace:'), r.combined.trim());
  assert('contains "token:"', r.combined.includes('token:'), r.combined.trim());
} else {
  console.log('\nCase 3: skipped (set FLOOM_AGENT_TOKEN=floom_agent_... to run)');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
