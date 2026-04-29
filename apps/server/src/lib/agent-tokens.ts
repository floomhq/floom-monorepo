import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { db } from '../db.js';
import type { AgentTokenRecord, AgentTokenScope, SessionContext } from '../types.js';

const TOKEN_PREFIX = 'floom_agent_';
const TOKEN_RANDOM_LENGTH = 32;
const PREFIX_RANDOM_LENGTH = 8;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LAST_USED_DEBOUNCE_MS = 60_000;

export interface AgentTokenAuthContext {
  agent_token_id: string;
  user_id: string;
  workspace_id: string;
  scope: AgentTokenScope;
  rate_limit_per_minute: number;
}

const agentTokenContext = new WeakMap<Context, AgentTokenAuthContext>();

function getPresentedBearer(c: Context): string | null {
  const header = c.req.header('authorization') || c.req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export function getPresentedAgentToken(c: Context): string | null {
  const token = getPresentedBearer(c);
  if (!token) return null;
  return isAgentTokenString(token) ? token : null;
}

export function isAgentTokenString(value: string): boolean {
  return new RegExp(`^${TOKEN_PREFIX}[0-9A-Za-z]{${TOKEN_RANDOM_LENGTH}}$`).test(value);
}

export function isValidAgentTokenScope(value: unknown): value is AgentTokenScope {
  return value === 'read' || value === 'read-write' || value === 'publish-only';
}

export function hashAgentToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function extractAgentTokenPrefix(rawToken: string): string {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    throw new Error('agent token must start with floom_agent_');
  }
  const randomPart = rawToken.slice(TOKEN_PREFIX.length);
  if (randomPart.length < PREFIX_RANDOM_LENGTH) {
    throw new Error('agent token random part is too short');
  }
  return `${TOKEN_PREFIX}${randomPart.slice(0, PREFIX_RANDOM_LENGTH)}`;
}

export function generateAgentToken(): string {
  let suffix = '';
  for (let i = 0; i < TOKEN_RANDOM_LENGTH; i++) {
    suffix += BASE62[randomInt(BASE62.length)];
  }
  return `${TOKEN_PREFIX}${suffix}`;
}

export function newAgentTokenId(): string {
  return `agtok_${randomUUID()}`;
}

export function getAgentTokenContext(c: Context): AgentTokenAuthContext | null {
  return agentTokenContext.get(c) || null;
}

export function setAgentTokenContext(
  c: Context,
  ctx: AgentTokenAuthContext,
): void {
  agentTokenContext.set(c, ctx);
}

export function agentContextToSessionContext(
  auth: AgentTokenAuthContext,
  device_id: string,
): SessionContext {
  return {
    workspace_id: auth.workspace_id,
    user_id: auth.user_id,
    device_id,
    is_authenticated: true,
    auth_user_id: auth.user_id,
    agent_token_id: auth.agent_token_id,
    agent_token_scope: auth.scope,
    agent_token_rate_limit_per_minute: auth.rate_limit_per_minute,
  };
}

export function lookupAgentToken(rawToken: string): AgentTokenRecord | null {
  if (!isAgentTokenString(rawToken)) return null;
  const hash = hashAgentToken(rawToken);
  const row = db
    .prepare(
      `SELECT t.* FROM agent_tokens t
        WHERE t.hash = ?
          AND t.revoked_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM workspace_members wm
             WHERE wm.workspace_id = t.workspace_id
               AND wm.user_id = t.user_id
          )
        LIMIT 1`,
    )
    .get(hash) as AgentTokenRecord | undefined;
  return row || null;
}

export function touchAgentTokenLastUsed(row: AgentTokenRecord, now = new Date()): void {
  const previous = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (Number.isFinite(previous) && now.getTime() - previous < LAST_USED_DEBOUNCE_MS) {
    return;
  }
  db.prepare(
    `UPDATE agent_tokens
       SET last_used_at = ?
     WHERE id = ?
       AND revoked_at IS NULL
       AND (last_used_at IS NULL OR last_used_at < ?)`,
  ).run(now.toISOString(), row.id, new Date(now.getTime() - LAST_USED_DEBOUNCE_MS).toISOString());
}

/**
 * Returns true when an Authorization header is present and looks like a
 * Floom agent token attempt (starts with `floom_agent_`).
 * Used to detect mis-formatted tokens that should return 401 instead of
 * silently routing to the admin/anon MCP server (item 7 fix).
 */
