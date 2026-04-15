#!/usr/bin/env node
// W3.1 workspaces service tests. Exercises the `services/workspaces.ts`
// public API end-to-end with real DB writes:
//
//   - create / listMine / getById / update / remove
//   - listMembers / changeRole / removeMember
//   - inviteByEmail / acceptInvite / listInvites / revokeInvite
//   - getActiveWorkspaceId / switchActiveWorkspace
//   - me() composed payload
//   - last-admin protection (cannot remove or demote the last admin)
//   - cannot delete synthetic 'local' workspace
//   - assertRole (admin > editor > viewer)
//   - role-rank gates: editor cannot create-invite, viewer cannot patch
//   - duplicate member rejection
//   - invalid email rejection
//   - expired invite handling
//
// Run: node test/stress/test-w31-workspaces-service.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-w31-ws-svc-'));
process.env.DATA_DIR = tmp;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_MASTER_KEY =
  '0'.repeat(16) + '1'.repeat(16) + '2'.repeat(16) + '3'.repeat(16);

const { db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID } = await import(
  '../../apps/server/dist/db.js'
);
const ws = await import('../../apps/server/dist/services/workspaces.js');

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

console.log('W3.1 workspaces service tests');

// ---- fixture: alice + bob + carol as authenticated users ----
function seedUser(id, email, name) {
  db.prepare(
    `INSERT INTO users (id, email, name, auth_provider, auth_subject)
     VALUES (?, ?, ?, 'better-auth', ?)`,
  ).run(id, email, name, id);
}
seedUser('alice', 'alice@floom.dev', 'Alice');
seedUser('bob', 'bob@floom.dev', 'Bob');
seedUser('carol', 'carol@floom.dev', 'Carol');

function buildCtx(user_id, workspace_id, opts = {}) {
  return {
    workspace_id,
    user_id,
    device_id: `dev-${user_id}`,
    is_authenticated: true,
    auth_user_id: user_id,
    email: opts.email || `${user_id}@floom.dev`,
  };
}

// ---- 1. create() — alice creates her workspace ----
const aliceCtx0 = buildCtx('alice', DEFAULT_WORKSPACE_ID);
const aliceWs = ws.create(aliceCtx0, { name: 'Alice Workspace' });
log('create: returns a workspace id', typeof aliceWs.id === 'string' && aliceWs.id.startsWith('ws_'));
log('create: name set', aliceWs.name === 'Alice Workspace');
log('create: slug derived from name', aliceWs.slug === 'alice-workspace');
log('create: plan=cloud_free for non-local user', aliceWs.plan === 'cloud_free');

// caller is now admin
const aliceCtx = buildCtx('alice', aliceWs.id);
const aliceMembership = ws.listMine(aliceCtx);
log(
  'create: caller becomes admin of new workspace',
  aliceMembership.some((m) => m.workspace.id === aliceWs.id && m.role === 'admin'),
);

// ---- 2. unique-slug suffix when the slug collides ----
const aliceWs2 = ws.create(aliceCtx, { name: 'Alice Workspace' });
log(
  'create: collision-safe slug (-2 suffix)',
  aliceWs2.slug === 'alice-workspace-2',
);

// ---- 3. create with explicit slug, special characters normalized ----
const wsExplicit = ws.create(aliceCtx, {
  name: 'Beta',
  slug: 'My  Special!! Slug',
});
log('create: slug normalized', wsExplicit.slug === 'my-special-slug');

// ---- 4. listMine: alice sees 3 (alice-workspace, -2, my-special-slug) ----
const aliceList = ws.listMine(aliceCtx);
log('listMine: 3 workspaces', aliceList.length === 3, `got ${aliceList.length}`);

// ---- 5. getById happy path ----
const fetched = ws.getById(aliceCtx, aliceWs.id);
log('getById: returns the row', fetched.id === aliceWs.id);

