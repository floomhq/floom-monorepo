/**
 * GitHubStarsBadge — live star count for floomhq/floom with a
 * localStorage cache (10 min TTL) to avoid hammering the GitHub API.
 *
 * Rendered inside the TopBar (desktop + mobile), sitting between the
 * Docs link and the Sign in / Sign up pair. When we haven't loaded a
 * count yet it renders a discreet "Star" pill with no number, so the
 * layout doesn't jump on hydrate.
 *
 * Icon: official GitHub SimpleIcons mark (inline SVG, not text-in-circle).
 */
import { useEffect, useState } from 'react';

const REPO = 'floomhq/floom';
const CACHE_KEY = 'floom:gh-stars';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

type Cached = { count: number; ts: number };

function readCache(): Cached | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (typeof parsed?.count !== 'number' || typeof parsed?.ts !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(count: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ count, ts: Date.now() }),
    );
  } catch {
    // Ignore quota/serialisation errors — the UI still works without cache.
  }
}

function formatCount(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  }
  return String(n);
}

export interface GitHubStarsBadgeProps {
  /** Visually compact variant used inside the TopBar pill row. */
  compact?: boolean;
  /** Hide label on narrow screens — show just the star count. */
  dataTestId?: string;
}

export function GitHubStarsBadge({
  compact = false,
  dataTestId = 'gh-stars-badge',
}: GitHubStarsBadgeProps) {
  const [count, setCount] = useState<number | null>(() => {
    const cached = readCache();
    if (!cached) return null;
    // Even if stale, render the cached number on first paint so the UI
    // doesn't flash. The fetch below will refresh it.
    return cached.count;
  });

  useEffect(() => {
    const cached = readCache();
    const fresh = cached && Date.now() - cached.ts < TTL_MS;
    if (fresh) {
      setCount(cached.count);
      return;
    }
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stargazers_count?: number } | null) => {
        if (cancelled || !d || typeof d.stargazers_count !== 'number') return;
        setCount(d.stargazers_count);
        writeCache(d.stargazers_count);
      })
      .catch(() => {
        // Network/CORS failure — keep whatever cached value we already have.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = count === null ? 'Star' : formatCount(count);

  return (
    <a
      href={`https://github.com/${REPO}`}
      target="_blank"
      rel="noreferrer"
      aria-label={
        count === null
          ? 'Star floomhq/floom on GitHub'
          : `floomhq/floom on GitHub (${count} stars)`
      }
      data-testid={dataTestId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '5px 9px' : '7px 11px',
        borderRadius: 999,
        fontSize: compact ? 12 : 13,
        fontWeight: 600,
        lineHeight: 1,
        color: '#0e0e0c',
        background: '#fafaf8',
        border: '1px solid rgba(14,14,12,0.18)',
        textDecoration: 'none',
        transition: 'border-color 0.12s, background 0.12s',
      }}
    >
      <svg
        width={compact ? 13 : 14}
        height={compact ? 13 : 14}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        {/* SimpleIcons `github` mark — real SVG path, not text-in-circle. */}
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{label}</span>
    </a>
  );
}
