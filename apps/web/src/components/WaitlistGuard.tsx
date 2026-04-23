/**
 * WaitlistGuard — route-level gate that redirects to /waitlist when the
 * server reports DEPLOY_ENABLED=false.
 *
 * 2026-04-24 prod/preview split: floom.dev runs DEPLOY_ENABLED=false
 * (waitlist-only) while preview.floom.dev runs DEPLOY_ENABLED=true
 * (open product). Every auth + builder surface — /login, /signup,
 * /build, /studio/*, /me/* — should be unreachable on waitlist-prod,
 * redirecting users back into the /waitlist capture flow. The 3
 * showcase apps at /p/:slug and /r/:runId stay PUBLIC in both modes
 * and are NOT wrapped in this guard.
 *
 * Keeping the gate client-side (not server-side 302) so the same Docker
 * image can power both deployments with just an env flip, and so
 * SPA navigations inside the shell still work smoothly.
 */
import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useDeployEnabled } from '../lib/flags';

export interface WaitlistGuardProps {
  children: ReactNode;
  /**
   * Optional source tag propagated into the /waitlist redirect so we can
   * track which gated surface tried to land on the waitlist form. Falls
   * back to the current pathname's first segment (eg. "login", "studio").
   */
  source?: string;
}

/**
 * When DEPLOY_ENABLED is `false`, redirect to /waitlist?source=<source>
 * (preserving the original path in `?next` for the post-waitlist flow).
 *
 * While the session is still loading (`useDeployEnabled()` returns null)
 * we render the children optimistically. On waitlist-prod this is OK
 * because the server additionally 401s auth calls, and this guard's job
 * is primarily UX (stop showing the login form) — not security.
 */
export function WaitlistGuard({ children, source }: WaitlistGuardProps) {
  const deployEnabled = useDeployEnabled();
  const location = useLocation();

  // Session not loaded yet — let children render to avoid a flash-of-
  // redirect on first paint. Once the session resolves, components re-
  // render and this guard redirects if we're in waitlist mode.
  if (deployEnabled === null) return <>{children}</>;

  if (deployEnabled === false) {
    const pathSource =
      source ||
      location.pathname.split('/').filter(Boolean)[0] ||
      'guarded-route';
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <Navigate
        to={`/waitlist?source=${encodeURIComponent(pathSource)}&next=${next}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
