#!/usr/bin/env node
// Regression test for: Composio resolveOrProvisionAuthConfigId picks wrong auth
// config when the API response includes configs for multiple providers (e.g.
// Gmail + Slack) and the is_composio_managed-only filter returns Slack first.
//
// Bug: the find() predicate only checked c.is_composio_managed, so whichever
// managed config appeared first in the response was returned — regardless of
// whether it matched the requested provider.
//
// Fix: add c.toolkit?.slug?.toLowerCase() === normalized to the predicate so
// the returned config is always scoped to the requested toolkit.
//
// This test FAILS before the fix (will return Slack ID when requesting Gmail)
// and PASSES after the fix (returns the correct provider-scoped ID).
//
// Run: node test/stress/test-composio-toolkit-slug-match.mjs

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-composio-slug-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.COMPOSIO_API_KEY = 'fake-test-key-for-unit-test';
// Ensure no COMPOSIO_AUTH_CONFIG_* vars interfere so we hit the fetch path.
delete process.env.COMPOSIO_AUTH_CONFIG_GMAIL;
delete process.env.COMPOSIO_AUTH_CONFIG_SLACK;

// --- Stub globalThis.fetch before importing the module under test ---
//
// The stub simulates a Composio API that returns BOTH Gmail and Slack managed
// configs regardless of the toolkitSlug query param. This matches the live
// Composio bug: the query param is ignored server-side and all managed configs
// are returned. Slack appears FIRST to trigger the pre-fix failure path.
const SLACK_CONFIG_ID = 'ac_m19_X2QIWBAx';
const GMAIL_CONFIG_ID = 'ac_ydyWvMOP-hI6';

function makeFetchStub() {
  return async function fakeFetch(url, _opts) {
    if (typeof url === 'string' && url.includes('/api/v3/auth_configs')) {
      const body = JSON.stringify({
        items: [
          // Slack appears FIRST — this is what triggered the live bug.
          {
            id: SLACK_CONFIG_ID,
            is_composio_managed: true,
            toolkit: { slug: 'slack' },
          },
          {
            id: GMAIL_CONFIG_ID,
            is_composio_managed: true,
            toolkit: { slug: 'gmail' },
          },
        ],
      });
      return {
        ok: true,
        json: async () => JSON.parse(body),
      };
    }
    // Any other URL (auth config creation, etc.) should not be reached.
    throw new Error(`fakeFetch: unexpected URL ${url}`);
  };
}

globalThis.fetch = makeFetchStub();

const { resolveOrProvisionAuthConfigId, clearAuthConfigCache } = await import(
  '../../apps/server/dist/services/composio.js'
);

let passed = 0;
let failed = 0;
function ok(label) {
  passed++;
  console.log(`  ok  ${label}`);
}
function fail(label, detail) {
  failed++;
  console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
}

console.log('composio toolkit slug match regression');

// --- Test 1: resolving "gmail" must return the Gmail config, not Slack ---
{
  clearAuthConfigCache();
  globalThis.fetch = makeFetchStub();
  let result;
  try {
    result = await resolveOrProvisionAuthConfigId('gmail');
  } catch (err) {
    fail('gmail resolves to Gmail config', `threw: ${err.message}`);
    result = null;
  }
  if (result !== null) {
    if (result === GMAIL_CONFIG_ID) {
      ok(`gmail resolves to Gmail config (${GMAIL_CONFIG_ID})`);
    } else {
      fail(
        'gmail resolves to Gmail config',
        `got ${result} — expected ${GMAIL_CONFIG_ID} (probably returned Slack config: pre-fix behaviour)`,
      );
    }
  }
}

// --- Test 2: resolving "slack" must return the Slack config ---
{
  clearAuthConfigCache();
  globalThis.fetch = makeFetchStub();
  let result;
  try {
    result = await resolveOrProvisionAuthConfigId('slack');
  } catch (err) {
    fail('slack resolves to Slack config', `threw: ${err.message}`);
    result = null;
  }
  if (result !== null) {
    if (result === SLACK_CONFIG_ID) {
      ok(`slack resolves to Slack config (${SLACK_CONFIG_ID})`);
    } else {
      fail(
        'slack resolves to Slack config',
        `got ${result} — expected ${SLACK_CONFIG_ID}`,
      );
    }
  }
}

// --- Test 3: case-insensitive slug matching ("GMAIL" == "gmail") ---
{
  clearAuthConfigCache();
  globalThis.fetch = makeFetchStub();
  let result;
  try {
    result = await resolveOrProvisionAuthConfigId('GMAIL');
  } catch (err) {
    fail('GMAIL (upper) resolves to Gmail config', `threw: ${err.message}`);
    result = null;
  }
  if (result !== null) {
    if (result === GMAIL_CONFIG_ID) {
      ok(`GMAIL (upper) resolves to Gmail config (${GMAIL_CONFIG_ID})`);
    } else {
      fail(
        'GMAIL (upper) resolves to Gmail config',
        `got ${result} — expected ${GMAIL_CONFIG_ID}`,
      );
    }
  }
}

// --- Test 4: a provider not in the list falls through to creation (or throws) ---
// We do NOT have a creation endpoint stubbed, so it will either throw or try.
// We only verify it does NOT silently return the Slack or Gmail config ID.
{
  clearAuthConfigCache();
  globalThis.fetch = makeFetchStub();
  let result;
  let threw = false;
  try {
    result = await resolveOrProvisionAuthConfigId('notion');
  } catch {
    threw = true;
  }
  if (threw) {
    ok('notion (not in list) throws rather than returning wrong config');
  } else if (result !== SLACK_CONFIG_ID && result !== GMAIL_CONFIG_ID) {
    ok('notion (not in list) returns a distinct config ID');
  } else {
    fail(
      'notion (not in list) must not return Slack/Gmail config',
      `got ${result}`,
    );
  }
}

// --- Summary ---
console.log('');
const total = passed + failed;
if (failed === 0) {
  console.log(`composio slug-match: ${passed}/${total} passed`);
  process.exit(0);
} else {
  console.log(`composio slug-match: ${passed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
