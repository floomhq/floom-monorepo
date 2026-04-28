#!/usr/bin/env node
// Launch Scorecards — proxied-mode HTTP server for launch-focused app MVPs.
//
// Exposes:
//   GET  /health
//   GET  /openapi.json
//   GET  /linkedin-roaster/openapi.json
//   GET  /yc-pitch-deck-critic/openapi.json
//   GET  /readme-roaster/openapi.json
//   GET  /cold-email-roaster/openapi.json
//   GET  /tweet-predictor/openapi.json
//   POST /linkedin-roaster/score
//   POST /yc-pitch-deck-critic/score
//   POST /readme-roaster/score
//   POST /cold-email-roaster/score
//   POST /tweet-predictor/score
//
// Pure Node.js, no external dependencies. LinkedIn URL scraping uses APIFY_API_KEY
// when configured, with pasted profile text as a deterministic fallback.
// readme-roaster, cold-email-roaster, tweet-predictor use Gemini AI
// (GEMINI_API_KEY required). Model: gemini-2.5-flash-lite.
//
// Run: node examples/launch-scorecards/server.mjs
// Env: PORT=4120 (default), GEMINI_API_KEY (required for v2 apps)

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4120);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const APIFY_BASE_URL = 'https://api.apify.com/v2';
const LINKEDIN_ACTOR_ID =
  process.env.APIFY_LINKEDIN_ACTOR_ID || 'harvestapi~linkedin-profile-scraper';
const APIFY_TIMEOUT_MS = Number(process.env.APIFY_LINKEDIN_TIMEOUT_MS || 45_000);
const APIFY_POLL_MS = Number(process.env.APIFY_LINKEDIN_POLL_MS || 2_500);

// ---------------------------------------------------------------------------
// Gemini helpers (readme-roaster, cold-email-roaster, tweet-predictor)
// ---------------------------------------------------------------------------

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function geminiKey() {
  return process.env.GEMINI_API_KEY || '';
}

async function callGemini({ prompt, responseSchema, timeoutMs = 20_000 }) {
  const key = geminiKey();
  if (!key) {
    throw httpError(503, 'GEMINI_API_KEY is not configured');
  }

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
    } catch {
      /* ignore */
    }
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
// OpenAPI spec builder
// ---------------------------------------------------------------------------

function appSpec({ title, description, path, operationId, inputProperties, required }) {
  return {
    openapi: '3.0.0',
    info: {
      title,
      version: '0.1.0',
      description,
    },
    servers: [{ url: `http://localhost:${PORT}` }],
    paths: {
      [path]: {
        post: {
          operationId,
          summary: title,
          description,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required,
                  properties: inputProperties,
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Deterministic scorecard result',
              content: {
                'application/json': {
                  schema: scorecardSchema(),
                },
              },
            },
            400: {
              description: 'Invalid request body',
            },
          },
        },
      },
    },
  };
}

