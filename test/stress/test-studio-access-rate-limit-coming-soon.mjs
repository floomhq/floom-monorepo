#!/usr/bin/env node
// Studio access page: rate-limit controls stay launch-hidden until backend config exists.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const source = readFileSync(
  join(REPO_ROOT, 'apps/web/src/pages/StudioAppAccessPage.tsx'),
  'utf-8',
);

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

console.log('Studio access rate-limit UI');

log(
  'coming-soon message is rendered',
  source.includes('data-testid="studio-access-rate-limit-coming-soon"') &&
    source.includes('Coming soon: Studio rate-limit controls are not configurable yet.'),
);
log(
  'fake Save rate limit action is absent',
  !source.includes('studio-access-rate-limit-save') &&
    !source.includes('Save rate limit') &&
    !source.includes('Rate limit saved locally'),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
