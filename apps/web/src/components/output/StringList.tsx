// Bulleted / pill list renderer for outputs that are an array of short
// strings (e.g. uuid → {uuids: ['abc-123', ...]}). Uses pill styling
// when items are short and look like tokens (uuid, slug, id); falls
// back to a bullet list for longer free text. Per-item copy button
// because the whole reason you ran the app was probably to grab one
// of these strings.
import { CopyButton } from './CopyButton';

export interface StringListProps {
  items: string[];
  label?: string;
  /** Max rows shown before "+ N more" folds the tail. Default 20. */
  maxItems?: number;
}

function looksLikeToken(items: string[]): boolean {
  // All items short (<= 48 chars), no embedded spaces — renders nicely
  // as chips. Longer prose goes through the bullet list path.
  if (items.length === 0) return false;
  return items.every((s) => typeof s === 'string' && s.length <= 48 && !s.includes(' '));
}

export function StringList({ items, label, maxItems = 20 }: StringListProps) {
  const visible = items.slice(0, maxItems);
  const extra = items.length - visible.length;
  const asChips = looksLikeToken(visible);
  const allText = items.join('\n');

  return (
    <div
      data-renderer="StringList"
      className="app-expanded-card"
      style={{ position: 'relative' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
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
          {label ?? `${items.length} items`}
        </div>
        <CopyButton value={allText} label="Copy all" />
      </div>

      {asChips ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {visible.map((item, i) => (
            <ChipItem key={i} value={item} />
          ))}
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink)',
          }}
        >
          {visible.map((item, i) => (
            <li key={i} style={{ marginBottom: 4, wordBreak: 'break-word' }}>
              {item}
            </li>
          ))}
        </ul>
      )}

      {extra > 0 && (
        <div
          style={{
            marginTop: 10,
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

function ChipItem({ value }: { value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        border: '1px solid var(--line)',
        borderRadius: 999,
        background: 'var(--card)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        color: 'var(--ink)',
        userSelect: 'all',
        wordBreak: 'break-all',
      }}
    >
      {value}
    </span>
  );
}
