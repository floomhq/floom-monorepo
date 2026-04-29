import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { resolveUserContext } from '../services/session.js';
import {
  ComposioClientError,
  ComposioConfigError,
} from '../services/composio.js';
import {
  composioConnect,
  disconnectComposioIntegration,
  listComposioIntegrations,
  storeComposioCallbackToken,
} from '../services/composio-runtime.js';

export const composioRouter = new Hono();

const Slug = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/);

function errorResponse(c: Context, err: unknown) {
  if (err instanceof ComposioConfigError) {
    return c.json({ error: err.message, code: 'composio_config_missing' }, 400);
  }
  if (err instanceof ComposioClientError) {
    return c.json({ error: err.message, code: 'composio_failed' }, 502);
  }
  return c.json({ error: (err as Error).message, code: 'unexpected_error' }, 500);
}

composioRouter.get('/', async (c) => {
  const ctx = await resolveUserContext(c);
  return c.json({ integrations: listComposioIntegrations(ctx.workspace_id) });
});

composioRouter.post('/:slug/connect', async (c) => {
  const ctx = await resolveUserContext(c);
  const parsed = Slug.safeParse(c.req.param('slug'));
  if (!parsed.success) {
    return c.json({ error: 'invalid Composio slug', code: 'invalid_slug' }, 400);
  }
  try {
    const result = await composioConnect(ctx.workspace_id, ctx.user_id, parsed.data);
    return c.json(result);
  } catch (err) {
    return errorResponse(c, err);
  }
});

composioRouter.get('/callback', async (c) => {
  const state = c.req.query('state') || c.req.query('floom_state') || '';
  const token = c.req.query('access_token') || c.req.query('token') || null;
  const connectedAccountId =
    c.req.query('connected_account_id') ||
    c.req.query('connection_id') ||
    c.req.query('connectedAccountId') ||
    null;
  if (!state) {
    return c.json({ error: 'callback missing state', code: 'invalid_callback' }, 400);
  }
  try {
    const result = await storeComposioCallbackToken({
      state,
      token,
      connected_account_id: connectedAccountId,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

composioRouter.delete('/:slug', async (c) => {
  const ctx = await resolveUserContext(c);
  const parsed = Slug.safeParse(c.req.param('slug'));
  if (!parsed.success) {
    return c.json({ error: 'invalid Composio slug', code: 'invalid_slug' }, 400);
  }
  try {
    const removed = disconnectComposioIntegration(ctx.workspace_id, parsed.data);
    return c.json({ ok: true, removed });
  } catch (err) {
    return errorResponse(c, err);
  }
});
