import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { deployFromGithub, getDefaultProvider } from '@floom/runtime';

import { db, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID } from '../db.js';
import { requireAuthenticatedInCloud } from '../lib/auth.js';
import { resolveUserContext } from '../services/session.js';
import { getOrCreateStream } from '../lib/log-stream.js';
import { isCloudMode } from '../lib/better-auth.js';
import { parseGithubWebUrl } from '../services/openapi-ingest.js';

export const deployRouter = new Hono();

const DeployBody = z.object({
  repo_url: z.string().url(),
  ref: z.string().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  visibility: z.enum(['public', 'private', 'link']).optional(),
});

const DAILY_BUILD_LIMIT = 5;

/**
 * POST /api/deploy/deploy-github
 * Starts a repo-to-hosted deployment pipeline.
 * Returns { build_id } immediately.
 */
deployRouter.post('/deploy-github', async (c) => {
  const ctx = await resolveUserContext(c);
  const gate = requireAuthenticatedInCloud(c, ctx);
  if (gate) return gate;

  const body = await c.req.json().catch(() => ({}));
  const parsed = DeployBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.flatten() }, 400);
  }

  const userId = ctx.user_id || DEFAULT_USER_ID;
  const workspaceId = ctx.workspace_id || DEFAULT_WORKSPACE_ID;

  // Quota check: Daily Build Limit (abuse protection)
  if (isCloudMode()) {
    const dailyCount = db
      .prepare(
        "SELECT COUNT(*) as count FROM builds WHERE user_id = ? AND started_at > datetime('now', '-1 day')",
      )
      .get(userId) as { count: number };

    if (dailyCount.count >= DAILY_BUILD_LIMIT) {
      return c.json(
        {
          error: `Daily build limit reached (${DAILY_BUILD_LIMIT} builds/day).`,
          code: 'quota_exceeded',
        },
        429,
      );
    }
  }

  // Generate a unique build_id (reusing the builds table pattern)
  const buildId = `build_${Math.random().toString(36).slice(2, 11)}`;

  // Parse owner/name for the builds table. Gracefully falls back to empty
  // strings if the URL can't be parsed (Zod already verified it's a URL).
  let repoOwner = '';
  let repoName = '';
  try {
    const ref = parseGithubWebUrl(parsed.data.repo_url);
    if (ref) {
      repoOwner = ref.owner;
      repoName = ref.repo;
    }
  } catch { /* leave empty; runtime will parse again during build */ }

  // Create an entry in the builds table
  db.prepare(
    `INSERT INTO builds (
      build_id, github_url, repo_owner, repo_name, branch,
      workspace_id, user_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'cloning')`,
  ).run(
    buildId,
    parsed.data.repo_url,
    repoOwner,
    repoName,
    parsed.data.ref || 'main',
    workspaceId,
    userId,
  );

  // Background deployment
  const logStream = getOrCreateStream(buildId);
  const provider = getDefaultProvider();

  void (async () => {
    try {
      const result = await deployFromGithub(parsed.data.repo_url, {
        provider,
        ref: parsed.data.ref,
        onLog: (chunk: string) => {
          logStream.append(chunk, 'stdout');
        },
      });

      if (result.success) {
        db.prepare(
          "UPDATE builds SET status = 'published', docker_image = ?, completed_at = datetime('now') WHERE build_id = ?",
        ).run(result.artifactId, buildId);
        logStream.finish();
      } else {
        db.prepare(
          "UPDATE builds SET status = 'error', error = ?, completed_at = datetime('now') WHERE build_id = ?",
        ).run(result.error, buildId);
        logStream.append(`\nERROR: ${result.error}`, 'stderr');
        logStream.finish();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare(
        "UPDATE builds SET status = 'error', error = ?, completed_at = datetime('now') WHERE build_id = ?",
      ).run(msg, buildId);
      logStream.append(`\nFATAL ERROR: ${msg}`, 'stderr');
      logStream.finish();
    }
  })();

  return c.json({ deployment_id: buildId, status: 'cloning' });
});

/**
 * GET /api/deploy/:id/logs
 * SSE stream for real-time build logs.
 */
deployRouter.get('/:id/logs', async (c) => {
  const buildId = c.req.param('id');
  const build = db.prepare('SELECT * FROM builds WHERE build_id = ?').get(buildId) as any;
  if (!build) return c.json({ error: 'Build not found' }, 404);

  // Ownership check (simplified for now, matching run.ts logic)
  const ctx = await resolveUserContext(c);
  if (isCloudMode() && build.user_id !== ctx.user_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return streamSSE(c, async (stream) => {
    const logStream = getOrCreateStream(buildId);
    let done = false;

    const send = async (event: string, data: unknown) => {
      await stream.writeSSE({
        event,
        data: JSON.stringify(data),
      });
    };

    const handle = logStream.subscribe(
      async (line) => {
        if (done) return;
        try {
          await send('log', { stream: line.stream, text: line.text, ts: line.ts });
        } catch {
          // disconnect
        }
      },
      async () => {
        done = true;
      },
    );

    // Replay history
    for (const line of handle.history) {
      await send('log', { stream: line.stream, text: line.text, ts: line.ts });
    }

    if (handle.done) {
      handle.unsubscribe();
      return;
    }

    // Wait for finish or disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        done = true;
        handle.unsubscribe();
        resolve();
      });
      
      const checkDone = setInterval(() => {
        if (done) {
          clearInterval(checkDone);
          resolve();
        }
      }, 1000);
    });
  });
});
