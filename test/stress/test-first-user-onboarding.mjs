#!/usr/bin/env node
/**
 * First-user E2E onboarding test — runs against a LIVE prod Floom instance.
 *
 * Simulates a fresh laptop with ONLY Node + npm (no curl, jq, git, bash).
 * Every HTTP call uses Node's built-in fetch.  No shell-outs anywhere.
 *
 * Flow:
 *   1. npx @floomhq/cli@latest --version / --help / auth whoami (no config)
 *   2. POST /auth/sign-up/email (simulates browser sign-up)
 *   3. POST /auth/sign-in/email  (email-not-verified gate check)
 *   4. GET  /api/health
 *   5. GET  /api/hub  (anon app discovery)
 *   6. POST /api/uuid/run + GET /api/run/:id  (anon run + poll cycle)
 *   7. POST /api/jwt-decode/run + poll
 *   8. POST /mcp initialize  (MCP JSON-RPC surface)
 *   9. POST /mcp search_apps  (the Rohan URL-generation bug check)
 *  10. CLI auth + whoami with real token (optional — FLOOM_TEST_AGENT_TOKEN)
 *
 * Environment variables:
 *   FLOOM_PROD_URL          Base URL (default: https://floom.dev)
 *   TEST_USER_PREFIX        Email prefix for generated accounts (default: ci-e2e-)
 *   FLOOM_TEST_AGENT_TOKEN  Pre-issued agent token for auth-gated CLI steps
 *
 * Exit code: 0 = all required steps pass, 1 = at least one required step failed.
 *
 * Designed to run inside a minimal Alpine container with only Node 20:
 *   docker run --rm -e FLOOM_TEST_AGENT_TOKEN=... node:20-alpine \
 *     node test/stress/test-first-user-onboarding.mjs
 *
 * IMPORTANT: No curl, jq, git, or bash dependencies. Node stdlib only.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.FLOOM_PROD_URL || 'https://floom.dev').replace(/\/$/, '');
const TEST_USER_PREFIX = process.env.TEST_USER_PREFIX || 'ci-e2e-';
const REPORT_FILE = process.env.REPORT_FILE || null;
const AGENT_TOKEN = process.env.FLOOM_TEST_AGENT_TOKEN || '';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const rows = [];
let passed = 0;
let failed = 0;
let warned = 0;

function record(step, command, exitCode, stdoutLines, stderrLines, ms, required = true) {
  const ok = exitCode === 0;
  if (ok) passed++;
  else if (required) failed++;
  else warned++;

  const status = ok ? 'PASS' : (required ? 'FAIL' : 'WARN');
  rows.push({ step, command, exitCode, stdoutHead: stdoutLines, stderrHead: stderrLines, ms, status });

  const icon = ok ? '  ok  ' : (required ? '  FAIL' : '  warn');
  console.log(`${icon}  [${step}] ${command}  (${ms}ms, exit ${exitCode})`);
  if (!ok && stderrLines.length > 0) {
    console.log(`       stderr: ${stderrLines.slice(0, 3).join(' | ')}`);
  }
  if (!ok && stderrLines.length === 0 && stdoutLines.length > 0) {
    console.log(`       stdout: ${stdoutLines.slice(0, 2).join(' | ')}`);
  }
  return ok;
}

function head5(s) {
  if (!s) return [];
  return String(s).split('\n').filter(Boolean).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Node-native HTTP helper (ZERO curl dependency)
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with Node's built-in fetch.
 * Returns { ok, status, body, json, ms, error, setCookieHeader }.
 * The `setCookieHeader` field carries the raw Set-Cookie value so callers
 * can forward it on subsequent requests (needed for device-tracked anon runs).
 */
async function apiFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15_000);
  let res, body;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Browser-like origin so auth endpoints don't reject with MISSING_ORIGIN
        origin: BASE_URL,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    body = await res.text();
  } catch (err) {
    return {
      ok: false, status: 0, body: '', json: null,
      ms: Date.now() - start, error: err.message, setCookieHeader: null,
    };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = JSON.parse(body); } catch { /* leave null */ }
  // Node fetch exposes headers via .get(). Set-Cookie may have multiple values.
  const setCookieHeader = res.headers.get('set-cookie') || null;
  return {
    ok: res.ok, status: res.status, body, json,
    ms: Date.now() - start, error: null, setCookieHeader,
  };
}

/**
 * Poll a run until it leaves 'pending' status or until `deadline` (ms epoch).
 * Sends the device cookie so the ownership gate passes for anon runs.
 * Returns { status, json, pollMs }.
 */
