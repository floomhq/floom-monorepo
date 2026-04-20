import type { DetectedApp } from '../../../lib/types';

export function DetectedSummary({
  detected,
  source,
}: {
  detected: DetectedApp;
  source: 'github' | 'openapi' | null;
}) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          fontSize: 12,
          color: 'var(--muted)',
          flexWrap: 'wrap',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 8l3 3 7-7"
            stroke="#1a7f37"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {source === 'github' && <span>Imported from GitHub.</span>}
        Found {detected.tools_count} thing{detected.tools_count === 1 ? '' : 's'} your app can do · sign-in:{' '}
        <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {detected.auth_type || 'none'}
        </code>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 180,
          overflowY: 'auto',
        }}
        data-testid="detected-actions"
      >
        {detected.actions.slice(0, 20).map((a) => (
          <li
            key={a.name}
            style={{
              fontSize: 13,
              color: 'var(--ink)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            <strong>{a.name}</strong>
            {a.description && (
              <span style={{ color: 'var(--muted)', fontFamily: 'Inter, sans-serif' }}>
                {' '}
                : {a.description}
              </span>
            )}
          </li>
        ))}
        {detected.actions.length > 20 && (
          <li style={{ fontSize: 12, color: 'var(--muted)' }}>
            …and {detected.actions.length - 20} more
          </li>
        )}
      </ul>
    </div>
  );
}
