// Floom renderer contract.
//
// Every Floom renderer (default or custom) is a React component that takes a
// single `RenderProps` object. The shape of RenderProps is borrowed from the
// Vercel AI SDK `parts` state machine: three mutually-exclusive states.
//
//   - `input-available`  : the run is in flight, only inputs exist. Render a
//                          loading state that echoes the inputs if useful.
//   - `output-available` : the run succeeded. `data` carries the parsed
//                          response body, `schema` carries the response
//                          schema (for default renderers to introspect).
//   - `output-error`     : the run failed. `error` carries a structured
//                          error object the renderer can show + retry.
//
// Custom renderers never need to import anything else from this package —
// they can treat `RenderProps` as a pure data contract.

/**
 * The 10 canonical output shapes Floom ships default renderers for. A manifest
 * can pin its output to any one of these via `renderer.output_shape`, or leave
 * it unset and Floom's schema-to-shape discriminator will pick one.
 */
export type OutputShape =
  | 'text'
  | 'markdown'
  | 'code'
  | 'table'
  | 'object'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'stream'
  | 'error';

/**
 * A partial JSON Schema (post-dereference). Default renderers introspect this
 * to decide how to display the data (e.g. an `array` of objects with uniform
 * keys becomes a table). Custom renderers usually ignore it.
 */
export interface ResponseSchema {
  type?: string;
  format?: string;
  contentType?: string;
  items?: ResponseSchema;
  properties?: Record<string, ResponseSchema>;
  // Free-form extension fields (x-floom-*, x-display-hint, etc.).
  [key: string]: unknown;
}

/**
 * Structured error envelope returned for `output-error` state. Matches
 * Floom's run envelope: `{ error, code, details }` plus optional retry
 * callback for UIs that want to wire a "try again" button.
 */