// ---- 6. getById not a member → 403 NotAMemberError ----
const bobCtx0 = buildCtx('bob', DEFAULT_WORKSPACE_ID);
let threw = null;
try {
  ws.getById(bobCtx0, aliceWs.id);
} catch (err) {
  threw = err.name;
}
log('getById: non-member → NotAMemberError', threw === 'NotAMemberError');

// ---- 7. getById missing → WorkspaceNotFoundError ----
threw = null;
try {
  ws.getById(aliceCtx, 'ws_nonexistent');
} catch (err) {
  threw = err.name;
}
log('getById: missing → WorkspaceNotFoundError', threw === 'WorkspaceNotFoundError');

// ---- 8. update: name only ----
const updated = ws.update(aliceCtx, aliceWs.id, { name: 'Alice Renamed' });
log('update: name applied', updated.name === 'Alice Renamed');

// ---- 9. update: editor cannot patch (role gate) ----
// Add bob as editor first.
db.prepare(
  `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'editor')`,
).run(aliceWs.id, 'bob');
const bobCtx = buildCtx('bob', aliceWs.id);
threw = null;
try {
  ws.update(bobCtx, aliceWs.id, { name: 'Bob took it' });
} catch (err) {
  threw = err.name;
}
log('update: editor blocked (insufficient_role)', threw === 'InsufficientRoleError');

// ---- 10. delete refuses synthetic 'local' workspace ----
threw = null;
try {
  ws.remove(aliceCtx, DEFAULT_WORKSPACE_ID);
} catch (err) {
  threw = err.message;
}
log(
  'remove: refuses synthetic local workspace',
  /cannot delete the synthetic local workspace/.test(threw || ''),
);

// ---- 11. delete: non-admin blocked ----
threw = null;
try {
  ws.remove(bobCtx, aliceWs.id);
} catch (err) {
  threw = err.name;
}
log('remove: editor blocked', threw === 'InsufficientRoleError');

// ---- 12. listMembers: returns rows scoped to workspace ----
const members = ws.listMembers(aliceCtx, aliceWs.id);
log('listMembers: 2 entries (alice + bob)', members.length === 2);
log(
  'listMembers: alice present as admin',
  members.some((m) => m.user_id === 'alice' && m.role === 'admin'),
);
log(
  'listMembers: bob present as editor',
  members.some((m) => m.user_id === 'bob' && m.role === 'editor'),
);
log(
  'listMembers: each row joins the user email',
  members.find((m) => m.user_id === 'alice')?.email === 'alice@floom.dev',
);

// ---- 13. listMembers: non-member blocked ----
const carolCtx0 = buildCtx('carol', DEFAULT_WORKSPACE_ID);
threw = null;
try {
  ws.listMembers(carolCtx0, aliceWs.id);
} catch (err) {
  threw = err.name;
}
log('listMembers: non-member blocked', threw === 'NotAMemberError');

// ---- 14. changeRole: admin promotes editor to admin ----
let changed = ws.changeRole(aliceCtx, aliceWs.id, 'bob', 'admin');
log('changeRole: bob promoted to admin', changed.role === 'admin');

// ---- 15. changeRole: admin demotes herself only when 2+ admins exist ----
const stillAdmin = ws.changeRole(aliceCtx, aliceWs.id, 'alice', 'editor');
log(
  'changeRole: demotes alice when bob is co-admin',
  stillAdmin.role === 'editor',
);

// ---- 16. changeRole: cannot demote the last admin ----
threw = null;
try {
  ws.changeRole(buildCtx('bob', aliceWs.id), aliceWs.id, 'bob', 'editor');
} catch (err) {
  threw = err.name;
}
log('changeRole: cannot demote last admin', threw === 'CannotRemoveLastAdminError');

// ---- 17. removeMember: cannot remove the last admin ----
threw = null;
try {
  ws.removeMember(buildCtx('bob', aliceWs.id), aliceWs.id, 'bob');
} catch (err) {
  threw = err.name;
}
log('removeMember: cannot remove last admin', threw === 'CannotRemoveLastAdminError');

