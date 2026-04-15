import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Error card with optional retry button. Used as the `output-error` state
 * terminal and also as the ErrorBoundary fallback when a custom renderer
 * crashes.
 */
export function ErrorOutput({ error, onRetry }: RenderProps): React.ReactElement {
  const message = error?.message || 'Something went wrong.';
  const code = error?.code;
  return (
    <div
      className="floom-output floom-output-error"
      role="alert"
      style={{
        padding: 12,
        border: '1px solid #f5c2c7',
        borderRadius: 4,
        background: '#fff5f5',
        color: '#842029',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>Error{code ? ` (${code})` : ''}</strong>
      <div style={{ fontSize: 13, marginBottom: 8 }}>{message}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} aria-label="Retry">
          Retry
        </button>
      )}
    </div>
  );
}
