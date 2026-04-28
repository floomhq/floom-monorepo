#!/usr/bin/env node
/**
 * @floomhq/cli — Node wrapper around the bundled bash CLI in vendor/floom/.
 *
 * Strategy:
 *  - Most subcommands forward straight to vendor/floom/bin/floom (the bash
 *    implementation, copied at build time from cli/floom/ in the floomhq/floom
 *    monorepo).
 *  - The `setup` subcommand is implemented in Node so it can run on any
 *    platform (including Windows), launch a browser, and prompt the user
 *    for a token interactively without requiring bash.
 *
 * Quickstart:
 *   npx @floomhq/cli@latest setup
 *
 * Env overrides:
 *   FLOOM_API_URL    override the API host (default: https://floom.dev)
 *   FLOOM_CONFIG     override the config path (default: ~/.floom/config.json)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const VERSION = '0.2.0';
const DEFAULT_API_URL = process.env.FLOOM_API_URL || 'https://floom.dev';
const CONFIG_PATH = process.env.FLOOM_CONFIG || path.join(os.homedir(), '.floom', 'config.json');

const BUNDLED_BASH = path.resolve(__dirname, '..', 'vendor', 'floom', 'bin', 'floom');

// ---- color helpers (no deps) ---------------------------------------------

const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;
const c = {
  bold: (s) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[22m`),
  dim: (s) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[22m`),
  green: (s) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[39m`),
  red: (s) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[39m`),
  cyan: (s) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[39m`),
  yellow: (s) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[39m`),
};

// ---- helpers --------------------------------------------------------------

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeConfig(conf) {
  ensureDir(path.dirname(CONFIG_PATH));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2) + '\n', { mode: 0o600 });
}

function openInBrowser(url) {
  if (process.env.FLOOM_CLI_NO_BROWSER === '1' || process.env.FLOOM_NO_BROWSER === '1') {
    return false;
  }
  // No deps. Best-effort cross-platform open. Falls back to printing the URL.
  const cmds =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '""', url]]]
      : [
          ['xdg-open', [url]],
          ['gnome-open', [url]],
        ];
  for (const [cmd, args] of cmds) {
    try {
      execSync(`${cmd} --help`, { stdio: 'ignore' });
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.unref();
      return true;
    } catch {
      // try next
    }
  }
  return false;
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

function looksLikeToken(s) {
  return /^floom_(agent|user)_[A-Za-z0-9_\-]{16,}$/.test(s);
}

async function verifyToken(apiUrl, token) {
  const url = `${apiUrl.replace(/\/$/, '')}/api/session/me`;
  let res;
  let body = '';
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    body = await res.text();
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err && err.message ? err.message : String(err)}`);
  }
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    // Keep json null; the status still drives validation.
  }
  if (!res.ok) {
    const code = json && (json.code || json.error) ? ` (${json.code || json.error})` : '';
    throw new Error(`token rejected by ${apiUrl.replace(/\/$/, '')}: HTTP ${res.status}${code}`);
  }
  return json || {};
}

// ---- setup ----------------------------------------------------------------

async function runSetup(opts) {
  const apiUrl = opts.apiUrl || DEFAULT_API_URL;
  const tokenUrl = `${apiUrl.replace(/\/$/, '')}/me/agent-keys`;

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
      console.log(c.yellow('  That does not look like a Floom token (expected floom_agent_… or floom_user_…). Try again or press Ctrl+C.'));
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

  // Save config.
  const existing = readConfig() || {};
  const next = {
    ...existing,
    api_url: apiUrl,
    api_key: token,
    saved_at: new Date().toISOString(),
  };
  writeConfig(next);

  console.log('');
  console.log(c.green('  ✓ Token saved to ') + c.dim(CONFIG_PATH));
  const user = identity.user || {};
  const label = user.email || user.id || identity.user_id || 'verified token';
  console.log(c.green('  ✓ Verified ') + c.dim(String(label)));
  console.log('');
  console.log('  ' + c.bold('Next:'));
  console.log('  ' + c.dim('  • Verify: ') + 'floom auth whoami');
  console.log('  ' + c.dim('  • Run an app: ') + 'floom run uuid');
  console.log('  ' + c.dim('  • MCP config: ') + `${apiUrl.replace(/\/$/, '')}/mcp`);
  console.log('');
  console.log('  ' + c.bold('Connect Claude Desktop, Cursor, Codex, or any MCP client'));
  console.log('  ' + c.dim('  Add to your MCP config:'));
  console.log('');
  console.log(c.cyan('  {'));
  console.log(c.cyan(`    "mcpServers": { "floom": { "url": "${apiUrl.replace(/\/$/, '')}/mcp", "headers": { "Authorization": "Bearer ${token.slice(0, 16)}…" } } }`));
  console.log(c.cyan('  }'));
  console.log('');
  console.log(c.green('  Done.'));
  console.log('');
}

// ---- bash forwarder -------------------------------------------------------

function forwardToBash(args) {
  if (!fs.existsSync(BUNDLED_BASH)) {
    console.error(c.red(`error: bundled CLI not found at ${BUNDLED_BASH}`));
    console.error('this is a packaging bug — please report at https://github.com/floomhq/floom/issues');
    process.exit(2);
  }
  if (process.platform === 'win32') {
    console.error(c.red('error: floom CLI subcommands are not yet supported on Windows.'));
    console.error('Use ' + c.cyan('npx @floomhq/cli setup') + ' to mint a token, then call the HTTP API directly.');
    console.error('Track Windows support: https://github.com/floomhq/floom/issues');
    process.exit(2);
  }
  // On unix, exec bash with the bundled script. Pass args through verbatim.
  const result = spawn('bash', [BUNDLED_BASH, ...args], { stdio: 'inherit' });
  result.on('exit', (code) => process.exit(code ?? 0));
}

// ---- help -----------------------------------------------------------------

function printHelp() {
  console.log(`
${c.bold('floom')} — one command to set up Floom and run AI apps from any agent.

${c.bold('usage:')}
  floom setup                  ${c.dim('# interactive: mint a token, save config, print next steps')}
  floom auth <agent-token>     ${c.dim('# save token non-interactively')}
  floom auth whoami            ${c.dim('# print identity for current token')}
  floom run <slug> [json]      ${c.dim('# run a Floom app by slug')}
  floom apps list              ${c.dim('# list workspace apps')}
  floom deploy                 ${c.dim('# validate + publish current floom.yaml')}
  floom init                   ${c.dim('# scaffold floom.yaml in current dir')}
  floom status                 ${c.dim('# list apps and recent runs')}
  floom account                ${c.dim('# manage workspace secrets and tokens')}

${c.bold('options:')}
  --help, -h                   show this help
  --version, -v                print version
  --api-url <url>              override API host (default: ${DEFAULT_API_URL})

${c.bold('config:')}  ${CONFIG_PATH}
${c.bold('docs:')}    https://floom.dev/docs

${c.dim('@floomhq/cli v' + VERSION)}
`);
}

// ---- entrypoint -----------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);

  // Top-level flags before subcommand.
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printHelp();
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION);
    return;
  }

  // Parse --api-url if present (for setup).
  let apiUrl = DEFAULT_API_URL;
  const filtered = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--api-url' && argv[i + 1]) {
      apiUrl = argv[i + 1];
      i++;
    } else {
      filtered.push(argv[i]);
    }
  }

  const sub = filtered[0];

  if (sub === 'setup') {
    await runSetup({ apiUrl });
    return;
  }

  // Forward everything else to bundled bash CLI.
  forwardToBash(filtered);
}

main().catch((err) => {
  console.error(c.red('error:'), err && err.message ? err.message : err);
  process.exit(1);
});
