#!/usr/bin/env node
// W3.1 schema tests. Boots the server module so db.ts runs all migrations,
// then asserts the W3.1 schema additions are present:
//
//   - workspace_invites table + indices
//   - user_active_workspace table
//   - users.email index
//   - pragma user_version >= 6
//
// Run: node test/stress/test-w31-schema.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w31-schema-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

const { db } = await import('../../apps/server/dist/db.js');

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

console.log('W3.1 schema tests');

// ---- workspace_invites table ----
const inviteCols = db
  .prepare(`PRAGMA table_info(workspace_invites)`)
  .all()
  .map((r) => r.name);
log('workspace_invites table exists', inviteCols.length > 0);
for (const col of [
  'id',
  'workspace_id',
  'email',
  'role',
  'invited_by_user_id',
  'token',
  'status',
  'created_at',
  'expires_at',
  'accepted_at',
]) {
  log(`workspace_invites.${col} present`, inviteCols.includes(col));
}

// status CHECK constraint exists — try to insert an invalid status and expect failure
db.prepare(`INSERT INTO workspaces (id, slug, name, plan) VALUES (?, ?, ?, 'oss')`).run(
  'ws_schema',
  'schema-fixture',
  'Schema Fixture',
);
let badStatusBlocked = false;
try {
  db.prepare(
    `INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by_user_id, token, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('inv_bad', 'ws_schema', 'a@b.c', 'editor', 'local', 'tok-bad', 'BOGUS', '2099-01-01T00:00:00Z');
} catch (err) {
  badStatusBlocked = /CHECK/.test(String(err));
}
log('workspace_invites.status enforces CHECK constraint', badStatusBlocked);

// FK from workspace_invites.workspace_id to workspaces deletes cascade
db.prepare(
  `INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by_user_id, token, status, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
).run('inv_cas', 'ws_schema', 'b@b.c', 'editor', 'local', 'tok-cas', '2099-01-01T00:00:00Z');
db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws_schema');
const orphan = db
  .prepare('SELECT 1 FROM workspace_invites WHERE id = ?')
  .get('inv_cas');
log('workspace_invites cascade-deletes with workspace', !orphan);

// indices on workspace_invites
const inviteIdx = db
  .prepare(`PRAGMA index_list(workspace_invites)`)
  .all()
  .map((r) => r.name);
log(
  'workspace_invites has a workspace_id index',
  inviteIdx.some((n) => /workspace/.test(n)),
);
log(
  'workspace_invites has an email index',
  inviteIdx.some((n) => /email/.test(n)),
);
log(
  'workspace_invites has a token index (unique)',
  inviteIdx.some((n) => /token/.test(n)),
);

// ---- user_active_workspace table ----
const uawCols = db
  .prepare(`PRAGMA table_info(user_active_workspace)`)
  .all()
  .map((r) => r.name);
log('user_active_workspace table exists', uawCols.length > 0);
for (const col of ['user_id', 'workspace_id', 'updated_at']) {
  log(`user_active_workspace.${col} present`, uawCols.includes(col));
}
// PK is user_id
const uawIdx = db
  .prepare(`PRAGMA index_list(user_active_workspace)`)
  .all();
const hasUawPk = uawIdx.some((r) => r.origin === 'pk');
log('user_active_workspace PRIMARY KEY exists', hasUawPk);

// ---- users.email index ----
const userIdx = db
  .prepare(`PRAGMA index_list(users)`)
  .all()
  .map((r) => r.name);
log('users has an email index', userIdx.some((n) => /email/.test(n)));

const userCols = db
  .prepare(`PRAGMA table_info(users)`)
  .all()
  .map((r) => r.name);
log('users.image column present', userCols.includes('image'));

// ---- pragma user_version ----
const uv = db.prepare('PRAGMA user_version').get().user_version;
log(`pragma user_version >= 6 (got ${uv})`, uv >= 6);

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
