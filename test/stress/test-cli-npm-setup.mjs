#!/usr/bin/env node
// Verifies the npm wrapper's first-run setup writes config compatible with the
// bundled bash CLI and that `floom auth whoami` verifies against the API.

import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-cli-npm-setup-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
delete process.env.FLOOM_CLOUD_MODE;
delete process.env.FLOOM_AUTH_TOKEN;

const { db } = await import('../../apps/server/dist/db.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');

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

async function getFreePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate port')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message || 'no response'}`);
}

function createToken() {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, 'cli-npm-setup', 'read-write', 'local', 'local', ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_cli_npm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

async function bootServer() {
  const port = await getFreePort();
  const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHttp(`http://localhost:${port}/api/health`, 20_000);
  } catch (err) {
    proc.kill('SIGTERM');
    throw new Error(`${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { port, proc };
}

function run(cmd, args, env, input) {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env,
    input,
    encoding: 'utf8',
  });
}

console.log('CLI npm setup compatibility');

const token = createToken();
const server = await bootServer();
try {
  const apiUrl = `http://localhost:${server.port}`;
  const configPath = join(tmp, 'config.json');
  const env = {
    ...process.env,
    FLOOM_CONFIG: configPath,
    FLOOM_CLI_NO_BROWSER: '1',
    NO_COLOR: '1',
  };

  const setup = run('node', [join(REPO_ROOT, 'cli-npm/src/index.js'), 'setup', '--api-url', apiUrl], env, `${token}\n`);
  log('cli-npm setup exits 0', setup.status === 0, setup.stdout + setup.stderr);

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  log('cli-npm setup writes api_key', config.api_key === token, JSON.stringify(config));
  log('cli-npm setup does not write incompatible agent_token-only config', !('agent_token' in config), JSON.stringify(config));

  const whoami = run('bash', [join(REPO_ROOT, 'cli/floom/bin/floom'), 'auth', 'whoami'], env);
  log('floom auth whoami verifies setup token', whoami.status === 0 && whoami.stdout.includes('logged in'), whoami.stdout + whoami.stderr);

  const invalidConfig = join(tmp, 'invalid-config.json');
  writeFileSync(
    invalidConfig,
    JSON.stringify({ api_key: agentTokens.generateAgentToken(), api_url: apiUrl }) + '\n',
    { mode: 0o600 },
  );
  const invalid = run(
    'bash',
    [join(REPO_ROOT, 'cli/floom/bin/floom'), 'auth', 'whoami'],
    { ...env, FLOOM_CONFIG: invalidConfig },
  );
  log('floom auth whoami rejects bogus token', invalid.status !== 0 && invalid.stderr.includes('Token rejected'), invalid.stdout + invalid.stderr);

  const legacyConfig = join(tmp, 'legacy-config.json');
  writeFileSync(
    legacyConfig,
    JSON.stringify({ agent_token: token, api_url: apiUrl }) + '\n',
    { mode: 0o600 },
  );
  const legacy = run(
    'bash',
    [join(REPO_ROOT, 'cli/floom/bin/floom'), 'auth', 'whoami'],
    { ...env, FLOOM_CONFIG: legacyConfig },
  );
  log('floom auth whoami accepts legacy agent_token config', legacy.status === 0 && legacy.stdout.includes('logged in'), legacy.stdout + legacy.stderr);
} finally {
  server.proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 150));
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