// ---- 18. inviteByEmail: bob (admin) invites carol ----
const bobAdminCtx = buildCtx('bob', aliceWs.id);
const inviteResult = ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'CAROL@floom.dev', 'editor');
log('inviteByEmail: returns invite + accept_url', !!inviteResult.invite && !!inviteResult.accept_url);
log('inviteByEmail: email lowercased', inviteResult.invite.email === 'carol@floom.dev');
log(
  'inviteByEmail: accept_url is absolute',
  /^https?:\/\//.test(inviteResult.accept_url),
);
log('inviteByEmail: status=pending', inviteResult.invite.status === 'pending');
log('inviteByEmail: token populated', inviteResult.invite.token.length >= 32);

// ---- 19. inviteByEmail: editor (alice was demoted) blocked ----
const aliceEditorCtx = buildCtx('alice', aliceWs.id);
threw = null;
try {
  ws.inviteByEmail(aliceEditorCtx, aliceWs.id, 'someone@example.com');
} catch (err) {
  threw = err.name;
}
log('inviteByEmail: editor blocked', threw === 'InsufficientRoleError');

// ---- 20. inviteByEmail: invalid email rejected ----
threw = null;
try {
  ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'not-an-email');
} catch (err) {
  threw = err.message;
}
log('inviteByEmail: rejects invalid email', /invalid email/.test(threw || ''));

// ---- 21. inviteByEmail: duplicate member rejected ----
threw = null;
try {
  ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'alice@floom.dev');
} catch (err) {
  threw = err.name;
}
log('inviteByEmail: duplicate member rejected', threw === 'DuplicateMemberError');

// ---- 22. listInvites: admin sees pending row ----
const invites = ws.listInvites(bobAdminCtx, aliceWs.id);
log('listInvites: 1 pending invite', invites.length === 1 && invites[0].status === 'pending');

// ---- 23. acceptInvite happy path ----
const carolCtx = {
  ...buildCtx('carol', DEFAULT_WORKSPACE_ID),
  email: 'carol@floom.dev',
};
const accepted = ws.acceptInvite(carolCtx, inviteResult.invite.token);
log('acceptInvite: returns workspace_member', accepted.workspace_id === aliceWs.id && accepted.user_id === 'carol');
log('acceptInvite: role=editor preserved', accepted.role === 'editor');

// invite is marked accepted
const invitesAfter = ws.listInvites(bobAdminCtx, aliceWs.id);
log('acceptInvite: invite row marked accepted', invitesAfter[0].status === 'accepted');

// ---- 24. acceptInvite: bad token → InviteNotFoundError ----
threw = null;
try {
  ws.acceptInvite(carolCtx, 'bogus-token-1234');
} catch (err) {
  threw = err.name;
}
log('acceptInvite: bogus token → InviteNotFoundError', threw === 'InviteNotFoundError');

// ---- 25. acceptInvite: email mismatch → InviteNotFoundError ----
const dianeCtx = {
  workspace_id: DEFAULT_WORKSPACE_ID,
  user_id: 'diane',
  device_id: 'dev-diane',
  is_authenticated: true,
  email: 'diane@floom.dev',
};
seedUser('diane', 'diane@floom.dev', 'Diane');
const fakeInvite = ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'eve@floom.dev', 'editor');
threw = null;
try {
  ws.acceptInvite(dianeCtx, fakeInvite.invite.token);
} catch (err) {
  threw = err.name;
}
log('acceptInvite: email mismatch → InviteNotFoundError', threw === 'InviteNotFoundError');

