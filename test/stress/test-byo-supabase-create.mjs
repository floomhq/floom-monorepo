#!/usr/bin/env node
import { createServer } from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createSupabaseProvider, renderMigrationSql } = require('../../cli-npm/src/byo/providers/supabase.js');

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

  if (req.method === 'POST' && req.url === '/v1/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'sb_proj_123',
      url: 'https://sb_proj_123.supabase.co',
      anon_key: 'anon_test',
      connection_string: 'postgresql://stub.supabase.co/db',
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/projects/sb_proj_123/database/query') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

console.log('BYO Supabase provider create + migration');
const baseUrl = await listen(server);
const provider = createSupabaseProvider({ token: 'supabase_token', baseUrl });
const tables = [
  {
    name: 'leads',
    columns: [
      { name: 'id', type: 'uuid', primary_key: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'score', type: 'integer', default: 0 },
    ],
  },
];

const project = await provider.createProject('my-app-floom-prod');
await provider.applyMigrations(project.id, tables);

const sql = renderMigrationSql(tables);
const migrationRequest = requests.find((request) => request.url.includes('/database/query'));

log('createProject returns normalized id', project.id === 'sb_proj_123', JSON.stringify(project));
log('createProject keeps connection string', project.connectionString === 'postgresql://stub.supabase.co/db');
log('migration SQL creates leads table', sql.includes('create table if not exists "leads"'), sql);
log('migration SQL preserves not null email', sql.includes('"email" text not null'), sql);
log('stub received migration query', migrationRequest?.body?.query === sql, JSON.stringify(migrationRequest?.body));
log('authorization header was sent', requests.every((request) => request.auth === 'Bearer supabase_token'));

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
