#!/usr/bin/env node
/**
 * @floomhq/cli — pure-Node implementation, no curl/bash/python3/jq deps.
 *
 * All HTTP calls use Node's built-in fetch (Node 18+).
 * Origin header is sent on every request (Better Auth requirement).
 * Cookie jar captures floom_device cookie for anon run polling.
 *
 * Auth resolution order:
 *   1. FLOOM_API_KEY env var
 *   2. ~/.floom/config.json  { api_key, api_url }
 *   3. Legacy ~/.claude/floom-skill-config.json  { token, base_url, token_type }
 *
 * Env overrides:
 *   FLOOM_API_URL    override API host (default: https://floom.dev)
 *   FLOOM_CONFIG     override config path (default: ~/.floom/config.json)
 *   FLOOM_DRY_RUN=1  print request without sending
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const pkg = require('../package.json');

const VERSION = pkg.version;
const DEFAULT_API_URL = process.env.FLOOM_API_URL || 'https://floom.dev';
const CONFIG_PATH = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
const USER_API_KEY_HEADER = 'X-User-Api-Key';

// ---- color helpers (no deps) -----------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;
const c = {
  bold:   (s) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[22m`),
  dim:    (s) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[22m`),
  green:  (s) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[39m`),
  red:    (s) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[39m`),
  cyan:   (s) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[39m`),
  yellow: (s) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[39m`),
};

// ---- cookie jar (for floom_device cookie in anon run polling) ---------------

const cookieJar = new Map(); // domain -> Map(name -> value)

function parseCookies(domain, headerVal) {
  if (!headerVal) return;
  const parts = headerVal.split(';');
  const kv = parts[0].trim();
  const eqIdx = kv.indexOf('=');
  if (eqIdx < 0) return;
  const name = kv.slice(0, eqIdx).trim();
  const value = kv.slice(eqIdx + 1).trim();
  if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
  cookieJar.get(domain).set(name, value);
}

function buildCookieHeader(domain) {
  const jar = cookieJar.get(domain);
  if (!jar || jar.size === 0) return '';
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---- config helpers ---------------------------------------------------------

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readConfig() {
  const configPath = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(conf) {
  const configPath = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(conf, null, 2) + '\n', { mode: 0o600 });
}

function readLegacyConfig() {
  const p = path.join(os.homedir(), '.claude', 'floom-skill-config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ---- auth resolution --------------------------------------------------------

/**
 * Resolves { apiUrl, token, tokenType } from env / config files.
 * overrideApiUrl: optional explicit --api-url flag value.
 * Returns null if no token found.
 */
function resolveAuth(overrideApiUrl) {
  let apiUrl = overrideApiUrl || DEFAULT_API_URL;
  let token = '';
  let tokenType = 'bearer';

  // 1. env var
  if (process.env.FLOOM_API_KEY) {
    token = process.env.FLOOM_API_KEY;
    if (overrideApiUrl) apiUrl = overrideApiUrl;
    else if (process.env.FLOOM_API_URL) apiUrl = process.env.FLOOM_API_URL;
    return { apiUrl, token, tokenType };
  }

  // 2. new config file
  const conf = readConfig();
  if (conf && (conf.api_key || conf.agent_token)) {
    token = conf.api_key || conf.agent_token;
    apiUrl = overrideApiUrl || conf.api_url || DEFAULT_API_URL;
    return { apiUrl, token, tokenType };
  }

  // 3. legacy fallback
  const legacy = readLegacyConfig();
  if (legacy && legacy.token) {
    token = legacy.token;
    apiUrl = overrideApiUrl || legacy.base_url || DEFAULT_API_URL;
    tokenType = legacy.token_type || 'bearer';
    return { apiUrl, token, tokenType };
  }

  return null;
}

// ---- HTTP helper ------------------------------------------------------------

/**
 * apiFetch — thin fetch wrapper.
 * Always sends Origin header (Better Auth requires it).
 * Captures Set-Cookie for the cookie jar.
 * Returns { res, body, json } where json may be null.
 */