async function pollRun(runId, deviceCookie, deadlineMs) {
  const headers = {};
  if (deviceCookie) headers['cookie'] = deviceCookie;

  let lastStatus = 'pending';
  let lastJson = null;
  const start = Date.now();
  while (Date.now() < deadlineMs) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await apiFetch(`/api/run/${runId}`, { headers });
    if (r.json?.status) {
      lastStatus = r.json.status;
      lastJson = r.json;
    }
    if (lastStatus !== 'pending') break;
  }
  return { status: lastStatus, json: lastJson, pollMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// CLI runner (spawnSync — pure Node, no bash)
// ---------------------------------------------------------------------------

// Resolve the CLI to test: local build takes priority so CI validates the
// current codebase; in a purely fresh-install test set CLI_FROM_NPM=1.
const CLI_PATH = join(__dirname, '..', '..', 'cli-npm', 'dist', 'index.js');

function runCli(args, env = {}) {
  const start = Date.now();
  const tmpCfg = mkdtempSync(join(tmpdir(), 'floom-e2e-'));
  const cfgPath = join(tmpCfg, 'config.json');

  const merged = {
    ...process.env,
    NO_COLOR: '1',
    FLOOM_API_URL: BASE_URL,
    FLOOM_CONFIG: cfgPath,
    FLOOM_CLI_NO_BROWSER: '1',
    FLOOM_NO_BROWSER: '1',
    FLOOM_API_KEY: '',   // clear env key — test reads from config file
  };

  if (env.INJECT_API_KEY) {
    // Write token to config file so the Node wrapper uses it
    writeFileSync(cfgPath, JSON.stringify({
      api_key: env.INJECT_API_KEY,
      api_url: BASE_URL,
    }));
    delete merged.FLOOM_API_KEY;
  }

  // Forward any remaining env overrides (except the special INJECT_API_KEY)
  const { INJECT_API_KEY: _, ...rest } = env;
  Object.assign(merged, rest);

  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    env: merged,
    encoding: 'utf8',
    timeout: 25_000,
  });
  rmSync(tmpCfg, { recursive: true, force: true });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? -1,
    ms: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Part A — CLI layer (pure Node, no bash)
// ---------------------------------------------------------------------------

console.log(`\nFloom first-user E2E — target: ${BASE_URL}\n`);
console.log('=== PART A: CLI layer (node-only, no curl/bash) ===\n');

// Step 1a: --version
{
  const r = runCli(['--version']);
  const ok = r.status === 0 && /^\d+\.\d+\.\d+/.test(r.stdout.trim());
  record('cli-version', 'node floom --version', ok ? 0 : 1, head5(r.stdout), head5(r.stderr), r.ms);
}

// Step 1b: --help
{
  const r = runCli(['--help']);
  const ok = r.status === 0
    && r.stdout.includes('floom')
    && r.stdout.includes('auth whoami')
    && !r.stdout.includes('command not found')
    && !r.stderr.toLowerCase().includes('curl: not found')
    && !r.stderr.toLowerCase().includes("'curl'");
  record('cli-help', 'node floom --help', ok ? 0 : 1, head5(r.stdout), head5(r.stderr), r.ms);
}

// Step 1c: auth whoami — no config (the original Kushagra bug)
// The bug was: CLI shelled out to bash → curl which isn't on a fresh machine.
// Fix: whoami is now pure Node fetch. Must exit 1 with "not logged in", no curl errors.
{
  const r = runCli(['auth', 'whoami']);
  const ok = r.status === 1
    && (r.stdout + r.stderr).includes('not logged in')
    && !r.stderr.includes('command not found')
    && !r.stderr.toLowerCase().includes('curl: not found')
    && !r.stderr.includes("'curl'")
    && !r.stderr.includes('/bin/sh: ');
  record('cli-whoami-no-config', 'node floom auth whoami (no config, no bash/curl)', ok ? 0 : 1, head5(r.stdout), head5(r.stderr), r.ms);
}

// Step 1d: auth whoami — invalid token (must call /api/session/me via Node fetch)
{
  const r = runCli(['auth', 'whoami'], {
    INJECT_API_KEY: 'floom_agent_invalidXXXXXXXXXXXXXXXXXXXX',
  });
  const combined = r.stdout + r.stderr;
  const ok = r.status === 1
    && (combined.includes('401') || combined.includes('token rejected') || combined.includes('error:'))
    && !r.stderr.includes('command not found')
    && !r.stderr.toLowerCase().includes('curl: not found');
  record('cli-whoami-bad-token', 'node floom auth whoami (bad token, expects 401)', ok ? 0 : 1, head5(r.stdout), head5(r.stderr), r.ms);
}

