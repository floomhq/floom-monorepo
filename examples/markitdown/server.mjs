#!/usr/bin/env node
// MarkItDown — Floom deterministic app.
// Converts HTML/text to clean Markdown. Rewrite of microsoft/markitdown core logic in Node.js.
//
// Endpoint: POST /markitdown/run
// OpenAPI:  GET  /openapi.json  |  GET /markitdown/openapi.json
// Health:   GET  /health
//
// Run: node examples/markitdown/server.mjs
// Env: MARKITDOWN_PORT=4310 (default)

import { createServer } from 'node:http';

const PORT = Number(process.env.MARKITDOWN_PORT || 4310);
const HOST = process.env.MARKITDOWN_HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.MARKITDOWN_PUBLIC_BASE || `http://${HOST}:${PORT}`;

const MAX_CONTENT_CHARS = 100_000;
const MAX_URL_CHARS = 2_048;

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
      if (size > 2_097_152) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json_body'));
      }
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

// ---------- HTML to Markdown core ----------

/**
 * Convert HTML to Markdown. Core logic adapted from microsoft/markitdown.
 * Handles: headings, bold, italic, links, lists, code, blockquotes, tables.
 */
function htmlToMarkdown(html) {
  let md = html;

  // Extract title from <title> tag
  let title = '';
  const titleMatch = md.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Extract body content if full HTML document
  const bodyMatch = md.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) md = bodyMatch[1];

  // Strip scripts and styles (including content)
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n# ${clean(c)}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n## ${clean(c)}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n### ${clean(c)}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n#### ${clean(c)}\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n##### ${clean(c)}\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n###### ${clean(c)}\n`);

  // Extract first heading as title if not already found
  if (!title) {
    const h1Match = md.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }

  // Convert inline formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, c) => `**${clean(c)}**`);
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, c) => `**${clean(c)}**`);
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, c) => `_${clean(c)}_`);
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, c) => `_${clean(c)}_`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${c}\``);

  // Convert links (before stripping tags)
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = clean(text);
    if (!t || t === href) return href;
    return `[${t}](${href})`;
  });

  // Convert images
  md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, (_, alt) => alt ? `![${alt}]()` : '');
  md = md.replace(/<img[^>]*>/gi, '');

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) =>
    clean(c).split('\n').map(line => `> ${line}`).join('\n') + '\n'
  );

  // Convert pre/code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => `\`\`\`\n${c}\n\`\`\`\n`);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\`\`\`\n${c}\n\`\`\`\n`);

  // Convert lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, c) => `- ${clean(c)}\n`) + '\n';
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let n = 0;
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, c) => `${++n}. ${clean(c)}\n`) + '\n';
  });

  // Convert table (basic)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows = [];
    tableContent.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (__, row) => {
      const cells = [];
      row.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (__, cell) => cells.push(clean(cell)));
      if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
    });
    if (rows.length > 1) {
      rows.splice(1, 0, '| ' + rows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |');
    }
    return rows.join('\n') + '\n';
  });

  // Convert paragraph and line break elements
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n${clean(c)}\n`);
  md = md.replace(/<br[^>]*\/?>/gi, '\n');
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, c) => `\n${clean(c)}\n`);

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = decodeEntities(md);

  // Normalize whitespace
  md = md.replace(/\r\n/g, '\n');
  md = md.replace(/[ \t]+\n/g, '\n');
  md = md.replace(/\n{4,}/g, '\n\n\n');
  md = md.trim();

  return { markdown: md, title };
}

/** Strip inner HTML tags for use in text content. */
function clean(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/g, '');
}

function detectFormat(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('/>'))) return 'html';
  if (/^#{1,6}\s/.test(trimmed) || /\*\*[^*]+\*\*/.test(trimmed)) return 'markdown';
  return 'plain';
}

function countWords(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

// ---------- handler ----------

async function handleRun(body) {
  const { content, url, format = 'auto' } = body;

  if (!content && !url) {
    throw httpError(400, 'provide either content or url');
  }

  let raw = content || '';

  if (url) {
    if (typeof url !== 'string' || url.length > MAX_URL_CHARS) {
      throw httpError(400, 'url too long or invalid');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw httpError(400, 'url must start with http:// or https://');
    }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Floom-MarkItDown/0.1' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw httpError(502, `URL returned HTTP ${response.status}`);
      }
      raw = await response.text();
    } catch (err) {
      if (err.statusCode) throw err;
      throw httpError(502, `Failed to fetch URL: ${err.message}`);
    }
  }

  if (typeof raw !== 'string') {
    throw httpError(400, 'content must be a string');
  }
  if (raw.length > MAX_CONTENT_CHARS) {
    raw = raw.slice(0, MAX_CONTENT_CHARS);
  }

  const detectedFormat = format === 'auto' ? detectFormat(raw) : format;

  let markdown, title;

  if (detectedFormat === 'html') {
    const result = htmlToMarkdown(raw);
    markdown = result.markdown;
    title = result.title;
  } else if (detectedFormat === 'markdown') {
    // Already Markdown — just clean up whitespace
    markdown = raw.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    const h1 = markdown.match(/^#\s+(.+)$/m);
    title = h1 ? h1[1].trim() : '';
  } else {
    // Plain text — wrap paragraphs
    markdown = raw
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    title = '';
  }

  return {
    markdown,
    title: title || '',
    word_count: countWords(markdown),
    format_detected: detectedFormat,
  };
}

// ---------- OpenAPI spec ----------

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'MarkItDown',
    version: '0.1.0',
    description: 'Convert HTML, text, or Office-style content to clean Markdown for AI pipelines.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    '/markitdown/run': {
      post: {
        operationId: 'markitdown_run',
        summary: 'Convert content to Markdown',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    description: 'HTML or text content to convert (max 100,000 chars)',
                    maxLength: MAX_CONTENT_CHARS,
                  },
                  url: {
                    type: 'string',
                    description: 'URL to fetch and convert (alternative to content)',
                    maxLength: MAX_URL_CHARS,
                  },
                  format: {
                    type: 'string',
                    enum: ['html', 'text', 'markdown', 'auto'],
                    default: 'auto',
                    description: 'Input format hint',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Markdown conversion result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown', 'title', 'word_count', 'format_detected'],
                  properties: {
                    markdown: { type: 'string', description: 'Clean Markdown output' },
                    title: { type: 'string', description: 'Extracted title' },
                    word_count: { type: 'integer', description: 'Word count of output' },
                    format_detected: { type: 'string', description: 'Detected input format' },
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

  if (method === 'GET' && (url === '/health' || url === '/markitdown/health')) {
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && (url === '/openapi.json' || url === '/markitdown/openapi.json')) {
    return sendJson(res, 200, OPENAPI_SPEC);
  }

  if (method === 'POST' && url === '/markitdown/run') {
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
  process.stderr.write(`[markitdown] listening on http://${HOST}:${PORT}\n`);
});
