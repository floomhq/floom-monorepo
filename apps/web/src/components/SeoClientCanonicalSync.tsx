// #172: SPA navigations (and `vite` dev) don't re-run SSR <head> rewrites, so
// the baked-in canonical/og:url must be updated in the document after each
// client-side route change.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { absoluteCanonicalUrl } from '../lib/seoPath';

function setOrCreateMeta(isProperty: boolean, key: string, content: string) {
  const attr = isProperty ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function SeoClientCanonicalSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const href = absoluteCanonicalUrl(window.location.origin, pathname);
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', href);

    setOrCreateMeta(true, 'og:url', href);
  }, [pathname]);

  return null;
}