async function apiFetch(baseUrl, urlPath, opts = {}) {
  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}${urlPath}`;

  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  const headers = {
    'Origin': base,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  // Attach cookies from jar
  const existingCookies = buildCookieHeader(domain);
  if (existingCookies) {
    headers['Cookie'] = existingCookies;
  }

  const fetchOpts = {
    method: opts.method || 'GET',
    headers,
  };
  if (opts.body !== undefined) {
    fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, fetchOpts);

  // Capture Set-Cookie
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    parseCookies(domain, setCookie);
  }

  const bodyText = await res.text();
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // not JSON
  }

  return { res, body: bodyText, json };
}

// ---- authenticated fetch ----------------------------------------------------

/**
 * authFetch — like apiFetch but resolves auth and attaches auth header.
 * Throws if not authenticated.
 * Throws with message if HTTP non-2xx.
 */
async function authFetch(overrideApiUrl, urlPath, opts = {}) {
  const auth = resolveAuth(overrideApiUrl);
  if (!auth) {
    const host = overrideApiUrl || DEFAULT_API_URL;
    const tokenUrl = agentKeysUrl(host);
    process.stderr.write([
      'floom: not authenticated.',
      '',
      `Mint an Agent token at ${tokenUrl}, then:`,
      '',
      '  floom auth login --token=floom_agent_...',
      '',
      'Or set the FLOOM_API_KEY env var directly.',
      '',
    ].join('\n'));
    process.exit(1);
  }

  const { apiUrl, token, tokenType } = auth;

  const authHeader =
    tokenType === 'session_cookie'
      ? { 'Cookie': `better-auth.session_token=${token}` }
      : { 'Authorization': `Bearer ${token}` };

  const { res, body, json } = await apiFetch(apiUrl, urlPath, {
    ...opts,
    headers: { ...authHeader, ...(opts.headers || {}) },
  });

  if (!res.ok) {
    const code = json && (json.code || json.error) ? ` (${json.code || json.error})` : '';
    const msg = json && json.message ? ` — ${json.message}` : '';
    const err = new Error(`HTTP ${res.status}${code}${msg}`);
    err.status = res.status;
    err.json = json;
    err.body = body;
    throw err;
  }

  return { res, body, json, apiUrl };
}

// ---- token helpers ----------------------------------------------------------

function looksLikeAgentToken(s) {
  return /^floom_agent_[0-9A-Za-z]{32}$/.test(s);
}

function looksLikeToken(s) {
  return /^floom_(agent|user)_[A-Za-z0-9_\-]{16,}$/.test(s);
}

async function verifyToken(apiUrl, token) {
  const { res, json } = await apiFetch(apiUrl, '/api/session/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const code = json && (json.code || json.error) ? ` (${json.code || json.error})` : '';
    throw new Error(`token rejected by ${apiUrl.replace(/\/$/, '')}: HTTP ${res.status}${code}`);
  }
  return json || {};
}

// ---- browser open -----------------------------------------------------------

function agentKeysUrl(apiUrl) {
  return `${apiUrl.replace(/\/$/, '')}/settings/agent-tokens`;
}

function openInBrowser(url) {
  if (process.env.FLOOM_CLI_NO_BROWSER === '1' || process.env.FLOOM_NO_BROWSER === '1') {
    return false;
  }
  const cmds =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '""', url]]]
      : [['xdg-open', [url]], ['gnome-open', [url]]];
  for (const [cmd, args] of cmds) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.unref();
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

function printBrowserLogin(apiUrl) {
  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const loginUrl = agentKeysUrl(apiUrl);

  console.log('');
  console.log(c.bold('  Floom · browser login'));
  console.log('');

  const opened = openInBrowser(loginUrl);
  if (opened) {
    console.log(c.green('  Opened ') + c.cyan(loginUrl));
  } else {
    console.log('  Open this URL to mint an Agent token:');
    console.log('  ' + c.cyan(loginUrl));
  }

  console.log('');
  console.log('  Then run:');
  console.log('  ' + c.cyan(`floom auth login --token=<agent_token> --api-url=${normalizedApiUrl}`));
  console.log('');
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---- YAML parser (no deps) --------------------------------------------------

/**
 * Minimal top-level-scalar YAML parser sufficient for floom.yaml.
 * Handles:  key: value  and  key: "quoted value"
 * Does NOT handle nested structures (those are validated separately).
 */
function parseFloomYaml(source) {
  const result = {};
  const lines = source.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Only top-level keys (no leading spaces)
    if (/^\s/.test(line)) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip inline comment
    const commentIdx = value.indexOf(' #');
    if (commentIdx >= 0) {
      value = value.slice(0, commentIdx).trim();
    }
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// ---- validate ---------------------------------------------------------------

function validateFloomYaml(yamlSource, filePath) {
  let m;
  try {
    m = parseFloomYaml(yamlSource);
  } catch (e) {
    process.stderr.write(`floom-validate: YAML parse error: ${e.message}\n`);
    process.exit(1);
  }

  for (const field of ['name', 'slug', 'description']) {
    if (!m[field] || !m[field].trim()) {
      process.stderr.write(`floom-validate: missing or empty required field: ${field}\n`);
      process.exit(1);
    }
  }

  const slug = m['slug'];
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) {
    process.stderr.write(`floom-validate: slug must match ^[a-z0-9][a-z0-9-]{0,47}$ (got '${slug}')\n`);
    process.exit(1);
  }

  const hasOpenapi = !!m['openapi_spec_url'];
  const hasRuntime = !!m['runtime'];

  if (!hasOpenapi && !hasRuntime) {
    process.stderr.write(
      'floom-validate: manifest must declare either openapi_spec_url ' +
      '(proxied app) or runtime + actions (custom-code app)\n'
    );
    process.exit(1);
  }

  if (hasOpenapi) {
    const specUrl = m['openapi_spec_url'];
    if (!/^https?:\/\//.test(specUrl)) {
      process.stderr.write(`floom-validate: openapi_spec_url must be http(s) (got '${specUrl}')\n`);
      process.exit(1);
    }
  }

  if (hasRuntime) {
    if (!['python', 'node'].includes(m['runtime'])) {
      process.stderr.write(`floom-validate: runtime must be 'python' or 'node' (got '${m['runtime']}')\n`);
      process.exit(1);
    }
  }

  const retention = m['max_run_retention_days'];
  if (retention !== undefined && retention !== '') {
    const n = Number(retention);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      process.stderr.write('floom-validate: max_run_retention_days must be a positive integer between 1 and 3650\n');
      process.exit(1);
    }
  }

  if (m['auth_required'] && m['link_share_requires_auth']) {
    process.stderr.write('floom-validate: auth_required is deprecated; use link_share_requires_auth, not both fields\n');
    process.exit(1);
  }

  if (m['auth_required']) {
    process.stderr.write('floom-validate: warning: auth_required is deprecated; use link_share_requires_auth\n');
  }

  process.stdout.write('ok\n');
  return m;
}

// ---- urlencode --------------------------------------------------------------

function urlencode(s) {
  return encodeURIComponent(s);
}

// ---- auth subcommands -------------------------------------------------------

async function runWhoami(opts) {
  const auth = resolveAuth(opts.apiUrl);
  if (!auth) {
    console.log('not logged in. Run: floom auth <agent-token>');
    process.exit(1);
  }

  const { apiUrl, token } = auth;
  let identity;
  try {
    identity = await verifyToken(apiUrl, token);
  } catch (err) {
    console.error(c.red('not logged in.'), err && err.message ? err.message : String(err));
    process.stderr.write(`Mint a fresh Agent token at ${agentKeysUrl(apiUrl)} and try again.\n`);
    process.exit(1);
  }

  const user = identity.user || {};
  const workspace = identity.active_workspace || identity.workspace || {};
  const identityLabel = user.email || user.id || identity.user_id || 'unknown';
  const workspaceLabel = workspace.name || workspace.id || identity.workspace_id || 'unknown';
  const redacted = token.length > 18
    ? token.slice(0, 14) + '...' + token.slice(-4)
    : token.slice(0, 4) + '...';

  console.log(`logged in  api_url: ${apiUrl}`);
  console.log(`identity:  ${identityLabel}`);
  console.log(`workspace: ${workspaceLabel}`);
  console.log(`token:     ${redacted}`);
}

async function runAuthShow() {
  const configPath = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.log(`no config at ${configPath}`);
    process.exit(1);
  }
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`floom auth --show: could not read config: ${e.message}`);
    process.exit(1);
  }
  const key = conf.api_key || conf.agent_token || '';
  const redacted = key.length > 8 ? key.slice(0, 4) + '...' + key.slice(-4) : '***';
  console.log(`api_url: ${conf.api_url || DEFAULT_API_URL}`);
  console.log(`agent_token: ${redacted}`);
}

function runAuthLogout() {
  const configPath = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
  try {
    fs.rmSync(configPath, { force: true });
    console.log(`cleared ${configPath}`);
  } catch (e) {
    console.error(`floom auth logout: ${e.message}`);
    process.exit(1);
  }
}

async function runAuthLogin(args, globalApiUrl) {
  let agentToken = '';
  let apiUrl = globalApiUrl || DEFAULT_API_URL;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      console.log([
        'floom auth login — open the token page or save an Agent token.',
        '',
        'usage:',
        '  floom auth login [--api-url=<url>]',
        '  floom auth login --token=<agent_token> [--api-url=<url>]',
        '',
        'options:',
        '  --token=<token>   Agent token. Get yours at <api_url>/settings/agent-tokens',
        '  --api-url=<url>   Override API base URL (default: https://floom.dev)',
      ].join('\n'));
      return;
    } else if (arg.startsWith('--token=')) {
      agentToken = arg.slice('--token='.length);
    } else if (arg === '--token' && args[i + 1]) {
      agentToken = args[++i];
    } else if (arg.startsWith('--api-url=') || arg.startsWith('--url=')) {
      apiUrl = arg.slice(arg.indexOf('=') + 1);
    } else if ((arg === '--api-url' || arg === '--url') && args[i + 1]) {
      apiUrl = args[++i];
    } else {
      process.stderr.write(`floom auth login: unknown option: ${arg}\n`);
      process.exit(1);
    }
    i++;
  }

  if (!agentToken) {
    // Print URL and instructions
    const loginUrl = agentKeysUrl(apiUrl);
    const opened = openInBrowser(loginUrl);
    if (opened) {
      console.log(`Opened ${loginUrl}`);
    } else {
      console.log('Open this URL to mint an Agent token:');
      console.log(`  ${loginUrl}`);
    }
    console.log('');
    console.log('Then run:');
    console.log(`  floom auth login --token=<agent_token> --api-url=${apiUrl.replace(/\/$/, '')}`);
    return;
  }

  if (!looksLikeAgentToken(agentToken)) {
    process.stderr.write('ERROR: Invalid Agent token format.\n');
    process.stderr.write('Agent tokens look like floom_agent_<32 alphanumeric chars>.\n');
    process.stderr.write(`Mint a fresh token at ${agentKeysUrl(apiUrl)} and try again.\n`);
    process.exit(1);
  }

  // Try primary URL, then fallbacks
  let resolvedUrl = apiUrl;
  let identity = null;

  const candidateUrls = [apiUrl];
  if (apiUrl.replace(/\/$/, '') === 'https://floom.dev') {
    candidateUrls.push('https://v26.floom.dev');
  }

  for (const candidate of candidateUrls) {
    try {
      identity = await verifyToken(candidate, agentToken);
      resolvedUrl = candidate;
      break;
    } catch {
      // try next
    }
  }

  if (!identity) {
    process.stderr.write(`ERROR: Token rejected by ${resolvedUrl} (could not verify).\n`);
    process.stderr.write(`Mint a fresh token at ${agentKeysUrl(resolvedUrl)} and try again.\n`);
    process.exit(1);
  }

  writeConfig({ api_key: agentToken, api_url: resolvedUrl });

  const user = (identity && identity.user) || {};
  const identityLabel = user.email || user.id || identity.user_id || 'unknown';
  console.log(`Logged in as ${identityLabel} at ${resolvedUrl}`);
}

// Save a token directly (positional: floom auth <token> [api-url])
async function runAuthSaveToken(token, apiUrl) {
  // Delegate to runAuthLogin with --token flag
  const args = [`--token=${token}`];
  if (apiUrl) args.push(`--api-url=${apiUrl}`);
  await runAuthLogin(args, null);
}

// ---- setup ------------------------------------------------------------------

async function runSetup(opts) {
  const apiUrl = opts.apiUrl || DEFAULT_API_URL;
  const tokenUrl = agentKeysUrl(apiUrl);

  console.log('');
  console.log(c.bold('  Floom · setup'));
  console.log(c.dim(`  Connecting any agent to ${apiUrl.replace(/^https?:\/\//, '')}`));
  console.log('');
  console.log('  ' + c.bold('Step 1.') + '  Open ' + c.cyan(tokenUrl) + ' and mint a token.');
  console.log('  ' + c.dim('         (sign in if needed; tokens are workspace-scoped)'));
  console.log('');

  const opened = openInBrowser(tokenUrl);
  if (!opened) {
    console.log(c.yellow('  Could not auto-open a browser. Open the URL above manually.'));
    console.log('');
  }

  let token = '';
  let identity = {};
  for (;;) {
    token = await ask('  ' + c.bold('Step 2.') + '  Paste your token here: ');
    if (!token) {
      console.log(c.yellow('  No token received. Cancelled.'));
      process.exit(1);
    }
    if (!looksLikeToken(token)) {
      console.log(c.yellow('  That does not look like a Floom token. Try again or press Ctrl+C.'));
      continue;
    }
    try {
      identity = await verifyToken(apiUrl, token);
    } catch (err) {
      console.log(c.yellow(`  ${err.message}`));
      console.log(c.yellow('  Mint a fresh Agent token and try again, or press Ctrl+C.'));
      continue;
    }
    break;
  }

  const existing = readConfig() || {};
  writeConfig({ ...existing, api_url: apiUrl, api_key: token, saved_at: new Date().toISOString() });

  const configPath = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');
  console.log('');
  console.log(c.green('  ✓ Token saved to ') + c.dim(configPath));
  const user = identity.user || {};
  const label = user.email || user.id || identity.user_id || 'verified token';
  console.log(c.green('  ✓ Verified ') + c.dim(String(label)));
  console.log('');
  console.log('  ' + c.bold('Next:'));
  console.log('  ' + c.dim('  • Verify: ') + 'floom auth whoami');
  console.log('  ' + c.dim('  • Run an app: ') + 'floom run uuid');
  console.log('  ' + c.dim('  • MCP config: ') + `${apiUrl.replace(/\/$/, '')}/mcp`);
  console.log('');
  console.log(c.green('  Done.'));
  console.log('');
}

// ---- apps subcommand --------------------------------------------------------

async function runAppsList(opts, args) {
  let rawJson = false;
  for (const arg of args) {
    if (arg === '--json') rawJson = true;
    else if (arg === '-h' || arg === '--help' || arg === 'help') {
      console.log('floom apps list — list all apps in your workspace\n\nusage:\n  floom apps list\n  floom apps list --json');
      return;
    } else {
      process.stderr.write(`floom apps list: unknown option '${arg}'\n`);
      process.exit(1);
    }
  }

  let result;
  try {
    result = await authFetch(opts.apiUrl, '/api/hub/mine');
  } catch (e) {
    process.stderr.write(`floom: ${e.message}\n`);
    process.exit(1);
  }

  if (rawJson) {
    console.log(result.body);
    return;
  }

  const data = result.json;
  const apps = Array.isArray(data) ? data : (data && data.apps) || [];

  if (!apps.length) {
    console.log('No apps found.');
    return;
  }

  const rows = apps.map(app => [
    String(app.slug || ''),
    String(app.name || ''),
    String(app.status || ''),
    String(app.visibility || ''),
    app.run_count != null ? String(app.run_count) : '',
    String(app.last_run_at || ''),
  ]);

  const headers = ['slug', 'name', 'status', 'visibility', 'runs', 'last run'];
  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const row of rows) w = Math.min(Math.max(w, row[i].length), i < 2 ? 32 : 24);
    return w;
  });

  const clip = (val, w) => val.length <= w ? val : val.slice(0, Math.max(0, w - 3)) + '...';

  console.log('Your apps');
  console.log('  ' + headers.map((h, i) => h.padEnd(widths[i])).join('  '));
  console.log('  ' + widths.map(w => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log('  ' + row.map((cell, i) => clip(cell, widths[i]).padEnd(widths[i])).join('  '));
  }
}

