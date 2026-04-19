// Headline-with-meta renderer for outputs where one field is clearly
// the answer and the rest are small metadata. Example: the `password`
// app returns {password, length, alphabet_size, entropy_bits} — we
// surface the password as a big monospace value and render the three
// numeric fields as muted chips. The alternative (2-col table or JSON
// dump) buries the answer under the stats.
import { CopyButton } from './CopyButton';

export interface HeadlineWithMetaProps {
  headline: string;
  headlineLabel?: string;
  meta: Array<{ label: string; value: string }>;
}

export function HeadlineWithMeta({ headline, headlineLabel, meta }: HeadlineWithMetaProps) {
  return (
    <div
      data-renderer="HeadlineWithMeta"
      className="app-expanded-card"
      style={{ position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <CopyButton value={headline} label="Copy" />
      </div>
      {headlineLabel && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          {headlineLabel}
        </div>
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 20,
          fontWeight: 500,
          color: 'var(--ink)',
          lineHeight: 1.4,
          wordBreak: 'break-all',
          userSelect: 'all',
          paddingRight: 72,
          marginBottom: meta.length > 0 ? 14 : 0,
        }}
      >
        {headline}
      </div>
      {meta.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 4,
          }}
        >
          {meta.map((m, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 999,
                fontSize: 12,
                color: 'var(--muted)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <span style={{ color: 'var(--muted)' }}>{m.label}:</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{m.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
