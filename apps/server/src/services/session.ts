// W2.1 session service.
//
// Three responsibilities:
//
//   1. getOrCreateDeviceId(c): reads the floom_device cookie; if missing
//      generates a random UUIDv4 and sets it with a 10-year TTL. HttpOnly,
//      SameSite=Lax so MCP clients calling from another origin can still
//      share cookies with the web UI.
//   2. resolveUserContext(c): returns `{ workspace_id, user_id, device_id }`
//      for the request. In OSS mode this is always the synthetic 'local'
//      workspace + 'local' user + whatever device_id the cookie carries.
//      In Cloud mode (post-W3.1) it reads the Better Auth session and
//      returns the real workspace+user binding.
//   3. rekeyDevice(...): atomic transaction that UPDATEs app_memory, runs,
//      and chat_threads to swap `device_id → user_id`. Idempotent — safe to
//      call multiple times. Per P.4 section 8, this is the Linear 2022
//      opportunistic-rekey pattern that runs on the first authenticated
//      request after login.
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from '../db.js';
import type { RekeyResult, SessionContext } from '../types.js';

const COOKIE_NAME = 'floom_device';
// 10 years in seconds — the cookie is a stable device id, not a session.
const COOKIE_MAX_AGE_SECONDS = 315_360_000;

/**
 * Parse the floom_device cookie from the incoming request headers. Returns
 * null if not present. Uses a minimal cookie parser to avoid pulling in
 * hono/cookie which some versions of @hono/node-server don't expose in tests.
 */
function readDeviceCookie(c: Context): string | null {
  const header = c.req.header('cookie') || c.req.header('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === COOKIE_NAME && rest.length > 0) {
      const value = rest.join('=').trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Set the floom_device cookie on the response. Idempotent — safe to call
 * multiple times per request; the last Set-Cookie wins.
 */
function writeDeviceCookie(c: Context, value: string): void {
  const cookie =
    `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; ` +
    `Path=/; HttpOnly; SameSite=Lax`;
  c.header('set-cookie', cookie, { append: true });
}

/**
 * Read the floom_device cookie or mint a new one and write it back. The
 * returned string is always a valid device id that the caller can use in
 * the SessionContext.
 */
export function getOrCreateDeviceId(c: Context): string {
  const existing = readDeviceCookie(c);
  if (existing) return existing;
  const fresh = randomUUID();
  writeDeviceCookie(c, fresh);
  return fresh;
}

/**
 * Build the SessionContext for a request. In OSS mode we always return the
 * synthetic 'local' workspace + user; Cloud mode (W3.1) will override this
 * to read the Better Auth session instead.
 *
 * The context is a plain object so services can accept it directly without
 * needing Hono types.
 */
export function resolveUserContext(c: Context): SessionContext {
  const device_id = getOrCreateDeviceId(c);
  return {
    workspace_id: DEFAULT_WORKSPACE_ID,
    user_id: DEFAULT_USER_ID,
    device_id,
    is_authenticated: false,
  };
}

/**
 * Build a SessionContext from already-resolved ids. Useful when the caller
 * has a device_id from somewhere other than a Hono cookie (tests, worker
 * dispatch path, background jobs).
 */
export function buildContext(
  workspace_id: string,
  user_id: string,
  device_id: string,
  is_authenticated = false,
): SessionContext {
  return { workspace_id, user_id, device_id, is_authenticated };
}

/**
 * Atomically re-key a device_id to a user_id across app_memory, runs, and
 * chat_threads. Returns the row counts. Runs inside a single SQLite
 * transaction so partial re-keys are impossible. Idempotent — if the rows
 * are already bound to the user, the WHERE clause filters them out.
 *
 * This is called by the login handler on the first authenticated request
 * (post-W3.1). Pre-auth (today) it's exercised by tests only.
 */
export function rekeyDevice(
  device_id: string,
  user_id: string,
  workspace_id: string,
): RekeyResult {
  if (!device_id || !user_id || !workspace_id) {
    throw new Error('rekeyDevice: device_id, user_id, workspace_id are required');
  }

  const result: RekeyResult = {
    app_memory: 0,
    runs: 0,
    chat_threads: 0,
  };

  const run = db.transaction(() => {
    // app_memory: bind anonymous rows to the user. We match on device_id and
    // only rewrite rows where user_id is still the synthetic default or
    // NULL, so re-running on already-claimed rows is a no-op.
    const memRes = db
      .prepare(
        `UPDATE app_memory
           SET user_id = ?,
               workspace_id = ?,
               updated_at = datetime('now')
         WHERE device_id = ?
           AND user_id = ?`,
      )
      .run(user_id, workspace_id, device_id, DEFAULT_USER_ID);
    result.app_memory = memRes.changes;

    // runs: same pattern, but user_id is nullable on runs so we look for
    // either NULL or the synthetic default.
    const runRes = db
      .prepare(
        `UPDATE runs
           SET user_id = ?,
               workspace_id = ?
         WHERE device_id = ?
           AND (user_id IS NULL OR user_id = ?)`,
      )
      .run(user_id, workspace_id, device_id, DEFAULT_USER_ID);
    result.runs = runRes.changes;

    // chat_threads: same as runs.
    const threadRes = db
      .prepare(
        `UPDATE chat_threads
           SET user_id = ?,
               workspace_id = ?,
               updated_at = datetime('now')
         WHERE device_id = ?
           AND (user_id IS NULL OR user_id = ?)`,
      )
      .run(user_id, workspace_id, device_id, DEFAULT_USER_ID);
    result.chat_threads = threadRes.changes;
  });

  run();
  return result;
}
