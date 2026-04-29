import { db } from '../db.js';
import { createHmac } from 'node:crypto';
import type { IntegrationSpec } from '../types.js';
import * as userSecrets from './user_secrets.js';
import {
  ComposioClientError,
  ComposioConfigError,
  KNOWN_PROVIDERS,
  buildComposioUserId,
  getComposioClient,
  resolveAuthConfigId,
} from './composio.js';

const CALLBACK_TTL_MS = 15 * 60 * 1000;

export const KNOWN_COMPOSIO_SLUGS = [
  ...KNOWN_PROVIDERS,
  'google_sheets',
  'google-calendar',
  'salesforce',
  'jira',
  'discord',
  'trello',
  'asana',
  'drive',
  'google_drive',
  'dropbox',
  'sendgrid',
  'resend',
  'mailchimp',
  'zendesk',
  'intercom',
  'twilio',
  'supabase',
  'postgres',
  'mongodb',
].filter((slug, idx, all) => all.indexOf(slug) === idx);

const KNOWN_SET = new Set(KNOWN_COMPOSIO_SLUGS);

export class MissingComposioIntegrationError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`needs integration: ${missing.join(', ')}`);
    this.name = 'MissingComposioIntegrationError';
    this.missing = missing;
  }
}

export interface ComposioConnectResult {
  auth_url: string;
  connection_id: string;
  integration: string;
  expires_at: string;
}

export interface ComposioCallbackResult {
  integration: string;
  connected_account_id: string;
  token_source: 'callback_token' | 'connected_account_id';
}

function assertKnownIntegration(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(normalized) || !KNOWN_SET.has(normalized)) {
    throw new ComposioConfigError(`unknown Composio integration: ${slug}`);
  }
  return normalized;
}

export function composioSecretKey(slug: string): string {
  return `composio:${assertKnownIntegration(slug)}`;
}

export function composioEnvKey(slug: string): string {
  return `${assertKnownIntegration(slug).replace(/[^a-z0-9]/g, '_').toUpperCase()}_OAUTH_TOKEN`;
}

function encodeState(input: {
  workspace_id: string;
  user_id: string;
  integration: string;
  connection_id: string;
}): string {
  const payload = Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
  const sig = signState(payload);
  return `${payload}.${sig}`;
}

function decodeState(raw: string): {
  workspace_id: string;
  user_id: string;
  integration: string;
  connection_id: string;
} {
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || signState(payload) !== sig) {
    throw new ComposioClientError('invalid callback state');
  }
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    workspace_id?: unknown;
    user_id?: unknown;
    integration?: unknown;
    connection_id?: unknown;
  };
  if (
    typeof parsed.workspace_id !== 'string' ||
    typeof parsed.user_id !== 'string' ||
    typeof parsed.integration !== 'string' ||
    typeof parsed.connection_id !== 'string'
  ) {
    throw new ComposioClientError('invalid callback state');
  }
  return {
    workspace_id: parsed.workspace_id,
    user_id: parsed.user_id,
    integration: assertKnownIntegration(parsed.integration),
    connection_id: parsed.connection_id,
  };
}

function signState(payload: string): string {
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.COMPOSIO_API_KEY ||
    process.env.FLOOM_AUTH_TOKEN ||
    'local-dev-composio-state';
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function composioConnect(
  workspace_id: string,
  user_id: string,
  integration_name: string,
  callbackUrl?: string,
): Promise<ComposioConnectResult> {
  const integration = assertKnownIntegration(integration_name);
  const authConfigId = resolveAuthConfigId(integration);
  const userId = buildComposioUserId('user', user_id);
  const client = await getComposioClient();
  const callback = callbackUrl || `${process.env.PUBLIC_URL || 'http://localhost:3051'}/api/integrations/composio/callback`;

  const req = await client.connectedAccounts.initiate(userId, authConfigId, {
    callbackUrl: callback,
  });
  if (!req.id || !req.redirectUrl) {
    throw new ComposioClientError(`Composio did not return an auth URL for ${integration}`);
  }

  const state = encodeState({ workspace_id, user_id, integration, connection_id: req.id });
  const redirect = new URL(req.redirectUrl);
  redirect.searchParams.set('floom_state', state);

  return {
    auth_url: redirect.toString(),
    connection_id: req.id,
    integration,
    expires_at: new Date(Date.now() + CALLBACK_TTL_MS).toISOString(),
  };
}

export async function storeComposioCallbackToken(args: {
  state: string;
  token?: string | null;
  connected_account_id?: string | null;
}): Promise<ComposioCallbackResult> {
  const state = decodeState(args.state);
  const connectedAccountId = args.connected_account_id || state.connection_id;
  if (!connectedAccountId) {
    throw new ComposioClientError('callback missing connected account id');
  }

  const client = await getComposioClient();
  const account = await client.connectedAccounts.get(connectedAccountId);
  const status = String(account.status || '').toUpperCase();
  if (status && status !== 'ACTIVE') {
    throw new ComposioClientError(`Composio account ${connectedAccountId} is ${account.status}`);
  }

  const token = args.token && args.token.length > 0 ? args.token : connectedAccountId;
  userSecrets.setWorkspaceSecret(state.workspace_id, composioSecretKey(state.integration), token);
  return {
    integration: state.integration,
    connected_account_id: connectedAccountId,
    token_source: args.token && args.token.length > 0 ? 'callback_token' : 'connected_account_id',
  };
}

export function resolveComposioCreds(
  workspace_id: string,
  manifest_integrations: IntegrationSpec[] | undefined,
): Record<string, string> {
  const integrations = (manifest_integrations || []).filter((item) => item.provider === 'composio');
  if (integrations.length === 0) return {};

  const missing: string[] = [];
  const env: Record<string, string> = {};
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (apiKey && apiKey.length > 0) env.COMPOSIO_API_KEY = apiKey;

  for (const item of integrations) {
    const slug = assertKnownIntegration(item.slug);
    const token = userSecrets.getWorkspaceSecret(workspace_id, composioSecretKey(slug));
    if (!token) {
      missing.push(slug);
      continue;
    }
    env[composioEnvKey(slug)] = token;
  }

  if (missing.length > 0) {
    throw new MissingComposioIntegrationError(missing);
  }
  return env;
}

export async function verifyComposioToken(token: string): Promise<boolean> {
  if (!token || token.length === 0) return false;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new ComposioConfigError('COMPOSIO_API_KEY is not set');
  }
  const base = process.env.COMPOSIO_API_BASE_URL || 'https://backend.composio.dev';
  const res = await fetch(`${base.replace(/\/+$/, '')}/api/v3.1/connected_accounts/${encodeURIComponent(token)}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) return false;
  if (!res.ok) {
    throw new ComposioClientError(`Composio identity check failed: HTTP ${res.status}`);
  }
  return true;
}

export function listComposioIntegrations(workspace_id: string): Array<{
  slug: string;
  connected: boolean;
}> {
  const rows = db
    .prepare(
      `SELECT key FROM workspace_secrets
         WHERE workspace_id = ?
           AND key LIKE 'composio:%'`,
    )
    .all(workspace_id) as { key: string }[];
  const connected = new Set(rows.map((row) => row.key.slice('composio:'.length)));
  return KNOWN_COMPOSIO_SLUGS.map((slug) => ({ slug, connected: connected.has(slug) }));
}

export function disconnectComposioIntegration(workspace_id: string, slug: string): boolean {
  return userSecrets.delWorkspaceSecret(workspace_id, composioSecretKey(slug));
}
