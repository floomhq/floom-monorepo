// /studio/build — waitlist gate page (r39, 2026-04-29).
//
// Publishing apps is rolling out via waitlist. Previously this page silently
// redirected to /me/agent-keys with zero explanation — HN bait because the
// TopBar "Studio" nav leads here and visitors got dumped into a settings page.
// Now we render a simple, honest page: "coming soon, join the list."
//
// Task E: fix /studio/build silent redirect (r39 landing-waitlist-alignment).

import { Link } from 'react-router-dom';
import { ArrowRight, Layers } from 'lucide-react';
import { PageShell } from '../components/PageShell';
import { waitlistHref } from '../lib/waitlistCta';

export function StudioBuildPage() {
  const waitlistLink = waitlistHref('studio-build');

  return (
    <PageShell
      title="Publish an app · Floom"
      description="Publishing apps to Floom is rolling out via waitlist. Join to get early access."
    >
      <div
        style={{
          maxWidth: 560,
          margin: '80px auto',
          textAlign: 'center',
          padding: '0 24px',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'rgba(4,120,87,0.08)',
            border: '1px solid rgba(4,120,87,0.18)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#047857',
            marginBottom: 20,
          }}
        >
          <Layers size={26} strokeWidth={1.6} />
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 32,
            lineHeight: 1.1,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            margin: '0 0 14px',
          }}
        >
          Publishing apps is rolling out via waitlist.
        </h1>

        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: 'var(--muted)',
            margin: '0 0 28px',
            maxWidth: 480,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Paste your OpenAPI spec or GitHub repo, get a public URL, an MCP
          server, and a typed API — all from one deploy. Join the waitlist for
          early access.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            to={waitlistLink}
            data-testid="studio-build-waitlist-cta"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--ink)',
              color: '#fff',
              border: '1px solid var(--ink)',
              borderRadius: 999,
              padding: '12px 22px',
              fontSize: 14.5,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Join the waitlist
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link
            to="/apps"
            data-testid="studio-build-browse-cta"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 999,
              padding: '12px 22px',
              fontSize: 14.5,
              fontWeight: 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Browse live apps
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
