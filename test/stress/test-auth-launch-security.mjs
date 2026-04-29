#!/usr/bin/env node
// Launch-week auth security regression coverage:
//
//   - sign-up/sign-in/get-session bodies do not leak session tokens
//   - sign-up requires email verification and duplicate signup is generic
//   - resend + verify-email flows work with the stdout email fallback
//   - stale unverified sessions do not pass cloud-mode write gates

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-auth-launch-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.BETTER_AUTH_URL = 'http://localhost:3051';
delete process.env.RESEND_API_KEY;

const { db } = await import('../../apps/server/dist/db.js');
const betterAuth = await import('../../apps/server/dist/lib/better-auth.js');
const authResponse = await import('../../apps/server/dist/lib/auth-response.js');
const { Hono } = await import('../../apps/server/node_modules/hono/dist/hono.js');
const { workspacesRouter } = await import('../../apps/server/dist/routes/workspaces.js');
const { hubRouter } = await import('../../apps/server/dist/routes/hub.js');
const { meRouter } = await import('../../apps/server/dist/routes/run.js');
const { meAppsRouter } = await import('../../apps/server/dist/routes/me_apps.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');

betterAuth._resetAuthForTests();
await betterAuth.runAuthMigrations();
const auth = betterAuth.getAuth();
const agentApp = new Hono();
agentApp.use('*', agentTokens.agentTokenAuthMiddleware);
agentApp.use('*', agentTokens.agentTokenHttpScopeMiddleware);
agentApp.route('/api/me', meRouter);
agentApp.route('/api/me/apps', meAppsRouter);
agentApp.route('/api/hub', hubRouter);

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