async function runApps(opts, subArgs) {
  const sub = subArgs[0] || 'list';
  const rest = subArgs.slice(1);

  switch (sub) {
    case '':
    case '-h':
    case '--help':
    case 'help':
      printAppsHelp();
      return;

    case 'list':
      return runAppsList(opts, rest);

    case 'get':
    case 'detail':
    case 'details':
    case 'about': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps get: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'installed': {
      try {
        const r = await authFetch(opts.apiUrl, '/api/hub/installed');
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'fork': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps fork: missing <slug>\n'); process.exit(1); }
      const forkArgs = rest.slice(1);
      const body = {};
      for (let i = 0; i < forkArgs.length; i++) {
        if (forkArgs[i] === '--slug' && forkArgs[i+1]) body.slug = forkArgs[++i];
        else if (forkArgs[i].startsWith('--slug=')) body.slug = forkArgs[i].slice(7);
        else if (forkArgs[i] === '--name' && forkArgs[i+1]) body.name = forkArgs[++i];
        else if (forkArgs[i].startsWith('--name=')) body.name = forkArgs[i].slice(7);
        else { process.stderr.write(`floom apps fork: unknown option '${forkArgs[i]}'\n`); process.exit(1); }
      }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/fork`, { method: 'POST', body: JSON.stringify(body) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'claim': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps claim: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/claim`, { method: 'POST' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'install': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps install: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/install`, { method: 'POST' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'uninstall': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps uninstall: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/install`, { method: 'DELETE' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'update': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps update: missing <slug>\n'); process.exit(1); }
      const updateArgs = rest.slice(1);
      const body = {};
      for (let i = 0; i < updateArgs.length; i++) {
        const a = updateArgs[i];
        if (a === '--visibility' && updateArgs[i+1]) { body.visibility = updateArgs[++i]; }
        else if (a.startsWith('--visibility=')) { body.visibility = a.slice(13); }
        else if (a === '--primary-action' && updateArgs[i+1]) { body.primary_action = updateArgs[++i]; }
        else if (a.startsWith('--primary-action=')) { body.primary_action = a.slice(17); }
        else if (a === '--clear-primary-action') { body.primary_action = null; }
        else if (a === '--run-rate-limit-per-hour' && updateArgs[i+1]) { body.run_rate_limit_per_hour = parseInt(updateArgs[++i], 10); }
        else if (a.startsWith('--run-rate-limit-per-hour=')) { body.run_rate_limit_per_hour = parseInt(a.slice(26), 10); }
        else if (a === '--clear-run-rate-limit') { body.run_rate_limit_per_hour = null; }
        else { process.stderr.write(`floom apps update: unknown option '${a}'\n`); process.exit(1); }
      }
      if (Object.keys(body).length === 0) {
        process.stderr.write('floom apps update: provide at least one updatable field\n');
        process.exit(1);
      }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}`, { method: 'PATCH', body: JSON.stringify(body) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'delete':
    case 'rm':
    case 'remove': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps delete: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}`, { method: 'DELETE' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'sharing':
      return runAppsSharing(opts, rest);

    case 'secret-policies':
    case 'secret-policy':
      return runAppsSecretPolicies(opts, rest);

    case 'creator-secrets':
    case 'creator-secret':
      return runAppsCreatorSecrets(opts, rest);

    case 'rate-limit':
    case 'rate-limits':
      return runAppsRateLimit(opts, rest);

    case 'reviews':
    case 'review':
      return runAppsReviews(opts, sub, rest);

    case 'source':
      return runAppsSource(opts, rest);

    case 'renderer':
      return runAppsRenderer(opts, rest);

    default:
      process.stderr.write(`floom apps: unknown subcommand '${sub}'\nrun 'floom apps --help' for usage.\n`);
      process.exit(1);
  }
}

async function runAppsSharing(opts, args) {
  const sub = args[0] || '';
  const rest = args.slice(1);

  switch (sub) {
    case '':
    case '-h':
    case '--help':
    case 'help':
      printAppsHelp();
      return;

    case 'get': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps sharing get: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/sharing`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'set': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps sharing set: missing <slug>\n'); process.exit(1); }
      const shareArgs = rest.slice(1);
      let state = '', comment = '', rotate = false;
      for (let i = 0; i < shareArgs.length; i++) {
        const a = shareArgs[i];
        if (a === '--state' && shareArgs[i+1]) state = shareArgs[++i];
        else if (a.startsWith('--state=')) state = a.slice(8);
        else if (a === '--comment' && shareArgs[i+1]) comment = shareArgs[++i];
        else if (a.startsWith('--comment=')) comment = a.slice(10);
        else if (a === '--rotate-link-token') rotate = true;
        else { process.stderr.write(`floom apps sharing set: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!['private', 'link', 'invited'].includes(state)) {
        process.stderr.write('floom apps sharing set: --state must be private, link, or invited\n');
        process.exit(1);
      }
      const body = { state };
      if (comment) body.comment = comment;
      if (rotate) body.link_token_rotate = true;
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/sharing`, { method: 'PATCH', body: JSON.stringify(body) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'invite': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps sharing invite: missing <slug>\n'); process.exit(1); }
      const inviteArgs = rest.slice(1);
      let email = '', username = '';
      for (let i = 0; i < inviteArgs.length; i++) {
        const a = inviteArgs[i];
        if (a === '--email' && inviteArgs[i+1]) email = inviteArgs[++i];
        else if (a.startsWith('--email=')) email = a.slice(8);
        else if (a === '--username' && inviteArgs[i+1]) username = inviteArgs[++i];
        else if (a.startsWith('--username=')) username = a.slice(11);
        else { process.stderr.write(`floom apps sharing invite: unknown option '${a}'\n`); process.exit(1); }
      }
      if ((email && username) || (!email && !username)) {
        process.stderr.write('floom apps sharing invite: provide exactly one of --email or --username\n');
        process.exit(1);
      }
      const invBody = email ? { email } : { username };
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/sharing/invite`, { method: 'POST', body: JSON.stringify(invBody) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'revoke-invite': {
      const slug = rest[0];
      const inviteId = rest[1];
      if (!slug) { process.stderr.write('floom apps sharing revoke-invite: missing <slug>\n'); process.exit(1); }
      if (!inviteId) { process.stderr.write('floom apps sharing revoke-invite: missing <invite-id>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/sharing/invite/${urlencode(inviteId)}/revoke`, { method: 'POST' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'submit-review':
    case 'withdraw-review': {
      const slug = rest[0];
      if (!slug) { process.stderr.write(`floom apps sharing ${sub}: missing <slug>\n`); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/sharing/${sub}`, { method: 'POST' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps sharing: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsSecretPolicies(opts, args) {
  const sub = args[0] || '';
  const rest = args.slice(1);

  switch (sub) {
    case 'list': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps secret-policies list: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/secret-policies`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'set': {
      const slug = rest[0];
      const key = rest[1];
      if (!slug) { process.stderr.write('floom apps secret-policies set: missing <slug>\n'); process.exit(1); }
      if (!key) { process.stderr.write('floom apps secret-policies set: missing <key>\n'); process.exit(1); }
      const policyArgs = rest.slice(2);
      let policy = '';
      for (let i = 0; i < policyArgs.length; i++) {
        const a = policyArgs[i];
        if (a === '--policy' && policyArgs[i+1]) policy = policyArgs[++i];
        else if (a.startsWith('--policy=')) policy = a.slice(9);
        else { process.stderr.write(`floom apps secret-policies set: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!['user_vault', 'creator_override'].includes(policy)) {
        process.stderr.write('floom apps secret-policies set: --policy must be user_vault or creator_override\n');
        process.exit(1);
      }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/secret-policies/${urlencode(key)}`, {
          method: 'PUT', body: JSON.stringify({ policy })
        });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps secret-policies: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsCreatorSecrets(opts, args) {
  const sub = args[0] || '';
  const rest = args.slice(1);

  switch (sub) {
    case 'set': {
      const slug = rest[0];
      const key = rest[1];
      if (!slug) { process.stderr.write('floom apps creator-secrets set: missing <slug>\n'); process.exit(1); }
      if (!key) { process.stderr.write('floom apps creator-secrets set: missing <key>\n'); process.exit(1); }
      const valArgs = rest.slice(2);
      let value = '';
      if (valArgs[0] === '--value' && valArgs[1]) value = valArgs[1];
      else if (valArgs[0] && valArgs[0].startsWith('--value=')) value = valArgs[0].slice(8);
      else if (valArgs[0] === '--value-stdin') value = fs.readFileSync('/dev/stdin', 'utf8');
      else if (valArgs[0] && !valArgs[0].startsWith('-')) value = valArgs[0];
      else { process.stderr.write('floom apps creator-secrets set: missing <value> or --value-stdin\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/creator-secrets/${urlencode(key)}`, {
          method: 'PUT', body: JSON.stringify({ value })
        });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'delete':
    case 'rm':
    case 'remove': {
      const slug = rest[0];
      const key = rest[1];
      if (!slug) { process.stderr.write('floom apps creator-secrets delete: missing <slug>\n'); process.exit(1); }
      if (!key) { process.stderr.write('floom apps creator-secrets delete: missing <key>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/creator-secrets/${urlencode(key)}`, { method: 'DELETE' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps creator-secrets: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsRateLimit(opts, args) {
  const sub = args[0] || '';
  const rest = args.slice(1);

  switch (sub) {
    case 'get': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps rate-limit get: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/rate-limit`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'set': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps rate-limit set: missing <slug>\n'); process.exit(1); }
      const rlArgs = rest.slice(1);
      let perHour = '';
      for (let i = 0; i < rlArgs.length; i++) {
        const a = rlArgs[i];
        if (a === '--per-hour' && rlArgs[i+1]) perHour = rlArgs[++i];
        else if (a.startsWith('--per-hour=')) perHour = a.slice(11);
        else { process.stderr.write(`floom apps rate-limit set: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!perHour) { process.stderr.write('floom apps rate-limit set: --per-hour is required\n'); process.exit(1); }
      if (perHour !== 'default' && !/^\d+$/.test(perHour)) {
        process.stderr.write('floom apps rate-limit set: --per-hour must be an integer or default\n');
        process.exit(1);
      }
      const body = { rate_limit_per_hour: perHour === 'default' ? null : parseInt(perHour, 10) };
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/apps/${urlencode(slug)}/rate-limit`, { method: 'PATCH', body: JSON.stringify(body) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps rate-limit: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsReviews(opts, verb, args) {
  // verb = 'reviews' or 'review' (singular → always submit)
  let sub = args[0] || 'list';
  let rest = args.slice(1);

  // Singular form: `apps review <slug> ...` is always submit
  if (verb === 'review') {
    sub = 'submit';
    rest = args; // no shift — slug is still args[0]
  } else if (!/^(list|submit|add|post)$/.test(sub)) {
    // Looks like a slug, default to list
    sub = 'list';
    rest = args;
  }

  switch (sub) {
    case 'list': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps reviews list: missing <slug>\n'); process.exit(1); }
      let limit = '20';
      const listArgs = rest.slice(1);
      for (let i = 0; i < listArgs.length; i++) {
        const a = listArgs[i];
        if (a === '--limit' && listArgs[i+1]) limit = listArgs[++i];
        else if (a.startsWith('--limit=')) limit = a.slice(8);
        else { process.stderr.write(`floom apps reviews list: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!/^\d+$/.test(limit)) { process.stderr.write('floom apps reviews list: --limit must be an integer\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/apps/${urlencode(slug)}/reviews?limit=${limit}`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'submit':
    case 'add':
    case 'post': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps reviews submit: missing <slug>\n'); process.exit(1); }
      const submitArgs = rest.slice(1);
      let rating = '', title = '', body = '';
      for (let i = 0; i < submitArgs.length; i++) {
        const a = submitArgs[i];
        if (a === '--rating' && submitArgs[i+1]) rating = submitArgs[++i];
        else if (a.startsWith('--rating=')) rating = a.slice(9);
        else if (a === '--title' && submitArgs[i+1]) title = submitArgs[++i];
        else if (a.startsWith('--title=')) title = a.slice(8);
        else if ((a === '--body' || a === '--comment') && submitArgs[i+1]) body = submitArgs[++i];
        else if (a.startsWith('--body=')) body = a.slice(7);
        else if (a.startsWith('--comment=')) body = a.slice(10);
        else if (a === '--body-stdin' || a === '--comment-stdin') body = fs.readFileSync('/dev/stdin', 'utf8');
        else { process.stderr.write(`floom apps reviews submit: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!/^[1-5]$/.test(rating)) {
        process.stderr.write('floom apps reviews submit: --rating must be an integer from 1 to 5\n');
        process.exit(1);
      }
      const reviewBody = { rating: parseInt(rating, 10) };
      if (title) reviewBody.title = title;
      if (body) reviewBody.body = body;
      try {
        const r = await authFetch(opts.apiUrl, `/api/apps/${urlencode(slug)}/reviews`, { method: 'POST', body: JSON.stringify(reviewBody) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps reviews: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsSource(opts, args) {
  let sub = args[0] || 'get';
  let rest = args.slice(1);

  // If first arg looks like a slug (not a subcommand), default to get
  if (sub && !/^(get|openapi|openapi-json|help)$/.test(sub) && /^[a-z0-9][a-z0-9-]*$/.test(sub)) {
    rest = args;
    sub = 'get';
  }

  switch (sub) {
    case 'get': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps source get: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/source`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'openapi':
    case 'openapi-json': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps source openapi: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/openapi.json`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps source: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAppsRenderer(opts, args) {
  const sub = args[0] || 'get';
  const rest = args.slice(1);

  switch (sub) {
    case 'get':
    case 'meta': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps renderer get: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/renderer/${urlencode(slug)}/meta`);
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'upload': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps renderer upload: missing <slug>\n'); process.exit(1); }
      const upArgs = rest.slice(1);
      let source = '', outputShape = '';
      for (let i = 0; i < upArgs.length; i++) {
        const a = upArgs[i];
        if (a === '--source-file' && upArgs[i+1]) source = fs.readFileSync(upArgs[++i], 'utf8');
        else if (a.startsWith('--source-file=')) source = fs.readFileSync(a.slice(14), 'utf8');
        else if (a === '--source-stdin') source = fs.readFileSync('/dev/stdin', 'utf8');
        else if (a === '--output-shape' && upArgs[i+1]) outputShape = upArgs[++i];
        else if (a.startsWith('--output-shape=')) outputShape = a.slice(15);
        else { process.stderr.write(`floom apps renderer upload: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!source) { process.stderr.write('floom apps renderer upload: provide --source-file or --source-stdin\n'); process.exit(1); }
      const upBody = { source };
      if (outputShape) upBody.output_shape = outputShape;
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/renderer`, { method: 'POST', body: JSON.stringify(upBody) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'delete':
    case 'rm':
    case 'remove': {
      const slug = rest[0];
      if (!slug) { process.stderr.write('floom apps renderer delete: missing <slug>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/hub/${urlencode(slug)}/renderer`, { method: 'DELETE' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom apps renderer: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

// ---- run --------------------------------------------------------------------

async function runRun(opts, args) {
  if (!args[0] || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write([
      'floom run — run a Floom app.',
      '',
      'usage:',
      '  floom run <slug>                    run app with no inputs',
      "  floom run <slug> '<json>'           run app with JSON body",
      '  floom run <slug> --input key=val    run app with key=value pairs (repeatable)',
      '  floom run <slug> --use-context      fill missing inputs from profiles',
      '  floom run <slug> --user-api-key KEY pass BYOK key as X-User-Api-Key',
      '  floom run <slug> --json             print raw JSON',
      '',
      'env:',
      '  FLOOM_USER_API_KEY                  BYOK key for gated launch apps',
      '',
      'examples:',
      '  floom run uuid',
      "  floom run competitor-lens '{\"you\":\"stripe.com\",\"rival\":\"adyen.com\"}'",
      '  floom run ai-readiness-audit --input url=https://stripe.com',
      '',
    ].join('\n'));
    process.exit(args[0] ? 0 : 1);
  }

  const slug = args[0];
  const rest = args.slice(1);

  let body = {};
  const inputPairs = [];
  let useContext = false;
  let jsonOutput = false;
  let userApiKey = process.env.FLOOM_USER_API_KEY || '';
  const waitSeconds = parseInt(process.env.FLOOM_RUN_WAIT_SECONDS || '60', 10);

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--input' && rest[i+1]) { inputPairs.push(rest[++i]); }
    else if (a.startsWith('--input=')) { inputPairs.push(a.slice(8)); }
    else if (a === '--use-context') { useContext = true; }
    else if (a === '--json') { jsonOutput = true; }
    else if (a === '--user-api-key' && rest[i+1]) { userApiKey = rest[++i]; }
    else if (a.startsWith('--user-api-key=')) { userApiKey = a.slice(15); }
    else if (!a.startsWith('-')) {
      // Raw JSON body
      try { body = JSON.parse(a); } catch (e) {
        process.stderr.write(`floom run: invalid JSON body: ${e.message}\n`);
        process.exit(1);
      }
    } else {
      process.stderr.write(`floom run: unknown option '${a}'\n`);
      process.exit(1);
    }
  }

  // Build body from --input key=val pairs
  if (inputPairs.length > 0) {
    body = {};
    for (const pair of inputPairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 0) { process.stderr.write(`floom run: --input value must be key=value, got: ${pair}\n`); process.exit(1); }
      body[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }

  if (useContext) body.use_context = true;
  userApiKey = String(userApiKey || '').trim();

  // POST to start run
  let initial;
  try {
    initial = await authFetch(opts.apiUrl, `/api/${slug}/run`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: userApiKey ? { [USER_API_KEY_HEADER]: userApiKey } : undefined,
    });
  } catch (e) {
    process.stderr.write(`floom run: ${e.message}\n`);
    process.exit(1);
  }

  const runId = initial.json && (initial.json.run_id || initial.json.id);
  if (!runId) {
    console.log(initial.body);
    return;
  }

  // Poll until terminal state
  const { apiUrl } = resolveAuth(opts.apiUrl) || { apiUrl: initial.apiUrl };
  let finalJson = initial.json;
  const deadline = Date.now() + waitSeconds * 1000;

  while (Date.now() <= deadline) {
    let snap;
    try {
      snap = await authFetch(opts.apiUrl, `/api/me/runs/${runId}`);
    } catch {
      // polling failures are non-fatal; break and use last known state
      break;
    }
    const st = snap.json && snap.json.status;
    finalJson = snap.json;
    if (['success', 'succeeded', 'error', 'failed', 'timeout'].includes(st)) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  if (jsonOutput) {
    console.log(JSON.stringify(finalJson, null, 2));
    return;
  }

  const status = (finalJson && finalJson.status) || 'pending';
  const appLabel = (finalJson && (finalJson.app_slug || finalJson.slug)) ? ` (${finalJson.app_slug || finalJson.slug})` : '';

  if (['success', 'succeeded'].includes(status)) {
    console.log(`Run succeeded: ${runId}${appLabel}`);
    const out = finalJson.outputs != null ? finalJson.outputs : finalJson.output;
    if (out != null) {
      console.log('Output:');
      console.log(JSON.stringify(out, null, 2));
    }
  } else if (['error', 'failed', 'timeout'].includes(status)) {
    process.stderr.write(`Run failed: ${runId}${appLabel}\n`);
    const err = (finalJson && (finalJson.error || finalJson.message)) || 'unknown error';
    process.stderr.write(`${err}\n`);
    process.exit(2);
  } else {
    console.log(`Run pending: ${runId}${appLabel}`);
    console.log(`Check it with: floom api GET /api/me/runs/${runId}`);
  }
}

// ---- deploy -----------------------------------------------------------------

async function runDeploy(opts, args) {
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '-h' || arg === '--help') {
      console.log('floom deploy — validate floom.yaml and publish the app.\n\nflags:\n  --dry-run    print request without sending');
      return;
    } else {
      process.stderr.write(`floom deploy: unknown flag: ${arg}\n`);
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  const yamlPath = path.join(cwd, 'floom.yaml');
  if (!fs.existsSync(yamlPath)) {
    process.stderr.write(`floom deploy: no floom.yaml in ${cwd}. Run 'floom init' first.\n`);
    process.exit(1);
  }

  const yamlSource = fs.readFileSync(yamlPath, 'utf8');
  const m = validateFloomYaml(yamlSource, yamlPath);

  const slug = m['slug'] || '';
  const name = m['name'] || '';
  const desc = m['description'] || '';
  const spec = m['openapi_spec_url'] || '';
  let vis = m['visibility'] || 'private';
  const retentionDays = m['max_run_retention_days'];
  const linkShareRequiresAuth = m['link_share_requires_auth'];
  const authRequired = m['auth_required'];

  if (!spec) {
    process.stderr.write([
      'floom deploy: custom Python/Node apps can\'t be published via HTTP yet. Options:',
      `  1. Open a PR against floomhq/floom with your dir under examples/${slug}/.`,
      '  2. Wrap your code in a thin HTTP server, publish an OpenAPI spec, then re-run \'floom deploy\'.',
    ].join('\n') + '\n');
    process.exit(1);
  }

  const deployBody = { openapi_url: spec, slug, name, description: desc, visibility: vis };
  if (linkShareRequiresAuth && linkShareRequiresAuth.toLowerCase() === 'true') {
    deployBody.link_share_requires_auth = true;
  }
  if (authRequired && authRequired.toLowerCase() === 'true') {
    deployBody.auth_required = true;
  }
  if (retentionDays) deployBody.max_run_retention_days = parseInt(retentionDays, 10);

  if (dryRun) {
    const auth = resolveAuth(opts.apiUrl);
    const apiUrl = (auth && auth.apiUrl) || opts.apiUrl || DEFAULT_API_URL;
    console.log('DRY RUN');
    console.log(`  POST ${apiUrl.replace(/\/$/, '')}/api/hub/ingest`);
    console.log('  auth: (skipped in dry-run)');
    console.log(`  body: ${JSON.stringify(deployBody)}`);
    return;
  }

  let result;
  try {
    result = await authFetch(opts.apiUrl, '/api/hub/ingest', { method: 'POST', body: JSON.stringify(deployBody) });
  } catch (e) {
    process.stderr.write(`floom deploy: ${e.message}\n`);
    process.exit(1);
  }

  console.log(result.body);

  const deployed = result.json;
  const deployedSlug = (deployed && deployed.slug) || slug;
  const deployedName = (deployed && deployed.name) || name;
  const apiUrl = result.apiUrl || DEFAULT_API_URL;

  console.log('');
  console.log(`Published: ${deployedName}`);
  console.log(`  App page:    ${apiUrl.replace(/\/$/, '')}/p/${deployedSlug}`);
  console.log(`  MCP URL:     ${apiUrl.replace(/\/$/, '')}/mcp/app/${deployedSlug}`);
  console.log(`  Owner view:  ${apiUrl.replace(/\/$/, '')}/studio/${deployedSlug}`);
  console.log('');
  console.log('Add to Claude Desktop config:');
  console.log(`  {"mcpServers":{"floom-${deployedSlug}":{"url":"${apiUrl.replace(/\/$/, '')}/mcp/app/${deployedSlug}"}}}`);
}

// ---- status -----------------------------------------------------------------

async function runStatus(opts, args) {
  let rawJson = false;
  for (const arg of args) {
    if (arg === '--json') rawJson = true;
    else if (arg === '-h' || arg === '--help') {
      console.log('floom status - list your apps and recent runs\n\nusage:\n  floom status\n  floom status --json');
      return;
    } else {
      process.stderr.write(`floom status: unknown option '${arg}'\n`);
      process.exit(1);
    }
  }

  let appsResult, runsResult;
  try {
    appsResult = await authFetch(opts.apiUrl, '/api/hub/mine');
  } catch (e) {
    process.stderr.write(`floom: ${e.message}\n`);
    process.exit(1);
  }
  try {
    runsResult = await authFetch(opts.apiUrl, '/api/me/runs?limit=10');
  } catch (e) {
    process.stderr.write(`floom: ${e.message}\n`);
    process.exit(1);
  }

  const appsData = appsResult.json;
  const runsData = runsResult.json;
  const apps = (appsData && appsData.apps) || (Array.isArray(appsData) ? appsData : []);
  const runs = (runsData && runsData.runs) || (Array.isArray(runsData) ? runsData : []);

  if (rawJson) {
    console.log(JSON.stringify({ apps, runs }, null, 2));
    return;
  }

  console.log('Your apps');
  if (!apps.length) {
    console.log('  No apps found.');
  } else {
    for (const app of apps.slice(0, 10)) {
      const appSlug = app.slug || '(unknown)';
      const appName = app.name || appSlug;
      const appStatus = app.status || 'unknown';
      const appVis = app.visibility || 'unknown';
      const runCount = app.run_count;
      const suffix = runCount != null ? ` - ${runCount} runs` : '';
      console.log(`  ${appSlug} - ${appName} (${appStatus}, ${appVis})${suffix}`);
    }
  }

  console.log('');
  console.log('Recent runs');
  if (!runs.length) {
    console.log('  No recent runs found.');
  } else {
    for (const run of runs.slice(0, 10)) {
      const runId = run.id || '(unknown)';
      const runSlug = run.app_slug || run.app_name || '(unknown app)';
      const runStatus = run.status || 'unknown';
      const started = run.started_at || '';
      const duration = run.duration_ms;
      const durationText = duration != null ? `, ${duration} ms` : '';
      console.log(`  ${runId} - ${runSlug} - ${runStatus}${durationText} ${started}`.trimEnd());
    }
  }
}

// ---- init -------------------------------------------------------------------

async function runInit(opts, args) {
  let name = '', slug = '', description = '', openapiUrl = '', appType = '', secrets = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name' && args[i+1]) name = args[++i];
    else if (a.startsWith('--name=')) name = a.slice(7);
    else if (a === '--slug' && args[i+1]) slug = args[++i];
    else if (a.startsWith('--slug=')) slug = a.slice(7);
    else if (a === '--description' && args[i+1]) description = args[++i];
    else if (a.startsWith('--description=')) description = a.slice(14);
    else if (a === '--openapi-url' && args[i+1]) openapiUrl = args[++i];
    else if (a.startsWith('--openapi-url=')) openapiUrl = a.slice(14);
    else if (a === '--type' && args[i+1]) appType = args[++i];
    else if (a.startsWith('--type=')) appType = a.slice(7);
    else if (a === '--secrets' && args[i+1]) secrets = args[++i];
    else if (a.startsWith('--secrets=')) secrets = a.slice(10);
    else if (a === '-h' || a === '--help') {
      console.log('floom init — scaffold a floom.yaml in the current directory.\n\nflags:\n  --name, --slug, --description, --openapi-url, --type, --secrets');
      return;
    } else {
      process.stderr.write(`floom init: unknown flag: ${a}\n`);
      process.exit(1);
    }
  }

  const isTTY = process.stdin.isTTY;

  if (!name) {
    if (!isTTY) { process.stderr.write('floom init: missing required field (not a TTY, use flags)\n'); process.exit(1); }
    name = await ask('App name (e.g. Lead Scorer): ');
  }
  if (!name) { process.stderr.write('floom init: name is required\n'); process.exit(1); }

  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/g, '');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) {
    process.stderr.write(`floom init: derived slug '${slug}' is invalid. Pass --slug.\n`);
    process.exit(1);
  }

  if (!description) {
    if (isTTY) description = await ask('One-sentence description: ');
    else description = `Run ${name}.`;
  }
  if (!description) { process.stderr.write('floom init: description is required\n'); process.exit(1); }

  if (!appType) {
    if (openapiUrl) appType = 'proxied';
    else if (!isTTY) appType = 'custom';
    else {
      const choice = await ask('App type: (a) proxied OpenAPI, or (b) custom Python code [a]: ');
      if (!choice || choice === 'a' || choice === 'A' || choice === 'proxied') appType = 'proxied';
      else if (choice === 'b' || choice === 'B' || choice === 'custom') appType = 'custom';
      else { process.stderr.write(`floom init: unknown type '${choice}'\n`); process.exit(1); }
    }
  }

  const cwd = process.cwd();
  const yamlPath = path.join(cwd, 'floom.yaml');
  if (fs.existsSync(yamlPath)) {
    process.stderr.write(`floom init: floom.yaml already exists in ${cwd}. Refusing to overwrite.\n`);
    process.exit(1);
  }

  if (appType === 'proxied') {
    if (!openapiUrl) {
      if (!isTTY) { process.stderr.write('floom init: missing required field (not a TTY, use flags)\n'); process.exit(1); }
      openapiUrl = await ask('OpenAPI spec URL: ');
    }
    if (!/^https?:\/\//.test(openapiUrl)) {
      process.stderr.write('floom init: openapi-url must start with http(s)://\n');
      process.exit(1);
    }
    fs.writeFileSync(yamlPath, [
      `name: ${name}`,
      `slug: ${slug}`,
      `description: ${description}`,
      'type: proxied',
      `openapi_spec_url: ${openapiUrl}`,
      'visibility: private',
      'manifest_version: "2.0"',
      '',
    ].join('\n'));
  } else {
    if (!secrets && isTTY) {
      secrets = await ask('Secrets needed (comma-separated, optional): ');
    }
    const secretsYaml = secrets
      ? '[' + secrets.split(',').map(s => s.trim()).join(', ') + ']'
      : '[]';
    fs.writeFileSync(yamlPath, [
      `name: ${name}`,
      `slug: ${slug}`,
      `description: ${description}`,
      'category: custom',
      'runtime: python',
      'actions:',
      '  run:',
      '    label: Run',
      `    description: ${description}`,
      '    inputs:',
      '      - {name: input, label: Input, type: textarea, required: true}',
      '    outputs:',
      '      - {name: result, label: Result, type: text}',
      'python_dependencies: []',
      `secrets_needed: ${secretsYaml}`,
      'manifest_version: "2.0"',
      '',
    ].join('\n'));

    const mainPy = path.join(cwd, 'main.py');
    if (!fs.existsSync(mainPy)) {
      fs.writeFileSync(mainPy, [
        'import json, sys',
        '',
        'def run(input: str) -> dict:',
        '    return {"result": f"Echo: {input}"}',
        '',
        'if __name__ == "__main__":',
        '    payload = json.loads(sys.stdin.read() or "{}")',
        '    out = run(**payload.get("inputs", {}))',
        '    print("__FLOOM_RESULT__" + json.dumps(out))',
        '',
      ].join('\n'));
    }

    const dockerfile = path.join(cwd, 'Dockerfile');
    if (!fs.existsSync(dockerfile)) {
      fs.writeFileSync(dockerfile, [
        'FROM python:3.11-slim',
        'WORKDIR /app',
        'COPY main.py .',
        'CMD ["python", "main.py"]',
        '',
      ].join('\n'));
    }
  }

  console.log(`Wrote floom.yaml (slug: ${slug}, type: ${appType})`);
  console.log('Next: floom deploy');
}

// ---- validate ---------------------------------------------------------------

function runValidate(opts, args) {
  const filePath = args[0] || 'floom.yaml';
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`floom-validate: ${filePath} not found\n`);
    process.exit(1);
  }
  const source = fs.readFileSync(filePath, 'utf8');
  validateFloomYaml(source, filePath);
}

// ---- account ----------------------------------------------------------------

async function runAccount(opts, args) {
  const resource = args[0] || '';
  const rest = args.slice(1);

  switch (resource) {
    case '':
    case '-h':
    case '--help':
    case 'help':
      printAccountHelp();
      return;

    case 'secrets':
    case 'secret':
      return runAccountSecrets(opts, rest);

    case 'context':
    case 'profile':
    case 'profiles':
      return runAccountContext(opts, rest);

    case 'agent-tokens':
    case 'agent-token':
    case 'tokens':
      return runAccountAgentTokens(opts, rest);

    default:
      process.stderr.write(`floom account: unknown resource '${resource}'\nrun 'floom account --help' for usage.\n`);
      process.exit(1);
  }
}

async function runAccountSecrets(opts, args) {
  const sub = args[0] || '';
  const rest = args.slice(1);

  switch (sub) {
    case 'list': {
      try {
        const r = await authFetch(opts.apiUrl, '/api/secrets');
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'set': {
      const key = rest[0];
      if (!key) { process.stderr.write('floom account secrets set: missing <key>\n'); process.exit(1); }
      let value = '';
      const valArgs = rest.slice(1);
      if (valArgs[0] === '--value' && valArgs[1]) value = valArgs[1];
      else if (valArgs[0] && valArgs[0].startsWith('--value=')) value = valArgs[0].slice(8);
      else if (valArgs[0] === '--value-stdin') value = fs.readFileSync('/dev/stdin', 'utf8');
      else if (valArgs[0] && !valArgs[0].startsWith('-')) value = valArgs[0];
      else { process.stderr.write('floom account secrets set: missing <value> or --value-stdin\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, '/api/secrets', { method: 'POST', body: JSON.stringify({ key, value }) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'delete':
    case 'rm':
    case 'remove': {
      const key = rest[0];
      if (!key) { process.stderr.write('floom account secrets delete: missing <key>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/secrets/${urlencode(key)}`, { method: 'DELETE' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom account secrets: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAccountContext(opts, args) {
  const sub = args[0] || 'get';
  const rest = args.slice(1);

  switch (sub) {
    case 'get': {
      try {
        const r = await authFetch(opts.apiUrl, '/api/session/context');
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'set-user':
    case 'set-workspace': {
      const scope = sub === 'set-user' ? 'user' : 'workspace';
      let json = '';
      if (rest[0] === '--json' && rest[1]) json = rest[1];
      else if (rest[0] && rest[0].startsWith('--json=')) json = rest[0].slice(7);
      else if (rest[0] === '--json-stdin') json = fs.readFileSync('/dev/stdin', 'utf8');
      else { process.stderr.write(`floom account context ${sub}: provide --json or --json-stdin\n`); process.exit(1); }
      let profile;
      try { profile = JSON.parse(json); } catch (e) {
        process.stderr.write(`floom account context: invalid JSON: ${e.message}\n`); process.exit(1);
      }
      const key = scope === 'user' ? 'user_profile' : 'workspace_profile';
      try {
        const r = await authFetch(opts.apiUrl, '/api/session/context', { method: 'PATCH', body: JSON.stringify({ [key]: profile }) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom account context: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

async function runAccountAgentTokens(opts, args) {
  const sub = args[0] || 'list';
  const rest = args.slice(1);

  switch (sub) {
    case '-h':
    case '--help':
    case 'help':
      printAccountAgentTokensHelp();
      return;

    case 'list': {
      try {
        const r = await authFetch(opts.apiUrl, '/api/me/agent-keys');
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'create': {
      let label = '', scope = '', workspaceId = '', rateLimit = '';
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--label' && rest[i+1]) label = rest[++i];
        else if (a.startsWith('--label=')) label = a.slice(8);
        else if (a === '--scope' && rest[i+1]) scope = rest[++i];
        else if (a.startsWith('--scope=')) scope = a.slice(8);
        else if (a === '--workspace-id' && rest[i+1]) workspaceId = rest[++i];
        else if (a.startsWith('--workspace-id=')) workspaceId = a.slice(15);
        else if (a === '--rate-limit-per-minute' && rest[i+1]) rateLimit = rest[++i];
        else if (a.startsWith('--rate-limit-per-minute=')) rateLimit = a.slice(24);
        else { process.stderr.write(`floom account agent-tokens create: unknown option '${a}'\n`); process.exit(1); }
      }
      if (!label || !scope) { process.stderr.write('floom account agent-tokens create: --label and --scope are required\n'); process.exit(1); }
      if (!['read', 'read-write', 'publish-only'].includes(scope)) {
        process.stderr.write(`floom account agent-tokens create: invalid --scope '${scope}'\n`); process.exit(1);
      }
      if (rateLimit && !/^\d+$/.test(rateLimit)) {
        process.stderr.write('floom account agent-tokens create: --rate-limit-per-minute must be an integer\n'); process.exit(1);
      }
      const body = { label, scope };
      if (workspaceId) body.workspace_id = workspaceId;
      if (rateLimit) body.rate_limit_per_minute = parseInt(rateLimit, 10);
      try {
        const r = await authFetch(opts.apiUrl, '/api/me/agent-keys', { method: 'POST', body: JSON.stringify(body) });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    case 'revoke': {
      const tokenId = rest[0];
      if (!tokenId) { process.stderr.write('floom account agent-tokens revoke: missing <token-id>\n'); process.exit(1); }
      try {
        const r = await authFetch(opts.apiUrl, `/api/me/agent-keys/${urlencode(tokenId)}/revoke`, { method: 'POST' });
        console.log(r.body);
      } catch (e) { process.stderr.write(`floom: ${e.message}\n`); process.exit(1); }
      return;
    }

    default:
      process.stderr.write(`floom account agent-tokens: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

// ---- api --------------------------------------------------------------------

async function runApi(opts, args) {
  if (!args[0] || args[0] === '-h' || args[0] === '--help') {
    console.log('floom api — call raw API endpoints with saved auth.\n\nusage:\n  floom api GET /api/health\n  floom api POST /api/hub/ingest \'{"openapi_url":"..."}\'\n');
    process.exit(args[0] ? 0 : 1);
  }

  const method = args[0].toUpperCase();
  const urlPath = args[1];
  const rawBody = args[2];

  if (!urlPath) {
    process.stderr.write('floom api: missing <PATH>\n');
    process.exit(1);
  }

  const fetchOpts = { method };
  if (rawBody) fetchOpts.body = rawBody;

  let result;
  try {
    result = await authFetch(opts.apiUrl, urlPath, fetchOpts);
  } catch (e) {
    process.stderr.write(`floom: ${e.message}\n`);
    process.exit(1);
  }

  console.log(result.body);
}

// ---- help -------------------------------------------------------------------

function printAppsHelp() {
  console.log(`floom apps - manage your Floom apps.

usage:
  floom apps get <slug>
  floom apps list [--json]
  floom apps installed
  floom apps fork <slug> [--slug <new-slug>] [--name <name>]
  floom apps claim <slug>
  floom apps install <slug>
  floom apps uninstall <slug>
  floom apps update <slug> [--visibility private] [--primary-action <action>|--clear-primary-action] [--run-rate-limit-per-hour <n>|--clear-run-rate-limit]
  floom apps delete <slug>

  floom apps sharing get <slug>
  floom apps sharing set <slug> --state <private|link|invited> [--comment <text>] [--rotate-link-token]
  floom apps sharing invite <slug> (--email <email>|--username <username>)
  floom apps sharing revoke-invite <slug> <invite-id>
  floom apps sharing submit-review <slug>
  floom apps sharing withdraw-review <slug>

  floom apps secret-policies list <slug>
  floom apps secret-policies set <slug> <key> --policy <user_vault|creator_override>

  floom apps creator-secrets set <slug> <key> <value>
  floom apps creator-secrets delete <slug> <key>

  floom apps rate-limit get <slug>
  floom apps rate-limit set <slug> --per-hour <n|default>

  floom apps reviews list <slug> [--limit <n>]
  floom apps reviews submit <slug> --rating <1-5> [--title <text>] [--body <text>]
  floom apps review <slug> --rating <1-5> [--comment <text>]

  floom apps source get <slug>
  floom apps source openapi <slug>

  floom apps renderer get <slug>
  floom apps renderer upload <slug> (--source-file <path>|--source-stdin) [--output-shape <shape>]
  floom apps renderer delete <slug>
`);
}

function printAccountHelp() {
  console.log(`floom account - manage workspace secrets and agent tokens.

usage:
  floom account secrets list
  floom account secrets set <key> <value>
  floom account secrets delete <key>

  floom account context get
  floom account context set-user --json '{"name":"Federico"}'
  floom account context set-workspace --json '{"company":{"name":"Floom"}}'

  floom account agent-tokens list
  floom account agent-tokens create --label <label> --scope <read|read-write|publish-only>
  floom account agent-tokens revoke <token-id>

note:
  Agent-token management requires a browser session. Agent tokens are rejected
  for creating, listing, or revoking other Agent tokens; open
  /settings/agent-tokens in a signed-in browser for that flow.
`);
}

function printAccountAgentTokensHelp() {
  console.log(`floom account agent-tokens - manage Agent tokens.

usage:
  floom account agent-tokens list
  floom account agent-tokens create --label <label> --scope <read|read-write|publish-only>
  floom account agent-tokens revoke <token-id>

note:
  browser-session boundary: this flow requires a signed-in browser session on
  the server. Agent tokens are rejected for creating, listing, or revoking other
  Agent tokens; open /settings/agent-tokens in a signed-in browser for that flow.
`);
}

function printHelp() {
  console.log(`
${c.bold('floom')} — one command to set up Floom and run AI apps from any agent.

${c.bold('usage:')}
  floom setup                  ${c.dim('# interactive: mint a token, save config, print next steps')}
  floom login                  ${c.dim('# open token page + print noninteractive login command')}
  floom auth <agent-token>     ${c.dim('# save token non-interactively')}
  floom auth login --token=... ${c.dim('# validate token, then save config non-interactively')}
  floom auth whoami            ${c.dim('# print identity for current token')}
  floom run <slug> [json]      ${c.dim('# run a Floom app by slug, poll, and print result')}
  floom run <slug> --input k=v ${c.dim('# pass repeatable key=value inputs')}
  floom run <slug> --user-api-key KEY ${c.dim('# pass BYOK key for gated apps')}
  floom run <slug> --json      ${c.dim('# print raw final run JSON')}
  floom apps list [--json]     ${c.dim('# list workspace apps')}
  floom deploy                 ${c.dim('# validate + publish current floom.yaml')}
  floom init                   ${c.dim('# scaffold floom.yaml in current dir')}
  floom status [--json]        ${c.dim('# list apps and recent runs')}
  floom account                ${c.dim('# manage secrets; agent-token commands need a browser session')}
  floom api <METHOD> <PATH>    ${c.dim('# call raw API endpoints with saved auth')}
  floom validate [file]        ${c.dim('# validate a floom.yaml')}

${c.bold('options:')}
  --help, -h                   show this help
  --version, -v                print version
  --api-url <url>              override API host (default: ${DEFAULT_API_URL})

${c.bold('config:')}  ${CONFIG_PATH}
${c.bold('docs:')}    https://floom.dev/docs

${c.dim('@floomhq/cli v' + VERSION)}
`);
}

// ---- entrypoint -------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printHelp();
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION);
    return;
  }

  // Parse top-level --api-url
  let apiUrl = null;
  const filtered = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--api-url' && argv[i + 1]) {
      apiUrl = argv[i + 1];
      i++;
    } else if (argv[i].startsWith('--api-url=')) {
      apiUrl = argv[i].slice('--api-url='.length);
    } else {
      filtered.push(argv[i]);
    }
  }

  const opts = { apiUrl };
  const sub = filtered[0];
  const rest = filtered.slice(1);

  switch (sub) {
    case 'login':
      printBrowserLogin(apiUrl || DEFAULT_API_URL);
      return;

    case 'setup':
      if (rest[0] === '-h' || rest[0] === '--help') {
        console.log([
          'floom setup — interactive: mint a token, save config, print next steps.',
          '',
          'usage:',
          '  floom setup                           run the interactive setup wizard',
          '  floom setup --api-url=<url>           connect to a self-hosted instance',
          '',
          'The wizard opens your browser to mint an Agent token, then prompts you to',
          'paste it. On success it writes ~/.floom/config.json and verifies the token.',
          '',
          'Get your Agent token:',
          '  https://floom.dev/settings/agent-tokens',
        ].join('\n'));
        return;
      }
      await runSetup(opts);
      return;

    case 'auth': {
      const authSub = rest[0] || '';
      switch (authSub) {
        case 'whoami':
          await runWhoami(opts);
          return;
        case 'login':
          await runAuthLogin(rest.slice(1), apiUrl);
          return;
        case 'logout':
        case '--clear':
          runAuthLogout();
          return;
        case '--show':
          await runAuthShow();
          return;
        case '-h':
        case '--help':
        case 'help':
          console.log([
            'floom auth — manage Agent token authentication.',
            '',
            'usage:',
            '  floom auth login                       open token page + print login command',
            '  floom auth login --token=<token>       save token (recommended form)',
            '  floom auth <agent-token>               save token (shorthand)',
            '  floom auth whoami                      show identity for current token',
            '  floom auth logout                      clear saved token',
            '  floom auth --show                      print redacted config',
            '',
            'Get your Agent token:',
            '  https://floom.dev/settings/agent-tokens',
          ].join('\n'));
          return;
        default:
          // floom auth <token> [api-url]
          if (authSub && authSub !== '') {
            await runAuthSaveToken(authSub, apiUrl || rest[1]);
          } else {
            process.stderr.write('floom auth: missing subcommand\n');
            process.exit(1);
          }
          return;
      }
    }

    case 'apps':
      await runApps(opts, rest);
      return;

    case 'run':
      await runRun(opts, rest);
      return;

    case 'deploy':
      await runDeploy(opts, rest);
      return;

    case 'status':
      await runStatus(opts, rest);
      return;

    case 'init':
      await runInit(opts, rest);
      return;

    case 'validate':
      runValidate(opts, rest);
      return;

    case 'account':
      await runAccount(opts, rest);
      return;

    case 'api':
      await runApi(opts, rest);
      return;

    default:
      // Try to handle legacy `floom <token>` and `floom <token> <api-url>` forms
      if (sub && looksLikeToken(sub)) {
        await runAuthSaveToken(sub, rest[0]);
        return;
      }
      console.error(c.red(`floom: unknown command '${sub}'`));
      console.error('Run ' + c.cyan('floom --help') + ' for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red('error:'), err && err.message ? err.message : err);
  process.exit(1);
});
