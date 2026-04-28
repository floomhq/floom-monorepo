// v17 Docs hub hero: 3-card "where to start" row right under the H1.
//
// Shown once, at the top of /docs. Each card is an iconified quick jump
// to the highest-signal entry points: deploy, protocol, self-host. No
// accent backgrounds, no gradients, no colored left borders — just a
// neutral surface card with a stroke icon and a title/subtitle. The
// single accent is the hover-revealed arrow + the accent color on the
// title hover.
//
// The three routes are the same canonical routes from DocsSidebar
// (/docs/quickstart, /protocol, /docs/self-host) so we never ship a
// hero card that links somewhere not in the nav.
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, FileText, Server, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface HeroCard {
  to: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

const CARDS: HeroCard[] = [
  {
    to: '/docs/quickstart',
    title: 'Deploy in 60 seconds',
    subtitle: 'Ship your first app with one curl command.',
    icon: Rocket,
  },
  {
    to: '/protocol',
    title: 'Protocol spec',
    subtitle: 'The manifest format every Floom app speaks.',
    icon: FileText,
  },
  {
    to: '/docs/self-host',
    title: 'Self-host with Docker',
    subtitle: 'Run Floom on your own box in one image.',
    icon: Server,
  },
];

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 12,
  margin: '0 0 28px',
  maxWidth: 760,
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '16px 16px 14px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  textDecoration: 'none',
  color: 'inherit',
  transition: 'border-color 0.15s, transform 0.15s',
  position: 'relative',
};

const iconRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: 'var(--muted)',
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
};

const subtitleStyle: CSSProperties = {
  fontSize: 12.5,
  color: 'var(--muted)',
  lineHeight: 1.45,
};

export function DocsHeroCards() {
  return (
    <div className="docs-hero-cards" style={gridStyle}>
      {/* R13 (2026-04-28): inline <style> migrated to
          styles/csp-inline-style-migrations.css for CSP compliance. */}
      {CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <Link key={card.to} to={card.to} className="docs-hero-card" style={cardStyle}>
            <div style={iconRowStyle}>
              <Icon size={18} strokeWidth={1.6} />
              <ArrowRight size={14} strokeWidth={1.6} className="docs-hero-card-arrow" />
            </div>
            <div style={titleStyle}>{card.title}</div>
            <div style={subtitleStyle}>{card.subtitle}</div>
          </Link>
        );
      })}
    </div>
  );
}
