#!/usr/bin/env node
/**
 * agent-auth-fixture.mjs — durable test-user auth fixture for headless screenshot verification.
 *
 * Approach: Option A — test user with email-verification bypass via DB.
 *   1. Create `agent-screenshot@floom-test.dev` if it doesn't exist.
 *      - Try POST /auth/sign-up/email first.
 *      - If sign-up is disabled (DEPLOY_ENABLED=false → 403), fall back to a
 *        direct DB insert via `docker exec` on the local container.
 *   2. Mark emailVerified=1 directly in the prod SQLite DB (via `docker exec`).
 *   3. Sign in via POST /auth/sign-in/email to get a session cookie.
 *   4. Save cookie to /root/.config/floom-secrets/agent-screenshot.cookie (mode 0600).
 *
 * Why Option A over B/C:
 *   - No admin-impersonate endpoint exists; adding one on public prod is a security risk.
 *   - FLOOM_REQUIRE_EMAIL_VERIFY=false is not set in prod.env.canonical.
 *   - Direct DB write via docker exec is safe, auditable, requires no server changes.
 *
 * Usage:
 *   node scripts/agent-auth-fixture.mjs init    — create user if needed + save cookie
 *   node scripts/agent-auth-fixture.mjs refresh — re-sign-in (use if cookie expired)
 *   node scripts/agent-auth-fixture.mjs cookie  — print current cookie value to stdout
 *
 * Env vars:
 *   FLOOM_API_URL    — default: https://floom.dev
 *   FLOOM_LOCAL_PORT — when set, hits localhost directly (e.g. 3055 for prod container)
 *   FLOOM_CONTAINER  — docker container name (default: floom-prod-waitlist)
 *
 * Cookie stored at /root/.config/floom-secrets/agent-screenshot.cookie (mode 0600).
 * The file is gitignored — never commit it.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const TEST_EMAIL = 'agent-screenshot@floom-test.dev';
const TEST_PASSWORD = 'AgentScreenshotPass123!';
const TEST_NAME = 'Agent Screenshot';
const COOKIE_PATH = '/root/.config/floom-secrets/agent-screenshot.cookie';
const CONTAINER = process.env.FLOOM_CONTAINER || 'floom-prod-waitlist';
const DB_PATH = '/data/floom-chat.db';

function apiBase() {
  const localPort = process.env.FLOOM_LOCAL_PORT;
  if (localPort) return `http://127.0.0.1:${localPort}`;
  return process.env.FLOOM_API_URL || 'https://floom.dev';
}

function log(msg) {
  process.stderr.write(`[agent-auth-fixture] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function authPost(path, payload) {
  const url = `${apiBase()}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://floom.dev',
    },
    body: JSON.stringify(payload),
    redirect: 'manual',
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  const cookieHeader = resp.headers.get('set-cookie') || '';
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, body, cookieHeader };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Execute a Node.js script string inside the prod container via docker exec.
 * Writes the script to a temp file to avoid shell quoting issues.
 */
