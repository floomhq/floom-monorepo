// Shared Copy button used by the v16 output library components.
// Extracted from OutputPanel.tsx so TextBig / CodeBlock / FileDownload
// can share the same visual + aria behaviour.
import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = 'Copy', className }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked; noop */
        }
      }}
      className={className || 'output-copy-btn'}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
