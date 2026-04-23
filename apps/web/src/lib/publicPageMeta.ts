// #317: client-side <head> updates for public marketing pages (Vite dev + post-SPA
// navigation) so in-browser “View source” after client nav matches what SSR ships.

import { absoluteCanonicalUrl, absolutePublicAssetUrl } from './seoPath';

const ATTR = (isProp: boolean) => (isProp ? 'property' : 'name');

function upsertMeta(isProp: boolean, key: string, content: string) {
  const a = ATTR(isProp);
  let el = document.querySelector(`meta[${a}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(a, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** #316: default static OG/Twitter image on marketing routes (see also SSR `defaultOgImage`). */
export const DEFAULT_OG_PATH = '/og-image.png';

/**
 * Fills the standard public meta tag set. Call from public routes’ useEffect;
 * set `document.title` separately (or via PageShell) so the tab title stays
 * consistent with the UI.
 */
export function applyPublicMarketingMeta(opts: {
  /** <meta name="description"> and fallbacks (SERP) */
  description: string;
  /** Usually shorter than <title> — e.g. “About Floom” not “About Floom · …” */
  ogTitle: string;
  /** Open Graph + Twitter body; defaults to `description` */
  socialDescription?: string;
  /**
   * Pathname only (no query) for canonical / og:url. Defaults to `location.pathname`.
   */
  pathname?: string;
  /** Full absolute image URL. Defaults to `${PUBLIC_SITE_ORIGIN}${DEFAULT_OG_PATH}`. */
  ogImageAbsoluteUrl?: string;
}): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const pathOnly = opts.pathname ?? window.location.pathname;
  const pageUrl = absoluteCanonicalUrl(pathOnly);
  const image =
    opts.ogImageAbsoluteUrl ?? absolutePublicAssetUrl(DEFAULT_OG_PATH);
  const body = opts.socialDescription ?? opts.description;

  upsertMeta(false, 'description', opts.description);
  upsertMeta(true, 'og:title', opts.ogTitle);
  upsertMeta(true, 'og:description', body);
  upsertMeta(true, 'og:url', pageUrl);
  upsertMeta(true, 'og:type', 'website');
  upsertMeta(true, 'og:image', image);
  upsertMeta(false, 'twitter:card', 'summary_large_image');
  upsertMeta(false, 'twitter:title', opts.ogTitle);
  upsertMeta(false, 'twitter:description', body);
  upsertMeta(false, 'twitter:image', image);
}
