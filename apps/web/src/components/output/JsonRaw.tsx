// Last-resort JSON dump. Only reached when none of the v16 cascade
// heuristics match the run output shape — truly heterogeneous nested
// data with no obvious headline. We still try to be helpful:
//   - Pretty-printed (2-space indent).
//   - Copy JSON button in the sticky header.
//   - A "Why is this raw?" tooltip pointing the creator at custom
//     renderers (since they're the one who can fix this).
//
// The landing promise is "looks like a real app, not raw JSON". When
// the cascade can't produce that, we at least signal it's a fallback
// and offer the creator a concrete next step.
import { useState } from 'react';
import { CopyButton } from './CopyButton';

export interface JsonRawProps {
  data: unknown;
}

export function JsonRaw({ data }: JsonRawProps) {
  const [showTip, setShowTip] = useState(false);
  const json =
    data === undefined
      ? '(no output)'
      : typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2);

  return (
    <div
      data-renderer="JsonRaw"
      className="app-expanded-card"
      style={{
        position: 'relative',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 6,
          zIndex: 1,
        }}
      >
        <button
          type="button"
          aria-label="Why is this raw?"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          onFocus={() => setShowTip(true)}
          onBlur={() => setShowTip(false)}
          onClick={() => setShowTip((v) => !v)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: '1px solid var(--line)',
            background: 'var(--card)',
            color: 'var(--muted)',
            cursor: 'help',
            fontSize: 12,
            fontWeight: 600,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ?
        </button>
        <CopyButton value={json} label="Copy JSON" />
      </div>
      {showTip && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 40,
            right: 12,
            maxWidth: 280,
            background: 'var(--ink)',
            color: 'var(--card)',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontFamily: 'inherit',
            lineHeight: 1.5,
            zIndex: 2,
            boxShadow: '0 10px 30px rgba(14, 14, 12, 0.2)',
          }}
        >
          This app didn't match any of Floom's built-in output shapes, so we're
          showing the raw JSON. The creator can add a custom renderer in Studio
          to make it look like a real app.
        </div>
      )}
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 420,
          overflow: 'auto',
        }}
      >
        {json}
      </pre>
    </div>
  );
}
