// v17 /install/:slug — per-app install wrapper.
// Fetches app metadata by slug, derives initials + icon colours, then
// renders InstallInClaudePage pre-filled with that app's MCP URL.
// Unknown slugs show a friendly "App not found" state with a link to /apps.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { InstallInClaudePage } from './InstallInClaudePage';
import { PageShell } from '../components/PageShell';
import { getApp, ApiError } from '../api/client';
import type { AppDetail } from '../lib/types';

// Fixed icon palettes — cycle by slug hash so each app gets a stable colour.
const PALETTES: Array<{ bg: string; fg: string }> = [
  { bg: '#fef3c7', fg: '#92400e' },
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#fce7f3', fg: '#9d174d' },
  { bg: '#d1fae5', fg: '#065f46' },
  { bg: '#ede9fe', fg: '#5b21b6' },
  { bg: '#fee2e2', fg: '#991b1b' },
  { bg: '#e0f2fe', fg: '#0c4a6e' },
  { bg: '#fef9c3', fg: '#713f12' },
];

function paletteFor(slug: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return PALETTES[h % PALETTES.length];
}

function initialsFor(name: string): string {
  const parts = name
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function InstallAppPage() {
  const { slug } = useParams<{ slug: string }>();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    getApp(slug)
      .then((data) => {
        setApp(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const is404 =
          err instanceof ApiError
            ? err.status === 404
            : false;
        if (is404) {
          setNotFound(true);
        } else {
          // For non-404 errors fall back to not-found UI too — the install
          // page has no meaningful content without a valid slug.
          setNotFound(true);
        }
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <PageShell title="Loading… · Floom">
        <div
          data-testid="install-app-loading"
          style={{
            maxWidth: 480,
            margin: '80px auto',
            textAlign: 'center',
            color: 'var(--muted,#64748b)',
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      </PageShell>
    );
  }

  if (notFound || !app) {
    return (
      <PageShell title="App not found · Floom">
        <div
          data-testid="install-app-not-found"
          style={{
            maxWidth: 480,
            margin: '80px auto',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--muted,#64748b)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            404 · App not found
          </div>

          <h1
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 28,
              fontWeight: 400,
              color: 'var(--ink,#0f172a)',
              margin: '0 0 12px',
            }}
          >
            {slug
              ? `"${slug}" doesn't exist.`
              : 'No app specified.'}
          </h1>

          <p
            style={{
              fontSize: 14,
              color: 'var(--muted,#64748b)',
              margin: '0 0 24px',
              lineHeight: 1.6,
            }}
          >
            The app may have been unpublished or the URL is wrong. Browse the
            catalog to find a working app.
          </p>

          <Link
            to="/apps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 18px',
              background: 'var(--ink,#0f172a)',
              color: '#fff',
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Browse apps
          </Link>
        </div>
      </PageShell>
    );
  }

  const palette = paletteFor(app.slug);

  return (
    <InstallInClaudePage
      app={{
        slug: app.slug,
        name: app.name,
        initials: initialsFor(app.name),
        iconBg: palette.bg,
        iconFg: palette.fg,
      }}
    />
  );
}