async function callAuth(method, path, body, cookie) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const req = new Request(`http://localhost:3051${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await auth.handler(req);
  const res = await authResponse.sanitizeAuthResponse(req, raw);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, text, json, headers: res.headers };
}

async function fetchRoute(router, method, path, body, extraHeaders = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  const req = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await router.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, text, json };
}

async function fetchApp(method, path, body, extraHeaders = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  const req = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await agentApp.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, text, json };
}

async function captureConsole(task) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((v) => String(v)).join(' '));
    originalLog(...args);
  };
  try {
    const result = await task();
    return { result, output: lines.join('\n') };
  } finally {
    console.log = originalLog;
  }
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0] || '';
}

function extractVerifyToken(logOutput) {
  const match = logOutput.match(/verify-email\?token=([^&\s]+)/);
  return match ? match[1] : null;
}

function mintAgentToken() {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, 'auth-launch-security', 'read-write', 'local', 'local', ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_auth_launch_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

console.log('Launch auth security');

try {
  const signupEmail = 'launch-auth@example.com';
  const password = 'hunter2-hunter2';

  const signup = await captureConsole(() =>
    callAuth('POST', '/auth/sign-up/email', {
      email: signupEmail,
      password,
      name: 'Launch Auth',
      callbackURL: 'http://localhost:3051/after-verify',
    }),
  );
  log('sign-up: 200 OK', signup.result.status === 200, signup.result.text);
  log('sign-up: token redacted from body', signup.result.json?.token === undefined, signup.result.text);
  log(
    'sign-up: no session cookie before verification',
    !signup.result.headers.get('set-cookie'),
    signup.result.headers.get('set-cookie') || '',
  );
  const verifyToken = extractVerifyToken(signup.output);
  log('sign-up: verification email emitted', typeof verifyToken === 'string' && verifyToken.length > 20);

  const duplicate = await callAuth('POST', '/auth/sign-up/email', {
    email: signupEmail,
    password,
    name: 'Duplicate',
  });
  log('duplicate sign-up: generic 200 response', duplicate.status === 200, duplicate.text);
  log('duplicate sign-up: no duplicate error code leaked', !duplicate.json?.code, duplicate.text);
  log('duplicate sign-up: token still redacted', duplicate.json?.token === undefined, duplicate.text);

  const preVerifySignIn = await captureConsole(() =>
    callAuth('POST', '/auth/sign-in/email', { email: signupEmail, password }),
  );
  log(
    'sign-in before verification: blocked',
    preVerifySignIn.result.status >= 400 &&
      preVerifySignIn.result.json?.code === 'EMAIL_NOT_VERIFIED',
    preVerifySignIn.result.text,
  );
  log(
    'sign-in before verification: no token leaked',
    preVerifySignIn.result.json?.token === undefined,
    preVerifySignIn.result.text,
  );

  const resend = await captureConsole(() =>
    callAuth('POST', '/auth/send-verification-email', {
      email: signupEmail,
      callbackURL: 'http://localhost:3051/after-verify',
    }),
  );
  log('send-verification-email: 200 OK', resend.result.status === 200, resend.result.text);
  const resendToken = extractVerifyToken(resend.output) || verifyToken;
  log('send-verification-email: verification token present', typeof resendToken === 'string' && resendToken.length > 20);

  const verify = await callAuth('GET', `/auth/verify-email?token=${encodeURIComponent(resendToken || '')}`);
  const verifiedCookie = extractCookie(verify.headers.get('set-cookie') || '');
  log('verify-email: 200 OK', verify.status === 200, verify.text);
  log('verify-email: auto-sign-in cookie issued', /^(__Secure-)?fsid=/.test(verifiedCookie), verifiedCookie);

  const sessionRes = await callAuth('GET', '/auth/get-session', undefined, verifiedCookie);
  log('get-session: 200 OK', sessionRes.status === 200, sessionRes.text);
  log(
    'get-session: nested session token redacted',
    sessionRes.json?.session?.token === undefined,
    sessionRes.text,
  );
  log(
    'get-session: user marked verified',
    sessionRes.json?.user?.emailVerified === true,
    sessionRes.text,
  );

  const postVerifySignIn = await callAuth('POST', '/auth/sign-in/email', {
    email: signupEmail,
    password,
  });
  log('sign-in after verification: 200 OK', postVerifySignIn.status === 200, postVerifySignIn.text);
  log(
    'sign-in after verification: token redacted from body',
    postVerifySignIn.json?.token === undefined,
    postVerifySignIn.text,
  );
  log(
    'sign-in after verification: session cookie issued',
    /(?:^|\s|;)(__Secure-)?fsid=/.test(postVerifySignIn.headers.get('set-cookie') || ''),
    postVerifySignIn.headers.get('set-cookie') || '',
  );

  auth.api.getSession = async () => ({
    user: {
      id: 'uv_blocked',
      email: 'uv-blocked@example.com',
      name: 'Blocked',
      emailVerified: false,
    },
    session: { id: 'sess_blocked' },
  });
  const blockedWrite = await fetchRoute(workspacesRouter, 'POST', '/', { name: 'Blocked workspace' });
  log(
    'unverified session: write routes are blocked in cloud mode',
    blockedWrite.status === 401 && blockedWrite.json?.code === 'auth_required',
    blockedWrite.text,
  );

  const workspaceReads = [
    ['GET /api/me/runs', meRouter, '/runs'],
    ['GET /api/me/runs/:id', meRouter, '/runs/run_missing_auth_launch'],
    ['GET /api/me/studio/stats', meRouter, '/studio/stats'],
    ['GET /api/me/studio/activity', meRouter, '/studio/activity'],
    ['GET /api/me/apps', meAppsRouter, '/'],
    ['GET /api/hub/mine', hubRouter, '/mine'],
  ];
  for (const [label, router, path] of workspaceReads) {
    const res = await fetchRoute(router, 'GET', path);
    log(
      `${label}: anonymous cloud caller gets 401`,
      res.status === 401 && res.json?.code === 'auth_required',
      res.text,
    );
  }

  const agentToken = mintAgentToken();
  const workspaceReadPaths = [
    ['GET /api/me/runs', '/api/me/runs', 200],
    ['GET /api/me/runs/:id', '/api/me/runs/run_missing_auth_launch', 404],
    ['GET /api/me/studio/stats', '/api/me/studio/stats', 200],
    ['GET /api/me/studio/activity', '/api/me/studio/activity', 200],
    ['GET /api/me/apps', '/api/me/apps', 200],
    ['GET /api/hub/mine', '/api/hub/mine', 200],
  ];
  for (const [label, path, expectedStatus] of workspaceReadPaths) {
    const res = await fetchApp('GET', path, undefined, {
      authorization: `Bearer ${agentToken}`,
    });
    log(`${label}: Agent token passes auth gate`, res.status === expectedStatus, res.text);
  }
} finally {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