function scorecardSchema() {
  return {
    type: 'object',
    required: [
      'score',
      'verdict',
      'diagnosis',
      'top_issues',
      'rewrite',
      'suggestions',
      'next_steps',
      'share_card',
    ],
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
      verdict: { type: 'string' },
      diagnosis: { type: 'string' },
      top_issues: { type: 'array', items: { type: 'string' } },
      rewrite: { type: 'string' },
      suggestions: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'string' } },
      share_card: {
        type: 'object',
        required: ['title', 'subtitle', 'score_label', 'bullets'],
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          score_label: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAPI specs
// ---------------------------------------------------------------------------

const linkedinSpec = appSpec({
  title: 'LinkedIn Roaster',
  description:
    'Paste a LinkedIn profile URL. The app fetches the public profile, then scores positioning clarity, specificity, credibility, and conversion intent.',
  path: '/linkedin-roaster/score',
  operationId: 'scoreLinkedinProfile',
  required: ['linkedin_url'],
  inputProperties: {
    linkedin_url: {
      type: 'string',
      format: 'uri',
      description:
        'Public LinkedIn profile URL, for example https://www.linkedin.com/in/federicodeponte/.',
    },
    profile_text: {
      type: 'string',
      description:
        'Optional fallback text if the profile cannot be fetched. Include headline, About, experience, or featured summary.',
    },
    audience: {
      type: 'string',
      description: 'Target audience the profile needs to convince.',
      default: 'startup founders',
    },
    goal: {
      type: 'string',
      description: 'Desired profile outcome.',
      default: 'drive relevant inbound messages',
    },
  },
});

const deckSpec = appSpec({
  title: 'YC Pitch Deck Critic',
  description:
    'Upload an early-stage deck outline or text export and score it for YC-style clarity, urgency, insight, market, traction, and ask.',
  path: '/yc-pitch-deck-critic/score',
  operationId: 'scorePitchDeck',
  required: ['deck_file'],
  inputProperties: {
    deck_file: {
      type: 'string',
      format: 'binary',
      description:
        'Deck text export, Markdown outline, or slide transcript selected from your machine.',
    },
    deck: {
      type: 'string',
      description:
        'Optional pasted deck fallback. Slide headings improve the diagnosis.',
    },
    company: {
      type: 'string',
      description: 'Company or product name.',
      default: 'Startup',
    },
    stage: {
      type: 'string',
      description: 'Company stage.',
      default: 'pre-seed',
    },
  },
});

const readmeRoasterSpec = appSpec({
  title: 'README Roaster',
  description:
    'Paste a GitHub repo URL. The app fetches the README, then roasts it for clarity, completeness, and first-impression impact.',
  path: '/readme-roaster/score',
  operationId: 'scoreReadme',
  required: ['repo_url'],
  inputProperties: {
    repo_url: {
      type: 'string',
      format: 'uri',
      description:
        'Public GitHub repository URL, for example https://github.com/owner/repo.',
    },
  },
});

const coldEmailRoasterSpec = appSpec({
  title: 'Cold Email Roaster',
  description:
    'Paste a cold email you wrote. The app scores cringe level, rewrites subject and body, and highlights the top issues.',
  path: '/cold-email-roaster/score',
  operationId: 'scoreColdEmail',
  required: ['email_text'],
  inputProperties: {
    email_text: {
      type: 'string',
      minLength: 50,
      maxLength: 2000,
      description: 'The full cold email text to roast (50-2000 characters).',
    },
    goal: {
      type: 'string',
      description: 'Optional intended goal of the email, for example "book a demo".',
    },
  },
});

const tweetPredictorSpec = appSpec({
  title: 'Tweet Predictor',
  description:
    'Paste a tweet draft. The app predicts engagement level, identifies weaknesses, rewrites it, and offers an alternative angle.',
  path: '/tweet-predictor/score',
  operationId: 'scoreTweet',
  required: ['draft'],
  inputProperties: {
    draft: {
      type: 'string',
      minLength: 1,
      maxLength: 280,
      description: 'Tweet draft text (1-280 characters).',
    },
    audience: {
      type: 'string',
      description: 'Optional target audience description, for example "indie hackers".',
    },
  },
});

const combinedSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Launch Scorecards',
    version: '0.2.0',
    description:
      'Launch scorecards for LinkedIn profiles, YC-style pitch decks, GitHub READMEs, cold emails, and tweet drafts.',
  },
  servers: [{ url: `http://localhost:${PORT}` }],
  paths: {
    ...linkedinSpec.paths,
    ...deckSpec.paths,
    ...readmeRoasterSpec.paths,
    ...coldEmailRoasterSpec.paths,
    ...tweetPredictorSpec.paths,
  },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function hasAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function wordCount(text) {
  const words = String(text || '').trim().match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function sentenceCount(text) {
  const sentences = String(text || '').split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return Math.max(1, sentences.length);
}

function scoreBand(score) {
  if (score >= 85) return 'Launch-ready';
  if (score >= 70) return 'Promising, needs tightening';
  if (score >= 50) return 'Clear enough to revise';
  return 'Needs a sharper core';
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeLinkedinUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = candidate.includes('linkedin.com/')
      ? `https://${candidate}`
      : `https://www.linkedin.com/in/${candidate.replace(/^@/, '')}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw httpError(400, 'linkedin_url must be a valid LinkedIn profile URL or handle');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'linkedin.com' || !url.pathname.toLowerCase().startsWith('/in/')) {
    throw httpError(400, 'linkedin_url must point to a public linkedin.com/in/... profile');
  }

  url.protocol = 'https:';
  url.hostname = 'www.linkedin.com';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function apifyToken() {
  return process.env.APIFY_API_KEY || process.env.APIFY_TOKEN || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apifyJson(url, options = {}) {
  const token = apifyToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
  }
  if (!res.ok) {
    throw httpError(res.status, `Apify returned HTTP ${res.status}`);
  }
  return json;
}

async function fetchLinkedinProfile(linkedinUrl) {
  if (!apifyToken()) {
    throw httpError(
      503,
      'LinkedIn URL fetch is not configured. Set APIFY_API_KEY or provide profile_text as fallback.',
    );
  }

  const started = await apifyJson(
    `${APIFY_BASE_URL}/acts/${encodeURIComponent(LINKEDIN_ACTOR_ID)}/runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [linkedinUrl] }),
    },
  );
  const runId = started?.data?.id;
  if (!runId) throw httpError(502, 'Apify did not return an actor run id');

  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let run = started.data;
  while (Date.now() < deadline) {
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) break;
    await sleep(APIFY_POLL_MS);
    const polled = await apifyJson(`${APIFY_BASE_URL}/actor-runs/${runId}`);
    run = polled.data || run;
  }

  if (run.status !== 'SUCCEEDED') {
    throw httpError(504, `LinkedIn profile fetch did not complete in time (${run.status || 'pending'})`);
  }

  const items = await apifyJson(`${APIFY_BASE_URL}/actor-runs/${runId}/dataset/items`);
  const profile = Array.isArray(items) ? items[0] : null;
  if (!profile || typeof profile !== 'object') {
    throw httpError(502, 'LinkedIn profile fetch returned no profile data');
  }
  return profile;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function summarizeExperience(profile) {
  const experience = profile.experience || profile.positions || profile.jobs || [];
  if (!Array.isArray(experience)) return '';
  return experience
    .slice(0, 5)
    .map((job) => {
      if (!job || typeof job !== 'object') return '';
      const title = firstString(job.title, job.position, job.role);
      const company = firstString(job.companyName, job.company, job.organization);
      const description = firstString(job.description, job.summary);
      return [title, company, description].filter(Boolean).join(' — ');
    })
    .filter(Boolean)
    .join('\n');
}

