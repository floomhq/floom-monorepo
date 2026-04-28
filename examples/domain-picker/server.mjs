#!/usr/bin/env node
// Domain Picker — Gemini scoring + Dynadot availability cross-check.
//
// Two-step pipeline:
//   1. Gemini 2.5-flash-lite scores all candidates concurrently (memorability,
//      brand fit, typeability, search-friendliness) with mandatory JSON schema.
//   2. Dynadot API checks availability + price for every candidate x TLD combo,
//      batched into a single request (up to 100 domains per call), concurrently
//      with step 1.
//
// Exposes:
//   GET  /health
//   GET  /openapi/domain-picker.json
//   POST /domain-picker/run
//
// Run: node examples/domain-picker/server.mjs
// Env:
//   PORT=4230              (default)
//   GEMINI_API_KEY         mandatory for AI scoring
//   DYNADOT_API_KEY        optional; omit for score-only mode

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4230);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://${HOST}:${PORT}`;

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DYNADOT_BASE = 'https://api.dynadot.com/api3.json';
const DYNADOT_TIMEOUT_MS = 4_000;
const MAX_BODY_BYTES = 64 * 1024;

const DEFAULT_TLDS = ['.com', '.io', '.dev', '.ai'];

// ---------- helpers ----------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
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

// ---------- input validation ----------

function validateInput(body) {
  // candidates: required, array of 2-10 strings, each 3-30 chars, alphanumeric + hyphens, no dots
  const rawCandidates = body.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    throw httpError(400, 'candidates must be a non-empty array of strings');
  }
  if (rawCandidates.length < 2 || rawCandidates.length > 10) {
    throw httpError(400, 'candidates must contain between 2 and 10 entries');
  }
  const candidates = rawCandidates.map((c, i) => {
    if (typeof c !== 'string') throw httpError(400, `candidates[${i}] must be a string`);
    const trimmed = c.trim().toLowerCase();
    if (trimmed.length < 3 || trimmed.length > 30) {
      throw httpError(400, `candidates[${i}] must be 3-30 characters`);
    }
    if (!/^[a-z0-9-]+$/.test(trimmed)) {
      throw httpError(400, `candidates[${i}] must contain only alphanumeric characters and hyphens (no dots)`);
    }
    return trimmed;
  });

  // tlds: optional, default ['.com', '.io', '.dev', '.ai'], max 8
  let tlds = DEFAULT_TLDS;
  if (body.tlds !== undefined) {
    if (!Array.isArray(body.tlds)) throw httpError(400, 'tlds must be an array of strings');
    if (body.tlds.length > 8) throw httpError(400, 'tlds must contain at most 8 entries');
    tlds = body.tlds.map((t, i) => {
      if (typeof t !== 'string') throw httpError(400, `tlds[${i}] must be a string`);
      const trimmed = t.trim().toLowerCase();
      if (!trimmed.startsWith('.')) throw httpError(400, `tlds[${i}] must start with a dot`);
      return trimmed;
    });
  }

  // audience: optional string
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';

  return { candidates, tlds, audience };
}

// ---------- Gemini scoring ----------

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['scores'],
  properties: {
    scores: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'score', 'memorability', 'brand_fit', 'typeability', 'search'],
        properties: {
          name: { type: 'STRING' },
          score: { type: 'INTEGER' },
          memorability: { type: 'INTEGER' },
          brand_fit: { type: 'INTEGER' },
          typeability: { type: 'INTEGER' },
          search: { type: 'INTEGER' },
        },
      },
    },
  },
};

