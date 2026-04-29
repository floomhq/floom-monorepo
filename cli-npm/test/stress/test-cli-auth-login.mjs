#!/usr/bin/env node
/**
 * Stress test: `floom auth login` / `floom auth <token>`
 *
 * Verifies:
 *   1. `floom auth login` (no token) opens/prints the URL — no curl.
 *   2. `floom auth login --token=<bad>` fails with format error — no curl.
 *   3. `floom auth login --token=<valid_but_rejected>` fails cleanly — no curl.
 *   4. With FLOOM_AGENT_TOKEN: stores token and reports logged in.
 *
 * Alpine gate:
 *   docker run --rm -v $(pwd):/cli -w /cli alpine:3.20 sh -c \
 *     "apk add --no-cache nodejs npm && node test/stress/test-cli-auth-login.mjs"
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '../../dist/index.js');

let passed = 0;
let failed = 0;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, FLOOM_NO_BROWSER: '1', FLOOM_CLI_NO_BROWSER: '1', ...env },
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
// Case 1: auth login (no token) — prints URL, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 1: floom auth login — no token prints URL');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['auth', 'login'], { FLOOM_CONFIG: join(tmp, 'missing.json'), FLOOM_API_KEY: '' });
  rmSync(tmp, { recursive: true });

  assert('exits 0', r.status === 0, `got ${r.status}`);
  assert('mentions settings/agent-tokens', r.combined.includes('settings/agent-tokens'), r.combined.trim());
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 2: auth login --token=<bad-format> — format error, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 2: bad token format');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['auth', 'login', '--token=not-a-token'], { FLOOM_CONFIG: join(tmp, 'c.json'), FLOOM_API_KEY: '' });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('mentions token format', r.combined.toLowerCase().includes('token') || r.combined.includes('format'), r.combined.trim());
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 3: auth login --token=<well-formed-but-rejected> — HTTP error, no curl
// ---------------------------------------------------------------------------
console.log('\nCase 3: well-formed but rejected token');
{
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const r = run(['auth', 'login', '--token=floom_agent_test1234567890abcdefghij123456'], {
    FLOOM_CONFIG: join(tmp, 'c.json'),
    FLOOM_API_KEY: '',
  });
  rmSync(tmp, { recursive: true });

  assert('exits non-zero', r.status !== 0, `got ${r.status}`);
  assert('no curl error', !r.combined.toLowerCase().includes('curl: not found'), r.combined.trim());
  assert('no bash error', !r.combined.includes('command not found'), r.combined.trim());
}

// ---------------------------------------------------------------------------
// Case 4: valid token (optional)
// ---------------------------------------------------------------------------
const realToken = process.env.FLOOM_AGENT_TOKEN;
if (realToken) {
  console.log('\nCase 4: valid token — stores config');
  const tmp = mkdtempSync(join(tmpdir(), 'floom-test-'));
  const configPath = join(tmp, 'config.json');
  const r = run(['auth', 'login', `--token=${realToken}`], { FLOOM_CONFIG: configPath });
  const configExists = existsSync(configPath);
  let savedToken = '';
  if (configExists) {
    try { savedToken = JSON.parse(readFileSync(configPath, 'utf8')).api_key; } catch {}
  }
  rmSync(tmp, { recursive: true });

  assert('exits 0', r.status === 0, `got ${r.status}\n${r.combined}`);
  assert('mentions logged in', r.combined.toLowerCase().includes('logged in'), r.combined.trim());
  assert('config file written', configExists);
  assert('token stored correctly', savedToken === realToken, `got ${savedToken}`);
} else {
  console.log('\nCase 4: skipped (set FLOOM_AGENT_TOKEN=floom_agent_... to run)');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
