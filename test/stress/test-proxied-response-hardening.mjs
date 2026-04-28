#!/usr/bin/env node
// Launch hardening: proxied upstream responses are bounded and redacted.

import { createServer } from 'node:http';
import {
  MAX_UPSTREAM_RESPONSE_BYTES,
  runProxied,
} from '../../apps/server/dist/services/proxied-runner.js';

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

function makeSpec(port) {
  const op = (operationId) => ({
    post: {
      operationId,
      requestBody: {
        required: false,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      responses: { 200: { description: 'ok' } },
    },
  });
  return {
    openapi: '3.0.0',
    info: { title: 'Hardening Probe', version: '0.1.0' },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    paths: {
      '/large': op('large'),
      '/stream': op('stream'),
      '/secret': op('secret'),
      '/bearer': op('bearer'),
      '/password': op('password'),
    },
  };
}

function makeManifest() {
  return {
    name: 'Hardening Probe',
    description: 'test manifest',
    secrets_needed: [],
    actions: {
      large: { description: 'large', inputSchema: { type: 'object', properties: {} } },
      stream: { description: 'stream', inputSchema: { type: 'object', properties: {} } },
      secret: { description: 'secret', inputSchema: { type: 'object', properties: {} } },
      bearer: { description: 'bearer', inputSchema: { type: 'object', properties: {} } },
      password: { description: 'password', inputSchema: { type: 'object', properties: {} } },
    },
  };
}

const secret = 'fixture-redaction-value';
const server = createServer((req, res) => {
  if (req.url?.startsWith('/large')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < Math.ceil(MAX_UPSTREAM_RESPONSE_BYTES / chunk.length) + 1; i++) {
      res.write(chunk);
    }
    res.end();
    return;
  }
  if (req.url?.startsWith('/stream')) {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const line = JSON.stringify({ chunk: 'x'.repeat(256 * 1024) }) + '\n';
    for (let i = 0; i < 24; i++) res.write(line);
    res.end();
    return;
  }
  if (req.url?.startsWith('/secret')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `bad token ${secret}`,
        access_token: secret,
        nested: { api_key: secret, safe: 'visible' },
      }),
    );
    return;
  }
  if (req.url?.startsWith('/bearer')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Authorization: Bearer oauth_access_token_1234567890');
    return;
  }
  if (req.url?.startsWith('/password')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ password: 'correct-horse-battery-staple' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const spec = JSON.stringify(makeSpec(port));
const manifest = makeManifest();

try {
  const baseApp = {
    slug: 'hardening-probe',
    base_url: `http://127.0.0.1:${port}?api_key=${secret}`,
    auth_type: 'bearer',
    auth_config: null,
    openapi_spec_cached: spec,
    timeout_ms: null,
  };

  const large = await runProxied({
    app: baseApp,
    manifest,
    action: 'large',
    inputs: {},
    secrets: { API_KEY: secret },
  });
  log('large non-stream response returns bounded error', large.status === 'error' && large.outputs?.error === 'upstream_response_too_large', JSON.stringify(large));
  log('large non-stream logs omit body blob', large.logs.length < 4096, `logs=${large.logs.length}`);

  const stream = await runProxied({
    app: baseApp,
    manifest,
    action: 'stream',
    inputs: {},
    secrets: { API_KEY: secret },
  });
  log('large streaming response returns bounded error', stream.status === 'error' && stream.outputs?.error === 'upstream_response_too_large', JSON.stringify(stream));
  log('large streaming logs stay bounded', stream.logs.length < MAX_UPSTREAM_RESPONSE_BYTES, `logs=${stream.logs.length}`);

  const redacted = await runProxied({
    app: baseApp,
    manifest,
    action: 'secret',
    inputs: {},
    secrets: { API_KEY: secret },
  });
  const serialized = JSON.stringify(redacted);
  log('secret value is redacted from proxied result', !serialized.includes(secret), serialized);
  log('sensitive output keys are redacted', redacted.outputs?.access_token === '[redacted]' && redacted.outputs?.nested?.api_key === '[redacted]', serialized);
  log('URL query secret is redacted from logs', !redacted.logs.includes(`api_key=${secret}`), redacted.logs);

  const bearer = await runProxied({
    app: baseApp,
    manifest,
    action: 'bearer',
    inputs: {},
    secrets: {},
  });
  log('bare bearer token text is redacted', !JSON.stringify(bearer).includes('oauth_access_token_1234567890'), JSON.stringify(bearer));

  const password = await runProxied({
    app: baseApp,
    manifest,
    action: 'password',
    inputs: {},
    secrets: {},
  });
  log('ordinary app password output is preserved', password.outputs?.password === 'correct-horse-battery-staple', JSON.stringify(password));
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
