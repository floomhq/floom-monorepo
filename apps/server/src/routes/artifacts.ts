import { Hono } from 'hono';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import {
  getArtifact,
  isArtifactExpired,
  verifyArtifactSignature,
} from '../services/artifacts.js';

export const artifactsRouter = new Hono();

artifactsRouter.get('/:artifact_id', async (c) => {
  const artifactId = c.req.param('artifact_id');
  const sig = c.req.query('sig') || '';
  const expRaw = c.req.query('exp') || '';
  const exp = Number(expRaw);

  if (!Number.isInteger(exp) || exp <= 0 || !verifyArtifactSignature(artifactId, exp, sig)) {
    return c.json({ error: 'Invalid artifact signature' }, 403);
  }
  if (Date.now() > exp * 1000) {
    return c.json({ error: 'Artifact download URL expired' }, 410);
  }

  const row = getArtifact(artifactId);
  if (!row) return c.json({ error: 'Artifact not found' }, 404);
  if (isArtifactExpired(row)) {
    return c.json({ error: 'Artifact expired' }, 410);
  }
  if (!existsSync(row.storage_path)) {
    return c.json({ error: 'Artifact not found' }, 404);
  }

  const nodeStream = createReadStream(row.storage_path);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(row.size),
      'Content-Disposition': contentDisposition(row.name),
      'Cache-Control': 'private, max-age=0, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

function contentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\x20-\x7e]/g, '_')
    .slice(0, 180) || 'artifact';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
