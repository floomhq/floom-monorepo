import { Hono } from 'hono';
import { SERVER_VERSION } from '../lib/server-version.js';
import { db } from '../db.js';
import { noteHealthStatus } from '../lib/alerts.js';

export const healthRouter = new Hono();

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
