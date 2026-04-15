import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Plain-text output. First-class fallback for `type: string` responses.
 */
export function TextOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) {
    return <div className="floom-output floom-output-text loading">…</div>;
  }
  const text =
    typeof data === 'string'
      ? data
      : data === null || data === undefined
      ? ''
      : JSON.stringify(data, null, 2);
  return (
    <pre
      className="floom-output floom-output-text"
      style={{
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system',
        margin: 0,
      }}
    >
      {text}
    </pre>
  );
}
