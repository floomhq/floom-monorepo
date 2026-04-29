// W3.1 /api/workspaces routes.
//
// Owns workspace CRUD, member management, invitations, and the active-
// workspace switcher used by the dashboard sidebar. Mirrors the Composio
// connections route shape: every handler resolves a SessionContext via
// the W2.1 `resolveUserContext`, all errors return `{error, code, details?}`,
// no raw stack traces.
//
// Two surfaces:
//
//   - /api/workspaces                 (CRUD)
//   - /api/workspaces/:id/members     (list/role/remove)
//   - /api/workspaces/:id/members/invite + accept-invite + invites
//
// Plus a tiny session API:
//
//   - /api/session/me                 (composed user + workspace + role)
//   - /api/session/switch-workspace
//
// Auth model: in OSS mode every call goes through as the synthetic local
// user (the local user is admin on the synthetic 'local' workspace). In
// Cloud mode the SessionContext carries the real user + active workspace
// and `assertRole` enforces RBAC.

import { Hono } from 'hono';
import { z } from 'zod';
import { auditLog, getAuditActor } from '../services/audit-log.js';
import { resolveUserContext } from '../services/session.js';
import * as ws from '../services/workspaces.js';
import {
  CannotRemoveLastAdminError,
  DuplicateMemberError,
  InsufficientRoleError,
  InviteExpiredError,
  InviteNotFoundError,
  NotAMemberError,
  WorkspaceNotFoundError,
} from '../services/workspaces.js';
import { isCloudMode } from '../lib/better-auth.js';
import { requireAuthenticatedInCloud } from '../lib/auth.js';
import { deleteWorkspaceRuns } from '../services/run-retention-sweeper.js';
import type { AgentTokenRecord, AgentTokenScope, WorkspaceMemberRole, WorkspaceRecord } from '../types.js';
import * as userSecrets from '../services/user_secrets.js';
import { SecretDecryptError } from '../services/user_secrets.js';
import {
  extractAgentTokenPrefix,
  generateAgentToken,
  hashAgentToken,
  isValidAgentTokenScope,
  newAgentTokenId,
} from '../lib/agent-tokens.js';
import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
} from './agent_keys.js';
import { db } from '../db.js';

export const workspacesRouter = new Hono();
export const sessionRouter = new Hono();

// --------------------------------------------------------------------
// Public DTO — strip server-only fields before any JSON response.
//
// Security H1 (audit 2026-04-23): the service layer returns the full
// WorkspaceRecord row including `wrapped_dek` — the AES-wrapped DEK
// ciphertext — which is needed internally for user_secrets encryption
// but must never cross the API boundary. On its own the ciphertext is
// useless without the KEK, but shipping it to clients is still a
// defense-in-depth violation and makes a future KEK leak unnecessarily
// catastrophic. This helper is the one chokepoint every workspace
// response flows through.
// --------------------------------------------------------------------
type PublicWorkspace = Omit<WorkspaceRecord, 'wrapped_dek'>;

function toPublicWorkspace(w: WorkspaceRecord): PublicWorkspace {
  // Intentionally exhaustive destructure so a new sensitive column added
  // to WorkspaceRecord fails the type-check here instead of silently
  // leaking.
  const { wrapped_dek: _wrapped_dek, ...pub } = w;
  return pub;
}

// --------------------------------------------------------------------
// Zod schemas
// --------------------------------------------------------------------

const RoleEnum = z.enum(['admin', 'editor', 'viewer']);

const CreateWorkspaceBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64).optional(),
});

const UpdateWorkspaceBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined, {
    message: 'must include name or slug',
  });

const InviteBody = z.object({
  email: z.string().email().max(320),
  role: RoleEnum.optional().default('editor'),
});

const ChangeRoleBody = z.object({
  role: RoleEnum,
});

const AcceptInviteBody = z.object({
  token: z.string().min(8).max(128),
});

const SwitchWorkspaceBody = z.object({
  workspace_id: z.string().min(1).max(64),
});

const SecretSetBody = z.object({
  key: z.string().min(1).max(128),
  value: z.string().min(1).max(65536),
});

// --------------------------------------------------------------------
// Error envelope helper
// --------------------------------------------------------------------

