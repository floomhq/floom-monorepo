#!/usr/bin/env node
// CLI onboarding P0 regression tests.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'cli/floom/bin/floom');

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

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn('bash', [CLI, ...args], {
      cwd: opts.cwd || REPO_ROOT,
      env: {
        ...process.env,
        FLOOM_API_URL: opts.apiUrl || process.env.FLOOM_API_URL || 'http://127.0.0.1:1',
        FLOOM_API_KEY: 'floom_agent_0123456789abcdef0123456789abcdef',
        FLOOM_RUN_WAIT_SECONDS: '2',
        NO_COLOR: '1',
        ...(opts.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', (status) => resolve({ status, stdout, stderr }));
    if (opts.input !== undefined) proc.stdin.end(opts.input);
    else proc.stdin.end();
  });
}

function startMockApi() {
  let runPolls = 0;
  let publicRunPolls = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    res.setHeader('content-type', 'application/json');

    if (req.method === 'GET' && url.pathname === '/api/hub/mine') {
      res.end(JSON.stringify({
        apps: [{
          slug: 'test-app',
          name: 'Test App',
          status: 'active',
          visibility: 'private',
          run_count: 3,
          last_run_at: '2026-04-29T00:00:00.000Z',
        }],
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/runs') {
      res.end(JSON.stringify({
        runs: [{
          id: 'run_done',
          app_slug: 'test-app',
          status: 'success',
          duration_ms: 42,
          started_at: '2026-04-29T00:00:00.000Z',
        }],
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/uuid/run') {
      res.end(JSON.stringify({ run_id: 'run_uuid', status: 'pending' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/public-uuid/run') {
      if (req.headers.authorization) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'public run test expected no auth header' }));
        return;
      }
      res.setHeader('set-cookie', 'floom_device_id=dev_public_cli; Path=/; HttpOnly; SameSite=Lax');
      res.end(JSON.stringify({ run_id: 'run_public_uuid', status: 'pending' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/run/run_public_uuid') {
      if (!String(req.headers.cookie || '').includes('floom_device_id=dev_public_cli')) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'missing device cookie' }));
        return;
      }
      publicRunPolls++;
      res.end(JSON.stringify({
        id: 'run_public_uuid',
        app_slug: 'public-uuid',
        status: publicRunPolls >= 1 ? 'success' : 'pending',
        outputs: { uuid: '11111111-1111-4111-8111-111111111111' },
        duration_ms: 5,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/runs/run_uuid') {
      runPolls++;
      res.end(JSON.stringify({
        id: 'run_uuid',
        app_slug: 'uuid',
        status: runPolls >= 1 ? 'success' : 'pending',
        outputs: { uuid: '00000000-0000-4000-8000-000000000000' },
        duration_ms: 5,
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
        reject(new Error('mock API did not bind to a TCP port'));
        return;
      }
      resolve({
        apiUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

console.log('CLI onboarding P0 regressions');

const mock = await startMockApi();
try {
  {
    const res = await run(['--help'], { apiUrl: mock.apiUrl });
    const unsupported = ['store', 'runs', 'jobs', 'quota', 'triggers', 'workspaces', 'feedback'];
    log('top-level help omits unsupported command groups', res.status === 0 && unsupported.every((cmd) => !new RegExp(`^  ${cmd}\\b`, 'm').test(res.stdout)), res.stdout + res.stderr);
  }

  {
    const res = await run(['store'], { apiUrl: mock.apiUrl });
    log('unsupported store command fails before missing script', res.status === 1 && res.stderr.includes("unknown command 'store'") && !res.stderr.includes('No such file'), res.stdout + res.stderr);
  }

  {
    const res = await run(['apps', 'list'], { apiUrl: mock.apiUrl });
    log('apps list default is human-readable', res.status === 0 && res.stdout.includes('Your apps') && res.stdout.includes('test-app') && !res.stdout.trim().startsWith('{'), res.stdout + res.stderr);
  }

  {
    const res = await run(['apps', 'list', '--json'], { apiUrl: mock.apiUrl });
    const parsed = JSON.parse(res.stdout);
    log('apps list --json returns raw API JSON', res.status === 0 && parsed.apps?.[0]?.slug === 'test-app', res.stdout + res.stderr);
  }

  {
    const res = await run(['status'], { apiUrl: mock.apiUrl });
    log('status default is human-readable', res.status === 0 && res.stdout.includes('Your apps') && res.stdout.includes('Recent runs') && !res.stdout.trim().startsWith('{'), res.stdout + res.stderr);
  }

  {
    const res = await run(['status', '--json'], { apiUrl: mock.apiUrl });
    const parsed = JSON.parse(res.stdout);
    log('status --json returns combined raw JSON', res.status === 0 && parsed.apps?.[0]?.slug === 'test-app' && parsed.runs?.[0]?.id === 'run_done', res.stdout + res.stderr);
  }

  {
    const res = await run(['run', 'uuid'], { apiUrl: mock.apiUrl });
    log('run polls pending run to completion', res.status === 0 && res.stdout.includes('Run succeeded: run_uuid') && res.stdout.includes('00000000-0000-4000-8000-000000000000'), res.stdout + res.stderr);
  }

  {
    const tmp = mkdtempSync(join(tmpdir(), 'floom-public-run-'));
    try {
      const res = await run(['run', 'public-uuid'], {
        apiUrl: mock.apiUrl,
        env: {
          FLOOM_API_KEY: '',
          FLOOM_CONFIG: join(tmp, 'missing-config.json'),
        },
      });
      log(
        'run supports unauthenticated public apps with cookie polling',
        res.status === 0 &&
          res.stdout.includes('Run succeeded: run_public_uuid') &&
          res.stdout.includes('11111111-1111-4111-8111-111111111111'),
        res.stdout + res.stderr,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const res = await run(['auth', 'login', '--token='], { apiUrl: mock.apiUrl });
    log(
      'auth login --token= rejects explicit empty token',
      res.status === 1 && res.stderr.includes('Invalid Agent token format'),
      res.stdout + res.stderr,
    );
  }

  {
    const tmp = mkdtempSync(join(tmpdir(), 'floom-init-slug-'));
    try {
      const res = await run(['init', '--name', 'Test App', '--description', 'Test app', '--type', 'custom'], { cwd: tmp, apiUrl: mock.apiUrl });
      const yaml = readFileSync(join(tmp, 'floom.yaml'), 'utf8');
      log('init slugifies names with spaces', res.status === 0 && yaml.includes('slug: test-app'), res.stdout + res.stderr + yaml);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const tmp = mkdtempSync(join(tmpdir(), 'floom-init-name-only-'));
    try {
      const res = await run(['init', '--name', 'Test App'], { cwd: tmp, apiUrl: mock.apiUrl });
      const yaml = readFileSync(join(tmp, 'floom.yaml'), 'utf8');
      log(
        'init name-only non-tty creates a custom app with generated slug',
        res.status === 0 &&
          yaml.includes('slug: test-app') &&
          yaml.includes('description: Run Test App.') &&
          yaml.includes('runtime: python'),
        res.stdout + res.stderr + yaml,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  {
    const res = await run(['account', '--help'], { apiUrl: mock.apiUrl });
    log('account agent-token help marks browser-session requirement', res.status === 0 && res.stdout.includes('browser session required') && res.stdout.includes('Agent tokens are rejected'), res.stdout + res.stderr);
  }
} finally {
  await mock.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
