#!/usr/bin/env node
// Public catalog reliability regressions:
// - Cloud catalog hides Docker-runtime launch apps by default.
// - Internal proxied sidecar URLs are masked in run logs.
// - Docker daemon/socket failures become generic app_unavailable errors.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmp = mkdtempSync(join(tmpdir(), 'floom-public-catalog-reliability-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
delete process.env.FLOOM_STORE_HIDE_SLUGS;

const { db } = await import('../../apps/server/dist/db.js');
const { hubRouter } = await import('../../apps/server/dist/routes/hub.js');
const { mcpRouter } = await import('../../apps/server/dist/routes/mcp.js');
const {
  classifyDockerRuntimeException,
} = await import('../../apps/server/dist/services/runner.js');
const { runProxied } = await import('../../apps/server/dist/services/proxied-runner.js');
const { pickApps } = await import('../../apps/server/dist/services/embeddings.js');

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

async function fetchHub(path) {
  const res = await hubRouter.fetch(new Request(`http://localhost${path}`));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function callMcp(path, name, args) {
  const res = await mcpRouter.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await res.text();
  const json = JSON.parse(text);
  const raw = json?.result?.content?.[0]?.text;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function insertApp({ slug, appType = 'proxied', baseUrl = 'https://api.example.test' }) {
  const manifest = JSON.stringify({
    name: slug,
    description: `${slug} fixture`,
    runtime: 'python',
    actions: {
      run: {
        label: 'Run',
        inputs: [],
        outputs: [],
      },
    },
  });
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, docker_image, code_path,
        author, workspace_id, app_type, base_url, visibility, category, publish_status)
     VALUES (?, ?, ?, ?, ?, 'active', ?, '', 'local', 'local', ?, ?, 'public', 'testing', 'published')`,
  ).run(
    `app_${randomUUID()}`,
    slug,
    slug,
    `${slug} fixture`,
    manifest,
    appType === 'docker' ? `floom-demo-${slug}:missing` : null,
    appType,
    appType === 'proxied' ? baseUrl : null,
  );
}

console.log('Public catalog reliability tests');

insertApp({ slug: 'uuid' });
insertApp({ slug: 'competitor-lens', appType: 'docker' });

const listRes = await fetchHub('/');
const listSlugs = Array.isArray(listRes.json) ? listRes.json.map((row) => row.slug) : [];
log('GET /api/hub returns 200', listRes.status === 200, `got ${listRes.status}`);
log('cloud catalog keeps uuid listed', listSlugs.includes('uuid'), `got [${listSlugs.join(', ')}]`);
log(
  'cloud catalog hides Docker-runtime launch app by default',
  !listSlugs.includes('competitor-lens'),
  `got [${listSlugs.join(', ')}]`,
);

const mcpList = await callMcp('/', 'list_apps', { keyword: 'competitor', limit: 20 });
const mcpListSlugs = (mcpList?.apps || []).map((row) => row.slug);
log(
  'MCP list_apps hides Docker-runtime launch app by default',
  !mcpListSlugs.includes('competitor-lens'),
  `got [${mcpListSlugs.join(', ')}]`,
);

const mcpSearch = await callMcp('/search', 'search_apps', { query: 'competitor', limit: 20 });
const mcpSearchSlugs = (mcpSearch || []).map((row) => row.slug);
log(
  'MCP search_apps hides Docker-runtime launch app by default',
  !mcpSearchSlugs.includes('competitor-lens'),
  `got [${mcpSearchSlugs.join(', ')}]`,
);

const picked = await pickApps('competitor', 20);
const pickedSlugs = picked.map((row) => row.slug);
log(
  'semantic picker hides Docker-runtime launch app by default',
  !pickedSlugs.includes('competitor-lens'),
  `got [${pickedSlugs.join(', ')}]`,
);

const detailRes = await fetchHub('/competitor-lens');
log('hidden Docker-runtime app direct detail still resolves', detailRes.status === 200, `got ${detailRes.status}`);

const proxiedResult = await runProxied({
  app: {
    slug: 'uuid',
    base_url: 'http://127.0.0.1:9',
    openapi_spec_cached: JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'uuid', version: '1.0.0' },
      servers: [{ url: 'http://127.0.0.1:9' }],
      paths: {
        '/run': {
          post: {
            operationId: 'run',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { 200: { description: 'ok' } },
          },
        },
      },
    }),
    auth_type: 'none',
    auth_config: null,
  },
  manifest: {
    name: 'uuid',
    actions: {
      run: { label: 'Run', inputs: [], outputs: [] },
    },
  },
  action: 'run',
  inputs: {},
  secrets: {},
});
log('loopback proxied failure maps to network_unreachable', proxiedResult.error_type === 'network_unreachable');
log('loopback proxied logs mask 127.0.0.1', !/127\.0\.0\.1|localhost/.test(proxiedResult.logs), proxiedResult.logs);
log('loopback proxied logs retain generic internal marker', proxiedResult.logs.includes('http://[internal]/run'));

const dockerMapped = classifyDockerRuntimeException(
  new Error('connect ENOENT /var/run/docker.sock'),
);
log('docker.sock failure maps to app_unavailable', dockerMapped.error_type === 'app_unavailable');
log('docker.sock failure response hides socket path', !/docker\.sock|\/var\/run/.test(dockerMapped.error), dockerMapped.error);
log('docker.sock failure logs are suppressed', dockerMapped.logs === '', dockerMapped.logs);

db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