function mapError(err: unknown): { status: 400 | 401 | 403 | 404 | 409 | 500; body: { error: string; code: string; details?: unknown } } {
  if (err instanceof WorkspaceNotFoundError) {
    return { status: 404, body: { error: err.message, code: 'workspace_not_found' } };
  }
  if (err instanceof NotAMemberError) {
    return { status: 403, body: { error: err.message, code: 'not_a_member' } };
  }
  if (err instanceof InsufficientRoleError) {
    return { status: 403, body: { error: err.message, code: 'insufficient_role' } };
  }
  if (err instanceof InviteNotFoundError) {
    return { status: 404, body: { error: err.message, code: 'invite_not_found' } };
  }
  if (err instanceof InviteExpiredError) {
    return { status: 410 as unknown as 400, body: { error: err.message, code: 'invite_expired' } };
  }
  if (err instanceof DuplicateMemberError) {
    return { status: 409, body: { error: err.message, code: 'duplicate_member' } };
  }
  if (err instanceof CannotRemoveLastAdminError) {
    return { status: 409, body: { error: err.message, code: 'last_admin' } };
  }
  return {
    status: 500,
    body: {
      error: (err as Error).message || 'unknown error',
      code: 'workspace_error',
    },
  };
}

// --------------------------------------------------------------------
// Workspaces CRUD
// --------------------------------------------------------------------

/**
 * POST /api/workspaces
 * Body: { name, slug? }
 * Caller becomes admin of the newly created workspace.
 */
