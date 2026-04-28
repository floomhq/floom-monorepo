// Job queue service (v0.3.0). Thin CRUD + claim helpers on top of the `jobs`
// table. The HTTP router creates jobs, the background worker claims + runs
// them, and both converge on the same storage.
//
// Claiming uses an atomic UPDATE...WHERE status='queued' pattern so multiple
// workers or concurrent replicas never double-dispatch a row.
import { db } from '../db.js';
import { decryptValue, encryptValue } from './user_secrets.js';
import type { AppRecord, JobRecord, JobStatus } from '../types.js';

export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PER_CALL_SECRET_COUNT = 64;
const MAX_PER_CALL_SECRET_KEY_BYTES = 256;
const MAX_PER_CALL_SECRET_VALUE_BYTES = 64 * 1024;

export interface CreateJobInput {
  app: AppRecord;
  action: string;
  inputs: Record<string, unknown>;
  workspaceId?: string | null;
  userId?: string | null;
  deviceId?: string | null;
  webhookUrlOverride?: string | null;
  timeoutMsOverride?: number | null;
  maxRetriesOverride?: number | null;
  perCallSecrets?: Record<string, string> | null;
  useContext?: boolean;
}

interface EncryptedPerCallSecretsEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  workspace_id: string;
  secrets: Record<
    string,
    {
      ciphertext: string;
      nonce: string;
      auth_tag: string;
    }
  >;
}

export function createJob(jobId: string, args: CreateJobInput): JobRecord {
  const timeout =
    args.timeoutMsOverride ??
    (args.app.timeout_ms && args.app.timeout_ms > 0 ? args.app.timeout_ms : DEFAULT_JOB_TIMEOUT_MS);
  const maxRetries =
    args.maxRetriesOverride ??
    (typeof args.app.retries === 'number' && args.app.retries >= 0 ? args.app.retries : 0);
  const webhook = args.webhookUrlOverride ?? args.app.webhook_url ?? null;
  const workspaceId = args.workspaceId || args.app.workspace_id || 'local';
  const perCallSecretsJson =
    args.perCallSecrets && Object.keys(args.perCallSecrets).length > 0
      ? JSON.stringify(encryptPerCallSecrets(workspaceId, args.perCallSecrets))
      : null;

  db.prepare(
    `INSERT INTO jobs (
       id, slug, app_id, action, status, input_json, webhook_url,
       timeout_ms, max_retries, attempts, per_call_secrets_json,
       use_context, workspace_id, user_id, device_id
     ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    args.app.slug,
    args.app.id,
    args.action,
    JSON.stringify(args.inputs),
    webhook,
    timeout,
    maxRetries,
    perCallSecretsJson,
    args.useContext ? 1 : 0,
    workspaceId,
    args.userId || null,
    args.deviceId || null,
  );
  const row = getJob(jobId);
  if (!row) throw new Error(`createJob: failed to re-read row ${jobId}`);
  return row;
}

export function decodePerCallSecrets(row: JobRecord): Record<string, string> | undefined {
  if (!row.per_call_secrets_json) return undefined;
  const parsed = JSON.parse(row.per_call_secrets_json) as unknown;
  if (isEncryptedPerCallSecretsEnvelope(parsed)) {
    const out: Record<string, string> = {};
    const workspaceId = parsed.workspace_id || row.workspace_id || 'local';
    for (const [key, secret] of Object.entries(parsed.secrets)) {
      out[key] = decryptValue(
        workspaceId,
        secret.ciphertext,
        secret.nonce,
        secret.auth_tag,
      );
    }
    return out;
  }

  // Backward compatibility for queued jobs created before per-call secret
  // encryption shipped. New writes always use the encrypted envelope above.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  return undefined;
}

function encryptPerCallSecrets(
  workspaceId: string,
  secrets: Record<string, string>,
): EncryptedPerCallSecretsEnvelope {
  const encrypted: EncryptedPerCallSecretsEnvelope['secrets'] = {};
  const entries = Object.entries(secrets);
  if (entries.length > MAX_PER_CALL_SECRET_COUNT) {
    throw new Error(`per-call secrets can contain at most ${MAX_PER_CALL_SECRET_COUNT} keys`);
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (Buffer.byteLength(key, 'utf-8') > MAX_PER_CALL_SECRET_KEY_BYTES) {
      throw new Error(`per-call secret key is too long: ${key.slice(0, 32)}`);
    }
    if (Buffer.byteLength(value, 'utf-8') > MAX_PER_CALL_SECRET_VALUE_BYTES) {
      throw new Error(`per-call secret value is too large: ${key}`);
    }
    encrypted[key] = encryptValue(workspaceId, value);
  }
  return {
    v: 1,
    alg: 'aes-256-gcm',
    workspace_id: workspaceId,
    secrets: encrypted,
  };
}

function isEncryptedPerCallSecretsEnvelope(
  value: unknown,
): value is EncryptedPerCallSecretsEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<EncryptedPerCallSecretsEnvelope>;
  if (
    !(
    candidate.v === 1 &&
    candidate.alg === 'aes-256-gcm' &&
    typeof candidate.workspace_id === 'string' &&
    !!candidate.secrets &&
    typeof candidate.secrets === 'object' &&
    !Array.isArray(candidate.secrets)
    )
  ) {
    return false;
  }
  const entries = Object.entries(candidate.secrets);
  if (entries.length > MAX_PER_CALL_SECRET_COUNT) return false;
  return entries.every(([, secret]) => {
    if (!secret || typeof secret !== 'object' || Array.isArray(secret)) return false;
    const row = secret as Record<string, unknown>;
    return (
      typeof row.ciphertext === 'string' &&
      typeof row.nonce === 'string' &&
      typeof row.auth_tag === 'string'
    );
  });
}

export function getJob(jobId: string): JobRecord | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
    | JobRecord
    | undefined;
}

export function getJobBySlug(slug: string, jobId: string): JobRecord | undefined {
  return db
    .prepare('SELECT * FROM jobs WHERE id = ? AND slug = ?')
    .get(jobId, slug) as JobRecord | undefined;
}

/**
 * Atomically mark a queued job as running. Returns the updated row if the
 * claim succeeded, undefined if another worker won the race (or the row
 * moved to a terminal state).
 */
export function claimJob(jobId: string): JobRecord | undefined {
  const res = db
    .prepare(
      `UPDATE jobs
         SET status='running',
             started_at=datetime('now'),
             attempts=attempts + 1
       WHERE id = ? AND status = 'queued'`,
    )
    .run(jobId);
  if (res.changes === 0) return undefined;
  return getJob(jobId);
}

/**
 * Find the next queued job. Returns the oldest-created queued row without
 * claiming it — the caller follows up with `claimJob` to atomically grab it.
 */
export function nextQueuedJob(): JobRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as JobRecord | undefined;
}

export function completeJob(
  jobId: string,
  outputs: unknown,
  runId: string | null,
): JobRecord | undefined {
  db.prepare(
    `UPDATE jobs
       SET status='succeeded',
           output_json=?,
           run_id=?,
           finished_at=datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(outputs ?? null), runId, jobId);
  return getJob(jobId);
}