function profileToText(profile, linkedinUrl) {
  const fullName = firstString(profile.fullName, profile.name, profile.firstName);
  const headline = firstString(profile.headline, profile.occupation, profile.title);
  const about = firstString(profile.about, profile.summary, profile.description, profile.bio);
  const location = firstString(profile.location, profile.addressWithoutCountry, profile.geoLocationName);
  const currentCompany = firstString(
    profile.currentCompany,
    profile.currentCompanyName,
    profile.companyName,
  );
  const experiences = summarizeExperience(profile);
  return [
    fullName && `Name: ${fullName}`,
    headline && `Headline: ${headline}`,
    location && `Location: ${location}`,
    currentCompany && `Current company: ${currentCompany}`,
    about && `About:\n${about}`,
    experiences && `Experience:\n${experiences}`,
    `LinkedIn: ${linkedinUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function resolveLinkedinProfileText(body) {
  const fallback = String(body.profile_text || '').trim();
  const linkedinUrl = normalizeLinkedinUrl(body.linkedin_url);
  if (!linkedinUrl && fallback) {
    return {
      profile: fallback,
      linkedinUrl: '',
      source: 'pasted_profile_text',
      scrapeStatus: 'not_requested',
    };
  }
  if (!linkedinUrl) throw httpError(400, 'linkedin_url is required');

  try {
    const scraped = await fetchLinkedinProfile(linkedinUrl);
    return {
      profile: profileToText(scraped, linkedinUrl),
      linkedinUrl,
      source: 'apify_linkedin_profile',
      scrapeStatus: 'succeeded',
    };
  } catch (error) {
    if (fallback) {
      return {
        profile: fallback,
        linkedinUrl,
        source: 'pasted_profile_text',
        scrapeStatus: `fallback_after_${error.statusCode || 'fetch'}_error`,
      };
    }
    throw error;
  }
}

async function scoreLinkedinProfile(body) {
  const resolved = await resolveLinkedinProfileText(body);
  const profile = resolved.profile;
  if (!profile) throw httpError(400, 'linkedin_url or profile_text is required');

  const audience = String(body.audience || 'startup founders').trim();
  const goal = String(body.goal || 'drive relevant inbound messages').trim();
  const words = wordCount(profile);
  const sentences = sentenceCount(profile);
  const avgSentence = words / sentences;
  const firstLine = profile.split(/\r?\n/).find((line) => line.trim()) || '';
  const hasSpecificHeadline =
    firstLine.length >= 20 &&
    firstLine.length <= 180 &&
    hasAny(firstLine, ['for ', 'help', 'building', 'founder', 'operator', 'ai', 'b2b', 'saas']);
  const hasProof = hasAny(profile, [
    '%',
    '$',
    'revenue',
    'users',
    'customers',
    'clients',
    'waitlist',
    'retention',
    'growth',
    'launched',
    'shipped',
    'built',
    'raised',
    'ex-',
  ]);
  const hasSpecificAudience = hasAny(profile, [
    'founder',
    'operator',
    'sales',
    'marketing',
    'engineer',
    'designer',
    'team',
    'startup',
    'buyer',
  ]);
  const hasClearOffer = hasAny(profile, [
    'help',
    'build',
    'building',
    'turn',
    'fix',
    'automate',
    'grow',
    'reduce',
    'increase',
    'ship',
  ]);
  const hasCta = hasAny(profile, [
    'dm',
    'message',
    'book',
    'work with',
    'contact',
    'try',
    'join',
    'subscribe',
  ]);
  const hasStructure = countMatches(profile, /\n/g) >= 3 || countMatches(profile, /[-•*]\s+/g) >= 2;
  const buzzwordCount = countMatches(
    profile.toLowerCase(),
    /\b(revolutionary|game-changing|disrupt|synergy|leverage|seamless|cutting-edge|innovative|world-class)\b/g,
  );

  let score = 40;
  if (words >= 80 && words <= 450) score += 10;
  if (words > 0 && words < 80) score += 3;
  if (words > 650) score -= Math.min(14, Math.ceil((words - 650) / 50));
  if (hasSpecificHeadline) score += 14;
  if (hasProof) score += 14;
  if (hasSpecificAudience) score += 10;
  if (hasClearOffer) score += 10;
  if (hasCta) score += 8;
  if (hasStructure) score += 8;
  if (avgSentence <= 26) score += 6;
  score -= buzzwordCount * 5;

  const topIssues = [];
  if (!hasSpecificHeadline) topIssues.push('The headline reads like a role label, not a sharp positioning sentence.');
  if (!hasProof) topIssues.push('The profile lacks proof such as numbers, customer facts, shipped work, or credible background.');
  if (!hasSpecificAudience) topIssues.push('The target reader is too broad; name the person with the painful problem.');
  if (!hasClearOffer) topIssues.push('The profile does not make the concrete offer obvious.');
  if (!hasCta) topIssues.push('The profile gives interested people no clear next step.');
  if (words > 650) topIssues.push('The profile is long; trim resume history and keep the current edge.');
  if (buzzwordCount > 0) topIssues.push('Buzzwords dilute the claim; replace them with specific outcomes.');
  if (!topIssues.length) topIssues.push('The profile has the right bones; the biggest gain is sharper proof and a more memorable headline.');

  const headlineRewrite = `Helping ${audience} ${goal} with specific, shipped AI workflows.`;
  const aboutRewrite = [
    `I build practical AI workflows for ${audience}.`,
    '',
    'The work is simple: turn messy, repeated expert work into small tools people can actually use.',
    '',
    'What I focus on:',
    '- clear input and output',
    '- visible proof instead of broad claims',
    '- workflows that ship as web apps, APIs, and agent-callable tools',
    '',
    'If you have a local script, internal workflow, or AI prototype that people cannot use yet, send it over.',
  ].join('\n');

  const finalScore = clampScore(score);
  return {
    linkedin_url: resolved.linkedinUrl || undefined,
    profile_source: resolved.source,
    scrape_status: resolved.scrapeStatus,
    score: finalScore,
    verdict: scoreBand(finalScore),
    diagnosis:
      finalScore >= 70
        ? 'The profile has enough clarity to drive relevant attention after tightening proof and the next step.'
        : 'The profile needs a clearer reader, sharper current edge, and more concrete evidence before it creates inbound pull.',
    top_issues: topIssues.slice(0, 5),
    rewrite: `Headline:\n${headlineRewrite}\n\nAbout:\n${aboutRewrite}`,
    suggestions: [
      'Turn the headline into a promise for a specific reader.',
      'Move old resume detail below current proof and current offer.',
      'Add one measurable proof point, named project, or concrete shipped artifact.',
      'End the About section with a low-friction next step.',
    ],
    next_steps: [
      'Rewrite the headline in one sentence using audience + outcome + proof.',
      'Add one proof line to the top third of the About section.',
      'Cut any line that only describes a past title without explaining current edge.',
      'Add one post idea that demonstrates the new positioning.',
    ],
    post_ideas: [
      `The mistake ${audience} make when they describe what they do.`,
      'A before/after teardown of a workflow that moved from localhost to a real app.',
      'The smallest proof point that makes a profile more credible than adjectives.',
    ],
    share_card: {
      title: 'LinkedIn Positioning Score',
      subtitle: scoreBand(finalScore),
      score_label: `${finalScore}/100`,
      bullets: topIssues.slice(0, 3),
    },
  };
}

function decodeUploadedText(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  if (value.__file !== true || typeof value.content_b64 !== 'string') return '';
  const name = typeof value.name === 'string' ? value.name.toLowerCase() : '';
  const mime = typeof value.mime_type === 'string' ? value.mime_type.toLowerCase() : '';
  if (name.endsWith('.pdf') || name.endsWith('.pptx') || mime.includes('pdf') || mime.includes('presentation')) {
    throw httpError(
      400,
      `${fieldName} needs a text export, Markdown outline, or slide transcript for this deterministic launch app.`,
    );
  }
  try {
    return Buffer.from(value.content_b64, 'base64').toString('utf-8');
  } catch {
    throw httpError(400, `could not decode uploaded ${fieldName}`);
  }
}

function resolveDeckText(body) {
  const uploaded = decodeUploadedText(body.deck_file, 'deck_file');
  const pasted = typeof body.deck === 'string' ? body.deck : '';
  const deck = (uploaded || pasted).trim();
  if (!deck) throw httpError(400, "missing required field 'deck_file' or pasted deck");
  return deck;
}

function scorePitchDeck(body) {
  const deck = resolveDeckText(body);

  const company = String(body.company || 'Startup').trim();
  const stage = String(body.stage || 'pre-seed').trim();
  const words = wordCount(deck);
  const lower = deck.toLowerCase();
  const slideLikeSections = countMatches(deck, /(^|\n)\s*(slide\s+\d+|\d+\.|#+)\s+/gi);
  const hasProblem = hasAny(lower, ['problem', 'pain', 'broken', 'manual', 'expensive', 'slow']);
  const hasCustomer = hasAny(lower, ['customer', 'user', 'buyer', 'founder', 'team', 'operator', 'persona']);
  const hasSolution = hasAny(lower, ['solution', 'product', 'platform', 'workflow', 'tool', 'app']);
  const hasMarket = hasAny(lower, ['market', 'tam', 'sam', 'som', 'billion', '$', 'industry']);
  const hasTraction = hasAny(lower, ['traction', 'revenue', 'mrr', 'arr', 'pilot', 'waitlist', 'customer', 'growth']);
  const hasInsight = hasAny(lower, ['insight', 'why now', 'because', 'wedge', 'unique', 'advantage']);
  const hasAsk = hasAny(lower, ['raise', 'raising', 'ask', 'use of funds', 'round', 'runway']);
  const hasCompetition = hasAny(lower, ['competitor', 'alternative', 'compete', 'incumbent', 'versus', 'vs.']);
  const hasTeam = hasAny(lower, ['team', 'founder', 'built', 'ex-', 'experience', 'background']);
  const vagueClaims = countMatches(
    lower,
    /\b(ai-powered|revolutionary|all-in-one|next-generation|democratize|transform|seamless|massive opportunity)\b/g,
  );

  let score = 28;
  if (words >= 250 && words <= 1600) score += 8;
  if (slideLikeSections >= 6) score += 8;
  if (hasProblem) score += 10;
  if (hasCustomer) score += 8;
  if (hasSolution) score += 8;
  if (hasMarket) score += 8;
  if (hasTraction) score += 12;
  if (hasInsight) score += 10;
  if (hasAsk) score += 6;
  if (hasCompetition) score += 5;
  if (hasTeam) score += 5;
  score -= vagueClaims * 4;
  if (words > 1800) score -= Math.min(15, Math.ceil((words - 1800) / 100));

  const topIssues = [];
  if (!hasProblem) topIssues.push('The deck does not state the painful problem in plain language.');
  if (!hasCustomer) topIssues.push('The buyer or user is not specific enough.');
  if (!hasTraction) topIssues.push('Traction is missing or not quantified.');
  if (!hasInsight) topIssues.push('The narrative needs a stronger earned insight or why-now wedge.');
  if (!hasMarket) topIssues.push('Market size or expansion path is underdeveloped.');
  if (!hasAsk) topIssues.push('The fundraising ask and use of funds are unclear.');
  if (vagueClaims > 0) topIssues.push('Generic startup language is replacing specific evidence.');
  if (!topIssues.length) topIssues.push('The core story is credible; tighten slide order and make traction more visual.');

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    verdict: scoreBand(finalScore),
    diagnosis:
      finalScore >= 70
        ? `${company} has a coherent ${stage} fundraising story with enough signal for a focused rewrite.`
        : `${company} needs a simpler problem, sharper wedge, and stronger proof before this reads like a YC-grade deck.`,
    top_issues: topIssues.slice(0, 5),
    rewrite: [
      'Slide 1: One-line company description with customer, pain, and outcome.',
      'Slide 2: Problem with one concrete example and the cost of inaction.',
      'Slide 3: Insight or why now; explain what changed in the market.',
      'Slide 4: Product wedge with the smallest workflow that wins adoption.',
      'Slide 5: Traction using numbers, customer names, pilots, or usage momentum.',
      'Slide 6: Ask, milestone, and why this round changes the slope.',
    ].join('\n'),
    suggestions: [
      'Replace category claims with a specific customer workflow.',
      'Lead with urgency before product mechanics.',
      'Show traction as deltas over time, not isolated totals.',
      'Add a competitor or alternative slide that proves founder insight.',
    ],
    next_steps: [
      'Write the one-sentence pitch in the format: We help X do Y because Z changed.',
      'Add one slide with quantified traction or a credible manual pilot result.',
      'Cut slides that do not answer problem, insight, product, market, traction, team, or ask.',
    ],
    share_card: {
      title: 'YC Deck Score',
      subtitle: scoreBand(finalScore),
      score_label: `${finalScore}/100`,
      bullets: topIssues.slice(0, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// README Roaster
// ---------------------------------------------------------------------------

const README_MAX_BYTES = 30 * 1024;

function parseGithubRepoUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    throw httpError(400, 'repo_url must be a valid GitHub repository URL');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') {
    throw httpError(400, 'repo_url must point to a github.com repository');
  }
  const parts = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw httpError(400, 'repo_url must include owner and repo name, e.g. https://github.com/owner/repo');
  }
  return { owner: parts[0], repo: parts[1] };
}

async function fetchReadme(owner, repo) {
  const ghToken = process.env.GITHUB_TOKEN || '';
  const headers = {
    Accept: 'application/vnd.github.raw+json',
    'User-Agent': 'floom-launch-scorecards/0.2',
    ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
  };

  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers, signal: AbortSignal.timeout(8_000) },
    );
    if (apiRes.status === 429 || apiRes.status === 403) {
      throw Object.assign(new Error('rate-limited'), { statusCode: 429 });
    }
    if (apiRes.ok) {
      const contentType = apiRes.headers.get('content-type') || '';
      let text;
      if (contentType.includes('json') && !contentType.includes('raw')) {
        const blob = await apiRes.json();
        if (blob?.content) {
          text = Buffer.from(blob.content, 'base64').toString('utf-8');
        } else {
          text = '';
        }
      } else {
        text = await apiRes.text();
      }
      return text.slice(0, README_MAX_BYTES);
    }
    if (apiRes.status === 404) {
      throw httpError(404, `No README found in ${owner}/${repo}`);
    }
  } catch (err) {
    if (err.statusCode && err.statusCode !== 429) throw err;
  }

  // Fallback: unauthenticated raw fetch
  const candidates = ['README.md', 'readme.md', 'README.txt', 'README'];
  for (const name of candidates) {
    try {
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${name}`,
        { signal: AbortSignal.timeout(6_000) },
      );
      if (rawRes.ok) {
        const text = await rawRes.text();
        return text.slice(0, README_MAX_BYTES);
      }
    } catch { /* try next */ }
  }
  throw httpError(
    404,
    `Could not fetch README for ${owner}/${repo}. The repo may be private or have no README.`,
  );
}