async function scoreWithGemini(candidates, audience) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw httpError(503, 'GEMINI_API_KEY is not set; cannot score candidates');
  }

  const audienceContext = audience
    ? `The target audience is: ${audience}.`
    : 'No specific audience context provided; evaluate for a general SaaS/tech product.';

  const prompt = `You are a domain-name strategist. Score each of the following bare domain name candidates (no TLD) on a scale of 1-10 for each dimension.

${audienceContext}

Dimensions:
- memorability: how easy it is to remember after hearing it once
- brand_fit: how well it fits the described audience and feels like a credible product name
- typeability: how easy it is to type correctly without errors
- search: how search-engine-friendly and unique it is (avoids common words that drown in results)

The "score" field must be the rounded average of the four dimensions.

Candidates:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return a JSON object with a "scores" array. Each element must contain: name (string), score (integer 1-10), memorability (integer 1-10), brand_fit (integer 1-10), typeability (integer 1-10), search (integer 1-10).`;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw httpError(502, `Gemini API returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw httpError(502, 'Gemini returned an empty response');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw httpError(502, 'Gemini returned invalid JSON');
  }

  if (!Array.isArray(parsed?.scores)) {
    throw httpError(502, 'Gemini response missing "scores" array');
  }

  // Build a map by name for easy lookup
  const scoreMap = new Map();
  for (const entry of parsed.scores) {
    if (typeof entry.name === 'string') {
      scoreMap.set(entry.name.toLowerCase().trim(), {
        score: Number(entry.score) || 0,
        score_breakdown: {
          memorability: Number(entry.memorability) || 0,
          brand_fit: Number(entry.brand_fit) || 0,
          typeability: Number(entry.typeability) || 0,
          search: Number(entry.search) || 0,
        },
      });
    }
  }

  return scoreMap;
}

// ---------- Dynadot availability ----------

async function checkDynadot(candidates, tlds) {
  const apiKey = process.env.DYNADOT_API_KEY;
  if (!apiKey) {
    // Return graceful degradation: mark all as key_missing
    const result = new Map();
    for (const name of candidates) {
      for (const tld of tlds) {
        result.set(`${name}${tld}`, { available: null, price: null, availability: 'key_missing' });
      }
    }
    return result;
  }

  // Build domain list for the API (max 100 per request; with max 10 candidates x 8 tlds = 80, fits in one call)
  const domainList = [];
  for (const name of candidates) {
    for (const tld of tlds) {
      domainList.push(`${name}${tld}`);
    }
  }

  // Build query params: domain0=..., domain1=..., ...
  const params = new URLSearchParams({
    key: apiKey,
    command: 'search',
    show_price: '1',
    currency: 'USD',
  });
  domainList.forEach((d, i) => params.set(`domain${i}`, d));

  const url = `${DYNADOT_BASE}?${params.toString()}`;

  let responseData;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(DYNADOT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[domain-picker] Dynadot returned HTTP ${res.status}`);
      return buildDynadotFallback(candidates, tlds, 'api_error');
    }
    const text = await res.text();
    try {
      responseData = JSON.parse(text);
    } catch {
      console.error('[domain-picker] Dynadot returned non-JSON response');
      return buildDynadotFallback(candidates, tlds, 'parse_error');
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.error('[domain-picker] Dynadot request timed out');
      return buildDynadotFallback(candidates, tlds, 'timeout');
    }
    console.error('[domain-picker] Dynadot fetch failed:', err.message);
    return buildDynadotFallback(candidates, tlds, 'fetch_error');
  }

  // Parse Dynadot response
  // The Dynadot search API returns a flat structure. Each domain result is keyed
  // under SearchResponse.SearchResults as an array of objects with fields:
  //   DomainName, Available ("yes"/"no"), Price (string with currency, e.g. "14.99")
  const result = new Map();

  // Initialize all as unavailable_unavailable so missing entries get a fallback
  for (const domain of domainList) {
    result.set(domain, { available: null, price: null, availability: 'availability_unavailable' });
  }

  try {
    const searchResponse = responseData?.SearchResponse;
    if (!searchResponse) {
      console.error('[domain-picker] Dynadot response missing SearchResponse');
      return buildDynadotFallback(candidates, tlds, 'unexpected_format');
    }

    // Check for API-level errors
    if (searchResponse.Status === 'error') {
      console.error('[domain-picker] Dynadot API error:', searchResponse.Error);
      return buildDynadotFallback(candidates, tlds, 'api_error');
    }

    const searchResults = searchResponse.SearchResults;
    if (!Array.isArray(searchResults)) {
      // Try alternative key casing
      const alt = searchResponse.searchResults || searchResponse.Results || searchResponse.results;
      if (!Array.isArray(alt)) {
        console.error('[domain-picker] Dynadot response missing SearchResults array');
        return buildDynadotFallback(candidates, tlds, 'unexpected_format');
      }
      parseSearchResults(result, alt);
    } else {
      parseSearchResults(result, searchResults);
    }
  } catch (err) {
    console.error('[domain-picker] Error parsing Dynadot response:', err.message);
    return buildDynadotFallback(candidates, tlds, 'parse_error');
  }

  return result;
}

function parseSearchResults(resultMap, searchResults) {
  for (const item of searchResults) {
    if (!item || typeof item !== 'object') continue;
    const domain = (item.DomainName || item.domainName || item.domain || '').toLowerCase().trim();
    if (!domain) continue;

    const availableRaw = (item.Available || item.available || '').toLowerCase();
    const available = availableRaw === 'yes';

    // Price comes back as a number or string like "14.99". We store as formatted string "$X.XX"
    let price = null;
    if (available) {
      const rawPrice = item.Price ?? item.price ?? item.RegisterPrice ?? item.registerPrice;
      if (rawPrice != null && rawPrice !== '') {
        const priceStr = String(rawPrice).replace(/^\$/, '').trim();
        const priceNum = parseFloat(priceStr);
        if (!isNaN(priceNum)) {
          price = `$${priceNum.toFixed(2)}`;
        }
      }
    }

    resultMap.set(domain, { available, price, availability: 'checked' });
  }
}

