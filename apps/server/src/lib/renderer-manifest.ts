// Server-local copy of the small, pure helpers from @floom/renderer/contract
// used by openapi-ingest + renderer-bundler at runtime.
//
// Why a copy: @floom/renderer ships TypeScript source (.ts/.tsx) via its
// "main" + "exports" map. That works for the web build (Vite) and for tsx
// in dev, but the production server image only ships compiled JS — Node
// cannot import .ts files at runtime. Inlining the ~50 lines of pure helpers
// keeps the production server self-contained and removes the runtime
// workspace dependency. The full @floom/renderer package is still used by
// the bundler service via esbuild (which reads source directly) and by the
// web frontend.
//
// Contract: keep this file in sync with packages/renderer/src/contract/index.ts.
// If you change the manifest schema there, mirror it here.

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

export interface RendererManifest {
  kind: 'default' | 'component';
  entry?: string;
  output_shape?: OutputShape;
}

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
 * touch the filesystem.
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
