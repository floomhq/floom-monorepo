// /changelog — renders the live floomhq/floom GitHub Releases feed.
//
// 2026-04-28 (R7.8): rewritten from a static stub. The page now fetches
// /api/gh-releases (server-side proxy, 10-min cache, optional PAT) and
// renders each tagged release inline: timestamp + tag pill + title + body.
// The previous version pointed users out to GitHub Releases — this version
// brings the content in-page so visitors don't bounce. GitHub Releases stays
// the source of truth (link at the bottom).
//
// Loading: skeleton row.
// Error / empty: friendly fallback that still links to GitHub Releases.
// Body markdown: rendered through react-markdown with the same allow-list
// the rest of the app uses (no raw HTML, no images, no scripts).

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageShell } from '../components/PageShell';

interface ReleaseItem {
  tag: string;
  name: string;
  published_at: string;
  body_md: string;
  url: string;
}

interface ReleasesResponse {
  releases: ReleaseItem[];
  source: 'live' | 'cache' | 'fallback';
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; releases: ReleaseItem[] };

const SECTION_STYLE: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '56px 0',
};

const HEADER_STYLE: CSSProperties = {
  textAlign: 'center',
  marginBottom: 40,
};

const EYEBROW_STYLE: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 12px',
};

const H1_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 52,
  lineHeight: 1.08,
  letterSpacing: '-0.025em',
  color: 'var(--ink)',
  margin: '0 0 20px',
  textWrap: 'balance' as unknown as 'balance',
};

const SUB_STYLE: CSSProperties = {
  fontSize: 18,
  lineHeight: 1.6,
  color: 'var(--muted)',
  margin: '0 auto',
  maxWidth: 560,
};

const RELEASE_CARD_STYLE: CSSProperties = {
  borderTop: '1px solid var(--line)',
  padding: '32px 0',
};

const RELEASE_META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  margin: '0 0 12px',
};

const RELEASE_DATE_STYLE: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  letterSpacing: '0.04em',
};

const RELEASE_TAG_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 600,
  color: '#047857',
  background: 'rgba(4,120,87,0.08)',
  border: '1px solid rgba(4,120,87,0.18)',
  padding: '3px 8px',
  borderRadius: 999,
};

const RELEASE_TITLE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 26,
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  margin: '0 0 16px',
};

const RELEASE_BODY_STYLE: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: 'var(--ink)',
};

const SKELETON_LINE_STYLE: CSSProperties = {
  height: 14,
  background: 'rgba(14,14,12,0.06)',
  borderRadius: 4,
};

const FOOTER_LINK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 32,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
  textDecoration: 'none',
  borderBottom: '1px solid var(--line)',
  paddingBottom: 2,
};

// Keep the markdown surface tight: no images, no big headings competing
// with the release title we already render. Same allow-list philosophy
// as DescriptionMarkdown.
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
  'h5',
  'h6',
  'br',
  'del',
  'blockquote',
  'hr',
];

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="nofollow noreferrer noopener"
      style={{ color: 'var(--accent)', textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
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
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 1.5,
        padding: 14,
        background: '#1b1a17',
        color: '#f5f4f0',
        borderRadius: 8,
        overflowX: 'auto',
        margin: '12px 0',
      }}
    >
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: '8px 0 12px', paddingLeft: 20 }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: '8px 0 12px', paddingLeft: 20 }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ margin: '4px 0' }}>{children}</li>,
  p: ({ children }) => <p style={{ margin: '0 0 12px' }}>{children}</p>,
  h3: ({ children }) => (
    <h3
      style={{
        fontSize: 16,
        fontWeight: 700,
        margin: '20px 0 8px',
        color: 'var(--ink)',
      }}
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      style={{
        fontSize: 14,
        fontWeight: 700,
        margin: '16px 0 6px',
        color: 'var(--ink)',
      }}
    >
      {children}
    </h4>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '12px 0',
        padding: '4px 14px',
        borderLeft: '3px solid var(--line)',
        color: 'var(--muted)',
      }}
    >
      {children}
    </blockquote>
  ),
};

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function ReleaseSkeleton() {
  return (
    <div
      style={RELEASE_CARD_STYLE}
      data-testid="changelog-skeleton"
      aria-hidden="true"
    >
      <div style={RELEASE_META_ROW_STYLE}>
        <div style={{ ...SKELETON_LINE_STYLE, width: 110 }} />
        <div style={{ ...SKELETON_LINE_STYLE, width: 64 }} />
      </div>
      <div style={{ ...SKELETON_LINE_STYLE, width: '60%', height: 22, margin: '0 0 16px' }} />
      <div style={{ ...SKELETON_LINE_STYLE, width: '95%', margin: '0 0 8px' }} />
      <div style={{ ...SKELETON_LINE_STYLE, width: '88%', margin: '0 0 8px' }} />
      <div style={{ ...SKELETON_LINE_STYLE, width: '72%' }} />
    </div>
  );
}