function buildDynadotFallback(candidates, tlds, reason) {
  const result = new Map();
  for (const name of candidates) {
    for (const tld of tlds) {
      result.set(`${name}${tld}`, { available: null, price: null, availability: reason });
    }
  }
  return result;
}

// ---------- main pipeline ----------

async function runDomainPicker(input) {
  const { candidates, tlds, audience } = input;

  // Run Gemini scoring and Dynadot lookup concurrently
  const [scoreMap, availabilityMap] = await Promise.all([
    scoreWithGemini(candidates, audience),
    checkDynadot(candidates, tlds),
  ]);

  // Assemble results per candidate
  const ranked = candidates.map((name) => {
    const scoring = scoreMap.get(name) || {
      score: 0,
      score_breakdown: { memorability: 0, brand_fit: 0, typeability: 0, search: 0 },
    };

    const tldResults = tlds.map((tld) => {
      const domainKey = `${name}${tld}`;
      const avail = availabilityMap.get(domainKey);
      if (!avail) {
        return { tld, available: null, price: null, availability: 'availability_unavailable' };
      }
      return {
        tld,
        available: avail.available,
        price: avail.price,
        ...(avail.availability !== 'checked' ? { availability: avail.availability } : {}),
      };
    });

    // Find best buyable TLD: first available with a price, prefer cheapest
    const buyable = tldResults.filter((t) => t.available === true && t.price !== null);
    let bestBuyable = null;
    if (buyable.length > 0) {
      // Sort by numeric price ascending
      buyable.sort((a, b) => {
        const pa = parseFloat(String(a.price).replace(/[^0-9.]/g, ''));
        const pb = parseFloat(String(b.price).replace(/[^0-9.]/g, ''));
        return (isNaN(pa) ? Infinity : pa) - (isNaN(pb) ? Infinity : pb);
      });
      bestBuyable = buyable[0].tld;
    } else if (tldResults.some((t) => t.available === true)) {
      // Available but no price info
      bestBuyable = tldResults.find((t) => t.available === true).tld;
    }

    return {
      name,
      score: scoring.score,
      score_breakdown: scoring.score_breakdown,
      tlds: tldResults,
      best_buyable: bestBuyable,
    };
  });

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  // Determine top pick: highest-scored candidate with a buyable TLD
  let topPick = null;
  for (const candidate of ranked) {
    if (candidate.best_buyable) {
      // Find cheapest available extension across all candidates for comparison context
      const allBuyable = ranked
        .flatMap((c) =>
          c.tlds
            .filter((t) => t.available === true && t.price !== null)
            .map((t) => ({ name: c.name, tld: t.tld, price: t.price, score: c.score })),
        );

      const cheapestOverall = allBuyable.reduce((best, curr) => {
        const pc = parseFloat(String(curr.price).replace(/[^0-9.]/g, ''));
        const pb = parseFloat(String(best?.price || 'Infinity').replace(/[^0-9.]/g, ''));
        return pc < pb ? curr : best;
      }, null);

      const tldInfo = candidate.tlds.find((t) => t.tld === candidate.best_buyable);
      const isCheapest =
        cheapestOverall &&
        cheapestOverall.name === candidate.name &&
        cheapestOverall.tld === candidate.best_buyable;

      const higherScoredButBlocked = ranked.filter(
        (c) => c.score > candidate.score && !c.best_buyable,
      ).length;

      let reason = `highest score with ${isCheapest ? 'cheapest' : 'an'} available extension`;
      if (higherScoredButBlocked > 0) {
        reason = `${higherScoredButBlocked} candidate${higherScoredButBlocked > 1 ? 's' : ''} beat it on score but ${higherScoredButBlocked > 1 ? 'are' : 'is'} .com-taken or unavailable`;
      }

      topPick = {
        name: candidate.name,
        tld: candidate.best_buyable,
        price: tldInfo?.price || null,
        reason,
      };
      break;
    }
  }

  // screenshot_card_summary: one-liner shareable text
  let screenshotCardSummary;
  if (topPick) {
    const top = ranked[0];
    const higherScoreButBlocked = ranked.filter(
      (c) => c.score > (topPick ? ranked.find((r) => r.name === topPick.name)?.score || 0 : 0) && !c.best_buyable,
    ).length;
    const topPickEntry = ranked.find((r) => r.name === topPick.name);
    screenshotCardSummary = `${topPick.name}${topPick.tld}${topPick.price ? ` — ${topPick.price} available` : ' — available'} — score ${topPickEntry?.score ?? top.score}/10${higherScoreButBlocked > 0 ? `. ${higherScoreButBlocked} candidate${higherScoreButBlocked > 1 ? 's' : ''} beat it on score but are .com-taken.` : '.'}`;
  } else {
    const top = ranked[0];
    screenshotCardSummary = `${top.name} scored highest at ${top.score}/10 but no buyable TLD was found across ${tlds.length} extensions checked.`;
  }

  return {
    ranked,
    top_pick: topPick,
    screenshot_card_summary: screenshotCardSummary,
  };
}

