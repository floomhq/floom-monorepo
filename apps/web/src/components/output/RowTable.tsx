// Row table for outputs that are an array of objects with a consistent
// shape (e.g. search results, query rows, schedule). Uses the union of
// keys from the first 10 rows as columns, caps at 50 rows, and shows a
// "+ N more" note below when truncated.
//
// Values render as text. Nested objects/arrays collapse to a one-line
// JSON preview — if you need to inspect nested structure, use the
// JsonRaw fallback's "Show raw" disclosure.
import { CopyButton } from './CopyButton';

export interface RowTableProps {
  rows: Array<Record<string, unknown>>;
  label?: string;
  maxRows?: number;
  maxCols?: number;
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveColumns(rows: Array<Record<string, unknown>>, max: number): string[] {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 10)) {
    for (const k of Object.keys(row)) {
      keys.add(k);
      if (keys.size >= max) return Array.from(keys);
    }
  }
  return Array.from(keys);
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value);
  }
  if (typeof value === 'string') return value;
  // Nested — collapse to a one-line JSON preview so the table doesn't
  // blow up.
  const s = JSON.stringify(value);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export function RowTable({ rows, label, maxRows = 50, maxCols = 8 }: RowTableProps) {
  const visible = rows.slice(0, maxRows);
  const extra = rows.length - visible.length;
  const columns = deriveColumns(visible, maxCols);
  const copyValue = JSON.stringify(rows, null, 2);

  return (
    <div
      data-renderer="RowTable"
      className="app-expanded-card"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {label ?? `${rows.length} rows`}
        </div>
        <CopyButton value={copyValue} label="Copy JSON" />
      </div>
      <div style={{ maxHeight: 480, overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  style={{
                    position: 'sticky',
                    top: 0,
                    background: 'var(--card)',
                    borderBottom: '1px solid var(--line)',
                    textAlign: 'left',
                    padding: '10px 12px',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                  }}
                >
                  {humanizeKey(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    style={{
                      padding: '8px 12px',
                      color: 'var(--ink)',
                      wordBreak: 'break-word',
                      verticalAlign: 'top',
                    }}
                  >
                    {renderCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extra > 0 && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          + {extra} more
        </div>
      )}
    </div>
  );
}
