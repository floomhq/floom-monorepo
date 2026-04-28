#!/usr/bin/env node
// Unit test for probeIngestHint (apps/server/src/services/openapi-ingest.ts).
//
// Why this test exists:
//   Round 7 wired the studio_ingest_hint MCP tool to a NEW async helper,
//   probeIngestHint. The original buildIngestHint (sync) returned
//   paths_tried: [] for any input, leaving an agent that had a perfectly
//   valid openapi.json on `main` with a "no spec found" answer. The new
//   helper actually walks the standard filenames on `main` + `master`.
//
// Run from repo root: node test/stress/test-probe-ingest-hint.mjs
//
// Network policy:
//   Stubs global.fetch with a deterministic responder so the test never
//   hits raw.githubusercontent.com. CI passes with NO_NETWORK=1.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve into the compiled server build so we exercise the same module
// production runs. Falls back to tsx-loaded source if the build is
// stale.
const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleSpec = resolve(
  __dirname,
  '..',
  '..',
  'apps/server/dist/services/openapi-ingest.js',
);
const srcSpec = resolve(
  __dirname,
  '..',
  '..',
  'apps/server/src/services/openapi-ingest.ts',
);

let probeIngestHint;
try {
  ({ probeIngestHint } = await import(moduleSpec));
} catch {
  ({ probeIngestHint } = await import(srcSpec));
}

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

// ---- fetch stub --------------------------------------------------------
const realFetch = globalThis.fetch;
let probedUrls = [];
function stubFetch(matcher) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    probedUrls.push(u);
    const ok = matcher(u, init);
    return new Response(ok ? '' : 'not found', {
      status: ok ? 200 : 404,
      statusText: ok ? 'OK' : 'Not Found',
    });
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

// ---- test 1: non-repo input — no probe, falls through to buildIngestHint ----
{
  probedUrls = [];
  stubFetch(() => {
    throw new Error('fetch must NOT be called for non-repo input');
  });
  const hint = await probeIngestHint({
    input_url: 'https://example.com/some/path',
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('non-repo input does not probe', probedUrls.length === 0);
  check('non-repo input has unreachable status', hint.status === 'unreachable');
  check('non-repo input has no spec_found_url', !('spec_found_url' in hint) || hint.spec_found_url === undefined);
}

// ---- test 2: GitHub repo with openapi.json on main ----
{
  probedUrls = [];
  stubFetch((u) =>
    u === 'https://raw.githubusercontent.com/acme/api/main/openapi.json',
  );
  const hint = await probeIngestHint({
    input_url: 'acme/api',
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('repo with openapi.json hits spec_found', hint.status === 'spec_found');
  check(
    'spec_found_url points at the resolved file',
    hint.spec_found_url === 'https://raw.githubusercontent.com/acme/api/main/openapi.json',
    `got: ${hint.spec_found_url}`,
  );
  check(
    'paths_tried records every candidate',
    Array.isArray(hint.paths_tried) && hint.paths_tried.length === 12,
    `got length: ${hint.paths_tried?.length}`,
  );
  check(
    'paths_tried contains the resolved URL',
    hint.paths_tried.includes('https://raw.githubusercontent.com/acme/api/main/openapi.json'),
  );
}

// ---- test 3: GitHub repo with NO spec — repo_no_spec + paths_tried populated ----
{
  probedUrls = [];
  stubFetch(() => false);
  const hint = await probeIngestHint({
    input_url: 'empty/repo',
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('empty repo returns repo_no_spec', hint.status === 'repo_no_spec');
  check('empty repo has no spec_found_url', hint.spec_found_url === undefined);
  check(
    'empty repo: paths_tried length 12 (6 files × 2 branches)',
    hint.paths_tried.length === 12,
    `got: ${hint.paths_tried.length}`,
  );
}

// ---- test 4: GitHub repo with swagger.yaml on master ----
{
  probedUrls = [];
  stubFetch(
    (u) => u === 'https://raw.githubusercontent.com/legacy/old-api/master/swagger.yaml',
  );
  const hint = await probeIngestHint({
    input_url: 'https://github.com/legacy/old-api',
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('legacy master/swagger.yaml resolves to spec_found', hint.status === 'spec_found');
  check(
    'master branch swagger.yaml URL is the resolved one',
    hint.spec_found_url === 'https://raw.githubusercontent.com/legacy/old-api/master/swagger.yaml',
    `got: ${hint.spec_found_url}`,
  );
}

// ---- test 5: caller-attempted paths preserved + de-duped ----
{
  probedUrls = [];
  stubFetch((u) => u.endsWith('main/openapi.yaml'));
  const callerAttempted = [
    'https://raw.githubusercontent.com/acme/api/main/openapi.yaml', // dupe
    'https://raw.githubusercontent.com/acme/api/feature/openapi.yaml', // unique
  ];
  const hint = await probeIngestHint({
    input_url: 'acme/api',
    attempted: callerAttempted,
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('caller-attempted unique path preserved', hint.paths_tried.includes(callerAttempted[1]));
  // Total = 12 server probes + 1 unique caller path = 13 (the dupe is folded in)
  check(
    'paths_tried de-dupes server vs caller (12 server + 1 unique caller = 13)',
    hint.paths_tried.length === 13,
    `got: ${hint.paths_tried.length}`,
  );
}

// ---- test 6: probe failures (network errors) treated as "not found" ----
{
  probedUrls = [];
  globalThis.fetch = async () => {
    throw new Error('simulated network blip');
  };
  const hint = await probeIngestHint({
    input_url: 'flaky/network',
    baseUrl: 'http://localhost:3000',
  });
  restoreFetch();
  check('network errors do not throw', hint.status === 'repo_no_spec');
  check('network errors still record paths_tried', hint.paths_tried.length === 12);
}

console.log('');
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
