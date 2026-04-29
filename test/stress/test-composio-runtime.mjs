#!/usr/bin/env node
// Composio runtime slice test:
// connect -> callback-store -> resolve env -> disconnect, plus manifest validation.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-composio-runtime-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

// Preserve any real key from the environment; fall back to fake for unit tests.
const REAL_API_KEY = process.env.COMPOSIO_API_KEY && !process.env.COMPOSIO_API_KEY.startsWith('composio_test')
  ? process.env.COMPOSIO_API_KEY
  : null;

process.env.COMPOSIO_API_KEY = 'composio_test_master';
process.env.COMPOSIO_AUTH_CONFIG_GMAIL = 'ac_gmail_test';
process.env.PUBLIC_URL = 'https://floom.test';

const { DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID } = await import('../../apps/server/dist/db.js');
const composio = await import('../../apps/server/dist/services/composio.js');
const runtime = await import('../../apps/server/dist/services/composio-runtime.js');
const manifestSvc = await import('../../apps/server/dist/services/manifest.js');
const userSecrets = await import('../../apps/server/dist/services/user_secrets.js');

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

console.log('Composio runtime tests');

function makeFakeClient() {
  const state = { accounts: new Map(), initiateCalls: [], nextId: 1 };
  const client = {
    connectedAccounts: {
      async initiate(userId, authConfigId, options) {
        state.initiateCalls.push({ userId, authConfigId, options });
        const id = `con_fake_${state.nextId++}`;
        state.accounts.set(id, {
          id,
          status: 'ACTIVE',
          toolkit: { slug: 'gmail' },
          data: { email: 'user@example.com' },
        });
        return {
          id,
          status: 'INITIATED',
          redirectUrl: `https://composio.test/oauth/${id}`,
        };
      },
      async get(id) {
        const acc = state.accounts.get(id);
        if (!acc) throw new Error(`missing fake account ${id}`);
        return acc;
      },
      async delete() {
        return { success: true };
      },
    },
    tools: {
      async execute() {
        return { successful: true, data: {}, error: null };
      },
    },
  };
  return { client, state };
}

try {
  const { client, state } = makeFakeClient();
  composio.setComposioClient(client);

  const connect = await runtime.composioConnect(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, 'gmail');
  log('connect: returns auth_url', connect.auth_url.startsWith('https://composio.test/oauth/'));
  log('connect: returns connection_id', connect.connection_id === 'con_fake_1');
  log('connect: Composio user id scoped to user', state.initiateCalls[0]?.userId === `user:${DEFAULT_USER_ID}`);

  const stateParam = new URL(connect.auth_url).searchParams.get('floom_state');
  log('connect: auth_url carries floom_state', !!stateParam);

  const stored = await runtime.storeComposioCallbackToken({
    state: stateParam,
    connected_account_id: connect.connection_id,
    token: 'gmail_access_token',
  });
  log('callback: stores gmail integration', stored.integration === 'gmail');
  log('callback: records token source', stored.token_source === 'callback_token');

  const rawSecret = userSecrets.getWorkspaceSecret(DEFAULT_WORKSPACE_ID, 'composio:gmail');
  log('workspace_secrets: encrypted token round-trips', rawSecret === 'gmail_access_token');

  const env = runtime.resolveComposioCreds(DEFAULT_WORKSPACE_ID, [
    { provider: 'composio', slug: 'gmail' },
  ]);
  log('resolve: injects COMPOSIO_API_KEY', env.COMPOSIO_API_KEY === 'composio_test_master');
  log('resolve: injects GMAIL_OAUTH_TOKEN', env.GMAIL_OAUTH_TOKEN === 'gmail_access_token');

  const normalized = manifestSvc.normalizeManifest({
    manifest_version: '2.0',
    name: 'gmail-app',
    description: 'Uses Gmail',
    runtime: 'node',
    integrations: [{ composio: 'gmail' }],
    actions: {
      run: {
        label: 'Run',
        inputs: [],
        outputs: [{ name: 'result', label: 'Result', type: 'json' }],
      },
    },
  });
  log('manifest: composio declaration normalized', normalized.integrations?.[0]?.slug === 'gmail');

  let missingErr = false;
  try {
    runtime.resolveComposioCreds(DEFAULT_WORKSPACE_ID, [
      { provider: 'composio', slug: 'slack' },
    ]);
  } catch (err) {
    missingErr = err.name === 'MissingComposioIntegrationError' && /needs integration: slack/.test(err.message);
  }
  log('resolve: missing integration produces clear error', missingErr);

  const removed = runtime.disconnectComposioIntegration(DEFAULT_WORKSPACE_ID, 'gmail');
  log('disconnect: removes workspace secret', removed === true);
  log(
    'disconnect: credential no longer resolves',
    userSecrets.getWorkspaceSecret(DEFAULT_WORKSPACE_ID, 'composio:gmail') === null,
  );
} finally {
  composio.setComposioClient(null);
  rmSync(tmp, { recursive: true, force: true });
}

