#!/usr/bin/env node
// OpenDraft (Outline Preview) — Floom sidecar for federicodeponte/opendraft.
//
// Generates a thesis-style outline + sample search terms in <8s via a single
// Gemini call. This is a preview, not the full engine. The full engine runs
// 19 agents over 10 minutes and produces a 20k-word verified-citation draft.
//
// Full engine: https://github.com/federicodeponte/opendraft
// Live demo:   https://opendraft.xyz
//
// Exposes:
//   GET  /health
//   GET  /openapi.json
//   POST /opendraft-outline/run
//
// Run: node examples/opendraft-outline/server.mjs
// Env: PORT=4240 (default), GEMINI_API_KEY (required)

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4240);
const MAX_BODY_BYTES = 32 * 1024;

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, 'request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Gemini call — mandatory JSON schema + application/json mime
// ---------------------------------------------------------------------------

async function callGemini({ prompt, responseSchema, timeoutMs = 18_000 }) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) throw httpError(503, 'GEMINI_API_KEY is not configured');

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: responseSchema,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message || detail;
    } catch { /* ignore */ }
    throw httpError(res.status >= 500 ? 502 : res.status, `Gemini error: ${detail}`);
  }

  let outer;
  try {
    outer = JSON.parse(text);
  } catch {
    throw httpError(502, 'Gemini returned non-JSON response');
  }

  const raw = outer?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw httpError(502, 'Gemini returned no content');

  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(502, 'Gemini response was not valid JSON');
  }
}

// ---------------------------------------------------------------------------
// Gemini JSON schema for the outline
// ---------------------------------------------------------------------------

const outlineGeminiSchema = {
  type: 'OBJECT',
  properties: {
    working_title: { type: 'STRING' },
    thesis_statement: { type: 'STRING' },
    outline: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING' },
          key_points: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          suggested_citations_count: { type: 'INTEGER' },
        },
        required: ['heading', 'key_points', 'suggested_citations_count'],
      },
    },
    sample_search_terms: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    screenshot_card_summary: { type: 'STRING' },
    next_step_cta: { type: 'STRING' },
  },
  required: [
    'working_title',
    'thesis_statement',
    'outline',
    'sample_search_terms',
    'screenshot_card_summary',
    'next_step_cta',
  ],
};

// ---------------------------------------------------------------------------
// Outline generation
// ---------------------------------------------------------------------------

const SECTION_COUNTS = { short: [5, 6], medium: [6, 7], long: [8, 9] };

function targetLength(raw) {
  const val = String(raw || 'medium').toLowerCase().trim();
  if (val === 'short') return 'short';
  if (val === 'long') return 'long';
  return 'medium';
}

function sectionCountHint(len) {
  const [min, max] = SECTION_COUNTS[len];
  return `${min} to ${max}`;
}

