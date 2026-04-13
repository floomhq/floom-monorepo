import { Hono } from 'hono';
import { db } from '../db.js';

export const deployWaitlistRouter = new Hono();

// Ensure the table exists (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS deploy_waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    spec_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

deployWaitlistRouter.post('/', async (c) => {
  let body: { email?: string; spec_url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const email = (body.email ?? '').trim();
  const spec_url = (body.spec_url ?? '').trim();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'valid email required' }, 400);
  }

  db.prepare(
    `INSERT INTO deploy_waitlist (email, spec_url) VALUES (?, ?)`
  ).run(email, spec_url || null);

  return c.json({ ok: true });
});
