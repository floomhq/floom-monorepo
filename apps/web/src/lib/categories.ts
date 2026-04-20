/**
 * Category slugs flow from two sources: creator-declared values in
 * apps.yaml and free-form strings harvested from OpenAPI `tags`. As a
 * result the same concept is encoded several ways in the live catalog
 *   (seen on floom.dev/api/hub 2026-04-20):
 *
 *   - "developer-tools" (6) and "developer_tools" (5)
 *   - "open_data" (10) — the only encoding of the concept
 *   - single-word slugs like "text", "media", "location"
 *
 * Grouping UIs compare these strings with `===`, so without
 * normalization the two "developer" variants render as two separate
 * filter chips both labelled "Developer", each with a subset of apps.
 * Normalize on display: lowercase, trim, `_ -> -`.
 *
 * We deliberately do NOT normalize at ingest or in the database: that
 * would lose the creator's original string on round-trip and make the
 * migration impossible to roll back. Normalization is a pure UI
 * concern until we decide on a canonical list (D2 in the product doc).
 */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim().replace(/_/g, '-');
  return normalized || null;
}

/**
 * Display labels for known category slugs. Falls back to a title-cased
 * version of the slug when unknown so new categories (seen only in
 * bulk-ingested OpenAPI specs) still render readably.
 *
 * Keep this list short — it's the visible vocabulary of the app
 * directory and should not balloon into a taxonomy. When we add a
 * category here we are making a product promise that it has enough
 * apps to be worth browsing as a filter chip.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  ai: 'AI',
  analytics: 'Analytics',
  design: 'Design',
  'developer-tools': 'Developer',
  ecommerce: 'E-commerce',
  financial: 'Financial',
  location: 'Location',
  marketing: 'Marketing',
  media: 'Media',
  messaging: 'Messaging',
  'open-data': 'Open Data',
  productivity: 'Productivity',
  research: 'Research',
  search: 'Search',
  seo: 'SEO',
  text: 'Text',
  travel: 'Travel',
  writing: 'Writing',
};

/**
 * Resolve a display label for any category string. Applies
 * `normalizeCategory` first so callers don't need to pre-normalize.
 * Unknown slugs fall back to a readable title-case rendering
 *   ("open-data" -> "Open Data", "ntropy" -> "Ntropy").
 */
export function labelForCategory(category: string): string {
  const n = normalizeCategory(category) ?? category;
  if (CATEGORY_LABELS[n]) return CATEGORY_LABELS[n];
  return n.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
