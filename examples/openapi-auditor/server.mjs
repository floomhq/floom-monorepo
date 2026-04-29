#!/usr/bin/env node
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const SLUG = 'openapi-auditor';
const DISPLAY_NAME = "OpenAPI Spec Auditor";
const PORT = Number(process.env.PORT || 15402);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://${HOST}:${PORT}`;
const REQUIRED = ["spec"];
const SAMPLE_INPUT = {
  "spec": "{\"openapi\":\"3.0.0\",\"paths\":{\"/run\":{\"post\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}"
};

const REQUEST_SCHEMA = {
  type: 'object',
  required: REQUIRED,
  properties: Object.fromEntries(REQUIRED.map((key) => [key, { type: key === 'limit' ? 'integer' : 'string' }])),
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
};

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: { title: DISPLAY_NAME, version: '1.0.0', description: "Paste an OpenAPI document and get ingest readiness, blockers, and fixes." },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    [`/${SLUG}/run`]: {
      post: {
        operationId: SLUG.replace(/-/g, '_') + '_run',
        summary: DISPLAY_NAME,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: REQUEST_SCHEMA, example: SAMPLE_INPUT } },
        },
        responses: {
          200: { description: 'Result', content: { 'application/json': { schema: RESPONSE_SCHEMA } } },
          400: { description: 'Invalid input' },
        },
      },
    },
  },
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_048_576) {
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

function validate(body) {
  for (const key of REQUIRED) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      throw httpError(400, `${key} is required`, 'missing_required_field');
    }
  }
}

function stableInt(value, max) {
  const hash = createHash('sha256').update(String(value)).digest();
  return hash[0] % max;
}

function run(body) {
  validate(body);
  switch ("audit") {
    case 'leads': {
      const country = String(body.country).trim();
      const type = String(body.business_type).trim();
      const limit = Math.min(Number(body.limit || 5), 25);
      const leads = Array.from({ length: limit }, (_, index) => ({
        company: `${title(type)} ${index + 1}`,
        country,
        email: `hello+${index + 1}@example.com`,
        source: 'deterministic public-directory scaffold',
        confidence: 70 + stableInt(`${country}:${type}:${index}`, 25),
      }));
      return { leads, count: leads.length, query: { country, business_type: type }, export_filename: `${slugify(country)}-${slugify(type)}-leads.json` };
    }
    case 'audit': {
      const raw = typeof body.spec === 'string' ? body.spec : JSON.stringify(body.spec);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const issues = [];
      if (!parsed?.openapi && !parsed?.swagger) issues.push({ severity: 'high', message: 'Missing OpenAPI or Swagger version field.' });
      if (!parsed?.paths || Object.keys(parsed.paths || {}).length === 0) issues.push({ severity: 'high', message: 'No paths defined.' });
      if (!raw.includes('operationId')) issues.push({ severity: 'medium', message: 'Missing operationId values.' });
      const score = Math.max(0, 100 - issues.length * 25);
      return { ready: issues.length === 0, score, issues, fixes: issues.map((issue) => `Fix: ${issue.message}`) };
    }
    case 'aeo': {
      const brand = String(body.brand).trim();
      const competitors = Array.isArray(body.competitors) ? body.competitors.map(String).slice(0, 3) : [];
      return {
        brand,
        score: 45 + stableInt(brand, 45),
        mentions: 2 + stableInt(brand, 8),
        competitors: competitors.map((name) => ({ brand: name, score: 35 + stableInt(name, 50), mentions: 1 + stableInt(name, 6) })),
        recommendations: ['Publish comparison pages', 'Add answer-ready FAQ sections', 'Earn citations from trusted directories'],
      };
    }
    case 'format': {
      const content = String(body.content);
      const markdown = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n').replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n').replace(/<[^>]+>/g, '').trim();
      return { markdown, detected_format: content.trim().startsWith('<') ? 'html' : 'text', metadata: { characters: content.length, words: markdown.split(/\s+/).filter(Boolean).length } };
    }
    case 'review': {
      const diff = String(body.diff);
      const findings = [];
      if (/process\.env|SECRET|TOKEN|PASSWORD/i.test(diff)) findings.push({ severity: 'high', file: 'diff', message: 'Diff references sensitive runtime configuration; verify no value is logged or returned.' });
      if (/console\.log/.test(diff)) findings.push({ severity: 'medium', file: 'diff', message: 'Console logging added in application code.' });
      if (findings.length === 0) findings.push({ severity: 'low', file: 'diff', message: 'No blocking issue detected in deterministic scan.' });
      return { findings, summary: `${findings.length} finding(s) from deterministic review.`, risk_score: Math.min(100, findings.length * 35) };
    }
    case 'ticket': {
      const ticket = String(body.ticket);
      const urgent = /down|cannot|failed|error|blocked/i.test(ticket);
      return {
        summary: ticket.slice(0, 140),
        root_cause: urgent ? 'Workflow failure reported by customer.' : 'Request needs support triage.',
        urgency: urgent ? 'high' : 'normal',
        reply: 'Thanks for the report. We identified the affected workflow and are checking the export path now. We will follow up with the next concrete update.',
      };
    }
  }
}

function title(value) {
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', PUBLIC_BASE);
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === `/${SLUG}/health`)) {
    return sendJson(res, 200, { ok: true, service: SLUG });
  }
  if (req.method === 'GET' && (url.pathname === `/openapi/${SLUG}.json` || url.pathname === `/${SLUG}/openapi.json` || url.pathname === '/openapi.json')) {
    return sendJson(res, 200, OPENAPI_SPEC);
  }
  if (req.method === 'POST' && url.pathname === `/${SLUG}/run`) {
    try {
      const body = await readJsonBody(req);
      return sendJson(res, 200, run(body));
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: err.message, code: err.code || 'internal_error' });
    }
  }
  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[${SLUG}] listening on http://${HOST}:${PORT}\n`);
});
