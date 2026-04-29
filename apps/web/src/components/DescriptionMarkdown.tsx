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
//
// r39-perf Fix 5: react-markdown + remark-gfm are lazy-loaded via a
// dynamic import so they don't land in the landing page's initial JS.
// The inner MarkdownInner component carries the heavy imports; the
// outer DescriptionMarkdown wrapper is a Suspense boundary that renders
// the plain description text as a fallback while the chunk loads.

import { lazy, Suspense, type CSSProperties } from 'react';

// Tags we allow in description markdown. Deliberately no images, no
// tables-heavy tags, no headings bigger than h4 (descriptions shouldn't
// compete with the hero h1/h2), no iframes, no raw HTML.
export const ALLOWED_ELEMENTS = [
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
export function isSingleLineInlineCandidate(description: string): boolean {
  if (description.length > 140) return false;
  if (description.includes('\n')) return false;
  if (/^\s*(#|-|\*|\d+\.|```)/m.test(description)) return false;
  return true;
}

// Inner component loaded lazily — carries the react-markdown + remark-gfm
// chunk so it doesn't block the initial paint.
const LazyMarkdownInner = lazy(() => import('./DescriptionMarkdownInner').then(m => ({ default: m.DescriptionMarkdownInner })));

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

  // Fallback: render plain text while the markdown chunk loads.
  // For inline descriptions this is visually identical.
  const fallback = inline ? (
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
      {description}
    </p>
  ) : (
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
      {description}
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      <LazyMarkdownInner
        description={description}
        style={style}
        testId={testId}
        inline={inline}
      />
    </Suspense>
  );
}
