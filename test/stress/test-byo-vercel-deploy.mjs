#!/usr/bin/env node
import { createServer } from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createVercelProvider } = require('../../cli-npm/src/byo/providers/vercel.js');

let passed = 0;
let failed = 0;

function log(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

const requests = [];
const server = createServer(async (req, res) => {
  const body = await readJson(req);
  requests.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });

  if (req.method === 'POST' && req.url === '/v9/projects') {
    if (body.name === 'existing-app') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already exists' }));
      return;
    }
    if (body.name === 'bad-app') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: '', url: 'bad.vercel.app' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'prj_123', url: 'my-app.vercel.app' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/v9/projects/existing-app') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'prj_existing', name: 'existing-app', url: 'existing.vercel.app' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/v10/projects/prj_123/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/v13/deployments') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (body.gitSource?.ref === 'fail') {
      res.end(JSON.stringify({ id: 'dpl_fail', readyState: 'ERROR', url: 'my-app.vercel.app' }));
      return;
    }
    res.end(JSON.stringify({ id: 'dpl_123', readyState: 'BUILDING', url: 'my-app.vercel.app' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/v13/deployments/dpl_123') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'dpl_123', readyState: 'READY', url: 'my-app.vercel.app' }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

console.log('BYO Vercel provider create + env + deploy');
const baseUrl = await listen(server);
const provider = createVercelProvider({ token: 'vercel_token', baseUrl });

const project = await provider.createProject('my-app', 'floomhq/my-app', {
  build_command: 'npm run build',
  output_dir: 'dist',
});
const existingProject = await provider.createProject('existing-app', 'floomhq/my-app');
let invalidIdFailed = false;
try {
  await provider.createProject('bad-app', 'floomhq/my-app');
} catch (err) {
  invalidIdFailed = /valid id/.test(err.message);
}
await provider.setEnv(project.id, {
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_ANON_KEY: 'anon_test',
  E2B_TEMPLATE_ID: 'tpl_123',
});
const deployment = await provider.deploy(project.id, 'main', { pollMs: 1 });
let deployFailed = false;
try {
  await provider.deploy(project.id, 'fail', { pollMs: 1 });
} catch (err) {
  deployFailed = /failed/.test(err.message);
}

const envRequests = requests.filter((request) => request.url === '/v10/projects/prj_123/env');
const envKeys = envRequests.map((request) => request.body.key).sort();
const deployRequest = requests.find((request) => request.url === '/v13/deployments');
const createRequest = requests.find((request) => request.url === '/v9/projects');

log('project id is normalized', project.id === 'prj_123', JSON.stringify(project));
log('409 conflict reuses existing project', existingProject.id === 'prj_existing', JSON.stringify(existingProject));
log('invalid provider id fails fast', invalidIdFailed);
log('project URL is normalized to https', project.url === 'https://my-app.vercel.app', project.url);
log('project receives build settings', createRequest?.body?.buildCommand === 'npm run build' && createRequest?.body?.outputDirectory === 'dist', JSON.stringify(createRequest?.body));
log('all expected env vars were injected', envKeys.join(',') === 'E2B_TEMPLATE_ID,SUPABASE_ANON_KEY,SUPABASE_URL', envKeys.join(','));
log('env vars use encrypted production target', envRequests.every((request) => request.body.type === 'encrypted' && request.body.target.includes('production')));
log('deploy passed git ref', deployRequest?.body?.gitSource?.ref === 'main', JSON.stringify(deployRequest?.body));
log('deploy waited for READY status', requests.some((request) => request.method === 'GET' && request.url === '/v13/deployments/dpl_123'));
log('deployment URL is normalized', deployment.deploymentUrl === 'https://my-app.vercel.app', deployment.deploymentUrl);
log('ERROR deployment state fails fast', deployFailed);
log('authorization header was sent', requests.every((request) => request.auth === 'Bearer vercel_token'));

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