async function generateOutline(body) {
  const researchQuestion = String(body.research_question || '').trim();
  if (!researchQuestion) throw httpError(400, 'research_question is required');
  if (researchQuestion.length < 10) throw httpError(400, 'research_question must be at least 10 characters');
  if (researchQuestion.length > 300) throw httpError(400, 'research_question must be at most 300 characters');

  const discipline = String(body.discipline || '').trim();
  const length = targetLength(body.target_length);
  const sectionHint = sectionCountHint(length);

  const disciplineLine = discipline
    ? `Discipline / field: ${discipline}.`
    : 'Infer the most relevant academic discipline from the research question.';

  const prompt = [
    `You are an expert academic research advisor helping a graduate student plan a thesis-level research paper.`,
    `Your task is to produce a rigorous, research-grade outline for the following question.`,
    ``,
    `Research question: ${researchQuestion}`,
    `${disciplineLine}`,
    `Target length: ${length} (produce ${sectionHint} sections in the outline).`,
    ``,
    `Rules:`,
    `- working_title: a clear, specific academic title of approximately 80 characters. No buzzwords.`,
    `- thesis_statement: one precise sentence stating the central argument or hypothesis.`,
    `- outline: an array of ${sectionHint} sections. Each section has:`,
    `    - heading: a descriptive section title (e.g. "2. Literature Review: Aerosol Microphysics and Precipitation Coupling")`,
    `    - key_points: 3 to 5 concise bullet points covering what this section argues or covers`,
    `    - suggested_citations_count: realistic integer estimate of primary sources needed for this section`,
    `- sample_search_terms: 3 to 5 precise Boolean or keyword phrases the researcher can paste into Crossref, OpenAlex, or Semantic Scholar`,
    `- screenshot_card_summary: one punchy sentence of approximately 140 characters for a share card`,
    `- next_step_cta: use EXACTLY this string: "Run the full draft locally — github.com/federicodeponte/opendraft"`,
    ``,
    `Tone: research-grade, precise, no emojis, no marketing language.`,
    `Do not claim this outline is a finished draft. It is a structured starting point.`,
  ].join('\n');

  const result = await callGemini({
    prompt,
    responseSchema: outlineGeminiSchema,
    timeoutMs: 16_000,
  });

  // Enforce the fixed CTA regardless of what Gemini returns
  result.next_step_cta = 'Run the full draft locally — github.com/federicodeponte/opendraft';

  // Clamp outline array to valid range
  const [minSec] = SECTION_COUNTS[length];
  if (!Array.isArray(result.outline) || result.outline.length < minSec) {
    throw httpError(502, 'Gemini returned an outline with too few sections');
  }

  return {
    ...result,
    _meta: {
      engine: 'opendraft-outline-preview',
      engine_version: '0.1.0',
      model: GEMINI_MODEL,
      full_engine_url: 'https://github.com/federicodeponte/opendraft',
      full_engine_demo: 'https://opendraft.xyz',
      disclaimer:
        'This is a structured outline preview. The full OpenDraft engine runs 19 agents over ~10 minutes and produces a 20,000-word draft with verified citations from 250M+ academic papers.',
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAPI spec
// ---------------------------------------------------------------------------

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'OpenDraft (Outline Preview)',
    version: '0.1.0',
    description:
      'Floom preview wrapper for federicodeponte/opendraft — the open-source AI thesis writer with 19 agents, verified citations, and 20k-word output in 10 minutes. This endpoint generates a thesis-style outline and sample search terms in under 8 seconds. Full engine: https://github.com/federicodeponte/opendraft | Live: https://opendraft.xyz',
  },
  servers: [{ url: `http://localhost:${PORT}` }],
  paths: {
    '/opendraft-outline/run': {
      post: {
        operationId: 'generateOutline',
        summary: 'Generate thesis outline and search terms',
        description:
          'Takes a research question and returns a structured thesis outline with section headings, key arguments, suggested citation counts, and sample search terms for Crossref/OpenAlex/Semantic Scholar.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['research_question'],
                properties: {
                  research_question: {
                    type: 'string',
                    minLength: 10,
                    maxLength: 300,
                    description:
                      'The central research question for the thesis. Example: "How does aerosol cloud seeding affect regional precipitation patterns?"',
                  },
                  discipline: {
                    type: 'string',
                    description:
                      'Optional academic discipline or field to bias the outline, e.g. "atmospheric physics", "behavioral economics". If omitted, the AI infers the field.',
                  },
                  target_length: {
                    type: 'string',
                    enum: ['short', 'medium', 'long'],
                    default: 'medium',
                    description:
                      'Informs the section count: short (5-6 sections), medium (6-7), long (8-9). Does not affect AI generation time.',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Thesis outline with metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'working_title',
                    'thesis_statement',
                    'outline',
                    'sample_search_terms',
                    'screenshot_card_summary',
                    'next_step_cta',
                    '_meta',
                  ],
                  properties: {
                    working_title: { type: 'string' },
                    thesis_statement: { type: 'string' },
                    outline: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['heading', 'key_points', 'suggested_citations_count'],
                        properties: {
                          heading: { type: 'string' },
                          key_points: { type: 'array', items: { type: 'string' } },
                          suggested_citations_count: { type: 'integer' },
                        },
                      },
                    },
                    sample_search_terms: { type: 'array', items: { type: 'string' } },
                    screenshot_card_summary: { type: 'string' },
                    next_step_cta: {
                      type: 'string',
                      example: 'Run the full draft locally — github.com/federicodeponte/opendraft',
                    },
                    _meta: {
                      type: 'object',
                      properties: {
                        engine: { type: 'string' },
                        engine_version: { type: 'string' },
                        model: { type: 'string' },
                        full_engine_url: { type: 'string' },
                        full_engine_demo: { type: 'string' },
                        disclaimer: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input' },
          503: { description: 'GEMINI_API_KEY not configured' },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, app: 'opendraft-outline', port: PORT });
    return;
  }

  if (req.method === 'GET' && pathname === '/openapi.json') {
    sendJson(res, 200, openApiSpec);
    return;
  }

  if (req.method === 'POST' && pathname === '/opendraft-outline/run') {
    try {
      const body = await readJson(req);
      const result = await generateOutline(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || 'internal error' });
  });
}).listen(PORT, () => {
  console.log(`OpenDraft Outline Preview listening on http://localhost:${PORT}`);
  console.log(`  POST /opendraft-outline/run — generate thesis outline`);
  console.log(`  GET  /openapi.json           — OpenAPI spec`);
  console.log(`  GET  /health                 — health check`);
  console.log(`  Full engine: https://github.com/federicodeponte/opendraft`);
});
