#!/usr/bin/env node
// Crawl4AI Fetch — Floom proxy wrapping unclecode/crawl4ai.
//
// Wraps the crawl4ai Python engine (persistent Chromium pool) for Floom's HTTP contract.
// Falls back to simple Node.js fetch (no JS rendering) if upstream container is unavailable.
//
// Endpoint: POST /crawl4ai-fetch/run
// OpenAPI:  GET  /openapi.json  |  GET /crawl4ai-fetch/openapi.json
// Health:   GET  /health
//
// Run: node examples/crawl4ai-fetch/server.mjs
// Env: CRAWL4AI_FETCH_PORT=4330 (default), UPSTREAM_URL=http://127.0.0.1:11235 (crawl4ai default)

import { createServer } from 'node:http';
import { safeFetch } from '../../lib/ssrf-guard.mjs';

const PORT = Number(process.env.CRAWL4AI_FETCH_PORT || 4330);
const HOST = process.env.CRAWL4AI_FETCH_HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.CRAWL4AI_FETCH_PUBLIC_BASE || `http://${HOST}:${PORT}`;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://127.0.0.1:11235';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

const MAX_URL_CHARS = 2_048;
const MAX_WAIT_FOR_CHARS = 200;

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

function httpError(status, message, code, extra = {}) {
  const err = new Error(message);
  err.statusCode = status;
  err.code = code || 'bad_request';
  Object.assign(err, extra);
  return err;
}

function ssrfError(err) {
  return httpError(400, 'ssrf_blocked', 'ssrf_blocked', {
    host: err.message.split(':').slice(1).join(':').trim(),
  });
}

// ---------- simple HTML → Markdown fallback ----------

function simpleHtmlToMarkdown(html, baseUrl) {
  let md = html;
  let title = '';

  const titleMatch = md.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  const bodyMatch = md.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) md = bodyMatch[1];

  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, c) =>
    '\n' + '#'.repeat(Number(n)) + ' ' + c.replace(/<[^>]+>/g, '').trim() + '\n'
  );
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '_$1_');
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = text.replace(/<[^>]+>/g, '').trim();
    return t ? `[${t}](${href})` : href;
  });
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) =>
    '\n' + c.replace(/<[^>]+>/g, '').trim() + '\n'
  );
  md = md.replace(/<br[^>]*\/?>/gi, '\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  md = md.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

  return { markdown: md, title };
}

// ---------- upstream call (crawl4ai) ----------

async function callCrawl4ai(url, waitFor, includeLinks) {
  // crawl4ai REST API: POST /crawl
  const requestBody = {
    urls: [url],
    crawler_params: {
      headless: true,
      wait_for: waitFor || undefined,
    },
    extra: {
      include_links: includeLinks !== false,
    },
  };

  const res = await fetch(`${UPSTREAM_URL}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'crawl4ai error');
    throw httpError(502, `crawl4ai ${res.status}: ${text}`);
  }

  const data = await res.json();
  const result = Array.isArray(data.results) ? data.results[0] : data;

  return {
    markdown: result.markdown || result.cleaned_html || '',
    title: result.metadata?.title || result.title || '',
    url: result.url || url,
    links: Array.isArray(result.links?.external) ? result.links.external.slice(0, 50) : [],
    word_count: (result.markdown || '').split(/\s+/).filter(Boolean).length,
    method: 'crawl4ai',
  };
}

// ---------- simple fetch fallback ----------

async function simpleFetch(url, includeLinks) {
  const res = await safeFetch(url, {
    headers: {
      'User-Agent': 'Floom-Crawl4AI-Fetch/0.1 (compatible; simple-fetch-fallback)',
      'Accept': 'text/html,*/*',
    },
    timeoutMs: 10000,
  });

  if (!res.ok) {
    throw httpError(502, `URL returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const { markdown, title } = simpleHtmlToMarkdown(html, url);

  // Extract links if requested
  const links = [];
  if (includeLinks !== false) {
    const linkRe = /href="(https?:\/\/[^"]+)"/gi;
    let match;
    while ((match = linkRe.exec(html)) !== null && links.length < 50) {
      links.push(match[1]);
    }
  }

  return {
    markdown,
    title,
    url: res.url || url,
    links,
    word_count: markdown.split(/\s+/).filter(Boolean).length,
    method: 'simple-fetch-fallback',
  };
}

