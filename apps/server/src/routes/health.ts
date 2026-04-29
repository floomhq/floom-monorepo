import { Hono } from 'hono';
import { SERVER_VERSION } from '../lib/server-version.js';
import { db } from '../db.js';
import { noteHealthStatus } from '../lib/alerts.js';
import { isDeployEnabled } from '../services/workspaces.js';
import { getFastAppsStatus } from '../services/fast-apps-sidecar.js';
import { getLaunchWeekStatus } from '../services/launch-week-sidecars.js';

export const healthRouter = new Hono();

// GH #852 — /healthz: machine-readable health probe. Exposed via
// app.route('/api/healthz', healthzRouter) in index.ts (separate mount so
// the path resolves to /api/healthz, not /api/health/z).
export const healthzRouter = new Hono();
healthzRouter.get('/', (c) => {
  return c.json({
    ok: true,
    deploy_enabled: isDeployEnabled(),
    uptime_seconds: Math.floor(process.uptime()),
    version: process.env.FLOOM_VERSION || SERVER_VERSION || 'dev',
  });
});

healthRouter.get('/', (c) => {
  try {
    const appCount = (db.prepare('SELECT COUNT(*) as c FROM apps').get() as {
      c: number;
    }).c;
    const threadCount = (db.prepare('SELECT COUNT(*) as c FROM run_threads').get() as {
      c: number;
    }).c;
    noteHealthStatus(200, 'ok');
    return c.json({
      status: 'ok',
      service: 'floom-chat',
      version: SERVER_VERSION,
      apps: appCount,
      threads: threadCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    noteHealthStatus(500, message);
    console.error('[health] failed:', err);
    return c.json(
      {
        status: 'error',
        error: 'internal_server_error',
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// GET /api/health/sidecars — fast-apps + launch-week sidecar liveness.
// Returns 200 when all expected sidecars are alive, 503 when degraded so
// uptime monitors can alert. Powers post-launch observability after the
// AX41 OOM event 2026-04-29 left sidecars dead with no surface signal.
healthRouter.get('/sidecars', (c) => {
  const fastApps = getFastAppsStatus();
  const launchWeek = getLaunchWeekStatus();
  const fastAppsHealthy = !fastApps.enabled || fastApps.alive;
  const launchWeekHealthy =
    !launchWeek.enabled || launchWeek.dead.length === 0;
  const ok = fastAppsHealthy && launchWeekHealthy;
  return c.json(
    {
      status: ok ? 'ok' : 'degraded',
      fast_apps: fastApps,
      launch_week: launchWeek,
      timestamp: new Date().toISOString(),
    },
    ok ? 200 : 503,
  );
});
