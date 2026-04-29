#!/usr/bin/env node
// Artifact capture service tests.
//
// Prereq: pnpm --filter @floom/server build
// Run: node test/stress/test-artifact-capture.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-artifact-capture-'));
process.env.DATA_DIR = join(tmp, 'data');
process.env.FLOOM_ARTIFACT_DIR = join(tmp, 'artifacts');
process.env.FLOOM_ARTIFACT_SIGNING_SECRET = 'test-artifact-secret';
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';

const { db } = await import('../../apps/server/dist/db.js');
const { newAppId, newJobId, newRunId } = await import('../../apps/server/dist/lib/ids.js');
const jobs = await import('../../apps/server/dist/services/jobs.js');
const runner = await import('../../apps/server/dist/services/runner.js');
const artifacts = await import('../../apps/server/dist/services/artifacts.js');
const startup = await import('../../apps/server/dist/lib/startup-checks.js');

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

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

console.log('artifact capture tests');

try {
  const appId = newAppId();
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, manifest, code_path, app_type)
     VALUES (?, 'artifact-app', 'Artifact App', 'test', ?, 'proxied:artifact-app', 'proxied')`,
  ).run(
    appId,
    JSON.stringify({
      name: 'Artifact App',
      description: 'test',
      actions: { run: { label: 'Run', inputs: [], outputs: [] } },
      runtime: 'python',
      python_dependencies: [],
      node_dependencies: {},
      secrets_needed: [],
      manifest_version: '2.0',
    }),
  );
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  const runId = newRunId();
  const jobId = newJobId();
  db.prepare(
    `INSERT INTO runs (id, app_id, action, inputs, status)
     VALUES (?, ?, 'run', '{}', 'running')`,
  ).run(runId, appId);
  jobs.createJob(jobId, { app, action: 'run', inputs: {} });

  const stored = artifacts.captureArtifactsForRun({
    runId,
    jobId,
    artifacts: [
      {
        name: 'draft.pdf',
        mime: 'application/pdf',
        size: Buffer.byteLength('%PDF-test'),
        data_b64: b64('%PDF-test'),
      },
    ],
  });
  const output = artifacts.outputWithArtifacts({ summary: 'done' }, stored);
  runner.updateRun(runId, { status: 'success', outputs: output, finished: true });
  const completed = jobs.completeJob(jobId, output, runId);

  const row = db.prepare('SELECT * FROM artifacts WHERE run_id = ?').get(runId);
  const run = runner.getRun(runId);
  const parsedRunOutput = JSON.parse(run.outputs);
  const parsedJobOutput = JSON.parse(completed.output_json);

  log('artifact row persisted', row && row.id.startsWith('art_'));
  log('artifact job_id persisted', row.job_id === jobId);
  log('artifact file bytes written', readFileSync(row.storage_path, 'utf8') === '%PDF-test');
  log('artifact sha256 persisted', typeof row.sha256 === 'string' && row.sha256.length === 64);
  log('run output keeps normal outputs', parsedRunOutput.summary === 'done');
  log('run output exposes signed URL', parsedRunOutput.artifacts[0].url.startsWith('/api/artifacts/'));
  log('run output strips data_b64', !('data_b64' in parsedRunOutput.artifacts[0]));
  log('job output carries artifact metadata', parsedJobOutput.artifacts[0].id === row.id);

  process.env.FLOOM_ARTIFACT_MAX_SIZE_MB = '0.000001';
  assert.throws(
    () =>
      artifacts.captureArtifactsForRun({
        runId: newRunId(),
        artifacts: [
          {
            name: 'too-large.pdf',
            mime: 'application/pdf',
            size: Buffer.byteLength('too large'),
            data_b64: b64('too large'),
          },
        ],
      }),
    /exceeds/,
  );
  log('per-artifact size limit rejects overflow', true);
  delete process.env.FLOOM_ARTIFACT_MAX_SIZE_MB;

  process.env.FLOOM_ARTIFACT_MAX_TOTAL_PER_RUN_MB = '0.00001';
  assert.throws(
    () =>
      artifacts.captureArtifactsForRun({
        runId: newRunId(),
        artifacts: [
          { name: 'a.txt', mime: 'text/plain', size: 8, data_b64: b64('12345678') },
          { name: 'b.txt', mime: 'text/plain', size: 8, data_b64: b64('12345678') },
        ],
      }),
    /total size/,
  );
  log('per-run total size limit rejects overflow', true);

  const startupResult = startup.checkStartupEnvironment({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://floom.dev',
    RESEND_API_KEY: 're_test',
  });
  log(
    'production startup rejects missing artifact signing secret',
    startupResult.ok === false && startupResult.code === 'missing_artifact_signing_secret',
    JSON.stringify(startupResult),
  );
} catch (err) {
  failed++;
  console.log(`  FAIL  unexpected error :: ${err.stack || err.message}`);
}

db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
