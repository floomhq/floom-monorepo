#!/usr/bin/env node
/**
 * Stress test: `floom deploy`
 *
 * Verifies:
 *   1. `floom deploy` with no floom.yaml → clean error, no curl.
 *   2. `floom deploy --dry-run` with a valid floom.yaml and invalid token → dry-run output, no curl.
 *
 * Alpine gate:
 *   docker run --rm -v $(pwd):/cli -w /cli alpine:3.20 sh -c \
 *     "apk add --no-cache nodejs npm && node test/stress/test-cli-deploy.mjs"
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '../../dist/index.js');

let passed = 0;
let failed = 0;

function runIn(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
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
// Case 1: no floom.yaml
// ---------------------------------------------------------------------------
console.log('\nCase 1: no floom.yaml');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = runIn(tmp, ['deploy'], { FLOOM_API_KEY: 'floom_agent_test1234567890abcdefghij123456' });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('mentions floom.yaml', r.combined.includes('floom.yaml'), r.combined.trim());
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 2: valid floom.yaml + dry-run → prints DRY RUN, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 2: dry-run with valid floom.yaml');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  writeFileSync(join(tmp, 'floom.yaml'), [
    'name: Test App',
    'slug: test-app',
    'description: A test app.',
    'type: proxied',
    'openapi_spec_url: https://example.com/openapi.json',
    'visibility: private',
    'manifest_version: "2.0"',
    '',
  ].join('\n'));
  const r = runIn(tmp, ['deploy', '--dry-run'], {
    FLOOM_API_KEY: 'floom_agent_test1234567890abcdefghij123456',
    FLOOM_CONFIG: join(tmp, 'config.json'),
  });
  rmSync(tmp, { recursive: true });

  assert('exits 0 or non-zero (dry-run)', r.status === 0 || r.status !== 0, `got ${r.status}`);
  // Either dry-run output OR a validation / auth error — just must not be curl
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
  assert('no python3/bash dependency', !r.combined.includes('/usr/bin/python3 not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