// ---------- OpenAPI spec ----------

const SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Domain Picker',
    version: '0.1.0',
    description:
      'Score domain name candidates with Gemini (memorability, brand fit, typeability, search-friendliness) and cross-check live availability + price via Dynadot. Returns a ranked list with the best buyable extension per candidate.',
  },
  servers: [{ url: PUBLIC_BASE }],
  paths: {
    '/domain-picker/run': {
      post: {
        operationId: 'pickDomain',
        summary: 'Domain Picker',
        description:
          'Score 2-10 domain name candidates with AI and check live availability + price across up to 8 TLDs via the Dynadot API.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['candidates'],
                properties: {
                  candidates: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 10,
                    items: {
                      type: 'string',
                      minLength: 3,
                      maxLength: 30,
                      pattern: '^[a-z0-9-]+$',
                      description:
                        'Bare domain name without TLD, e.g. "acmehub". Alphanumeric and hyphens only, no dots.',
                    },
                    description: 'Domain name candidates to score and check. 2 to 10 entries.',
                  },
                  tlds: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                      type: 'string',
                      description: 'TLD starting with a dot, e.g. ".com".',
                    },
                    default: ['.com', '.io', '.dev', '.ai'],
                    description: 'TLDs to check for availability. Default: .com, .io, .dev, .ai.',
                  },
                  audience: {
                    type: 'string',
                    description:
                      'Optional context for brand-fit scoring, e.g. "B2B SaaS for ops teams".',
                  },
                },
              },
              example: {
                candidates: ['acmehub', 'rocketflow', 'baseloop'],
                tlds: ['.com', '.io', '.dev', '.ai'],
                audience: 'B2B SaaS for operations teams',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Ranked candidates with scores and availability',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ranked', 'top_pick', 'screenshot_card_summary'],
                  properties: {
                    ranked: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['name', 'score', 'score_breakdown', 'tlds', 'best_buyable'],
                        properties: {
                          name: { type: 'string' },
                          score: { type: 'integer', minimum: 1, maximum: 10 },
                          score_breakdown: {
                            type: 'object',
                            properties: {
                              memorability: { type: 'integer' },
                              brand_fit: { type: 'integer' },
                              typeability: { type: 'integer' },
                              search: { type: 'integer' },
                            },
                          },
                          tlds: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                tld: { type: 'string' },
                                available: { type: 'boolean', nullable: true },
                                price: { type: 'string', nullable: true },
                                availability: { type: 'string' },
                              },
                            },
                          },
                          best_buyable: { type: 'string', nullable: true },
                        },
                      },
                    },
                    top_pick: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        name: { type: 'string' },
                        tld: { type: 'string' },
                        price: { type: 'string', nullable: true },
                        reason: { type: 'string' },
                      },
                    },
                    screenshot_card_summary: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input' },
          503: { description: 'Gemini API key not configured' },
        },
      },
    },
  },
};

// ---------- HTTP server ----------

async function route(req, res) {
  const url = new URL(req.url || '/', PUBLIC_BASE);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'domain-picker',
      port: PORT,
      gemini_key: !!process.env.GEMINI_API_KEY,
      dynadot_key: !!process.env.DYNADOT_API_KEY,
    });
  }

  if (req.method === 'GET' && pathname === '/openapi/domain-picker.json') {
    return sendJson(res, 200, SPEC);
  }

  if (req.method === 'POST' && pathname === '/domain-picker/run') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    let input;
    try {
      input = validateInput(body);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message });
    }
    try {
      const result = await runDomainPicker(input);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, err.statusCode || 500, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: 'not found', path: pathname });
}

const server = createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error('[domain-picker] unhandled error:', err);
    sendJson(res, 500, { error: 'internal error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[domain-picker] listening on ${PUBLIC_BASE}`);
  console.log(`[domain-picker] gemini_key=${!!process.env.GEMINI_API_KEY} dynadot_key=${!!process.env.DYNADOT_API_KEY}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
