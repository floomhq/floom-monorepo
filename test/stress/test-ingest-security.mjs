#!/usr/bin/env node
// Regression test for INGEST-SECRETS-GLOBAL:
// The OpenAPI → Floom manifest converter must respect per-operation
// security overrides when computing `secrets_needed`. The previous
// implementation walked `components.securitySchemes` blindly and listed
// every defined scheme, which blocked every operation in the petstore
// demo with a bogus "missing API_KEY_KEY" error even though no operation
// actually references the api_key scheme at runtime.
//
// Test matrix:
//   1. Petstore (real spec): most operations reference `petstore_auth`
//      (oauth2 implicit, not handled) or `api_key OR petstore_auth`
//      alternatives. Only `getInventory` strictly requires api_key
//      (single-alternative `security: [{api_key: []}]`). Assertions:
//        - `findPetsByStatus.secrets_needed === []` (petstore_auth is
//          oauth2 which we don't model as a secret)
//        - `addPet.secrets_needed === []` (same reasoning)
//        - `getInventory.secrets_needed === ['api_key']`
//        - app-level manifest.secrets_needed === ['api_key'] (surfaced
//          to MCP / /build preview as the union of per-action needs)
//      The per-action check in proxied-runner means findPetsByStatus
//      and addPet run without any secret configured, while getInventory
//      still fails loudly if api_key is missing.
//   2. Synthetic spec: global `security: [{api_key: []}]` applied to an
//      operation that does NOT override → deriveSecretsFromSpec returns
//      ['api_key'].
//   3. Synthetic spec: same global, but the operation declares
//      `security: []` (empty array, OpenAPI 3 "no auth") →
//      deriveSecretsFromSpec returns [] because that operation
//      explicitly overrides and every other op is public.
//   4. Synthetic spec: same global, but the operation declares
//      `security: [{other_key: []}]` (different scheme) →
//      deriveSecretsFromSpec returns ['other_key'], not 'api_key'. The
//      global is overridden.
//   5. Synthetic spec: no global security, operation-level
//      `security: [{api_key: []}]` → deriveSecretsFromSpec returns
//      ['api_key'].
//   6. Regression: a fast-apps style spec with no security at all →
//      deriveSecretsFromSpec returns [].
//   7. Mixed operations: one public, one requires api_key → the app
//      manifest's secrets_needed includes api_key (at least one op
//      needs it).
//
// Run: node test/stress/test-ingest-security.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

process.env.FLOOM_MAX_ACTIONS_PER_APP = '0';

const { specToManifest, dereferenceSpec, deriveSecretsFromSpec } = await import(
  '../../apps/server/dist/services/openapi-ingest.js'
);

if (typeof specToManifest !== 'function') {
  console.error('FAIL: specToManifest is not exported from openapi-ingest');
  process.exit(1);
}
if (typeof deriveSecretsFromSpec !== 'function') {
  console.error('FAIL: deriveSecretsFromSpec is not exported from openapi-ingest');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assertDeepEqual(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${e}`);
    console.log(`        actual:   ${a}`);
  }
}

function assertIncludes(label, arr, value) {
  if (Array.isArray(arr) && arr.includes(value)) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(arr)} to include ${JSON.stringify(value)}`);
  }
}

function assertNotIncludes(label, arr, value) {
  if (!Array.isArray(arr) || !arr.includes(value)) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(arr)} to NOT include ${JSON.stringify(value)}`);
  }
}

const CACHE_DIR = '/tmp/floom-stress-specs';
const PETSTORE_URL = 'https://petstore3.swagger.io/api/v3/openapi.json';

async function fetchPetstore() {
  const cachePath = `${CACHE_DIR}/petstore-security.json`;
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }
  console.log(`  [fetch] ${PETSTORE_URL}`);
  const res = await fetch(PETSTORE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${PETSTORE_URL}`);
  const spec = await res.json();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(spec));
  return spec;
}

// Build an ingest-style appSpec object.
function mkAppSpec(slug, displayName) {
  return {
    slug,
    type: 'proxied',
    openapi_spec_url: 'https://example.test/openapi.json',
    display_name: displayName,
    auth: 'none',
  };
}

// Mirror the production call path in ingestAppFromUrl:
//   specToManifest(spec, appSpec, deriveSecretsFromSpec(spec))
// This exercises both the derivation logic and the manifest assembly.
function buildManifest(spec, slug, displayName) {
  const derived = deriveSecretsFromSpec(spec);
  return specToManifest(spec, mkAppSpec(slug, displayName), derived);
}

// ---------- Test 1: real petstore spec ----------

