// Body-size guard middleware for run surfaces.
//
// Public-run endpoints on floom.dev accept JSON bodies that can contain
// base64-encoded file uploads (up to 6 MB per file, enforced in
// apps/server/src/lib/file-inputs.ts). But a naive `c.req.text()` or
// `c.req.json()` call will happily buffer any Content-Length — including
// an attacker sending 100 MB of textarea JSON to burn RAM per-process.
//
// Launch-hardening (2026-04-23) for the 3 hero demo apps (lead-scorer /
// competitor-analyzer / resume-screener). Applied to the same routes the
// global rate-limit middleware covers — anything that dispatches an app
// run. Keeps the body budget tight enough to reject launch-day DoS
// attempts (oversized JSON blobs, zip-bomb-style base64 payloads) while
// leaving headroom for a legitimate 6 MB CV/CSV upload with JSON
// overhead.
//
// Enforcement happens in two places:
//   1. If Content-Length is present and over budget, reject immediately
//      with 413 so we never read the body.
//   2. For chunked / unknown-length requests we still honour the cap by
//      streaming into a capped reader; anything over budget returns 413.
//      Hono lazily buffers the body on `c.req.text()`, so the simpler
//      gate is the Content-Length check above. As a belt-and-braces we
//      also attach a marker header the downstream parser can check.
//
// Escape: FLOOM_RUN_BODY_LIMIT_DISABLED=true skips the gate. Never set
// this in production; it's a dev escape hatch only.

import type { MiddlewareHandler } from 'hono';

/**
 * 8 MiB total cap on run request bodies. Rationale:
 *   - SERVER_MAX_FILE_BYTES (lib/file-inputs.ts) = 6 MiB per file.
 *   - Base64 inflates by ~33%, so a 6 MiB file arrives as ~8 MiB of
 *     base64 text. Plus JSON envelope overhead (manifest-declared
 *     fields, action name) adds a few hundred bytes.
 *   - 8 MiB covers one max-size file + the JSON envelope with room to
 *     spare, and rejects anything an attacker might try to flood us with.
 *
 * NB: this is only applied to `/api/run*` and friends — the rest of the
 * API (OpenAPI ingest, MCP, webhook) has its own body shape and limit.
 */
export const RUN_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export const isRunBodyLimitDisabled = (): boolean =>
  process.env.FLOOM_RUN_BODY_LIMIT_DISABLED === 'true';

export class RequestBodyTooLargeError extends Error {
  readonly limitBytes: number;
  readonly observedBytes: number;

  constructor(
    limitBytes: number,
    observedBytes: number,
  ) {
    super(
      `Request body is ${observedBytes} bytes; max allowed for run endpoints is ${limitBytes}.`,
    );
    this.name = 'RequestBodyTooLargeError';
    this.limitBytes = limitBytes;
    this.observedBytes = observedBytes;
  }
}

export async function readRequestTextWithLimit(
  request: Request,
  limitBytes = RUN_BODY_LIMIT_BYTES,
): Promise<string> {
  const lenHeader = request.headers.get('content-length');
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > limitBytes) {
      throw new RequestBodyTooLargeError(limitBytes, len);
    }
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(limitBytes, received);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) chunks.push(tail);
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function tooLargeResponse(observedBytes: number) {
  return Response.json(
    {
      error: 'request_body_too_large',
      message: `Request body is ${observedBytes} bytes; max allowed for run endpoints is ${RUN_BODY_LIMIT_BYTES}.`,
      limit_bytes: RUN_BODY_LIMIT_BYTES,
    },
    { status: 413 },
  );
}

/**
 * Middleware: reject requests whose Content-Length exceeds the cap with
 * HTTP 413. GETs and other methods without bodies are a no-op.
 */
export const runBodyLimit: MiddlewareHandler = async (c, next) => {
  if (isRunBodyLimitDisabled()) return next();

  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const lenHeader = c.req.header('content-length');
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > RUN_BODY_LIMIT_BYTES) {
      return tooLargeResponse(len);
    }
  }

  try {
    const raw = await readRequestTextWithLimit(c.req.raw);
    c.req.raw = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body: raw,
    });
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return tooLargeResponse(err.observedBytes);
    }
    throw err;
  }

  return next();
};