function ReleaseCard({ release }: { release: ReleaseItem }) {
  return (
    <article
      style={RELEASE_CARD_STYLE}
      data-testid={`changelog-release-${release.tag}`}
    >
      <div style={RELEASE_META_ROW_STYLE}>
        <span style={RELEASE_DATE_STYLE}>
          {formatDate(release.published_at)}
        </span>
        <a
          href={release.url}
          target="_blank"
          rel="noreferrer noopener"
          style={{ ...RELEASE_TAG_PILL_STYLE, textDecoration: 'none' }}
        >
          {release.tag}
        </a>
      </div>
      <h2 style={RELEASE_TITLE_STYLE}>{release.name || release.tag}</h2>
      {release.body_md.trim() ? (
        <div style={RELEASE_BODY_STYLE}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            allowedElements={ALLOWED_ELEMENTS}
            unwrapDisallowed
            components={markdownComponents}
          >
            {release.body_md}
          </ReactMarkdown>
        </div>
      ) : (
        <p
          style={{
            ...RELEASE_BODY_STYLE,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          No release notes for this tag.
        </p>
      )}
    </article>
  );
}

export function ChangelogPage() {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gh-releases', {
      headers: { Accept: 'application/json' },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ReleasesResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ok', releases: data.releases ?? [] });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'unknown error';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell
      title="Changelog · Floom"
      description="Ship notes from the Floom team. Platform features, protocol changes, and apps that recently went live."
    >
      <section style={SECTION_STYLE}>
        <header style={HEADER_STYLE}>
          <p style={EYEBROW_STYLE}>CHANGELOG</p>
          <h1 style={H1_STYLE}>What's new in Floom</h1>
          <p style={SUB_STYLE}>
            Tagged releases from{' '}
            <a
              href="https://github.com/floomhq/floom"
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--accent)' }}
            >
              floomhq/floom
            </a>
            . Updated whenever we ship.
          </p>
        </header>

        <div data-testid="changelog-list">
          {state.status === 'loading' && (
            <>
              <ReleaseSkeleton />
              <ReleaseSkeleton />
              <ReleaseSkeleton />
            </>
          )}

          {state.status === 'error' && (
            <div
              style={{
                ...RELEASE_CARD_STYLE,
                textAlign: 'center',
              }}
              data-testid="changelog-error"
            >
              <p style={{ ...SUB_STYLE, marginBottom: 12 }}>
                Couldn't load releases right now ({state.message}).
              </p>
              <a
                href="https://github.com/floomhq/floom/releases"
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  color: 'var(--accent)',
                  fontWeight: 600,
                  textDecoration: 'underline',
                }}
              >
                Read them on GitHub →
              </a>
            </div>
          )}

          {state.status === 'ok' && state.releases.length === 0 && (
            <div
              style={{
                ...RELEASE_CARD_STYLE,
                textAlign: 'center',
              }}
              data-testid="changelog-empty"
            >
              <p style={{ ...SUB_STYLE, marginBottom: 12 }}>
                No tagged releases yet. We're shipping fast — check back soon.
              </p>
              <a
                href="https://github.com/floomhq/floom/releases"
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  color: 'var(--accent)',
                  fontWeight: 600,
                  textDecoration: 'underline',
                }}
              >
                Watch on GitHub →
              </a>
            </div>
          )}

          {state.status === 'ok' &&
            state.releases.length > 0 &&
            state.releases.map((release) => (
              <ReleaseCard key={release.tag} release={release} />
            ))}
        </div>

        {state.status === 'ok' && state.releases.length > 0 && (
          <div style={{ textAlign: 'center' }}>
            <a
              href="https://github.com/floomhq/floom/releases"
              target="_blank"
              rel="noreferrer noopener"
              style={FOOTER_LINK_STYLE}
              data-testid="changelog-view-all"
            >
              View all releases on GitHub →
            </a>
          </div>
        )}
      </section>
    </PageShell>
  );
}