// --- Section 2: manifest validation for demo apps ---
console.log('\nComposio demo-app manifest tests');
const manifestSvc2 = await import('../../apps/server/dist/services/manifest.js');

const inboxManifest = manifestSvc2.normalizeManifest({
  manifest_version: '2.0',
  name: 'inbox-summarizer',
  description: 'Summarizes Gmail inbox',
  runtime: 'python',
  integrations: [{ composio: 'gmail' }],
  actions: {
    summarize: {
      label: 'Summarize',
      inputs: [{ name: 'max_emails', label: 'Max emails', type: 'number' }],
      outputs: [{ name: 'summary', label: 'Summary', type: 'markdown' }],
    },
  },
});
log(
  'inbox-summarizer: gmail integration normalized',
  inboxManifest.integrations?.[0]?.slug === 'gmail' &&
    inboxManifest.integrations?.[0]?.provider === 'composio',
);

const slackManifest = manifestSvc2.normalizeManifest({
  manifest_version: '2.0',
  name: 'slack-poster',
  description: 'Posts to Slack channels',
  runtime: 'python',
  integrations: [{ composio: 'slack' }],
  actions: {
    post: {
      label: 'Post',
      inputs: [
        { name: 'channel', label: 'Channel', type: 'text' },
        { name: 'message', label: 'Message', type: 'textarea' },
      ],
      outputs: [{ name: 'ok', label: 'Success', type: 'text' }],
    },
  },
});
log(
  'slack-poster: slack integration normalized',
  slackManifest.integrations?.[0]?.slug === 'slack' &&
    slackManifest.integrations?.[0]?.provider === 'composio',
);

// --- Section 3: real-network smoke test (skipped without real API key) ---
if (REAL_API_KEY) {
  console.log('\nComposio real-network smoke tests');

  process.env.COMPOSIO_API_KEY = REAL_API_KEY;
  delete process.env.COMPOSIO_AUTH_CONFIG_GMAIL;

  const composioReal = await import('../../apps/server/dist/services/composio.js');
  composioReal.clearAuthConfigCache();

  let authConfigId = null;
  let resolveErr = null;
  try {
    authConfigId = await composioReal.resolveOrProvisionAuthConfigId('gmail');
  } catch (err) {
    resolveErr = err;
  }
  log(
    'real-network: resolveOrProvisionAuthConfigId returns id for gmail',
    typeof authConfigId === 'string' && authConfigId.startsWith('ac_'),
    resolveErr?.message,
  );
  log(
    'real-network: cached on second call',
    authConfigId === await composioReal.resolveOrProvisionAuthConfigId('gmail'),
  );

  process.env.COMPOSIO_API_KEY = 'composio_test_master';
  process.env.COMPOSIO_AUTH_CONFIG_GMAIL = 'ac_gmail_test';
  composioReal.clearAuthConfigCache();
} else {
  console.log('\n  (skipping real-network smoke tests — set COMPOSIO_API_KEY to a live key to enable)');
}

if (failed > 0) {
  console.error(`Composio runtime tests failed: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nComposio runtime tests passed: ${passed} checks`);