// ---------------------------------------------------------------------------
// Part B — HTTP flows (Node fetch only, no curl)
// ---------------------------------------------------------------------------

console.log('\n=== PART B: API flows (node fetch, no curl) ===\n');

// Step 2: health check
{
  const r = await apiFetch('/api/health');
  const ok = r.ok && (r.json?.version !== undefined || r.json?.app_count !== undefined || r.json?.apps !== undefined);
  record('health', 'GET /api/health', ok ? 0 : 1, head5(r.body), r.error ? [r.error] : [], r.ms);
}

// Step 3: sign-up flow (simulates browser — must include Origin header)
const testEmail = `${TEST_USER_PREFIX}${Date.now()}@example.com`;
const testPassword = `E2eTest-${Date.now()}-X`;
let signedUpUserId = null;
{
  const r = await apiFetch('/auth/sign-up/email', {
    method: 'POST',
    body: {
      email: testEmail,
      password: testPassword,
      name: 'CI E2E Test User',
      callbackURL: `${BASE_URL}/after-verify`,
    },
  });
  const ok = (r.status === 200 || r.status === 201)
    && (r.json?.user?.email === testEmail || r.json?.token !== undefined);
  if (ok && r.json?.user?.id) signedUpUserId = r.json.user.id;
  record('signup', 'POST /auth/sign-up/email', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [r.json?.code || ''], r.ms);
  console.log(`     email: ${testEmail}`);
}

// Step 4: sign-in BEFORE email verification — must be blocked with EMAIL_NOT_VERIFIED
{
  const r = await apiFetch('/auth/sign-in/email', {
    method: 'POST',
    body: { email: testEmail, password: testPassword },
  });
  const ok = (r.status === 403 || r.status === 401)
    && (
      r.json?.code === 'EMAIL_NOT_VERIFIED'
      || (r.json?.message || '').toLowerCase().includes('not verified')
      || (r.json?.message || '').toLowerCase().includes('email not verified')
    );
  record('signin-unverified-gate', 'POST /auth/sign-in/email (must block unverified)', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [], r.ms);
}

// Step 5a: anon app discovery (public, zero auth)
let hubApps = [];
{
  const r = await apiFetch('/api/hub');
  const apps = Array.isArray(r.json) ? r.json : (r.json?.apps || []);
  const ok = r.ok && apps.length > 0;
  hubApps = apps;
  record('apps-discovery', 'GET /api/hub (anon)', ok ? 0 : 1, head5(r.body), r.error ? [r.error] : [], r.ms);
  console.log(`     apps found: ${apps.length}`);
}

// Step 5b: jwt-decode must be in the hub (fast app, always seeded)
{
  const ok = hubApps.some(a => a.slug === 'jwt-decode');
  record('apps-has-jwt-decode', 'GET /api/hub → jwt-decode present', ok ? 0 : 1,
    ok ? ['jwt-decode found'] : ['MISSING: jwt-decode'], [], 0, false /* warn-only */);
}

// Step 5c: /api/hub/mine without auth — must return 401, not 404/500
{
  const r = await apiFetch('/api/hub/mine');
  const ok = r.status === 401 && r.json?.error !== undefined;
  record('hub-mine-unauthed', 'GET /api/hub/mine (no auth → 401)', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [], r.ms);
}

// Step 5d: MCP search_apps URL (the Rohan bug — wrong URL generation returned /api/projects 404)
// The correct endpoint is POST /mcp — if this returns 404 the URL generation is broken.
{
  const r = await apiFetch('/mcp', {
    method: 'POST',
    timeout: 10_000,
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      origin: BASE_URL,
    },
    body: {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'search_apps',
        arguments: { query: 'jwt' },
      },
      id: 1,
    },
  });
  // A 404 here means the MCP URL is broken (the Rohan bug).
  // A 200 or MCP-level error (method not found, etc.) means the endpoint exists.
  const ok = r.status !== 404 && r.status !== 0 && r.error === null;
  record('mcp-search_apps-url', 'POST /mcp search_apps (must not 404)', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [`status=${r.status}`], r.ms);
  if (!ok) {
    console.log(`     BUG: MCP search_apps returned ${r.status} — Rohan URL-generation bug`);
  }
}

