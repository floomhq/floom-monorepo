#!/usr/bin/env node
// Launch-hardening regression: the main server must not stay "healthy" while
// bundled sidecars are dead. Fast-apps restarts after unexpected child exit,
// and SIGTERM shuts the parent down instead of only killing children.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const dataDir = mkdtempSync(join(tmpdir(), 'floom-fast-apps-supervision-'));

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

async function waitFor(fn, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function waitForHttp(url, timeoutMs) {
  return await waitFor(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    return res.ok;
  }, timeoutMs);
}

function readProcFile(pid, name) {
  const path = `/proc/${pid}/${name}`;
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function findFastAppsPid(port) {
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const cmdline = readProcFile(pid, 'cmdline').replace(/\0/g, ' ');
    if (!cmdline.includes('examples/fast-apps/server.mjs')) continue;
    const environ = readProcFile(pid, 'environ').replace(/\0/g, '\n');
    if (environ.includes(`FAST_APPS_PORT=${port}`)) return Number(pid);
  }
  return null;
}

console.log('Fast-apps sidecar supervision');

const serverPort = await getFreePort();
const fastAppsPort = await getFreePort();
const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
  env: {
    ...process.env,
    PORT: String(serverPort),
    PUBLIC_URL: `http://localhost:${serverPort}`,
    DATA_DIR: dataDir,
    FAST_APPS_PORT: String(fastAppsPort),
    FAST_APPS_HOST: '127.0.0.1',
    FLOOM_SEED_APPS: 'false',
    FLOOM_SEED_LAUNCH_DEMOS: 'false',
    FLOOM_LAUNCH_WEEK_APPS: 'false',
    FLOOM_DISABLE_JOB_WORKER: 'true',
    FLOOM_DISABLE_TRIGGERS_WORKER: 'true',
    FLOOM_DISABLE_ZOMBIE_SWEEPER: 'true',
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
  const serverHealthy = await waitForHttp(`http://127.0.0.1:${serverPort}/api/health`, 20_000);
  log('server becomes healthy', serverHealthy === true, stderr || stdout);

  const sidecarHealthy = await waitForHttp(`http://127.0.0.1:${fastAppsPort}/health`, 20_000);
  log('fast-apps sidecar becomes healthy', sidecarHealthy === true, stderr || stdout);

  const firstPid = await waitFor(() => findFastAppsPid(fastAppsPort), 5000);
  log('fast-apps process is discoverable', Number.isInteger(firstPid), String(firstPid));

  if (firstPid) process.kill(firstPid, 'SIGTERM');
  const restartedPid = await waitFor(() => {
    const pid = findFastAppsPid(fastAppsPort);
    return pid && pid !== firstPid ? pid : null;
  }, 10_000);
  log('fast-apps restarts after unexpected child exit', Number.isInteger(restartedPid), `before=${firstPid} after=${restartedPid}`);

  const restartedHealthy = await waitForHttp(`http://127.0.0.1:${fastAppsPort}/openapi/base64.json`, 10_000);
  log('restarted sidecar serves base64 OpenAPI spec', restartedHealthy === true, stderr || stdout);

  proc.kill('SIGTERM');
  const exited = await waitFor(() => proc.exitCode !== null || proc.signalCode !== null, 5000);
  log('server exits after SIGTERM', exited === true, `exit=${proc.exitCode} signal=${proc.signalCode}`);
} finally {
  if (proc.exitCode === null && proc.signalCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch {}
  }
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
