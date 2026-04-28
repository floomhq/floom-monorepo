// GET /og/:slug.svg — dynamic social preview image for /p/:slug.
// GET /og/r/:run_id.svg — run-specific social preview image for /r/:id.
// GET /og/main.svg — the Floom landing OG image.
//
// Produces a 1200x630 SVG with:
//   - Inline path-based Floom mark (no web fonts, no halo filter — just
//     the brand glyph + wordmark). Renders identically on Discord,
//     Slack, iMessage, LinkedIn, Twitter — none of which load
//     <font-face> definitions when SVGs are referenced via og:image.
//   - App name (large, bold) with subtle ink gradient for visual weight.
//   - App description (up to 2 lines).
//   - Sample output card — per-slug curated SAMPLES map, with the
//     launch apps hand-tuned to match real outputs.
//   - Footer: "floom.dev · Free to run · MIT" with a tight accent dot.
//
// Run-specific cards (/og/r/:run_id.svg) swap the description for an
// auto-formatted "RUN · {relative-time}" eyebrow and the sample card
// for the actual run's output (truncated). 404 when the run is missing
// or owner-only (and no matching `share_token` query param is provided).
//
// Served with Cache-Control: public, max-age=300 so crawlers hit the
// route but we can update the copy by deploying.
//
// SVG is used deliberately (no native image deps). Modern crawlers
// (Discord, Slack, OG parsers, most previewers) render SVG og:image.
import { Hono } from 'hono';
import { db } from '../db.js';
import { getRun } from '../services/runner.js';
import type { AppRecord } from '../types.js';

export const ogRouter = new Hono();

const WIDTH = 1200;
const HEIGHT = 630;

// System font stack — every platform renders its own native bold sans
// without needing a <font-face> we can't ship. Inter is left out
// deliberately: when previewers strip the @font-face, Inter falls back
// to "default sans" which on some platforms (e.g. Slack desktop on
// Linux) is a thin geometric face that wrecks the visual weight.
const SANS = "system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', Menlo, 'SF Mono', Consolas, monospace";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

// Curated sample outputs per well-known app slug. Each entry has a
// "score" label and up to 3 bullet lines that simulate real output,
// giving previewers something concrete to intrigue the viewer.
//
// Falls back to generic bullets if slug not found.
const CURATED_SAMPLES: Record<string, { score: string; bullets: string[] }> = {
  'competitor-lens': {
    score: 'stripe vs adyen',
    bullets: [
      'Fee: 1.4% (Stripe) vs 1.6% (Adyen)',
      'Setup: minutes (Stripe) vs days (Adyen)',
      'Winner: Stripe for SMB, Adyen for enterprise',
    ],
  },
  'competitor-analyzer': {
    score: '3 gaps found',
    bullets: [
      'Pricing: competitor A is 30% cheaper on starter tier',
      'Feature gap: no mobile app (both rivals have one)',
      'Opportunity: only you offer an API — highlight it',
    ],
  },
  'ai-readiness-audit': {
    score: 'floom.dev — 8.4/10',
    bullets: [
      '3 risks: no PII red-team, no eval suite, no rate limits',
      '3 wins: typed I/O, JSON schemas, observability',
      'Next: ship the eval harness to unlock 9.5/10',
    ],
  },
  'pitch-coach': {
    score: 'harsh truth',
    bullets: [
      '3 critiques: vague problem, no wedge, weak ask',
      '3 rewrites: open with pain, name the wedge, anchor ask',
      'Verdict: rewrite slide 1 — buries the lede',
    ],
  },
  'lead-scorer': {
    score: '3 leads ranked',
    bullets: [
      'Acme Corp — 92/100 (budget confirmed, timeline Q3)',
      'BetaCo — 67/100 (interest high, decision slow)',
      'GammaTech — 41/100 (no budget signal)',
    ],
  },
  'resume-screener': {
    score: '5 resumes screened',
    bullets: [
      'Alice M. — Strong match (Python, 4y exp, ML background)',
      'Bob K. — Partial match (React focus, no backend)',
      'Carol D. — Weak match (entry-level, no relevant projects)',
    ],
  },
};

interface OgCopy {
  title: string;
  description: string;
  author: string | null;
  slug: string;
  /**
   * Optional run-specific override. When present:
   *   - Eyebrow line ("RUN · 2 hours ago") replaces the "APP" badge
   *   - Sample card uses run output preview instead of curated samples
   *   - Footer routes to /r/<runId> instead of /p/<slug>
   */
  run?: {
    runId: string;
    relativeTime: string;
    outputPreview: string[];
    label: string;
  };
}

