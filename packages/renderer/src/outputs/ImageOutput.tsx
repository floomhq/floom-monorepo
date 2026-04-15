import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Image preview output. Accepts:
 *   - a string URL (http/https or data:image/...)
 *   - an object { url } or { src } or { dataUrl }
 *   - a long base64 payload (wrapped to data:image/png when no prefix)
 */
export function coerceImageSrc(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') {
    if (data.startsWith('http') || data.startsWith('data:')) return data;
    if (/^[a-zA-Z0-9+/=]+$/.test(data) && data.length > 32) {
      return `data:image/png;base64,${data}`;
    }
    return data;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['url', 'src', 'href', 'dataUrl', 'image']) {
      const v = obj[key];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

export function ImageOutput({ data, loading }: RenderProps): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false);
  if (loading) return <div className="floom-output floom-output-image loading">…</div>;
  const src = coerceImageSrc(data);
  if (!src) {
    return (
      <div className="floom-output floom-output-image">
        <em>No image data</em>
      </div>
    );
  }
  return (
    <figure className="floom-output floom-output-image" style={{ margin: 0 }}>
      {!loaded && <div className="floom-image-skeleton">Loading…</div>}
      <img
        src={src}
        alt="Floom output"
        onLoad={() => setLoaded(true)}
        style={{ maxWidth: '100%', display: 'block' }}
      />
    </figure>
  );
}
