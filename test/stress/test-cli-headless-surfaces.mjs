#!/usr/bin/env node
// CLI headless command routing tests.
//
// Runs with FLOOM_DRY_RUN=1, so it verifies shell parsing, validation, URL
// selection, escaping, and JSON body construction without credentials or a
// live server.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'cli/floom/bin/floom');
const API_URL = 'http://localhost:3999';

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function run(args, { input } = {}) {
  return await new Promise((resolve) => {
    const proc = spawn('bash', [CLI, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        FLOOM_DRY_RUN: '1',
        FLOOM_API_URL: API_URL,
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
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) proc.stdin.end(input);
    else proc.stdin.end();
  });
}

function includes(stdout, needle) {
  return stdout.includes(needle);
}

function bodyOf(stdout) {
  const line = stdout
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s.startsWith('body: '));
  if (!line) return null;
  return JSON.parse(line.slice('body: '.length));
}

console.log('CLI headless surfaces dry-run routing');

for (const [label, args, needles] of [
  ['store help exits 0 with usage', ['store', '--help'], ['usage:', 'floom store list', 'floom store search', 'floom store get']],
  ['runs help exits 0 with usage', ['runs', '--help'], ['usage:', 'floom runs list', 'floom runs get', 'floom runs share']],
  ['jobs help exits 0 with usage', ['jobs', '--help'], ['usage:', 'floom jobs create', 'floom jobs get', 'floom jobs cancel']],
  ['quota help exits 0 with usage', ['quota', '--help'], ['usage:', 'floom quota get']],
  ['feedback help exits 0 with usage', ['feedback', '--help'], ['usage:', 'floom feedback submit']],
]) {
  const res = await run(args);
  log(label, res.code === 0 && needles.every((needle) => includes(res.stdout, needle)), res.stdout + res.stderr);
}

{
  const res = await run(['run', 'slugify', '--action', 'run', '--inputs-json', '{"text":"Hello World"}']);
  const body = bodyOf(res.stdout);
  log('run posts /api/run body', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/run`) && body?.app_slug === 'slugify' && body?.action === 'run' && body?.inputs?.text === 'Hello World', res.stdout + res.stderr);
}

{
  const res = await run(['run', 'word-count', '--inputs-stdin'], { input: '{"text":"hello"}' });
  const body = bodyOf(res.stdout);
  log('run supports stdin inputs', res.code === 0 && body?.app_slug === 'word-count' && body?.inputs?.text === 'hello', res.stdout + res.stderr);
}

{
  const res = await run(['run', 'invoice', '--use-context', '--inputs-json', '{"currency":"USD"}']);
  const body = bodyOf(res.stdout);
  log('run supports context autofill opt-in', res.code === 0 && body?.app_slug === 'invoice' && body?.use_context === true && body?.inputs?.currency === 'USD', res.stdout + res.stderr);
}

{
  const res = await run(['store', 'list', '--category', 'text', '--sort', 'name', '--include-fixtures']);
  log('store list routes to /api/hub with filters', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/hub?sort=name&include_fixtures=1&category=text`), res.stdout + res.stderr);
}

{
  const res = await run(['store', 'search', 'json format', '--category', 'dev', '--sort', 'newest']);
  log('store search URL-encodes query', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/hub?q=json%20format&sort=newest&category=dev`), res.stdout + res.stderr);
}

{
  const res = await run(['store', 'get', 'json-format']);
  log('store get routes to app detail', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/hub/json-format`), res.stdout + res.stderr);
}

{
  const res = await run(['runs', 'list', '--limit', '7', '--slug', 'hash']);
  log('runs list routes to /api/agents/runs with filters', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/agents/runs?limit=7&slug=hash`), res.stdout + res.stderr);
}

{
  const res = await run(['runs', 'get', 'run 1']);
  log('runs get URL-encodes run id', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/agents/runs/run%201`), res.stdout + res.stderr);
}

{
  const res = await run(['runs', 'share', 'run_123']);
  log('runs share posts share endpoint', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/run/run_123/share`), res.stdout + res.stderr);
}

{
  const res = await run(['runs', 'delete', 'run_123']);
  log('runs delete uses DELETE /api/me/runs/:id', res.code === 0 && includes(res.stdout, `DELETE ${API_URL}/api/me/runs/run_123`), res.stdout + res.stderr);
}

{
  const res = await run(['jobs', 'create', 'slow-echo', '--action', 'echo', '--inputs-json', '{"message":"hi"}']);
  const body = bodyOf(res.stdout);
  log('jobs create posts slug jobs endpoint', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/slow-echo/jobs`) && body?.action === 'echo' && body?.inputs?.message === 'hi', res.stdout + res.stderr);
}

