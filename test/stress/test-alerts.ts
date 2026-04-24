#!/usr/bin/env node
// Layer-5 Discord alert tests.
//
// Verifies:
//   1. message format matches the operator contract exactly
//   2. app_unavailable alerts fire only on the 3rd hit in 10 minutes
//   3. same (reason, slug) is rate-limited to 1 alert / 10 minutes
//   4. missing webhook stays a no-op and never calls fetch

process.env.PUBLIC_URL = 'https://preview.floom.dev';
process.env.DISCORD_ALERT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/123/abc';

type AlertsModule = typeof import('../../apps/server/src/lib/alerts.ts');

let passed = 0;
let failed = 0;
const log = (label: string, ok: boolean, detail?: string) => {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
};

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), init });
  return new Response(null, { status: 204 });
}) as typeof fetch;

async function flushFetch(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function readPayload(idx = 0): { content?: string; allowed_mentions?: { parse?: string[] } } {
  const raw = fetchCalls[idx]?.init?.body;
  return typeof raw === 'string' ? JSON.parse(raw) : {};
}

async function main(): Promise<void> {
  const { __testing, noteAppUnavailable, sendLayer5Alert }: AlertsModule =
    await import('../../apps/server/src/lib/alerts.ts');

  function reset(): void {
    fetchCalls.length = 0;
    __testing.resetState();
    process.env.DISCORD_ALERT_WEBHOOK_URL =
      'https://discord.com/api/webhooks/123/abc';
  }

  console.log('Layer-5 alerts');

  // 1. message format
  reset();
  const formatNow = Date.parse('2026-04-24T12:00:00.000Z');
  const longDetail = 'x'.repeat(250);
  sendLayer5Alert('launch_demo_inactive', 'lead-scorer', longDetail, formatNow);
  await flushFetch();
  const formatPayload = readPayload();
  const expectedMessage = __testing.formatAlertMessage(
    'launch_demo_inactive',
    'lead-scorer',
    longDetail,
    formatNow,
  );
  log('sendLayer5Alert posts once', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
  log(
    'message format matches contract',
    formatPayload.content === expectedMessage,
    String(formatPayload.content),
  );
  log(
    'message line 1 includes the reason',
    formatPayload.content?.split('\n')[0] === '🔴 Floom alert: launch_demo_inactive',
  );
  log(
    'message line 2 includes the slug',
    formatPayload.content?.split('\n')[1] === 'App: lead-scorer',
  );
  log(
    'message line 3 includes PUBLIC_URL-derived env',
    formatPayload.content?.split('\n')[2] === 'Env: https://preview.floom.dev',
  );
  log(
    'message line 4 includes ISO8601 time',
    formatPayload.content?.split('\n')[3] === 'Time: 2026-04-24T12:00:00.000Z',
  );
  log(
    'detail is truncated to 200 chars',
    formatPayload.content?.split('\n')[4] === `Detail: ${'x'.repeat(200)}`,
  );
  log(
    'allowed_mentions disables pings',
    Array.isArray(formatPayload.allowed_mentions?.parse) &&
      formatPayload.allowed_mentions?.parse?.length === 0,
  );

  // 2. thresholding for app_unavailable
  reset();
  const thresholdBase = Date.parse('2026-04-24T13:00:00.000Z');
  noteAppUnavailable('resume-screener', 'no such image', thresholdBase);
  noteAppUnavailable('resume-screener', 'no such image', thresholdBase + 60_000);
  await flushFetch();
  log(
    'app_unavailable stays quiet before the 3rd hit',
    fetchCalls.length === 0,
    `calls=${fetchCalls.length}`,
  );
  noteAppUnavailable('resume-screener', 'no such image', thresholdBase + 120_000);
  await flushFetch();
  const thresholdPayload = readPayload();
  log(
    'app_unavailable alerts on the 3rd hit in 10 minutes',
    fetchCalls.length === 1,
    `calls=${fetchCalls.length}`,
  );
  log(
    'threshold alert reason is app_unavailable',
    thresholdPayload.content?.split('\n')[0] === '🔴 Floom alert: app_unavailable',
  );
  log(
    'threshold alert includes the slug',
    thresholdPayload.content?.split('\n')[1] === 'App: resume-screener',
  );

  // 3. same (reason, slug) dedupe window
  reset();
  const dedupeBase = Date.parse('2026-04-24T14:00:00.000Z');
  sendLayer5Alert('launch_demo_inactive', 'lead-scorer', 'first', dedupeBase);
  sendLayer5Alert(
    'launch_demo_inactive',
    'lead-scorer',
    'second should be dropped',
    dedupeBase + 60_000,
  );
  sendLayer5Alert(
    'launch_demo_inactive',
    'competitor-analyzer',
    'different slug should send',
    dedupeBase + 120_000,
  );
  sendLayer5Alert(
    'launch_demo_inactive',
    'lead-scorer',
    'after 10m window should send again',
    dedupeBase + 601_000,
  );
  await flushFetch();
  log(
    'same (reason, slug) is rate-limited to once per 10 minutes',
    fetchCalls.length === 3,
    `calls=${fetchCalls.length}`,
  );

  // 4. missing webhook is a no-op
  reset();
  delete process.env.DISCORD_ALERT_WEBHOOK_URL;
  sendLayer5Alert('launch_demo_inactive', 'lead-scorer', 'missing webhook', dedupeBase);
  await flushFetch();
  log(
    'missing webhook does not call fetch',
    fetchCalls.length === 0,
    `calls=${fetchCalls.length}`,
  );

  globalThis.fetch = originalFetch;

  console.log(`\npassed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
