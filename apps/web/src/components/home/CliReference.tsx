/**
 * CliReference — compact "works in any coding agent" code strip.
 *
 * Placement: BELOW the hero (Federico 2026-04-23 — removed from hero, moved
 * below hero as a smaller strip).
 *
 * Shows the beta slash command (`/floom-deploy`) and shell equivalent
 * (`floom deploy`) for users with Cloud publishing access.
 *
 * Light theme terminal per the 2026-04-21 "no black terminals on landing"
 * correction (memory · feedback_light_terminals). Downsized vs the original
 * hero-inline version: narrower max-width, smaller padding, smaller font.
 */
import type { CSSProperties } from 'react';

const SHELL_STYLE: CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '0 12px',
};

const EYEBROW_STYLE: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10.5,
  color: 'var(--muted)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontWeight: 600,
  textAlign: 'center',
  marginBottom: 10,
};

const BLOCK_STYLE: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '12px 14px',
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 12,
  lineHeight: 1.65,
  textAlign: 'left',
  color: 'var(--ink)',
};

const DIM: CSSProperties = { color: 'var(--muted)' };
const ACCENT: CSSProperties = { color: 'var(--accent)', fontWeight: 600 };

export function CliReference() {
  return (
    <div data-testid="cli-reference" style={SHELL_STYLE}>
      <div style={EYEBROW_STYLE}>Beta publisher workflow</div>
      <div style={BLOCK_STYLE}>
        <div>
          <span style={DIM}>{'>'}</span>{' '}
          <span style={{ fontWeight: 600 }}>/floom-deploy</span>
          <span style={DIM}> &nbsp;# beta access</span>
        </div>
        <div>
          <span style={DIM}>$</span>{' '}
          <span style={{ fontWeight: 600 }}>floom deploy</span>
          <span style={DIM}> &nbsp;# beta access</span>
        </div>
        <div style={{ marginTop: 4, ...DIM }}>
          <span style={ACCENT}>&#10003;</span> Self-host today, or join the waitlist for hosted publish access
        </div>
      </div>
    </div>
  );
}
