// Security headers middleware (P1 hardening, GitHub #126).
//
// Applies a strict-but-shippable Content-Security-Policy, plus HSTS,
// Referrer-Policy, and X-Content-Type-Options, to every response.
//
// Scope decisions:
//   - `default-src 'self'` locks everything to same-origin by default.
//   - `script-src 'self'` — no inline scripts. The web bundle is shipped
//     as external ES modules from /assets/*.js so this is clean. The
//     only potential inline was the font-swap `onload=` handler in
//     index.html, which we removed in the same PR.
//     `application/ld+json` is a data block, not executable, so it's
//     exempt from script-src.
//   - `style-src 'self' 'unsafe-inline'` — Tailwind compiles to a single
//     CSS file but React inline `style={{ ... }}` props emit inline
//     styles that CSP treats as `style-src-attr`. Tightening further
//     requires a nonce on every render which is not practical today;
//     tracked as a follow-up.
//   - `img-src 'self' data: https:` — OG images, external icon CDNs
//     (SimpleIcons, svgl, favicons), and data: for inline SVG sprites.
//   - `connect-src 'self' https://api.github.com` — same-origin API
//     calls plus the GitHub star-count fetch in components/home/BuiltBy.tsx.
//     Sentry is only wired on the server; the browser bundle does not
//     ship its own DSN. If we add a browser-side Sentry later, we'll
//     need to allowlist `https://*.ingest.sentry.io` here.
//   - `font-src 'self' https://fonts.gstatic.com` — Google Fonts is
//     loaded via `fonts.googleapis.com` (stylesheet, matched by
//     style-src) which in turn references `fonts.gstatic.com` for the
//     woff2 files. Both need to be allowed.
//     (style-src already allows `https://fonts.googleapis.com` via the
//     explicit host below.)
//   - `style-src` also allows `https://fonts.googleapis.com` for the
//     external font stylesheet link.
//   - `frame-src 'self'` — the custom-renderer iframe lives same-origin
//     at /renderer/:slug/frame.html. No third-party frames.
//   - `frame-ancestors 'none'` — clickjacking defense. Replaces the
//     older `X-Frame-Options: SAMEORIGIN` nginx header; CSP's
//     frame-ancestors supersedes XFO on modern browsers.
//   - `base-uri 'self'` — prevents `<base href=...>` injection from
//     rewriting relative URLs.
//   - `form-action 'self'` — forms can only submit to same origin.
//   - `object-src 'none'` — blocks <object>/<embed>/<applet> entirely.
//
// Exempt routes:
//   - `/renderer/:slug/frame.html` ships its own stricter CSP (see
//     routes/renderer.ts FRAME_CSP). We don't overwrite it.
//   - `/api/*` and `/mcp/*` return JSON/SSE which browsers don't
//     interpret as HTML, so CSP is effectively a no-op there. We still
//     set the other headers (HSTS, nosniff) on every response.

import type { MiddlewareHandler } from 'hono';

/** Content-Security-Policy applied to every HTML response except
 * `/renderer/:slug/frame.html` (that route sets its own stricter CSP). */
export const TOP_LEVEL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://api.github.com",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** Paths that own their own CSP and must not be overwritten here. */
const CSP_EXEMPT_PREFIXES = ['/renderer/'];

function ownsCsp(pathname: string): boolean {
  return CSP_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Apply security headers to every response:
 *   - Content-Security-Policy (for HTML responses; not the renderer frame)
 *   - Strict-Transport-Security
 *   - Referrer-Policy
 *   - X-Content-Type-Options
 *
 * Hono's middleware runs after `next()`, so by the time we set headers the
 * response object is already populated. We never clobber a downstream
 * `Content-Security-Policy` that a route set itself.
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  const pathname = new URL(c.req.url).pathname;

  // HSTS, nosniff, referrer — safe to apply everywhere. Browsers ignore
  // HSTS on non-HTTPS responses so setting it in dev is harmless.
  c.res.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload',
  );
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CSP: skip routes that set their own (renderer frame) and skip when a
  // route already set a CSP header explicitly.
  if (!ownsCsp(pathname) && !c.res.headers.get('Content-Security-Policy')) {
    c.res.headers.set('Content-Security-Policy', TOP_LEVEL_CSP);
  }
};
