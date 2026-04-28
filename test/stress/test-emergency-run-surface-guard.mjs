#!/usr/bin/env node
// Launch emergency brake: FLOOM_EMERGENCY_DISABLE_RUN_SURFACES=true returns
// 503 for expensive run/MCP/write-trigger surfaces while health/static stay up.

import { Hono } from '../../apps/server/node_modules/hono/dist/index.js';
import {
  __resetEmergencyForTests,
  emergencyRunSurfaceGuard,
  noteEmergencyRateLimitHit,
} from '../../apps/server/src/middleware/emergency.ts';

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

async function request(path, env = {}) {
  const prevDisable = process.env.FLOOM_EMERGENCY_DISABLE_RUN_SURFACES;
  const prevRetry = process.env.FLOOM_EMERGENCY_RETRY_AFTER_SECONDS;
  const prevAutoDisabled = process.env.FLOOM_AUTO_EMERGENCY_DISABLED;
  const prevAutoThreshold = process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS;
  const prevAutoWindow = process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS;
  const prevAutoCooldown = process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS;
  if ('disabled' in env) process.env.FLOOM_EMERGENCY_DISABLE_RUN_SURFACES = env.disabled;
  if ('retry' in env) process.env.FLOOM_EMERGENCY_RETRY_AFTER_SECONDS = env.retry;
  if ('autoDisabled' in env) process.env.FLOOM_AUTO_EMERGENCY_DISABLED = env.autoDisabled;
  if ('autoThreshold' in env) process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS = env.autoThreshold;
  if ('autoWindow' in env) process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS = env.autoWindow;
  if ('autoCooldown' in env) process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS = env.autoCooldown;

  const app = new Hono();
  app.use('*', emergencyRunSurfaceGuard);
  app.all('*', (c) => c.json({ ok: true }));
  const res = await app.request(path, { method: 'POST' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep null
  }

  if (prevDisable === undefined) delete process.env.FLOOM_EMERGENCY_DISABLE_RUN_SURFACES;
  else process.env.FLOOM_EMERGENCY_DISABLE_RUN_SURFACES = prevDisable;
  if (prevRetry === undefined) delete process.env.FLOOM_EMERGENCY_RETRY_AFTER_SECONDS;
  else process.env.FLOOM_EMERGENCY_RETRY_AFTER_SECONDS = prevRetry;
  if (prevAutoDisabled === undefined) delete process.env.FLOOM_AUTO_EMERGENCY_DISABLED;
  else process.env.FLOOM_AUTO_EMERGENCY_DISABLED = prevAutoDisabled;
  if (prevAutoThreshold === undefined) delete process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS;
  else process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS = prevAutoThreshold;
  if (prevAutoWindow === undefined) delete process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS;
  else process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS = prevAutoWindow;
  if (prevAutoCooldown === undefined) delete process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS;
  else process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS = prevAutoCooldown;
  return { res, json, text };
}

console.log('Emergency run surface guard');

{
  const out = await request('/api/run', { disabled: 'false' });
  log('disabled flag false passes /api/run', out.res.status === 200, out.text);
}

for (const path of [
  '/mcp',
  '/mcp/app/foo',
  '/api/run',
  '/api/agents/run',
  '/api/slugify/run',
  '/api/slugify/jobs',
  '/api/slugify/jobs/job_123/cancel',
  '/api/hub/ingest',
  '/api/hub/detect',
  '/api/hub/slugify/triggers',
  '/api/me/triggers/tgr_123',
  '/hook/webhook_path',
]) {
  const out = await request(path, { disabled: 'true' });
  log(`${path} returns 503`, out.res.status === 503, out.text);
  log(`${path} has server_overloaded code`, out.json?.code === 'server_overloaded', out.text);
  log(`${path} sets Retry-After`, out.res.headers.get('retry-after') === '300', out.text);
}

for (const path of ['/api/health', '/', '/api/hub', '/api/metrics']) {
  const out = await request(path, { disabled: 'true' });
  log(`${path} remains reachable`, out.res.status === 200, out.text);
}

{
  const out = await request('/api/run', { disabled: 'true', retry: '30' });
  log('custom retry-after env is honored', out.res.headers.get('retry-after') === '30', out.text);
}

__resetEmergencyForTests();
process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS = '3';
process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS = '60000';
process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS = '60000';
const now = Date.now();
noteEmergencyRateLimitHit('ip', now);
noteEmergencyRateLimitHit('app', now + 1);
{
  const out = await request('/api/run', { disabled: 'false' });
  log('auto emergency stays open before threshold', out.res.status === 200, out.text);
}
noteEmergencyRateLimitHit('agent_token', now + 2);
{
  const out = await request('/api/run', { disabled: 'false' });
  log('auto emergency trips after threshold', out.res.status === 503, out.text);
  log('auto emergency emits retry-after', Number(out.res.headers.get('retry-after')) > 0, out.text);
}
{
  const out = await request('/api/health', { disabled: 'false' });
  log('auto emergency leaves health reachable', out.res.status === 200, out.text);
}
__resetEmergencyForTests();
delete process.env.FLOOM_AUTO_EMERGENCY_RATE_LIMIT_HITS;
delete process.env.FLOOM_AUTO_EMERGENCY_WINDOW_MS;
delete process.env.FLOOM_AUTO_EMERGENCY_COOLDOWN_MS;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