// Format a run timestamp into a friendly relative string suitable for
// social cards. We avoid pulling Intl.RelativeTimeFormat — it's locale
// sensitive and previewers expect English. Mirrors formatRelative in
// ShareModal.tsx but produces "2 hours ago" instead of "2h ago" for a
// less developer-y vibe in the OG card.
function formatRunRelative(iso?: string | null): string {
  if (!iso) return 'just now';
  // SQLite stores `datetime('now')` as a UTC string without a 'Z' suffix.
  // `new Date(iso)` then parses it as local time, which under-reports
  // "ago" durations by the local UTC offset (e.g. CEST shows "24 mins
  // ago" for a run that finished 2h24m back). Force UTC parsing by
  // appending 'Z' when the string lacks any timezone marker.
  const isoNormalized =
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const t = new Date(isoNormalized).getTime();
  if (Number.isNaN(t)) return 'just now';
  const diffMs = Math.max(0, Date.now() - t);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  // Fallback to a date string for older runs.
  const d = new Date(t);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Pull a small text preview out of a run.outputs JSON payload. Apps
// return wildly different shapes (markdown strings, arrays, structured
// objects) so this walks the JSON and extracts the first useful string
// values. Returns up to 3 lines, each truncated to ~100 chars.
function previewFromRunOutputs(rawJson: string | null): string[] {
  if (!rawJson) return ['Look what just got generated on Floom.'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // Plain string output — return as a single line.
    return [truncate(rawJson, 120)];
  }
  const lines: string[] = [];
  const visit = (val: unknown): void => {
    if (lines.length >= 3) return;
    if (val == null) return;
    if (typeof val === 'string') {
      const trimmed = val.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 0) lines.push(truncate(trimmed, 100));
      return;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      lines.push(String(val));
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        visit(item);
        if (lines.length >= 3) return;
      }
      return;
    }
    if (typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) {
        visit(v);
        if (lines.length >= 3) return;
      }
    }
  };
  visit(parsed);
  if (lines.length === 0) return ['Run completed on Floom.'];
  return lines;
}

// Wrap description text into lines of at most maxChars per line.
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.slice(0, 2); // at most 2 description lines
}

