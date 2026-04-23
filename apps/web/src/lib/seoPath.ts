/**
 * Production site origin for canonical / og:url in client-side head updates (#172).
 * Always use this (not `window.location.origin`) so previews and local dev still
 * declare the public index URL crawlers should consolidate on.
 */
export const PUBLIC_SITE_ORIGIN = 'https://floom.dev';

/**
 * Path normalization for <link rel="canonical"> and og:url on the client.
 * Kept in sync with `canonicalPathForSeo` in apps/server/src/index.ts (#172).
 */
export function canonicalPathForSeo(pathname: string): string {
  if (pathname === '/index.html') return '/';
  let p = pathname;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '/store') return '/apps';
  return p;
}

/** Absolute canonical URL for the current route (no query string). */
export function absoluteCanonicalUrl(pathname: string): string {
  const base = PUBLIC_SITE_ORIGIN.replace(/\/$/, '');
  return `${base}${canonicalPathForSeo(pathname)}`;
}

/** Absolute URL for a root-relative path like `/og-main.png`. */
export function absolutePublicAssetUrl(assetPath: string): string {
  const path = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return `${PUBLIC_SITE_ORIGIN.replace(/\/$/, '')}${path}`;
}