workspacesRouter.post('/', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = CreateWorkspaceBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    const w = ws.create(ctx, parsed.data);
    return c.json({ workspace: toPublicWorkspace(w) }, 201);
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * GET /api/workspaces
 * Returns workspaces the caller is a member of, with their role on each.
 */
workspacesRouter.get('/', async (c) => {
  const ctx = await resolveUserContext(c);
  try {
    const rows = ws.listMine(ctx);
    return c.json({
      workspaces: rows.map((r) => ({
        ...toPublicWorkspace(r.workspace),
        role: r.role,
      })),
    });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * GET /api/workspaces/:id
 */
workspacesRouter.get('/:id', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id') || '';
  try {
    const w = ws.getById(ctx, id);
    return c.json({ workspace: toPublicWorkspace(w) });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * PATCH /api/workspaces/:id
 * Body: { name?, slug? } — at least one required.
 * Admin-only.
 */
workspacesRouter.patch('/:id', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = UpdateWorkspaceBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    const w = ws.update(ctx, id, parsed.data);
    return c.json({ workspace: toPublicWorkspace(w) });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * DELETE /api/workspaces/:id
 * Admin-only. Refuses to delete the synthetic 'local' workspace.
 */
workspacesRouter.delete('/:id', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  try {
    ws.remove(ctx, id);
    return c.json({ ok: true });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * DELETE /api/workspaces/:id/runs
 * Admin-only bulk deletion for all runs belonging to apps owned by the
 * workspace.
 */
workspacesRouter.delete('/:id/runs', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  try {
    ws.assertRole(ctx, id, 'admin');
    const result = deleteWorkspaceRuns(ctx, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

// --------------------------------------------------------------------
// Workspace-scoped secrets and agent tokens
// --------------------------------------------------------------------

workspacesRouter.get('/:id/secrets', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  try {
    ws.assertRole(ctx, id, 'editor');
    const entries = userSecrets.listWorkspaceMasked({ ...ctx, workspace_id: id });
    return c.json({ entries });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

workspacesRouter.post('/:id/secrets', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = SecretSetBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    ws.assertRole(ctx, id, 'editor');
    userSecrets.setWorkspaceSecret(id, parsed.data.key, parsed.data.value);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'secret.updated',
      target: { type: 'secret', id: `${id}:${parsed.data.key}` },
      before: null,
      after: { exists: true },
      metadata: { workspace_id: id, key: parsed.data.key, scope: 'workspace_vault' },
    });
    return c.json({ ok: true, key: parsed.data.key });
  } catch (err) {
    if (err instanceof SecretDecryptError) {
      return c.json({ error: err.message, code: 'secret_encrypt_failed' }, 500);
    }
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

workspacesRouter.delete('/:id/secrets/:key', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  const key = c.req.param('key') || '';
  try {
    ws.assertRole(ctx, id, 'editor');
    const removed = userSecrets.delWorkspaceSecret(id, key);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'secret.deleted',
      target: { type: 'secret', id: `${id}:${key}` },
      before: { exists: removed },
      after: { exists: false },
      metadata: { workspace_id: id, key, scope: 'workspace_vault', removed },
    });
    return c.json({ ok: true, removed });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

workspacesRouter.get('/:id/agent-tokens', async (c) => {
  return listAgentKeys(c, c.req.param('id') || '');
});

workspacesRouter.post('/:id/agent-tokens', async (c) => {
  return createAgentKey(c, c.req.param('id') || '');
});

workspacesRouter.post('/:id/agent-tokens/:token_id/revoke', async (c) => {
  return revokeAgentKey(c, c.req.param('token_id') || '', c.req.param('id') || '');
});

// --------------------------------------------------------------------
// Members
// --------------------------------------------------------------------

/**
 * GET /api/workspaces/:id/members
 */
workspacesRouter.get('/:id/members', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id') || '';
  try {
    const members = ws.listMembers(ctx, id);
    return c.json({ members });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * PATCH /api/workspaces/:id/members/:user_id
 * Body: { role: 'admin' | 'editor' | 'viewer' }
 * Admin-only. Refuses to demote the last admin.
 */
workspacesRouter.patch('/:id/members/:user_id', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  const target = c.req.param('user_id') || '';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = ChangeRoleBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    const before = ws.listMembers(ctx, id).find((m) => m.user_id === target);
    const updated = ws.changeRole(ctx, id, target, parsed.data.role as WorkspaceMemberRole);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'workspace_member.role_changed',
      target: { type: 'workspace_member', id: `${id}:${target}` },
      before: before ? { role: before.role } : null,
      after: { role: updated.role },
      metadata: { workspace_id: id, user_id: target },
    });
    return c.json({ member: updated });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * DELETE /api/workspaces/:id/members/:user_id
 * Admin-only. Refuses to remove the last admin.
 */
workspacesRouter.delete('/:id/members/:user_id', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  const target = c.req.param('user_id') || '';
  try {
    const before = ws.listMembers(ctx, id).find((m) => m.user_id === target);
    ws.removeMember(ctx, id, target);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'workspace_member.removed',
      target: { type: 'workspace_member', id: `${id}:${target}` },
      before: before ? { role: before.role } : null,
      after: null,
      metadata: { workspace_id: id, user_id: target },
    });
    return c.json({ ok: true });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

// --------------------------------------------------------------------
// Invites
// --------------------------------------------------------------------

/**
 * POST /api/workspaces/:id/members/invite
 * Body: { email, role? }
 * Admin-only. Returns the invite + the accept URL the caller should
 * forward to the invitee.
 */
workspacesRouter.post('/:id/members/invite', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;
  const id = c.req.param('id') || '';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = InviteBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    const result = ws.inviteByEmail(
      ctx,
      id,
      parsed.data.email,
      parsed.data.role as WorkspaceMemberRole,
    );
    return c.json(result, 201);
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * GET /api/workspaces/:id/invites
 * Admin-only. Lists pending + historical invites for the workspace.
 */
workspacesRouter.get('/:id/invites', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id') || '';
  try {
    const invites = ws.listInvites(ctx, id);
    return c.json({ invites });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * DELETE /api/workspaces/:id/invites/:invite_id
 * Admin-only. Marks a pending invite as revoked.
 */
workspacesRouter.delete('/:id/invites/:invite_id', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id') || '';
  const inviteId = c.req.param('invite_id') || '';
  try {
    ws.revokeInvite(ctx, id, inviteId);
    return c.json({ ok: true });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * POST /api/workspaces/:id/members/accept-invite
 * Body: { token }
 * Caller must be authenticated with the email matching the invite. The
 * `:id` in the URL is informational; the token is the source of truth.
 */
workspacesRouter.post('/:id/members/accept-invite', async (c) => {
  const ctx = await resolveUserContext(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = AcceptInviteBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    const member = ws.acceptInvite(ctx, parsed.data.token);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'workspace_member.added',
      target: { type: 'workspace_member', id: `${member.workspace_id}:${member.user_id}` },
      before: null,
      after: { role: member.role },
      metadata: { workspace_id: member.workspace_id, user_id: member.user_id, source: 'invite' },
    });
    return c.json({ member });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

// --------------------------------------------------------------------
// Workspace-scoped secrets  GET/POST/DELETE /:id/secrets[/:key]
// --------------------------------------------------------------------

const WorkspaceSecretSetBody = z.object({
  key: z.string().min(1).max(128),
  value: z.string().min(1).max(65536),
});

/** Query masked workspace secrets directly for a given workspace_id. */
function listWorkspaceSecretsMasked(workspace_id: string): { key: string; updated_at: string }[] {
  return db
    .prepare(`SELECT key, updated_at FROM workspace_secrets WHERE workspace_id = ? ORDER BY key`)
    .all(workspace_id) as { key: string; updated_at: string }[];
}

/**
 * GET /api/workspaces/:id/secrets
 * Lists masked secret keys for the workspace. Requires admin role.
 * Never returns plaintext values.
 */
workspacesRouter.get('/:id/secrets', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  try {
    ws.assertRole(ctx, id, 'admin');
    const entries = listWorkspaceSecretsMasked(id);
    return c.json({ entries });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * POST /api/workspaces/:id/secrets
 * Upserts a workspace-scoped secret. Requires admin role.
 * Body: { key, value }. Value is never echoed back.
 */
workspacesRouter.post('/:id/secrets', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = WorkspaceSecretSetBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid body shape', code: 'invalid_body', details: parsed.error.flatten() },
      400,
    );
  }
  try {
    ws.assertRole(ctx, id, 'admin');
    const existed = listWorkspaceSecretsMasked(id).some((entry) => entry.key === parsed.data.key);
    userSecrets.setWorkspaceSecret(id, parsed.data.key, parsed.data.value);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'secret.updated',
      target: { type: 'secret', id: `${id}:${parsed.data.key}` },
      before: { exists: existed },
      after: { exists: true },
      metadata: { workspace_id: id, key: parsed.data.key, scope: 'workspace_vault' },
    });
    return c.json({ ok: true, key: parsed.data.key });
  } catch (err) {
    if (err instanceof SecretDecryptError) {
      return c.json({ error: err.message, code: 'secret_encrypt_failed' }, 500);
    }
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * DELETE /api/workspaces/:id/secrets/:key
 * Removes a workspace-scoped secret. Requires admin role.
 */
workspacesRouter.delete('/:id/secrets/:key', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  const key = c.req.param('key') || '';
  try {
    ws.assertRole(ctx, id, 'admin');
    const existed = listWorkspaceSecretsMasked(id).some((entry) => entry.key === key);
    const removed = userSecrets.delWorkspaceSecret(id, key);
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'secret.deleted',
      target: { type: 'secret', id: `${id}:${key}` },
      before: { exists: existed },
      after: { exists: !removed && existed },
      metadata: { workspace_id: id, key, scope: 'workspace_vault', removed },
    });
    return c.json({ ok: true, removed });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

// --------------------------------------------------------------------
// Workspace-scoped agent tokens  GET/POST/DELETE /:id/agent-tokens[/:token_id]
// --------------------------------------------------------------------

const AgentTokenScopeEnum = z.enum(['read', 'read-write', 'publish-only']);
const WorkspaceCreateAgentTokenBody = z.object({
  label: z.string().trim().min(1).max(80),
  scope: AgentTokenScopeEnum,
  rate_limit_per_minute: z.number().int().min(1).max(10_000).optional(),
});

function normalizeRateLimit(value: number | undefined): number {
  return value ?? 60;
}

function publicAgentToken(row: AgentTokenRecord): Record<string, unknown> {
  return {
    id: row.id,
    prefix: row.prefix,
    label: row.label,
    scope: row.scope,
    workspace_id: row.workspace_id,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: row.revoked_at !== null,
  };
}

/**
 * GET /api/workspaces/:id/agent-tokens
 * Lists all agent tokens for the workspace. Requires admin role.
 */
workspacesRouter.get('/:id/agent-tokens', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  try {
    ws.assertRole(ctx, id, 'admin');
    const rows = db
      .prepare(`SELECT * FROM agent_tokens WHERE workspace_id = ? ORDER BY created_at DESC`)
      .all(id) as AgentTokenRecord[];
    return c.json(rows.map(publicAgentToken));
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * POST /api/workspaces/:id/agent-tokens
 * Mints a new agent token scoped to this workspace. Requires admin role.
 * Body: { label, scope, rate_limit_per_minute? }
 * Returns the raw_token ONCE — it cannot be recovered.
 */
workspacesRouter.post('/:id/agent-tokens', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = WorkspaceCreateAgentTokenBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid body shape', code: 'invalid_body', details: parsed.error.flatten() },
      400,
    );
  }
  const scope = parsed.data.scope as AgentTokenScope;
  if (!isValidAgentTokenScope(scope)) {
    return c.json({ error: 'Invalid scope', code: 'invalid_scope' }, 400);
  }
  try {
    ws.assertRole(ctx, id, 'admin');
    const rawToken = generateAgentToken();
    const createdAt = new Date().toISOString();
    const row: AgentTokenRecord = {
      id: newAgentTokenId(),
      prefix: extractAgentTokenPrefix(rawToken),
      hash: hashAgentToken(rawToken),
      label: parsed.data.label,
      scope,
      workspace_id: id,
      user_id: ctx.user_id,
      created_at: createdAt,
      last_used_at: null,
      revoked_at: null,
      rate_limit_per_minute: normalizeRateLimit(parsed.data.rate_limit_per_minute),
    };
    db.prepare(
      `INSERT INTO agent_tokens
         (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
          last_used_at, revoked_at, rate_limit_per_minute)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.prefix, row.hash, row.label, row.scope, row.workspace_id,
      row.user_id, row.created_at, row.last_used_at, row.revoked_at,
      row.rate_limit_per_minute,
    );
    auditLog({
      actor: getAuditActor(c, ctx),
      action: 'agent_token.minted',
      target: { type: 'agent_token', id: row.id },
      before: null,
      after: { label: row.label, scope: row.scope, workspace_id: id, revoked: false, rate_limit_per_minute: row.rate_limit_per_minute },
      metadata: { prefix: row.prefix },
    });
    return c.json(
      { id: row.id, prefix: row.prefix, label: row.label, scope: row.scope, workspace_id: id, raw_token: rawToken },
      201,
    );
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * POST /api/workspaces/:id/agent-tokens/:token_id/revoke
 * Revokes a workspace agent token. Requires admin role.
 */
workspacesRouter.post('/:id/agent-tokens/:token_id/revoke', async (c) => {
  const ctx = await resolveUserContext(c);
  const id = c.req.param('id');
  const tokenId = c.req.param('token_id');
  try {
    ws.assertRole(ctx, id, 'admin');
    const before = db
      .prepare(`SELECT * FROM agent_tokens WHERE id = ? AND workspace_id = ?`)
      .get(tokenId, id) as AgentTokenRecord | undefined;
    db.prepare(
      `UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND workspace_id = ?`,
    ).run(new Date().toISOString(), tokenId, id);
    if (before) {
      const after = db
        .prepare(`SELECT * FROM agent_tokens WHERE id = ? AND workspace_id = ?`)
        .get(tokenId, id) as AgentTokenRecord | undefined;
      auditLog({
        actor: getAuditActor(c, ctx),
        action: 'agent_token.revoked',
        target: { type: 'agent_token', id: tokenId },
        before: { label: before.label, scope: before.scope, workspace_id: id, revoked: before.revoked_at !== null },
        after: { label: after?.label || before.label, scope: after?.scope || before.scope, workspace_id: id, revoked: true },
        metadata: { prefix: before.prefix },
      });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

// --------------------------------------------------------------------
// Session router (mounted at /api/session)
// --------------------------------------------------------------------

/**
 * GET /api/session/me
 * Returns the current user, their active workspace, and all workspace
 * memberships. Always returns 200 — in OSS mode this is the synthetic
 * local user; in Cloud mode this is the Better Auth user.
 */
sessionRouter.get('/me', async (c) => {
  const ctx = await resolveUserContext(c);
  try {
    const payload = ws.me(ctx, isCloudMode());
    return c.json(payload);
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});

/**
 * POST /api/session/switch-workspace
 * Body: { workspace_id }
 * Sets the caller's active workspace pointer. Caller must be a member.
 */
sessionRouter.post('/switch-workspace', async (c) => {
  const ctx = await resolveUserContext(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON', code: 'invalid_body' }, 400);
  }
  const parsed = SwitchWorkspaceBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid body shape',
        code: 'invalid_body',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  try {
    ws.switchActiveWorkspace(ctx, parsed.data.workspace_id);
    return c.json({ ok: true, active_workspace_id: parsed.data.workspace_id });
  } catch (err) {
    const m = mapError(err);
    return c.json(m.body, m.status);
  }
});
