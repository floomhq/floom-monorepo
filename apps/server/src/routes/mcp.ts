// MCP endpoints for Floom.
//   /mcp           — admin surface (ingest_app, ingest_hint, detect_inline,
//                    list_apps, search_apps, get_app)
//   /mcp/search    — gallery-wide semantic search
//   /mcp/app/:slug — per-app MCP (one tool per action)
//
// Registration order matters: `/` (admin) is handled ahead of
// `/app/:slug` below so Hono does not swallow the root path as a slug.
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { db, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from '../db.js';
import { newRunId, newJobId } from '../lib/ids.js';
import { validateInputs, ManifestError } from '../services/manifest.js';
import { dispatchRun, getRun } from '../services/runner.js';
import { cancelJob, createJob, formatJob, getJobBySlug } from '../services/jobs.js';
import { pickApps } from '../services/embeddings.js';
import {
  buildIngestHint,
  probeIngestHint,
  detectAppFromInlineSpec,
  ingestAppFromSpec,
  ingestAppFromUrl,
} from '../services/openapi-ingest.js';
import {
  ingestAppFromDockerImage,
  isDockerPublishEnabled,
  DockerPublishDisabledError,
  DOCKER_PUBLISH_FLAG,
} from '../services/docker-image-ingest.js';
import { resolveUserContext } from '../services/session.js';
import * as userSecrets from '../services/user_secrets.js';
import * as creatorSecrets from '../services/app_creator_secrets.js';
import * as contextProfiles from '../services/context_profiles.js';
import * as workspaces from '../services/workspaces.js';
import { isCloudMode } from '../lib/better-auth.js';
import {
  AUTH_DOCS_URL,
  AUTH_HINT_CLOUD,
  checkAppVisibility,
} from '../lib/auth.js';
import { buildAppSourceInfo } from '../lib/app-source.js';
import { checkMcpIngestLimit, extractIp } from '../lib/rate-limit.js';
import { extractUserApiKey, runGate } from '../lib/run-gate.js';
import { decideByok, hashUserAgent, isByokGated } from '../lib/byok-gate.js';
import { filterTestFixtures } from '../lib/hub-filter.js';
import { recordMcpToolCall } from '../lib/metrics-counters.js';
import { auditLog, getAuditActor } from '../services/audit-log.js';
import { renderAppInviteEmail, sendEmail } from '../lib/email.js';
import {
  agentToolErrorBody,
  AgentToolError,
  discoverApps,
  getAgentRun,
  getAppSkill,
  listMyRuns,
  runApp,
} from '../services/agent_read_tools.js';
import { invalidateHubCache } from '../lib/hub-cache.js';
import { deleteAppRecordById } from '../services/app_delete.js';
import {
  deleteRunForOwner,
  RunDeleteForbiddenError,
  RunDeleteNotFoundError,
} from '../services/run-retention-sweeper.js';
import { deleteWorkspaceRuns } from '../services/run-retention-sweeper.js';
import {
  createTrigger,
  deleteTrigger,
  getTrigger,
  listTriggersForWorkspaceUser,
  serializeTrigger,
  updateTrigger,
  validateCronExpression,
} from '../services/triggers.js';
import {
  canonicalVisibility,
  findUserByEmail,
  findUserByUsername,
  getAppAccessDecision,
  isAppOwner,
  listInvites,
  revokeInvite,
  transitionVisibility,
  upsertInvite,
  type AppInviteRow,
} from '../services/sharing.js';
import {
  AppLibraryError,
  claimApp,
  forkApp,
  installApp,
  uninstallApp,
} from '../services/app_library.js';
import type {
  ActionSpec,
  AppRecord,
  AppReviewRecord,
  InputSpec,
  JobRecord,
  NormalizedManifest,
  RunRecord,
  SecretPolicy,
  SessionContext,
  WorkspaceMemberRole,
  WorkspaceRecord,
} from '../types.js';

export const mcpRouter = new Hono();

/**
 * Resolve the public origin used in MCP response bodies (permalink, mcp_url,
 * etc.).
 *
 * Priority (B8 fix — was hardcoded to `https://floom.dev`):
 *   1. `FLOOM_PUBLIC_ORIGIN` env (explicit operator override — used in prod
 *      to pin responses to the canonical origin regardless of which host
 *      the request came in on).
 *   2. The origin of the incoming request. Any reverse proxy (nginx, Cloud
 *      Run) is expected to preserve the public hostname in `c.req.url`; if
 *      not, set `FLOOM_PUBLIC_ORIGIN` to override.
 *
 * Why no hardcoded fallback: defaulting to `https://floom.dev` on preview
 * environments caused ingest_app responses to hand out prod permalinks that
 * broke the preview→ingest→click-through loop. Deriving from the request
 * keeps preview.floom.dev, docker.floom.dev, and local dev all self-consistent.
 *
 * NB: email templates (`apps/server/src/lib/email.ts`) and canonical URL meta
 * tags in HTML responses intentionally still point at the prod origin —
 * emails are only sent from prod, and canonical tags must resolve to the
 * indexed URL. Only MCP response bodies use this helper.
 */
export function getPublicBaseUrl(c: Context): string {
  const override = process.env.FLOOM_PUBLIC_ORIGIN;
  if (typeof override === 'string' && override.length > 0) {
    return override.replace(/\/+$/, '');
  }
  const forwardedHost = c.req.header('x-forwarded-host');
  const host = forwardedHost || c.req.header('host');
  if (host) {
    const forwardedProto = c.req.header('x-forwarded-proto');
    let proto = forwardedProto || 'https';
    if (!forwardedProto) {
      try {
        proto = new URL(c.req.url).protocol.replace(/:$/, '') || 'https';
      } catch {
        proto = 'https';
      }
    }
    return `${proto}://${host}`.replace(/\/+$/, '');
  }
  const publicUrl = process.env.PUBLIC_URL;
  if (typeof publicUrl === 'string' && publicUrl.length > 0) {
    return publicUrl.replace(/\/+$/, '');
  }
  try {
    return new URL(c.req.url).origin;
  } catch {
    // Defensive fallback. Any request reaching a Hono handler will have a
    // parseable URL, so this branch should be unreachable in practice.
    return 'https://floom.dev';
  }
}

function formatRun(row: RunRecord) {
  return {
    id: row.id,
    app_id: row.app_id,
    action: row.action,
    inputs: row.inputs ? JSON.parse(row.inputs) : null,
    outputs: row.outputs ? JSON.parse(row.outputs) : null,
    logs: row.logs,
    status: row.status,
    error: row.error,
    error_type: row.error_type,
    duration_ms: row.duration_ms,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

async function waitForRun(runId: string): Promise<RunRecord> {
  const MAX_WAIT_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 2000;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const row = getRun(runId);
    if (!row) throw new Error(`Run ${runId} not found`);
    if (['success', 'error', 'timeout'].includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  const row = getRun(runId);
  if (!row) throw new Error(`Run ${runId} not found`);
  return row;
}

function buildZodSchema(
  inputs: InputSpec[],
  secretsNeeded: string[],
): Record<string, z.ZodType> {
  const schema: Record<string, z.ZodType> = {};
  for (const inp of inputs) {
    let field: z.ZodType;
    switch (inp.type) {
      case 'number':
        field = z.number().describe(inp.description ?? inp.label);
        break;
      case 'boolean':
        field = z.boolean().describe(inp.description ?? inp.label);
        break;
      case 'enum':
        if (inp.options && inp.options.length > 0) {
          field = z
            .enum(inp.options as [string, ...string[]])
            .describe(inp.description ?? inp.label);
        } else {
          field = z.string().describe(inp.description ?? inp.label);
        }
        break;
      default:
        field = z.string().describe(inp.description ?? inp.label);
    }
    if (!inp.required) {
      field = field.optional();
    }
    schema[inp.name] = field;
  }
  // Per-user secrets injection (Floom MCP extension).
  // When the app declares secrets_needed, advertise them as an optional
  // `_auth` meta object. The MCP client can populate it per call; values
  // are injected into the per-run secrets and never persisted server-side.
  if (secretsNeeded.length > 0) {
    const authShape: Record<string, z.ZodType> = {};
    for (const name of secretsNeeded) {
      authShape[name] = z
        .string()
        .optional()
        .describe(`Per-user secret: ${name}`);
    }
    schema._auth = z
      .object(authShape)
      .optional()
      .describe(
        `Per-user secrets for this app. Required: ${secretsNeeded.join(
          ', ',
        )}. These values are used for this call only and are never stored server-side.`,
      );
  }
  return schema;
}

function createPerAppMcpServer(
  c: Context,
  app: AppRecord,
  ctx?: SessionContext,
): McpServer {
  const manifest = JSON.parse(app.manifest) as NormalizedManifest;
  const server = new McpServer({
    name: `floom-chat-${app.slug}`,
    version: '0.3.0',
  });

  for (const [actionName, actionSpec] of Object.entries(manifest.actions) as Array<
    [string, ActionSpec]
  >) {
    const actionSecretsNeeded =
      actionSpec.secrets_needed !== undefined
        ? actionSpec.secrets_needed
        : manifest.secrets_needed || [];
    const toolName =
      actionName === 'run' ? app.slug.replace(/[^a-z0-9_]/g, '_') : actionName;
    const toolDescription =
      actionSpec.description ??
      `Run the "${actionSpec.label}" action on ${app.name}. ${app.description}`;

    server.registerTool(
      toolName,
      {
        title: actionSpec.label,
        description: toolDescription,
        inputSchema: buildZodSchema(actionSpec.inputs, actionSecretsNeeded),
      },
      async (rawInputs) => {
        recordMcpToolCall(toolName);
        const fresh = db.prepare('SELECT * FROM apps WHERE id = ?').get(app.id) as
          | AppRecord
          | undefined;
        if (!fresh) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `App not found: ${app.slug}` }],
          };
        }
        if (fresh.status !== 'active') {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `App is ${fresh.status}, cannot run` }],
          };
        }
        if (ctx) {
          const gate = runGate(c, ctx, { slug: fresh.slug });
          if (!gate.ok) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ ...gate.body, status: gate.status }, null, 2),
                },
              ],
            };
          }
        }

        // Extract the Floom MCP _auth extension from the raw inputs before
        // validating against the action's input schema. _auth is per-call
        // secrets that the MCP client can supply on each tool invocation.
        // Never persisted server-side.
        const raw = { ...(rawInputs as Record<string, unknown>) };
        let perCallSecrets: Record<string, string> | undefined;
        if (raw._auth && typeof raw._auth === 'object' && raw._auth !== null) {
          const authObj = raw._auth as Record<string, unknown>;
          perCallSecrets = {};
          for (const [k, v] of Object.entries(authObj)) {
            if (typeof v === 'string' && v.length > 0) {
              perCallSecrets[k] = v;
            }
          }
          delete raw._auth;
        }

        let validated: Record<string, unknown>;
        try {
          validated = validateInputs(actionSpec, raw);
        } catch (err) {
          const e = err as ManifestError;
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Invalid inputs: ${e.message}` }],
          };
        }
        const runId = newRunId();
        const freshManifest = JSON.parse(fresh.manifest) as NormalizedManifest;

        // If the app requires secrets and none are available (neither
        // server-side persisted nor per-call _auth), return a structured
        // missing_secrets error so the MCP client can prompt the user.
        if (actionSecretsNeeded.length > 0) {
          const available = new Set<string>();
          // Server-side persisted secrets
          const rows = db
            .prepare(
              "SELECT name FROM secrets WHERE (app_id IS NULL OR app_id = ?) AND value != ''",
            )
            .all(fresh.id) as { name: string }[];
          for (const r of rows) available.add(r.name);
          if (ctx) {
            try {
              const persisted = userSecrets.loadForRun(ctx, actionSecretsNeeded);
              for (const key of Object.keys(persisted)) available.add(key);
            } catch {
              // The runner emits the decrypt warning and still honors per-call _auth.
            }
          }
          // Per-call secrets
          for (const k of Object.keys(perCallSecrets || {})) available.add(k);

          const missing = actionSecretsNeeded.filter((n) => !available.has(n));
          if (missing.length > 0) {
            const errorPayload = {
              error: 'missing_secrets',
              required: missing,
              help: `This app needs ${missing.join(
                ', ',
              )}. Supply them via the _auth meta argument: {"_auth": {"${missing[0]}": "your_value"}}`,
            };
            return {
              isError: true,
              content: [
                { type: 'text' as const, text: JSON.stringify(errorPayload, null, 2) },
              ],
            };
          }
        }

        // Async app (v0.3.0): enqueue a job and return immediately so the
        // MCP client doesn't block on a 10-20 minute run. The client polls
        // /api/:slug/jobs/:id or receives a webhook on completion.
        if (fresh.is_async) {
          const jobId = newJobId();
          createJob(jobId, {
            app: fresh,
            action: actionName,
            inputs: validated,
            workspaceId: ctx?.workspace_id,
            userId: ctx?.user_id,
            deviceId: ctx?.device_id,
            perCallSecrets,
          });
          const publicUrl =
            process.env.PUBLIC_URL ||
            `http://localhost:${process.env.PORT || 3051}`;
          const pollUrl = `${publicUrl}/api/${fresh.slug}/jobs/${jobId}`;
          const payload = {
            job_id: jobId,
            status: 'queued',
            slug: fresh.slug,
            action: actionName,
            poll_url: pollUrl,
            cancel_url: `${pollUrl}/cancel`,
            message: `Job started: ${jobId}. Poll ${pollUrl} for status.`,
          };
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }

        const runtimeCtx =
          ctx ||
          {
            workspace_id: DEFAULT_WORKSPACE_ID,
            user_id: DEFAULT_USER_ID,
            device_id: DEFAULT_USER_ID,
            is_authenticated: false,
          };
        db.prepare(
          `INSERT INTO runs
             (id, app_id, thread_id, action, inputs, status, workspace_id, user_id, device_id)
           VALUES (?, ?, NULL, ?, ?, 'pending', ?, ?, ?)`,
        ).run(
          runId,
          fresh.id,
          actionName,
          JSON.stringify(validated),
          runtimeCtx.workspace_id,
          runtimeCtx.user_id,
          runtimeCtx.device_id,
        );
        // Parity with POST /api/run + POST /api/:slug/run: pass the
        // resolved SessionContext so dispatchRun can merge the caller's
        // user-vault secrets. Without this every authed MCP consumer
        // falls back to defaultContext() (the synthetic 'local' user)
        // and loses access to their own vault. See
        // docs/product-audit/deep/pd-05-three-surface-parity.md.
        dispatchRun(
          fresh,
          freshManifest,
          runId,
          actionName,
          validated,
          perCallSecrets,
          runtimeCtx,
        );
        const done = await waitForRun(runId);
        return {
          isError: done.status !== 'success',
          content: [{ type: 'text' as const, text: JSON.stringify(formatRun(done), null, 2) }],
        };
      },
    );
  }

  return server;
}

