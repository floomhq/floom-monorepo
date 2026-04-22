#!/usr/bin/env node
// BuildPage / landing GitHub spec candidate generation.
//
// Run with: pnpm exec tsx test/stress/test-github-url-candidates.mjs

import {
  buildGithubSpecCandidates,
  formatGithubCandidate,
} from '../../apps/web/src/lib/githubUrl.ts';

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

console.log('GitHub spec candidates');

{
  const candidates = buildGithubSpecCandidates(
    'https://github.com/Redocly/openapi-starter/blob/main/openapi/openapi.yaml',
  );
  log(
    'blob URL: exact raw file tried first',
    candidates[0] ===
      'https://raw.githubusercontent.com/Redocly/openapi-starter/main/openapi/openapi.yaml',
    candidates[0],
  );
  log(
    'blob URL: sibling files in same folder are included',
    candidates.includes(
      'https://raw.githubusercontent.com/Redocly/openapi-starter/main/openapi/openapi.json',
    ),
  );
}

{
  const candidates = buildGithubSpecCandidates('owner/repo');
  log(
    'bare owner/repo: root openapi.yaml included',
    candidates.includes('https://raw.githubusercontent.com/owner/repo/main/openapi.yaml'),
  );
  log(
    'bare owner/repo: master fallback included',
    candidates.includes('https://raw.githubusercontent.com/owner/repo/master/openapi.yaml'),
  );
}

{
  const candidates = buildGithubSpecCandidates('https://github.com/acme/widgets', {
    defaultBranch: 'trunk',
  });
  log(
    'default branch hint: preferred branch included',
    candidates[0] === 'https://raw.githubusercontent.com/acme/widgets/trunk/openapi.yaml',
    candidates[0],
  );
}

{
  log(
    'formatGithubCandidate trims raw prefix',
    formatGithubCandidate('https://raw.githubusercontent.com/acme/widgets/main/openapi.yaml') ===
      'acme/widgets/main/openapi.yaml',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
