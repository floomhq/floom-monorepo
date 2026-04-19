// Big single-value display for numeric and boolean outputs. Sibling of
// TextBig but formats the value for its type (number with thousands
// separator, boolean as a pill-style true/false token) and drops the
// Copy button for boolean (not useful). Used by the v16 renderer cascade
// when the run output is a scalar we'd otherwise JSON-dump.
import { CopyButton } from './CopyButton';

export interface ScalarBigProps {
  value: number | boolean | string;
  label?: string;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  // Keep at most 4 decimals; strip trailing zeros.
  return Number(n.toFixed(4))
    .toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function ScalarBig({ value, label }: ScalarBigProps) {
  const display =
    typeof value === 'number'
      ? formatNumber(value)
      : typeof value === 'boolean'
      ? value
        ? 'true'
        : 'false'
      : String(value);
  const copyable = typeof value !== 'boolean';

  return (
    <div
      data-renderer="ScalarBig"
      className="app-expanded-card"
      style={{ position: 'relative' }}
    >
      {copyable && (
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <CopyButton value={display} label="Copy" />
        </div>
      )}
      {label && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 28,
          fontWeight: 600,
          color: 'var(--ink)',
          lineHeight: 1.2,
          paddingRight: copyable ? 72 : 0,
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
      >
        {display}
      </div>
    </div>
  );
}
