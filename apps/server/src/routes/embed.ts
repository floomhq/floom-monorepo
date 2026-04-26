import { Hono } from 'hono';

import { db } from '../db.js';
import { TOP_LEVEL_CSP } from '../middleware/security.js';
import { isPublicListingVisibility } from '../services/sharing.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const EMBED_CSP = TOP_LEVEL_CSP.replace("frame-ancestors 'none'", 'frame-ancestors *');

interface EmbedAppRow {
  slug: string;
  status: string | null;
  visibility: string | null;
  publish_status: string | null;
}

export interface EmbedRouterOptions {
  getIndexHtml: () => string;
}

function isListedForEmbed(row: EmbedAppRow): boolean {
  return (
    row.status === 'active' &&
    isPublicListingVisibility(row.visibility) &&
    (row.visibility === 'public_live' || row.publish_status === 'published')
  );
}

function injectEmbedMarker(html: string): string {
  return html.replace(/<body([^>]*)>/i, '<body$1 data-embed="1">');
}

export function createEmbedRouter({ getIndexHtml }: EmbedRouterOptions): Hono {
  const router = new Hono();

  router.get('/:slug', (c) => {
    const slug = c.req.param('slug');
    if (!SLUG_RE.test(slug)) return c.html('Not found', 404);

    const row = db
      .prepare('SELECT slug, status, visibility, publish_status FROM apps WHERE slug = ?')
      .get(slug) as EmbedAppRow | undefined;

    if (!row || !isListedForEmbed(row)) {
      return c.html('Not found', 404);
    }

    return c.html(injectEmbedMarker(getIndexHtml()), 200, {
      'Content-Security-Policy': EMBED_CSP,
      'cache-control': 'no-cache',
    });
  });

  return router;
}