function dockerExecNodeScript(scriptContent) {
  const tmpFile = `/tmp/agent-fixture-script-${process.pid}.cjs`;
  writeFileSync(tmpFile, scriptContent, 'utf8');
  // Copy the script into /app/apps/server/ so Node's upward directory traversal
  // finds /app/node_modules (pnpm virtual store, where better-sqlite3 lives).
  // The container CWD is /app/apps/server, so this is the deepest level that
  // correctly resolves workspace packages.
  const containerPath = '/app/apps/server/agent-fixture-script.cjs';
  try {
    execSync(`docker cp ${tmpFile} ${CONTAINER}:${containerPath}`, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const out = execSync(
      `docker exec ${CONTAINER} node ${containerPath}`,
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try {
      execSync(`docker exec ${CONTAINER} rm -f /app/apps/server/agent-fixture-script.cjs`, {
        encoding: 'utf8', timeout: 5_000,
      });
    } catch { /* ignore */ }
  }
}

/**
 * Check if the test user exists in the DB. Returns { exists, id, emailVerified }.
 */
function dbCheckUser() {
  const script = `
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}', { readonly: true });
const user = db.prepare('SELECT id, emailVerified FROM "user" WHERE email = ?').get('${TEST_EMAIL}');
console.log(JSON.stringify(user || null));
`;
  const out = dockerExecNodeScript(script);
  const user = JSON.parse(out);
  if (!user) return { exists: false, id: null, emailVerified: false };
  return { exists: true, id: user.id, emailVerified: Boolean(user.emailVerified) };
}

/**
 * Create the test user directly in the SQLite DB.
 * The password hash is computed inside the container script (using Better Auth's scrypt format).
 */
function dbCreateUser() {
  const userId = randomBytes(15).toString('base64url').slice(0, 28);
  const accountId = randomBytes(15).toString('base64url').slice(0, 28);
  const now = new Date().toISOString();

  const script = `
'use strict';
const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('${DB_PATH}');
const email = '${TEST_EMAIL}';
const name = '${TEST_NAME}';
const password = '${TEST_PASSWORD}';
const userId = '${userId}';
const accountId = '${accountId}';
const now = '${now}';

const existing = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
if (existing) {
  console.log(JSON.stringify({ status: 'exists', id: existing.id }));
  process.exit(0);
}

const salt = crypto.randomBytes(16).toString('hex');
const hashBuf = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
const passwordHash = '16384:8:1:' + salt + ':' + hashBuf.toString('hex');

db.prepare('INSERT INTO "user" (id, email, name, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, ?, ?)').run(userId, email, name, now, now);
db.prepare('INSERT INTO account (id, userId, providerId, accountId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(accountId, userId, 'credential', userId, passwordHash, now, now);
db.prepare('INSERT OR IGNORE INTO users (id, email, name, auth_provider, auth_subject) VALUES (?, ?, ?, ?, ?)').run(userId, email, name, 'better-auth', userId);

console.log(JSON.stringify({ status: 'created', id: userId }));
`;

  const out = dockerExecNodeScript(script);
  const result = JSON.parse(out);
  log(`DB create result: ${JSON.stringify(result)}`);
  return result.status; // 'created' or 'exists'
}

/**
 * Mark the test user's email as verified. Idempotent.
 */
function dbMarkEmailVerified() {
  const script = `
'use strict';
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}');
const result = db.prepare('UPDATE "user" SET emailVerified = 1 WHERE email = ?').run('${TEST_EMAIL}');
const user = db.prepare('SELECT id, emailVerified FROM "user" WHERE email = ?').get('${TEST_EMAIL}');
console.log(JSON.stringify({ changes: result.changes, user: user || null }));
`;
  const out = dockerExecNodeScript(script);
  const parsed = JSON.parse(out);
  if (!parsed.user) throw new Error(`User not found in DB: ${out}`);
  log(`Email verified in DB: ${JSON.stringify(parsed)}`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Extract the session cookie from a set-cookie header.
 * Better Auth renames the session cookie to `fsid` (pentest INFO #386).
 */
function extractSessionCookie(cookieHeader) {
  const match = cookieHeader.match(/((?:__Secure-)?fsid=[^;]+)/);
  return match ? match[1] : null;
}

function saveCookie(cookieValue) {
  mkdirSync(dirname(COOKIE_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(COOKIE_PATH, cookieValue, { encoding: 'utf8' });
  chmodSync(COOKIE_PATH, 0o600);
  log(`Cookie saved to ${COOKIE_PATH}`);
}

function readCookie() {
  if (!existsSync(COOKIE_PATH)) return null;
  return readFileSync(COOKIE_PATH, 'utf8').trim();
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

async function signInAndSave() {
  log(`Signing in as ${TEST_EMAIL} at ${apiBase()}`);
  const { ok, status, body, cookieHeader } = await authPost('/auth/sign-in/email', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!ok) {
    throw new Error(`Sign-in failed: HTTP ${status}: ${JSON.stringify(body)}`);
  }

  const cookie = extractSessionCookie(cookieHeader);
  if (!cookie) {
    throw new Error(
      `Sign-in returned 200 but no session cookie. Body: ${JSON.stringify(body)} Header: ${cookieHeader}`,
    );
  }

  saveCookie(cookie);
  return cookie;
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

/**
 * Ensure the test user exists. Tries the HTTP endpoint first; falls back to
 * a direct DB insert when sign-up is disabled (DEPLOY_ENABLED=false).
 */
async function ensureUserExists() {
  // First check if the user already exists in the DB (fast path)
  const dbState = dbCheckUser();
  if (dbState.exists) {
    log(`User already in DB (id=${dbState.id}, emailVerified=${dbState.emailVerified})`);
    return 'exists';
  }

  // Try HTTP sign-up
  log(`Attempting HTTP sign-up for ${TEST_EMAIL}`);
  const { status, body } = await authPost('/auth/sign-up/email', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: TEST_NAME,
  });

  if (status === 200 || status === 201) {
    log(`User created via HTTP: ${body?.user?.id || '(id unknown)'}`);
    return 'created_http';
  }

  if (
    status === 422 ||
    status === 400 ||
    (body?.code === 'USER_ALREADY_EXISTS') ||
    (typeof body?.message === 'string' && body.message.toLowerCase().includes('already'))
  ) {
    log('HTTP sign-up: user already exists');
    return 'exists';
  }

  if (status === 403) {
    // Sign-up disabled (waitlist mode). Fall back to DB insert.
    log(`HTTP sign-up blocked (${status}): ${body?.error}. Falling back to DB insert...`);
    return dbCreateUser();
  }

  throw new Error(`Sign-up failed: HTTP ${status}: ${JSON.stringify(body)}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit() {
  const result = await ensureUserExists();
  dbMarkEmailVerified();
  const cookie = await signInAndSave();
  log(`Init complete. User=${result}. Cookie at ${COOKIE_PATH}`);
  return cookie;
}

async function cmdRefresh() {
  try {
    return await signInAndSave();
  } catch (err) {
    log(`Sign-in failed (${err.message}). Running full init...`);
    return cmdInit();
  }
}

async function cmdCookie() {
  const cookie = readCookie();
  if (!cookie) {
    throw new Error(`No cookie at ${COOKIE_PATH}. Run: node scripts/agent-auth-fixture.mjs init`);
  }
  process.stdout.write(cookie + '\n');
  return cookie;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const cmd = process.argv[2] || 'cookie';
const handlers = { init: cmdInit, refresh: cmdRefresh, cookie: cmdCookie };
if (!handlers[cmd]) {
  process.stderr.write('Usage: node scripts/agent-auth-fixture.mjs [init|refresh|cookie]\n');
  process.exit(1);
}

handlers[cmd]().then(() => process.exit(0)).catch((err) => {
  process.stderr.write(`[agent-auth-fixture] FATAL: ${err.message}\n`);
  process.exit(1);
});
