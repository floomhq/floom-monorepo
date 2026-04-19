// Clickable-URL card for outputs whose sole artefact is a URL. Shows
// the favicon of the destination (loaded via Google's public favicon
// service — cheap, no tracking for the Floom origin) and the URL
// itself. Hover underline, target=_blank + noopener so it opens in a
// new tab safely. Copy button for the raw URL.
//
// We deliberately don't fetch the URL to get an OG preview — that's
// a server-side concern and would need rate-limit + allowlist work.
// A favicon is enough of a "this looks real" cue.
import { useState } from 'react';
import { CopyButton } from './CopyButton';

export interface UrlLinkProps {
  url: string;
  label?: string;
}

function safeHostname(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

export function UrlLink({ url, label }: UrlLinkProps) {
  const host = safeHostname(url);
  const [faviconOk, setFaviconOk] = useState(true);
  const faviconUrl = host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
    : null;

  return (
    <div
      data-renderer="UrlLink"
      className="app-expanded-card"
      style={{ position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <CopyButton value={url} label="Copy" />
      </div>
      {label && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingRight: 72,
        }}
      >
        {faviconUrl && faviconOk && (
          <img
            src={faviconUrl}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            onError={() => setFaviconOk(false)}
            style={{ flexShrink: 0, borderRadius: 3 }}
          />
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--accent)',
            textDecoration: 'none',
            borderBottom: '1px solid transparent',
            fontSize: 15,
            fontFamily: "'JetBrains Mono', monospace",
            wordBreak: 'break-all',
            minWidth: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = 'transparent';
          }}
        >
          {url}
        </a>
      </div>
    </div>
  );
}
