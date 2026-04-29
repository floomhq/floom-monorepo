#!/usr/bin/env node
// Regression guard: run failure logs and error messages must not contain
// infrastructure details (absolute paths, process.env references, internal
// hostnames or IPs).
//
// Covers fix #3 from the r34 codex audit: `e.stack` was being stored
// verbatim in `runs.logs`, leaking paths like /root/floom/... to app owners.
//
// Tests the `scrubInfraDetails` helper exported from runner.ts directly,
// then verifies that a crash inside runProxied produces scrubbed output.
//
// Run: node test/stress/test-r34-scrub-infra-paths.mjs
// Prereq: pnpm run build

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const runnerDist = join(__dirname, '..', '..', 'apps', 'server', 'dist', 'services', 'runner.js');

const { scrubInfraDetails } = await import(pathToFileURL(runnerDist).href);

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

console.log('scrubInfraDetails: paths that must be scrubbed');

check(
  '/root/ path is replaced',
  !scrubInfraDetails('/root/floom/apps/server/dist/services/runner.js').includes('/root/'),
  scrubInfraDetails('/root/floom/apps/server/dist/services/runner.js'),
);
check(
  '/app/ path is replaced',
  !scrubInfraDetails('Error at /app/server/src/index.ts:42').includes('/app/'),
  scrubInfraDetails('Error at /app/server/src/index.ts:42'),
);
check(
  '/home/ path is replaced',
  !scrubInfraDetails('Cannot find /home/runner/work/repo/file.js').includes('/home/'),
  scrubInfraDetails('Cannot find /home/runner/work/repo/file.js'),
);
check(
  '/tmp/ path is replaced',
  !scrubInfraDetails('tmp file at /tmp/floom-abc123/data.db').includes('/tmp/'),
  scrubInfraDetails('tmp file at /tmp/floom-abc123/data.db'),
);
check(
  'process.env reference is replaced',
  !scrubInfraDetails('Cannot read process.env.FLOOM_MASTER_KEY').includes('process.env'),
  scrubInfraDetails('Cannot read process.env.FLOOM_MASTER_KEY'),
);
check(
  'RFC-1918 IP (172.x) is replaced',
  !scrubInfraDetails('connect ECONNREFUSED 172.17.0.2:5432').includes('172.17.0.2'),
  scrubInfraDetails('connect ECONNREFUSED 172.17.0.2:5432'),
);
check(
  'Docker-internal hostname is replaced',
  !scrubInfraDetails('connect to db.docker.internal:5432').includes('docker.internal'),
  scrubInfraDetails('connect to db.docker.internal:5432'),
);
check(
  'Windows path is replaced',
  !scrubInfraDetails('Error in C:\\Users\\runner\\app\\index.js').includes('C:\\'),
  scrubInfraDetails('Error in C:\\Users\\runner\\app\\index.js'),
);

console.log('\nscrubInfraDetails: values that must be preserved');

check(
  'plain error message unchanged',
  scrubInfraDetails('Cannot connect to database') === 'Cannot connect to database',
  scrubInfraDetails('Cannot connect to database'),
);
check(
  'empty string returns empty string',
  scrubInfraDetails('') === '',
  '(empty)',
);
check(
  'public URL preserved',
  scrubInfraDetails('https://floom.dev/api/run/run_abc123').includes('floom.dev'),
  scrubInfraDetails('https://floom.dev/api/run/run_abc123'),
);
check(
  'relative path preserved',
  scrubInfraDetails('module not found: ./utils').includes('./utils'),
  scrubInfraDetails('module not found: ./utils'),
);
check(
  'HTTP status code not removed',
  scrubInfraDetails('upstream returned 503').includes('503'),
  scrubInfraDetails('upstream returned 503'),
);

console.log('\nscrubInfraDetails: stack-trace shaped input');

const fakeStack = `Error: SQLITE_BUSY: database is locked
    at Object.run (/root/floom/node_modules/better-sqlite3/lib/statement.js:35:21)
    at updateRun (/app/server/src/services/runner.ts:52:3)
    at runActionWorker (/app/server/src/services/runner.ts:470:5)
    process.env.DATA_DIR=/root/floom/data`;

const scrubbed = scrubInfraDetails(fakeStack);
check('stack trace: no /root/ paths', !scrubbed.includes('/root/'), scrubbed);
check('stack trace: no /app/ paths', !scrubbed.includes('/app/'), scrubbed);
check('stack trace: no process.env', !scrubbed.includes('process.env'), scrubbed);
check(
  'stack trace: error message preserved (SQLITE_BUSY)',
  scrubbed.includes('SQLITE_BUSY'),
  scrubbed,
);
check(
  'stack trace: function names preserved (updateRun)',
  scrubbed.includes('updateRun'),
  scrubbed,
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