function looksLikeAgentTokenAttempt(c: Context): boolean {
  const token = getPresentedBearer(c);
  if (!token) return false;
  // Any floom_agent_* bearer that doesn't pass the strict format check is a
  // malformed/invalid token — return 401 rather than treating as anonymous.
  return token.startsWith('floom_agent_');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function hasPresentedAdminBearer(c: Context): boolean {
  const expected = process.env.FLOOM_AUTH_TOKEN;
  if (!expected) return false;
  const token = getPresentedBearer(c);
  return token !== null && constantTimeEqual(token, expected);
}

function isMcpRequest(c: Context): boolean {
  return new URL(c.req.url).pathname.startsWith('/mcp');
}

export const agentTokenAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const rawToken = getPresentedAgentToken(c);

  // No Floom token presented — check if there's a mis-formatted floom_agent_*
  // bearer (wrong length, bad chars, etc.). If so, return 401 explicitly so
  // clients know their token is bad rather than silently routing to the admin
  // MCP server (closes item 7 / checklist 7.5).
  if (!rawToken) {
    const bearer = getPresentedBearer(c);
    if (
      looksLikeAgentTokenAttempt(c) ||
      (bearer && isMcpRequest(c) && !hasPresentedAdminBearer(c))
    ) {
      return c.json(
        {
          error: 'invalid_token',
          code: 'invalid_token',
          hint: 'The token format is invalid. Agent tokens look like floom_agent_<32 alphanumeric chars>. Get a valid token at https://floom.dev/me/agent-keys',
        },
        401,
      );
    }
    return next();
  }

  const row = lookupAgentToken(rawToken);
  if (!row) {
    return c.json(
      {
        error: 'invalid_agent_token',
        code: 'invalid_token',
        hint: 'Token not found, revoked, or no longer workspace-valid. Mint a new token at https://floom.dev/me/agent-keys',
      },
      401,
    );
  }

  setAgentTokenContext(c, {
    agent_token_id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    scope: row.scope,
    rate_limit_per_minute: row.rate_limit_per_minute,
  });
  touchAgentTokenLastUsed(row);
  return next();
};

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isAgentReadPath(path: string): boolean {
  if (path === '/api/session/me' || path === '/api/session/me/') return true;
  if (path === '/api/hub' || path === '/api/hub/') return true;
  if (/^\/api\/hub\/[^/]+\/?$/.test(path)) return true;
  if (/^\/api\/hub\/[^/]+\/(source|openapi\.json|runs|runs-by-day)\/?$/.test(path)) return true;
  if (/^\/api\/agents\/runs(\/[^/]+)?\/?$/.test(path)) return true;
  if (/^\/api\/run\/[^/]+\/?$/.test(path)) return true;
  if (/^\/api\/apps\/[^/]+\/reviews\/?$/.test(path)) return true;
  if (/^\/api\/[^/]+\/quota\/?$/.test(path)) return true;
  return false;
}

function isStudioReadPath(path: string): boolean {
  if (path === '/api/session/me' || path === '/api/session/me/') return true;
  if (path === '/api/hub/mine' || path === '/api/hub/mine/') return true;
  if (/^\/api\/hub\/[^/]+\/?$/.test(path)) return true;
  if (/^\/api\/hub\/[^/]+\/(source|openapi\.json)\/?$/.test(path)) return true;
  if (/^\/api\/me\/apps\/[^/]+\/.+/.test(path)) return true;
  return false;
}

function isAgentRunWrite(method: string, path: string): boolean {
  if (method !== 'POST') return false;
  if (path === '/api/run' || path === '/api/run/') return true;
  if (/^\/api\/[^/]+\/run\/?$/.test(path)) return true;
  if (/^\/api\/[^/]+\/jobs\/?$/.test(path)) return true;
  return false;
}

function isStudioWritePath(method: string, path: string): boolean {
  if (method === 'POST' && path === '/api/hub/ingest') return true;
  if (/^\/api\/hub\/[^/]+\/(fork|claim|install|renderer)\/?$/.test(path)) {
    return method === 'POST' || method === 'DELETE';
  }
  if (/^\/api\/hub\/[^/]+\/?$/.test(path)) {
    return method === 'PATCH' || method === 'DELETE';
  }
  if (/^\/api\/me\/apps\/[^/]+\/.+/.test(path)) {
    return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  }
  return false;
}

/**
 * Enforce agent-token scopes on REST/HTTP APIs. MCP has per-tool scope checks,
 * but HTTP routes share the normal session context, so a read token must not
 * inherit every mutating browser/API capability.
 */
export const agentTokenHttpScopeMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = getAgentTokenContext(c);
  if (!auth) return next();

  const method = c.req.method.toUpperCase();
  const path = new URL(c.req.url).pathname;

  if (auth.scope === 'read-write') return next();
  if (auth.scope === 'read') {
    if (isReadMethod(method) && isAgentReadPath(path)) return next();
    if (isAgentRunWrite(method, path)) return next();
  }
  if (auth.scope === 'publish-only') {
    if (isReadMethod(method) && isStudioReadPath(path)) return next();
    if (isStudioWritePath(method, path)) return next();
  }

  return c.json(
    {
      error: 'Agent token scope does not allow this HTTP API action.',
      code: 'forbidden_scope',
      required_scope:
        auth.scope === 'read'
          ? 'read-write'
          : 'read or read-write for run actions; read-write for account actions',
      current_scope: auth.scope,
    },
    403,
  );
};
