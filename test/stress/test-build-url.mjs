#!/usr/bin/env node
// Unit test for buildUrl path-prefix preservation. Runs without touching the
// DB or starting a server. Verifies fix for the Petstore/OpenAI/Stripe
// path-stripping bug where `new URL('/pet', 'https://host/api/v3')` returned
// `https://host/pet` instead of `https://host/api/v3/pet`.
//
// Run: node test/stress/test-build-url.mjs

import { buildUrl } from '../../apps/server/dist/services/proxied-runner.js';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`    expected: ${expected}`);
    console.log(`    actual:   ${actual}`);
  }
}

console.log('buildUrl path-prefix tests');

// Petstore — the canonical regression
assertEq(
  buildUrl(
    'https://petstore3.swagger.io/api/v3',
    '/pet/findByStatus',
    { status: 'available' },
    [],
    ['status'],
  ),
  'https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available',
  'petstore /api/v3 base + /pet/findByStatus + query',
);

// Petstore with trailing slash on base
assertEq(
  buildUrl(
    'https://petstore3.swagger.io/api/v3/',
    '/pet/findByStatus',
    {},
    [],
    [],
  ),
  'https://petstore3.swagger.io/api/v3/pet/findByStatus',
  'petstore base with trailing slash',
);

// OpenAI /v1 base
assertEq(
  buildUrl('https://api.openai.com/v1', '/models', {}, [], []),
  'https://api.openai.com/v1/models',
  'openai /v1 base + /models',
);

// Stripe /v1 base with path parameter
assertEq(
  buildUrl(
    'https://api.stripe.com/v1',
    '/customers/{id}',
    { id: 'cus_123' },
    ['id'],
    [],
  ),
  'https://api.stripe.com/v1/customers/cus_123',
  'stripe /v1 + path param',
);

// GitHub root base (no path prefix)
assertEq(
  buildUrl(
    'https://api.github.com',
    '/repos/{owner}/{repo}',
    { owner: 'tj', repo: 'commander.js' },
    ['owner', 'repo'],
    [],
  ),
  'https://api.github.com/repos/tj/commander.js',
  'github root base + 2 path params',
);

// Resend — root base, bearer auth
assertEq(
  buildUrl('https://api.resend.com', '/emails', {}, [], []),
  'https://api.resend.com/emails',
  'resend /emails root',
);

// Pet ID with special chars needing URL encoding
assertEq(
  buildUrl(
    'https://petstore3.swagger.io/api/v3',
    '/pet/{petId}',
    { petId: 'a/b c' },
    ['petId'],
    [],
  ),
  'https://petstore3.swagger.io/api/v3/pet/a%2Fb%20c',
  'petstore + path param with special chars',
);

// Base with existing query string
assertEq(
  buildUrl(
    'https://api.example.com/v2?apiKey=abc',
    '/items',
    { limit: 10 },
    [],
    ['limit'],
  ),
  'https://api.example.com/v2/items?apiKey=abc&limit=10',
  'base with existing query string preserved',
);

// Deep nested path prefix
assertEq(
  buildUrl(
    'https://api.example.com/v1/rest/2023-09-01',
    '/teams/{team}',
    { team: 'eng' },
    ['team'],
    [],
  ),
  'https://api.example.com/v1/rest/2023-09-01/teams/eng',
  'deeply nested base path',
);

// Double slash collapse
assertEq(
  buildUrl('https://api.example.com/v1/', '//items', {}, [], []),
  'https://api.example.com/v1/items',
  'double slash in operation path collapsed',
);

// Empty path (no-op)
assertEq(
  buildUrl('https://api.example.com/v1', '/', {}, [], []),
  'https://api.example.com/v1/',
  'empty / path under versioned base',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