export interface RenderError {
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Render state machine. Exactly one of these three shapes at a time.
 */
export type RenderState = 'input-available' | 'output-available' | 'output-error';

/**
 * Props passed to every renderer — default or custom.
 *
 * This is the ONLY shape custom renderers need to know about. Treat it as a
 * stable contract: additive changes only, never breaking.
 */
export interface RenderProps {
  /** Current state in the machine. */
  state: RenderState;
  /**
   * The parsed response body when `state === 'output-available'`. Shape depends
   * on the app's response schema. Custom renderers cast to their own type.
   */
  data?: unknown;
  /** Input values when `state === 'input-available'`. */
  inputs?: Record<string, unknown>;
  /** Response schema when available (for default renderers to introspect). */
  schema?: ResponseSchema;
  /** Error envelope when `state === 'output-error'`. */
  error?: RenderError;
  /** Optional retry callback (wired by the host when feasible). */
  onRetry?: () => void;
  /**
   * Loading flag — true when `state === 'input-available'` OR when the host
   * is mid-stream. Renderers that care about stream mode read this.
   */
  loading?: boolean;
}

/**
 * Shape of the manifest.renderer field in apps.yaml. Parsed by openapi-ingest.
 *
 *   renderer:
 *     kind: component        # "default" or "component"
 *     entry: ./renderer.tsx  # path relative to the manifest, required for "component"
 *     output_shape: table    # optional pin — one of OutputShape
 */
export interface RendererManifest {
  kind: 'default' | 'component';
  /** Source file relative to the manifest. Required when kind === 'component'. */
  entry?: string;
  /** Optional pin: force a specific default shape even when a custom component ships (used as the error-fallback). */
  output_shape?: OutputShape;
}

/**
 * Result of compiling a creator's renderer.tsx via the renderer bundler.
 */
export interface BundleResult {
  slug: string;
  bundlePath: string;
  bytes: number;
  outputShape: OutputShape;
  compiledAt: string;
  sourceHash: string;
}

/**
 * Validate a parsed renderer manifest entry. Returns the canonical shape on
 * success, throws with a human-readable message on failure. Pure: does not
 * touch the filesystem. Used by the ingest + test suites.
 */
export function parseRendererManifest(raw: unknown): RendererManifest {
  if (raw === null || raw === undefined) return { kind: 'default' };
  if (typeof raw !== 'object') {
    throw new Error(
      `renderer: expected object, got ${typeof raw}. Set "renderer: { kind: component, entry: ./renderer.tsx }" in apps.yaml.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind ?? 'default';
  if (kind !== 'default' && kind !== 'component') {
    throw new Error(
      `renderer.kind must be "default" or "component", got ${JSON.stringify(kind)}`,
    );
  }
  const result: RendererManifest = { kind };
  if (kind === 'component') {
    if (typeof obj.entry !== 'string' || obj.entry.length === 0) {
      throw new Error(
        'renderer.kind=component requires an "entry" path (relative to the manifest)',
      );
    }
    // Reject absolute paths and traversal to keep the bundler in a sandbox.
    if (/^(\/|[a-z]:)/i.test(obj.entry) || obj.entry.includes('..')) {
      throw new Error(
        `renderer.entry must be a relative path without .. segments, got ${JSON.stringify(obj.entry)}`,
      );
    }
    result.entry = obj.entry;
  }
  if (obj.output_shape !== undefined) {
    const shape = obj.output_shape;
    const allowed: OutputShape[] = [
      'text',
      'markdown',
      'code',
      'table',
      'object',
      'image',
      'pdf',
      'audio',
      'stream',
      'error',
    ];
    if (typeof shape !== 'string' || !allowed.includes(shape as OutputShape)) {
      throw new Error(
        `renderer.output_shape must be one of ${allowed.join(', ')}, got ${JSON.stringify(shape)}`,
      );
    }
    result.output_shape = shape as OutputShape;
  }
  return result;
}

/**
 * Pure discriminator: walk a response schema and pick the best default output
 * shape. Precedence:
 *   1. Explicit `x-floom-output-shape` vendor extension wins.
 *   2. Stream content types (`text/event-stream`, `application/x-ndjson`).
 *   3. Image/PDF/audio content types.
 *   4. `type: array` with uniform object items → `table`.
 *   5. `type: object` → `object`.
 *   6. `type: string` with `format: markdown` → `markdown`.
 *   7. `type: string` with `x-floom-language` → `code`.
 *   8. Everything else → `text`.
 *
 * Never throws. Unknown schemas fall through to `text`.
 */
export function pickOutputShape(schema: ResponseSchema | undefined | null): OutputShape {
  if (!schema || typeof schema !== 'object') return 'text';

  const ext = (schema as Record<string, unknown>)['x-floom-output-shape'];
  if (typeof ext === 'string') {
    const allowed: OutputShape[] = [
      'text',
      'markdown',
      'code',
      'table',
      'object',
      'image',
      'pdf',
      'audio',
      'stream',
      'error',
    ];
    if (allowed.includes(ext as OutputShape)) return ext as OutputShape;
  }

  const ct = (schema.contentType || (schema as Record<string, unknown>)['content-type']) as
    | string
    | undefined;
  if (typeof ct === 'string') {
    const lower = ct.toLowerCase();
    if (lower === 'text/event-stream' || lower === 'application/x-ndjson') return 'stream';
    if (lower.startsWith('image/')) return 'image';
    if (lower === 'application/pdf') return 'pdf';
    if (lower.startsWith('audio/')) return 'audio';
    if (lower === 'text/markdown') return 'markdown';
  }

  if (schema.type === 'array') {
    const items = schema.items;
    if (items && items.type === 'object') return 'table';
    if (items && items.properties) return 'table';
    // array of primitives: still render as a simple table with one column.
    return 'table';
  }

  if (schema.type === 'object') return 'object';

  if (schema.type === 'string') {
    if (schema.format === 'markdown') return 'markdown';
    if ((schema as Record<string, unknown>)['x-floom-language']) return 'code';
  }

  return 'text';
}
