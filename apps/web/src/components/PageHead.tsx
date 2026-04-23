import { useEffect } from 'react';
import { applyPublicMarketingMeta } from '../lib/publicPageMeta';

export type PageHeadProps = {
  title: string;
  description: string;
  /** Shorter share title when it should differ from the document title. */
  ogTitle?: string;
  socialDescription?: string;
  /** Pathname only (no query); defaults to `location.pathname` in applyPublicMarketingMeta. */
  pathname?: string;
  ogImageAbsoluteUrl?: string;
  /**
   * Restored on unmount so the next route doesn’t inherit stale titles.
   * Pass `null` to skip cleanup (e.g. landing).
   */
  resetTitleOnUnmount?: string | null;
};

/**
 * Client-side &lt;head&gt; for public marketing routes (#317). Keeps title,
 * description, Open Graph, and Twitter tags aligned after SPA navigations.
 */
export function PageHead({
  title,
  description,
  ogTitle,
  socialDescription,
  pathname,
  ogImageAbsoluteUrl,
  resetTitleOnUnmount = 'Floom: production layer for AI apps',
}: PageHeadProps) {
  useEffect(() => {
    document.title = title;
    applyPublicMarketingMeta({
      description,
      ogTitle: ogTitle ?? title,
      socialDescription,
      pathname,
      ogImageAbsoluteUrl,
    });
    if (resetTitleOnUnmount == null) return undefined;
    return () => {
      document.title = resetTitleOnUnmount;
    };
  }, [title, description, ogTitle, socialDescription, pathname, ogImageAbsoluteUrl, resetTitleOnUnmount]);

  return null;
}
