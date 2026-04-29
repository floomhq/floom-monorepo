#!/usr/bin/env node
// R37: smoke tests for the 3 Python proxy-runtime sidecars.
//
// Starts each server on a free port, hits /health and /openapi.json,
// then POSTs a minimal dry-run payload (no GEMINI_API_KEY set) and
// asserts the response shape matches the declared output schema.
//
// No external network required. No Docker. No Gemini API key.
//
// Usage: node test/stress/test-proxy-app-python-servers.mjs

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  if (ok) {
    passed++;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}\n`);
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function runServerTest({ name, script, action, payload, validateOutputs }) {
  process.stdout.write(`\n--- ${name} ---\n`);
  const port = await getFreePort();
  const proc = spawn('python3', [script], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  proc.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  proc.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const base = `http://127.0.0.1:${port}`;

  try {
    const healthy = await waitForHttp(`${base}/health`, 15_000);
    log(`${name} /health responds`, healthy, healthy ? '' : 'server did not become healthy');
    if (!healthy) return;

    // GET /openapi.json
    const specRes = await fetch(`${base}/openapi.json`);
    log(`${name} /openapi.json 200`, specRes.ok, specRes.ok ? '' : `status=${specRes.status}`);
    const spec = await specRes.json();
    log(
      `${name} openapi has POST /${action}`,
      Boolean(spec?.paths?.[`/${action}`]?.post),
      JSON.stringify(Object.keys(spec?.paths ?? {})),
    );

    // POST action
    const runRes = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    log(
      `${name} POST /${action} 200`,
      runRes.ok,
      runRes.ok ? '' : `status=${runRes.status} body=${await runRes.text().catch(() => '?')}`,
    );
    if (!runRes.ok) return;

    const output = await runRes.json();
    validateOutputs(output, log, name);
  } catch (err) {
    log(`${name} smoke`, false, err.message);
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --- pitch-coach ---
await runServerTest({
  name: 'pitch-coach',
  script: join(REPO_ROOT, 'examples/pitch-coach/server.py'),
  action: 'coach',
  payload: { pitch: 'We help B2B ops teams stop losing leads to slow handoffs.' },
  validateOutputs(output, log, name) {
    log(`${name} has harsh_truth array`, Array.isArray(output.harsh_truth), JSON.stringify(output).slice(0, 200));
    log(`${name} harsh_truth has 3 items`, output.harsh_truth?.length === 3, `got ${output.harsh_truth?.length}`);
    log(`${name} has rewrites array`, Array.isArray(output.rewrites), '');
    log(`${name} rewrites has 3 items`, output.rewrites?.length === 3, `got ${output.rewrites?.length}`);
    log(`${name} has one_line_tldr`, typeof output.one_line_tldr === 'string' && output.one_line_tldr.length > 0, '');
    log(`${name} dry_run=true (no key)`, output.dry_run === true, `got ${output.dry_run}`);
  },
});

// --- competitor-lens ---
await runServerTest({
  name: 'competitor-lens',
  script: join(REPO_ROOT, 'examples/competitor-lens/server.py'),
  action: 'analyze',
  payload: {
    your_url: 'https://floom.dev',
    competitor_url: 'https://n8n.io',
  },
  validateOutputs(output, log, name) {
    log(`${name} has positioning array`, Array.isArray(output.positioning), JSON.stringify(output).slice(0, 200));
    log(`${name} positioning has 3 rows`, output.positioning?.length === 3, `got ${output.positioning?.length}`);
    log(`${name} has pricing array`, Array.isArray(output.pricing), '');
    log(`${name} has pricing_insight string`, typeof output.pricing_insight === 'string', '');
    log(`${name} has unique_to_you`, Array.isArray(output.unique_to_you), '');
    log(`${name} has unique_to_competitor`, Array.isArray(output.unique_to_competitor), '');
    // Either a cache hit (dry_run=false, cache_hit=true) or a dry-run stub
    // (dry_run=true, no GEMINI_API_KEY). Both are acceptable in this smoke test.
    const metaOk = output.meta?.dry_run === true || output.meta?.cache_hit === true;
    log(`${name} meta.dry_run or cache_hit set`, metaOk, `got ${JSON.stringify(output.meta)}`);
  },
});

// --- ai-readiness-audit ---
await runServerTest({
  name: 'ai-readiness-audit',
  script: join(REPO_ROOT, 'examples/ai-readiness-audit/server.py'),
  action: 'audit',
  payload: { company_url: 'https://floom.dev' },
  validateOutputs(output, log, name) {
    log(`${name} has readiness_score int`, Number.isInteger(output.readiness_score), `got ${output.readiness_score}`);
    log(`${name} score in 0-10`, output.readiness_score >= 0 && output.readiness_score <= 10, `got ${output.readiness_score}`);
    log(`${name} has score_rationale`, typeof output.score_rationale === 'string' && output.score_rationale.length > 0, '');
    log(`${name} risks has 3 items`, output.risks?.length === 3, `got ${output.risks?.length}`);
    log(`${name} opportunities has 3 items`, output.opportunities?.length === 3, `got ${output.opportunities?.length}`);
    log(`${name} has next_action`, typeof output.next_action === 'string' && output.next_action.length > 0, '');
    // Either a cache hit (dry_run=false, cache_hit=true) or a dry-run stub
    // (dry_run=true, no GEMINI_API_KEY). Both are acceptable in this smoke test.
    const aiAuditOk = output.dry_run === true || output.cache_hit === true;
    log(`${name} dry_run or cache_hit set`, aiAuditOk, `dry_run=${output.dry_run} cache_hit=${output.cache_hit}`);
  },
});

process.stdout.write(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