function renderSvg(copy: OgCopy): string {
  const title = escapeXml(truncate(copy.title, 44));
  const author = copy.author ? escapeXml(`by @${copy.author.replace(/^@/, '')}`) : '';
  const isRun = !!copy.run;

  // Color palette: warm near-white background, deep ink, brand emerald.
  // Card uses a clean white surface so it reads as a discrete output
  // surface without the AI-slop "everything has a gradient" look.
  const ink = '#0e0e0c';
  const muted = '#585550';
  const accent = '#047857';
  const accentBright = '#10b981';
  const bg = '#fafaf8';
  const bgWarm = '#f4f2ec';
  const line = '#e8e6e0';
  const cardBg = '#ffffff';

  // Eyebrow line above the title.
  // - App mode: small "APP" pill.
  // - Run mode: "RUN · {relativeTime}" so the social preview
  //   communicates "this is a fresh result, not an evergreen app".
  const eyebrow = isRun ? `RUN · ${copy.run!.relativeTime.toUpperCase()}` : 'APP';

  // Sample card content. Run mode pulls the actual run output preview;
  // app mode uses the curated SAMPLES map (or a generic fallback).
  let scoreLabel: string;
  let bulletLines: string[];
  if (isRun) {
    scoreLabel = escapeXml(copy.run!.label);
    bulletLines = copy.run!.outputPreview
      .slice(0, 3)
      .map((b) => escapeXml(truncate(b, 64)));
  } else {
    const sample = CURATED_SAMPLES[copy.slug];
    if (sample) {
      scoreLabel = escapeXml(sample.score);
      bulletLines = sample.bullets.slice(0, 3).map((b) => escapeXml(truncate(b, 64)));
    } else {
      const rawDesc = truncate(copy.description || 'Run AI tasks in seconds.', 160);
      const wrapped = wrapText(rawDesc, 60);
      scoreLabel = escapeXml('Try it on Floom');
      bulletLines = [
        ...wrapped.slice(0, 2).map((s) => escapeXml(s)),
        escapeXml('Free to run. No account required.'),
      ];
    }
  }

  // Description (app mode only — run mode replaces it with the eyebrow + run output card).
  const rawDesc = truncate(copy.description || 'Run this AI app on Floom.', 160);
  const descLines = !isRun ? wrapText(rawDesc, 56) : [];

  // Vertical layout. Title sits a bit higher to leave room for the
  // bigger sample card. Sample card width spans the content column.
  const cardPad = 26;
  const cardWidth = WIDTH - 160;
  const titleY = 252;
  const descY1 = 310;
  const descY2 = descY1 + 40;
  const cardTop = isRun ? 320 : descLines.length > 1 ? 384 : 348;
  const cardHeight = bulletLines.length * 36 + cardPad * 2 + 30;

  // Footer: routes to /r/<runId> on run cards, /p/<slug> on app cards.
  const footerRoute = isRun
    ? `floom.dev/r/${escapeXml(copy.run!.runId)}`
    : `floom.dev/p/${escapeXml(copy.slug)}`;
  const footerCta = isRun ? 'open this run' : 'try it on';

  // Eyebrow pill width — proportional to label length so spacing reads.
  const eyebrowWidth = eyebrow.length * 9 + 24;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <!-- Brand mark gradient (matches /floom-mark-glow.svg) -->
    <linearGradient id="markGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${accentBright}"/>
    </linearGradient>
    <!-- Wide accent strip (top of card) -->
    <linearGradient id="stripGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="55%" stop-color="${accentBright}"/>
      <stop offset="100%" stop-color="${accent}"/>
    </linearGradient>
    <!-- Title gradient — subtle ink-to-charcoal so the headline gains
         visual weight without becoming Lovable-style rainbow. -->
    <linearGradient id="titleGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ink}"/>
      <stop offset="100%" stop-color="#2a2620"/>
    </linearGradient>
    <!-- Soft background gradient (warm cream to bg) -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bgWarm}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGrad)"/>

  <!-- Top accent strip (8px, was 5px) -->
  <rect x="0" y="0" width="${WIDTH}" height="8" fill="url(#stripGrad)"/>

  <!-- Floom mark + wordmark.
       Path comes from /apps/web/public/floom-mark-glow.svg. The
       canonical path uses 100x100 art space; we translate into the OG
       header at (80, 56) and scale 0.62 so the mark sits at ~52px tall. -->
  <g transform="translate(80, 56)">
    <g transform="scale(0.62)">
      <path
        d="M32 26 h20 l22 22 a3 3 0 0 1 0 4 l-22 22 h-20 a6 6 0 0 1 -6 -6 v-36 a6 6 0 0 1 6 -6 z"
        fill="url(#markGrad)"
      />
    </g>
    <text x="64" y="38" font-family="${SANS}" font-weight="800" font-size="30" fill="${ink}" letter-spacing="-1">floom</text>
    <!-- Bigger accent dot, replaces the old thin bar marker -->
    <circle cx="160" cy="32" r="5" fill="${accent}"/>
  </g>

  <!-- Eyebrow badge (APP / RUN · time) -->
  <g transform="translate(80, 168)">
    <rect x="0" y="0" width="${eyebrowWidth}" height="26" rx="13" fill="${accent}"/>
    <text x="${eyebrowWidth / 2}" y="18" font-family="${MONO}" font-weight="700" font-size="12" fill="#ffffff" text-anchor="middle" letter-spacing="1.2">${escapeXml(eyebrow)}</text>
  </g>

  <!-- App title (gradient ink) -->
  <text x="80" y="${titleY}" font-family="${SANS}" font-weight="800" font-size="88" letter-spacing="-2.5" fill="url(#titleGrad)">${title}</text>

  <!-- Description lines (app mode only) -->
  ${
    !isRun && descLines[0]
      ? `<text x="80" y="${descY1}" font-family="${SANS}" font-size="27" fill="${muted}">${escapeXml(descLines[0])}</text>`
      : ''
  }
  ${
    !isRun && descLines[1]
      ? `<text x="80" y="${descY2}" font-family="${SANS}" font-size="27" fill="${muted}">${escapeXml(descLines[1])}</text>`
      : ''
  }

  <!-- Sample output card -->
  <g>
    <rect x="80" y="${cardTop}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="${cardBg}" stroke="${line}" stroke-width="1.5"/>
    <!-- Subtle accent left rail so the card reads as "Floom output" -->
    <rect x="80" y="${cardTop}" width="6" height="${cardHeight}" rx="3" fill="${accent}" opacity="0.85"/>

    <!-- Score / label (accent, mono) -->
    <text x="${80 + cardPad}" y="${cardTop + cardPad + 16}" font-family="${MONO}" font-size="17" font-weight="700" fill="${accent}">${scoreLabel}</text>

    <!-- Divider -->
    <line x1="${80 + cardPad}" y1="${cardTop + cardPad + 28}" x2="${80 + cardWidth - cardPad}" y2="${cardTop + cardPad + 28}" stroke="${line}" stroke-width="1"/>

    <!-- Bullet lines -->
    ${bulletLines
      .map(
        (b, i) =>
          `<text x="${80 + cardPad}" y="${cardTop + cardPad + 60 + i * 36}" font-family="${SANS}" font-size="20" fill="${ink}">• ${b}</text>`,
      )
      .join('\n    ')}
  </g>

  <!-- Footer divider -->
  <line x1="80" y1="${HEIGHT - 60}" x2="${WIDTH - 80}" y2="${HEIGHT - 60}" stroke="${line}" stroke-width="1"/>

  <!-- Footer: brand strip on left, CTA on right -->
  <g transform="translate(80, ${HEIGHT - 30})">
    <circle cx="6" cy="-5" r="4" fill="${accent}"/>
    <text x="20" y="0" font-family="${MONO}" font-size="15" fill="${muted}">floom.dev</text>
    <text x="120" y="0" font-family="${MONO}" font-size="15" fill="${muted}">·</text>
    <text x="138" y="0" font-family="${MONO}" font-size="15" fill="${muted}">Free to run</text>
    <text x="248" y="0" font-family="${MONO}" font-size="15" fill="${muted}">·</text>
    <text x="266" y="0" font-family="${MONO}" font-size="15" fill="${muted}">MIT</text>
    ${author ? `<text x="320" y="0" font-family="${MONO}" font-size="15" fill="${muted}">·</text><text x="340" y="0" font-family="${MONO}" font-size="15" fill="${muted}">${author}</text>` : ''}
    <text x="${WIDTH - 160}" y="0" font-family="${MONO}" font-size="15" fill="${accent}" font-weight="700" text-anchor="end">${footerCta} ${escapeXml(footerRoute)}</text>
  </g>
