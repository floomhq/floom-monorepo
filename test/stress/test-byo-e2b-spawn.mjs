#!/usr/bin/env node
import { createServer } from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createE2BProvider, parseStreamOutput } = require('../../cli-npm/src/byo/providers/e2b.js');

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

  if (req.method === 'POST' && req.url === '/templates') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ template_id: 'tpl_node_22' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/templates/tpl_node_22/runs') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end([
      JSON.stringify({ type: 'run', runId: 'run_123' }),
      JSON.stringify({ type: 'stdout', data: 'hello' }),
      JSON.stringify({ type: 'result', outputs: { ok: true, value: 42 } }),
      '',
    ].join('\n'));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

console.log('BYO E2B provider template + spawn streaming output');
const baseUrl = await listen(server);
const provider = createE2BProvider({ token: 'e2b_token', baseUrl });

const template = await provider.createTemplate('nodejs-22');
const run = await provider.spawn(template.templateId, { email: 'a@example.com' });
const parsed = parseStreamOutput('{"type":"run","runId":"r1"}\n{"outputs":{"ok":true}}\n');

log('template id is normalized', template.templateId === 'tpl_node_22', JSON.stringify(template));
log('spawn returns run id from stream', run.runId === 'run_123', JSON.stringify(run));
log('spawn returns final outputs from stream', run.outputs?.ok === true && run.outputs?.value === 42, JSON.stringify(run.outputs));
log('spawn sends inputs body', requests.find((request) => request.url.endsWith('/runs'))?.body?.inputs?.email === 'a@example.com');
log('stream parser extracts final output', parsed.outputs?.ok === true, JSON.stringify(parsed));
log('authorization header was sent', requests.every((request) => request.auth === 'Bearer e2b_token'));

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
