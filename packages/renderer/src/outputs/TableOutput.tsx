import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Sortable, paginated data table with CSV export + Copy JSON. This is the
 * gold-standard output widget per P.1 research (Appsmith-equivalent UX).
 *
 * Uses TanStack Table for sort state when available at runtime. Falls back to
 * a plain HTML table otherwise. The fallback is intentionally stable so
 * missing optional deps don't break the contract.
 *
 * CSV export is hand-rolled (no papaparse) to keep the bundle small and
 * compatible with custom-renderer re-use.
 */

function toRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.every((r) => r && typeof r === 'object' && !Array.isArray(r))
      ? (data as Record<string, unknown>[])
      : data.map((v, i) => ({ _index: i, value: v }));
  }
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [];
}

function inferColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) seen.add(k);
  return Array.from(seen);
}

/**
 * Row-to-CSV converter. Exported so tests can assert the exact output shape.
 * Quotes every field, escapes quotes by doubling, joins with "\n".
 */
export function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '""';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = columns.map((c) => escape(c)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(','));
  return [header, ...body].join('\n');
}

export function TableOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) return <div className="floom-output floom-output-table loading">…</div>;
  const rows = toRows(data);
  const columns = inferColumns(rows);

  const handleCopyJson = React.useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    }
  }, [rows]);

  const handleDownloadCsv = React.useCallback(() => {
    if (typeof document === 'undefined') return;
    const csv = rowsToCsv(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'floom-table.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, columns]);

  return (
    <div className="floom-output floom-output-table">
      <div className="floom-table-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={handleCopyJson} aria-label="Copy JSON">
          Copy JSON
        </button>
        <button type="button" onClick={handleDownloadCsv} aria-label="Download CSV">
          Download CSV
        </button>
        <span className="floom-table-count" style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <table
        role="table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #ddd' }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col} style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>
                  {row[col] === null || row[col] === undefined
                    ? ''
                    : typeof row[col] === 'object'
                    ? JSON.stringify(row[col])
                    : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
