#!/usr/bin/env node
// W3.1 security gates per TEST-PROTOCOL.md section 5a:
//
//   - CSRF: cookie-issued requests carry SameSite=Lax + HttpOnly
//   - Session expiration: a stale auth token surfaces a clean 200/anonymous
//     ctx, not a 500. Better Auth's getSession() returning null is
//     simulated by injecting a fake.
//   - Auth-failure error envelope: a thrown Better Auth error is swallowed
//     and the request keeps going as anonymous (no 500).
//   - Cross-origin POST without a cookie sees no other user's data
//     (because there's no device id to bind to alice — fresh device id is
//     minted, so the response is empty).
//   - Cookie name is `floom_device` (no leak of internal IDs in the
//     request via custom cookie names).
//
// Run: node test/stress/test-w31-security-gates.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w31-sec-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);
process.env.FLOOM_CLOUD_MODE = 'true';
process.env.BETTER_AUTH_SECRET =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

const { db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID } = await import(
  '../../apps/server/dist/db.js'
);
const auth = await import('../../apps/server/dist/lib/better-auth.js');
const session = await import('../../apps/server/dist/services/session.js');
const { workspacesRouter, sessionRouter } = await import(
  '../../apps/server/dist/routes/workspaces.js'
);
const { connectionsRouter } = await import(
  '../../apps/server/dist/routes/connections.js'
);

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

console.log('W3.1 security gates');

// ---- helpers ----
async function fetchRoute(router, method, path, body, headers = {}) {
  const url = `http://localhost${path}`;
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const req = new Request(url, init);
  const res = await router.fetch(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, json, text, headers: res.headers };
}

// =====================================================================
// 1. SameSite + HttpOnly cookie attributes
// =====================================================================
console.log('\n[1] cookie attributes');

// First request mints the cookie. Use /api/session/me (always 200).
let r = await fetchRoute(sessionRouter, 'GET', '/me');
const cookie = r.headers.get('set-cookie') || '';
log('mint cookie: 200 from /me', r.status === 200);
log('cookie: HttpOnly attribute set', cookie.includes('HttpOnly'));
log('cookie: SameSite=Lax attribute set', cookie.includes('SameSite=Lax'));
log('cookie: Path=/ attribute set', cookie.includes('Path=/'));
log('cookie: Max-Age set (long-lived, not session)', /Max-Age=\d+/.test(cookie));
log(
  'cookie: name is floom_device',
  cookie.startsWith('floom_device='),
);

// Verify the same cookie is reused (no re-mint) when sent back
const cookieMatch = /floom_device=([^;]+)/.exec(cookie);
const ckHeader = cookieMatch ? `floom_device=${cookieMatch[1]}` : '';
r = await fetchRoute(sessionRouter, 'GET', '/me', undefined, { cookie: ckHeader });
const cookie2 = r.headers.get('set-cookie') || '';
log('second request: no cookie re-mint (or same value)', !cookie2 || cookie2.includes(cookieMatch[1]));

// =====================================================================
// 2. Session expiration: getSession returns null → 200 anonymous
// =====================================================================
console.log('\n[2] session expiration');

// Build a Better Auth instance and inject a getSession that always
// returns null (simulating expired token). The route should return 200
// and the synthetic local context, not 500.
auth._resetAuthForTests();
const a = auth.getAuth();
let getSessionCalls = 0;
a.api.getSession = async () => {
  getSessionCalls++;
  return null; // always-expired
};

r = await fetchRoute(sessionRouter, 'GET', '/me', undefined, {
  cookie: 'floom_device=expired-test',
});
log(
  'expired session: status 200 (not 500)',
  r.status === 200,
  `got ${r.status}`,
);
log('expired session: returns local user', r.json?.user?.id === DEFAULT_USER_ID);
log('expired session: cloud_mode=true echoed', r.json?.cloud_mode === true);
log('getSession was called', getSessionCalls >= 1);

// =====================================================================
// 3. Better Auth throws → request keeps going as anonymous
// =====================================================================
console.log('\n[3] auth lookup failure (throw) is swallowed');

