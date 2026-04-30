'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { prompt } = require('./util');

const TOKEN_CACHE =
  process.env.FLOOM_BYO_TOKEN_CACHE ||
  path.join(os.homedir(), '.floom', 'byo-tokens.json');

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

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
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return {};
    return cache;
  } catch {
    return {};
  }
}

function writeTokenCache(cache, cachePath = TOKEN_CACHE) {
  ensureDir(path.dirname(cachePath));
  const fd = fs.openSync(cachePath, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(cache, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
}

function openBrowser(url) {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    console.log(`Open this URL manually: ${url}`);
    return;
  }

  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    console.log(`Open this URL manually: ${url}`);
  });
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
    let settled = false;
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${redirectPort}`);
        if (req.method !== 'GET' || url.pathname !== '/callback') {
          res.writeHead(204);
          res.end();
          return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const state = url.searchParams.get('state');
        if (!code && !error) {
          res.writeHead(204);
          res.end();
          return;
        }
        if (error) throw new Error(error);
        if (state !== expectedState) throw new Error('OAuth callback state mismatch');
        if (!code) throw new Error('OAuth callback did not include a code');
        settled = true;
        clearTimeout(timer);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Floom ${provider} connected. You can close this tab.\n`);
        server.close();
        resolve(code);
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Floom OAuth failed: ${err.message}\n`);
        server.close();
        reject(err);
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error(`OAuth timed out — re-run with FLOOM_BYO_${provider.toUpperCase()}_TOKEN to skip browser flow`));
    }, OAUTH_TIMEOUT_MS);
    server.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    server.listen(redirectPort, '127.0.0.1');
  });
}

async function tokenRequest(config, body) {
  const form = new URLSearchParams(body);
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || !json.access_token) {
    throw new Error(`OAuth token request failed: HTTP ${res.status} ${text}`);
  }
  return normalizeToken(json);
}

function normalizeToken(token) {
  const normalized = { ...token, updated_at: new Date().toISOString() };
  if (token.expires_in) {
    normalized.expires_at = Date.now() + Number(token.expires_in) * 1000;
    delete normalized.expires_in;
  }
  return normalized;
}

async function exchangeCode(config, code, verifier, redirectUri) {
  return tokenRequest(config, {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

async function refreshToken(config, token) {
  if (!token.refresh_token) throw new Error('cached token has no refresh_token');
  return tokenRequest(config, {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: token.refresh_token,
  });
}

function getCachedProvider(cache, provider, account) {
  if (!cache[provider]) return null;
  if (cache[provider].access_token) {
    const migrated = { default: cache[provider] };
    cache[provider] = migrated;
  }
  return cache[provider][account] || null;
}

function setCachedProvider(cache, provider, account, token) {
  if (!cache[provider] || cache[provider].access_token) cache[provider] = {};
  cache[provider][account] = token;
}

function isUsableToken(token) {
  if (!token || !token.access_token) return false;
  if (!token.expires_at) return true;
  return Number(token.expires_at) > Date.now() + REFRESH_SKEW_MS;
}

async function promptApiToken(provider, config, account, options, cache, cachePath) {
  if (options.nonInteractive) {
    throw new Error(`missing ${config.envToken}; API-token auth cannot prompt in non-interactive mode`);
  }
  const label = provider.toUpperCase();
  const apiKey = await prompt(`Paste ${label} API token for account "${account}": `);
  if (!apiKey) throw new Error(`empty ${label} API token`);
  const token = { access_token: apiKey, token_type: 'api_key', updated_at: new Date().toISOString() };
  setCachedProvider(cache, provider, account, token);
  writeTokenCache(cache, cachePath);
  return { accessToken: apiKey, source: 'prompt', account };
}

async function oauthToken(provider, options = {}) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`unknown BYO provider: ${provider}`);

  const account = options.account || 'default';
  const envToken = process.env[config.envToken];
  if (envToken) return { accessToken: envToken, source: 'env', account };

  const cachePath = options.cachePath || TOKEN_CACHE;
  const cache = readTokenCache(cachePath);
  const cached = getCachedProvider(cache, provider, account);
  if (isUsableToken(cached)) {
    return { accessToken: cached.access_token, source: 'cache', account };
  }

  const oauthConfigured = !!(config.clientId && config.authUrl && config.tokenUrl);
  if (cached && cached.refresh_token && oauthConfigured) {
    try {
      const refreshed = await refreshToken(config, cached);
      setCachedProvider(cache, provider, account, refreshed);
      writeTokenCache(cache, cachePath);
      return { accessToken: refreshed.access_token, source: 'refresh', account };
    } catch {
      // Re-auth or API-token prompt below.
    }
  }

  if (!oauthConfigured) {
    return promptApiToken(provider, config, account, options, cache, cachePath);
  }
  if (options.nonInteractive) {
    throw new Error(`missing ${config.envToken}; OAuth/API-token prompt is disabled in non-interactive mode`);
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
  setCachedProvider(cache, provider, account, token);
  writeTokenCache(cache, cachePath);
  return { accessToken: token.access_token, source: 'oauth', account };
}

module.exports = {
  oauthToken,
  readTokenCache,
  writeTokenCache,
  TOKEN_CACHE,
  exchangeCode,
  waitForOAuthCode,
};