export function failJob(
  jobId: string,
  error: { message: string; type?: string; details?: unknown },
  runId: string | null,
): JobRecord | undefined {
  db.prepare(
    `UPDATE jobs
       SET status='failed',
           error_json=?,
           run_id=?,
           finished_at=datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(error), runId, jobId);
  return getJob(jobId);
}

/**
 * Re-queue a failed job (used by the retry logic). Bumps status back to
 * `queued`, clears timing, keeps attempts count for max_retries checks.
 */
export function requeueJob(jobId: string): JobRecord | undefined {
  db.prepare(
    `UPDATE jobs
       SET status='queued',
           started_at=NULL,
           finished_at=NULL,
           error_json=NULL,
           run_id=NULL
     WHERE id = ?`,
  ).run(jobId);
  return getJob(jobId);
}

export function cancelJob(jobId: string): JobRecord | undefined {
  // Only queued/running jobs can be cancelled. Terminal states are immutable.
  const res = db
    .prepare(
      `UPDATE jobs
         SET status='cancelled',
             finished_at=datetime('now')
       WHERE id = ? AND status IN ('queued', 'running')`,
    )
    .run(jobId);
  if (res.changes === 0) return getJob(jobId);
  return getJob(jobId);
}

/**
 * Format a job row for API responses. Parses JSON blobs, hides internal
 * columns (per_call_secrets_json), and exposes a stable shape to clients.
 */
export function formatJob(row: JobRecord): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    app_id: row.app_id,
    action: row.action,
    status: row.status,
    input: safeParseJson(row.input_json),
    output: safeParseJson(row.output_json),
    error: safeParseJson(row.error_json),
    run_id: row.run_id,
    webhook_url: row.webhook_url,
    timeout_ms: row.timeout_ms,
    max_retries: row.max_retries,
    attempts: row.attempts,
    use_context: row.use_context === 1,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    device_id: row.device_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function safeParseJson(raw: string | null): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function countJobsByStatus(status: JobStatus): number {
  const row = db
    .prepare('SELECT COUNT(*) as n FROM jobs WHERE status = ?')
    .get(status) as { n: number };
  return row.n;
}
