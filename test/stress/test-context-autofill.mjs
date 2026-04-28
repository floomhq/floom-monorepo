#!/usr/bin/env node
// JSON profile context autofill tests.

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-context-autofill-'));
process.env.DATA_DIR = tmp;
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
const { normalizeManifest } = await import('../../apps/server/dist/services/manifest.js');
const { resolveContextInputs } = await import('../../apps/server/dist/services/context_autofill.js');
const { runRouter } = await import('../../apps/server/dist/routes/run.js');
const jobs = await import('../../apps/server/dist/services/jobs.js');
const worker = await import('../../apps/server/dist/services/worker.js');
const { newJobId } = await import('../../apps/server/dist/lib/ids.js');

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

async function listen(server) {
  return await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function fetchRun(body) {
  const req = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await runRouter.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

function latestRunInputs() {
  const row = db
    .prepare(`SELECT inputs FROM runs ORDER BY started_at DESC, id DESC LIMIT 1`)
    .get();
  return row?.inputs ? JSON.parse(row.inputs) : null;
}

console.log('Context profile autofill');

const upstream = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});
const upstreamPort = await listen(upstream);

try {
  const manifest = normalizeManifest({
    name: 'Context Invoice',
    description: 'Context autofill fixture',
    runtime: 'python',
    manifest_version: '2.0',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    actions: {
      generate: {
        label: 'Generate',
        inputs: [
          {
            name: 'sender_name',
            type: 'text',
            label: 'Sender name',
            required: true,
            context: { source: 'user_profile', path: 'person.name' },
          },
          {
            name: 'company_city',
            type: 'text',
            label: 'Company city',
            required: true,
            context: { source: 'workspace_profile', path: 'company.address.city' },
          },
          {
            name: 'currency',
            type: 'text',
            label: 'Currency',
            required: true,
            context: { source: 'workspace_profile', path: 'defaults.currency' },
          },
        ],
        outputs: [{ name: 'result', type: 'json', label: 'Result' }],
      },
    },
  });

  log('manifest preserves input context annotations', manifest.actions.generate.inputs[0].context?.path === 'person.name');

  db.prepare(`UPDATE users SET profile_json = ? WHERE id = 'local'`).run(
    JSON.stringify({ person: { name: 'Ada Lovelace' } }),
  );
  db.prepare(`UPDATE workspaces SET profile_json = ? WHERE id = 'local'`).run(
    JSON.stringify({
      company: { address: { city: 'Hamburg' } },
      defaults: { currency: 'EUR' },
    }),
  );
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, docker_image, code_path,
        category, author, icon, app_type, base_url, auth_type, auth_config,
        openapi_spec_url, openapi_spec_cached, visibility, is_async, webhook_url,
        timeout_ms, retries, async_mode, workspace_id, publish_status)
     VALUES ('app_context_autofill', 'context-invoice', 'Context Invoice', 'fixture',
        ?, 'active', NULL, '', 'testing', 'local', NULL, 'proxied', ?, NULL,
        NULL, NULL, NULL, 'public', 0, NULL, NULL, 0, NULL, 'local', 'published')`,
  ).run(JSON.stringify(manifest), `http://127.0.0.1:${upstreamPort}`);

  const ctx = {
    workspace_id: 'local',
    user_id: 'local',
    device_id: 'context-test-device',
    is_authenticated: false,
  };
  const resolved = resolveContextInputs(
    ctx,
    manifest.actions.generate,
    { currency: 'USD' },
    true,
  );
  log('service fills missing profile-backed inputs', resolved.sender_name === 'Ada Lovelace' && resolved.company_city === 'Hamburg');
  log('service preserves explicit input over profile value', resolved.currency === 'USD');
  log(
    'service leaves inputs untouched without opt-in',
    !('sender_name' in resolveContextInputs(ctx, manifest.actions.generate, {}, false)),
  );

  let r = await fetchRun({
    app_slug: 'context-invoice',
    action: 'generate',
    inputs: { currency: 'USD' },
  });
  log('REST run without use_context rejects missing required profile input', r.status === 400 && r.json?.field === 'sender_name', r.text);

  r = await fetchRun({
    app_slug: 'context-invoice',
    action: 'generate',
    use_context: true,
    inputs: { currency: 'USD' },
  });
  const inputs = latestRunInputs();
  log('REST run with use_context succeeds', r.status === 200 && typeof r.json?.run_id === 'string', r.text);
  log(
    'REST run stores resolved context inputs with explicit override',
    inputs?.sender_name === 'Ada Lovelace' &&
      inputs?.company_city === 'Hamburg' &&
      inputs?.currency === 'USD',
    JSON.stringify(inputs),
  );

  const appRow = db.prepare(`SELECT * FROM apps WHERE slug = 'context-invoice'`).get();
  const job = jobs.createJob(newJobId(), {
    app: appRow,
    action: 'generate',
    inputs: { currency: 'GBP' },
    workspaceId: 'local',
    userId: 'local',
    deviceId: 'context-job-device',
    useContext: true,
  });
  log('job stores raw inputs before worker context resolution', JSON.parse(job.input_json).sender_name === undefined);
  const processed = await worker.processOneJob();
  const processedJob = jobs.getJob(processed.id);
  const jobRunInputs = db.prepare('SELECT inputs FROM runs WHERE id = ?').get(processedJob.run_id);
  const parsedJobRunInputs = JSON.parse(jobRunInputs.inputs);
  log(
    'job worker resolves context at fire time',
    parsedJobRunInputs.sender_name === 'Ada Lovelace' &&
      parsedJobRunInputs.company_city === 'Hamburg' &&
      parsedJobRunInputs.currency === 'GBP',
    JSON.stringify(parsedJobRunInputs),
  );

  const badPath = {
    ...manifest,
    actions: {
      generate: {
        ...manifest.actions.generate,
        inputs: [
          {
            name: 'x',
            type: 'text',
            label: 'X',
            context: { source: 'user_profile', path: 'person[0]' },
          },
        ],
      },
    },
  };
  let badPathError = null;
  try {
    normalizeManifest(badPath);
  } catch (err) {
    badPathError = err;
  }
  log('manifest rejects unsafe context path syntax', badPathError?.field === 'actions.generate.inputs[0].context.path');
} finally {
  await new Promise((resolve) => upstream.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\n${passed} passed, 0 failed`);
