// Cookie consent banner.
//
// Desktop / tablet (≥768px, #342): full-width bottom strip (Linear / Vercel
// style) — does not float as a card over primary content. Content gets
// `padding-bottom` on the root while the banner is visible so the fold
// stays readable.
//
// Mobile (<768px, #104): small bottom-left "Cookies" pill; tap expands to
// the same strip treatment with a close control.
//
// Storage + consent lives in `lib/consent.ts` (so the telemetry modules
// can read the choice without importing React). This component calls
// `setConsent` AND inlines `initBrowserSentry` / `initPostHog` (on "Accept
// all") and their close equivalents (on the "all" -> "essential" downgrade)
// so the choice applies in the same session without a reload.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent, type Consent } from '../lib/consent';
import { initBrowserSentry, closeBrowserSentry } from '../lib/sentry';
import { initPostHog, closePostHog } from '../lib/posthog';

/** Viewport width below this uses the collapsed mobile pill first. */
const MOBILE_BREAKPOINT = 768;

/** Reserve space on the document root so content isn’t hidden behind the strip. */
const STRIP_RESERVE_PX = 84;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (getConsent() === null) setVisible(true);
  }, []);

  const showStrip = visible && (!isMobile || expanded);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (showStrip) {
      document.documentElement.style.paddingBottom = `${STRIP_RESERVE_PX}px`;
      return () => {
        document.documentElement.style.paddingBottom = '';
      };
    }
    document.documentElement.style.paddingBottom = '';
    return undefined;
  }, [showStrip]);

  if (!visible) return null;

  const accept = (choice: Consent) => {
    const previous = getConsent();
    setConsent(choice);
    if (choice === 'all') {
      initBrowserSentry();
      initPostHog();
    } else if (previous === 'all') {
      closeBrowserSentry();
      closePostHog();
    }
    setVisible(false);
  };

  if (isMobile && !expanded) {
    return (
      <button
        type="button"
        data-testid="cookie-banner-pill"
        onClick={() => setExpanded(true)}
        aria-label="Cookie consent"
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 950,
          padding: '7px 12px',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          boxShadow: '0 6px 20px rgba(14, 14, 12, 0.12)',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        Cookies
      </button>
    );
  }

  const isExpandedMobile = isMobile && expanded;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-banner-title"
      data-testid="cookie-banner"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 950,
        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
        paddingTop: 12,
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        minHeight: 56,
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        flexWrap: isExpandedMobile ? 'wrap' : 'nowrap',
        alignItems: 'center',
        gap: 12,
        background: 'var(--bg)',
        backdropFilter: 'blur(12px) saturate(1.06)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.06)',
        borderTop: '1px solid var(--line)',
        borderRadius: 0,
        boxShadow: '0 -4px 24px rgba(15, 23, 42, 0.08)',
        fontSize: 12.5,
        color: 'var(--ink)',
      }}
    >
      <p
        id="cookie-banner-title"
        style={{
          margin: 0,
          flex: '1 1 0',
          minWidth: 0,
          lineHeight: 1.45,
        }}
      >
        Floom uses essential cookies for sign-in and preferences. Choose
        &quot;Accept all&quot; to also help us with anonymised analytics and error
        reporting. See the{' '}
        <Link to="/cookies" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          cookie policy
        </Link>
        .
      </p>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          flexShrink: 0,
          marginLeft: isExpandedMobile ? 0 : 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => accept('essential')}
          style={{
            padding: '8px 14px',
            minHeight: 44,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            boxSizing: 'border-box',
          }}
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => accept('all')}
          style={{
            padding: '8px 14px',
            minHeight: 44,
            borderRadius: 8,
            border: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            boxSizing: 'border-box',
          }}
        >
          Accept all
        </button>
        {isExpandedMobile && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close"
            style={{
              padding: '8px 12px',
              minHeight: 44,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1,
              boxSizing: 'border-box',
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
