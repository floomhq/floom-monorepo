import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function extractToc(md: string): TocItem[] {
  const lines = md.split('\n');
  const toc: TocItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (!match) continue;
    toc.push({
      id: slugify(match[2].replace(/`/g, '')),
      text: match[2].replace(/`/g, ''),
      level: match[1].length,
    });
  }
  return toc;
}

function childrenToText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
}

// Docs-sexier pass (2026-04-24):
// - H1 uses the display font at 40px for a real page title, matching
//   the docs landing hero rhythm. H2 gets a subtle top border so each
//   section break reads, without shouting like an <hr>. H3 stays ink
//   medium for sub-sections.
// - All headings cap at the prose max-width the article sets, so
//   nothing runs beyond the reading column on wide screens.
function headingStyle(level: number): React.CSSProperties {
  if (level === 1) {
    return {
      fontFamily: 'var(--font-display)',
      fontSize: 40,
      fontWeight: 800,
      letterSpacing: '-0.02em',
      color: 'var(--ink)',
      margin: '0 0 16px',
      lineHeight: 1.1,
      scrollMarginTop: 72,
    };
  }
  if (level === 2) {
    return {
      fontFamily: 'var(--font-display)',
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: '-0.015em',
      color: 'var(--ink)',
      margin: '40px 0 14px',
      paddingTop: 18,
      borderTop: '1px solid var(--line)',
      lineHeight: 1.2,
      scrollMarginTop: 72,
    };
  }
  if (level === 3) {
    return {
      fontSize: 17,
      fontWeight: 600,
      color: 'var(--ink)',
      margin: '28px 0 10px',
      letterSpacing: '-0.005em',
      lineHeight: 1.3,
      scrollMarginTop: 72,
    };
  }
  return {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--ink)',
    margin: '20px 0 8px',
    lineHeight: 1.3,
    scrollMarginTop: 72,
  };
}

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'underline',
};

export const lightCodeBlockStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
  padding: '20px 16px',
  borderRadius: 10,
  overflowX: 'auto',
  lineHeight: 1.6,
  margin: 0,
  whiteSpace: 'pre',
};

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="copy-btn"
      onClick={() => {
        try {
          navigator.clipboard.writeText(code).catch(() => {});
        } catch {
          // ignore clipboard errors
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        fontSize: 11,
        padding: '3px 10px',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: copied ? 'var(--accent)' : 'var(--muted)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'color 0.15s ease',
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => {
    const text = childrenToText(children);
    return <h1 id={slugify(text.replace(/`/g, ''))} style={headingStyle(1)}>{children}</h1>;
  },
  h2: ({ children }: { children?: React.ReactNode }) => {
    const text = childrenToText(children);
    return <h2 id={slugify(text.replace(/`/g, ''))} style={headingStyle(2)}>{children}</h2>;
  },
  h3: ({ children }: { children?: React.ReactNode }) => {
    const text = childrenToText(children);
    return <h3 id={slugify(text.replace(/`/g, ''))} style={headingStyle(3)}>{children}</h3>;
  },
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ink)', margin: '12px 0' }}>
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: '10px 0', paddingLeft: 22 }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: '10px 0', paddingLeft: 22 }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', marginBottom: 4 }}>
      {children}
    </li>
  ),
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '28px 0' }} />
  ),
  // Render markdown blockquotes as docs callouts: subtle warm-neutral
  // bg + left accent stripe (brand green, matches the sidebar active
  // state). Authors write ">  Note: foo" in the markdown and get a
  // Stripe-docs-style "pro tip" block — no custom directive syntax
  // needed, no amber/red alarm colors.
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <aside
      style={{
        margin: '20px 0',
        padding: '14px 18px',
        background: 'var(--accent-soft)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: '0 10px 10px 0',
        color: 'var(--ink)',
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      {children}
    </aside>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href && href.startsWith('/')) {
      return (
        <Link to={href} style={linkStyle}>
          {children}
        </Link>
      );
    }
    const isHash = Boolean(href && href.startsWith('#'));
    return (
      <a
        href={href}
        target={isHash ? undefined : '_blank'}
        rel={isHash ? undefined : 'noreferrer'}
        style={linkStyle}
      >
        {children}
      </a>
    );
  },
  code: ({ inline, className, children }: {
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) => {
    const raw = childrenToText(children).replace(/\n$/, '');
    if (inline) {
      return (
        <code
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.86em',
            background: '#f5f5f3',
            border: '1px solid var(--line)',
            padding: '1px 6px',
            borderRadius: 5,
            color: 'var(--ink)',
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <div style={{ position: 'relative', margin: '16px 0' }}>
        <pre style={lightCodeBlockStyle}>
          <code className={className}>{raw}</code>
        </pre>
        <CopyCodeButton code={raw} />
      </div>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
};
