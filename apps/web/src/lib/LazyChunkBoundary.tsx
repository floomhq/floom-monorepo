import { Component, ReactNode } from 'react';

/**
 * Catches ChunkLoadError thrown by React.lazy() when Vite's hashed chunk
 * filenames are invalidated by a fresh deploy. On first failure it records
 * the attempt in sessionStorage and triggers a hard reload so the browser
 * fetches the new chunk manifest. On a second failure (same session) it
 * renders a static error message instead of looping forever.
 *
 * Layer this INSIDE BrowserSentryErrorBoundary so chunk errors get recovered
 * silently while non-chunk errors still reach Sentry.
 */

const SESSION_KEY = 'floom_chunk_reload_attempted';

function isChunkLoadError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  return (
    e.name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(e.message ?? '') ||
    /Failed to fetch dynamically imported module/i.test(e.message ?? '')
  );
}

interface State {
  failed: boolean;
  alreadyRetried: boolean;
}

export class LazyChunkBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, alreadyRetried: false };

  static getDerivedStateFromError(error: unknown): Partial<State> | null {
    if (!isChunkLoadError(error)) return null;
    const alreadyRetried =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(SESSION_KEY) === '1';
    return { failed: true, alreadyRetried };
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) return;
    if (this.state.alreadyRetried) return; // give up — render error message
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, '1');
    }
    // Brief delay so the "Reloading…" message is visible before the page
    // refreshes, avoiding a jarring flash.
    setTimeout(() => window.location.reload(), 200);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    if (this.state.alreadyRetried) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            fontFamily: 'inherit',
            color: 'inherit',
          }}
        >
          Couldn&apos;t load this page — please try again later.
        </div>
      );
    }

    // First failure: show brief message while reload is queued.
    return (
      <div style={{ padding: 24, textAlign: 'center', fontFamily: 'inherit' }}>
        Reloading&hellip;
      </div>
    );
  }
}
