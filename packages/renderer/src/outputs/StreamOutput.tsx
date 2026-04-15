import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Streaming output area. Consumes NDJSON or SSE events and appends them to a
 * scroll-pinned panel. The host passes `data` as either:
 *   - an array of string/object events (already buffered)
 *   - a newline-delimited string
 *
 * When `loading` is true we show an animated pulse at the bottom.
 */

export function eventsToLines(data: unknown): string[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  }
  if (typeof data === 'string') return data.split('\n').filter(Boolean);
  return [JSON.stringify(data)];
}

export function StreamOutput({ data, loading }: RenderProps): React.ReactElement {
  const lines = eventsToLines(data);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div
      className="floom-output floom-output-stream"
      ref={scrollRef}
      style={{
        maxHeight: 320,
        overflow: 'auto',
        background: '#0b0b0b',
        color: '#f0f0f0',
        padding: 12,
        fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
        fontSize: 12,
        borderRadius: 4,
      }}
    >
      {lines.length === 0 && !loading && (
        <div style={{ opacity: 0.5 }}>No events yet</div>
      )}
      {lines.map((line, i) => (
        <div key={i} className="floom-stream-line">
          {line}
        </div>
      ))}
      {loading && (
        <div className="floom-stream-pulse" style={{ opacity: 0.5 }}>
          ▎
        </div>
      )}
    </div>
  );
}