// ---- 26. acceptInvite: expired invite → InviteExpiredError ----
// Force-expire by direct DB UPDATE
const oldInvite = ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'frank@floom.dev', 'editor');
db.prepare(
  `UPDATE workspace_invites SET expires_at = ? WHERE id = ?`,
).run('2020-01-01T00:00:00Z', oldInvite.invite.id);
seedUser('frank', 'frank@floom.dev', 'Frank');
const frankCtx = {
  workspace_id: DEFAULT_WORKSPACE_ID,
  user_id: 'frank',
  device_id: 'dev-frank',
  is_authenticated: true,
  email: 'frank@floom.dev',
};
threw = null;
try {
  ws.acceptInvite(frankCtx, oldInvite.invite.token);
} catch (err) {
  threw = err.name;
}
log('acceptInvite: expired → InviteExpiredError', threw === 'InviteExpiredError');
// status flipped to expired
const expiredRow = db
  .prepare('SELECT status FROM workspace_invites WHERE id = ?')
  .get(oldInvite.invite.id);
log('acceptInvite: expired row marked expired', expiredRow.status === 'expired');

// ---- 27. revokeInvite: admin revokes pending invite ----
const revInvite = ws.inviteByEmail(bobAdminCtx, aliceWs.id, 'george@floom.dev', 'viewer');
ws.revokeInvite(bobAdminCtx, aliceWs.id, revInvite.invite.id);
const revRow = db
  .prepare('SELECT status FROM workspace_invites WHERE id = ?')
  .get(revInvite.invite.id);
log('revokeInvite: status=revoked', revRow.status === 'revoked');

// ---- 28. revokeInvite: editor blocked ----
threw = null;
try {
  ws.revokeInvite(aliceEditorCtx, aliceWs.id, revInvite.invite.id);
} catch (err) {
  threw = err.name;
}
log('revokeInvite: editor blocked', threw === 'InsufficientRoleError');

// ---- 29. switchActiveWorkspace: bob switches to wsExplicit (not a member) → blocked ----
threw = null;
try {
  ws.switchActiveWorkspace(buildCtx('bob', aliceWs.id), wsExplicit.id);
} catch (err) {
  threw = err.name;
}
log('switchActiveWorkspace: non-member blocked', threw === 'NotAMemberError');

// ---- 30. switchActiveWorkspace happy path ----
// alice (admin in aliceWs2) switches to wsExplicit which she also created.
ws.switchActiveWorkspace(aliceCtx, wsExplicit.id);
const aliceActive = ws.getActiveWorkspaceId('alice');
log('switchActiveWorkspace: alice now points at wsExplicit', aliceActive === wsExplicit.id);

// ---- 31. me(): composes the right payload ----
const mePayload = ws.me(aliceCtx, false);
log('me: user.id matches', mePayload.user.id === 'alice');
log('me: user.email matches', mePayload.user.email === 'alice@floom.dev');
log('me: user.is_local=false for alice', mePayload.user.is_local === false);
log(
  'me: workspaces array has the right count',
  mePayload.workspaces.length === aliceList.length,
);
log('me: cloud_mode=false echoed', mePayload.cloud_mode === false);

// ---- 32. me() for synthetic local user ----
const localCtx = {
  workspace_id: DEFAULT_WORKSPACE_ID,
  user_id: DEFAULT_USER_ID,
  device_id: 'dev-local',
  is_authenticated: false,
};
const localMe = ws.me(localCtx, false);
log('me: local user.id=local', localMe.user.id === DEFAULT_USER_ID);
log('me: local user.is_local=true', localMe.user.is_local === true);
log('me: local active_workspace.id=local', localMe.active_workspace.id === DEFAULT_WORKSPACE_ID);
log('me: local active_workspace.role=admin', localMe.active_workspace.role === 'admin');

// ---- 33. removeMember: bob removes carol ----
ws.removeMember(bobAdminCtx, aliceWs.id, 'carol');
const afterRemove = ws.listMembers(bobAdminCtx, aliceWs.id);
log('removeMember: carol gone', !afterRemove.some((m) => m.user_id === 'carol'));

// ---- 34. delete a non-local workspace ----
ws.remove(bobAdminCtx, aliceWs.id);
const aliceListAfter = ws.listMine(aliceCtx);
log(
  'remove: alice no longer a member of deleted ws',
  !aliceListAfter.some((m) => m.workspace.id === aliceWs.id),
);

// ---- cleanup ----
db.close();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
