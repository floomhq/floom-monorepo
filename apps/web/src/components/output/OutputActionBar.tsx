// OutputActionBar — R7.5 (2026-04-28): sticky master action row for the
// composite output card on /p/:slug.
//
// Federico's brief:
//   - Master action bar (Copy JSON / Download CSV / Download all) sticks
//     to the top of the output card while scrolling so users keep the
//     primary CTAs in reach on long outputs (Competitor Lens, AI Readiness).
//   - Per-table fullscreen toggle (expand icon → portal modal, esc to close).
//   - Per-section affordances stay discoverable on hover (handled in
//     SectionHeader by parent renderers).
//
// Keep this component dumb — it just renders the sticky strip. The
// download-all / per-section copy / fullscreen wiring lives in renderer
// callsites.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ActionBarProps {
  label?: string;
  /** Right-aligned action buttons. Render with <button> for accessibility. */
  actions: ReactNode;
}

export function OutputActionBar({ label = 'Output', actions }: ActionBarProps) {
  return (
    <div
      className="floom-output-action-bar"
      data-testid="output-action-bar"
      style={{
        // R7.5: sticky-to-top so the toolbar stays visible while the
        // output body scrolls. `top: 0` is relative to the nearest
        // scroll-container ancestor (typically the page; the composite
        // card uses overflow:hidden, so sticky resolves against the
        // surrounding /p/:slug page).
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--card)',
        borderBottom: '1px solid var(--line)',
        // Soft shadow only when actually pinned (CSS doesn't natively
        // distinguish, so a gentle always-on shadow reads as "this is
        // a toolbar" without being noisy).
        boxShadow: '0 1px 0 var(--line)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent, #047857)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {actions}
      </div>
    </div>
  );
}

interface FullscreenModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Fullscreen modal for per-table expand. Renders into document.body via
 * portal so it escapes any clipped/overflow:hidden ancestor. Closes on
 * Escape and on backdrop click.
 */
export function TableFullscreenModal({ open, onClose, title, children }: FullscreenModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Expanded view'}
      data-testid="output-fullscreen-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 14, 12, 0.55)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          width: 'min(1200px, calc(100vw - 48px))',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--card)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {title ?? 'Expanded view'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close fullscreen view"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              color: 'var(--muted)',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Close · Esc
          </button>
        </div>
        <div
          style={{
            overflow: 'auto',
            padding: '20px 22px',
            flex: 1,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

interface FullscreenButtonProps {
  onClick: () => void;
  label?: string;
}

/** Small icon-button to expand a table into the fullscreen modal. */
export function FullscreenButton({ onClick, label = 'Expand to fullscreen' }: FullscreenButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="output-fullscreen-btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: 'var(--muted)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  );
}
