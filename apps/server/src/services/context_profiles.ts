import { db } from '../db.js';
import type { SessionContext, WorkspaceRecord } from '../types.js';
import * as workspaces from './workspaces.js';

export type JsonObject = Record<string, unknown>;
export type ProfileUpdateMode = 'merge' | 'replace';

const MAX_PROFILE_BYTES = 64 * 1024;

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertJsonValue(value: unknown, path = '$'): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ProfileValidationError(`${path} must be a finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertJsonValue(item, `${path}[${idx}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new ProfileValidationError(`${path} must be JSON-serializable`);
}

export function normalizeProfile(value: unknown): JsonObject {
  if (!isPlainObject(value)) {
    throw new ProfileValidationError('profile must be a JSON object');
  }
  assertJsonValue(value);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_PROFILE_BYTES) {
    throw new ProfileValidationError(`profile must be at most ${MAX_PROFILE_BYTES} bytes`);
  }
  return JSON.parse(json) as JsonObject;
}

function parseStoredProfile(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  try {
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return {};
  }
}

function mergeProfile(base: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = mergeProfile(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function applyProfileUpdate(current: JsonObject, next: JsonObject, mode: ProfileUpdateMode): JsonObject {
  return normalizeProfile(mode === 'replace' ? next : mergeProfile(current, next));
}

export function getUserProfile(ctx: SessionContext): JsonObject {
  const row = db
    .prepare('SELECT profile_json FROM users WHERE id = ?')
    .get(ctx.user_id) as { profile_json: string | null } | undefined;
  return parseStoredProfile(row?.profile_json);
}

export function setUserProfile(
  ctx: SessionContext,
  profile: unknown,
  mode: ProfileUpdateMode = 'merge',
): JsonObject {
  const next = normalizeProfile(profile);
  const current = getUserProfile(ctx);
  const updated = applyProfileUpdate(current, next, mode);
  db.prepare('UPDATE users SET profile_json = ? WHERE id = ?').run(
    JSON.stringify(updated),
    ctx.user_id,
  );
  return updated;
}

export function getWorkspaceProfile(
  ctx: SessionContext,
  workspace_id = ctx.workspace_id,
): { workspace: WorkspaceRecord; profile: JsonObject; role: string } {
  const workspace = workspaces.getById(ctx, workspace_id);
  const role = workspaces.assertRole(ctx, workspace_id, 'viewer');
  return {
    workspace,
    profile: parseStoredProfile(workspace.profile_json),
    role,
  };
}

export function setWorkspaceProfile(
  ctx: SessionContext,
  profile: unknown,
  mode: ProfileUpdateMode = 'merge',
  workspace_id = ctx.workspace_id,
): { workspace: WorkspaceRecord; profile: JsonObject; role: string } {
  workspaces.assertRole(ctx, workspace_id, 'admin');
  const next = normalizeProfile(profile);
  const current = getWorkspaceProfile(ctx, workspace_id).profile;
  const updated = applyProfileUpdate(current, next, mode);
  db.prepare('UPDATE workspaces SET profile_json = ? WHERE id = ?').run(
    JSON.stringify(updated),
    workspace_id,
  );
  const workspace = workspaces.getById(ctx, workspace_id);
  return {
    workspace,
    profile: updated,
    role: 'admin',
  };
}

export function setContextProfile(
  ctx: SessionContext,
  updates: {
    user_profile?: unknown;
    workspace_profile?: unknown;
    mode?: ProfileUpdateMode;
  },
): {
  user_profile: JsonObject;
  workspace_profile: JsonObject;
  workspace: WorkspaceRecord;
  role: string;
} {
  const mode = updates.mode || 'merge';
  const tx = db.transaction(() => {
    if (updates.workspace_profile !== undefined) {
      workspaces.assertRole(ctx, ctx.workspace_id, 'admin');
    }

    let userProfile = getUserProfile(ctx);
    let workspaceProfile = getWorkspaceProfile(ctx).profile;

    if (updates.user_profile !== undefined) {
      userProfile = setUserProfile(ctx, updates.user_profile, mode);
    }
    if (updates.workspace_profile !== undefined) {
      workspaceProfile = setWorkspaceProfile(ctx, updates.workspace_profile, mode).profile;
    }

    const context = getContextProfile(ctx);
    return {
      user_profile: userProfile,
      workspace_profile: workspaceProfile,
      workspace: context.workspace,
      role: context.role,
    };
  });
  return tx();
}

export function getContextProfile(ctx: SessionContext): {
  user_profile: JsonObject;
  workspace_profile: JsonObject;
  workspace: WorkspaceRecord;
  role: string;
} {
  const workspace = getWorkspaceProfile(ctx);
  return {
    user_profile: getUserProfile(ctx),
    workspace_profile: workspace.profile,
    workspace: workspace.workspace,
    role: workspace.role,
  };
}