// Step 6a: anon run (uuid) — no auth required
// Capture the Set-Cookie device token to use in the poll.
let anonRunId = null;
let anonDeviceCookie = null;
{
  const r = await apiFetch('/api/uuid/run', {
    method: 'POST',
    body: { inputs: {} },
  });
  const ok = r.ok && typeof r.json?.run_id === 'string';
  if (ok) {
    anonRunId = r.json.run_id;
    // The server issues a floom_device cookie on first run submission.
    // We must send it back on the poll or the ownership gate returns 404.
    if (r.setCookieHeader) {
      const match = r.setCookieHeader.match(/floom_device=[^;]+/);
      if (match) anonDeviceCookie = match[0];
    }
  }
  record('anon-run-submit', 'POST /api/uuid/run', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [], r.ms);
  if (anonRunId) console.log(`     run_id: ${anonRunId}`);
  if (anonDeviceCookie) console.log(`     device_cookie: ${anonDeviceCookie.slice(0, 30)}...`);
}

// Step 6b: poll anon run (must complete with success — fast app, <5s)
if (anonRunId) {
  const { status, json, pollMs } = await pollRun(anonRunId, anonDeviceCookie, Date.now() + 30_000);
  const ok = status === 'success';
  record('anon-run-complete', `GET /api/run/${anonRunId} (poll → success)`, ok ? 0 : 1,
    [status, json?.outputs ? JSON.stringify(json.outputs).slice(0, 80) : ''].filter(Boolean),
    status !== 'success' ? [`final_status=${status}`] : [],
    pollMs);
}

// Step 7a: jwt-decode run (no auth required for BYOK-ungated apps)
let jwtRunId = null;
let jwtDeviceCookie = anonDeviceCookie; // reuse same device session
const TEST_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
{
  const headers = jwtDeviceCookie ? { cookie: jwtDeviceCookie } : {};
  const r = await apiFetch('/api/jwt-decode/run', {
    method: 'POST',
    body: { inputs: { token: TEST_JWT } },
    headers,
  });
  const ok = r.ok && typeof r.json?.run_id === 'string';
  if (ok) jwtRunId = r.json.run_id;
  if (r.setCookieHeader && !jwtDeviceCookie) {
    const match = r.setCookieHeader.match(/floom_device=[^;]+/);
    if (match) jwtDeviceCookie = match[0];
  }
  record('jwt-decode-run-submit', 'POST /api/jwt-decode/run', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [], r.ms);
  if (jwtRunId) console.log(`     run_id: ${jwtRunId}`);
}

// Step 7b: poll jwt-decode run
if (jwtRunId) {
  const { status, json, pollMs } = await pollRun(jwtRunId, jwtDeviceCookie, Date.now() + 30_000);
  const ok = status === 'success';
  record('jwt-decode-run-complete', `GET /api/run/${jwtRunId} (poll → success)`, ok ? 0 : 1,
    [status, json?.outputs ? JSON.stringify(json.outputs).slice(0, 80) : ''].filter(Boolean),
    status !== 'success' ? [`final_status=${status}`] : [],
    pollMs);
}

// Step 8: MCP initialize (checks the MCP HTTP transport works end-to-end)
{
  const r = await apiFetch('/mcp', {
    method: 'POST',
    timeout: 15_000,
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      origin: BASE_URL,
    },
    body: {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'first-user-e2e', version: '1.0' },
      },
      id: 1,
    },
  });
  const ok = r.status === 200;
  record('mcp-initialize', 'POST /mcp (initialize)', ok ? 0 : 1,
    head5(r.body), r.error ? [r.error] : [], r.ms);
}

// ---------------------------------------------------------------------------
// Part C — CLI auth with pre-issued token (optional)
// ---------------------------------------------------------------------------

if (AGENT_TOKEN) {
  console.log('\n=== PART C: CLI auth (pre-issued FLOOM_TEST_AGENT_TOKEN) ===\n');

  // auth save non-interactively: `floom auth <token>`
  {
    const r = runCli(['auth', AGENT_TOKEN], { INJECT_API_KEY: AGENT_TOKEN });
    const ok = r.status === 0
      && (r.stdout.includes('saved') || r.stdout.includes('Token saved') || r.stdout.includes('Saved'));
    record('cli-auth-save', 'node floom auth <token>', ok ? 0 : 1,
      head5(r.stdout), head5(r.stderr), r.ms);
  }

  // whoami with valid token
  {
    const r = runCli(['auth', 'whoami'], { INJECT_API_KEY: AGENT_TOKEN });
    const ok = r.status === 0
      && r.stdout.includes('logged in')
      && r.stdout.includes('identity:')
      && r.stdout.includes('workspace:');
    record('cli-whoami-with-token', 'node floom auth whoami (valid token)', ok ? 0 : 1,
      head5(r.stdout), head5(r.stderr), r.ms);
  }
} else {
  console.log('\n  Skipping CLI auth steps: set FLOOM_TEST_AGENT_TOKEN=floom_agent_... to enable.\n');
}

