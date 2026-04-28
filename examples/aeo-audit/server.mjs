#!/usr/bin/env node
// AEO Audit — Floom proxy wrapping federicodeponte/openanalytics.
//
// Forwards POST /aeo-audit/run to the openanalytics Python engine.
// Falls back to dry-run if upstream is unavailable.
//
// Endpoint: POST /aeo-audit/run
// OpenAPI:  GET  /openapi.json  |  GET /aeo-audit/openapi.json
// Health:   GET  /health
//
// Run: node examples/aeo-audit/server.mjs
// Env: AEO_AUDIT_PORT=4320 (default), UPSTREAM_URL=http://127.0.0.1:8080 (default)

import { createServer } from 'node:http';

const PORT = Number(process.env.AEO_AUDIT_PORT || 4320);
const HOST = process.env.AEO_AUDIT_HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.AEO_AUDIT_PUBLIC_BASE || `http://${HOST}:${PORT}`;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://127.0.0.1:8080';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

const MAX_BRAND_CHARS = 100;
const MAX_COMPETITORS = 3;
const MAX_TOPICS = 5;

// ---------- helpers ----------

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
      if (size > 1_048_576) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid_json_body')); }
    });
    req.on('error', reject);
  });
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.statusCode = status;
  err.code = code || 'bad_request';
  return err;
}

// ---------- dry-run fallback ----------

function dryRun(brand, competitors = []) {
  return {
    brand,
    score: 42,
    mentions: 3,
    competitors: competitors.map((c) => ({
      brand: c,
      score: Math.floor(Math.random() * 60) + 20,
      mentions: Math.floor(Math.random() * 8) + 1,
    })),
    verdict: 'low',
    top_queries: [`What is ${brand}?`, `${brand} alternatives`, `Best tools similar to ${brand}`],
    recommendations: [
      'Create authoritative content around your top 3 use cases',
      'Build topical authority with FAQ pages answering common queries',
      'Get mentioned on industry review sites (G2, Capterra, ProductHunt)',
    ],
    dry_run: true,
    upstream_available: false,
  };
}

// ---------- upstream call ----------

async function callUpstream(brand, competitors, query_topics) {
  const body = JSON.stringify({ brand, competitors, query_topics });
  const res = await fetch(`${UPSTREAM_URL}/api/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'upstream error');
    throw httpError(502, `upstream ${res.status}: ${text}`);
  }
  const data = await res.json();
  // Normalize upstream response to Floom output schema
  return {
    brand: data.brand || brand,
    score: typeof data.score === 'number' ? Math.round(data.score) : 0,
    mentions: data.mentions || data.mention_count || 0,
    competitors: (data.competitors || []).map((c) => ({
      brand: c.brand || c.name || '',
      score: typeof c.score === 'number' ? Math.round(c.score) : 0,
      mentions: c.mentions || c.mention_count || 0,
    })),
    verdict: data.verdict || scoreToVerdict(data.score || 0),
    top_queries: Array.isArray(data.top_queries) ? data.top_queries.slice(0, 10) : [],
    recommendations: Array.isArray(data.recommendations)
      ? data.recommendations.slice(0, 5)
      : [],
    dry_run: false,
    upstream_available: true,
  };
}

function scoreToVerdict(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 15) return 'low';
  return 'invisible';
}

// ---------- handler ----------

async function handleRun(body) {
  const { brand, competitors = [], query_topics = [] } = body;

  if (!brand || typeof brand !== 'string' || !brand.trim()) {
    throw httpError(400, 'brand is required');
  }
  if (brand.length > MAX_BRAND_CHARS) {
    throw httpError(400, `brand too long (max ${MAX_BRAND_CHARS} chars)`);
  }
  if (!Array.isArray(competitors)) {
    throw httpError(400, 'competitors must be an array');
  }
  if (competitors.length > MAX_COMPETITORS) {
    throw httpError(400, `max ${MAX_COMPETITORS} competitors allowed`);
  }
  const cleanBrand = brand.trim();
  const cleanCompetitors = competitors.map((c) => String(c).trim()).filter(Boolean);
  const cleanTopics = (Array.isArray(query_topics) ? query_topics : [])
    .slice(0, MAX_TOPICS)
    .map((t) => String(t).trim())
    .filter(Boolean);

  // Try upstream; fall back to dry-run if unavailable
  try {
    return await callUpstream(cleanBrand, cleanCompetitors, cleanTopics);
  } catch (err) {
    if (err.statusCode === 502 || err.code === 'UND_ERR_CONNECT_TIMEOUT' || err.name === 'TimeoutError') {
      // Upstream not available — return dry-run
      return dryRun(cleanBrand, cleanCompetitors);
    }
    throw err;
  }
}

// ---------- OpenAPI spec ----------

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'AEO Audit',
    version: '0.1.0',
    description: 'Check how visible your brand is in AI-generated answers vs competitors.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    '/aeo-audit/run': {
      post: {
        operationId: 'aeo_audit_run',
        summary: 'Run AEO visibility audit',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['brand'],
                properties: {
                  brand: {
                    type: 'string',
                    description: 'Brand name or domain to audit',
                    maxLength: MAX_BRAND_CHARS,
                  },
                  competitors: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: MAX_COMPETITORS,
                    description: 'Up to 3 competitor brands to compare',
                  },
                  query_topics: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: MAX_TOPICS,
                    description: 'Optional topic areas to test',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'AEO audit result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['brand', 'score', 'mentions', 'competitors', 'verdict', 'recommendations'],
                  properties: {
                    brand: { type: 'string' },
                    score: { type: 'integer', minimum: 0, maximum: 100 },
                    mentions: { type: 'integer', minimum: 0 },
                    competitors: { type: 'array' },
                    verdict: { type: 'string', enum: ['invisible', 'low', 'medium', 'high'] },
                    top_queries: { type: 'array', items: { type: 'string' } },
                    recommendations: { type: 'array', items: { type: 'string' } },
                    dry_run: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input' },
          502: { description: 'Upstream engine error' },
        },
      },
    },
  },
};

// ---------- HTTP server ----------

const server = createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'GET' && (url === '/health' || url === '/aeo-audit/health')) {
    let upstreamOk = false;
    try {
      const up = await fetch(`${UPSTREAM_URL}/health`, { signal: AbortSignal.timeout(2000) });
      upstreamOk = up.ok;
    } catch {
      // upstream not available
    }
    return sendJson(res, 200, { ok: true, upstream: upstreamOk });
  }

  if (method === 'GET' && (url === '/openapi.json' || url === '/aeo-audit/openapi.json')) {
    return sendJson(res, 200, OPENAPI_SPEC);
  }

  if (method === 'POST' && url === '/aeo-audit/run') {
    try {
      const body = await readJsonBody(req);
      const result = await handleRun(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, err.statusCode || 500, {
        error: err.message,
        code: err.code || 'internal_error',
      });
    }
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[aeo-audit] listening on http://${HOST}:${PORT}\n`);
});
