#!/usr/bin/env node
// Virgin MCP client setup regression.
//
// Boots the built server against a throwaway DATA_DIR, mints a local agent
// token directly in SQLite, then verifies first-run MCP/client setup paths
// without production credentials or persistent user config.

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-virgin-mcp-clients-'));
const dataDir = join(tmp, 'data');
const projectDir = join(tmp, 'project');
mkdirSync(dataDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
process.env.FLOOM_RATE_LIMIT_USER_PER_HOUR = '1000';
process.env.FLOOM_RATE_LIMIT_IP_PER_HOUR = '1000';
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

function skip(label, detail) {
  passed++;
  console.log(`  skip ${label}${detail ? ' :: ' + detail : ''}`);
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

async function stopServer(server) {
  server.proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function runCmd(cmd, args, opts = {}) {
  return await new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd || REPO_ROOT,
      env: opts.env || process.env,
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
    proc.on('error', (err) => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function commandExists(cmd) {
  const res = await runCmd('bash', ['-lc', `command -v ${cmd}`]);
  return res.code === 0;
}

function createToken() {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES ('agtok_virgin_mcp_clients', ?, ?, 'virgin-mcp-clients', 'read-write',
        'local', 'local', ?, NULL, NULL, 1000)`,
  ).run(
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

async function callMcp(baseUrl, token) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

function toolNames(resp) {
  return (resp.json?.result?.tools || []).map((tool) => tool.name).sort();
}

function includesAll(names, expected) {
  return expected.every((name) => names.includes(name));
}

function cleanHome(name) {
  const home = join(tmp, name);
  mkdirSync(home, { recursive: true });
  return home;
}

function cleanEnv(home, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    PATH: `${join(REPO_ROOT, 'cli/floom/bin')}${delimiter}${process.env.PATH}`,
    ...extra,
  };
  delete env.FLOOM_CONFIG;
  delete env.FLOOM_API_KEY;
  delete env.FLOOM_API_URL;
  return env;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function testCodexRegistration(baseUrl, token) {
  if (!(await commandExists('codex'))) {
    skip('Codex CLI registration no-token', 'codex CLI is not installed');
    skip('Codex CLI registration token', 'codex CLI is not installed');
    return;
  }

  const home = cleanHome('home-codex');
  const env = cleanEnv(home, { FLOOM_AGENT_TOKEN: token });
  const admin = await runCmd('codex', ['mcp', 'add', 'floom-local-admin', '--url', `${baseUrl}/mcp`], { env });
  log('Codex clean HOME registers no-token /mcp', admin.code === 0, `${admin.stdout}\n${admin.stderr}`);

  const agent = await runCmd(
    'codex',
    ['mcp', 'add', 'floom-local-agent', '--url', `${baseUrl}/mcp`, '--bearer-token-env-var', 'FLOOM_AGENT_TOKEN'],
    { env },
  );
  log('Codex clean HOME registers token /mcp via env var', agent.code === 0, `${agent.stdout}\n${agent.stderr}`);

  const list = await runCmd('codex', ['mcp', 'list', '--json'], { env });
  const cfg = parseJson(list.stdout);
  const servers = Array.isArray(cfg) ? Object.fromEntries(cfg.map((s) => [s.name, s])) : cfg?.mcp_servers || cfg?.mcpServers || {};
  const adminCfg = servers['floom-local-admin'];
  const agentCfg = servers['floom-local-agent'];
  log(
    'Codex list shows no-token server at local /mcp',
    list.code === 0 && JSON.stringify(adminCfg || {}).includes(`${baseUrl}/mcp`),
    `${list.stdout}\n${list.stderr}`,
  );
  log(
    'Codex list shows token server uses FLOOM_AGENT_TOKEN not raw token',
    list.code === 0 &&
      JSON.stringify(agentCfg || {}).includes('FLOOM_AGENT_TOKEN') &&
      !JSON.stringify(agentCfg || {}).includes(token),
    `${list.stdout}\n${list.stderr}`,
  );
}

async function testKimiRegistration(baseUrl, token) {
  if (!(await commandExists('kimi'))) {
    skip('Kimi CLI mcp add/test no-token', 'kimi CLI is not installed');
    skip('Kimi CLI mcp add/test token', 'kimi CLI is not installed');
    return;
  }

  const home = cleanHome('home-kimi');
  const env = cleanEnv(home);
  const admin = await runCmd('kimi', ['mcp', 'add', '--transport', 'http', 'floom-local-admin', `${baseUrl}/mcp`], { env });
  log('Kimi clean HOME registers no-token /mcp', admin.code === 0, `${admin.stdout}\n${admin.stderr}`);
  const adminTest = await runCmd('kimi', ['mcp', 'test', 'floom-local-admin'], { env });
  log(
    'Kimi clean HOME tests no-token /mcp admin tools',
    adminTest.code === 0 && adminTest.stdout.includes('ingest_app'),
    `${adminTest.stdout}\n${adminTest.stderr}`,
  );

  const agent = await runCmd(
    'kimi',
    ['mcp', 'add', '--transport', 'http', '--header', `Authorization: Bearer ${token}`, 'floom-local-agent', `${baseUrl}/mcp`],
    { env },
  );
  log('Kimi clean HOME registers token /mcp', agent.code === 0, `${agent.stdout}\n${agent.stderr}`);
  const agentTest = await runCmd('kimi', ['mcp', 'test', 'floom-local-agent'], { env });
  log(
    'Kimi clean HOME tests token /mcp agent tools',
    agentTest.code === 0 && agentTest.stdout.includes('run_app') && agentTest.stdout.includes('studio_publish_app'),
    `${agentTest.stdout}\n${agentTest.stderr}`,
  );
}

async function testFloomCliDefaultHost(baseUrl, token) {
  writeFileSync(
    join(projectDir, 'floom.yaml'),
    [
      'name: Virgin CLI Default Host',
      'slug: virgin-cli-default-host',
      'description: Dry-run host resolution fixture',
      'type: proxied',
      'openapi_spec_url: http://127.0.0.1/openapi.json',
      'visibility: private',
      'manifest_version: "2.0"',
      '',
    ].join('\n'),
  );

  const home = cleanHome('home-floom-cli');
  const env = cleanEnv(home);
  const floom = join(REPO_ROOT, 'cli/floom/bin/floom');

  const prodDryRun = await runCmd('bash', [floom, 'deploy', '--dry-run'], { cwd: projectDir, env });
  log(
    'Floom CLI clean HOME dry-run defaults to https://floom.dev',
    prodDryRun.code === 0 && prodDryRun.stdout.includes('POST https://floom.dev/api/hub/ingest'),
    `${prodDryRun.stdout}\n${prodDryRun.stderr}`,
  );

  mkdirSync(join(home, '.floom'), { recursive: true });
  writeFileSync(join(home, '.floom', 'default-host'), baseUrl);
  const localDryRun = await runCmd('bash', [floom, 'deploy', '--dry-run'], { cwd: projectDir, env });
  log(
    'Floom CLI clean HOME dry-run honors ~/.floom/default-host',
    localDryRun.code === 0 && localDryRun.stdout.includes(`POST ${baseUrl}/api/hub/ingest`),
    `${localDryRun.stdout}\n${localDryRun.stderr}`,
  );

  const auth = await runCmd('bash', [floom, 'auth', 'login', `--token=${token}`], { env });
  const configPath = join(home, '.floom', 'config.json');
  const cfg = existsSync(configPath) ? parseJson(readFileSync(configPath, 'utf8')) : null;
  log('Floom CLI auth login accepts local token via default-host', auth.code === 0, `${auth.stdout}\n${auth.stderr}`);
  log(
    'Floom CLI auth login writes local api_url to config',
    cfg?.api_key === token && cfg?.api_url === baseUrl,
    JSON.stringify(cfg),
  );
}

console.log('Virgin MCP clients');

const token = createToken();
const server = await bootServer();
const baseUrl = `http://localhost:${server.port}`;

try {
  const adminList = await callMcp(baseUrl, null);
  const adminNames = toolNames(adminList);
  log('raw /mcp no-token tools/list returns HTTP 200', adminList.res.status === 200, adminList.text);
  log(
    'raw /mcp no-token exposes admin tools',
    includesAll(adminNames, ['detect_inline', 'get_app', 'ingest_app', 'ingest_hint', 'list_apps', 'search_apps']),
    JSON.stringify(adminNames),
  );

  const agentList = await callMcp(baseUrl, token);
  const agentNames = toolNames(agentList);
  log('raw /mcp token tools/list returns HTTP 200', agentList.res.status === 200, agentList.text);
  log(
    'raw /mcp token exposes run/studio/account/trigger/workspace/feedback tools',
    includesAll(agentNames, [
      'run_app',
      'studio_publish_app',
      'account_get',
      'trigger_create',
      'workspace_list',
      'feedback_submit',
    ]),
    JSON.stringify(agentNames),
  );
  log('raw /mcp token does not expose admin ingest_app', !agentNames.includes('ingest_app'), JSON.stringify(agentNames));

  await testCodexRegistration(baseUrl, token);
  await testKimiRegistration(baseUrl, token);
  await testFloomCliDefaultHost(baseUrl, token);
} finally {
  await stopServer(server);
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
