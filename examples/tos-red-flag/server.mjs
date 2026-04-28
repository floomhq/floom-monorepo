#!/usr/bin/env node
// TOS Red Flag Scanner - Gemini-powered proxied-mode HTTP sidecar.
//
// Serves:
//   GET  /health
//   GET  /openapi/tos-red-flag.json
//   POST /tos-red-flag/run

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SLUG = 'tos-red-flag';
const PORT = Number(process.env.PORT || 4360);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://${HOST}:${PORT}`;
const MAX_BODY_BYTES = 1_048_576;
const MAX_TEXT_CHARS = 10_000;
const MAX_SOURCE_CHARS = 100;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15_000);
const SAMPLE_CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sample-cache.json');

const SYSTEM_PROMPT = `You are a privacy and contract law expert who finds problematic clauses in Terms of Service.

Focus on clauses that actually affect the user negatively:
- Data sharing with third parties without explicit consent
- Binding arbitration or class-action waivers
- Broad termination rights
- IP ownership grabs, especially user-generated content
- Auto-renewal traps
- Liability limitations that expose the user
- AI training data clauses

Be specific. Quote the actual clause. Explain it in plain English a non-lawyer can understand.
Do not flag harmless standard boilerplate. Return only the JSON that matches the schema.`;

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['red_flags', 'risk_level', 'plain_english_summary', 'red_flag_count'],
  properties: {
    red_flags: {
      type: 'array',
      items: {
        type: 'object',
        required: ['clause', 'risk_type', 'plain_english', 'severity'],
        properties: {
          clause: { type: 'string' },
          risk_type: {
            type: 'string',
            enum: [
              'data-sharing',
              'arbitration',
              'termination',
              'auto-renewal',
              'liability',
              'ip-ownership',
              'ai-training',
              'other',
            ],
          },
          plain_english: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
    plain_english_summary: { type: 'string' },
    red_flag_count: { type: 'integer', minimum: 0 },
  },
};

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['red_flags', 'risk_level', 'plain_english_summary', 'red_flag_count'],
  properties: {
    ...RESPONSE_JSON_SCHEMA.properties,
    dry_run: { type: 'boolean' },
    cache_hit: { type: 'boolean' },
    model: { type: 'string' },
  },
};

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['text'],
  properties: {
    text: {
      type: 'string',
      maxLength: MAX_TEXT_CHARS,
      description: 'The Terms of Service text to analyze.',
    },
    source: {
      type: 'string',
      maxLength: MAX_SOURCE_CHARS,
      description: 'Optional service name for context.',
    },
  },
};

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'TOS Red Flag Scanner',
    version: '1.0.0',
    description: 'Paste Terms of Service text and get the riskiest clauses explained in plain English.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    [`/${SLUG}/run`]: {
      post: {
        operationId: 'scanTosRedFlags',
        summary: 'Scan Terms of Service text',
        description: 'Finds concerning clauses, classifies risk, and explains the impact in plain English.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: REQUEST_SCHEMA,
              example: {
                text: 'We may share your personal data with third parties for marketing purposes without your explicit consent.',
                source: 'ExampleApp',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'TOS red flag report',
            content: {
              'application/json': { schema: RESPONSE_SCHEMA },
            },
          },
          400: {
            description: 'Invalid input',
            content: {
              'application/json': { schema: errorSchema() },
            },
          },
          502: {
            description: 'Gemini upstream error',
            content: {
              'application/json': { schema: errorSchema() },
            },
          },
        },
      },
    },
  },
};

function errorSchema() {
  return {
    type: 'object',
    required: ['error', 'code'],
    properties: {
      error: { type: 'string' },
      code: { type: 'string' },
    },
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'payload too large', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, 'invalid JSON body', 'invalid_json_body'));
      }
    });
    req.on('error', reject);
  });
}

function httpError(statusCode, message, code = 'bad_request') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function inputHash(text, source) {
  return createHash('sha256').update(`${text.slice(0, 500)}|${source}`, 'utf8').digest('hex');
}

