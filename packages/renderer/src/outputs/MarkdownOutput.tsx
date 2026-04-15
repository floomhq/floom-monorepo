import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Markdown output. Uses react-markdown at runtime when available; falls back
 * to a plain <pre> if react-markdown is not installed (keeps the contract
 * usable in test environments that stub out deps).
 */
export function MarkdownOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) return <div className="floom-output floom-output-markdown loading">…</div>;
  const source =
    typeof data === 'string'
      ? data
      : data === null || data === undefined
      ? ''
      : JSON.stringify(data, null, 2);
  // Lazy-load react-markdown via require so default renderer tests can run
  // without pulling DOM-heavy deps.
  let ReactMarkdown: React.ComponentType<{ children: string }> | null = null;
  try {
    // @ts-expect-error runtime optional dep
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ReactMarkdown = require('react-markdown').default;
  } catch {
    ReactMarkdown = null;
  }
  if (ReactMarkdown) {
    return (
      <div className="floom-output floom-output-markdown">
        <ReactMarkdown>{source}</ReactMarkdown>
      </div>
    );
  }
  return (
    <pre
      className="floom-output floom-output-markdown"
      style={{ whiteSpace: 'pre-wrap', margin: 0 }}
    >
      {source}
    </pre>
  );
}
