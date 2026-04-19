// Inline image card for outputs that produce an image (base64 data URL
// or http(s) URL). Shows the image with max-height so tall portraits
// don't blow up the layout, plus a Download button that saves the
// original bytes under a reasonable filename.
//
// Safety: we only render `src` when it looks like a data: image URL or
// an http(s) URL — everything else is skipped. Prevents a malicious
// creator from passing a javascript: or file: URL through the runner.
import { useMemo } from 'react';

export interface ImageViewProps {
  src: string;
  label?: string;
  filename?: string;
  alt?: string;
}

function isSafeImageSrc(src: string): boolean {
  if (typeof src !== 'string' || src.length === 0) return false;
  if (/^data:image\/[a-z0-9+.-]+;base64,/i.test(src)) return true;
  if (/^https?:\/\//i.test(src)) return true;
  return false;
}

function guessExt(src: string): string {
  const m = src.match(/^data:image\/([a-z0-9+.-]+);/i);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === 'jpeg') return 'jpg';
    if (kind === 'svg+xml') return 'svg';
    return kind;
  }
  const url = src.split('?')[0];
  const ext = url.split('.').pop();
  if (ext && /^[a-z0-9]{2,5}$/i.test(ext)) return ext.toLowerCase();
  return 'png';
}

export function ImageView({ src, label, filename, alt }: ImageViewProps) {
  const safe = useMemo(() => isSafeImageSrc(src), [src]);
  if (!safe) return null;
  const downloadName = filename || `output.${guessExt(src)}`;

  return (
    <div
      data-renderer="ImageView"
      className="app-expanded-card"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      {label && (
        <div
          style={{
            padding: '12px 16px 0',
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          padding: 16,
          display: 'flex',
          justifyContent: 'center',
          background: 'var(--card)',
        }}
      >
        <img
          src={src}
          alt={alt || label || 'Output image'}
          style={{
            maxWidth: '100%',
            maxHeight: 480,
            borderRadius: 8,
            display: 'block',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '10px 16px 14px',
          borderTop: '1px solid var(--line)',
        }}
      >
        <a
          href={src}
          download={downloadName}
          className="output-copy-btn"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          Download
        </a>
      </div>
    </div>
  );
}