async function loadSampleCache() {
  try {
    return JSON.parse(await readFile(SAMPLE_CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function normalizeInput(body) {
  const inputs = body && typeof body.inputs === 'object' && body.inputs !== null ? body.inputs : body;
  const text = typeof inputs?.text === 'string' ? inputs.text.trim() : '';
  const source = typeof inputs?.source === 'string' ? inputs.source.trim() : '';

  if (!text) {
    throw httpError(400, 'text is required', 'invalid_input');
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw httpError(400, `text too long (max ${MAX_TEXT_CHARS} chars)`, 'invalid_input');
  }
  if (source.length > MAX_SOURCE_CHARS) {
    throw httpError(400, `source too long (max ${MAX_SOURCE_CHARS} chars)`, 'invalid_input');
  }

  return { text, source };
}

function buildPrompt(text, source) {
  const sourceLine = source ? `\nService name: ${source}` : '';
  return `Terms of Service to analyze:${sourceLine}

${text}

Find the 3-7 most concerning clauses for a typical user.
Quote each clause exactly, classify the risk type, and explain in plain English.
For the plain-English summary, lead with the single most important thing to know.`;
}

async function callGemini(prompt) {
  const response_mime_type = 'application/json';
  const response_json_schema = RESPONSE_JSON_SCHEMA;
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: response_mime_type,
      responseJsonSchema: response_json_schema,
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Gemini request failed with HTTP ${res.status}`;
    throw httpError(502, message, res.status === 429 ? 'gemini_quota' : 'gemini_error');
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== 'string') {
    throw httpError(502, 'Gemini returned an empty response', 'gemini_empty_response');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, 'Gemini returned invalid JSON', 'gemini_invalid_json');
  }
}

function dryRun(text) {
  const lower = text.toLowerCase();
  const flags = [];

  if (lower.includes('share') && (lower.includes('third part') || lower.includes('partner'))) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'data-sharing',
      plain_english: 'Your data may be shared with other companies for marketing or partner use.',
      severity: 'high',
    });
  }
  if (lower.includes('arbitration') || lower.includes('waive')) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'arbitration',
      plain_english: 'You may lose the ability to sue in court or join a class action.',
      severity: 'high',
    });
  }
  if (lower.includes('terminate') || lower.includes('any reason')) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'termination',
      plain_english: 'The service may close your account with little or no warning.',
      severity: 'medium',
    });
  }
  if (lower.includes('train') && (lower.includes('model') || lower.includes('ai'))) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'ai-training',
      plain_english: 'Your content may be used to train AI systems.',
      severity: 'medium',
    });
  }
  if (lower.includes('license') && (lower.includes('irrevocable') || lower.includes('royalty-free'))) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'ip-ownership',
      plain_english: 'The service may get broad rights to reuse content you upload.',
      severity: 'medium',
    });
  }

  if (flags.length === 0) {
    flags.push({
      clause: text.slice(0, 180),
      risk_type: 'other',
      plain_english: 'Dry-run heuristic found no major predefined red flag pattern.',
      severity: 'low',
    });
  }

  const riskLevel = flags.some((flag) => flag.severity === 'high')
    ? 'high'
    : flags.some((flag) => flag.severity === 'medium')
      ? 'medium'
      : 'low';

  return {
    red_flags: flags.slice(0, 7),
    risk_level: riskLevel,
    plain_english_summary: 'Dry-run heuristic used because GEMINI_API_KEY is not configured.',
    red_flag_count: Math.min(flags.length, 7),
    dry_run: true,
    cache_hit: false,
    model: 'dry-run',
  };
}

async function scanTos(body) {
  const { text, source } = normalizeInput(body);
  const cache = await loadSampleCache();
  const key = inputHash(text, source);
  if (cache[key]) {
    const redFlags = Array.isArray(cache[key].red_flags) ? cache[key].red_flags : [];
    return {
      ...cache[key],
      red_flag_count: cache[key].red_flag_count ?? redFlags.length,
      dry_run: false,
      cache_hit: true,
      model: cache[key].model || 'sample-fixture (cached)',
    };
  }

  if (!GEMINI_API_KEY) {
    return dryRun(text);
  }

  let result;
  try {
    result = await callGemini(buildPrompt(text, source));
  } catch (err) {
    if (err.code === 'gemini_quota') {
      return {
        ...dryRun(text),
        model: `${GEMINI_MODEL} (quota fallback)`,
      };
    }
    throw err;
  }
  const redFlags = Array.isArray(result.red_flags) ? result.red_flags : [];
  return {
    ...result,
    red_flag_count: result.red_flag_count ?? redFlags.length,
    dry_run: false,
    cache_hit: false,
    model: GEMINI_MODEL,
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', PUBLIC_BASE);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: SLUG });
    }

    if (
      req.method === 'GET' &&
      (pathname === `/openapi/${SLUG}.json` ||
        pathname === `/${SLUG}/openapi.json` ||
        pathname === '/openapi.json')
    ) {
      return sendJson(res, 200, OPENAPI_SPEC);
    }

    if (req.method === 'POST' && pathname === `/${SLUG}/run`) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, err.statusCode || 400, {
          error: err.message || 'invalid request body',
          code: err.code || 'invalid_body',
        });
      }

      try {
        return sendJson(res, 200, await scanTos(body));
      } catch (err) {
        return sendJson(res, err.statusCode || 500, {
          error: err.statusCode ? err.message : 'internal error',
          code: err.code || 'internal_error',
        });
      }
    }

    return sendJson(res, 404, { error: 'not found', code: 'not_found' });
  } catch (err) {
    console.error(`[${SLUG}] request failed`, err);
    return sendJson(res, 500, { error: 'internal error', code: 'internal_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[${SLUG}] listening on ${PUBLIC_BASE}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
