import { Link } from 'react-router-dom';

export function AboutFloomResponse() {
  return (
    <div className="assistant-turn">
      <div className="app-expanded-card">
        <p style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
          Floom — infra for agentic work.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.7, color: 'var(--muted)' }}>
          One manifest. Every agent surface. Any CLI, MCP server, or Python library becomes a chat, a tool call, and an HTTP endpoint in 10 seconds.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.7 }}>
          Every Floom app exposes four surfaces from a single{' '}
          <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--line)' }}>
            floom.yaml
          </code>
          : a chat UI, an MCP server, an HTTP endpoint, and a CLI command. Built in Hamburg by Federico De Ponte and contributors.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            to="/protocol"
            style={{
              fontSize: 13,
              color: 'var(--accent)',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Read the protocol →
          </Link>
          <a
            href="https://github.com/floomhq/floom-monorepo"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 13,
              color: 'var(--muted)',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <use href="#icon-github" />
            </svg>
            View source
          </a>
        </div>
      </div>
    </div>
  );
}
