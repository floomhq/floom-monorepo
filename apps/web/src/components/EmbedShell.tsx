import { useEffect, type ReactNode } from 'react';

interface EmbedShellProps {
  children: ReactNode;
}

const CHROME_SELECTORS = [
  '.topbar',
  'footer',
  '[data-testid="feedback-trigger"]',
  '[data-testid="feedback-modal"]',
].join(',');

export function EmbedShell({ children }: EmbedShellProps) {
  useEffect(() => {
    const hidden = new Set<HTMLElement>();

    const hideChrome = () => {
      document.querySelectorAll<HTMLElement>(CHROME_SELECTORS).forEach((el) => {
        if (!hidden.has(el)) {
          el.dataset.floomEmbedWasHidden = el.hidden ? '1' : '0';
          hidden.add(el);
        }
        el.hidden = true;
      });
    };

    hideChrome();
    const observer = new MutationObserver(hideChrome);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      hidden.forEach((el) => {
        if (el.dataset.floomEmbedWasHidden !== '1') el.hidden = false;
        delete el.dataset.floomEmbedWasHidden;
      });
    };
  }, []);

  return (
    <div
      data-floom-embed-shell
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        position: 'relative',
        paddingBottom: 56,
      }}
    >
      {children}
      <a
        href="https://floom.dev"
        target="_blank"
        rel="noreferrer"
        style={{
          position: 'fixed',
          right: 14,
          bottom: 14,
          zIndex: 50,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid var(--line)',
          borderRadius: 999,
          background: 'rgba(250, 250, 248, 0.94)',
          color: 'var(--ink)',
          boxShadow: '0 8px 24px rgba(22, 21, 18, 0.12)',
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1,
          padding: '9px 12px',
          textDecoration: 'none',
        }}
      >
        Made with Floom · Run yours →
      </a>
    </div>
  );
}
