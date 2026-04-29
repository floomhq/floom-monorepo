// Shared JSON body parser for POST routes.
//
// Why this exists (2026-04-20, P2 #146): the old pattern was
//   const body = (await c.req.json().catch(() => ({}))) as {...};
// which conflates three different cases into a silent `{}`:
//
//   1. No body at all       — acceptable for zero-input actions (`curl -XPOST`)
//   2. Empty string body     — same, acceptable
//   3. Malformed / truncated — NOT acceptable; caller sent something broken
//      and should hear about it with a 400 so they can fix their client.
//
// parseJsonBody distinguishes (3) from (1)/(2) by sniffing the raw text
// before handing it to JSON.parse. If the body contains non-whitespace but
// fails to parse, we return an `error` kind so the route can 400 with
// { error, code: 'invalid_body', details }.
//
// Also enforces top-level shape: a JSON body must be an object. Arrays,
// primitives, and null all 400 because every route in this codebase
// destructures fields off the parsed value.
import type { Context } from 'hono';
import {
  readRequestTextWithLimit,
  RequestBodyTooLargeError,
} from '../middleware/body-size.js';

export type ParsedBody =
  | { kind: 'ok'; value: Record<string, unknown> }
  | {
      kind: 'error';
      reason: 'malformed_json' | 'wrong_shape' | 'body_too_large' | 'unsupported_media_type';
      raw?: string;
      parseMessage?: string;
      limitBytes?: number;
      observedBytes?: number;
      contentType?: string;
    };

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() || '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

export async function parseJsonBody(
  c: Context,
  options: { requireJsonContentType?: boolean } = {},
): Promise<ParsedBody> {
  let raw: string;
  try {
    raw = await readRequestTextWithLimit(c.req.raw);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return {
        kind: 'error',
        reason: 'body_too_large',
        limitBytes: err.limitBytes,
        observedBytes: err.observedBytes,
      };
    }
    // Body stream errored mid-read. Treat as malformed.
    return { kind: 'error', reason: 'malformed_json' };
  }

  // No body OR body is only whitespace → ergonomic empty-object fallback.
  // Keeps `curl -X POST /api/base64/run` working for actions with no
  // required inputs.
  if (raw.trim().length === 0) {
    return { kind: 'ok', value: {} };
  }

  if (options.requireJsonContentType) {
    const contentType = c.req.header('content-type') || '';
    if (!isJsonContentType(contentType)) {
      return {
        kind: 'error',
        reason: 'unsupported_media_type',
        raw,
        contentType,
        parseMessage: 'Content-Type must be application/json for a non-empty JSON body',
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: 'error',
      reason: 'malformed_json',
      raw,
      parseMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      kind: 'error',
      reason: 'wrong_shape',
      raw,
      parseMessage: 'Request body must be a JSON object',
    };
  }

  return { kind: 'ok', value: parsed as Record<string, unknown> };
}

/**
 * Build the 400 response for a ParsedBody error. Kept alongside parseJsonBody
 * so every caller returns the same { error, code, details } shape.
 */
export function bodyParseError(c: Context, err: Extract<ParsedBody, { kind: 'error' }>) {
  if (err.reason === 'body_too_large') {
    return c.json(
      {
        error: 'request_body_too_large',
        message: `Request body is ${err.observedBytes} bytes; max allowed for run endpoints is ${err.limitBytes}.`,
        limit_bytes: err.limitBytes,
      },
      413,
    );
  }
  if (err.reason === 'unsupported_media_type') {
    return c.json(
      {
        error: 'Content-Type must be application/json',
        code: 'unsupported_media_type',
        details: {
          reason: err.reason,
          content_type: err.contentType || null,
        },
      },
      415,
    );
  }
  const message =
    err.reason === 'wrong_shape'
      ? 'Request body must be a JSON object'
      : 'Request body is not valid JSON';
  return c.json(
    {
      error: message,
      code: 'invalid_body',
      details: {
        reason: err.reason,
        parse_message: err.parseMessage ?? null,
      },
    },
    400,
  );
}
