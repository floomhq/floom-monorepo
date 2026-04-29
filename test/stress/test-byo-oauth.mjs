#!/usr/bin/env node
import { createServer } from 'http';
import { createRequire } from 'module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

function readRaw(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => resolve(body));
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

const requests = [];
const server = createServer(async (req, res) => {
  const body = await readRaw(req);
  requests.push({ method: req.method, url: req.url, body, contentType: req.headers['content-type'] });
  if (req.method === 'POST' && req.url === '/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: body.includes('grant_type=refresh_token') ? 'refreshed_access' : 'new_access',
      refresh_token: 'refresh_next',
      expires_in: 3600,
    }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

console.log('BYO OAuth token exchange + refresh');
const baseUrl = await listen(server);
process.env.FLOOM_BYO_SUPABASE_TOKEN_URL = `${baseUrl}/token`;
process.env.FLOOM_BYO_SUPABASE_AUTH_URL = `${baseUrl}/auth`;
process.env.FLOOM_BYO_SUPABASE_CLIENT_ID = 'client_123';

const require = createRequire(import.meta.url);
const { exchangeCode, oauthToken } = require('../../cli-npm/src/byo/oauth.js');

const exchanged = await exchangeCode(
  {
    tokenUrl: `${baseUrl}/token`,
    clientId: 'client_123',
  },
  'code_123',
  'verifier_123',
  'http://127.0.0.1:47737/callback',
);

const tmp = mkdtempSync(join(tmpdir(), 'floom-byo-oauth-'));
const cachePath = join(tmp, 'tokens.json');
writeFileSync(cachePath, JSON.stringify({
  supabase: {
    work: {
      access_token: 'expired_access',
      refresh_token: 'refresh_old',
      expires_at: Date.now() - 1000,
    },
  },
}, null, 2));

const refreshed = await oauthToken('supabase', {
  account: 'work',
  cachePath,
  nonInteractive: true,
});
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
let fallbackError = '';
try {
  await oauthToken('e2b', { account: 'default', cachePath, nonInteractive: true });
} catch (err) {
  fallbackError = err.message;
}

log('exchangeCode uses form encoding', requests[0]?.contentType === 'application/x-www-form-urlencoded', JSON.stringify(requests[0]));
log('exchangeCode sends authorization_code grant', requests[0]?.body.includes('grant_type=authorization_code'), requests[0]?.body);
log('exchangeCode stores expires_at shape', typeof exchanged.expires_at === 'number' && !('expires_in' in exchanged), JSON.stringify(exchanged));
log('expired cache token refreshes', refreshed.accessToken === 'refreshed_access', JSON.stringify(refreshed));
log('token cache is keyed by provider account', cache.supabase?.work?.access_token === 'refreshed_access', JSON.stringify(cache));
log('API-token fallback replaces OAuth config error', /API-token auth cannot prompt/.test(fallbackError), fallbackError);

rmSync(tmp, { recursive: true, force: true });
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
