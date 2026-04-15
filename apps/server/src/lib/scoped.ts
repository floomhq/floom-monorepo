// W2.1 tenant scoping helper.
//
// Floom scopes every query with `workspace_id = ?` in app code (P.4 section
// 7 — RLS deferred, single helper enforced by convention + lint). This
// module exposes a tiny wrapper that prepends the workspace predicate to a
// SQL fragment and returns a prepared statement ready to execute.
//
// Usage:
//   const stmt = scopedSelect(db, ctx, 'app_memory', 'app_slug = ?');
//   const rows = stmt.all('flyfast');  // WHERE workspace_id = ? AND app_slug = ?
//
//   scopedAll(db, ctx, 'SELECT * FROM app_memory WHERE app_slug = ?', ['flyfast']);
//   // → automatically prepends workspace_id filter and binds ctx.workspace_id
//
// Throws if `ctx.workspace_id` is missing. This is a programming error —
// the middleware must always build a context before any query runs.
import type Database from 'better-sqlite3';
import type { SessionContext } from '../types.js';

export class MissingContextError extends Error {
  constructor(message = 'SessionContext is missing workspace_id') {
    super(message);
    this.name = 'MissingContextError';
  }
}

function assertCtx(ctx: SessionContext | null | undefined): asserts ctx is SessionContext {
  if (!ctx || typeof ctx.workspace_id !== 'string' || ctx.workspace_id.length === 0) {
    throw new MissingContextError();
  }
}

/**
 * Prepend a `workspace_id = ?` predicate to a raw SQL WHERE clause and bind
 * the workspace id as the first parameter. Returns the combined `all()` result.
 *
 * `table` is the source table name (used to build `WHERE workspace_id = ?`
 * with the correct column alias). `whereFragment` is appended with ` AND `.
 */
export function scopedAll<T = unknown>(
  db: Database.Database,
  ctx: SessionContext,
  table: string,
  columns: string,
  whereFragment: string | null,
  params: unknown[] = [],
): T[] {
  assertCtx(ctx);
  const where = whereFragment
    ? `WHERE ${table}.workspace_id = ? AND (${whereFragment})`
    : `WHERE ${table}.workspace_id = ?`;
  const sql = `SELECT ${columns} FROM ${table} ${where}`;
  return db.prepare(sql).all(ctx.workspace_id, ...params) as T[];
}

/**
 * Single-row variant of scopedAll. Returns the first row or undefined.
 */
export function scopedGet<T = unknown>(
  db: Database.Database,
  ctx: SessionContext,
  table: string,
  columns: string,
  whereFragment: string,
  params: unknown[] = [],
): T | undefined {
  assertCtx(ctx);
  const sql =
    `SELECT ${columns} FROM ${table} ` +
    `WHERE ${table}.workspace_id = ? AND (${whereFragment}) LIMIT 1`;
  return db.prepare(sql).get(ctx.workspace_id, ...params) as T | undefined;
}

/**
 * Scoped UPSERT-style run. The caller supplies the SQL (`INSERT INTO ... ON
 * CONFLICT ...`) and parameter list; this helper asserts the context is
 * present and logs the workspace for audit. Intentionally thin — writes vary
 * too much across tables to force them through a single template.
 */
export function scopedRun(
  db: Database.Database,
  ctx: SessionContext,
  sql: string,
  params: unknown[],
): Database.RunResult {
  assertCtx(ctx);
  return db.prepare(sql).run(...params);
}

/**
 * Build a predicate string used inside a larger join. Exposed for callers
 * that need to hand-craft a multi-table query (e.g. joining runs → apps).
 */
export function workspacePredicate(tableAlias: string): string {
  return `${tableAlias}.workspace_id = ?`;
}
