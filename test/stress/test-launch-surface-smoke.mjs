#!/usr/bin/env node
/**
 * Non-destructive launch surface smoke against deployed Floom URLs.
 *
 * Defaults:
 *   FLOOM_BASE_URL=https://floom.dev
 *   FLOOM_SMOKE_SLUG=uuid
 *
 * Optional:
 *   FLOOM_PREVIEW_URL=https://preview.floom.dev
 *
 * The only write is one deterministic public utility app run per target URL.
 * The waitlist check submits an invalid email and verifies rejection.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const TIMEOUT_MS = Number(process.env.FLOOM_SMOKE_TIMEOUT_MS || 30_000);
const POLL_TIMEOUT_MS = Number(process.env.FLOOM_SMOKE_POLL_TIMEOUT_MS || 30_000);
const SLUG = process.env.FLOOM_SMOKE_SLUG || 'uuid';

const targets = [];
if (process.env.FLOOM_BASE_URL === '') {
  throw new Error('FLOOM_BASE_URL cannot be an empty string');
}
targets.push({
  label: 'base',
  baseUrl: normalizeBaseUrl(process.env.FLOOM_BASE_URL || 'https://floom.dev'),
});
if (process.env.FLOOM_PREVIEW_URL) {
  targets.push({
    label: 'preview',
    baseUrl: normalizeBaseUrl(process.env.FLOOM_PREVIEW_URL),
  });
}

let passed = 0;
let failed = 0;
const failures = [];

function normalizeBaseUrl(raw) {
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function record(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
    return;
  }
  failed += 1;
  failures.push({ label, detail });
  console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
}

function info(label, detail = '') {
  console.log(`  info  ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return { json: text ? JSON.parse(text) : null, text };
  } catch {
    return { json: null, text };
  }
}

function setCookieHeader(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }
  const raw = res.headers.get('set-cookie') || '';
  return raw
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function getJson(target, path, assertFn) {
  const res = await fetchWithTimeout(`${target.baseUrl}${path}`, {
    headers: { accept: 'application/json' },
  });
  const { json, text } = await readJson(res);
  record(`${target.label} GET ${path} returns 200`, res.status === 200, `status=${res.status} body=${text.slice(0, 200)}`);
  if (res.status === 200) {
    assertFn(json, text);
  }
  return json;
}

async function checkProjectsAlias(target) {
  const res = await fetchWithTimeout(`${target.baseUrl}/api/projects`, {
    headers: { accept: 'application/json' },
  });
  const { json, text } = await readJson(res);
  const label = `${target.label} GET /api/projects`;
  if (target.label !== 'base' && res.status === 404) {
    info(`${label} optional preview alias is absent`, 'canonical /api/hub is checked separately');
    return;
  }
  record(`${label} returns 200`, res.status === 200, `status=${res.status} body=${text.slice(0, 200)}`);
  if (res.status === 200) {
    const apps = Array.isArray(json) ? json : json?.apps;
    record(`${target.label} /api/projects returns apps`, Array.isArray(apps) && apps.length > 0, text.slice(0, 200));
  }
}

async function postJson(target, path, body, extraHeaders = {}) {
  const res = await fetchWithTimeout(`${target.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const cookie = setCookieHeader(res);
  const parsed = await readJson(res);
  return { res, cookie, ...parsed };
}

async function mcpInitialize(target, path) {
  const response = await postJson(target, path, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'floom-launch-surface-smoke', version: '1.0.0' },
    },
  });
  record(`${target.label} POST ${path} initialize returns 200`, response.res.status === 200, `status=${response.res.status} body=${response.text.slice(0, 200)}`);
  if (response.res.status === 200) {
    record(
      `${target.label} ${path} initialize advertises tools`,
      response.json?.result?.capabilities?.tools !== undefined,
      response.text.slice(0, 300),
    );
    record(
      `${target.label} ${path} initialize has server name`,
      typeof response.json?.result?.serverInfo?.name === 'string',
      response.text.slice(0, 300),
    );
  }
}

async function mcpSearchTools(target) {
  const response = await postJson(target, '/mcp/search', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  record(`${target.label} POST /mcp/search tools/list returns 200`, response.res.status === 200, `status=${response.res.status} body=${response.text.slice(0, 200)}`);
  if (response.res.status === 200) {
    const names = (response.json?.result?.tools || []).map((tool) => tool.name);
    record(`${target.label} /mcp/search exposes search_apps`, names.includes('search_apps'), JSON.stringify(names));
  }
}

async function publicAppRun(target) {
  const started = await postJson(target, `/api/${encodeURIComponent(SLUG)}/run`, {
    inputs: { version: 'v4', count: 1 },
  });
  record(`${target.label} POST /api/${SLUG}/run returns 200`, started.res.status === 200, `status=${started.res.status} body=${started.text.slice(0, 300)}`);
  const runId = started.json?.run_id;
  record(`${target.label} POST /api/${SLUG}/run returns run_id`, typeof runId === 'string' && runId.length > 0, started.text.slice(0, 300));
  if (typeof runId !== 'string') return;

  const cookieHeader = started.cookie ? { cookie: started.cookie } : {};
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetchWithTimeout(`${target.baseUrl}/api/run/${encodeURIComponent(runId)}`, {
      headers: { accept: 'application/json', ...cookieHeader },
      timeout: 10_000,
    });
    const parsed = await readJson(res);
    last = { status: res.status, ...parsed };
    if (res.status === 200 && parsed.json && !['pending', 'running'].includes(parsed.json.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  record(`${target.label} GET /api/run/${runId} owner poll returns 200`, last?.status === 200, JSON.stringify(last?.json || last?.text || '').slice(0, 400));
  record(`${target.label} ${SLUG} run succeeds`, last?.json?.status === 'success', JSON.stringify(last?.json || {}).slice(0, 500));
  if (SLUG === 'uuid') {
    record(
      `${target.label} ${SLUG} run returns UUID output`,
      Array.isArray(last?.json?.outputs?.uuids) && last.json.outputs.uuids.length >= 1,
      JSON.stringify(last?.json?.outputs || {}).slice(0, 300),
    );
  }
}

async function waitlistInvalidEmail(target) {
  const response = await postJson(target, '/api/waitlist', {
    email: 'not-an-email',
    source: 'launch-surface-smoke',
  });
  record(`${target.label} POST /api/waitlist invalid email returns 400`, response.res.status === 400, `status=${response.res.status} body=${response.text.slice(0, 200)}`);
  record(`${target.label} POST /api/waitlist invalid email code`, response.json?.error === 'invalid_email', response.text.slice(0, 200));
}

async function smokeTarget(target) {
  console.log(`\n[${target.label}] ${target.baseUrl}`);

  await getJson(target, '/api/health', (json, text) => {
    record(`${target.label} /api/health status ok`, json?.status === 'ok', text.slice(0, 200));
    record(`${target.label} /api/health version present`, typeof json?.version === 'string' && json.version.length > 0, text.slice(0, 200));
  });

  await getJson(target, '/api/healthz', (json, text) => {
    record(`${target.label} /api/healthz ok true`, json?.ok === true, text.slice(0, 200));
  });

  await getJson(target, '/api/session/me', (json, text) => {
    record(`${target.label} /api/session/me cloud_mode boolean`, typeof json?.cloud_mode === 'boolean', text.slice(0, 200));
    record(`${target.label} /api/session/me deploy_enabled boolean`, typeof json?.deploy_enabled === 'boolean', text.slice(0, 200));
  });

  await checkProjectsAlias(target);

  await getJson(target, '/api/hub', (json, text) => {
    const apps = Array.isArray(json) ? json : json?.apps;
    record(`${target.label} /api/hub returns apps`, Array.isArray(apps) && apps.length > 0, text.slice(0, 200));
    record(`${target.label} /api/hub includes ${SLUG}`, Array.isArray(apps) && apps.some((app) => app?.slug === SLUG), text.slice(0, 400));
  });

  await getJson(target, `/api/hub/${encodeURIComponent(SLUG)}`, (json, text) => {
    record(`${target.label} /api/hub/${SLUG} slug matches`, json?.slug === SLUG, text.slice(0, 200));
  });

  const page = await fetchWithTimeout(`${target.baseUrl}/p/${encodeURIComponent(SLUG)}`, {
    headers: { accept: 'text/html' },
  });
  const pageText = await page.text();
  record(`${target.label} GET /p/${SLUG} returns 200`, page.status === 200, `status=${page.status}`);
  record(`${target.label} GET /p/${SLUG} serves HTML`, /text\/html/.test(page.headers.get('content-type') || '') && pageText.includes('<html'), pageText.slice(0, 200));

  await mcpInitialize(target, '/mcp');
  await mcpSearchTools(target);
  await mcpInitialize(target, `/mcp/app/${encodeURIComponent(SLUG)}`);
  await publicAppRun(target);
  await waitlistInvalidEmail(target);
}

function smokeCliVersion() {
  console.log('\n[local CLI]');
  const cli = join(REPO_ROOT, 'cli/floom/bin/floom');
  record('cli/floom/bin/floom exists', existsSync(cli), cli);
  if (!existsSync(cli)) return;
  const result = spawnSync(cli, ['--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, FLOOM_CLI_NO_BROWSER: '1' },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  record('floom --version exits 0', result.status === 0, output);
  record('floom --version prints semver', /^\d+\.\d+\.\d+/.test(output), output);
}

console.log('Floom launch surface smoke');
console.log(`Targets: ${targets.map((target) => `${target.label}=${target.baseUrl}`).join(', ')}`);
console.log(`Public run slug: ${SLUG}`);

for (const target of targets) {
  await smokeTarget(target);
}
smokeCliVersion();

console.log('\n' + '='.repeat(60));
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const failure of failures) {
    console.log(`  - ${failure.label}${failure.detail ? ` :: ${failure.detail}` : ''}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
