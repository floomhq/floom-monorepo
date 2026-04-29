'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const TOKEN_CACHE =
  process.env.FLOOM_BYO_TOKEN_CACHE ||
  path.join(os.homedir(), '.floom', 'byo-tokens.json');

const PROVIDERS = {
  supabase: {
    envToken: 'FLOOM_BYO_SUPABASE_TOKEN',
    authUrl: process.env.FLOOM_BYO_SUPABASE_AUTH_URL || 'https://api.supabase.com/v1/oauth/authorize',
    tokenUrl: process.env.FLOOM_BYO_SUPABASE_TOKEN_URL || 'https://api.supabase.com/v1/oauth/token',
    clientId: process.env.FLOOM_SUPABASE_CLIENT_ID || process.env.FLOOM_BYO_SUPABASE_CLIENT_ID || '',
    scopes: ['projects:write', 'organizations:read'],
  },
  vercel: {
    envToken: 'FLOOM_BYO_VERCEL_TOKEN',
    authUrl: process.env.FLOOM_BYO_VERCEL_AUTH_URL || 'https://vercel.com/oauth/authorize',
    tokenUrl: process.env.FLOOM_BYO_VERCEL_TOKEN_URL || 'https://api.vercel.com/v2/oauth/access_token',
    clientId: process.env.FLOOM_VERCEL_CLIENT_ID || process.env.FLOOM_BYO_VERCEL_CLIENT_ID || '',
    scopes: [],
  },
  e2b: {
    envToken: 'FLOOM_BYO_E2B_TOKEN',
    authUrl: process.env.FLOOM_BYO_E2B_AUTH_URL || '',
    tokenUrl: process.env.FLOOM_BYO_E2B_TOKEN_URL || '',
    clientId: process.env.FLOOM_E2B_CLIENT_ID || process.env.FLOOM_BYO_E2B_CLIENT_ID || '',
    scopes: [],
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readTokenCache(cachePath = TOKEN_CACHE) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeTokenCache(cache, cachePath = TOKEN_CACHE) {
  ensureDir(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(cachePath, 0o600);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

function base64Url(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function waitForOAuthCode(provider, redirectPort, expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${redirectPort}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const state = url.searchParams.get('state');
        if (error) throw new Error(error);
        if (state !== expectedState) throw new Error('OAuth callback state mismatch');
        if (!code) throw new Error('OAuth callback did not include a code');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Floom ${provider} connected. You can close this tab.\n`);
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Floom OAuth failed: ${err.message}\n`);
        server.close();
        reject(err);
      }
    });
    server.listen(redirectPort, '127.0.0.1');
  });
}

async function exchangeCode(config, code, verifier, redirectUri) {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const body = await res.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || !json.access_token) {
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${body}`);
  }
  return json;
}

async function oauthToken(provider, options = {}) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`unknown BYO provider: ${provider}`);

  const envToken = process.env[config.envToken];
  if (envToken) return { accessToken: envToken, source: 'env' };

  const cachePath = options.cachePath || TOKEN_CACHE;
  const cache = readTokenCache(cachePath);
  if (cache[provider] && cache[provider].access_token) {
    return { accessToken: cache[provider].access_token, source: 'cache' };
  }

  if (provider === 'e2b' && !config.clientId) {
    if (options.nonInteractive) {
      throw new Error(`missing ${config.envToken}; E2B API-key auth cannot prompt in non-interactive mode`);
    }
    const apiKey = await prompt('Paste E2B API key: ');
    if (!apiKey) throw new Error('empty E2B API key');
    cache[provider] = { access_token: apiKey, token_type: 'api_key', updated_at: new Date().toISOString() };
    writeTokenCache(cache, cachePath);
    return { accessToken: apiKey, source: 'prompt' };
  }

  if (!config.clientId || !config.authUrl || !config.tokenUrl) {
    throw new Error(`missing OAuth client config for ${provider}; set ${config.envToken} for non-interactive use`);
  }
  if (options.nonInteractive) {
    throw new Error(`missing ${config.envToken}; OAuth is disabled in non-interactive mode`);
  }

  const redirectPort = Number(process.env.FLOOM_BYO_OAUTH_PORT || 47737);
  const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;
  const pkce = createPkce();
  const state = base64Url(crypto.randomBytes(16));
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (config.scopes.length) url.searchParams.set('scope', config.scopes.join(' '));

  const codePromise = waitForOAuthCode(provider, redirectPort, state);
  console.log(`  -> opening browser for ${provider} OAuth`);
  console.log(`     ${url.toString()}`);
  openBrowser(url.toString());
  const code = await codePromise;
  const token = await exchangeCode(config, code, pkce.verifier, redirectUri);
  cache[provider] = { ...token, updated_at: new Date().toISOString() };
  writeTokenCache(cache, cachePath);
  return { accessToken: token.access_token, source: 'oauth' };
}

module.exports = {
  oauthToken,
  readTokenCache,
  writeTokenCache,
  TOKEN_CACHE,
};
