// HowItWorksDiagram — R15 UI-3 (2026-04-28).
//
// 4-stage horizontal flow that explains, in one glance, how a Floom app
// flows from source through the runtime out to any agent. Sits between
// "From idea to shipped app in 3 steps" and the showcase on the landing
// page (LandingV17Page).
//
// Federico's brief (launch user feedback PDF): Vladimir persona's "black
// box" complaint — visitors couldn't tell what Floom actually does once
// they hit Run. This 4-stage diagram makes the data path explicit:
//
//   [Your code/spec] → [Floom container] → [MCP + HTTP + UI] → [Any agent]
//
// Desktop: horizontal 4-up grid with arrow connectors.
// Mobile: vertical stack with arrow connectors (chevron-down).
//
// Uses existing landing tokens (--ink, --muted, --accent, --line, --card)
// so the diagram drops into the visual system without new theming.

import { FileCode, Box, Plug, Bot } from 'lucide-react';
import { SectionEyebrow } from './SectionEyebrow';

interface Stage {
  num: string;
  title: string;
  body: string;
  Icon: typeof FileCode;
  /**
   * Optional small chips rendered under the body (used by stage 3 for
   * the MCP/HTTP/UI surfaces). Empty for the other stages.
   */
  chips?: string[];
}

const STAGES: Stage[] = [
  {
    num: '01',
    title: 'Your code or OpenAPI spec',
    body: 'Bring a Python handler, a Docker image, or just an OpenAPI doc. No special framework.',
    Icon: FileCode,
  },
  {
    num: '02',
    title: 'Floom container',
    body: 'We sandbox it, give it secrets, rate limits, and a workspace-scoped runtime.',
    Icon: Box,
  },
  {
    num: '03',
    title: 'Three surfaces, one app',
    body: 'Every app exposes an HTTP API, an MCP tool, and a renderable UI in your browser.',
    Icon: Plug,
    chips: ['MCP', 'HTTP', 'UI'],
  },
  {
    num: '04',
    title: 'Any agent',
    body: 'Claude, Cursor, Codex, or curl. Same endpoint, same auth, same logs.',
    Icon: Bot,
  },
];

export function HowItWorksDiagram() {
  return (
    <section
      data-testid="how-it-works-diagram"
      style={{
        padding: '72px 28px',
        maxWidth: 1240,
        margin: '0 auto',
        borderTop: '1px solid var(--line)',
      }}
    >
      <SectionEyebrow>Under the hood</SectionEyebrow>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 34,
          lineHeight: 1.1,
          letterSpacing: '-0.025em',
          textAlign: 'center',
          margin: '0 auto 12px',
          maxWidth: 760,
        }}
      >
        How Floom works.
      </h2>
      <p
        style={{
          fontSize: 15.5,
          color: 'var(--muted)',
          textAlign: 'center',
          maxWidth: 620,
          margin: '0 auto 40px',
        }}
      >
        Every app travels the same four steps. No black box.
      </p>

      <div
        className="how-it-works-stages"
        data-testid="how-it-works-stages"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 18,
          maxWidth: 1180,
          margin: '0 auto',
          alignItems: 'stretch',
        }}
      >
        {STAGES.map(({ num, title, body, Icon, chips }, idx) => (
          <div
            key={num}
            data-testid={`how-it-works-stage-${num}`}
            style={{
              position: 'relative',
              padding: '20px 18px 22px',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Connector arrow on every stage except the last. Lives in
                the gutter to the right (desktop) — drops below in mobile
                via the responsive CSS in globals.css. */}
            {idx < STAGES.length - 1 && (
              <span
                aria-hidden="true"
                className="how-it-works-arrow"
                style={{
                  position: 'absolute',
                  right: -14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 18,
                  color: 'var(--muted)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  lineHeight: 1,
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              >
                →
              </span>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'rgba(4,120,87,0.08)',
                  border: '1px solid rgba(4,120,87,0.18)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#047857',
                  flexShrink: 0,
                }}
              >
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--accent, #047857)',
                }}
              >
                {num}
              </div>
            </div>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 700,
                margin: '0 0 8px',
                lineHeight: 1.3,
                color: 'var(--ink)',
              }}
            >
              {title}
            </h3>
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--muted)',
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {body}
            </p>
            {chips && chips.length > 0 && (
              <div
                data-testid={`how-it-works-chips-${num}`}
                style={{
                  display: 'flex',
                  gap: 6,
                  marginTop: 12,
                  flexWrap: 'wrap',
                }}
              >
                {chips.map((c) => (
                  <span
                    key={c}
                    style={{
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: 'var(--accent, #047857)',
                      background: 'rgba(4,120,87,0.06)',
                      border: '1px solid rgba(4,120,87,0.18)',
                      borderRadius: 999,
                      padding: '3px 8px',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