</svg>`;
}

function renderMainSvg(): string {
  // Tokens mirror the v17 landing palette (/apps/web/public/_landing.css):
  // bg #fafaf8, ink #0e0e0c, muted #585550, accent emerald-700 #047857.
  // Keep in sync with /apps/web/public/og-main-template.svg.
  const ink = '#0e0e0c';
  const muted = '#585550';
  const accent = '#047857';
  const bg = '#fafaf8';
  const line = '#e8e6e0';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#059669" stop-opacity="1"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${bg}"/>
  <g stroke="${line}" stroke-width="1">
    <line x1="0" y1="170" x2="${WIDTH}" y2="170"/>
    <line x1="0" y1="500" x2="${WIDTH}" y2="500"/>
  </g>
  <g transform="translate(80,90)">
    <g transform="translate(0,0) scale(0.92)">
      <path d="M8 2 h20 l22 22 a3 3 0 0 1 0 4 l-22 22 h-20 a6 6 0 0 1 -6 -6 v-36 a6 6 0 0 1 6 -6 z" fill="url(#accent)"/>
    </g>
    <text x="72" y="40" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="700" font-size="36" fill="${ink}">Floom</text>
  </g>
  <text x="80" y="330" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="96" letter-spacing="-3" fill="${ink}">Ship AI apps fast.</text>
  <text x="80" y="400" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="30" fill="${muted}">The protocol + runtime for agentic work.</text>
  <text x="80" y="455" font-family="'JetBrains Mono', 'Menlo', monospace" font-size="20" fill="${accent}" font-weight="600">Vibe-coding speed. Production-grade safety.</text>
  <text x="80" y="548" font-family="'JetBrains Mono', 'Menlo', monospace" font-size="14" fill="${muted}" letter-spacing="2" font-weight="600">WORKS WITH</text>
  <g transform="translate(80, 568) scale(1.5)" fill="${ink}">
    <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/>
  </g>
  <text x="130" y="591" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="18" fill="${ink}" font-weight="500">Claude</text>
  <g transform="translate(260, 568) scale(1.5)" fill="${ink}">
    <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>
  </g>
  <text x="310" y="591" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="18" fill="${ink}" font-weight="500">Cursor</text>
  <g transform="translate(436, 568) scale(0.1406)" fill="${ink}">
    <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/>
  </g>
  <text x="486" y="591" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="18" fill="${ink}" font-weight="500">ChatGPT</text>
  <text x="630" y="591" font-family="'JetBrains Mono', 'Menlo', monospace" font-size="18" fill="${ink}" font-weight="500">Codex CLI</text>
  <text x="780" y="591" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="18" fill="${muted}" font-weight="500">Any MCP client</text>
  <text x="${WIDTH - 80}" y="591" font-family="'JetBrains Mono', 'Menlo', monospace" font-size="18" fill="${muted}" text-anchor="end">floom.dev</text>
</svg>`;
}

