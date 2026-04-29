#!/usr/bin/env node
import { spawn } from 'child_process';
import { createServer } from 'http';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

function runCli(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 20_000);
    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

const requests = [];
const server = createServer(async (req, res) => {
  const body = await readJson(req);
  requests.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });

  if (req.method === 'POST' && req.url === '/v1/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'sb_e2e',
      url: 'https://sb_e2e.supabase.co',
      anon_key: 'anon_e2e',
      connection_string: 'postgresql://e2e.supabase.co/db',
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/projects/sb_e2e/database/query') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/templates') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ template_id: 'tpl_e2e' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v9/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'prj_e2e', url: 'my-app.vercel.app' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v10/projects/prj_e2e/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v13/deployments') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: 'my-app.vercel.app' }));
    return;
  }

  res.writeHead(404);
  res.end(`not found: ${req.method} ${req.url}`);
});

console.log('BYO end-to-end CLI flow against stub providers');
const baseUrl = await listen(server);
const tmp = mkdtempSync(join(tmpdir(), 'floom-byo-e2e-'));
writeFileSync(join(tmp, 'floom.yaml'), [
  'name: My App',
  'slug: my-app',
  'description: BYO test app',
  'secrets:',
  '  - OPENAI_API_KEY',
  'inputs:',
  '  - name: email',
  '    type: string',
  'actions:',
  '  - name: capture',
  'runtime:',
  '  byo:',
  '    database:',
  '      provider: supabase',
  '      tables:',
  '        - name: leads',
  '          columns:',
  '            - name: id',
  '              type: uuid',
  '              primary_key: true',
  '            - name: email',
  '              type: text',
  '              nullable: false',
  '    hosting:',
  '      provider: vercel',
  '      build_command: npm run build',
  '      output_dir: dist',
  '    sandbox:',
  '      provider: e2b',
  '      template: nodejs-22',
  '',
].join('\n'));

const cli = join(process.cwd(), 'cli-npm', 'dist', 'index.js');
const result = await runCli(process.execPath, [cli, 'byo-deploy', tmp, '--yes', '--json'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FLOOM_BYO_SUPABASE_API_URL: baseUrl,
    FLOOM_BYO_VERCEL_API_URL: baseUrl,
    FLOOM_BYO_E2B_API_URL: baseUrl,
    FLOOM_BYO_SUPABASE_TOKEN: 'supabase_token',
    FLOOM_BYO_VERCEL_TOKEN: 'vercel_token',
    FLOOM_BYO_E2B_TOKEN: 'e2b_token',
    OPENAI_API_KEY: 'stub-openai-key',
  },
});

let json = null;
try {
  json = result.stdout ? JSON.parse(result.stdout) : null;
} catch {
  json = null;
}

const envKeys = requests
  .filter((request) => request.url === '/v10/projects/prj_e2e/env')
  .map((request) => request.body.key)
  .sort();
const migration = requests.find((request) => request.url.includes('/database/query'));

log('CLI exits 0', result.status === 0, result.stderr || result.stdout || result.signal);
log('CLI prints JSON result', !!json, result.stdout);
log('web URL returned', json?.web === 'https://my-app.vercel.app', JSON.stringify(json));
log('MCP URL returned', json?.mcp === 'https://my-app.vercel.app/mcp', JSON.stringify(json));
log('REST action URL returned', json?.rest === 'POST https://my-app.vercel.app/api/capture', JSON.stringify(json));
log('stored connection string returned', json?.stored === 'postgresql://e2e.supabase.co/db', JSON.stringify(json));
log('migration was applied', migration?.body?.query?.includes('create table if not exists "leads"'), JSON.stringify(migration?.body));
log('Vercel env contains provider outputs and manifest secret', envKeys.join(',') === 'DATABASE_URL,E2B_TEMPLATE_ID,OPENAI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_URL', envKeys.join(','));

rmSync(tmp, { recursive: true, force: true });
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