a.api.getSession = async () => {
  throw new Error('upstream auth dead');
};
r = await fetchRoute(sessionRouter, 'GET', '/me', undefined, {
  cookie: 'floom_device=throw-test',
});
log(
  'auth throw: status 200 (not 500)',
  r.status === 200,
  `got ${r.status}`,
);
log(
  'auth throw: returns local user (anonymous fallback)',
  r.json?.user?.id === DEFAULT_USER_ID,
);

// =====================================================================
// 4. Cross-origin POST without a cookie sees no other user's data
// =====================================================================
console.log('\n[4] cross-origin / no-cookie isolation');

// Reset auth so getSession returns null for these probes too.
a.api.getSession = async () => null;

// Pretend an authenticated alice has connections set up (as if she logged
// in earlier). Seed real rows directly.
db.prepare(
  `INSERT INTO users (id, email, name, auth_provider, auth_subject)
   VALUES (?, ?, ?, 'better-auth', ?)`,
).run('alice_sec', 'alice_sec@floom.dev', 'Alice Sec', 'alice_sec');
db.prepare(
  `INSERT INTO connections
     (id, workspace_id, owner_kind, owner_id, provider,
      composio_connection_id, composio_account_id, status)
   VALUES (?, ?, 'user', ?, ?, ?, ?, 'active')`,
).run(
  'con_alice_sec',
  DEFAULT_WORKSPACE_ID,
  'alice_sec',
  'gmail',
  'comp_alice_sec',
  'user:alice_sec',
);

// Now an attacker POSTs from another origin with NO cookie.
r = await fetchRoute(connectionsRouter, 'GET', '/', undefined, {
  origin: 'https://evil.com',
});
log(
  'attacker GET /api/connections from another origin: 200 + empty list',
  r.status === 200 && Array.isArray(r.json?.connections) && r.json.connections.length === 0,
);

// Attacker tries to inject a forged Cookie that names alice's user id
r = await fetchRoute(connectionsRouter, 'GET', '/', undefined, {
  cookie: 'floom_device=alice_sec',
  origin: 'https://evil.com',
});
log(
  'attacker GET with forged cookie value of alice user_id: still 0 connections',
  r.status === 200 && r.json?.connections?.length === 0,
);
// (This works because connections are looked up by owner_kind='user' AND
// owner_id=<resolved user_id>; the device cookie value is treated as a
// device id, not a user id.)

// =====================================================================
// 5. /api/session/me always 200 (never 500), regardless of cookie state
// =====================================================================
console.log('\n[5] /api/session/me robustness');

const probes = [
  { name: 'no cookie', headers: {} },
  { name: 'empty cookie', headers: { cookie: '' } },
  { name: 'malformed cookie', headers: { cookie: 'garbage===;floom_device=' } },
  { name: 'random cookie', headers: { cookie: 'floom_device=' + 'x'.repeat(200) } },
  { name: 'origin from evil', headers: { origin: 'https://evil.com' } },
];
for (const p of probes) {
  r = await fetchRoute(sessionRouter, 'GET', '/me', undefined, p.headers);
  log(`/me [${p.name}]: 200`, r.status === 200);
}

// =====================================================================
// 6. resolveUserContext directly: stale cookie + cloud mode
// =====================================================================
console.log('\n[6] resolveUserContext direct');

const staleCtx = await session.resolveUserContext({
  req: {
    header: (n) => (n.toLowerCase() === 'cookie' ? 'floom_device=stale-1' : null),
    raw: { headers: new Headers() },
  },
  header: () => {},
});
log(
  'cloud + getSession=null: workspace_id=local',
  staleCtx.workspace_id === DEFAULT_WORKSPACE_ID,
);
log(
  'cloud + getSession=null: user_id=local',
  staleCtx.user_id === DEFAULT_USER_ID,
);
log(
  'cloud + getSession=null: is_authenticated=false',
  staleCtx.is_authenticated === false,
);
log('cloud + getSession=null: device_id preserved', staleCtx.device_id === 'stale-1');

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
