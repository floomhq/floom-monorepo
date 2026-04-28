#!/usr/bin/env node
// Subject Line Scorer - Gemini-powered proxied-mode HTTP sidecar.
//
// Serves:
//   GET  /health
//   GET  /openapi/email-subject-scorer.json
//   POST /email-subject-scorer/run

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SLUG = 'email-subject-scorer';
const PORT = Number(process.env.PORT || 4350);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://${HOST}:${PORT}`;
const MAX_BODY_BYTES = 1_048_576;
const MAX_SUBJECT_CHARS = 200;
const MAX_CONTEXT_CHARS = 500;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 12_000);
const SAMPLE_CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sample-cache.json');

const SYSTEM_PROMPT = `You are an email deliverability and engagement expert who evaluates subject lines.

Be specific and direct. Score based on:
- Curiosity gap: does it make the reader want to know more?
- Clarity: is it instantly clear what the email is about?
- Relevance: does it speak to a real pain or goal?
- Spam signals: ALL CAPS, excessive punctuation, "urgent", "free", "act now"
- Length: 30-50 characters is optimal; flag if too long or too short

Do not praise bad subject lines. Do not be vague. Return only the JSON that matches the schema.`;

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['score', 'verdict', 'issues', 'rewrites', 'explanation'],
  properties: {
    score: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description: 'Open-rate prediction: 1 = terrible, 10 = excellent',
    },
    verdict: {
      type: 'string',
      enum: ['weak', 'average', 'strong'],
      description: 'One-word quality verdict',
    },
    issues: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Top problems with the subject line',
    },
    rewrites: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        required: ['angle', 'subject'],
        properties: {
          angle: { type: 'string', enum: ['curiosity', 'value', 'directness'] },
          subject: { type: 'string' },
        },
      },
      description: '3 stronger rewrites with angle labels',
    },
    explanation: {
      type: 'string',
      description: 'One sentence explaining the score',
    },
  },
};

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['score', 'verdict', 'issues', 'rewrites', 'explanation'],
  properties: {
    ...RESPONSE_JSON_SCHEMA.properties,
    dry_run: { type: 'boolean' },
    cache_hit: { type: 'boolean' },
    model: { type: 'string' },
  },
};

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['subject'],
  properties: {
    subject: {
      type: 'string',
      maxLength: MAX_SUBJECT_CHARS,
      description: 'The email subject line to score.',
    },
    context: {
      type: 'string',
      maxLength: MAX_CONTEXT_CHARS,
      description: 'Optional context about the email.',
    },
  },
};

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Subject Line Scorer',
    version: '1.0.0',
    description: 'Paste an email subject line and get an open-rate score, issues, and stronger rewrites.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    [`/${SLUG}/run`]: {
      post: {
        operationId: 'scoreEmailSubject',
        summary: 'Score an email subject line',
        description: 'Scores a subject line for open-rate potential and returns three stronger rewrites.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: REQUEST_SCHEMA,
              example: {
                subject: 'Quick question about your marketing strategy',
                context: 'B2B SaaS cold outreach',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Subject line score',
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

function inputHash(subject, context) {
  return createHash('sha256').update(`${subject}|${context}`, 'utf8').digest('hex');
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
  const subject = typeof inputs?.subject === 'string' ? inputs.subject.trim() : '';
  const context = typeof inputs?.context === 'string' ? inputs.context.trim() : '';

  if (!subject) {
    throw httpError(400, 'subject is required', 'invalid_input');
  }
  if (subject.length > MAX_SUBJECT_CHARS) {
    throw httpError(400, `subject too long (max ${MAX_SUBJECT_CHARS} chars)`, 'invalid_input');
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    throw httpError(400, `context too long (max ${MAX_CONTEXT_CHARS} chars)`, 'invalid_input');
  }

  return { subject, context };
}

function buildPrompt(subject, context) {
  const contextLine = context ? `\nContext about this email: ${context}` : '';
  return `Subject line to evaluate:
${subject}${contextLine}

Score it 1-10 on open-rate potential.
List exactly the top 1-3 specific issues.
Write exactly 3 stronger rewrites, one per angle: curiosity, value, directness.
Each rewrite must be meaningfully different from the original and from each other.`;
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
      temperature: 0.2,
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

function dryRun(subject) {
  const wordCount = subject.split(/\s+/).filter(Boolean).length;
  const upper = subject.toUpperCase();
  const hasSpam = ['URGENT', 'ACT NOW', 'FREE', 'LIMITED', '!!!'].some((term) => upper.includes(term));
  const isReplyPrefix = /^(re|fw|fwd):/i.test(subject);

  if (hasSpam) {
    return {
      score: 2,
      verdict: 'weak',
      issues: ['Spam trigger words detected', 'Excessive urgency reduces trust', 'No specific value proposition'],
      rewrites: [
        { angle: 'curiosity', subject: 'A cleaner way to frame this offer' },
        { angle: 'value', subject: 'One useful idea for this week' },
        { angle: 'directness', subject: 'Worth a quick look?' },
      ],
      explanation: 'Urgency and spam-like wording make this less credible in the inbox.',
      dry_run: true,
      cache_hit: false,
      model: 'dry-run',
    };
  }

  if (isReplyPrefix) {
    return {
      score: 5,
      verdict: 'average',
      issues: ['Reply prefix can feel misleading', 'No clear hook for a cold reader'],
      rewrites: [
        { angle: 'curiosity', subject: 'The one gap I noticed in your proposal' },
        { angle: 'value', subject: '3 ways to strengthen your proposal' },
        { angle: 'directness', subject: 'Feedback on your proposal: 2 quick points' },
      ],
      explanation: 'The follow-up framing creates familiarity but does not give a strong reason to open.',
      dry_run: true,
      cache_hit: false,
      model: 'dry-run',
    };
  }

  const score = wordCount < 4 || wordCount > 11 ? 4 : 6;
  return {
    score,
    verdict: score >= 6 ? 'average' : 'weak',
    issues: score >= 6
      ? ['Subject is clear but the hook is mild']
      : ['Subject length makes the value harder to scan', 'Reader benefit is not specific enough'],
    rewrites: [
      { angle: 'curiosity', subject: `Quick thought on ${subject.slice(0, 32)}` },
      { angle: 'value', subject: 'A practical way to improve this result' },
      { angle: 'directness', subject: `${subject.slice(0, 42)} - quick note` },
    ],
    explanation: 'Dry-run heuristic used because GEMINI_API_KEY is not configured.',
    dry_run: true,
    cache_hit: false,
    model: 'dry-run',
  };
}

async function scoreSubject(body) {
  const { subject, context } = normalizeInput(body);
  const cache = await loadSampleCache();
  const key = inputHash(subject, context);
  if (cache[key]) {
    return {
      ...cache[key],
      dry_run: false,
      cache_hit: true,
      model: cache[key].model || 'sample-fixture (cached)',
    };
  }

  if (!GEMINI_API_KEY) {
    return dryRun(subject);
  }

  let result;
  try {
    result = await callGemini(buildPrompt(subject, context));
  } catch (err) {
    if (err.code === 'gemini_quota') {
      return {
        ...dryRun(subject),
        model: `${GEMINI_MODEL} (quota fallback)`,
      };
    }
    throw err;
  }
  return {
    ...result,
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
        return sendJson(res, 200, await scoreSubject(body));
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