const readmeRoasterGeminiSchema = {
  type: 'OBJECT',
  properties: {
    clarity_score: { type: 'INTEGER' },
    what_it_actually_says: { type: 'STRING' },
    top_3_issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          issue: { type: 'STRING' },
          fix: { type: 'STRING' },
        },
        required: ['issue', 'fix'],
      },
    },
    rewritten_first_two_paragraphs: { type: 'STRING' },
    screenshot_card_summary: { type: 'STRING' },
  },
  required: [
    'clarity_score',
    'what_it_actually_says',
    'top_3_issues',
    'rewritten_first_two_paragraphs',
    'screenshot_card_summary',
  ],
};

async function scoreReadme(body) {
  const { owner, repo } = parseGithubRepoUrl(body.repo_url);
  const readmeText = await fetchReadme(owner, repo);

  if (readmeText.trim().length < 20) {
    throw httpError(422, `The README for ${owner}/${repo} is too short to roast.`);
  }

  const prompt = [
    `You are a senior developer advocate who roasts GitHub READMEs with honest, actionable criticism.`,
    `Analyze the README below for the repository "${owner}/${repo}".`,
    ``,
    `Score clarity from 1 (total disaster) to 10 (crystal clear).`,
    `Describe what the project actually does in one plain sentence.`,
    `List the top 3 issues, each with a concrete fix.`,
    `Rewrite the first two paragraphs as tight, scannable markdown that makes a developer immediately understand what this is and why they should care.`,
    `Write a screenshot_card_summary of about 140 characters: one punchy sentence for a share card targeting developers.`,
    `Be direct and specific. Do not pad or soften. Do not use emojis.`,
    ``,
    `README:`,
    `---`,
    readmeText,
    `---`,
  ].join('\n');

  const result = await callGemini({
    prompt,
    responseSchema: readmeRoasterGeminiSchema,
    timeoutMs: 15_000,
  });

  return {
    repo: `${owner}/${repo}`,
    clarity_score: Math.max(1, Math.min(10, Math.round(result.clarity_score))),
    what_it_actually_says: result.what_it_actually_says,
    top_3_issues: result.top_3_issues,
    rewritten_first_two_paragraphs: result.rewritten_first_two_paragraphs,
    screenshot_card_summary: result.screenshot_card_summary,
  };
}

