#!/usr/bin/env node
// Launch security regressions:
// 1. User-ingested inline OpenAPI specs cannot persist loopback/internal runtime base_url.
// 2. GET /api/:slug/quota does not leak private app slug existence.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmp = mkdtempSync(join(tmpdir(), 'floom-api-launch-sec-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

const { db } = await import('../../apps/server/dist/db.js');
const { ingestAppFromSpec } = await import('../../apps/server/dist/services/openapi-ingest.js');
const { slugQuotaRouter } = await import('../../apps/server/dist/routes/run.js');
const { Hono } = await import('../../apps/server/node_modules/hono/dist/index.js');

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

function insertApp({ slug, visibility, author, workspaceId, linkToken = null }) {
  const id = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, category, author,
        workspace_id, visibility, publish_status, app_type, base_url, link_share_token, link_share_requires_auth)
     VALUES
       (?, ?, ?, 'private app', ?, 'active', 'proxied:test', 'utility', ?,
        ?, ?, 'pending_review', 'proxied', 'https://example.com', ?, 0)`,
  ).run(
    id,
    slug,
    slug,
    JSON.stringify({
      name: slug,
      description: 'private app',
      actions: { run: { description: 'run', inputs: [], outputs: [] } },
      manifest_version: '2.0',
    }),
    author,
    workspaceId,
    visibility,
    linkToken,
  );
}

console.log('API launch security regressions');

const internalSpec = {
  openapi: '3.0.0',
  info: { title: 'Audit Internal Target', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9' }],
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

let blocked = false;
let blockMessage = '';
try {
  await ingestAppFromSpec({
    spec: internalSpec,
    slug: 'audit-internal-target',
    workspace_id: 'ws_attacker',
    author_user_id: 'attacker',
  });
} catch (err) {
  blocked = true;
  blockMessage = err?.message || String(err);
}
log(
  'user inline OpenAPI server URL to loopback is rejected',
  blocked && /Invalid or disallowed OpenAPI server URL/.test(blockMessage),
  blockMessage,
);

let trustedCreated = false;
try {
  const result = await ingestAppFromSpec({
    spec: internalSpec,
    slug: 'trusted-internal-target',
    workspace_id: 'local',
    author_user_id: 'local',
    allowPrivateNetwork: true,
  });
  const row = db
    .prepare('SELECT base_url FROM apps WHERE slug = ?')
    .get(result.slug);
  trustedCreated = row?.base_url === 'http://127.0.0.1:9';
} catch (err) {
  blockMessage = err?.message || String(err);
}
log('trusted local inline OpenAPI can keep loopback base_url', trustedCreated, blockMessage);

insertApp({
  slug: 'private-audit-slug',
  visibility: 'private',
  author: 'alice',
  workspaceId: 'ws_alice',
});
insertApp({
  slug: 'private-local-slug',
  visibility: 'private',
  author: 'local',
  workspaceId: 'local',
});
insertApp({
  slug: 'link-audit-slug',
  visibility: 'link',
  author: 'alice',
  workspaceId: 'ws_alice',
  linkToken: 'link_secret',
});
const app = new Hono();
app.route('/api/:slug/quota', slugQuotaRouter);

async function get(path) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, json, text };
}

const privateQuota = await get('/api/private-audit-slug/quota');
const missingQuota = await get('/api/missing-audit-slug/quota');
const privateOwnerQuota = await get('/api/private-local-slug/quota');
const linkNoKeyQuota = await get('/api/link-audit-slug/quota');
const linkWithKeyQuota = await get('/api/link-audit-slug/quota?key=link_secret');
log(
  'quota on private slug returns 404',
  privateQuota.status === 404,
  `${privateQuota.status} ${privateQuota.text}`,
);
log(
  'quota private-slug response matches missing-slug status',
  privateQuota.status === missingQuota.status,
  `private=${privateQuota.status} missing=${missingQuota.status}`,
);
log(
  'quota private-slug response does not expose gated:false',
  !privateQuota.text.includes('"gated":false'),
  privateQuota.text,
);
log(
  'quota allows local owner access to private slug',
  privateOwnerQuota.status === 200 && privateOwnerQuota.json?.gated === false,
  `${privateOwnerQuota.status} ${privateOwnerQuota.text}`,
);
log(
  'quota on link slug without key returns 404',
  linkNoKeyQuota.status === 404,
  `${linkNoKeyQuota.status} ${linkNoKeyQuota.text}`,
);
log(
  'quota on link slug with key returns 200',
  linkWithKeyQuota.status === 200 && linkWithKeyQuota.json?.gated === false,
  `${linkWithKeyQuota.status} ${linkWithKeyQuota.text}`,
);

console.log(`\n${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
