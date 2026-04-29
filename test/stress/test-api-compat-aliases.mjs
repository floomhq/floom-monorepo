#!/usr/bin/env node
// Launch compatibility aliases for scripts that predate the current endpoint
// names. Run with: node test/stress/test-api-compat-aliases.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmp = mkdtempSync(join(tmpdir(), 'floom-api-compat-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

let passed = 0;
let failed = 0;

function log(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function fetchJson(router, path) {
  const res = await router.fetch(new Request(`http://localhost${path}`));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, json, text };
}

try {
  const { db } = await import('../../apps/server/dist/db.js');
  const { hubRouter } = await import('../../apps/server/dist/routes/hub.js');
  const { meRouter } = await import('../../apps/server/dist/routes/run.js');
  const { meAppsRouter } = await import('../../apps/server/dist/routes/me_apps.js');

  const appId = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, manifest, code_path, author, workspace_id, status, visibility, publish_status)
     VALUES (?, 'compat-app', 'Compat App', 'compat test', ?, 'proxied:compat-app', 'local', 'local', 'active', 'public', 'published')`,
  ).run(
    appId,
    JSON.stringify({
      name: 'Compat App',
      description: 'compat test',
      actions: { run: { label: 'Run', inputs: [], outputs: [] } },
      runtime: 'python',
      python_dependencies: [],
      node_dependencies: {},
      secrets_needed: [],
      manifest_version: '2.0',
    }),
  );

  console.log('API compatibility aliases');

  const hub = await fetchJson(hubRouter, '/');
  const store = await fetchJson(hubRouter, '/store');
  log('GET /api/hub canonical returns app array', hub.status === 200 && Array.isArray(hub.json));
  log('GET /api/hub/store aliases app array', store.status === 200 && Array.isArray(store.json));
  log(
    'GET /api/hub/store includes public app',
    store.json?.some?.((app) => app.slug === 'compat-app'),
  );

  const me = await fetchJson(meRouter, '/');
  log('GET /api/me aliases session payload', me.status === 200 && me.json?.user?.id === 'local');
  log('GET /api/me includes active workspace', me.json?.active_workspace?.id === 'local');

  const apps = await fetchJson(meAppsRouter, '/');
  log('GET /api/me/apps aliases owned app list', apps.status === 200 && Array.isArray(apps.json?.apps));
  log(
    'GET /api/me/apps includes owned app',
    apps.json?.apps?.some?.((app) => app.slug === 'compat-app'),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
