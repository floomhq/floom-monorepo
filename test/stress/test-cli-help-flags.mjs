#!/usr/bin/env node
// Regression test for r39: `floom <subcommand> --help` must print help text
// and exit 0 within 500ms — no interactive prompt, no network call.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'cli-npm/src/index.js');

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

function runHelp(subcmd, flag = '--help') {
  const start = Date.now();
  const result = spawnSync(
    'node',
    [CLI, subcmd, flag],
    {
      encoding: 'utf8',
      timeout: 500,
      env: {
        ...process.env,
        // Prevent interactive prompts
        FLOOM_CLI_NO_BROWSER: '1',
        NO_COLOR: '1',
        // Unset any real token so the CLI cannot make network calls
        FLOOM_API_KEY: '',
        FLOOM_CONFIG: '/dev/null',
      },
      // Provide no stdin so any readline prompt would hang — but timeout
      // ensures we catch it within 500ms
      stdio: ['pipe', 'pipe', 'pipe'],
      input: '',
    },
  );
  const elapsed = Date.now() - start;
  return { result, elapsed };
}

console.log('CLI help-flags regression (r39)');

const cases = [
  { cmd: 'setup',  flag: '--help' },
  { cmd: 'setup',  flag: '-h' },
  { cmd: 'auth',   flag: '--help' },
  { cmd: 'auth',   flag: '-h' },
  { cmd: 'apps',   flag: '--help' },
  { cmd: 'apps',   flag: '-h' },
  { cmd: 'run',    flag: '--help' },
  { cmd: 'run',    flag: '-h' },
  { cmd: 'deploy', flag: '--help' },
  { cmd: 'deploy', flag: '-h' },
];

for (const { cmd, flag } of cases) {
  const { result, elapsed } = runHelp(cmd, flag);
  const output = (result.stdout || '') + (result.stderr || '');
  const label = `floom ${cmd} ${flag}`;

  // Must exit within 500ms (spawnSync timeout would set error.code = 'ETIMEOUT')
  log(
    `${label} — exits within 500ms`,
    result.error?.code !== 'ETIMEOUT',
    result.error ? String(result.error) : `${elapsed}ms`,
  );

  // Must print some usage text
  log(
    `${label} — prints usage text`,
    output.toLowerCase().includes('usage') || output.toLowerCase().includes('floom'),
    output.slice(0, 200),
  );

  // Must exit 0
  log(
    `${label} — exits 0`,
    result.status === 0,
    `status=${result.status}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
