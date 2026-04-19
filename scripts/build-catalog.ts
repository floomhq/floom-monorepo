#!/usr/bin/env tsx
/**
 * Build a Floom app catalog from the APIs-guru OpenAPI directory.
 *
 * Fetches the APIs-guru list, checks each spec for no-auth endpoints,
 * and writes a catalog.yaml ready to load via FLOOM_APPS_CONFIG.
 *
 * Usage (from monorepo root):
 *   tsx scripts/build-catalog.ts
 *   tsx scripts/build-catalog.ts --limit 50 --out catalog.yaml
 *   tsx scripts/build-catalog.ts --category financial,open_data --limit 200
 *
 * Outputs: catalog.yaml (or --out path)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- CLI args ----------
const args = process.argv.slice(2);
const getArg = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const LIMIT = parseInt(getArg('--limit') ?? '100', 10);
const OUT_FILE = resolve(process.cwd(), getArg('--out') ?? 'catalog.yaml');
const CAT_FILTER = (getArg('--category') ?? '').split(',').filter(Boolean);
const CONCURRENCY = 8;

// ---------- categories to include (skip cloud noise) ----------
const INCLUDE_CATS = CAT_FILTER.length > 0 ? new Set(CAT_FILTER) : new Set([
  'open_data', 'financial', 'developer_tools', 'analytics',
  'media', 'entertainment', 'location', 'messaging',
  'ecommerce', 'text', 'transport', 'tools', 'search',
  'collaboration', 'education', 'machine_learning',
]);

// ---------- provider prefixes to skip (too large / auth-heavy) ----------
const SKIP_PROVIDERS = [
  'amazonaws.com', 'azure.com', 'googleapis.com', 'google.com',
  'microsoft.com', 'salesforce.com', 'oracle.com', 'sap.com',
  'apisetu.gov', 'twilio.com', 'stripe.com', // need auth
];

// ---------- types ----------
interface ApisGuruVersion {
  swaggerUrl: string;
  info: {
    title?: string;
    description?: string;
    'x-apisguru-categories'?: string[];
    'x-logo'?: { url?: string };
  };
}

interface ApisGuruEntry {
  preferred: string;
  versions: Record<string, ApisGuruVersion>;
}

interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: { url: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, unknown>;
  security?: unknown[];
  components?: { securitySchemes?: Record<string, unknown> };
  securityDefinitions?: Record<string, unknown>;
}

interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  specUrl: string;
  baseUrl: string;
  category: string;
  icon?: string;
}

// ---------- helpers ----------

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function isNoAuth(spec: OpenApiSpec): boolean {
  // Swagger 2.0: securityDefinitions present → auth required
  if (spec.securityDefinitions && Object.keys(spec.securityDefinitions).length > 0) {
    // Could still be optional if global security is []
    if (Array.isArray(spec.security) && spec.security.length === 0) return true;
    if (!spec.security) return false; // has schemes but no global security = auth optional per-op
    return false;
  }
  // OpenAPI 3.0: components.securitySchemes present → auth required
  const schemes = spec.components?.securitySchemes;
  if (schemes && Object.keys(schemes).length > 0) {
    if (Array.isArray(spec.security) && spec.security.length === 0) return true;
    if (!spec.security) return false;
    return false;
  }
  // No security schemes at all → truly no auth
  return true;
}

function extractBaseUrl(spec: OpenApiSpec, specUrl: string): string | null {
  // OpenAPI 3.0
  if (spec.servers && spec.servers.length > 0) {
    const url = spec.servers[0]!.url;
    if (url.startsWith('http')) return url.replace(/\/+$/, '');
    // relative server URL — derive from spec URL origin
    try {
      const origin = new URL(specUrl).origin;
      return origin + url;
    } catch { return null; }
  }
  // Swagger 2.0
  if (spec.host) {
    const scheme = (spec.schemes ?? ['https'])[0] ?? 'https';
    const base = spec.basePath ?? '/';
    return `${scheme}://${spec.host}${base}`.replace(/\/+$/, '');
  }
  return null;
}

function descriptionSnippet(text: string | undefined): string {
  if (!text) return '';
  // First sentence, max 200 chars
  const first = text.replace(/\s+/g, ' ').split(/\.(\s|$)/)[0] ?? text;
  return first.length > 200 ? first.slice(0, 197) + '...' : first;
}

async function fetchSpec(url: string, timeoutMs = 10_000): Promise<OpenApiSpec | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json, text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text) as OpenApiSpec;
  } catch {
    return null;
  }
}

async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R | null>,
  concurrency: number,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------- main ----------

console.log(`\nFloom Catalog Builder — fetching APIs-guru list...\n`);

const listRes = await fetch('https://api.apis.guru/v2/list.json');
const list = await listRes.json() as Record<string, ApisGuruEntry>;

// Filter to candidate providers
const candidates: Array<{ provider: string; version: ApisGuruVersion; specUrl: string }> = [];

for (const [provider, entry] of Object.entries(list)) {
  // Skip noisy/enterprise providers
  if (SKIP_PROVIDERS.some(p => provider.startsWith(p))) continue;

  const preferred = entry.preferred;
  const version = entry.versions[preferred] ?? Object.values(entry.versions)[0];
  if (!version) continue;

  const cats = version.info['x-apisguru-categories'] ?? [];
  if (cats.length === 0) continue;
  if (!cats.some(c => INCLUDE_CATS.has(c))) continue;

  if (!version.swaggerUrl) continue;
  candidates.push({ provider, version, specUrl: version.swaggerUrl });
}

console.log(`${candidates.length} candidates after category filter`);
console.log(`Fetching specs ${CONCURRENCY} at a time to check for no-auth...\n`);

const catalog: CatalogEntry[] = [];
let checked = 0;

// Process in batches until we hit the limit
for (let i = 0; i < candidates.length && catalog.length < LIMIT; i += CONCURRENCY * 4) {
  const batch = candidates.slice(i, i + CONCURRENCY * 4);

  await runConcurrent(batch, async ({ provider, version, specUrl }) => {
    if (catalog.length >= LIMIT) return null;

    const spec = await fetchSpec(specUrl);
    checked++;

    if (!spec) {
      process.stdout.write('x');
      return null;
    }

    if (!isNoAuth(spec)) {
      process.stdout.write('·');
      return null;
    }

    const baseUrl = extractBaseUrl(spec, specUrl);
    if (!baseUrl) {
      process.stdout.write('?');
      return null;
    }

    // Must have at least 1 path
    if (!spec.paths || Object.keys(spec.paths).length === 0) {
      process.stdout.write('-');
      return null;
    }

    const cats = version.info['x-apisguru-categories'] ?? [];
    const cat = cats.find(c => INCLUDE_CATS.has(c)) ?? cats[0] ?? 'tools';
    const rawTitle = version.info.title ?? provider;
    const slug = slugify(rawTitle);
    const description = descriptionSnippet(version.info.description ?? version.info.title);

    if (catalog.length < LIMIT) {
      catalog.push({
        slug,
        name: rawTitle,
        description: description || `${rawTitle} API`,
        specUrl,
        baseUrl,
        category: cat,
        icon: version.info['x-logo']?.url,
      });
      process.stdout.write('✓');
    }
    return null;
  }, CONCURRENCY);

  if (checked % 50 === 0 || catalog.length >= LIMIT) {
    process.stdout.write(` [${catalog.length}/${LIMIT} found, ${checked} checked]\n`);
  }
}

console.log(`\n\nFound ${catalog.length} no-auth APIs from ${checked} checked.\n`);

// De-duplicate slugs
const seen = new Set<string>();
const deduped = catalog.filter(e => {
  if (seen.has(e.slug)) { e.slug = e.slug + '-' + Math.random().toString(36).slice(2, 5); }
  seen.add(e.slug);
  return true;
});

// ---------- write YAML ----------
const lines: string[] = ['apps:'];

for (const e of deduped) {
  // Escape YAML strings
  const safe = (s: string) => `"${s.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

  lines.push('');
  lines.push(`  - slug: ${e.slug}`);
  lines.push(`    type: proxied`);
  lines.push(`    display_name: ${safe(e.name)}`);
  lines.push(`    description: ${safe(e.description)}`);
  lines.push(`    openapi_spec_url: ${safe(e.specUrl)}`);
  lines.push(`    base_url: ${safe(e.baseUrl)}`);
  lines.push(`    auth: none`);
  lines.push(`    category: ${safe(e.category)}`);
  lines.push(`    visibility: public`);
  if (e.icon) lines.push(`    icon: ${safe(e.icon)}`);
}

writeFileSync(OUT_FILE, lines.join('\n') + '\n');
console.log(`Written ${deduped.length} apps to ${OUT_FILE}`);
console.log(`\nTo load: FLOOM_APPS_CONFIG=${OUT_FILE} pnpm --filter @floom/server dev\n`);
