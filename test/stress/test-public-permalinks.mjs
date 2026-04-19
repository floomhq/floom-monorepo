#!/usr/bin/env node
// Public permalink helper tests.
//
// Run with:
//   pnpm exec tsx test/stress/test-public-permalinks.mjs

import {
  buildPublicRunPath,
  classifyPermalinkLoadError,
  getPermalinkLoadErrorMessage,
  getRunStartErrorMessage,
  isTerminalRunStatus,
} from '../../apps/web/src/lib/publicPermalinks.ts';

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

console.log('public permalink helpers');

log(
  'buildPublicRunPath encodes run ids',
  buildPublicRunPath('run id/1') === '/r/run%20id%2F1',
);

log(
  '404 permalink load error -> not_found',
  classifyPermalinkLoadError({ status: 404 }) === 'not_found',
);

log(
  '500 permalink load error -> retryable',
  classifyPermalinkLoadError({ status: 500 }) === 'retryable',
);

log(
  'missing status permalink load error -> retryable',
  classifyPermalinkLoadError(new Error('network')) === 'retryable',
);

log(
  'run retryable helper message is human readable',
  getPermalinkLoadErrorMessage('run').toLowerCase().includes('shared run'),
);

log(
  '429 message is translated',
  getRunStartErrorMessage({ status: 429, message: 'rate_limit_exceeded' })
    === "You've hit the current run limit. Wait a minute, then try again.",
);

log(
  'non-429 message falls back to raw message',
  getRunStartErrorMessage(new Error('boom')) === 'boom',
);

log(
  'success is terminal',
  isTerminalRunStatus('success') === true,
);

log(
  'running is not terminal',
  isTerminalRunStatus('running') === false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