// ---------------------------------------------------------------------------
// Cold Email Roaster
// ---------------------------------------------------------------------------

const coldEmailRoasterGeminiSchema = {
  type: 'OBJECT',
  properties: {
    cringe_score: { type: 'INTEGER' },
    top_3_issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          issue: { type: 'STRING' },
          fix: { type: 'STRING' },
        },
        required: ['issue', 'fix'],
      },
    },
    rewritten_subject_line: { type: 'STRING' },
    rewritten_body: { type: 'STRING' },
    screenshot_card_summary: { type: 'STRING' },
  },
  required: [
    'cringe_score',
    'top_3_issues',
    'rewritten_subject_line',
    'rewritten_body',
    'screenshot_card_summary',
  ],
};

async function scoreColdEmail(body) {
  const emailText = String(body.email_text || '').trim();
  if (emailText.length < 50) throw httpError(400, 'email_text must be at least 50 characters');
  if (emailText.length > 2000) throw httpError(400, 'email_text must be at most 2000 characters');

  const goal = String(body.goal || '').trim();

  const prompt = [
    `You are a ruthless cold email coach who helps salespeople and founders stop sending cringe emails.`,
    `Analyze the cold email below${goal ? ` (goal: ${goal})` : ''}.`,
    ``,
    `Score cringe level from 1 (respectful, human, sharp) to 10 (maximum cringe, generic, spammy).`,
    `List the top 3 issues, each with a concrete fix.`,
    `Rewrite the subject line in under 80 characters.`,
    `Rewrite the body in under 150 words: clear value prop, specific hook, simple CTA.`,
    `Write a screenshot_card_summary of about 140 characters for a share card targeting marketers and salespeople.`,
    `Be direct and specific. Do not use emojis.`,
    ``,
    `Cold email:`,
    `---`,
    emailText,
    `---`,
  ].join('\n');

  const result = await callGemini({
    prompt,
    responseSchema: coldEmailRoasterGeminiSchema,
    timeoutMs: 12_000,
  });

  return {
    cringe_score: Math.max(1, Math.min(10, Math.round(result.cringe_score))),
    top_3_issues: result.top_3_issues,
    rewritten_subject_line: result.rewritten_subject_line,
    rewritten_body: result.rewritten_body,
    screenshot_card_summary: result.screenshot_card_summary,
  };
}