// ---------- handler ----------

async function handleRun(body) {
  const { url, wait_for, include_links = true } = body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    throw httpError(400, 'url is required');
  }
  if (url.length > MAX_URL_CHARS) {
    throw httpError(400, `url too long (max ${MAX_URL_CHARS} chars)`);
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw httpError(400, 'url must start with http:// or https://');
  }
  if (wait_for && (typeof wait_for !== 'string' || wait_for.length > MAX_WAIT_FOR_CHARS)) {
    throw httpError(400, 'wait_for must be a CSS selector string (max 200 chars)');
  }

  try {
    await safeFetch(url.trim(), {
      method: 'HEAD',
      headers: { 'User-Agent': 'Floom-Crawl4AI-Fetch/0.1 (ssrf-preflight)' },
      timeoutMs: 5000,
      maxBodyBytes: 0,
    });
  } catch (err) {
    if (err.message?.startsWith('ssrf_blocked:')) throw ssrfError(err);
    if (err.message !== 'response_too_large') {
      throw httpError(502, `Failed to validate URL: ${err.message}`);
    }
  }

  // Try crawl4ai upstream first; fall back to simple fetch
  try {
    return await callCrawl4ai(url.trim(), wait_for, include_links);
  } catch (err) {
    if (err.message?.startsWith('ssrf_blocked:')) throw ssrfError(err);
    if (
      err.statusCode === 502 ||
      err.name === 'TimeoutError' ||
      err.code === 'ECONNREFUSED' ||
      err.message?.includes('fetch failed')
    ) {
      // Upstream not available — use simple fetch
      return await simpleFetch(url.trim(), include_links);
    }
    throw err;
  }
}

// ---------- OpenAPI spec ----------

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Crawl4AI Fetch',
    version: '0.1.0',
    description: 'Fetch any URL and get clean Markdown content for AI pipelines.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    '/crawl4ai-fetch/run': {
      post: {
        operationId: 'crawl4ai_fetch_run',
        summary: 'Fetch URL and return Markdown',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  url: { type: 'string', description: 'URL to fetch', maxLength: MAX_URL_CHARS },
                  wait_for: { type: 'string', description: 'CSS selector to wait for', maxLength: MAX_WAIT_FOR_CHARS },
                  include_links: { type: 'boolean', description: 'Include links in output', default: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Page content as Markdown',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown', 'title', 'url', 'word_count'],
                  properties: {
                    markdown: { type: 'string' },
                    title: { type: 'string' },
                    url: { type: 'string' },
                    links: { type: 'array', items: { type: 'string' } },
                    word_count: { type: 'integer' },
                    method: { type: 'string', description: 'crawl4ai or simple-fetch-fallback' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input' },
          502: { description: 'Failed to fetch URL' },
        },
      },
    },
  },
};

// ---------- HTTP server ----------

const server = createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'GET' && (url === '/health' || url === '/crawl4ai-fetch/health')) {
    let upstreamWarm = false;
    try {
      const up = await fetch(`${UPSTREAM_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const data = await up.json().catch(() => ({}));
      upstreamWarm = up.ok && (data.warm !== false);
    } catch {
      // upstream not available
    }
    return sendJson(res, 200, { ok: true, upstream: upstreamWarm, fallback: 'simple-fetch' });
  }

  if (method === 'GET' && (url === '/openapi.json' || url === '/crawl4ai-fetch/openapi.json')) {
    return sendJson(res, 200, OPENAPI_SPEC);
  }

  if (method === 'POST' && url === '/crawl4ai-fetch/run') {
    try {
      const body = await readJsonBody(req);
      const result = await handleRun(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, err.statusCode || 500, {
        error: err.message,
        ...(err.host ? { host: err.host } : {}),
        code: err.code || 'internal_error',
      });
    }
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[crawl4ai-fetch] listening on http://${HOST}:${PORT}\n`);
});
