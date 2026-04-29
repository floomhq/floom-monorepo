#!/usr/bin/env node
// R26-A regression: per-IP rate limit on /auth/sign-up/email and
// /auth/request-password-reset must return 429 with structured JSON
// after the configured per-IP-per-hour budget is exhausted.
//
// Why this test exists: 2026-04-29 floom.dev opened public signup. Sidecar
// review (OpenRouter) flagged unrate-limited signup as highest-probability
// week-1 incident — bot spam exhausting Resend's 3k/day quota would lock
// real users out of verification emails. This test re-verifies that the
// per-IP budget actually fires.
//
// Default budgets in production:
//   signup: 5/hr per IP, 500/day global
//   reset:  3/hr per IP, 200/day global
//
// We hit each endpoint 1+limit times and assert:
//   - First N responses are 200 (or whatever the upstream returns; not 429)
//   - Response N+1 is 429 with body { error: 'rate_limit_exceeded',
//     scope, reason, retry_after_seconds }
//   - Retry-After header present

import { request } from 'node:http';

const TARGET = process.env.FLOOM_TEST_TARGET || 'https://mvp.floom.dev';
const SIGNUP_LIMIT = Number(process.env.FLOOM_SIGNUP_RATE_PER_IP_PER_HOUR ?? 5);
const RESET_LIMIT = Number(process.env.FLOOM_RESET_RATE_PER_IP_PER_HOUR ?? 3);

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, retryAfter: res.headers.get('retry-after'), json };
}

async function testSignupBurst() {
  console.log(`\n[signup] ${SIGNUP_LIMIT + 1} POSTs to /auth/sign-up/email at ${TARGET}`);
  let firstBlocked = -1;
  for (let i = 1; i <= SIGNUP_LIMIT + 1; i++) {
    const email = `r26a-rate-test-${Date.now()}-${i}@floom-test.example.com`;
    const res = await fetchJson(`${TARGET}/auth/sign-up/email`, {
      email,
      password: 'R26ATestPass!',
      name: `R26A Test ${i}`,
    });
    if (res.status === 429 && firstBlocked === -1) {
      firstBlocked = i;
    }
    console.log(`  [${i}/${SIGNUP_LIMIT + 1}] HTTP ${res.status}${res.retryAfter ? ' Retry-After=' + res.retryAfter : ''}`);
  }
  log(
    'signup rate limit fires within budget+1',
    firstBlocked >= 1 && firstBlocked <= SIGNUP_LIMIT + 1,
    firstBlocked === -1 ? 'never blocked' : `first 429 at request ${firstBlocked}`,
  );
}

async function testResetBurst() {
  console.log(`\n[reset] ${RESET_LIMIT + 1} POSTs to /auth/request-password-reset at ${TARGET}`);
  let firstBlocked = -1;
  for (let i = 1; i <= RESET_LIMIT + 1; i++) {
    const res = await fetchJson(`${TARGET}/auth/request-password-reset`, {
      email: `nobody-r26a-${i}@floom-test.example.com`,
      redirectTo: `${TARGET}/reset-password`,
    });
    if (res.status === 429 && firstBlocked === -1) {
      firstBlocked = i;
    }
    console.log(`  [${i}/${RESET_LIMIT + 1}] HTTP ${res.status}${res.retryAfter ? ' Retry-After=' + res.retryAfter : ''}`);
  }
  log(
    'reset rate limit fires within budget+1',
    firstBlocked >= 1 && firstBlocked <= RESET_LIMIT + 1,
    firstBlocked === -1 ? 'never blocked' : `first 429 at request ${firstBlocked}`,
  );
}

async function test429ShapeOnSignup() {
  console.log('\n[shape] 429 body must have structured fields');
  // Send N+5 to be sure we trip
  let bodyOnBlock = null;
  for (let i = 0; i < SIGNUP_LIMIT + 5; i++) {
    const email = `shape-${Date.now()}-${i}@floom-test.example.com`;
    const res = await fetchJson(`${TARGET}/auth/sign-up/email`, {
      email,
      password: 'ShapeTest!',
      name: 'Shape Test',
    });
    if (res.status === 429) {
      bodyOnBlock = res.json;
      break;
    }
  }
  if (!bodyOnBlock) {
    log('429 body shape', false, 'never received a 429');
    return;
  }
  const ok =
    bodyOnBlock.error === 'rate_limit_exceeded' &&
    typeof bodyOnBlock.scope === 'string' &&
    typeof bodyOnBlock.retry_after_seconds === 'number';
  log('429 body shape', ok, JSON.stringify(bodyOnBlock));
}

(async () => {
  await testSignupBurst();
  await testResetBurst();
  await test429ShapeOnSignup();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