// ---------------------------------------------------------------------------
// Tweet Predictor
// ---------------------------------------------------------------------------

const tweetPredictorGeminiSchema = {
  type: 'OBJECT',
  properties: {
    predicted_engagement: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    why: { type: 'STRING' },
    top_2_issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          issue: { type: 'STRING' },
          fix: { type: 'STRING' },
        },
        required: ['issue', 'fix'],
      },
    },
    sharper_rewrite: { type: 'STRING' },
    alt_angle: { type: 'STRING' },
    screenshot_card_summary: { type: 'STRING' },
  },
  required: [
    'predicted_engagement',
    'why',
    'top_2_issues',
    'sharper_rewrite',
    'alt_angle',
    'screenshot_card_summary',
  ],
};

async function scoreTweet(body) {
  const draft = String(body.draft || '').trim();
  if (!draft) throw httpError(400, 'draft is required');
  if (draft.length > 280) throw httpError(400, 'draft must be 280 characters or fewer');

  const audience = String(body.audience || '').trim();

  const prompt = [
    `You are a social media strategist who predicts tweet performance and rewrites drafts for maximum engagement.`,
    `Analyze this tweet draft${audience ? ` for the audience: ${audience}` : ''}.`,
    ``,
    `Predict engagement as exactly one of: low, medium, or high.`,
    `Explain why in one sentence.`,
    `List the top 2 issues holding it back, each with a concrete fix.`,
    `Rewrite it as a sharper version in 280 characters or fewer.`,
    `Write an alt_angle version with a completely different framing in 280 characters or fewer.`,
    `Write a screenshot_card_summary of about 140 characters for a share card.`,
    `Be specific and direct. Do not use emojis.`,
    ``,
    `Tweet draft:`,
    `---`,
    draft,
    `---`,
  ].join('\n');

  const result = await callGemini({
    prompt,
    responseSchema: tweetPredictorGeminiSchema,
    timeoutMs: 10_000,
  });

  const validEngagement = ['low', 'medium', 'high'];
  const engagement = validEngagement.includes(result.predicted_engagement)
    ? result.predicted_engagement
    : 'medium';

  return {
    predicted_engagement: engagement,
    why: result.why,
    top_2_issues: result.top_2_issues,
    sharper_rewrite: result.sharper_rewrite,
    alt_angle: result.alt_angle,
    screenshot_card_summary: result.screenshot_card_summary,
  };
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

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
        reject(new Error('request body exceeds 256KB'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      apps: [
        'linkedin-roaster',
        'yc-pitch-deck-critic',
        'readme-roaster',
        'cold-email-roaster',
        'tweet-predictor',
      ],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/openapi.json') {
    sendJson(res, 200, combinedSpec);
    return;
  }

  if (req.method === 'GET' && pathname === '/linkedin-roaster/openapi.json') {
    sendJson(res, 200, linkedinSpec);
    return;
  }

  if (req.method === 'GET' && pathname === '/yc-pitch-deck-critic/openapi.json') {
    sendJson(res, 200, deckSpec);
    return;
  }

  if (req.method === 'GET' && pathname === '/readme-roaster/openapi.json') {
    sendJson(res, 200, readmeRoasterSpec);
    return;
  }

  if (req.method === 'GET' && pathname === '/cold-email-roaster/openapi.json') {
    sendJson(res, 200, coldEmailRoasterSpec);
    return;
  }

  if (req.method === 'GET' && pathname === '/tweet-predictor/openapi.json') {
    sendJson(res, 200, tweetPredictorSpec);
    return;
  }

  if (req.method === 'POST' && pathname === '/linkedin-roaster/score') {
    try {
      sendJson(res, 200, await scoreLinkedinProfile(await readJson(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/yc-pitch-deck-critic/score') {
    try {
      sendJson(res, 200, scorePitchDeck(await readJson(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/readme-roaster/score') {
    try {
      sendJson(res, 200, await scoreReadme(await readJson(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/cold-email-roaster/score') {
    try {
      sendJson(res, 200, await scoreColdEmail(await readJson(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/tweet-predictor/score') {
    try {
      sendJson(res, 200, await scoreTweet(await readJson(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message });
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
  console.log(`Launch Scorecards listening on http://localhost:${PORT}`);
});
