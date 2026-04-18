// Big, legible single-value text display with an optional Copy button.
// Used for short primary outputs like a generated UUID, password, or
// short string where the value IS the answer (no decoration needed).
import { CopyButton } from './CopyButton';

export interface TextBigProps {
  value: string;
  copyable?: boolean;
}

export function TextBig({ value, copyable = true }: TextBigProps) {
  return (
    <div className="app-expanded-card" style={{ position: 'relative' }}>
      {copyable && (
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <CopyButton value={value} label="Copy" />
        </div>
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 18,
          fontWeight: 500,
          wordBreak: 'break-all',
          userSelect: 'all',
          paddingRight: copyable ? 72 : 0,
          lineHeight: 1.5,
        }}
      >
        {value}
      </div>
    </div>
  );
}
