#!/usr/bin/env node
// Regression coverage for the published npm CLI packaging surface.

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'cli-npm/dist/index.js');

let passed = 0;
let failed = 0;

function log(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

function run(args, env = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      FLOOM_CLI_NO_BROWSER: '1',
      FLOOM_NO_BROWSER: '1',
      NO_COLOR: '1',
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

function runAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        FLOOM_CLI_NO_BROWSER: '1',
        FLOOM_NO_BROWSER: '1',
        NO_COLOR: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({
        status: status ?? -1,
        stdout,
        stderr,
        combined: stdout + stderr,
      });
    });
  });
}

function startMockApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization || '',
      userApiKey: req.headers['x-user-api-key'] || '',
    });
    res.setHeader('content-type', 'application/json');

    if (req.method === 'GET' && req.url === '/api/session/me') {
      res.end(JSON.stringify({
        user: { id: 'user_cli', email: 'cli@example.com' },
        active_workspace: { id: 'ws_cli', name: 'CLI Workspace' },
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/byok-app/run') {
      res.end(JSON.stringify({ run_id: 'run_byok_cli', status: 'pending' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/me/runs/run_byok_cli') {
      res.end(JSON.stringify({
        id: 'run_byok_cli',
        app_slug: 'byok-app',
        status: 'success',
        outputs: { ok: true },
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('mock API did not bind'));
        return;
      }
      resolve({
        apiUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

console.log('CLI npm parity regressions');

const cliPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'cli-npm/package.json'), 'utf8'));
const version = run(['--version']);
log('cli-npm --version matches package.json', version.status === 0 && version.stdout.trim() === cliPackage.version, version.combined);

const legacySource = readFileSync(join(REPO_ROOT, 'packages/cli/src/index.ts'), 'utf8');
log('packages/cli runtime reads package version', legacySource.includes('.version(version)'), legacySource);
log('packages/cli help marks deprecated surface', legacySource.includes('Deprecated compatibility stub'), legacySource);

const mock = await startMockApi();
try {
  const tmp = mkdtempSync(join(tmpdir(), 'floom-cli-npm-parity-'));
  try {
    const token = 'floom_agent_0123456789abcdef0123456789ABCDEF';
    const configPath = join(tmp, 'config.json');
    const auth = await runAsync(['--api-url', mock.apiUrl, 'auth', token], {
      FLOOM_CONFIG: configPath,
      FLOOM_API_KEY: '',
    });
    const config = auth.status === 0 ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    log(
      'top-level --api-url forwards to auth shorthand',
      auth.status === 0 && config.api_url === mock.apiUrl && config.api_key === token,
      auth.combined + JSON.stringify(config),
    );

    const accountHelp = run(['account', '--help'], {
      FLOOM_CONFIG: join(tmp, 'missing.json'),
      FLOOM_API_KEY: '',
    });
    log(
      'account help states browser-session boundary',
      accountHelp.status === 0 &&
        accountHelp.stdout.includes('browser session') &&
        accountHelp.stdout.includes('Agent tokens are rejected'),
      accountHelp.combined,
    );

    const byok = await runAsync(['--api-url', mock.apiUrl, 'run', 'byok-app', '--user-api-key', 'AIza' + 'X'.repeat(35)], {
      FLOOM_CONFIG: join(tmp, 'missing.json'),
      FLOOM_API_KEY: token,
      FLOOM_RUN_WAIT_SECONDS: '1',
    });
    const runRequest = mock.requests.find((request) => request.method === 'POST' && request.url === '/api/byok-app/run');
    log(
      'run --user-api-key forwards X-User-Api-Key',
      byok.status === 0 &&
        byok.stdout.includes('Run succeeded: run_byok_cli') &&
        runRequest?.userApiKey === 'AIza' + 'X'.repeat(35),
      byok.combined + JSON.stringify(runRequest),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} finally {
  await mock.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
