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

export function absoluteCanonicalUrl(origin: string, pathname: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${canonicalPathForSeo(pathname)}`;
}
