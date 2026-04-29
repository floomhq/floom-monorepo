// Upgrade 3 (2026-04-19): render `manifest.description` as markdown
// instead of plain text. Creators can now use **bold**, [links](url),
// bullet lists, and inline `code` in their app descriptions.
//
// XSS safety: react-markdown 9 does NOT render raw HTML unless the
// caller explicitly adds rehype-raw. We deliberately stay on the safe
// default so a malicious creator can't inject <script> via description.
// The allowed-elements list is also explicit to block any future
// regressions; anything outside the list is dropped at render time.
//
// Accessibility: short (single-line) descriptions render inline so the
// hero paragraph still flows as body text. Longer descriptions render
// as a block with normal prose spacing. Both paths use the same
// markdown pipeline so behaviour stays consistent.

import type { CSSProperties, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Tags we allow in description markdown. Deliberately no images, no
// tables-heavy tags, no headings bigger than h4 (descriptions shouldn't
// compete with the hero h1/h2), no iframes, no raw HTML.
const ALLOWED_ELEMENTS = [
  'p',
  'a',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'h3',
  'h4',
  'br',
  'del',
];

// Single-line heuristic: if the raw description is <= 140 chars AND has
// no newlines AND no block markdown (headings, lists, code fences), we
// render it as inline prose to avoid stealing vertical space on short
// descriptions (most apps still have a 1-line pitch).
function isSingleLineInlineCandidate(description: string): boolean {
  if (description.length > 140) return false;
  if (description.includes('\n')) return false;
  if (/^\s*(#|-|\*|\d+\.|```)/m.test(description)) return false;
  return true;
}

interface DescriptionMarkdownProps {
  description: string;
  style?: CSSProperties;
  /** Override the root testid — default 'product-description'. */
  testId?: string;
}

export function DescriptionMarkdown({
  description,
  style,
  testId = 'product-description',
}: DescriptionMarkdownProps) {
  const inline = isSingleLineInlineCandidate(description);
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
          fontFamily: 'var(--font-mono)',
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
