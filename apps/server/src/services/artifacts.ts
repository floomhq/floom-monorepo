import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { db } from '../db.js';
import { isProductionEnv } from '../lib/startup-checks.js';

export const ALLOWED_ARTIFACT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
]);

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const DEV_SIGNING_SECRET = 'dev-floom-artifact-signing-secret';

export interface RawArtifact {
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  data_b64?: unknown;
}

export interface StoredArtifact {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  url: string;
  expires_at: string;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  job_id: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  storage_path: string;
  created_at: string;
  expires_at: string;
}

interface DecodedArtifact {
  id: string;
  name: string;
  mime: string;
  size: number;
  bytes: Buffer;
  sha256: string;
  expiresAt: string;
  storagePath: string;
}

export function artifactDir(): string {
  return process.env.FLOOM_ARTIFACT_DIR || '/var/floom/artifacts';
}

export function artifactMaxSizeBytes(): number {
  return readMbEnv('FLOOM_ARTIFACT_MAX_SIZE_MB', 50);
}

export function artifactMaxTotalPerRunBytes(): number {
  return readMbEnv('FLOOM_ARTIFACT_MAX_TOTAL_PER_RUN_MB', 100);
}

export function artifactRetentionDays(): number {
  const raw = Number(process.env.FLOOM_ARTIFACT_RETENTION_DAYS || '');
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 7;
}

export function artifactSigningSecret(): string {
  const configured = process.env.FLOOM_ARTIFACT_SIGNING_SECRET?.trim();
  if (configured) return configured;
  if (isProductionEnv()) {
    throw new Error('FLOOM_ARTIFACT_SIGNING_SECRET is required in production');
  }
  return DEV_SIGNING_SECRET;
}

export function newArtifactId(): string {
  return `art_${base32(randomBytes(16)).toLowerCase()}`;
}

export function signArtifactUrl(artifactId: string, expUnix: number): string {
  const sig = signPayload(artifactId, expUnix);
  return `/api/artifacts/${encodeURIComponent(artifactId)}?sig=${encodeURIComponent(sig)}&exp=${expUnix}`;
}

export function verifyArtifactSignature(
  artifactId: string,
  expUnix: number,
  sig: string,
): boolean {
  if (!Number.isInteger(expUnix) || expUnix <= 0 || !sig) return false;
  const expected = signPayload(artifactId, expUnix);
  const got = Buffer.from(sig, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function isArtifactExpired(row: Pick<ArtifactRow, 'expires_at'>, now = new Date()): boolean {
  const expiresMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z');
  return Number.isFinite(expiresMs) && expiresMs <= now.getTime();
}

export function captureArtifactsForRun(args: {
  runId: string;
  jobId?: string | null;
  artifacts: unknown;
}): StoredArtifact[] {
  if (args.artifacts === undefined || args.artifacts === null) return [];
  if (!Array.isArray(args.artifacts)) {
    throw new Error('artifacts must be an array');
  }
  if (args.artifacts.length === 0) return [];

  const root = resolve(artifactDir());
  const runDir = resolve(root, args.runId);
  const expiresAtDate = new Date(Date.now() + artifactRetentionDays() * 24 * 60 * 60 * 1000);
  const expiresAt = sqliteTimestamp(expiresAtDate);
  const expUnix = Math.floor(expiresAtDate.getTime() / 1000);
  const decoded: DecodedArtifact[] = [];
  let totalSize = 0;

  for (const raw of args.artifacts) {
    const artifact = validateAndDecodeArtifact(raw as RawArtifact);
    totalSize += artifact.bytes.length;
    if (totalSize > artifactMaxTotalPerRunBytes()) {
      throw new Error(
        `artifact total size exceeds ${Math.floor(artifactMaxTotalPerRunBytes() / (1024 * 1024))} MB per run`,
      );
    }
    const id = newArtifactId();
    const storagePath = resolve(runDir, id);
    if (!storagePath.startsWith(runDir + sep)) {
      throw new Error('artifact storage path escaped run directory');
    }
    decoded.push({
      id,
      name: artifact.name,
      mime: artifact.mime,
      size: artifact.bytes.length,
      bytes: artifact.bytes,
      sha256: createHash('sha256').update(artifact.bytes).digest('hex'),
      expiresAt,
      storagePath,
    });
  }

  try {
    mkdirSync(runDir, { recursive: true, mode: 0o755 });
    maybeChownFloom(runDir);
    for (const artifact of decoded) {
      writeFileSync(artifact.storagePath, artifact.bytes, { mode: 0o644 });
      chmodSync(artifact.storagePath, 0o644);
      maybeChownFloom(artifact.storagePath);
    }
    const insert = db.prepare(
      `INSERT INTO artifacts
         (id, run_id, job_id, name, mime, size, sha256, storage_path, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    );
    const tx = db.transaction(() => {
      for (const artifact of decoded) {
        insert.run(
          artifact.id,
          args.runId,
          args.jobId ?? null,
          artifact.name,
          artifact.mime,
          artifact.size,
          artifact.sha256,
          artifact.storagePath,
          artifact.expiresAt,
        );
      }
    });
    tx();
  } catch (err) {
    rmSync(runDir, { recursive: true, force: true });
    db.prepare('DELETE FROM artifacts WHERE run_id = ?').run(args.runId);
    throw err;
  }

  return decoded.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    mime: artifact.mime,
    size: artifact.size,
    sha256: artifact.sha256,
    url: signArtifactUrl(artifact.id, expUnix),
    expires_at: artifact.expiresAt,
  }));
}

export function outputWithArtifacts(outputs: unknown, artifacts: StoredArtifact[]): unknown {
  if (artifacts.length === 0) return outputs ?? null;
  const stripped = artifacts.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    mime: artifact.mime,
    size: artifact.size,
    sha256: artifact.sha256,
    url: artifact.url,
    expires_at: artifact.expires_at,
  }));
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    return { ...(outputs as Record<string, unknown>), artifacts: stripped };
  }
  return { outputs: outputs ?? null, artifacts: stripped };
}

export function getArtifact(artifactId: string): ArtifactRow | undefined {
  return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) as
    | ArtifactRow
    | undefined;
}

export function sweepExpiredArtifacts(now = new Date()): { deleted_count: number } {
  const cutoff = sqliteTimestamp(now);
  const rows = db
    .prepare('SELECT * FROM artifacts WHERE expires_at < ?')
    .all(cutoff) as ArtifactRow[];
  for (const row of rows) {
    rmSync(row.storage_path, { force: true });
    tryRemoveEmptyRunDir(row.storage_path);
  }
  if (rows.length > 0) {
    db.prepare('DELETE FROM artifacts WHERE expires_at < ?').run(cutoff);
  }
  return { deleted_count: rows.length };
}

export function startArtifactSweeper(intervalMs = 60 * 60 * 1000): { stop: () => void } {
  const tick = () => {
    try {
      const result = sweepExpiredArtifacts();
      if (result.deleted_count > 0) {
        console.log(`[artifacts] swept ${result.deleted_count} expired artifact${result.deleted_count === 1 ? '' : 's'}`);
      }
    } catch (err) {
      console.warn(`[artifacts] sweep failed: ${(err as Error).message}`);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export function deleteArtifactFilesForRunIds(runIds: string[]): void {
  if (runIds.length === 0) return;
  const placeholders = runIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM artifacts WHERE run_id IN (${placeholders})`)
    .all(...runIds) as ArtifactRow[];
  for (const row of rows) {
    rmSync(row.storage_path, { force: true });
    tryRemoveEmptyRunDir(row.storage_path);
  }
}

function validateAndDecodeArtifact(raw: RawArtifact): {
  name: string;
  mime: string;
  bytes: Buffer;
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('artifact must be an object');
  }
  const name = validateArtifactName(raw.name);
  const mime = validateArtifactMime(raw.mime);
  if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size < 0) {
    throw new Error(`artifact "${name}" size must be a non-negative integer`);
  }
  if (typeof raw.data_b64 !== 'string' || raw.data_b64.length === 0) {
    throw new Error(`artifact "${name}" data_b64 must be a non-empty base64 string`);
  }
  const bytes = decodeStrictBase64(raw.data_b64, name);
  if (bytes.length !== raw.size) {
    throw new Error(`artifact "${name}" size does not match decoded bytes`);
  }
  if (bytes.length > artifactMaxSizeBytes()) {
    throw new Error(
      `artifact "${name}" exceeds ${Math.floor(artifactMaxSizeBytes() / (1024 * 1024))} MB`,
    );
  }
  return { name, mime, bytes };
}

function validateArtifactName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('artifact name must be a string');
  const name = value.trim();
  if (!name) throw new Error('artifact name cannot be empty');
  if (name.includes('\0') || name.includes('/') || name.includes('\\')) {
    throw new Error(`artifact name "${name}" cannot contain path separators`);
  }
  if (name.includes('..') || isAbsolute(name) || basename(name) !== name) {
    throw new Error(`artifact name "${name}" cannot contain path traversal`);
  }
  return name;
}

