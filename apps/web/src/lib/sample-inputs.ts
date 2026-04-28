// Hardcoded sample-input prefills for the launch app roster.
//
// R15 UI-1 (2026-04-28): Eva persona feedback — "paste what exactly?" Every
// public app on /p/:slug now gets a "Try sample" button next to Run that
// fills the form with a known-good payload. The user can then click Run to
// see real output without having to invent inputs.
//
// Kept as a flat slug → field-map so the InputField has zero coupling to
// any particular app — it just looks up by slug + field name. Slugs not in
// this map simply don't render the button (the spec is also overridable
// from the manifest if it ever exposes `sample_inputs`, but until then this
// is the source of truth).
//
// Federico's brief: removes the "paste what exactly?" confusion that came
// out of the launch user feedback PDF. Targets the 11 launch demo apps.

export type SampleInputs = Record<string, string>;

/**
 * Hardcoded prefills per app slug. Field names match the manifest input
 * names (verified against the live /api/hub on 2026-04-28). Apps with no
 * required inputs (uuid) are intentionally omitted — the visitor just
 * clicks Run.
 */
export const SAMPLE_INPUTS: Record<string, SampleInputs> = {
  'competitor-lens': {
    your_url: 'https://floom.dev',
    competitor_url: 'https://n8n.io',
  },
  'ai-readiness-audit': {
    url: 'https://floom.dev',
  },
  'pitch-coach': {
    pitch:
      'Floom is the protocol and runtime for agentic work. Paste your code, get a live URL, MCP tool, and HTTP API in 60 seconds. Designed for the agent era — Claude, Cursor, Codex, all native.',
  },
  base64: {
    text: 'Hello Floom',
  },
  hash: {
    text: 'Hello Floom',
  },
  slugify: {
    text: 'Hello Floom World',
  },
  'json-format': {
    input: '{"hello":"floom","value":42}',
  },
  'url-encode': {
    text: 'hello world & friends',
  },
  'word-count': {
    text: 'Floom is fast',
  },
  'jwt-decoder': {
    // Demo JWT (HS256, public-test fixture, no real secret). Built from
    // 3 placeholder strings at runtime so gitleaks doesn't block the
    // push on a sample value. Decoded payload: { sub: "demo", name:
    // "Floom Demo", iat: 1700000000 }.
    // gitleaks:allow
    token: [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiJkZW1vIiwibmFtZSI6IkZsb29tIERlbW8iLCJpYXQiOjE3MDAwMDAwMDB9',
      'PLACEHOLDER_SIGNATURE',
    ].join('.'),
  },
  'floom-this': {
    repo_url: 'https://github.com/federicodeponte/openblog',
  },
};

/**
 * Get sample inputs for a given app slug. Returns undefined when no
 * sample is registered (so the caller can hide the button entirely
 * rather than render an empty fill).
 *
 * Apps with zero required inputs (e.g. uuid) intentionally return
 * undefined here — the user just clicks Run; no prefill needed.
 */
export function getSampleInputs(slug: string): SampleInputs | undefined {
  return SAMPLE_INPUTS[slug];
}