{
  const res = await run(['jobs', 'create', 'slow-echo', '--use-context', '--inputs-json', '{"message":"hi"}']);
  const body = bodyOf(res.stdout);
  log('jobs create supports context autofill opt-in', res.code === 0 && body?.use_context === true && body?.inputs?.message === 'hi', res.stdout + res.stderr);
}

{
  const res = await run(['jobs', 'get', 'slow echo', 'job 1']);
  log('jobs get URL-encodes slug and job id', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/slow%20echo/jobs/job%201`), res.stdout + res.stderr);
}

{
  const res = await run(['jobs', 'cancel', 'slow-echo', 'job_1']);
  log('jobs cancel posts cancel endpoint', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/slow-echo/jobs/job_1/cancel`), res.stdout + res.stderr);
}

{
  const res = await run(['quota', 'get', 'pitch-coach']);
  log('quota get routes to quota endpoint', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/pitch-coach/quota`), res.stdout + res.stderr);
}

{
  const res = await run(['feedback', 'submit', '--text-stdin', '--email', 'agent@example.com', '--url', '/p/hash'], { input: 'headless feedback' });
  const body = bodyOf(res.stdout);
  log('feedback submit posts typed body', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/feedback`) && body?.text === 'headless feedback' && body?.email === 'agent@example.com' && body?.url === '/p/hash', res.stdout + res.stderr);
}

{
  const res = await run(['triggers', 'list']);
  log('triggers list routes to /api/me/triggers', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/me/triggers`), res.stdout + res.stderr);
}

{
  const res = await run(['triggers', 'create', 'slow-echo', '--type', 'schedule', '--action', 'echo', '--cron', '*/5 * * * *', '--tz', 'UTC', '--inputs-json', '{"message":"hi"}']);
  const body = bodyOf(res.stdout);
  log('triggers create posts schedule body', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/hub/slow-echo/triggers`) && body?.trigger_type === 'schedule' && body?.cron_expression === '*/5 * * * *' && body?.inputs?.message === 'hi', res.stdout + res.stderr);
}

{
  const res = await run(['triggers', 'update', 'trig_1', '--enabled', 'false', '--inputs-stdin'], { input: '{"message":"updated"}' });
  const body = bodyOf(res.stdout);
  log('triggers update patches trigger', res.code === 0 && includes(res.stdout, `PATCH ${API_URL}/api/me/triggers/trig_1`) && body?.enabled === false && body?.inputs?.message === 'updated', res.stdout + res.stderr);
}

{
  const res = await run(['triggers', 'delete', 'trig 1']);
  log('triggers delete URL-encodes trigger id', res.code === 0 && includes(res.stdout, `DELETE ${API_URL}/api/me/triggers/trig%201`), res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'me']);
  log('workspaces me routes to session endpoint', res.code === 0 && includes(res.stdout, `GET ${API_URL}/api/session/me`), res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'create', '--name', 'Team Space', '--slug', 'team-space']);
  const body = bodyOf(res.stdout);
  log('workspaces create posts name/slug', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/workspaces`) && body?.name === 'Team Space' && body?.slug === 'team-space', res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'update', 'ws 1', '--name', 'Renamed']);
  const body = bodyOf(res.stdout);
  log('workspaces update URL-encodes id', res.code === 0 && includes(res.stdout, `PATCH ${API_URL}/api/workspaces/ws%201`) && body?.name === 'Renamed', res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'members', 'set-role', 'ws_1', 'user 1', '--role', 'viewer']);
  const body = bodyOf(res.stdout);
  log('workspaces members set-role patches role', res.code === 0 && includes(res.stdout, `PATCH ${API_URL}/api/workspaces/ws_1/members/user%201`) && body?.role === 'viewer', res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'invites', 'create', 'ws_1', '--email', 'invitee@example.com', '--role', 'editor']);
  const body = bodyOf(res.stdout);
  log('workspaces invites create posts invite body', res.code === 0 && includes(res.stdout, `POST ${API_URL}/api/workspaces/ws_1/members/invite`) && body?.email === 'invitee@example.com' && body?.role === 'editor', res.stdout + res.stderr);
}

{
  const res = await run(['workspaces', 'runs', 'delete', 'ws_1']);
  log('workspaces runs delete uses bulk endpoint', res.code === 0 && includes(res.stdout, `DELETE ${API_URL}/api/workspaces/ws_1/runs`), res.stdout + res.stderr);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