// ---------------------------------------------------------------------
// Admin MCP server (/mcp root)
//
// Exposes four tools for gallery + app-creation workflows. `ingest_app`
// is the only authenticated call — it mirrors the HTTP `/api/hub/ingest`
// session rules so one API surface covers both MCP clients and the web
// UI. The three read tools are public, matching `/api/hub` + `/mcp/search`.
// ---------------------------------------------------------------------

interface AdminToolContext {
  ctx: SessionContext;
  ip: string;
  baseUrl: string;
}

function serializeHubApp(
  row: AppRecord,
  manifest: NormalizedManifest | null,
  baseUrl: string,
) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    author: row.author,
    icon: row.icon,
    actions: manifest ? Object.keys(manifest.actions) : [],
    runtime: manifest?.runtime ?? 'python',
    secrets_needed: manifest?.secrets_needed ?? [],
    featured: row.featured === 1,
    avg_run_ms: row.avg_run_ms,
    max_run_retention_days: row.max_run_retention_days,
    created_at: row.created_at,
    permalink: `${baseUrl}/p/${row.slug}`,
    mcp_url: `${baseUrl}/mcp/app/${row.slug}`,
  };
}

function safeParseManifest(raw: string): NormalizedManifest | null {
  try {
    return JSON.parse(raw) as NormalizedManifest;
  } catch {
    return null;
  }
}

function serializeReviewForMcp(
  review: AppReviewRecord & { author_name?: string | null; author_email?: string | null },
): Record<string, unknown> {
  return {
    id: review.id,
    app_slug: review.app_slug,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author_name:
      review.author_name || (review.author_email ? review.author_email.split('@')[0] : null) || 'anonymous',
    created_at: review.created_at,
    updated_at: review.updated_at,
  };
}

