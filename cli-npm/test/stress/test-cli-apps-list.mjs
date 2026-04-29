#!/usr/bin/env node
/**
 * Stress test: `floom apps list`
 *
 * Verifies that `floom apps list`:
 *   1. Returns a clean "not authenticated" error (exit 1) with no config.
 *   2. Returns a clean HTTP error with an invalid token — no curl errors.
 *   3. Returns a table (or empty message) with a valid token (optional).
 *
 * Run:
 *   node test/stress/test-cli-apps-list.mjs
 *   FLOOM_AGENT_TOKEN=floom_agent_... node test/stress/test-cli-apps-list.mjs
 *
 * Inside Alpine (regression gate):
 *   docker run --rm -v $(pwd):/cli -w /cli alpine:3.20 sh -c \
 *     "apk add --no-cache nodejs npm && node test/stress/test-cli-apps-list.mjs"
 */

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '../../dist/index.js');

let passed = 0;
let failed = 0;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
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
// Case 1: no config → not authenticated, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 1: no config file');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['apps', 'list'], { FLOOM_CONFIG: join(tmp, 'missing.json'), FLOOM_API_KEY: '' });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('mentions "not authenticated"', r.combined.includes('not authenticated') || r.combined.includes('not logged in'), JSON.stringify(r.combined.trim()));
  assert('no curl dependency error', !r.combined.toLowerCase().includes('curl: not found') && !r.combined.includes("'curl'"), r.combined.trim());
  assert('no bash error', !r.combined.includes('/bin/bash') && !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 2: invalid token → HTTP error, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 2: invalid token');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    api_key: 'floom_agent_test1234567890abcdefghij123456',
    api_url: 'https://floom.dev',
  }));
  const r = run(['apps', 'list'], { FLOOM_CONFIG: configPath });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('no curl dependency error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('/bin/bash') && !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 3: valid token (optional)
// ---------------------------------------------------------------------------
const realToken = process.env.FLOOM_AGENT_TOKEN;
if (realToken) {
  console.log('\nCase 3: real token against prod');
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  writeFileSync(configPath, JSON.stringify({ api_key: realToken, api_url: 'https://floom.dev' }));
  const r = run(['apps', 'list'], { FLOOM_CONFIG: configPath });
  rmSync(tmp, { recursive: true });

  assert('exits with code 0', r.status === 0, `got ${r.status}\n${r.combined}`);
  assert('contains "Your apps" or "No apps found"',
    r.combined.includes('Your apps') || r.combined.includes('No apps found'),
    r.combined.trim());
  assert('no curl dependency', !r.combined.toLowerCase().includes('curl'), r.combined.trim());
} else {
  console.log('\nCase 3: skipped (set FLOOM_AGENT_TOKEN=floom_agent_... to run)');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