console.log('Test 1: real petstore spec → per-action secrets_needed');
{
  const raw = await fetchPetstore();
  const spec = await dereferenceSpec(raw);
  const manifest = buildManifest(spec, 'petstore-test', 'Petstore');

  // App-level: union of all per-action requirements. getInventory
  // strictly requires api_key, no other petstore op produces a manifest
  // secret, so the union is ['api_key'].
  assertDeepEqual(
    'petstore app-level secrets_needed is [api_key] (from getInventory)',
    manifest.secrets_needed,
    ['api_key'],
  );

  // Per-action: the demo-critical operations must NOT require api_key.
  const findPetsByStatus = manifest.actions.findPetsByStatus;
  if (!findPetsByStatus) {
    failed++;
    console.log('  FAIL  petstore manifest missing findPetsByStatus');
  } else {
    assertDeepEqual(
      'findPetsByStatus.secrets_needed === [] (uses petstore_auth oauth2)',
      findPetsByStatus.secrets_needed,
      [],
    );
  }

  const addPet = manifest.actions.addPet;
  if (!addPet) {
    failed++;
    console.log('  FAIL  petstore manifest missing addPet');
  } else {
    assertDeepEqual(
      'addPet.secrets_needed === [] (uses petstore_auth oauth2)',
      addPet.secrets_needed,
      [],
    );
  }

  const getInventory = manifest.actions.getInventory;
  if (!getInventory) {
    failed++;
    console.log('  FAIL  petstore manifest missing getInventory');
  } else {
    assertDeepEqual(
      'getInventory.secrets_needed === [api_key] (strict op-level requirement)',
      getInventory.secrets_needed,
      ['api_key'],
    );
  }

  // getPetById has alternatives (api_key OR petstore_auth) → intersection
  // is empty → not strictly required.
  const getPetById = manifest.actions.getPetById;
  if (!getPetById) {
    failed++;
    console.log('  FAIL  petstore manifest missing getPetById');
  } else {
    assertDeepEqual(
      'getPetById.secrets_needed === [] (alternatives, intersection is empty)',
      getPetById.secrets_needed,
      [],
    );
  }
}

// ---------- Test 2: global api_key security, no operation override ----------

console.log('\nTest 2: global api_key security, operation does NOT override');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    security: [{ api_key: [] }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      },
    },
    paths: {
      '/thing': {
        get: {
          operationId: 'getThing',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'global-inherit', 'Global Inherit');
  assertIncludes(
    'secrets_needed includes api_key when global applies',
    manifest.secrets_needed,
    'api_key',
  );
}

// ---------- Test 3: operation security: [] overrides global ----------

console.log('\nTest 3: operation security: [] overrides global (OpenAPI 3)');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    security: [{ api_key: [] }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      },
    },
    paths: {
      '/public': {
        get: {
          operationId: 'getPublic',
          security: [], // explicit override: no auth for this op
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'empty-override', 'Empty Override');
  assertDeepEqual(
    'secrets_needed is empty when every op overrides with security: []',
    manifest.secrets_needed,
    [],
  );
}

// ---------- Test 4: operation security: [{other}] overrides global ----------

console.log('\nTest 4: operation security references a DIFFERENT scheme');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    security: [{ api_key: [] }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        other_key: { type: 'apiKey', name: 'X-Other-Key', in: 'header' },
      },
    },
    paths: {
      '/other': {
        get: {
          operationId: 'getOther',
          security: [{ other_key: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'other-override', 'Other Override');
  assertIncludes(
    'secrets_needed includes other_key (the override scheme)',
    manifest.secrets_needed,
    'other_key',
  );
  assertNotIncludes(
    'secrets_needed does NOT include api_key (global was overridden)',
    manifest.secrets_needed,
    'api_key',
  );
}

// ---------- Test 5: operation-level security only, no global ----------

console.log('\nTest 5: no global security, operation declares api_key');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      },
    },
    paths: {
      '/secure': {
        get: {
          operationId: 'getSecure',
          security: [{ api_key: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'op-level', 'Op Level');
  assertIncludes(
    'secrets_needed includes api_key from op-level declaration',
    manifest.secrets_needed,
    'api_key',
  );
}

// ---------- Test 6: no security anywhere ----------

console.log('\nTest 6: no security declared anywhere');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    paths: {
      '/ping': {
        get: {
          operationId: 'ping',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'no-sec', 'No Sec');
  assertDeepEqual(
    'secrets_needed empty when no security declared',
    manifest.secrets_needed,
    [],
  );
}

// ---------- Test 7: mixed operations — one requires, one public ----------

console.log('\nTest 7: mixed ops — one public, one requires api_key');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Mixed', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    security: [{ api_key: [] }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      },
    },
    paths: {
      '/public': {
        get: {
          operationId: 'publicOp',
          security: [], // no auth
          responses: { '200': { description: 'ok' } },
        },
      },
      '/private': {
        post: {
          operationId: 'privateOp',
          // inherits global security (api_key)
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'mixed', 'Mixed');
  assertIncludes(
    'secrets_needed includes api_key (privateOp still requires it)',
    manifest.secrets_needed,
    'api_key',
  );
}

// ---------- Test 8: alternatives (A OR B) — neither strictly required ----------

console.log('\nTest 8: op-level alternatives (A OR B) — neither strictly required');
{
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Alternatives', version: '1.0' },
    servers: [{ url: 'https://example.com' }],
    components: {
      securitySchemes: {
        api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        oauth2: {
          type: 'oauth2',
          flows: { implicit: { authorizationUrl: 'https://example.com/oauth', scopes: {} } },
        },
      },
    },
    paths: {
      '/either': {
        get: {
          operationId: 'getEither',
          // Caller may choose api_key OR oauth2. Intersection is empty,
          // so neither scheme is strictly required.
          security: [{ api_key: [] }, { oauth2: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const manifest = buildManifest(spec, 'alternatives', 'Alternatives');
  assertDeepEqual(
    'secrets_needed empty when op offers alternatives (A OR B)',
    manifest.secrets_needed,
    [],
  );
}

// ---------- Summary ----------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
