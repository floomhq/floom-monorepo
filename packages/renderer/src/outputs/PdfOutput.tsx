import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * PDF viewer output. Phase 3 upgrade note: a full react-pdf integration is
 * planned once bundle size budget allows. For now we ship an <iframe>
 * viewer that relies on the browser's native PDF renderer (works in Chrome,
 * Edge, Safari, and Firefox with the built-in PDF.js viewer).
 *
 * Accepts a string URL, a data:application/pdf URL, or an object with a
 * `url` / `href` / `pdf` / `src` field.
 */
export function coercePdfSrc(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') {
    if (data.startsWith('http') || data.startsWith('data:')) return data;
    return `data:application/pdf;base64,${data}`;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['url', 'href', 'pdf', 'src']) {
      const v = obj[key];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

export function PdfOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) return <div className="floom-output floom-output-pdf loading">…</div>;
  const src = coercePdfSrc(data);
  if (!src) {
    return (
      <div className="floom-output floom-output-pdf">
        <em>No PDF data</em>
      </div>
    );
  }
  return (
    <div className="floom-output floom-output-pdf" style={{ minHeight: 480 }}>
      <iframe
        src={src}
        title="Floom PDF output"
        style={{ width: '100%', height: '480px', border: '1px solid #e5e5e5' }}
      />
      <p style={{ fontSize: 12, opacity: 0.5 }}>
        <a href={src} target="_blank" rel="noreferrer">
          Open PDF in new tab
        </a>
      </p>
    </div>
  );
}
