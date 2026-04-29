// Inner markdown renderer — carries the react-markdown + remark-gfm imports.
// Loaded lazily from DescriptionMarkdown.tsx so the ~150 KB markdown chunk
// does NOT appear in the landing page's initial JS bundle.
// r39-perf Fix 5.

import type { CSSProperties, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ALLOWED_ELEMENTS } from './DescriptionMarkdown';

interface DescriptionMarkdownInnerProps {
  description: string;
  style?: CSSProperties;
  testId: string;
  inline: boolean;
}

export function DescriptionMarkdownInner({
  description,
  style,
  testId,
  inline,
}: DescriptionMarkdownInnerProps) {
  const components: Components = {
    // Always open outbound links in a new tab + nofollow noreferrer.
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="nofollow noreferrer noopener"
        style={{ color: 'var(--accent)', textDecoration: 'underline' }}
      >
        {children as ReactNode}
      </a>
    ),
    // Inline code gets a subtle background so it reads as code without
    // the heavy chrome of a fenced block.
    code: ({ children }) => (
      <code
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: '0.9em',
          padding: '1px 6px',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
        }}
      >
        {children as ReactNode}
      </code>
    ),
    // Paragraphs inside the inline variant collapse to fragments so the
    // surrounding <p> we render stays a single block.
    p: ({ children }) =>
      inline ? <>{children as ReactNode}</> : <p style={{ margin: '0 0 12px' }}>{children as ReactNode}</p>,
  };
  const commonProps = {
    remarkPlugins: [remarkGfm],
    allowedElements: ALLOWED_ELEMENTS,
    unwrapDisallowed: true,
    components,
  };

  if (inline) {
    return (
      <p
        data-testid={testId}
        style={{
          fontSize: 16,
          color: 'var(--text-2, var(--ink))',
          margin: '0 0 24px',
          lineHeight: 1.55,
          maxWidth: 620,
          whiteSpace: 'normal',
          ...style,
        }}
      >
        <ReactMarkdown {...commonProps}>{description}</ReactMarkdown>
      </p>
    );
  }

  return (
    <div
      data-testid={testId}
      style={{
        fontSize: 16,
        color: 'var(--text-2, var(--ink))',
        margin: '0 0 24px',
        lineHeight: 1.6,
        maxWidth: 620,
        ...style,
      }}
    >
      <ReactMarkdown {...commonProps}>{description}</ReactMarkdown>
    </div>
  );
}