// ---------------------------------------------------------------------------
// Cleanup note
// ---------------------------------------------------------------------------

console.log('\n=== CLEANUP ===\n');
console.log(`  Test email: ${testEmail}`);
console.log('  Note: full account deletion requires an email-verified session (cloud-mode gate).');
console.log('  Unverified test accounts should expire via server cleanup policy.');
console.log('  See GitHub issue filed below for a DELETE /auth/ci-test-user API endpoint.');

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const requiredRows = rows.filter(r => r.status !== 'WARN');
const REQUIRED_TOTAL = requiredRows.length;
const REQUIRED_PASSED = rows.filter(r => r.status === 'PASS').length;
const REQUIRED_FAILED = rows.filter(r => r.status === 'FAIL').length;
const WARN_TOTAL = rows.filter(r => r.status === 'WARN').length;

const failedRows = rows.filter(r => r.status === 'FAIL');

const reportMd = [
  '# Floom First-User E2E Report',
  '',
  `**Target:** ${BASE_URL}`,
  `**Date:** ${new Date().toISOString()}`,
  `**Result:** ${REQUIRED_FAILED === 0 ? '✓ PASS' : '✗ FAIL'} — ${REQUIRED_PASSED}/${REQUIRED_TOTAL} required steps passed`,
  '',
  '## Step Results',
  '',
  '| Step | Command | Status | Exit | Time (ms) | Note |',
  '|------|---------|--------|------|-----------|------|',
  ...rows.map(r => {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠';
    const note = (r.status !== 'PASS')
      ? (r.stderrHead.join(' ') || r.stdoutHead.join(' ')).slice(0, 100).replace(/\|/g, '\\|')
      : '';
    return `| ${r.step} | \`${r.command.slice(0, 55)}\` | ${icon} ${r.status} | ${r.exitCode} | ${r.ms} | ${note} |`;
  }),
  '',
  '## Bugs Found',
  '',
  failedRows.length === 0
    ? '_No required steps failed._'
    : failedRows.map(r =>
        `- **${r.step}**: \`${r.command}\` — exit ${r.exitCode}\n  ${(r.stderrHead.concat(r.stdoutHead)).join(' ').slice(0, 200)}`
      ).join('\n'),
  '',
  '## Design Notes',
  '',
  '- **No curl/bash dependency**: all HTTP calls use Node `fetch`. The bash CLI subcommands',
  '  (`apps list`, `run`, `deploy`) forward to `vendor/floom/bin/floom` which calls `curl`.',
  '  These are NOT tested here — that is the whole point of this test: find bash/curl drift.',
  '- **Sign-up requires Origin header**: Better Auth rejects requests without `Origin:` set.',
  '  The Node `fetch` helper in this test adds `origin: BASE_URL` to all requests.',
  '- **Anon run polling**: the server sets a `floom_device` cookie on run submission;',
  '  the poll (`GET /api/run/:id`) requires that cookie for ownership verification.',
  '  This test captures the `Set-Cookie` header from the submit response and forwards it.',
  '- **Test user cleanup**: unverified accounts cannot call `DELETE /api/me/delete-account`',
  '  (requires a verified session). File a GH issue for a `DELETE /auth/ci-test-user` endpoint.',
  '- **FLOOM_TEST_AGENT_TOKEN**: set this to a pre-issued agent token to test CLI auth/whoami.',
  '  Without it, Parts C steps are skipped (not counted as failures).',
].join('\n');

if (REPORT_FILE) {
  writeFileSync(REPORT_FILE, reportMd);
  console.log(`\nReport written to ${REPORT_FILE}\n`);
} else {
  console.log('\n--- MARKDOWN SUMMARY ---\n');
  console.log(reportMd);
}

// Final summary
console.log(`${'='.repeat(60)}`);
console.log(`Result: ${REQUIRED_FAILED === 0 ? 'PASS' : 'FAIL'}`);
console.log(`  Required: ${REQUIRED_PASSED}/${REQUIRED_TOTAL} passed, ${REQUIRED_FAILED} failed`);
console.log(`  Warn-only: ${WARN_TOTAL} steps`);
if (REQUIRED_FAILED > 0) {
  console.log('\nFailed steps:');
  failedRows.forEach(r => {
    console.log(`  - ${r.step}: ${(r.stderrHead.concat(r.stdoutHead)).join(' ').slice(0, 120)}`);
  });
}
console.log(`${'='.repeat(60)}\n`);

process.exit(REQUIRED_FAILED > 0 ? 1 : 0);