ogRouter.get('/main.svg', (_c) => {
  const svg = renderMainSvg();
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
});

// GET /og/r/:run_id.svg — run-specific OG card.
//
// Rules:
//   - Run must exist; otherwise 404.
//   - Run must be public (`is_public = 1`) OR the caller must present
//     a matching `share_token` query parameter that matches the parent
//     app's `link_share_token`. Owner-only runs return 404 to avoid
//     leaking the existence of private runs to crawlers.
//   - Output preview pulled from the run's `outputs` JSON via the
//     same recursive walk used elsewhere on the share-card surface.
ogRouter.get('/r/:runIdSvg{[a-zA-Z0-9_-]+\\.svg}', (c) => {
  const param = c.req.param('runIdSvg');
  const runId = param.replace(/\.svg$/, '');

  const run = getRun(runId);
  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  // Look up the parent app for slug + name + author.
  const appRow = db
    .prepare(
      `SELECT apps.*, users.name AS author_name, users.email AS author_email
         FROM apps
         LEFT JOIN users ON apps.author = users.id
        WHERE apps.id = ?`,
    )
    .get(run.app_id) as
    | (AppRecord & { author_name: string | null; author_email: string | null })
    | undefined;

  // Visibility gate. Public runs are always renderable. Otherwise the
  // caller must present a share_token that matches the app's share link.
  const isPublic = run.is_public === 1;
  const tokenParam = c.req.query('share_token') || '';
  const tokenOk =
    !!appRow?.link_share_token &&
    tokenParam.length > 0 &&
    tokenParam === appRow.link_share_token;
  if (!isPublic && !tokenOk) {
    return c.json({ error: 'Run not found' }, 404);
  }

  const appName = appRow?.name || run.action || 'Floom run';
  const slug = appRow?.slug || '';
  const authorRaw =
    appRow?.author_name && String(appRow.author_name).trim()
      ? String(appRow.author_name).trim()
      : appRow?.author_email && appRow.author_email.includes('@')
      ? appRow.author_email.split('@')[0] || null
      : null;

  const outputPreview = previewFromRunOutputs(run.outputs);
  const relativeTime = formatRunRelative(run.finished_at || run.started_at);

  const copy: OgCopy = {
    title: appName,
    description: '',
    author: authorRaw,
    slug,
    run: {
      runId,
      relativeTime,
      outputPreview,
      label: `output · ${run.action}`,
    },
  };

  const svg = renderSvg(copy);
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
});

ogRouter.get('/:slugPng{[a-z0-9][a-z0-9-]*\\.svg}', (c) => {
  const param = c.req.param('slugPng');
  const slug = param.replace(/\.svg$/, '');

  const row = db
    .prepare(
      `SELECT apps.*, users.name AS author_name, users.email AS author_email
         FROM apps
         LEFT JOIN users ON apps.author = users.id
        WHERE apps.slug = ?`,
    )
    .get(slug) as
    | (AppRecord & { author_name: string | null; author_email: string | null })
    | undefined;

  let copy: OgCopy;
  if (!row) {
    // Fall back to generic Floom card so broken links still render something
    // sensible in previewers rather than a 404 image.
    copy = {
      title: 'Floom',
      description: 'Ship AI apps fast.',
      author: null,
      slug,
    };
  } else {
    const authorRaw = row.author_name && String(row.author_name).trim()
      ? String(row.author_name).trim()
      : row.author_email && row.author_email.includes('@')
      ? row.author_email.split('@')[0] || null
      : null;
    copy = {
      title: row.name || row.slug,
      description: row.description || '',
      author: authorRaw,
      slug,
    };
  }

  const svg = renderSvg(copy);
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
});