function validateArtifactMime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('artifact mime must be a string');
  const mime = value.trim().toLowerCase();
  if (!ALLOWED_ARTIFACT_MIMES.has(mime)) {
    throw new Error(`artifact mime "${mime}" is not allowed`);
  }
  return mime;
}

function decodeStrictBase64(value: string, name: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error(`artifact "${name}" data_b64 is not valid base64`);
  }
  const bytes = Buffer.from(normalized, 'base64');
  const roundTrip = bytes.toString('base64').replace(/=+$/g, '');
  if (roundTrip !== normalized.replace(/=+$/g, '')) {
    throw new Error(`artifact "${name}" data_b64 is not valid base64`);
  }
  return bytes;
}

function signPayload(artifactId: string, expUnix: number): string {
  return createHmac('sha256', artifactSigningSecret())
    .update(`${artifactId}.${expUnix}`)
    .digest('hex');
}

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function readMbEnv(name: string, fallbackMb: number): number {
  const raw = Number(process.env[name] || '');
  const mb = Number.isFinite(raw) && raw > 0 ? raw : fallbackMb;
  return Math.floor(mb * 1024 * 1024);
}

function sqliteTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function maybeChownFloom(path: string): void {
  try {
    if (typeof process.getuid === 'function' && process.getuid() !== 0) return;
    const passwd = readFileSync('/etc/passwd', 'utf8');
    const line = passwd.split('\n').find((entry) => entry.startsWith('floom:'));
    if (!line) return;
    const parts = line.split(':');
    const uid = Number(parts[2]);
    const gid = Number(parts[3]);
    if (Number.isInteger(uid) && Number.isInteger(gid)) chownSync(path, uid, gid);
  } catch {
    // Ownership is best-effort outside the production floom user.
  }
}

function tryRemoveEmptyRunDir(storagePath: string): void {
  try {
    const dir = resolve(storagePath, '..');
    const root = resolve(artifactDir());
    if (dir !== root && !dir.startsWith(root + sep)) return;
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      rmSync(dir, { recursive: false, force: true });
    }
  } catch {
    // Directory still contains live artifacts.
  }
}
