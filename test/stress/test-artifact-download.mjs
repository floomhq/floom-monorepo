#!/usr/bin/env node
// Signed artifact download route tests.
//
// Prereq: pnpm --filter @floom/server build
// Run: node test/stress/test-artifact-download.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from '../../apps/server/node_modules/hono/dist/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'floom-artifact-download-'));
process.env.DATA_DIR = join(tmp, 'data');
process.env.FLOOM_ARTIFACT_DIR = join(tmp, 'artifacts');
process.env.FLOOM_ARTIFACT_SIGNING_SECRET = 'test-artifact-secret';
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';

const { db } = await import('../../apps/server/dist/db.js');
const { newAppId, newRunId } = await import('../../apps/server/dist/lib/ids.js');
const {
  captureArtifactsForRun,
  signArtifactUrl,
} = await import('../../apps/server/dist/services/artifacts.js');
const { artifactsRouter } = await import('../../apps/server/dist/routes/artifacts.js');

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

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function fetchApp(app, path) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: bytes.toString('utf8') };
}

console.log('artifact download tests');

const appId = newAppId();
db.prepare(
  `INSERT INTO apps (id, slug, name, description, manifest, code_path)
   VALUES (?, 'artifact-download', 'Artifact Download', 'test', '{}', 'test')`,
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
      name: 'draft-Ä.pdf',
      mime: 'application/pdf',
      size: Buffer.byteLength('%PDF-download'),
      data_b64: b64('%PDF-download'),
    },
  ],
});
const artifact = stored[0];
const routeApp = new Hono();
routeApp.route('/api/artifacts', artifactsRouter);

const ok = await fetchApp(routeApp, artifact.url);
log('GET signed URL returns 200', ok.status === 200, `status=${ok.status} body=${ok.text}`);
log('GET streams artifact bytes', ok.text === '%PDF-download');
log('GET sets content type', ok.headers.get('content-type') === 'application/pdf');
log('GET sets content length', ok.headers.get('content-length') === String(Buffer.byteLength('%PDF-download')));
log(
  'GET sets attachment filename',
  (ok.headers.get('content-disposition') || '').includes('attachment;'),
  ok.headers.get('content-disposition') || '',
);

const badSigUrl = artifact.url.replace(/sig=[^&]+/, 'sig=00');
const badSig = await fetchApp(routeApp, badSigUrl);
log('bad signature rejects with 403', badSig.status === 403, `status=${badSig.status}`);

const expiredUrl = signArtifactUrl(artifact.id, Math.floor(Date.now() / 1000) - 10);
const expired = await fetchApp(routeApp, expiredUrl);
log('expired signed URL rejects with 410', expired.status === 410, `status=${expired.status}`);

const missingUrl = signArtifactUrl('art_missingmissingmissingmissing', Math.floor(Date.now() / 1000) + 60);
const missing = await fetchApp(routeApp, missingUrl);
log('missing artifact returns 404 after valid signature', missing.status === 404, `status=${missing.status}`);

db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
