#!/usr/bin/env node
// End-to-end docker round-trip for file inputs.
//
// This is the integration test that the pure-Node test-file-inputs.mjs
// can't provide: we actually build a Python app image, send a
// FileEnvelope into runAppContainer, and verify the container read the
// materialized file from /floom/inputs/<name>.<ext>.
//
// What this exercises end-to-end:
//   1. manifest validator accepts the envelope
//   2. materializeFileInputs writes bytes to <tmpdir>/floom-<runId>
//   3. docker.ts binds that dir at /floom/inputs read-only
//   4. configArg contains the rewritten path (not the envelope)
//   5. the app's python code can open(input_path) and read the bytes
//   6. cleanup removes the tmp dir after the container exits
//
// Skips cleanly on hosts without a Docker daemon so this can live in
// the regular test script without gating CI on docker-in-docker.
//
// Run: node test/stress/test-file-inputs-docker.mjs

import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

// -------------------------------------------------------------
// Precondition: Docker daemon reachable.
// -------------------------------------------------------------
// Import dockerode via the server's module resolution — it lives in
// apps/server/node_modules, not in test/stress. Dynamic require via
// createRequire keeps the test runnable from any cwd under tsx.
let docker;
try {
  const { createRequire } = await import('node:module');
  const serverPkg = join(
    new URL('../../apps/server/package.json', import.meta.url).pathname,
  );
  const require = createRequire(serverPkg);
  const Docker = require('dockerode');
  docker = new Docker();
  await docker.ping();
} catch (err) {
  console.log('Docker daemon not reachable — skipping docker e2e test');
  console.log(`  reason: ${err?.message}`);
  process.exit(0);
}

// -------------------------------------------------------------
// Load server services from source (tsx handles the .ts imports).
// -------------------------------------------------------------
const { buildAppImage, runAppContainer, removeAppImage } = await import(
  '../../apps/server/src/services/docker.ts'
);

// -------------------------------------------------------------
// Build a throwaway app: reads /floom/inputs/<csv>, echoes contents.
// -------------------------------------------------------------
const appId = `file-inputs-test-${Date.now()}`;
const codeDir = mkdtempSync(join(tmpdir(), 'floom-file-inputs-app-'));
writeFileSync(
  join(codeDir, 'app.py'),
  [
    'def run(data):',
    '    """Action signature mirrors InputSpec(name=data, type=file).',
    '    The runner rewrites the envelope to a path string like',
    '    "/floom/inputs/data.csv" before invoking us."""',
    '    with open(data, "rb") as f:',
    '        content = f.read()',
    '    return {',
    '        "path": data,',
    '        "bytes": len(content),',
    '        "text": content.decode("utf-8", errors="replace"),',
    '    }',
    '',
  ].join('\n'),
);

const manifest = {
  name: 'file-inputs-test',
  runtime: 'python',
  python_dependencies: [],
  apt_packages: [],
  actions: [
    {
      name: 'run',
      label: 'Run',
      inputs: [{ name: 'data', type: 'file', required: true }],
      outputs: [],
    },
  ],
};

console.log(`Building throwaway image for ${appId}…`);
try {
  await buildAppImage(appId, codeDir, manifest);
  log('built image', true);
} catch (err) {
  log('built image', false, err?.message);
  console.log(`\n${passed} passed, ${failed} failed`);
  rmSync(codeDir, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

try {
  // -------------------------------------------------------------
  // Happy path: send a FileEnvelope, assert the container reads it.
  // -------------------------------------------------------------
  const payload = 'name,age\nfloom,1\nfederico,25\n';
  const envelope = {
    __file: true,
    name: 'data.csv',
    mime_type: 'text/csv',
    size: payload.length,
    content_b64: Buffer.from(payload, 'utf8').toString('base64'),
  };

  const runId = `run-${Date.now()}`;
  const result = await runAppContainer({
    appId,
    runId,
    action: 'run',
    inputs: { data: envelope },
    secrets: {},
    timeoutMs: 30_000,
  });

  log('container exited successfully', result.exitCode === 0, `exit=${result.exitCode} stderr=${result.stderr}`);
  log('container did not time out', !result.timedOut);
  log('container was not OOM-killed', !result.oomKilled);

  // Parse the __FLOOM_RESULT__ line.
  const resultLine = result.stdout
    .split('\n')
    .find((l) => l.startsWith('__FLOOM_RESULT__'));
  const parsed = resultLine ? JSON.parse(resultLine.slice('__FLOOM_RESULT__'.length)) : null;
  log('got a __FLOOM_RESULT__ line', !!parsed, result.stdout.slice(0, 500));

  if (parsed?.ok) {
    const out = parsed.outputs || {};
    log(
      'app received a path under /floom/inputs/',
      typeof out.path === 'string' && out.path.startsWith('/floom/inputs/'),
      `path=${out.path}`,
    );
    log('path has .csv extension', out.path?.endsWith('.csv'), out.path);
    log('app read the correct number of bytes', out.bytes === payload.length);
    log('app read the correct content', out.text === payload);
  } else {
    log('app ran to success', false, parsed?.error || 'no parsed result');
  }

  // -------------------------------------------------------------
  // Cleanup invariant: the tmp materialization dir must be gone.
  // -------------------------------------------------------------
  const hostDir = join(tmpdir(), `floom-${runId}`);
  log('materialized tmp dir cleaned up', !existsSync(hostDir), hostDir);
} finally {
  // Best-effort cleanup: image + code dir.
  try { await removeAppImage(appId); } catch { /* ignore */ }
  try { rmSync(codeDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
