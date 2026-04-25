#!/usr/bin/env node
// /skill.md + /p/:slug/skill.md markdown routes.
//
// Run: node test/stress/test-skill-md-routes.mjs

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-skill-md-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;

const { db } = await import('../../apps/server/dist/db.js');

const slug = 'pitch-coach';
const appId = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const manifest = {
  name: 'Pitch Coach',
  description: 'Roast + rewrite a startup pitch.',
  runtime: 'python',
  python_dependencies: [],
  node_dependencies: {},
  secrets_needed: [],
  manifest_version: '2.0',
  actions: {
    coach: {
      label: 'Coach Pitch',
      description: 'Coach a startup pitch.',
      inputs: [
        {
          name: 'pitch',
          label: 'Pitch',
          type: 'textarea',
          required: true,
          description: '20-500 characters.',
        },
      ],
      outputs: [{ name: 'feedback', label: 'Feedback', type: 'text' }],
    },
  },
};

db.prepare(
  `INSERT INTO apps
     (id, slug, name, description, manifest, status, code_path, app_type,
      workspace_id, author, visibility, publish_status, hero)
   VALUES (?, ?, ?, ?, ?, 'active', ?, 'proxied', 'local', 'floom', 'public', 'published', 1)`,
).run(
  appId,
  slug,
  'Pitch Coach',
  'Paste a 20-500 char startup pitch and get critiques + rewrites.',
  JSON.stringify(manifest),
  'proxied:pitch-coach',
);

let passed = 0;
let failed = 0;
function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message || 'no response'}`);
}

async function canBindLocalhost() {
  return await new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function bootServer() {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    DATA_DIR: dataDir,
    FLOOM_SEED_APPS: 'false',
    FLOOM_SEED_LAUNCH_DEMOS: 'false',
    FLOOM_FAST_APPS: 'false',
    FLOOM_DISABLE_JOB_WORKER: 'true',
    FLOOM_DISABLE_TRIGGERS_WORKER: 'true',
    FLOOM_DISABLE_ZOMBIE_SWEEPER: 'true',
  };
  const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHttp(`http://localhost:${port}/api/health`, 20_000);
  } catch (err) {
    try {
      proc.kill('SIGTERM');
    } catch {}
    const combined = `${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    if (combined.includes('listen EPERM')) {
      throw new Error(`listen_eprem\n${combined}`);
    }
    throw new Error(combined);
  }
  return { port, proc };
}

async function stopServer(server) {
  try {
    server.proc.kill('SIGTERM');
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 150));
}

console.log('Skill markdown routes');

async function runAssertions(baseFetch) {
  const rootRes = await baseFetch('/skill.md');
  const rootBody = await rootRes.text();
  log('GET /skill.md returns 200', rootRes.status === 200, `got ${rootRes.status}`);
  log(
    'GET /skill.md content-type is text/markdown',
    (rootRes.headers.get('content-type') || '').includes('text/markdown'),
    rootRes.headers.get('content-type') || '',
  );
  log(
    'GET /skill.md contains YAML frontmatter',
    rootBody.startsWith('---\n') &&
      rootBody.includes('\nname: Floom\n') &&
      rootBody.includes('\n---\n'),
  );
  log(
    'GET /skill.md sets cache-control',
    (rootRes.headers.get('cache-control') || '').includes('public, max-age=300'),
    rootRes.headers.get('cache-control') || '',
  );

  const appRes = await baseFetch(`/p/${slug}/skill.md`);
  const appBody = await appRes.text();
  log(
    'GET /p/:slug/skill.md returns 200',
    appRes.status === 200,
    `got ${appRes.status}`,
  );
  log(
    'GET /p/:slug/skill.md content-type is text/markdown',
    (appRes.headers.get('content-type') || '').includes('text/markdown'),
    appRes.headers.get('content-type') || '',
  );
  log(
    'GET /p/:slug/skill.md frontmatter contains app name',
    appBody.includes('name: "Pitch Coach"'),
  );
  log(
    'GET /p/:slug/skill.md sets cache-control',
    (appRes.headers.get('cache-control') || '').includes('public, max-age=300'),
    appRes.headers.get('cache-control') || '',
  );

  const missingRes = await baseFetch('/p/nonexistent/skill.md');
  const missingBody = await missingRes.text();
  log(
    'GET /p/nonexistent/skill.md returns 404',
    missingRes.status === 404,
    `got ${missingRes.status}`,
  );
  log(
    'GET /p/nonexistent/skill.md returns markdown body',
    missingBody.trim() === 'App not found',
    missingBody.trim(),
  );
}

let server = null;
const listenAllowed = await canBindLocalhost();
if (listenAllowed) {
  server = await bootServer();
  await runAssertions((path) => fetch(`http://localhost:${server.port}${path}`));
} else {
  const { skillRouter } = await import('../../apps/server/dist/routes/skill.js');
  await runAssertions((path) => skillRouter.fetch(new Request(`http://localhost${path}`)));
}

if (server) await stopServer(server);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