function getReviewBundle(slug: string, limit = 20): Record<string, unknown> {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit || 20))));
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg
         FROM app_reviews
        WHERE app_slug = ?`,
    )
    .get(slug) as { count: number; avg: number };
  const rows = db
    .prepare(
      `SELECT app_reviews.*, users.name AS author_name, users.email AS author_email
         FROM app_reviews
         LEFT JOIN users ON users.id = app_reviews.user_id
        WHERE app_reviews.app_slug = ?
        ORDER BY app_reviews.created_at DESC
        LIMIT ?`,
    )
    .all(slug, lim) as Array<AppReviewRecord & { author_name: string | null; author_email: string | null }>;
  return {
    summary: {
      count: summary.count || 0,
      avg: Math.round(Number(summary.avg || 0) * 10) / 10,
    },
    reviews: rows.map(serializeReviewForMcp),
  };
}

function loadAccessibleAgentApp(
  ctx: SessionContext,
  slug: string,
  linkToken?: string,
): AppRecord {
  const app = db.prepare(`SELECT * FROM apps WHERE slug = ?`).get(slug) as AppRecord | undefined;
  if (!app) {
    throw new AgentToolError('not_found', `App not found: ${slug}`, 404);
  }
  const access = getAppAccessDecision(app, ctx, linkToken || null);
  if (!access.ok) {
    throw new AgentToolError(
      access.status === 401 ? 'auth_required' : 'not_found',
      access.status === 401 ? 'Authentication required for this app.' : `App not found: ${slug}`,
      access.status,
    );
  }
  return app;
}

function serializeAgentAppDetail(app: AppRecord, baseUrl: string): Record<string, unknown> {
  const manifest = safeParseManifest(app.manifest);
  const source = buildAppSourceInfo(app, manifest, baseUrl);
  const actions = manifest
    ? Object.entries(manifest.actions).map(([key, action]) => ({
        key,
        label: action.label,
        description: action.description ?? null,
        inputs: action.inputs,
        outputs: action.outputs,
        secrets_needed: action.secrets_needed ?? manifest.secrets_needed ?? [],
      }))
    : [];
  return {
    slug: app.slug,
    name: app.name,
    description: app.description,
    category: app.category,
    author: app.author,
    icon: app.icon,
    visibility: canonicalVisibility(app.visibility),
    publish_status: app.publish_status,
    status: app.status,
    runtime: manifest?.runtime ?? 'python',
    actions,
    about: {
      description: app.description,
      how_it_works: actions.map((action, index) => ({
        step: index + 1,
        key: action.key,
        label: action.label,
        description: action.description,
      })),
      license: manifest?.license ?? null,
      secrets_needed: manifest?.secrets_needed ?? [],
      primary_action: manifest?.primary_action ?? null,
    },
    install: source.install,
    source,
    reviews: getReviewBundle(app.slug, 20),
    limits: {
      max_run_retention_days: app.max_run_retention_days ?? null,
      run_rate_limit_per_hour: app.run_rate_limit_per_hour ?? null,
      timeout_ms: app.timeout_ms ?? null,
    },
    links: {
      permalink: `${baseUrl}/p/${app.slug}`,
      mcp_url: `${baseUrl}/mcp/app/${app.slug}`,
      owner_url: `${baseUrl}/studio/${app.slug}`,
    },
    created_at: app.created_at,
    updated_at: app.updated_at,
  };
}

function createAdminMcpServer({ ctx, ip, baseUrl }: AdminToolContext): McpServer {
  const server = new McpServer({
    name: 'floom-admin',
    version: '0.4.0',
  });

  // ---- ingest_app -----------------------------------------------------
  server.registerTool(
    'ingest_app',
    {
      title: 'Ingest App from OpenAPI or Docker image',
      description:
        'Create or update a Floom app. Two ingest modes: (1) OpenAPI — supply `openapi_url` or `openapi_spec`; (2) Docker image — supply `docker_image_ref` (gated behind FLOOM_ENABLE_DOCKER_PUBLISH=true, off by default). Exactly one mode per call. Overrides: name, description, slug, category. Requires authentication in Cloud mode. Returns the persisted slug + permalink.',
      inputSchema: {
        openapi_url: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            'Publicly reachable OpenAPI 3.x or Swagger 2.0 spec URL. Example: https://petstore3.swagger.io/api/v3/openapi.json',
          ),
        openapi_spec: z
          .record(z.unknown())
          .optional()
          .describe(
            'Inline OpenAPI spec object (alternative to openapi_url). Must declare servers[].url or swagger host for runtime calls to resolve.',
          ),
        docker_image_ref: z
          .string()
          .min(1)
          .max(512)
          .optional()
          .describe(
            'Docker image reference (admin-gated). Example: "ghcr.io/floomhq/ig-nano-scout:latest". Requires FLOOM_ENABLE_DOCKER_PUBLISH=true on the server.',
          ),
        manifest: z
          .record(z.unknown())
          .optional()
          .describe(
            'Optional Floom manifest (v1 or v2) paired with docker_image_ref. If absent, a minimal single-action manifest is synthesized.',
          ),
        secret_bindings: z
          .record(z.string())
          .optional()
          .describe(
            'Map of container env var → vault key in the caller\'s user_secrets. Example: {"IG_SESSIONID": "instagram_session_id"}. Only honored with docker_image_ref.',
          ),
        name: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe('Display name override. Defaults to spec.info.title or image repo name.'),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe('Description override. Defaults to spec.info.description or image label.'),
        slug: z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .optional()
          .describe(
            'URL slug override. Lowercase alphanumerics and dashes only. Defaults to slugify(name).',
          ),
        category: z
          .string()
          .max(48)
          .optional()
          .describe('Category tag (e.g. "productivity", "data", "ai").'),
        visibility: z
          .enum(['public', 'private', 'link', 'auth-required'])
          .optional()
          .describe(
            'Visibility override. Use "link" for secret-link sharing. "auth-required" is deprecated.',
          ),
        link_share_requires_auth: z
          .boolean()
          .optional()
          .describe('When true, publish as a link-shared app that also requires sign-in.'),
        auth_required: z
          .boolean()
          .optional()
          .describe('Deprecated. Use link_share_requires_auth. Supplying both is invalid.'),
        max_run_retention_days: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .optional()
          .describe('Optional run retention window in days. Omitted means indefinite.'),
      },
    },
    async (args) => {
      // Per-user/IP rate limit on ingest_app. Stops an MCP client from
      // scripting dozens of /mcp ingests per minute. Check BEFORE the
      // auth gate so we don't leak "anonymous users get 0 runs" vs "are
      // blocked for other reasons" through timing — 429 is a distinct
      // failure mode.
      const limit = checkMcpIngestLimit(ctx, ip);
      if (!limit.allowed) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'rate_limit_exceeded',
                  scope: 'mcp_ingest',
                  retry_after_seconds: limit.retryAfterSec,
                  message:
                    'ingest_app is limited to 10 calls per user per day. Retry after the window resets.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Auth gate: mirror /api/hub/ingest. In Cloud mode anonymous callers
      // cannot create apps; in OSS mode every caller is the synthetic local
      // user and the call always succeeds.
      if (isCloudMode() && !ctx.is_authenticated) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error:
                    'Authentication required. Sign in (or supply a valid session cookie / bearer token) and retry.',
                  code: 'auth_required',
                  hint: AUTH_HINT_CLOUD,
                  docs_url: AUTH_DOCS_URL,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const openapi_url = typeof args.openapi_url === 'string' ? args.openapi_url : undefined;
      const openapi_spec = args.openapi_spec as Record<string, unknown> | undefined;
      const docker_image_ref =
        typeof args.docker_image_ref === 'string' ? args.docker_image_ref : undefined;

      // Exactly one ingest mode per call. Both provided ⇒ ambiguous;
      // neither provided ⇒ nothing to ingest.
      const modes = [openapi_url, openapi_spec, docker_image_ref].filter(Boolean).length;
      if (modes === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'invalid_input',
                  message: 'Supply one of: openapi_url, openapi_spec, docker_image_ref.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      if (modes > 1) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'invalid_input',
                  message:
                    'Supply exactly one of: openapi_url, openapi_spec, docker_image_ref.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Docker-image path is admin-gated. Reject before touching the daemon so
      // the schema field can advertise the capability without exposing it.
      if (docker_image_ref && !isDockerPublishEnabled()) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'docker_publish_disabled',
                  message: `Docker-image ingest is disabled on this Floom instance. Set ${DOCKER_PUBLISH_FLAG}=true to enable.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        const common = {
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          slug: args.slug as string | undefined,
          category: args.category as string | undefined,
          max_run_retention_days:
            args.max_run_retention_days as number | undefined,
          workspace_id: ctx.workspace_id,
          author_user_id: ctx.user_id,
          actor_token_id: ctx.agent_token_id,
          actor_ip: ip,
        };
        let result: { slug: string; name: string; created: boolean };
        if (docker_image_ref) {
          result = await ingestAppFromDockerImage({
            ...common,
            docker_image_ref,
            manifest: args.manifest,
            secret_bindings: args.secret_bindings as Record<string, string> | undefined,
            visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
            link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
            auth_required: args.auth_required as boolean | undefined,
            ctx,
          });
        } else if (openapi_url) {
          // Prefer URL path — ingestAppFromUrl fetches + dereferences.
          result = await ingestAppFromUrl({
            ...common,
            openapi_url,
            visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
            link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
            auth_required: args.auth_required as boolean | undefined,
            allowPrivateNetwork:
              ctx.workspace_id === 'local' && ctx.user_id === 'local',
          });
        } else {
          // Inline spec path. Accept any JSON object and let
          // dereferenceSpec + specToManifest validate shape downstream.
          result = await ingestAppFromSpec({
            ...common,
            spec: openapi_spec as Parameters<typeof ingestAppFromSpec>[0]['spec'],
            visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
            link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
            auth_required: args.auth_required as boolean | undefined,
          });
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  slug: result.slug,
                  name: result.name,
                  created: result.created,
                  permalink: `${baseUrl}/p/${result.slug}`,
                  mcp_url: `${baseUrl}/mcp/app/${result.slug}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        // Preserve error codes from known ingest failures so MCP clients can
        // render targeted UI (docker_publish_disabled, pull_failed,
        // invalid_image_ref, manifest_invalid, etc.). Fall back to a generic
        // ingest_failed for everything else.
        let errorCode = 'ingest_failed';
        if (err instanceof DockerPublishDisabledError) {
          errorCode = 'docker_publish_disabled';
        } else if (
          typeof (err as { code?: unknown }).code === 'string'
        ) {
          errorCode = (err as { code: string }).code;
        }
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: errorCode,
                  message: (err as Error).message || 'Ingest failed',
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // ---- ingest_hint ----------------------------------------------------
  //
  // Proactive recovery companion for `ingest_app`. When an agent (Claude
  // in Cursor, Claude Desktop, any MCP client) tries to call ingest_app
  // and the repo doesn't have an OpenAPI spec, it calls ingest_hint to
  // learn exactly what file Floom needs, get a prompt it can run in the
  // user's repo, and the direct upload URL to submit the generated spec
  // back to. This closes the "ingest failed, user stuck" loop without
  // human intervention.
  //
  // No auth gate: returns static metadata + a prompt string, never
  // issues an outbound fetch — so not an SSRF primitive.
  server.registerTool(
    'ingest_hint',
    {
      title: 'Ingest hint: what Floom needs to publish an app',
      description:
        'Returns a structured recovery shape when `ingest_app` fails (or proactively, before calling it). Use this when the repo/URL the user gave you does not have an obvious OpenAPI spec. The response includes: the exact filenames Floom looks for, the minimal spec shape, a ready-to-paste prompt you can run in the user\'s repo to generate `openapi.yaml`, and the upload URL where you can POST the generated spec back to Floom to complete detection without re-entering the URL.',
      inputSchema: {
        input_url: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            'The repo URL, owner/repo ref, or OpenAPI URL the user provided. Example: "federicodeponte/openblog" or "https://github.com/acme/api".',
          ),
        attempted: z
          .array(z.string().max(2048))
          .max(40)
          .optional()
          .describe(
            'Paths the caller already probed (raw.githubusercontent URLs etc.). Forwarded back in `paths_tried` so the response names them exactly.',
          ),
      },
    },
    async ({ input_url, attempted }) => {
      const hint = buildIngestHint({
        input_url,
        attempted,
        baseUrl,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(hint, null, 2) },
        ],
      };
    },
  );

  // ---- detect_inline --------------------------------------------------
  //
  // Agent workflow: after `ingest_hint` gave the caller a ready prompt
  // and they generated an openapi.yaml in the user's repo, they can
  // submit the spec CONTENTS here to run detection without needing the
  // file to be pushed + publicly reachable yet. Mirrors
  // POST /api/hub/detect/inline.
  server.registerTool(
    'detect_inline',
    {
      title: 'Detect app from inline OpenAPI spec',
      description:
        'Run app detection against a spec supplied inline (JSON object or YAML/JSON string). Useful after `ingest_hint` when the caller just generated the spec and wants to preview the detected actions before committing + pushing it. Returns the same shape as `ingest_app`\'s detect preview (slug, name, actions, auth_type, tools_count, secrets_needed).',
      inputSchema: {
        openapi_spec: z
          .union([z.record(z.unknown()), z.string().min(1).max(2 * 1024 * 1024)])
          .describe(
            'OpenAPI 3.x (or Swagger 2.0) spec, either as a pre-parsed object or as a raw YAML/JSON string. YAML is parsed via the `yaml` package.',
          ),
        name: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe('Display name override. Defaults to spec.info.title.'),
        slug: z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .optional()
          .describe('URL slug override. Defaults to slugify(name).'),
      },
    },
    async ({ openapi_spec, name, slug }) => {
      try {
        const detected = await detectAppFromInlineSpec(
          openapi_spec as never,
          slug,
          name,
        );
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(detected, null, 2) },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: (err as Error).message || 'detect_inline_failed',
                  hint_url: `${baseUrl}/api/hub/detect/hint`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // ---- list_apps ------------------------------------------------------
  server.registerTool(
    'list_apps',
    {
      title: 'List Apps',
      description:
        'List every active app in the Floom hub. Filter by exact category, optionally filter by case-insensitive keyword (matches name + description). Returns slug, name, description, actions, permalink, and mcp_url.',
      inputSchema: {
        category: z
          .string()
          .max(48)
          .optional()
          .describe('Exact category filter (e.g. "productivity", "data").'),
        keyword: z
          .string()
          .max(120)
          .optional()
          .describe('Case-insensitive substring match on name + description.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max results. Defaults to 50.'),
      },
    },
    async ({ category, keyword, limit }) => {
      const lim = typeof limit === 'number' ? limit : 50;
      // MCP list_apps exposes public apps plus the caller's own apps. This
      // keeps freshly-ingested private apps discoverable to the creator without
      // leaking another user's private slug.
      let sql =
        "SELECT * FROM apps WHERE status = 'active'" +
        " AND (visibility = 'public_live' OR visibility = 'public' OR visibility IS NULL OR author = ?)" +
        (category ? ' AND category = ?' : '') +
        ' ORDER BY featured DESC, name ASC';
      const rows = (category
        ? db.prepare(sql).all(ctx.user_id, category)
        : db.prepare(sql).all(ctx.user_id)) as AppRecord[];
      // Issue #144: strip E2E / PRR / audit test fixtures from MCP gallery
      // listings so Claude Desktop + Cursor clients don't surface them in
      // discovery. Same regex as server /api/hub. Fixtures are still
      // accessible via `get_app` with the explicit slug.
      const rowsNoFixtures = filterTestFixtures(rows);
      const needle = typeof keyword === 'string' ? keyword.toLowerCase() : null;
      const filtered = needle
        ? rowsNoFixtures.filter((r) =>
            `${r.name} ${r.description}`.toLowerCase().includes(needle),
          )
        : rowsNoFixtures;
      const results = filtered.slice(0, lim).map((row) =>
        serializeHubApp(row, safeParseManifest(row.manifest), baseUrl),
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { total: filtered.length, returned: results.length, apps: results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- search_apps (admin copy) --------------------------------------
  server.registerTool(
    'search_apps',
    {
      title: 'Search Apps',
      description:
        'Natural-language search across the Floom hub. Uses OpenAI embeddings when OPENAI_API_KEY is set on the server; falls back to keyword scoring otherwise. Returns the top N matches with slug, name, confidence (0..1), and mcp_url.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'Free-form description of what you need. Example: "summarize a YouTube video" or "generate a QR code".',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max results. Defaults to 5.'),
      },
    },
    async ({ query, limit }) => {
      const results = await pickApps(query, limit ?? 5);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              results.map((r) => ({
                ...r,
                permalink: `${baseUrl}/p/${r.slug}`,
                mcp_url: `${baseUrl}/mcp/app/${r.slug}`,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- get_app --------------------------------------------------------
  server.registerTool(
    'get_app',
    {
      title: 'Get App',
      description:
        'Fetch a single app by slug. Returns the full manifest including every action with its input schema, outputs, and required secrets.',
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .describe('The app slug (e.g. "petstore", "qr-code").'),
      },
    },
    async ({ slug }) => {
      const row = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as
        | AppRecord
        | undefined;
      if (!row) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: 'not_found', slug, message: `App not found: ${slug}` },
                null,
                2,
              ),
            },
          ],
        };
      }
      const manifest = safeParseManifest(row.manifest);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...serializeHubApp(row, manifest, baseUrl),
                manifest,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

function createSearchMcpServer(baseUrl: string): McpServer {
  const server = new McpServer({
    name: 'floom-chat-search',
    version: '0.3.0',
  });
  server.registerTool(
    'search_apps',
    {
      title: 'Search Apps',
      description:
        'Search the Floom app gallery by natural language. Returns matching apps with slug, name, and MCP URL.',
      inputSchema: {
        query: z.string().describe('Natural language description of what you need'),
        limit: z.number().optional().describe('Max results (default 5)'),
      },
    },
    async ({ query, limit }) => {
      const results = await pickApps(query, limit ?? 5);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              results.map((r) => ({
                ...r,
                mcp_url: `${baseUrl}/mcp/app/${r.slug}`,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
  return server;
}

function mcpJson(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function mcpError(err: unknown) {
  if (err instanceof Error && err.message === 'illegal_transition') {
    return mcpError(
      new AgentToolError(
        'invalid_input',
        'Illegal visibility transition.',
        409,
        { code: 'illegal_transition' },
      ),
    );
  }
  if (err instanceof AppLibraryError) {
    const code =
      err.status === 404
        ? 'not_found'
        : err.status === 401
          ? 'auth_required'
          : err.status === 403
            ? 'forbidden_scope'
            : 'invalid_input';
    return mcpError(new AgentToolError(code, err.message, err.status, { code: err.code }));
  }
  if (err instanceof contextProfiles.ProfileValidationError) {
    return mcpError(new AgentToolError('invalid_input', err.message, 400));
  }
  if (err instanceof workspaces.WorkspaceNotFoundError) {
    return mcpError(new AgentToolError('not_found', err.message, 404, { code: 'workspace_not_found' }));
  }
  if (err instanceof workspaces.NotAMemberError) {
    return mcpError(new AgentToolError('forbidden_scope', err.message, 403, { code: 'not_a_member' }));
  }
  if (err instanceof workspaces.InsufficientRoleError) {
    return mcpError(new AgentToolError('forbidden_scope', err.message, 403, { code: 'insufficient_role' }));
  }
  const { status, body } = agentToolErrorBody(err);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ...body, status }, null, 2),
      },
    ],
  };
}

function requireStudioScope(ctx: SessionContext): void {
  if (!ctx.agent_token_id || !ctx.agent_token_scope) {
    throw new AgentToolError(
      'auth_required',
      'Authorization: Bearer floom_agent_<token> is required.',
      401,
    );
  }
  if (ctx.agent_token_scope === 'read-write' || ctx.agent_token_scope === 'publish-only') {
    return;
  }
  throw new AgentToolError(
    'forbidden_scope',
    'This tool requires read-write or publish-only agent-token scope.',
    403,
  );
}

function requireAccountScope(ctx: SessionContext): void {
  if (!ctx.agent_token_id || !ctx.agent_token_scope) {
    throw new AgentToolError(
      'auth_required',
      'Authorization: Bearer floom_agent_<token> is required.',
      401,
    );
  }
  if (ctx.agent_token_scope === 'read-write') {
    return;
  }
  throw new AgentToolError(
    'forbidden_scope',
    'This tool requires read-write agent-token scope.',
    403,
  );
}

function requireContextReadScope(ctx: SessionContext): void {
  if (!ctx.agent_token_id || !ctx.agent_token_scope) {
    throw new AgentToolError(
      'auth_required',
      'Authorization: Bearer floom_agent_<token> is required.',
      401,
    );
  }
  if (ctx.agent_token_scope === 'read' || ctx.agent_token_scope === 'read-write') {
    return;
  }
  throw new AgentToolError(
    'forbidden_scope',
    'This tool requires read or read-write agent-token scope.',
    403,
  );
}

function requireRunScope(ctx: SessionContext): void {
  if (!ctx.agent_token_id || !ctx.agent_token_scope) {
    throw new AgentToolError(
      'auth_required',
      'Authorization: Bearer floom_agent_<token> is required.',
      401,
    );
  }
  if (ctx.agent_token_scope === 'read' || ctx.agent_token_scope === 'read-write') {
    return;
  }
  throw new AgentToolError(
    'forbidden_scope',
    'This tool requires read or read-write agent-token scope.',
    403,
  );
}

function canUseRunTools(ctx: SessionContext): boolean {
  return Boolean(ctx.agent_token_id);
}

function canUseStudioTools(ctx: SessionContext): boolean {
  return ctx.agent_token_scope === 'read-write' || ctx.agent_token_scope === 'publish-only';
}

function canUseAccountTools(ctx: SessionContext): boolean {
  return ctx.agent_token_scope === 'read-write';
}

function canUseContextProfileTools(ctx: SessionContext): boolean {
  return ctx.agent_token_scope === 'read' || ctx.agent_token_scope === 'read-write';
}

const PUBLISH_ONLY_HIDDEN_TOOL_NAMES = new Set([
  'create_job',
  'discover_apps',
  'get_app_about',
  'get_app_details',
  'get_app_quota',
  'get_app_skill',
  'get_app_source',
  'get_job',
  'get_run',
  'list_app_reviews',
  'list_my_runs',
  'run_app',
]);

function loadOwnedStudioApp(ctx: SessionContext, slug: string): AppRecord {
  const app = db.prepare(`SELECT * FROM apps WHERE slug = ?`).get(slug) as AppRecord | undefined;
  if (!app || !isAppOwner(app, ctx)) {
    throw new AgentToolError('not_found', 'App not found.', 404);
  }
  return app;
}

function loadOwnedRun(ctx: SessionContext, runId: string): RunRecord {
  const row = getRun(runId);
  const workspaceId = row?.workspace_id || DEFAULT_WORKSPACE_ID;
  const runUserId = row?.user_id || DEFAULT_USER_ID;
  if (!row || workspaceId !== ctx.workspace_id || runUserId !== ctx.user_id) {
    throw new AgentToolError('not_found', 'Run not found.', 404);
  }
  return row;
}

function ensureOwnedJob(ctx: SessionContext, slug: string, jobId: string): JobRecord {
  const job = getJobBySlug(slug, jobId);
  const workspaceId = job?.workspace_id || DEFAULT_WORKSPACE_ID;
  const jobUserId = job?.user_id || DEFAULT_USER_ID;
  if (!job || workspaceId !== ctx.workspace_id || jobUserId !== ctx.user_id) {
    throw new AgentToolError('not_found', 'Job not found.', 404);
  }
  return job;
}

function mcpJobUrls(baseUrl: string, slug: string, jobId: string): Record<string, string> {
  const encodedSlug = encodeURIComponent(slug);
  const encodedJobId = encodeURIComponent(jobId);
  const pollUrl = `${baseUrl}/api/${encodedSlug}/jobs/${encodedJobId}`;
  return {
    poll_url: pollUrl,
    cancel_url: `${pollUrl}/cancel`,
  };
}

function parseStudioManifest(app: AppRecord): NormalizedManifest {
  const manifest = safeParseManifest(app.manifest);
  if (!manifest) {
    throw new AgentToolError(
      'runtime_error',
      'This app has an invalid manifest and cannot be edited through MCP.',
      500,
    );
  }
  return manifest;
}

function manifestSecretKeys(manifest: NormalizedManifest): string[] {
  return Array.from(new Set(manifest.secrets_needed || [])).sort();
}

function serializeInviteForMcp(invite: AppInviteRow): Record<string, unknown> {
  return {
    id: invite.id,
    state: invite.state,
    invited_user_id: invite.invited_user_id,
    invited_email: invite.invited_email,
    invited_user_name: invite.invited_user_name || null,
    invited_user_email: invite.invited_user_email || null,
    created_at: invite.created_at,
    accepted_at: invite.accepted_at,
    revoked_at: invite.revoked_at,
  };
}

function serializeShareUserForMcp(user: { id: string; email: string | null; name: string | null }): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function publicInviteUrl(baseUrl: string, inviteId: string): string {
  return `${baseUrl}/login?invite_id=${encodeURIComponent(inviteId)}`;
}

function serializeWorkspaceForMcp(workspace: WorkspaceRecord): Record<string, unknown> {
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    plan: workspace.plan,
    created_at: workspace.created_at,
  };
}

function triggerAppSlug(appId: string): string | undefined {
  const row = db.prepare('SELECT slug FROM apps WHERE id = ?').get(appId) as
    | { slug: string }
    | undefined;
  return row?.slug;
}

function buildWebhookUrl(baseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${baseUrl}/hook/${path}`;
}

