#!/usr/bin/env node
// Artifact retention cleanup tests.
//
// Prereq: pnpm --filter @floom/server build
// Run: node test/stress/test-artifact-cleanup.mjs

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-artifact-cleanup-'));
process.env.DATA_DIR = join(tmp, 'data');
process.env.FLOOM_ARTIFACT_DIR = join(tmp, 'artifacts');
process.env.FLOOM_ARTIFACT_SIGNING_SECRET = 'test-artifact-secret';
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';

const { db } = await import('../../apps/server/dist/db.js');
const { newAppId, newRunId } = await import('../../apps/server/dist/lib/ids.js');
const {
  captureArtifactsForRun,
  sweepExpiredArtifacts,
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

console.log('artifact cleanup tests');

const appId = newAppId();
db.prepare(
  `INSERT INTO apps (id, slug, name, description, manifest, code_path)
   VALUES (?, 'artifact-cleanup', 'Artifact Cleanup', 'test', '{}', 'test')`,
).run(appId);
const runId = newRunId();
db.prepare(
  `INSERT INTO runs (id, app_id, action, inputs, status)
   VALUES (?, ?, 'run', '{}', 'success')`,
).run(runId, appId);

const stored = captureArtifactsForRun({
  runId,
  artifacts: [
    {
      name: 'old.txt',
      mime: 'text/plain',
      size: 3,
      data_b64: Buffer.from('old').toString('base64'),
    },
  ],
});
const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(stored[0].id);
db.prepare("UPDATE artifacts SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(row.id);

const result = sweepExpiredArtifacts();
const after = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(row.id);

log('sweeper reports deleted artifact', result.deleted_count === 1, `count=${result.deleted_count}`);
log('sweeper removes DB row', !after);
log('sweeper removes artifact file', !existsSync(row.storage_path), row.storage_path);

db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
