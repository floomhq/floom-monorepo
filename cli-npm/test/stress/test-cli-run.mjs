#!/usr/bin/env node
/**
 * Stress test: `floom run <slug>`
 *
 * Verifies:
 *   1. `floom run` (no slug) exits 1 with usage — no curl.
 *   2. `floom run uuid` with an invalid token returns HTTP error — no curl.
 *   3. With FLOOM_AGENT_TOKEN: runs the `uuid` app and gets a result.
 *
 * Alpine gate:
 *   docker run --rm -v $(pwd):/cli -w /cli alpine:3.20 sh -c \
 *     "apk add --no-cache nodejs npm && node test/stress/test-cli-run.mjs"
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
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
    timeout: 90_000,  // run + poll can take up to 60s
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
// Case 1: no slug — usage, exit 1
// ---------------------------------------------------------------------------
console.log('\nCase 1: floom run (no slug)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['run'], { FLOOM_CONFIG: join(tmp, 'missing.json'), FLOOM_API_KEY: '' });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
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
  const r = run(['run', 'uuid'], { FLOOM_CONFIG: configPath, FLOOM_RUN_WAIT_SECONDS: '5' });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 3: valid token — runs uuid app (optional)
// ---------------------------------------------------------------------------
const realToken = process.env.FLOOM_AGENT_TOKEN;
if (realToken) {
  console.log('\nCase 3: real token — run uuid app');
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  writeFileSync(configPath, JSON.stringify({ api_key: realToken, api_url: 'https://floom.dev' }));
  const r = run(['run', 'uuid'], { FLOOM_CONFIG: configPath, FLOOM_RUN_WAIT_SECONDS: '60' });
  rmSync(tmp, { recursive: true });

  assert('exits 0', r.status === 0, `got ${r.status}\n${r.combined}`);
  assert('no curl dependency', !r.combined.toLowerCase().includes('curl'), r.combined.trim());
  assert('mentions run', r.combined.toLowerCase().includes('run'), r.combined.trim());
} else {
  console.log('\nCase 3: skipped (set FLOOM_AGENT_TOKEN=floom_agent_... to run)');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
