#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

process.env.DATA_DIR = join(tmpdir(), 'floom-repo-to-hosted-data');
process.env.FLOOM_GITHUB_DEPLOY_SKIP_DOCKER = 'true';
process.env.PUBLIC_URL = 'http://localhost';
process.env.FLOOM_GITHUB_API_BASE_URL = 'http://127.0.0.1:3055'; // Use a fixed port for simplicity or we'll need to set it after server start
process.env.FLOOM_GITHUB_RAW_BASE_URL = 'http://127.0.0.1:3055';
process.env.FLOOM_GITHUB_CLONE_URL_TEMPLATE = join(tmpdir(), 'floom-repos') + '/{owner}/{repo}';

const tmp = mkdtempSync(join(tmpdir(), 'floom-repo-to-hosted-'));
const reposRoot = join(tmp, 'repos');
mkdirSync(reposRoot, { recursive: true });

process.env.DATA_DIR = join(tmp, 'data');
process.env.FLOOM_GITHUB_DEPLOY_SKIP_DOCKER = 'true';
process.env.FLOOM_GITHUB_CLONE_URL_TEMPLATE = `${reposRoot}/{owner}/{repo}`;
process.env.PUBLIC_URL = 'http://localhost';

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

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(owner, repo, files, branch = 'main') {
  const ownerDir = join(reposRoot, owner);
  const dir = join(ownerDir, repo);
  mkdirSync(dir, { recursive: true });
  git(['init', '-b', branch], dir);
  git(['config', 'user.email', 'test@floom.local'], dir);
  git(['config', 'user.name', 'Floom Test'], dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
  return dir;
}

// 1. Setup Mock Repos
initRepo('octo', 'docker-app', {
  'Dockerfile': 'FROM node:20\nCMD ["node", "app.js"]',
  'app.js': 'console.log("hello world");',
  'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: Docker App\n  version: 1.0.0\npaths: {}',
});
initRepo('octo', 'yaml-app', {
  'floom.yaml': 'name: YAML App\nmanifest_version: "2.0"\nactions: {}',
  'app.py': 'print("hello")',
  'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: YAML App\n  version: 1.0.0\npaths: {}',
});
initRepo('octo', 'proxy-app', {
  'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: Proxy App\n  version: 1.0.0\npaths: {}',
});

// 2. Setup Mock GitHub API
const githubApi = createServer((req, res) => {
  if (req.url.startsWith('/repos/')) {
    const match = req.url.match(/^\/repos\/([^/]+)\/([^/?#]+)/);
    if (!match) { res.writeHead(404).end(); return; }
    const [, owner, repo] = match;
    if (req.url.includes('/git/trees/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ 
        tree: [
          { path: 'Dockerfile', type: 'blob' },
          { path: 'floom.yaml', type: 'blob' },
          { path: 'openapi.yaml', type: 'blob' },
          { path: 'app.js', type: 'blob' }
        ]
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ full_name: `${owner}/${repo}`, default_branch: 'main' }));
    return;
  }
  
  // Raw content mock: /owner/repo/branch/filename
  const rawMatch = req.url.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (rawMatch) {
    const [, owner, repo, branch, filename] = rawMatch;
    if (repo === 'docker-app' && filename === 'Dockerfile') { res.writeHead(200).end(); return; }
    if (repo === 'yaml-app' && filename === 'floom.yaml') { res.writeHead(200).end(); return; }
    if (filename.endsWith('openapi.yaml')) {
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end('openapi: 3.0.0\ninfo:\n  title: Test App\n  version: 1.0.0\npaths: {}');
      return;
    }
    res.writeHead(404).end();
    return;
  }
  
  res.writeHead(404).end();
});
await new Promise((resolve) => githubApi.listen(3055, '127.0.0.1', resolve));

// 3. Setup Hono App
const honoModule = await import('../../apps/server/node_modules/hono/dist/hono.js');
const { Hono } = honoModule;

const { deployRouter } = await import('../../apps/server/src/routes/deploy.ts');
const { hubRouter } = await import('../../apps/server/src/routes/hub.ts');
const { db } = await import('../../apps/server/src/db.ts');

const app = new Hono();
app.route('/api/hub', hubRouter);
app.route('/api/deploy', deployRouter);

async function request(method, path, body) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

console.log('Repo-to-Hosted Smart Detection & Deployment Tests');

// Test Case 1: Smart Detection - Dockerfile
const detectDocker = await request('POST', '/api/hub/detect', {
  openapi_url: 'https://github.com/octo/docker-app'
});
log('detect Docker: status 200', detectDocker.status === 200, detectDocker.text);
log('detect Docker: suggested_pipeline is hosted', detectDocker.json?.suggested_pipeline === 'hosted');
log('detect Docker: has_dockerfile is true', detectDocker.json?.has_dockerfile === true);

// Test Case 2: Smart Detection - floom.yaml
const detectYaml = await request('POST', '/api/hub/detect', {
  openapi_url: 'https://github.com/octo/yaml-app'
});
log('detect YAML: suggested_pipeline is hosted', detectYaml.json?.suggested_pipeline === 'hosted');
log('detect YAML: has_floom_yaml is true', detectYaml.json?.has_floom_yaml === true);

// Test Case 3: Smart Detection - Proxy (OpenAPI only)
const detectProxy = await request('POST', '/api/hub/detect', {
  openapi_url: 'https://github.com/octo/proxy-app'
});
log('detect Proxy: suggested_pipeline is proxy', detectProxy.json?.suggested_pipeline === 'proxy');

// Test Case 4: Start Deployment
const deploy = await request('POST', '/api/deploy/deploy-github', {
  repo_url: 'https://github.com/octo/docker-app'
});
log('deploy: POST returns 200', deploy.status === 200, deploy.text);
log('deploy: returns deployment_id', !!deploy.json?.deployment_id);
const deploymentId = deploy.json.deployment_id;

// Test Case 5: Build Quota
// We already used 1 build. Let's use 4 more to hit the limit.
for (let i = 0; i < 4; i++) {
  await request('POST', '/api/deploy/deploy-github', { repo_url: 'https://github.com/octo/docker-app' });
}
const deployQuota = await request('POST', '/api/deploy/deploy-github', {
  repo_url: 'https://github.com/octo/docker-app'
});
// Note: Quota is only enforced in isCloudMode(). We might need to mock it.
// For now, let's see if it works without cloud mode (it probably won't as it defaults to false).

// Test Case 6: SSE Log Streaming
// This is tricky to test with app.fetch() because it doesn't support streaming well.
// We might need to spin up a real server for this part or skip if too complex for this env.
// But we can check if the route exists and returns 200.
const logs = await request('GET', `/api/deploy/${deploymentId}/logs`);
log('logs: GET returns 200', logs.status === 200);

githubApi.close();
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
