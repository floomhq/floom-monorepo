import { db } from '../db.js';
import type { ActionSpec, SessionContext } from '../types.js';

export type JsonObject = Record<string, unknown>;

const MAX_PROFILE_JSON_BYTES = 65_536;
const SECRET_KEY_PATTERN =
  /(?:^|_)(api_?key|secret|token|password|passwd|credential|private_?key|bearer|authorization|cookie|session)(?:$|_)/i;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProfile(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function assertJsonProfile(value: unknown, field: string): asserts value is JsonObject {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PROFILE_JSON_BYTES) {
    throw new Error(`${field} must be smaller than 64KB`);
  }
  const secretPath = findSecretLikeKey(value);
  if (secretPath) {
    throw new Error(
      `${field} contains secret-like key "${secretPath}". Store API keys, tokens, passwords, cookies, and credentials in the encrypted secrets vault instead.`,
    );
  }
}

function findSecretLikeKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findSecretLikeKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSecretLikeKey(key)) return childPath;
    const found = findSecretLikeKey(child, childPath);
    if (found) return found;
  }
  return null;
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return SECRET_KEY_PATTERN.test(`_${normalized}_`);
}

export function getUserProfile(userId: string): JsonObject {
  const row = db
    .prepare(`SELECT profile_json FROM user_profiles WHERE user_id = ?`)
    .get(userId) as { profile_json: string } | undefined;
  return parseProfile(row?.profile_json);
}

export function getWorkspaceProfile(workspaceId: string): JsonObject {
  const row = db
    .prepare(`SELECT profile_json FROM workspace_profiles WHERE workspace_id = ?`)
    .get(workspaceId) as { profile_json: string } | undefined;
  return parseProfile(row?.profile_json);
}

export function getProfileContext(ctx: SessionContext): {
  user_profile: JsonObject;
  workspace_profile: JsonObject;
} {
  return {
    user_profile: getUserProfile(ctx.user_id),
    workspace_profile: getWorkspaceProfile(ctx.workspace_id),
  };
}

export function setUserProfile(userId: string, profile: JsonObject): void {
  assertJsonProfile(profile, 'user_profile');
  db.prepare(
    `INSERT INTO user_profiles (user_id, profile_json, updated_at)
       VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(profile));
}

export function setWorkspaceProfile(workspaceId: string, profile: JsonObject): void {
  assertJsonProfile(profile, 'workspace_profile');
  db.prepare(
    `INSERT INTO workspace_profiles (workspace_id, profile_json, updated_at)
       VALUES (?, ?, datetime('now'))
     ON CONFLICT(workspace_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       updated_at = excluded.updated_at`,
  ).run(workspaceId, JSON.stringify(profile));
}

function readPath(root: JsonObject, parts: string[]): unknown {
  let cursor: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(cursor) || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

export function resolveContextPath(
  context: { user_profile: JsonObject; workspace_profile: JsonObject },
  path: string,
): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const [scope, ...rest] = parts;
  if (scope === 'user' || scope === 'user_profile') {
    return readPath(context.user_profile, rest);
  }
  if (scope === 'workspace' || scope === 'workspace_profile') {
    return readPath(context.workspace_profile, rest);
  }
  return undefined;
}

export function applyProfileContext(
  action: ActionSpec,
  inputs: Record<string, unknown>,
  ctx: SessionContext,
): Record<string, unknown> {
  const next = { ...inputs };
  const contextInputs = action.inputs.filter((input) => input.context_path);
  if (contextInputs.length === 0) return next;
  const context = getProfileContext(ctx);
  for (const input of contextInputs) {
    const current = next[input.name];
    if (current !== undefined && current !== null && current !== '') continue;
    const value = resolveContextPath(context, input.context_path as string);
    if (value !== undefined && value !== null && value !== '') {
      next[input.name] = value;
    }
  }
  return next;
}