function hashFeedbackIp(c: Context): string {
  const raw =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  const salt = process.env.FLOOM_FEEDBACK_SALT || 'floom-feedback-v1';
  return createHash('sha256').update(`${salt}:${raw}`).digest('hex').slice(0, 32);
}

function createAgentMcpServer(c: Context, ctx: SessionContext): McpServer {
  const server = new McpServer({
    name: 'floom-agent',
    version: '0.6.0',
  });

  if (ctx.agent_token_id) {
    server.registerTool(
      'feedback_submit',
      {
        title: 'Submit product feedback',
        description:
          'Submit product feedback from a headless agent. Stores the feedback with the current workspace/user context.',
        inputSchema: {
          text: z.string().min(1).max(4000),
          email: z.string().email().max(320).optional(),
          url: z.string().max(2000).optional(),
        },
      },
      async ({ text, email, url }) => {
        recordMcpToolCall('feedback_submit');
        try {
          const id = `fb_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          db.prepare(
            `INSERT INTO feedback
               (id, workspace_id, user_id, device_id, email, url, text, ip_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            ctx.workspace_id || null,
            ctx.user_id || null,
            ctx.device_id || null,
            email || null,
            url || null,
            text,
            hashFeedbackIp(c),
          );
          return mcpJson({ ok: true, id });
        } catch (err) {
          return mcpError(err);
        }
      },
    );
  }

  if (canUseRunTools(ctx)) {
    server.registerTool(
      'discover_apps',
      {
        title: 'Discover Floom apps',
        description:
          'List apps this agent token can discover. Returns public live apps plus apps owned by the token user.',
        inputSchema: {
          category: z.string().max(48).optional(),
          q: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
        },
      },
      async ({ category, q, limit, cursor }) => {
        recordMcpToolCall('discover_apps');
        try {
          requireRunScope(ctx);
          return mcpJson(discoverApps(c, ctx, { category, q, limit, cursor }));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_app_skill',
      {
        title: 'Get app skill',
        description:
          'Return the markdown skill text for one accessible app, wrapped in an MCP tool result.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('get_app_skill');
        try {
          requireRunScope(ctx);
          return mcpJson(getAppSkill(c, ctx, slug));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_app_details',
      {
        title: 'Get app details',
        description:
          'Return app-page data for one accessible app: about metadata, actions, install endpoints, source/spec links, review summary, and limits.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          link_key: z.string().min(1).max(512).optional(),
        },
      },
      async ({ slug, link_key }) => {
        recordMcpToolCall('get_app_details');
        try {
          requireRunScope(ctx);
          const app = loadAccessibleAgentApp(ctx, slug, link_key);
          return mcpJson(serializeAgentAppDetail(app, getPublicBaseUrl(c)));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_app_about',
      {
        title: 'Get app About content',
        description:
          'Return the readme/About-tab content for an accessible app: long-form description (markdown), license, source URL, runtime, and manifest version. The same fields the public /p/:slug About tab renders.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          link_key: z.string().min(1).max(512).optional(),
        },
      },
      async ({ slug, link_key }) => {
        recordMcpToolCall('get_app_about');
        try {
          requireRunScope(ctx);
          const app = loadAccessibleAgentApp(ctx, slug, link_key);
          const manifest = safeParseManifest(app.manifest);
          const baseUrl = getPublicBaseUrl(c);
          const source = buildAppSourceInfo(app, manifest, baseUrl);
          const readmeRaw = (app.description ?? '').trim();
          const manifestReadme = manifest as unknown as { readme_md?: unknown } | null;
          const readmeMd =
            manifestReadme && typeof manifestReadme.readme_md === 'string' && manifestReadme.readme_md.trim()
              ? manifestReadme.readme_md
              : readmeRaw || null;
          const payload: Record<string, unknown> = {
            slug: app.slug,
            name: app.name,
            description: app.description,
            readme_md: readmeMd,
            license: manifest?.license ?? null,
            repo_url: source.repository_url,
            runtime: manifest?.runtime ?? null,
            manifest_version: manifest?.manifest_version ?? null,
            permalink: `${baseUrl}/p/${app.slug}`,
          };
          if (!readmeMd) {
            payload.note = 'README not available — see repo_url for project docs.';
          }
          return mcpJson(payload);
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_app_source',
      {
        title: 'Get app source',
        description:
          'Return repository, manifest summary, raw OpenAPI URL, self-host command, and install endpoints for an accessible app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          link_key: z.string().min(1).max(512).optional(),
          include_openapi_spec: z.boolean().optional(),
        },
      },
      async ({ slug, link_key, include_openapi_spec }) => {
        recordMcpToolCall('get_app_source');
        try {
          requireRunScope(ctx);
          const app = loadAccessibleAgentApp(ctx, slug, link_key);
          const payload: Record<string, unknown> = {
            source: buildAppSourceInfo(app, safeParseManifest(app.manifest), getPublicBaseUrl(c)),
          };
          if (include_openapi_spec) {
            payload.openapi_spec = app.openapi_spec_cached ? JSON.parse(app.openapi_spec_cached) : null;
          }
          return mcpJson(payload);
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'list_app_reviews',
      {
        title: 'List app reviews',
        description:
          'Return public review summary and recent reviews for an accessible app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          link_key: z.string().min(1).max(512).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        },
      },
      async ({ slug, link_key, limit }) => {
        recordMcpToolCall('list_app_reviews');
        try {
          requireRunScope(ctx);
          loadAccessibleAgentApp(ctx, slug, link_key);
          return mcpJson(getReviewBundle(slug, limit ?? 20));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'run_app',
      {
        title: 'Run app',
        description:
          'Run a Floom app through the same runner path as POST /api/run. read tokens can run public live apps; read-write tokens can also run owned private apps.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          action: z.string().min(1).max(120).optional(),
          inputs: z.record(z.unknown()).optional(),
        },
      },
      async ({ slug, action, inputs }) => {
        recordMcpToolCall('run_app');
        try {
          requireRunScope(ctx);
          return mcpJson(
            await runApp(c, ctx, {
              slug,
              action,
              inputs: inputs as Record<string, unknown> | undefined,
            }),
          );
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_run',
      {
        title: 'Get run',
        description:
          'Fetch a previous run by id when this token user owns it, or when the run has been explicitly shared from a public live app.',
        inputSchema: {
          run_id: z.string().min(1).max(128),
        },
      },
      async ({ run_id }) => {
        recordMcpToolCall('get_run');
        try {
          requireRunScope(ctx);
          return mcpJson(getAgentRun(ctx, run_id));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'list_my_runs',
      {
        title: 'List my runs',
        description:
          'Paginated run history for runs performed by this token user.',
        inputSchema: {
          slug: z.string().min(1).max(48).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
          since_ts: z.string().optional(),
        },
      },
      async ({ slug, limit, cursor, since_ts }) => {
        recordMcpToolCall('list_my_runs');
        try {
          requireRunScope(ctx);
          return mcpJson(listMyRuns(ctx, { slug, limit, cursor, since_ts }));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    if (canUseAccountTools(ctx)) {
      server.registerTool(
        'share_run',
        {
          title: 'Share run',
          description:
            'Make one owned run publicly viewable through the redacted /r/:id output page.',
          inputSchema: {
            run_id: z.string().min(1).max(128),
          },
        },
        async ({ run_id }) => {
          recordMcpToolCall('share_run');
          try {
            const run = loadOwnedRun(ctx, run_id);
            const app = db.prepare('SELECT slug FROM apps WHERE id = ?').get(run.app_id) as
              | { slug: string }
              | undefined;
            db.prepare(`UPDATE runs SET is_public = 1 WHERE id = ?`).run(run.id);
            const encodedRunId = encodeURIComponent(run.id);
            return mcpJson({
              ok: true,
              run_id: run.id,
              is_public: true,
              app_slug: app?.slug ?? null,
              share_url: `${getPublicBaseUrl(c)}/r/${encodedRunId}`,
              public_view_url: `${getPublicBaseUrl(c)}/api/run/${encodedRunId}`,
            });
          } catch (err) {
            return mcpError(err);
          }
        },
      );

      server.registerTool(
        'delete_run',
        {
          title: 'Delete run',
          description: 'Delete one owned run from this workspace.',
          inputSchema: {
            run_id: z.string().min(1).max(128),
          },
        },
        async ({ run_id }) => {
          recordMcpToolCall('delete_run');
          try {
            const result = deleteRunForOwner(ctx, run_id);
            return mcpJson({ ok: true, run_id, ...result });
          } catch (err) {
            if (err instanceof RunDeleteNotFoundError) {
              return mcpError(new AgentToolError('not_found', 'Run not found.', 404));
            }
            if (err instanceof RunDeleteForbiddenError) {
              return mcpError(new AgentToolError('forbidden_scope', 'Forbidden.', 403));
            }
            return mcpError(err);
          }
        },
      );
    }

    server.registerTool(
      'create_job',
      {
        title: 'Create async job',
        description:
          'Queue an async app job through the same validation path as POST /api/:slug/jobs.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          action: z.string().min(1).max(120).optional(),
          inputs: z.record(z.unknown()).optional(),
          webhook_url: z.string().url().max(2048).optional(),
          timeout_ms: z.number().int().min(1).max(24 * 60 * 60 * 1000).optional(),
          max_retries: z.number().int().min(0).max(10).optional(),
          _auth: z.record(z.string()).optional(),
        },
      },
      async ({ slug, action, inputs, webhook_url, timeout_ms, max_retries, _auth }) => {
        recordMcpToolCall('create_job');
        try {
          requireRunScope(ctx);
          const gate = runGate(c, ctx, { slug });
          if (!gate.ok) {
            throw new AgentToolError(
              'rate_limit_exceeded',
              typeof gate.body.error === 'string' ? gate.body.error : 'Run gate rejected this job.',
              gate.status,
              gate.body,
            );
          }
          const app = loadAccessibleAgentApp(ctx, slug);
          if (!app.is_async) {
            throw new AgentToolError(
              'invalid_input',
              `App ${slug} is not async. Use run_app instead.`,
              400,
            );
          }
          const manifest = parseStudioManifest(app);
          const actionNames = Object.keys(manifest.actions);
          const actionName = action || (manifest.actions.run ? 'run' : actionNames[0]);
          const actionSpec = manifest.actions[actionName];
          if (!actionSpec) {
            throw new AgentToolError(
              'invalid_input',
              `Action "${actionName}" not found.`,
              400,
              { valid_actions: actionNames },
            );
          }
          let validated: Record<string, unknown>;
          try {
            validated = validateInputs(actionSpec, (inputs as Record<string, unknown>) ?? {});
          } catch (err) {
            const e = err as ManifestError;
            throw new AgentToolError('invalid_input', e.message, 400, { field: e.field });
          }
          const jobId = newJobId();
          const job = createJob(jobId, {
            app,
            action: actionName,
            inputs: validated,
            workspaceId: ctx.workspace_id,
            userId: ctx.user_id,
            deviceId: ctx.device_id,
            webhookUrlOverride: webhook_url || null,
            timeoutMsOverride: timeout_ms ?? null,
            maxRetriesOverride: max_retries ?? null,
            perCallSecrets: _auth || null,
          });
          return mcpJson({
            ok: true,
            job: formatJob(job),
            job_id: job.id,
            status: job.status,
            slug: job.slug,
            action: job.action,
            ...mcpJobUrls(getPublicBaseUrl(c), slug, job.id),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'get_job',
      {
        title: 'Get async job',
        description: 'Return the current state of one owned async job.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          job_id: z.string().min(1).max(128),
        },
      },
      async ({ slug, job_id }) => {
        recordMcpToolCall('get_job');
        try {
          requireRunScope(ctx);
          loadAccessibleAgentApp(ctx, slug);
          const job = ensureOwnedJob(ctx, slug, job_id);
          return mcpJson({
            ...formatJob(job),
            ...mcpJobUrls(getPublicBaseUrl(c), slug, job.id),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    if (canUseAccountTools(ctx)) {
      server.registerTool(
        'cancel_job',
        {
          title: 'Cancel async job',
          description: 'Cancel one queued or running owned async job.',
          inputSchema: {
            slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
            job_id: z.string().min(1).max(128),
          },
        },
        async ({ slug, job_id }) => {
          recordMcpToolCall('cancel_job');
          try {
            loadAccessibleAgentApp(ctx, slug);
            const job = ensureOwnedJob(ctx, slug, job_id);
            const updated = cancelJob(job.id) || job;
            return mcpJson({
              ...formatJob(updated),
              ...mcpJobUrls(getPublicBaseUrl(c), slug, job.id),
            });
          } catch (err) {
            return mcpError(err);
          }
        },
      );
    }

    server.registerTool(
      'get_app_quota',
      {
        title: 'Get app quota',
        description:
          'Return the same read-only BYOK/free-run quota counter shown on the app page.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('get_app_quota');
        try {
          requireRunScope(ctx);
          loadAccessibleAgentApp(ctx, slug);
          if (!isByokGated(slug)) {
            return mcpJson({
              gated: false,
              byok_required: false,
              slug,
              rate_limit: { enforced: false },
            });
          }
          const decision = decideByok(
            extractIp(c),
            slug,
            extractUserApiKey(c) !== null,
            undefined,
            hashUserAgent(c.req.header('user-agent')),
          );
          return mcpJson({
            gated: true,
            byok_required: true,
            slug,
            usage: decision.usage,
            limit: decision.limit,
            remaining: Math.max(0, decision.limit - decision.usage),
            window_ms: 24 * 60 * 60 * 1000,
            has_user_key_hint: extractUserApiKey(c) !== null,
            rate_limit: {
              enforced: true,
              usage: decision.usage,
              limit: decision.limit,
              remaining: Math.max(0, decision.limit - decision.usage),
              window_ms: 24 * 60 * 60 * 1000,
            },
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );
  }

  if (canUseAccountTools(ctx)) {
    server.registerTool(
      'submit_app_review',
      {
        title: 'Submit app review',
        description:
          'Create or update this token user\'s review for an accessible app. One review per user/workspace/app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          rating: z.number().int().min(1).max(5),
          title: z.string().max(120).optional(),
          body: z.string().max(4000).optional(),
          link_key: z.string().min(1).max(512).optional(),
        },
      },
      async ({ slug, rating, title, body, link_key }) => {
        recordMcpToolCall('submit_app_review');
        try {
          requireAccountScope(ctx);
          loadAccessibleAgentApp(ctx, slug, link_key);
          const now = new Date().toISOString();
          const existing = db
            .prepare(
              `SELECT id FROM app_reviews
                WHERE workspace_id = ? AND app_slug = ? AND user_id = ?`,
            )
            .get(ctx.workspace_id, slug, ctx.user_id) as { id: string } | undefined;
          const id = existing?.id || `rev_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          if (existing) {
            db.prepare(
              `UPDATE app_reviews
                  SET rating = ?, title = ?, body = ?, updated_at = ?
                WHERE id = ?`,
            ).run(rating, title ?? null, body ?? null, now, id);
          } else {
            db.prepare(
              `INSERT INTO app_reviews
                (id, workspace_id, app_slug, user_id, rating, title, body, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(id, ctx.workspace_id, slug, ctx.user_id, rating, title ?? null, body ?? null, now, now);
          }
          const review = db.prepare(`SELECT * FROM app_reviews WHERE id = ?`).get(id) as AppReviewRecord;
          return mcpJson({
            ok: true,
            created: !existing,
            review: serializeReviewForMcp({
              ...review,
              author_email: ctx.email ?? null,
              author_name: null,
            }),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    // Spec-aligned wrapper around submit_app_review using the wording the
    // public page uses ("leave a review") and a single `comment` field instead
    // of separate title/body. Same persistence path: upsert one row per
    // workspace/app/user. Returns the review id (or 409 conflict-equivalent
    // shape if the underlying upsert reports an existing review).
    server.registerTool(
      'leave_app_review',
      {
        title: 'Leave app review',
        description:
          'Leave a review on an accessible app. One review per user/workspace/app — re-submitting overwrites and surfaces `created: false` so the caller can detect the conflict.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          rating: z.number().int().min(1).max(5),
          comment: z.string().max(2000).optional(),
          link_key: z.string().min(1).max(512).optional(),
        },
      },
      async ({ slug, rating, comment, link_key }) => {
        recordMcpToolCall('leave_app_review');
        try {
          requireAccountScope(ctx);
          loadAccessibleAgentApp(ctx, slug, link_key);
          const now = new Date().toISOString();
          const existing = db
            .prepare(
              `SELECT id FROM app_reviews
                WHERE workspace_id = ? AND app_slug = ? AND user_id = ?`,
            )
            .get(ctx.workspace_id, slug, ctx.user_id) as { id: string } | undefined;
          const id = existing?.id || `rev_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          if (existing) {
            db.prepare(
              `UPDATE app_reviews
                  SET rating = ?, body = ?, updated_at = ?
                WHERE id = ?`,
            ).run(rating, comment ?? null, now, id);
          } else {
            db.prepare(
              `INSERT INTO app_reviews
                (id, workspace_id, app_slug, user_id, rating, title, body, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(id, ctx.workspace_id, slug, ctx.user_id, rating, null, comment ?? null, now, now);
          }
          const review = db.prepare(`SELECT * FROM app_reviews WHERE id = ?`).get(id) as AppReviewRecord;
          return mcpJson({
            ok: true,
            created: !existing,
            review_id: id,
            review: serializeReviewForMcp({
              ...review,
              author_email: ctx.email ?? null,
              author_name: null,
            }),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );
  }

  if (canUseStudioTools(ctx)) {
    const ip = extractIp(c);
    const baseUrl = getPublicBaseUrl(c);

    server.registerTool(
      'studio_publish_app',
      {
        title: 'Publish app',
        description:
          'Create or update a Floom app from an OpenAPI URL, inline OpenAPI spec, or gated Docker image reference. Returns the slug, public page, MCP URL, and review status.',
        inputSchema: {
          openapi_url: z.string().url().max(2048).optional(),
          openapi_spec: z.record(z.unknown()).optional(),
          docker_image_ref: z.string().min(1).max(512).optional(),
          manifest: z.record(z.unknown()).optional(),
          secret_bindings: z.record(z.string()).optional(),
          name: z.string().min(1).max(120).optional(),
          description: z.string().max(5000).optional(),
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
          category: z.string().max(48).optional(),
          visibility: z.enum(['public', 'private', 'link', 'auth-required']).optional(),
          link_share_requires_auth: z.boolean().optional(),
          auth_required: z.boolean().optional(),
          max_run_retention_days: z.number().int().min(1).max(3650).optional(),
        },
      },
      async (args) => {
        recordMcpToolCall('studio_publish_app');
        try {
          requireStudioScope(ctx);
          const limit = checkMcpIngestLimit(ctx, ip);
          if (!limit.allowed) {
            throw new AgentToolError(
              'rate_limit_exceeded',
              'studio_publish_app is limited to 10 calls per user per day. Retry after the window resets.',
              429,
              {
                scope: 'mcp_ingest',
                retry_after_seconds: limit.retryAfterSec,
              },
            );
          }

          const openapi_url = typeof args.openapi_url === 'string' ? args.openapi_url : undefined;
          const openapi_spec = args.openapi_spec as Record<string, unknown> | undefined;
          const docker_image_ref =
            typeof args.docker_image_ref === 'string' ? args.docker_image_ref : undefined;
          const modes = [openapi_url, openapi_spec, docker_image_ref].filter(Boolean).length;
          if (modes === 0) {
            throw new AgentToolError(
              'invalid_input',
              'Supply one of: openapi_url, openapi_spec, docker_image_ref.',
              400,
            );
          }
          if (modes > 1) {
            throw new AgentToolError(
              'invalid_input',
              'Supply exactly one of: openapi_url, openapi_spec, docker_image_ref.',
              400,
            );
          }
          if (docker_image_ref && !isDockerPublishEnabled()) {
            throw new AgentToolError(
              'runtime_error',
              `Docker-image ingest is disabled on this Floom instance. Set ${DOCKER_PUBLISH_FLAG}=true to enable.`,
              403,
              { error: 'docker_publish_disabled' },
            );
          }

          const common = {
            name: args.name as string | undefined,
            description: args.description as string | undefined,
            slug: args.slug as string | undefined,
            category: args.category as string | undefined,
            max_run_retention_days:
              args.max_run_retention_days as number | undefined,
            workspace_id: ctx.workspace_id,
            author_user_id: ctx.user_id,
            actor_token_id: ctx.agent_token_id,
            actor_ip: ip,
          };
          let result: { slug: string; name: string; created: boolean };
          if (docker_image_ref) {
            result = await ingestAppFromDockerImage({
              ...common,
              docker_image_ref,
              manifest: args.manifest,
              secret_bindings: args.secret_bindings as Record<string, string> | undefined,
              visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
              link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
              auth_required: args.auth_required as boolean | undefined,
              ctx,
            });
          } else if (openapi_url) {
            result = await ingestAppFromUrl({
              ...common,
              openapi_url,
              visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
              link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
              auth_required: args.auth_required as boolean | undefined,
              allowPrivateNetwork:
                ctx.workspace_id === 'local' && ctx.user_id === 'local',
            });
          } else {
            result = await ingestAppFromSpec({
              ...common,
              spec: openapi_spec as Parameters<typeof ingestAppFromSpec>[0]['spec'],
              visibility: args.visibility as 'public' | 'private' | 'link' | 'auth-required' | undefined,
              link_share_requires_auth: args.link_share_requires_auth as boolean | undefined,
              auth_required: args.auth_required as boolean | undefined,
            });
          }
          invalidateHubCache();
          return mcpJson({
            ok: true,
            slug: result.slug,
            name: result.name,
            created: result.created,
            publish_status: 'pending_review',
            review_note:
              'New user-published apps are visible to the owner immediately and enter manual review before public Store listing.',
            permalink: `${baseUrl}/p/${result.slug}`,
            mcp_url: `${baseUrl}/mcp/app/${result.slug}`,
            owner_url: `${baseUrl}/studio/${result.slug}`,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_detect_app',
      {
        title: 'Detect app',
        description:
          'Preview the app Floom can create from an inline OpenAPI spec. Use before studio_publish_app when the agent has generated or edited a spec.',
        inputSchema: {
          openapi_spec: z.union([z.record(z.unknown()), z.string().min(1).max(2 * 1024 * 1024)]),
          name: z.string().min(1).max(120).optional(),
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
        },
      },
      async ({ openapi_spec, name, slug }) => {
        recordMcpToolCall('studio_detect_app');
        try {
          requireStudioScope(ctx);
          return mcpJson(await detectAppFromInlineSpec(openapi_spec as never, slug, name));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_ingest_hint',
      {
        title: 'Ingest hint',
        description:
          'Probe the standard OpenAPI filenames in a GitHub repo, then return either the resolved spec URL (status: spec_found, spec_found_url) or a structured recovery shape (status: repo_no_spec) listing every path Floom checked. For non-repo inputs, returns the recovery shape without probing. Pass `spec_found_url` straight to studio_publish_app when present.',
        inputSchema: {
          input_url: z.string().min(1).max(2048),
          attempted: z.array(z.string().max(2048)).max(40).optional(),
        },
      },
      async ({ input_url, attempted }) => {
        recordMcpToolCall('studio_ingest_hint');
        try {
          requireStudioScope(ctx);
          // Use the probing variant so the agent gets a real
          // `spec_found_url` for repos that ship a standard
          // openapi.{yaml,yml,json} or swagger.* on `main`/`master`.
          // Falls back to the same shape `buildIngestHint` returns
          // when the input isn't a GitHub repo.
          return mcpJson(await probeIngestHint({ input_url, attempted, baseUrl }));
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_list_my_apps',
      {
        title: 'List my studio apps',
        description:
          'List apps owned by this token workspace, including private and pending-review apps.',
        inputSchema: {
          limit: z.number().int().min(1).max(200).optional(),
        },
      },
      async ({ limit }) => {
        recordMcpToolCall('studio_list_my_apps');
        try {
          requireStudioScope(ctx);
          const rows = db
            .prepare(
              `SELECT apps.*, (
                 SELECT COUNT(*) FROM runs WHERE runs.app_id = apps.id
               ) AS run_count,
               (
                 SELECT MAX(runs.started_at) FROM runs WHERE runs.app_id = apps.id
               ) AS last_run_at
                 FROM apps
                WHERE apps.workspace_id = ?
                ORDER BY apps.updated_at DESC
                LIMIT ?`,
            )
            .all(ctx.workspace_id, Math.max(1, Math.min(200, Number(limit || 50)))) as Array<
            AppRecord & { run_count: number; last_run_at: string | null }
          >;
          return mcpJson({
            apps: rows.map((row) => ({
              slug: row.slug,
              name: row.name,
              description: row.description,
              status: row.status,
              visibility: row.visibility,
              publish_status: row.publish_status,
              run_count: row.run_count || 0,
              last_run_at: row.last_run_at,
              permalink: `${baseUrl}/p/${row.slug}`,
              mcp_url: `${baseUrl}/mcp/app/${row.slug}`,
              owner_url: `${baseUrl}/studio/${row.slug}`,
            })),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_fork_app',
      {
        title: 'Fork app',
        description:
          'Create a private editable copy of an accessible app. Runs, invites, link tokens, and secrets are not copied.',
        inputSchema: {
          source_slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
          name: z.string().min(1).max(160).optional(),
          link_key: z.string().min(1).max(512).optional(),
        },
      },
      async ({ source_slug, slug, name, link_key }) => {
        recordMcpToolCall('studio_fork_app');
        try {
          requireStudioScope(ctx);
          const result = forkApp(ctx, source_slug, { slug, name, linkToken: link_key });
          invalidateHubCache();
          return mcpJson({
            ok: true,
            slug: result.app.slug,
            source_slug: result.source.slug,
            visibility: canonicalVisibility(result.app.visibility),
            publish_status: result.app.publish_status,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_claim_app',
      {
        title: 'Claim app',
        description:
          'Claim an unowned/local app into this workspace and make it private.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_claim_app');
        try {
          requireStudioScope(ctx);
          const result = claimApp(ctx, slug);
          invalidateHubCache();
          return mcpJson({
            ok: true,
            claimed: true,
            slug: result.app.slug,
            visibility: canonicalVisibility(result.app.visibility),
            workspace_id: result.app.workspace_id,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_install_app',
      {
        title: 'Install app',
        description:
          'Pin a public Store app to this workspace. Installing does not grant edit rights.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_install_app');
        try {
          requireStudioScope(ctx);
          const result = installApp(ctx, slug);
          return mcpJson({ ok: true, installed: true, created: result.installed, slug: result.app.slug });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_uninstall_app',
      {
        title: 'Uninstall app',
        description:
          'Remove a pinned Store app from this workspace. The app itself is not deleted.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_uninstall_app');
        try {
          requireStudioScope(ctx);
          const result = uninstallApp(ctx, slug);
          return mcpJson({ ok: true, removed: result.removed, slug: result.app.slug });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_get_app_rate_limit',
      {
        title: 'Get app rate limit',
        description:
          'Return the creator-configured per-hour run limit for an owned app. null means global default.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_get_app_rate_limit');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          return mcpJson({ slug, run_rate_limit_per_hour: app.run_rate_limit_per_hour ?? null });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_set_app_rate_limit',
      {
        title: 'Set app rate limit',
        description:
          'Set or clear the creator-configured per-hour run limit for an owned app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          run_rate_limit_per_hour: z.union([z.number().int().min(1).max(100_000), z.null()]),
        },
      },
      async ({ slug, run_rate_limit_per_hour }) => {
        recordMcpToolCall('studio_set_app_rate_limit');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          db.prepare(
            `UPDATE apps
                SET run_rate_limit_per_hour = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
          ).run(run_rate_limit_per_hour, app.id);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'app.rate_limit_updated',
            target: { type: 'app', id: app.id },
            before: { run_rate_limit_per_hour: app.run_rate_limit_per_hour ?? null },
            after: { run_rate_limit_per_hour },
            metadata: { slug, via: 'mcp' },
          });
          invalidateHubCache();
          return mcpJson({ ok: true, slug, run_rate_limit_per_hour });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_update_app',
      {
        title: 'Update app settings',
        description:
          'Update mutable owner-controlled app settings that do not affect Store review state.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          primary_action: z.union([z.string().min(1).max(128), z.null()]).optional(),
          run_rate_limit_per_hour: z
            .union([z.number().int().min(1).max(100_000), z.null()])
            .optional(),
        },
      },
      async ({ slug, primary_action, run_rate_limit_per_hour }) => {
        recordMcpToolCall('studio_update_app');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const updates: string[] = [];
          const values: unknown[] = [];
          if (primary_action !== undefined) {
            const manifest = parseStudioManifest(app);
            const previousPrimary =
              'primary_action' in manifest
                ? (manifest as NormalizedManifest & { primary_action?: string }).primary_action || null
                : null;
            if (primary_action === null) {
              delete (manifest as NormalizedManifest & { primary_action?: string }).primary_action;
            } else {
              if (!manifest.actions[primary_action]) {
                throw new AgentToolError(
                  'invalid_input',
                  `primary_action "${primary_action}" is not declared on this app.`,
                  400,
                  { valid_actions: Object.keys(manifest.actions) },
                );
              }
              (manifest as NormalizedManifest & { primary_action?: string }).primary_action =
                primary_action;
            }
            updates.push('manifest = ?');
            values.push(JSON.stringify(manifest));
            auditLog({
              actor: getAuditActor(c, ctx),
              action: 'app.updated',
              target: { type: 'app', id: app.id },
              before: { primary_action: previousPrimary },
              after: { primary_action },
              metadata: { slug, field: 'primary_action', via: 'mcp' },
            });
          }
          if (run_rate_limit_per_hour !== undefined) {
            updates.push('run_rate_limit_per_hour = ?');
            values.push(run_rate_limit_per_hour);
            auditLog({
              actor: getAuditActor(c, ctx),
              action: 'app.updated',
              target: { type: 'app', id: app.id },
              before: { run_rate_limit_per_hour: app.run_rate_limit_per_hour ?? null },
              after: { run_rate_limit_per_hour },
              metadata: { slug, field: 'run_rate_limit_per_hour', via: 'mcp' },
            });
          }
          if (updates.length === 0) {
            throw new AgentToolError('invalid_input', 'No app settings supplied.', 400);
          }
          updates.push("updated_at = datetime('now')");
          values.push(app.id);
          db.prepare(`UPDATE apps SET ${updates.join(', ')} WHERE id = ?`).run(...values);
          invalidateHubCache();
          return mcpJson({
            ok: true,
            slug,
            primary_action: primary_action === undefined ? undefined : primary_action,
            run_rate_limit_per_hour:
              run_rate_limit_per_hour === undefined
                ? app.run_rate_limit_per_hour ?? null
                : run_rate_limit_per_hour,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_delete_app',
      {
        title: 'Delete app',
        description:
          'Delete an app owned by this token workspace. This is destructive and cascades runs/triggers attached to the app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          confirm: z.literal(true).describe('Must be true to confirm deletion.'),
        },
      },
      async ({ slug, confirm }) => {
        recordMcpToolCall('studio_delete_app');
        try {
          requireStudioScope(ctx);
          if (confirm !== true) {
            throw new AgentToolError('invalid_input', 'confirm=true is required.', 400);
          }
          const app = loadOwnedStudioApp(ctx, slug);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'app.deleted',
            target: { type: 'app', id: app.id },
            before: {
              slug: app.slug,
              visibility: app.visibility,
              publish_status: app.publish_status,
              workspace_id: app.workspace_id,
              author: app.author,
            },
            after: null,
            metadata: { slug: app.slug, via: 'mcp' },
          });
          deleteAppRecordById(app.id);
          invalidateHubCache();
          return mcpJson({ ok: true, slug });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_get_app_sharing',
      {
        title: 'Get app sharing',
        description:
          'Return owner-only sharing state for an app, including link token when link sharing is active and invite summaries.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_get_app_sharing');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const visibility = canonicalVisibility(app.visibility);
          return mcpJson({
            slug,
            visibility,
            link_share_token: visibility === 'link' ? app.link_share_token : null,
            link_url:
              visibility === 'link' && app.link_share_token
                ? `${baseUrl}/p/${slug}?key=${app.link_share_token}`
                : null,
            invites: listInvites(app.id).map(serializeInviteForMcp),
            review: {
              submitted_at: app.review_submitted_at,
              decided_at: app.review_decided_at,
              decided_by: app.review_decided_by,
              comment: app.review_comment,
            },
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_set_app_sharing',
      {
        title: 'Set app sharing',
        description:
          'Move an owned app between private, link-shared, and invited sharing states. Public Store listing still goes through review tools.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          state: z.enum(['private', 'link', 'invited']),
          rotate_link_token: z.boolean().optional(),
          comment: z.string().max(5000).optional(),
        },
      },
      async ({ slug, state, rotate_link_token, comment }) => {
        recordMcpToolCall('studio_set_app_sharing');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const current = canonicalVisibility(app.visibility);
          let next = app;
          if (current !== state || (state === 'link' && rotate_link_token)) {
            next = transitionVisibility(app, state, {
              actorUserId: ctx.user_id,
              actorTokenId: ctx.agent_token_id,
              actorIp: ip,
              reason:
                state === 'private'
                  ? current === 'public_live'
                    ? 'owner_unlist'
                    : 'owner_set_private'
                  : state === 'link'
                    ? 'owner_enable_link'
                    : 'owner_set_invited',
              rotateLinkToken: rotate_link_token,
              metadata: comment ? { comment } : undefined,
            });
            invalidateHubCache();
          }
          const visibility = canonicalVisibility(next.visibility);
          return mcpJson({
            ok: true,
            slug,
            visibility,
            link_share_token: visibility === 'link' ? next.link_share_token : null,
            link_url:
              visibility === 'link' && next.link_share_token
                ? `${baseUrl}/p/${slug}?key=${next.link_share_token}`
                : null,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_search_app_share_users',
      {
        title: 'Search app share users',
        description:
          'Search registered users by name or email for owner-only app sharing. Mirrors the Studio sharing user-search endpoint.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          q: z.string().min(1).max(120),
          limit: z.number().int().min(1).max(10).optional(),
        },
      },
      async ({ slug, q, limit }) => {
        recordMcpToolCall('studio_search_app_share_users');
        try {
          requireStudioScope(ctx);
          loadOwnedStudioApp(ctx, slug);
          const needle = q.trim().toLowerCase();
          if (needle.length < 2) return mcpJson({ users: [] });
          const users = db
            .prepare(
              `SELECT id, email, name
                 FROM users
                WHERE LOWER(COALESCE(name, '')) LIKE ?
                   OR LOWER(COALESCE(email, '')) LIKE ?
                ORDER BY name, email
                LIMIT ?`,
            )
            .all(`%${needle}%`, `%${needle}%`, limit || 10) as Array<{
            id: string;
            email: string | null;
            name: string | null;
          }>;
          return mcpJson({ users: users.map(serializeShareUserForMcp) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_invite_app_user',
      {
        title: 'Invite app user',
        description:
          'Invite one registered username or email address to an owned app. Existing users get a pending accept invite; unknown emails get an email invite.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          username: z.string().min(1).max(120).optional(),
          email: z.string().email().max(320).optional(),
        },
      },
      async ({ slug, username, email }) => {
        recordMcpToolCall('studio_invite_app_user');
        try {
          requireStudioScope(ctx);
          if (Boolean(username) === Boolean(email)) {
            throw new AgentToolError(
              'invalid_input',
              'Provide exactly one of username or email.',
              400,
            );
          }
          const app = loadOwnedStudioApp(ctx, slug);
          let invite: AppInviteRow;
          let delivery: Record<string, unknown> | null = null;

          if (username) {
            const user = findUserByUsername(username);
            if (!user) {
              throw new AgentToolError('not_found', 'User not found.', 404, {
                code: 'user_not_found',
              });
            }
            invite = upsertInvite({
              appId: app.id,
              invitedByUserId: ctx.user_id,
              invitedUserId: user.id,
              invitedEmail: user.email,
              state: 'pending_accept',
            });
          } else {
            const normalizedEmail = email!.trim().toLowerCase();
            const user = findUserByEmail(normalizedEmail);
            invite = upsertInvite({
              appId: app.id,
              invitedByUserId: ctx.user_id,
              invitedUserId: user?.id || null,
              invitedEmail: normalizedEmail,
              state: user ? 'pending_accept' : 'pending_email',
            });
            if (!user) {
              const inviter = db
                .prepare(`SELECT name, email FROM users WHERE id = ?`)
                .get(ctx.user_id) as { name: string | null; email: string | null } | undefined;
              const rendered = renderAppInviteEmail({
                appName: app.name,
                inviterName: inviter?.name || inviter?.email || null,
                acceptUrl: publicInviteUrl(baseUrl, invite.id),
              });
              const emailResult = await sendEmail({ to: normalizedEmail, ...rendered });
              delivery = {
                email_sent: emailResult.ok,
                email_delivery: emailResult.id ? { id: emailResult.id } : { reason: emailResult.reason || null },
              };
            }
          }

          let visibility = canonicalVisibility(app.visibility);
          if (visibility === 'private') {
            try {
              const next = transitionVisibility(app, 'invited', {
                actorUserId: ctx.user_id,
                actorTokenId: ctx.agent_token_id,
                actorIp: ip,
                reason: 'owner_set_invited',
                metadata: { invite_id: invite.id },
              });
              invalidateHubCache();
              visibility = canonicalVisibility(next.visibility);
            } catch {
              visibility = canonicalVisibility(app.visibility);
            }
          }

          return mcpJson({
            ok: true,
            slug,
            visibility,
            invite: serializeInviteForMcp(invite),
            ...(delivery || {}),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_revoke_app_invite',
      {
        title: 'Revoke app invite',
        description: 'Revoke one invite for an owned app.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          invite_id: z.string().min(1).max(128),
        },
      },
      async ({ slug, invite_id }) => {
        recordMcpToolCall('studio_revoke_app_invite');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const invite = revokeInvite(invite_id, app.id);
          if (!invite) {
            throw new AgentToolError('not_found', 'Invite not found.', 404);
          }
          return mcpJson({
            ok: true,
            slug,
            invite: serializeInviteForMcp(invite),
            revoked: invite.state === 'revoked',
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_submit_app_review',
      {
        title: 'Submit app for Store review',
        description:
          'Submit an owned private/changed app for public Store review.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_submit_app_review');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const next = transitionVisibility(app, 'pending_review', {
            actorUserId: ctx.user_id,
            actorTokenId: ctx.agent_token_id,
            actorIp: ip,
            reason:
              canonicalVisibility(app.visibility) === 'changes_requested'
                ? 'owner_resubmit_review'
                : 'owner_submit_review',
          });
          invalidateHubCache();
          return mcpJson({ ok: true, slug, visibility: canonicalVisibility(next.visibility) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_withdraw_app_review',
      {
        title: 'Withdraw app review',
        description:
          'Withdraw a pending Store review and return the app to private.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_withdraw_app_review');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const next = transitionVisibility(app, 'private', {
            actorUserId: ctx.user_id,
            actorTokenId: ctx.agent_token_id,
            actorIp: ip,
            reason: 'owner_withdraw_review',
          });
          invalidateHubCache();
          return mcpJson({ ok: true, slug, visibility: canonicalVisibility(next.visibility) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_list_secret_policies',
      {
        title: 'List app secret policies',
        description:
          'List required app secret keys and whether each is supplied by the runner workspace vault or by the app creator.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
        },
      },
      async ({ slug }) => {
        recordMcpToolCall('studio_list_secret_policies');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const manifest = parseStudioManifest(app);
          const explicit = new Map(
            creatorSecrets.listPolicies(app.id).map((policy) => [policy.key, policy]),
          );
          const keys = manifestSecretKeys(manifest);
          return mcpJson({
            slug,
            policies: keys.map((key) => {
              const policy = explicit.get(key);
              return (
                policy || {
                  key,
                  policy: 'user_vault',
                  creator_has_value: creatorSecrets.hasCreatorValue(app.id, key),
                }
              );
            }),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_set_secret_policy',
      {
        title: 'Set app secret policy',
        description:
          'Choose whether a declared app secret key is provided by each runner workspace or by the app creator.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          key: z.string().min(1).max(128),
          policy: z.enum(['user_vault', 'creator_override']),
        },
      },
      async ({ slug, key, policy }) => {
        recordMcpToolCall('studio_set_secret_policy');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const manifest = parseStudioManifest(app);
          const allowed = new Set(manifestSecretKeys(manifest));
          if (!allowed.has(key)) {
            throw new AgentToolError(
              'invalid_input',
              `Key "${key}" is not declared in secrets_needed for this app.`,
              400,
              { valid_keys: Array.from(allowed).sort() },
            );
          }
          const previousPolicy = creatorSecrets.getPolicy(app.id, key);
          creatorSecrets.setPolicy(app.id, key, policy as SecretPolicy);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'secret.policy_updated',
            target: { type: 'secret', id: `${app.id}:${key}` },
            before: { policy: previousPolicy },
            after: { policy },
            metadata: { app_id: app.id, slug: app.slug, key, workspace_id: app.workspace_id },
          });
          return mcpJson({ ok: true, slug, key, policy });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_set_creator_secret',
      {
        title: 'Set app creator secret',
        description:
          'Store a write-only creator-provided secret for an app key whose policy is creator_override.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          key: z.string().min(1).max(128),
          value: z.string().min(1).max(65536),
        },
      },
      async ({ slug, key, value }) => {
        recordMcpToolCall('studio_set_creator_secret');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const manifest = parseStudioManifest(app);
          const allowed = new Set(manifestSecretKeys(manifest));
          if (!allowed.has(key)) {
            throw new AgentToolError(
              'invalid_input',
              `Key "${key}" is not declared in secrets_needed for this app.`,
              400,
              { valid_keys: Array.from(allowed).sort() },
            );
          }
          if (creatorSecrets.getPolicy(app.id, key) !== 'creator_override') {
            throw new AgentToolError(
              'invalid_input',
              'Policy for this key is not creator_override. Call studio_set_secret_policy first.',
              400,
            );
          }
          creatorSecrets.setCreatorSecret(app.id, app.workspace_id || ctx.workspace_id, key, value);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'secret.updated',
            target: { type: 'secret', id: `${app.id}:${key}` },
            before: null,
            after: { key, encrypted: true },
            metadata: { app_id: app.id, slug: app.slug, key, scope: 'creator_secret' },
          });
          return mcpJson({ ok: true, slug, key });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'studio_delete_creator_secret',
      {
        title: 'Delete app creator secret',
        description:
          'Delete a creator-provided app secret value. The value is never returned by MCP.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          key: z.string().min(1).max(128),
        },
      },
      async ({ slug, key }) => {
        recordMcpToolCall('studio_delete_creator_secret');
        try {
          requireStudioScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const removed = creatorSecrets.deleteCreatorSecret(app.id, key);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'secret.deleted',
            target: { type: 'secret', id: `${app.id}:${key}` },
            before: { key, existed: removed },
            after: null,
            metadata: { app_id: app.id, slug: app.slug, key, scope: 'creator_secret' },
          });
          return mcpJson({ ok: true, slug, key, removed });
        } catch (err) {
          return mcpError(err);
        }
      },
    );
  }

  if (canUseContextProfileTools(ctx)) {
    server.registerTool(
      'account_get_context',
      {
        title: 'Get account context profiles',
        description:
          'Return the current user JSON profile and active workspace JSON profile for app input autofill.',
        inputSchema: {},
      },
      async () => {
        recordMcpToolCall('account_get_context');
        try {
          requireContextReadScope(ctx);
          const context = contextProfiles.getContextProfile(ctx);
          return mcpJson({
            user: {
              id: ctx.user_id,
              email: ctx.email || null,
            },
            workspace: {
              ...serializeWorkspaceForMcp(context.workspace),
              role: context.role,
            },
            user_profile: context.user_profile,
            workspace_profile: context.workspace_profile,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );
  }

  if (canUseAccountTools(ctx)) {
    server.registerTool(
      'account_get',
      {
        title: 'Get account context',
        description:
          'Return the current agent-token account context: user id, workspace id, scope, and rate limit.',
        inputSchema: {},
      },
      async () => {
        recordMcpToolCall('account_get');
        try {
          requireAccountScope(ctx);
          return mcpJson({
            user_id: ctx.user_id,
            workspace_id: ctx.workspace_id,
            agent_token_id: ctx.agent_token_id,
            agent_token_scope: ctx.agent_token_scope,
            agent_token_rate_limit_per_minute: ctx.agent_token_rate_limit_per_minute,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'account_set_user_profile',
      {
        title: 'Set user JSON profile',
        description:
          'Merge or replace the current user JSON profile. The profile is used as reusable context for app input autofill.',
        inputSchema: {
          profile: z.record(z.unknown()),
          mode: z.enum(['merge', 'replace']).optional(),
        },
      },
      async ({ profile, mode }) => {
        recordMcpToolCall('account_set_user_profile');
        try {
          requireAccountScope(ctx);
          const userProfile = contextProfiles.setUserProfile(
            ctx,
            profile,
            mode || 'merge',
          );
          return mcpJson({ ok: true, user_profile: userProfile });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'account_set_workspace_profile',
      {
        title: 'Set workspace JSON profile',
        description:
          'Merge or replace a workspace JSON profile. Requires admin role on the target workspace.',
        inputSchema: {
          profile: z.record(z.unknown()),
          mode: z.enum(['merge', 'replace']).optional(),
          workspace_id: z.string().min(1).max(128).optional(),
        },
      },
      async ({ profile, mode, workspace_id }) => {
        recordMcpToolCall('account_set_workspace_profile');
        try {
          requireAccountScope(ctx);
          const result = contextProfiles.setWorkspaceProfile(
            ctx,
            profile,
            mode || 'merge',
            workspace_id || ctx.workspace_id,
          );
          return mcpJson({
            ok: true,
            workspace: serializeWorkspaceForMcp(result.workspace),
            workspace_profile: result.profile,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'account_list_secrets',
      {
        title: 'List workspace BYOK keys',
        description:
          'List masked workspace BYOK/API key names. Secret values are never returned.',
        inputSchema: {},
      },
      async () => {
        recordMcpToolCall('account_list_secrets');
        try {
          requireAccountScope(ctx);
          return mcpJson({ entries: userSecrets.listMasked(ctx) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'trigger_list',
      {
        title: 'List triggers',
        description:
          'List this token user\'s schedule and webhook triggers.',
        inputSchema: {},
      },
      async () => {
        recordMcpToolCall('trigger_list');
        try {
          requireAccountScope(ctx);
          const triggers = listTriggersForWorkspaceUser(
            ctx.workspace_id,
            ctx.user_id,
          ).map((trigger) =>
            serializeTrigger(trigger, { app_slug: triggerAppSlug(trigger.app_id) }),
          );
          return mcpJson({ triggers });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'trigger_create',
      {
        title: 'Create trigger',
        description:
          'Create a schedule or webhook trigger for an app owned by this workspace. Webhook creation returns the plaintext secret once.',
        inputSchema: {
          slug: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/),
          action: z.string().min(1).max(128),
          trigger_type: z.enum(['schedule', 'webhook']),
          cron_expression: z.string().min(1).max(256).optional(),
          tz: z.string().min(1).max(64).optional(),
          inputs: z.record(z.unknown()).optional(),
        },
      },
      async ({ slug, action, trigger_type, cron_expression, tz, inputs }) => {
        recordMcpToolCall('trigger_create');
        try {
          requireAccountScope(ctx);
          const app = loadOwnedStudioApp(ctx, slug);
          const manifest = safeParseManifest(app.manifest);
          if (!manifest?.actions[action]) {
            throw new AgentToolError(
              'invalid_input',
              `Action "${action}" is not declared on this app.`,
              400,
              manifest ? { valid_actions: Object.keys(manifest.actions) } : undefined,
            );
          }
          if (trigger_type === 'schedule') {
            if (!cron_expression) {
              throw new AgentToolError('invalid_input', 'cron_expression is required for schedule triggers.', 400);
            }
            const check = validateCronExpression(cron_expression, tz);
            if (!check.ok) {
              throw new AgentToolError('invalid_input', `Invalid cron expression: ${check.error}`, 400);
            }
          }
          const trigger = createTrigger({
            app_id: app.id,
            user_id: ctx.user_id,
            workspace_id: ctx.workspace_id,
            action,
            inputs: inputs || {},
            trigger_type,
            cron_expression: cron_expression || null,
            tz: tz || null,
          });
          return mcpJson({
            trigger: serializeTrigger(trigger, { app_slug: app.slug }),
            webhook_url: trigger.trigger_type === 'webhook' ? buildWebhookUrl(getPublicBaseUrl(c), trigger.webhook_url_path) : null,
            webhook_secret: trigger.trigger_type === 'webhook' ? trigger.webhook_secret : null,
            webhook_url_path: trigger.webhook_url_path,
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'trigger_update',
      {
        title: 'Update trigger',
        description:
          'Enable/disable or edit an owned trigger. For schedule triggers, cron changes recompute the next run.',
        inputSchema: {
          trigger_id: z.string().min(1).max(128),
          enabled: z.boolean().optional(),
          action: z.string().min(1).max(128).optional(),
          cron_expression: z.string().min(1).max(256).optional(),
          tz: z.string().min(1).max(64).optional(),
          inputs: z.record(z.unknown()).optional(),
        },
      },
      async ({ trigger_id, enabled, action, cron_expression, tz, inputs }) => {
        recordMcpToolCall('trigger_update');
        try {
          requireAccountScope(ctx);
          const existing = getTrigger(trigger_id);
          if (!existing || existing.workspace_id !== ctx.workspace_id || existing.user_id !== ctx.user_id) {
            throw new AgentToolError('not_found', 'Trigger not found.', 404);
          }
          if (action) {
            const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(existing.app_id) as AppRecord | undefined;
            const manifest = app ? safeParseManifest(app.manifest) : null;
            if (!manifest?.actions[action]) {
              throw new AgentToolError(
                'invalid_input',
                `Action "${action}" is not declared on this trigger app.`,
                400,
                manifest ? { valid_actions: Object.keys(manifest.actions) } : undefined,
              );
            }
          }
          const updated = updateTrigger(trigger_id, { enabled, action, cron_expression, tz, inputs });
          if (!updated) throw new AgentToolError('not_found', 'Trigger not found.', 404);
          return mcpJson({ trigger: serializeTrigger(updated, { app_slug: triggerAppSlug(updated.app_id) }) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'trigger_delete',
      {
        title: 'Delete trigger',
        description: 'Delete an owned schedule or webhook trigger.',
        inputSchema: {
          trigger_id: z.string().min(1).max(128),
        },
      },
      async ({ trigger_id }) => {
        recordMcpToolCall('trigger_delete');
        try {
          requireAccountScope(ctx);
          const existing = getTrigger(trigger_id);
          if (!existing || existing.workspace_id !== ctx.workspace_id || existing.user_id !== ctx.user_id) {
            throw new AgentToolError('not_found', 'Trigger not found.', 404);
          }
          return mcpJson({ ok: true, trigger_id, deleted: deleteTrigger(trigger_id) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_get',
      {
        title: 'Get workspace',
        description: 'Return a workspace by id without exposing wrapped encryption material.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
        },
      },
      async ({ workspace_id }) => {
        recordMcpToolCall('workspace_get');
        try {
          requireAccountScope(ctx);
          const workspace = workspaces.getById(ctx, workspace_id);
          return mcpJson({ workspace: serializeWorkspaceForMcp(workspace) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_list',
      {
        title: 'List workspaces',
        description: 'List workspaces this token user belongs to.',
        inputSchema: {},
      },
      async () => {
        recordMcpToolCall('workspace_list');
        try {
          requireAccountScope(ctx);
          return mcpJson({
            workspaces: workspaces.listMine(ctx).map((entry) => ({
              ...serializeWorkspaceForMcp(entry.workspace),
              role: entry.role,
            })),
          });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_create',
      {
        title: 'Create workspace',
        description: 'Create a workspace and make this token user its admin.',
        inputSchema: {
          name: z.string().min(1).max(120),
          slug: z.string().min(1).max(64).optional(),
        },
      },
      async ({ name, slug }) => {
        recordMcpToolCall('workspace_create');
        try {
          requireAccountScope(ctx);
          const workspace = workspaces.create(ctx, { name, slug });
          return mcpJson({ workspace: serializeWorkspaceForMcp(workspace) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_update',
      {
        title: 'Update workspace',
        description: 'Update workspace name and/or slug. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          name: z.string().min(1).max(120).optional(),
          slug: z.string().min(1).max(64).optional(),
        },
      },
      async ({ workspace_id, name, slug }) => {
        recordMcpToolCall('workspace_update');
        try {
          requireAccountScope(ctx);
          if (name === undefined && slug === undefined) {
            throw new AgentToolError('invalid_input', 'Provide name or slug.', 400);
          }
          const workspace = workspaces.update(ctx, workspace_id, { name, slug });
          return mcpJson({ workspace: serializeWorkspaceForMcp(workspace) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_delete',
      {
        title: 'Delete workspace',
        description: 'Delete a workspace. Destructive and admin-only; confirm must be true.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          confirm: z.boolean(),
        },
      },
      async ({ workspace_id, confirm }) => {
        recordMcpToolCall('workspace_delete');
        try {
          requireAccountScope(ctx);
          if (confirm !== true) {
            throw new AgentToolError('invalid_input', 'Set confirm=true to delete a workspace.', 400);
          }
          workspaces.remove(ctx, workspace_id);
          return mcpJson({ ok: true, workspace_id, deleted: true });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_switch',
      {
        title: 'Switch active workspace',
        description:
          'Set the current user active workspace pointer. Existing agent tokens remain bound to the workspace they were minted for.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
        },
      },
      async ({ workspace_id }) => {
        recordMcpToolCall('workspace_switch');
        try {
          requireAccountScope(ctx);
          workspaces.switchActiveWorkspace(ctx, workspace_id);
          return mcpJson({ ok: true, active_workspace_id: workspace_id });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_list_members',
      {
        title: 'List workspace members',
        description: 'List members of a workspace.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
        },
      },
      async ({ workspace_id }) => {
        recordMcpToolCall('workspace_list_members');
        try {
          requireAccountScope(ctx);
          return mcpJson({ members: workspaces.listMembers(ctx, workspace_id) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_set_member_role',
      {
        title: 'Set workspace member role',
        description: 'Change a workspace member role. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          user_id: z.string().min(1).max(160),
          role: z.enum(['admin', 'editor', 'viewer']),
        },
      },
      async ({ workspace_id, user_id, role }) => {
        recordMcpToolCall('workspace_set_member_role');
        try {
          requireAccountScope(ctx);
          const member = workspaces.changeRole(ctx, workspace_id, user_id, role as WorkspaceMemberRole);
          return mcpJson({ member });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_remove_member',
      {
        title: 'Remove workspace member',
        description: 'Remove a workspace member. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          user_id: z.string().min(1).max(160),
        },
      },
      async ({ workspace_id, user_id }) => {
        recordMcpToolCall('workspace_remove_member');
        try {
          requireAccountScope(ctx);
          workspaces.removeMember(ctx, workspace_id, user_id);
          return mcpJson({ ok: true, workspace_id, user_id, removed: true });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_list_invites',
      {
        title: 'List workspace invites',
        description: 'List workspace invites. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
        },
      },
      async ({ workspace_id }) => {
        recordMcpToolCall('workspace_list_invites');
        try {
          requireAccountScope(ctx);
          return mcpJson({ invites: workspaces.listInvites(ctx, workspace_id) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_create_invite',
      {
        title: 'Create workspace invite',
        description: 'Create an email invite for a workspace. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          email: z.string().email().max(320),
          role: z.enum(['admin', 'editor', 'viewer']).optional(),
        },
      },
      async ({ workspace_id, email, role }) => {
        recordMcpToolCall('workspace_create_invite');
        try {
          requireAccountScope(ctx);
          const result = workspaces.inviteByEmail(ctx, workspace_id, email, (role || 'editor') as WorkspaceMemberRole);
          return mcpJson(result);
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_revoke_invite',
      {
        title: 'Revoke workspace invite',
        description: 'Revoke a pending workspace invite. Admin-only.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          invite_id: z.string().min(1).max(128),
        },
      },
      async ({ workspace_id, invite_id }) => {
        recordMcpToolCall('workspace_revoke_invite');
        try {
          requireAccountScope(ctx);
          workspaces.revokeInvite(ctx, workspace_id, invite_id);
          return mcpJson({ ok: true, workspace_id, invite_id, revoked: true });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_accept_invite',
      {
        title: 'Accept workspace invite',
        description: 'Accept a workspace invite token for the current user.',
        inputSchema: {
          token: z.string().min(8).max(128),
        },
      },
      async ({ token }) => {
        recordMcpToolCall('workspace_accept_invite');
        try {
          requireAccountScope(ctx);
          const member = workspaces.acceptInvite(ctx, token);
          return mcpJson({ member });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'workspace_delete_runs',
      {
        title: 'Delete workspace runs',
        description: 'Bulk-delete runs for apps owned by a workspace. Admin-only and destructive; confirm must be true.',
        inputSchema: {
          workspace_id: z.string().min(1).max(128),
          confirm: z.boolean(),
        },
      },
      async ({ workspace_id, confirm }) => {
        recordMcpToolCall('workspace_delete_runs');
        try {
          requireAccountScope(ctx);
          if (confirm !== true) {
            throw new AgentToolError('invalid_input', 'Set confirm=true to delete workspace runs.', 400);
          }
          workspaces.assertRole(ctx, workspace_id, 'admin');
          return mcpJson({ ok: true, workspace_id, ...deleteWorkspaceRuns(ctx, workspace_id) });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'account_set_secret',
      {
        title: 'Set workspace BYOK key',
        description:
          'Set a write-only workspace BYOK/API key. The value is encrypted and never echoed back.',
        inputSchema: {
          key: z.string().min(1).max(128),
          value: z.string().min(1).max(65536),
        },
      },
      async ({ key, value }) => {
        recordMcpToolCall('account_set_secret');
        try {
          requireAccountScope(ctx);
          userSecrets.set(ctx, key, value);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'secret.updated',
            target: { type: 'secret', id: `${ctx.workspace_id}:${key}` },
            before: null,
            after: { key, encrypted: true },
            metadata: { workspace_id: ctx.workspace_id, key, scope: 'workspace_secret' },
          });
          return mcpJson({ ok: true, key });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

    server.registerTool(
      'account_delete_secret',
      {
        title: 'Delete workspace BYOK key',
        description:
          'Delete a workspace BYOK/API key by name.',
        inputSchema: {
          key: z.string().min(1).max(128),
        },
      },
      async ({ key }) => {
        recordMcpToolCall('account_delete_secret');
        try {
          requireAccountScope(ctx);
          const removed = userSecrets.del(ctx, key);
          auditLog({
            actor: getAuditActor(c, ctx),
            action: 'secret.deleted',
            target: { type: 'secret', id: `${ctx.workspace_id}:${key}` },
            before: { key, existed: removed },
            after: null,
            metadata: { workspace_id: ctx.workspace_id, key, scope: 'workspace_secret' },
          });
          return mcpJson({ ok: true, key, removed });
        } catch (err) {
          return mcpError(err);
        }
      },
    );

  }

  return server;
}

function filterMcpToolListPayload(payload: unknown, hiddenToolNames: Set<string>): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const maybeResult = payload as {
    result?: { tools?: Array<{ name?: unknown }> };
  };
  if (Array.isArray(maybeResult.result?.tools)) {
    maybeResult.result.tools = maybeResult.result.tools.filter(
      (tool) => typeof tool.name !== 'string' || !hiddenToolNames.has(tool.name),
    );
  }
  return payload;
}

async function parseMcpInteraction(rawRequest: Request): Promise<{
  method: string | null;
  tool_name: string | null;
  request_id: string | number | null;
}> {
  if (rawRequest.method !== 'POST') {
    return { method: rawRequest.method, tool_name: null, request_id: null };
  }
  try {
    const body = await rawRequest.clone().json() as {
      method?: unknown;
      id?: unknown;
      params?: { name?: unknown };
    };
    return {
      method: typeof body.method === 'string' ? body.method : null,
      tool_name:
        body.method === 'tools/call' && typeof body.params?.name === 'string'
          ? body.params.name
          : null,
      request_id:
        typeof body.id === 'string' || typeof body.id === 'number'
          ? body.id
          : null,
    };
  } catch {
    return { method: null, tool_name: null, request_id: null };
  }
}

async function parseMcpResponse(response: Response): Promise<{
  is_error: boolean | null;
  error_code: string | number | null;
}> {
  try {
    const body = await response.clone().json() as {
      error?: { code?: unknown };
      result?: { isError?: unknown };
    };
    return {
      is_error: Boolean(body.error) || body.result?.isError === true,
      error_code:
        typeof body.error?.code === 'string' || typeof body.error?.code === 'number'
          ? body.error.code
          : null,
    };
  } catch {
    return { is_error: null, error_code: null };
  }
}

async function auditMcpInteraction(
  c: Context,
  ctx: SessionContext,
  surface: string,
  rawRequest: Request,
  request: {
    method: string | null;
    tool_name: string | null;
    request_id: string | number | null;
  },
  response: Response,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const result = await parseMcpResponse(response);
  auditLog({
    actor: getAuditActor(c, ctx),
    action: 'mcp.interaction',
    target: { type: 'mcp', id: request.tool_name || request.method || surface },
    metadata: {
      via: 'mcp',
      surface,
      http_method: rawRequest.method,
      rpc_method: request.method,
      tool_name: request.tool_name,
      request_id: request.request_id,
      status: response.status,
      is_error: result.is_error,
      error_code: result.error_code,
      workspace_id: ctx.workspace_id,
      token_scope: ctx.agent_token_scope || null,
      ...extra,
    },
  });
}

async function handleMcp(
  server: McpServer,
  c: Context,
  ctx: SessionContext,
  surface: string,
  rawRequest: Request,
  options: { hiddenListToolNames?: Set<string> } = {},
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const interaction = await parseMcpInteraction(rawRequest);

  // GH #850 / #856 — The MCP SDK hardcodes a check that the Accept header
  // contains BOTH "application/json" AND "text/event-stream". Standard
  // JSON-RPC clients (curl, Cursor, Claude Desktop in non-streaming mode)
  // only send "Accept: application/json" and get rejected with 406.
  //
  // Fix: if the request is a POST with a JSON body but the Accept header is
  // missing text/event-stream, synthesise a new request that also accepts
  // SSE. The transport honours enableJsonResponse=true and returns plain
  // JSON regardless, so this doesn't change the response format — it just
  // stops the SDK from rejecting well-formed JSON-RPC clients at the gate.
  let request = rawRequest;
  if (rawRequest.method === 'POST') {
    const accept = rawRequest.headers.get('accept') ?? '';
    const needsPatch =
      !accept.includes('text/event-stream') || !accept.includes('application/json');
    if (needsPatch) {
      const patchedHeaders = new Headers(rawRequest.headers);
      // Preserve any existing Accept value and append the two types the SDK
      // requires. Duplicates in the Accept header are harmless per RFC 7231.
      const patched =
        [accept, 'application/json', 'text/event-stream']
          .filter(Boolean)
          .join(', ');
      patchedHeaders.set('accept', patched);
      request = new Request(rawRequest, { headers: patchedHeaders });
    }
  }

  const shouldFilterToolsList = async () => {
    if (!options.hiddenListToolNames || options.hiddenListToolNames.size === 0) return false;
    if (rawRequest.method !== 'POST') return false;
    try {
      const body = await rawRequest.clone().json() as { method?: unknown };
      return body?.method === 'tools/list';
    } catch {
      return false;
    }
  };

  const filterToolsList = await shouldFilterToolsList();
  const response = await transport.handleRequest(request);
  if (!filterToolsList || !options.hiddenListToolNames) {
    await auditMcpInteraction(c, ctx, surface, rawRequest, interaction, response);
    return response;
  }

  try {
    const text = await response.text();
    const json = JSON.parse(text) as unknown;
    filterMcpToolListPayload(json, options.hiddenListToolNames);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    const filteredResponse = new Response(JSON.stringify(json), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await auditMcpInteraction(c, ctx, surface, rawRequest, interaction, filteredResponse, {
      tools_list_filtered: true,
    });
    return filteredResponse;
  } catch {
    await auditMcpInteraction(c, ctx, surface, rawRequest, interaction, response);
    return response;
  }
}

// /mcp — admin surface (ingest_app, list_apps, search_apps, get_app).
// Registered ahead of /app/:slug so Hono does not route a bare /mcp to the
// per-app handler as the empty slug "".
mcpRouter.all('/', async (c: Context) => {
  const ctx = await resolveUserContext(c);
  if (ctx.agent_token_id) {
    return handleMcp(createAgentMcpServer(c, ctx), c, ctx, 'agent', c.req.raw, {
      hiddenListToolNames:
        ctx.agent_token_scope === 'publish-only' ? PUBLISH_ONLY_HIDDEN_TOOL_NAMES : undefined,
    });
  }
  const ip = extractIp(c);
  const baseUrl = getPublicBaseUrl(c);
  const server = createAdminMcpServer({ ctx, ip, baseUrl });
  return handleMcp(server, c, ctx, 'admin', c.req.raw);
});

// /mcp/search — gallery-wide search
mcpRouter.all('/search', async (c) => {
  const ctx = await resolveUserContext(c);
  const baseUrl = getPublicBaseUrl(c);
  const server = createSearchMcpServer(baseUrl);
  return handleMcp(server, c, ctx, 'search', c.req.raw);
});

// /mcp/app/:slug — per-app MCP
mcpRouter.all('/app/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as AppRecord | undefined;
  if (!row) {
    // Wrap unknown-app errors in a JSON-RPC envelope so MCP clients see a
    // protocol-level error, not a bare HTTP 404. Return 200 per JSON-RPC
    // convention — the error is in the envelope.
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: `App not found: ${slug}` },
        id: null,
      },
      200,
    );
  }
  const ctx = await resolveUserContext(c);
  const blocked = checkAppVisibility(c, row.visibility || 'public', {
    app_id: row.id,
    slug: row.slug,
    author: row.author,
    workspace_id: row.workspace_id,
    link_share_token: row.link_share_token,
    link_share_requires_auth: row.link_share_requires_auth,
    ctx,
  });
  if (blocked) return blocked;
  // Reuse the ctx we already resolved for the visibility check. The MCP
  // tool handler forwards it to dispatchRun so per-user vault secrets
  // reach the runner, matching POST /api/run + POST /api/:slug/run.
  const server = createPerAppMcpServer(c, row, ctx);
  return handleMcp(server, c, ctx, 'app', c.req.raw, { hiddenListToolNames: undefined });
});
