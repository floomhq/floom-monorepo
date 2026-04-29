#!/usr/bin/env node
// Artifact MIME allowlist and filename safety tests.
//
// Prereq: pnpm --filter @floom/server build
// Run: node test/stress/test-artifact-mime-allowlist.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-artifact-mime-'));
process.env.DATA_DIR = join(tmp, 'data');
process.env.FLOOM_ARTIFACT_DIR = join(tmp, 'artifacts');
process.env.FLOOM_ARTIFACT_SIGNING_SECRET = 'test-artifact-secret';
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';

const { db } = await import('../../apps/server/dist/db.js');
const { newAppId, newRunId } = await import('../../apps/server/dist/lib/ids.js');
const {
  ALLOWED_ARTIFACT_MIMES,
  captureArtifactsForRun,
} = await import('../../apps/server/dist/services/artifacts.js');

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

console.log('artifact MIME allowlist tests');

const appId = newAppId();
db.prepare(
  `INSERT INTO apps (id, slug, name, description, manifest, code_path)
   VALUES (?, 'artifact-mime', 'Artifact MIME', 'test', '{}', 'test')`,
).run(appId);

function seedRun() {
  const runId = newRunId();
  db.prepare(
    `INSERT INTO runs (id, app_id, action, inputs, status)
     VALUES (?, ?, 'run', '{}', 'running')`,
  ).run(runId, appId);
  return runId;
}

try {
  for (const mime of ALLOWED_ARTIFACT_MIMES) {
    const runId = seedRun();
    const ext = mime.includes('pdf') ? 'pdf' : 'txt';
    const stored = captureArtifactsForRun({
      runId,
      artifacts: [{ name: `allowed-${storedSafeName(mime)}.${ext}`, mime, size: 2, data_b64: b64('ok') }],
    });
    assert.equal(stored.length, 1);
  }
  log('all allowlisted MIME values are accepted', true);

  assert.throws(
    () =>
      captureArtifactsForRun({
        runId: seedRun(),
        artifacts: [
          {
            name: 'payload.bin',
            mime: 'application/octet-stream',
            size: 2,
            data_b64: b64('no'),
          },
        ],
      }),
    /not allowed/,
  );
  log('application/octet-stream rejected', true);

  assert.throws(
    () =>
      captureArtifactsForRun({
        runId: seedRun(),
        artifacts: [
          {
            name: '../draft.pdf',
            mime: 'application/pdf',
            size: 2,
            data_b64: b64('no'),
          },
        ],
      }),
    /path/,
  );
  log('path traversal filename rejected', true);

  assert.throws(
    () =>
      captureArtifactsForRun({
        runId: seedRun(),
        artifacts: [
          {
            name: 'wrong-size.pdf',
            mime: 'application/pdf',
            size: 100,
            data_b64: b64('no'),
          },
        ],
      }),
    /size does not match/,
  );
  log('declared size mismatch rejected', true);

  const rows = db.prepare('SELECT COUNT(*) AS c FROM artifacts WHERE mime = ?').get('application/octet-stream');
  log('rejected MIME did not persist a row', rows.c === 0, `rows=${rows.c}`);
} catch (err) {
  failed++;
  console.log(`  FAIL  unexpected error :: ${err.stack || err.message}`);
}

db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

function storedSafeName(mime) {
  return mime.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
}
