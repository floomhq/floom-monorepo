import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Key-value viewer for `type: object` responses. Renders a two-column
 * definition list. Nested objects are serialized as inline code.
 */
export function ObjectOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) return <div className="floom-output floom-output-object loading">…</div>;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return (
      <pre className="floom-output floom-output-object" style={{ margin: 0 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    <dl
      className="floom-output floom-output-object"
      style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}
    >
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt style={{ fontWeight: 600, opacity: 0.7 }}>{key}</dt>
          <dd style={{ margin: 0 }}>
            {value === null || value === undefined
              ? <span style={{ opacity: 0.4 }}>—</span>
              : typeof value === 'object'
              ? <code style={{ fontSize: 12 }}>{JSON.stringify(value)}</code>
              : String(value)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
