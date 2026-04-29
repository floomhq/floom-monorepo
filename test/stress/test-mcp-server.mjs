#!/usr/bin/env node
// Phase 2B MCP server contract: agent-token calls to /mcp expose the
// read/run toolset with JSON Schema and JSON-RPC tool-call ergonomics.

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'floom-mcp-server-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.FLOOM_DISABLE_JOB_WORKER = 'true';
process.env.FLOOM_DISABLE_TRIGGERS_WORKER = 'true';
process.env.FLOOM_DISABLE_ZOMBIE_SWEEPER = 'true';
process.env.FLOOM_SEED_APPS = 'false';
process.env.FLOOM_SEED_LAUNCH_DEMOS = 'false';
process.env.FLOOM_FAST_APPS = 'false';
delete process.env.FLOOM_CLOUD_MODE;
delete process.env.FLOOM_AUTH_TOKEN;

const { db } = await import('../../apps/server/dist/db.js');
const agentTokens = await import('../../apps/server/dist/lib/agent-tokens.js');

let passed = 0;
let failed = 0;
function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

async function getFreePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate port')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message || 'no response'}`);
}

async function bootServer() {
  const port = await getFreePort();
  const proc = spawn('node', [join(REPO_ROOT, 'apps/server/dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHttp(`http://localhost:${port}/api/health`, 20_000);
  } catch (err) {
    proc.kill('SIGTERM');
    throw new Error(`${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { port, proc };
}

async function stopServer(server) {
  server.proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function createToken(scope = 'read-write', opts = {}) {
  const raw = agentTokens.generateAgentToken();
  const workspaceId = opts.workspace_id || 'local';
  const userId = opts.user_id || 'local';
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_${scope}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    `test-${scope}`,
    scope,
    workspaceId,
    userId,
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

async function callMcp(port, token, body) {
  return callMcpAt(port, '/mcp', token, body);
}

async function callMcpAt(port, path, token, body) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

function parseToolText(resp) {
  const raw = resp.json?.result?.content?.[0]?.text;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

console.log('MCP agent read server');

const readToken = createToken('read');
const writeToken = createToken('read-write');
const publishToken = createToken('publish-only');
db.prepare(
  `INSERT INTO users (id, email, name, auth_provider, auth_subject)
   VALUES ('viewer_user', 'viewer@example.com', 'Viewer', 'test', 'viewer_user')`,
).run();
db.prepare(
  `INSERT INTO workspace_members (workspace_id, user_id, role)
   VALUES ('local', 'viewer_user', 'viewer')`,
).run();
const viewerWriteToken = createToken('read-write', { user_id: 'viewer_user', workspace_id: 'local' });
const server = await bootServer();

try {
  const readList = await callMcp(server.port, readToken, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  const readTools = readList.json?.result?.tools || [];
  const readNames = readTools.map((tool) => tool.name).sort();
  const readExpected = [
    'discover_apps',
    'get_app_about',
    'get_app_details',
    'get_app_logs',
    'get_app_skill',
    'get_app_source',
    'get_run',
    'list_app_reviews',
    'list_my_runs',
    'run_app',
  ].sort();
  log('tools/list returns HTTP 200', readList.res.status === 200, readList.text);
  log('tools/list returns JSON-RPC 2.0', readList.json?.jsonrpc === '2.0', readList.text);
  log('read token /mcp exposes read/run/app-page tools', JSON.stringify(readNames) === JSON.stringify(readExpected), JSON.stringify(readNames));

  const publicList = await callMcp(server.port, null, {
    jsonrpc: '2.0',
    id: 101,
    method: 'tools/list',
    params: {},
  });
  log('no-token /mcp remains public', publicList.res.status === 200, publicList.text);

  const invalidBearerList = await callMcp(server.port, 'invalid_token_shape', {
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/list',
    params: {},
  });
  log(
    'non-Floom bearer on /mcp returns 401 invalid_token',
    invalidBearerList.res.status === 401 && invalidBearerList.json?.code === 'invalid_token',
    invalidBearerList.text,
  );
  log(
    'invalid bearer hint uses canonical agent token settings path',
    typeof invalidBearerList.json?.hint === 'string' &&
      invalidBearerList.json.hint.includes('/settings/agent-tokens') &&
      !invalidBearerList.json.hint.includes('/me/agent-keys'),
    invalidBearerList.text,
  );

  const writeList = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/list',
    params: {},
  });
  const writeNames = (writeList.json?.result?.tools || []).map((tool) => tool.name).sort();
  const writeExpected = [
    'account_delete_secret',
    'account_get',
    'account_get_context',
    'account_list_secrets',
    'account_set_secret',
    'account_set_user_context',
    'account_set_workspace_context',
    'discover_apps',
    'get_app_about',
    'get_app_details',
    'get_app_logs',
    'get_app_skill',
    'get_app_source',
    'get_run',
    'list_app_reviews',
    'list_my_runs',
    'leave_app_review',
    'run_app',
    'submit_app_review',
    'studio_claim_app',
    'studio_delete_app',
    'studio_delete_creator_secret',
    'studio_detect_app',
    'studio_fork_app',
    'studio_get_app_rate_limit',
    'studio_get_app_sharing',
    'studio_ingest_hint',
    'studio_install_app',
    'studio_list_my_apps',
    'studio_list_secret_policies',
    'studio_publish_app',
    'studio_set_app_rate_limit',
    'studio_set_app_sharing',
    'studio_set_creator_secret',
    'studio_set_secret_policy',
    'studio_submit_app_review',
    'studio_uninstall_app',
    'studio_update_app',
    'studio_withdraw_app_review',
  ].sort();
  log('read-write token exposes run + studio + account tools', JSON.stringify(writeNames) === JSON.stringify(writeExpected), JSON.stringify(writeNames));

  const publishList = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/list',
    params: {},
  });
  const publishNames = (publishList.json?.result?.tools || []).map((tool) => tool.name).sort();
  const publishExpected = [
    'studio_claim_app',
    'studio_delete_app',
    'studio_delete_creator_secret',
    'studio_detect_app',
    'studio_fork_app',
    'studio_get_app_rate_limit',
    'studio_get_app_sharing',
    'studio_ingest_hint',
    'studio_install_app',
    'studio_list_my_apps',
    'studio_list_secret_policies',
    'studio_publish_app',
    'studio_set_app_rate_limit',
    'studio_set_app_sharing',
    'studio_set_creator_secret',
    'studio_set_secret_policy',
    'studio_submit_app_review',
    'studio_uninstall_app',
    'studio_update_app',
    'studio_withdraw_app_review',
  ].sort();
  log('publish-only token exposes studio tools without run tools', JSON.stringify(publishNames) === JSON.stringify(publishExpected), JSON.stringify(publishNames));

  const tools = writeList.json?.result?.tools || [];
  const discover = tools.find((tool) => tool.name === 'discover_apps');
  const skill = tools.find((tool) => tool.name === 'get_app_skill');
  const detail = tools.find((tool) => tool.name === 'get_app_details');
  const source = tools.find((tool) => tool.name === 'get_app_source');
  const reviews = tools.find((tool) => tool.name === 'list_app_reviews');
  const run = tools.find((tool) => tool.name === 'run_app');
  const getRun = tools.find((tool) => tool.name === 'get_run');
  const listRuns = tools.find((tool) => tool.name === 'list_my_runs');
  const publish = tools.find((tool) => tool.name === 'studio_publish_app');
  log('discover_apps schema exposes q + category + limit + cursor', Boolean(discover?.inputSchema?.properties?.q) && Boolean(discover?.inputSchema?.properties?.category) && Boolean(discover?.inputSchema?.properties?.limit) && Boolean(discover?.inputSchema?.properties?.cursor));
  log('get_app_skill requires slug', Array.isArray(skill?.inputSchema?.required) && skill.inputSchema.required.includes('slug'));
  log('get_app_details requires slug', Array.isArray(detail?.inputSchema?.required) && detail.inputSchema.required.includes('slug'));
  log('get_app_source exposes include_openapi_spec', Boolean(source?.inputSchema?.properties?.include_openapi_spec));
  log('list_app_reviews exposes limit', Boolean(reviews?.inputSchema?.properties?.limit));
  log('run_app schema exposes slug + action + inputs', Boolean(run?.inputSchema?.properties?.slug) && Boolean(run?.inputSchema?.properties?.action) && Boolean(run?.inputSchema?.properties?.inputs));
  log('get_run requires run_id', Array.isArray(getRun?.inputSchema?.required) && getRun.inputSchema.required.includes('run_id'));
  log('list_my_runs schema exposes pagination args', Boolean(listRuns?.inputSchema?.properties?.limit) && Boolean(listRuns?.inputSchema?.properties?.cursor));
  log('studio_publish_app schema exposes OpenAPI publish args', Boolean(publish?.inputSchema?.properties?.openapi_url) && Boolean(publish?.inputSchema?.properties?.openapi_spec) && Boolean(publish?.inputSchema?.properties?.visibility));

  const call = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'discover_apps', arguments: { limit: 5 } },
  });
  const rawPayload = call.json?.result?.content?.[0]?.text;
  let payload = null;
  try {
    payload = JSON.parse(rawPayload);
  } catch {}
  log('tools/call returns a JSON-RPC envelope', call.json?.jsonrpc === '2.0', call.text);
  log('discover_apps tool result is JSON text content', payload && Array.isArray(payload.apps), rawPayload);

  const publishCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: {
      name: 'studio_publish_app',
      arguments: {
        slug: 'agent-studio-publish',
        name: 'Agent Studio Publish',
        description: 'Published from the agent MCP studio surface',
        visibility: 'private',
        openapi_spec: {
          openapi: '3.0.0',
          info: { title: 'Agent Studio Publish', version: '1.0.0' },
          servers: [{ url: `http://localhost:${server.port}` }],
          components: {
            securitySchemes: {
              api_key: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            },
          },
          paths: {
            '/echo': {
              post: {
                operationId: 'echo',
                security: [{ api_key: [] }],
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { message: { type: 'string' } },
                      },
                    },
                  },
                },
                responses: { 200: { description: 'ok' } },
              },
            },
          },
        },
      },
    },
  });
  let publishPayload = null;
  try {
    publishPayload = JSON.parse(publishCall.json?.result?.content?.[0]?.text);
  } catch {}
  const publishedRow = db.prepare('SELECT * FROM apps WHERE slug = ?').get('agent-studio-publish');
  log('publish-only token can publish via studio_publish_app', publishPayload?.ok === true && publishPayload?.slug === 'agent-studio-publish', publishCall.text);
  log('studio_publish_app persists owner-scoped app', Boolean(publishedRow) && publishedRow.workspace_id === 'local' && publishedRow.author === 'local', JSON.stringify(publishedRow));
  log('studio_publish_app returns request-origin URLs', publishPayload?.permalink === `http://localhost:${server.port}/p/agent-studio-publish` && publishPayload?.mcp_url === `http://localhost:${server.port}/mcp/app/agent-studio-publish`, JSON.stringify(publishPayload));

  const detailsCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 121,
    method: 'tools/call',
    params: { name: 'get_app_details', arguments: { slug: 'agent-studio-publish' } },
  });
  const detailsPayload = parseToolText(detailsCall);
  log('get_app_details returns about/install/source/reviews payload', detailsPayload?.about?.description && detailsPayload?.install?.mcp_url && detailsPayload?.source?.raw_openapi_url && detailsPayload?.reviews?.summary, detailsCall.text);

  const sourceCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 122,
    method: 'tools/call',
    params: { name: 'get_app_source', arguments: { slug: 'agent-studio-publish', include_openapi_spec: true } },
  });
  const sourcePayload = parseToolText(sourceCall);
  log('get_app_source can include cached OpenAPI spec', sourcePayload?.source?.openapi_spec_available === true && sourcePayload?.openapi_spec?.openapi === '3.0.0', sourceCall.text);

  const reviewSubmitCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 123,
    method: 'tools/call',
    params: { name: 'submit_app_review', arguments: { slug: 'agent-studio-publish', rating: 5, title: 'Useful', body: 'Works headlessly.' } },
  });
  const reviewSubmitPayload = parseToolText(reviewSubmitCall);
  log('submit_app_review upserts token user review', reviewSubmitPayload?.ok === true && reviewSubmitPayload?.review?.rating === 5, reviewSubmitCall.text);

  const reviewsCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 124,
    method: 'tools/call',
    params: { name: 'list_app_reviews', arguments: { slug: 'agent-studio-publish', limit: 5 } },
  });
  const reviewsPayload = parseToolText(reviewsCall);
  log('list_app_reviews returns review summary and rows', reviewsPayload?.summary?.count === 1 && reviewsPayload?.reviews?.[0]?.title === 'Useful', reviewsCall.text);

  const aboutCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 125,
    method: 'tools/call',
    params: { name: 'get_app_about', arguments: { slug: 'agent-studio-publish' } },
  });
  const aboutPayload = parseToolText(aboutCall);
  log('get_app_about returns slug + description + readme + permalink', aboutPayload?.slug === 'agent-studio-publish' && typeof aboutPayload?.description === 'string' && typeof aboutPayload?.permalink === 'string', aboutCall.text);

  const leaveCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 126,
    method: 'tools/call',
    params: { name: 'leave_app_review', arguments: { slug: 'agent-studio-publish', rating: 4, comment: 'leave_app_review path' } },
  });
  const leavePayload = parseToolText(leaveCall);
  log('leave_app_review upserts via comment field and returns review_id', leavePayload?.ok === true && typeof leavePayload?.review_id === 'string' && leavePayload?.review?.rating === 4, leaveCall.text);

  const studioList = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 21,
    method: 'tools/call',
    params: { name: 'studio_list_my_apps', arguments: { limit: 10 } },
  });
  let studioListPayload = null;
  try {
    studioListPayload = JSON.parse(studioList.json?.result?.content?.[0]?.text);
  } catch {}
  log('studio_list_my_apps includes pending private app', Boolean((studioListPayload?.apps || []).find((app) => app.slug === 'agent-studio-publish' && app.visibility === 'private')), studioList.text);

  const forkCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 44,
    method: 'tools/call',
    params: {
      name: 'studio_fork_app',
      arguments: { source_slug: 'agent-studio-publish', slug: 'agent-studio-fork', name: 'Agent Studio Fork' },
    },
  });
  const forkPayload = parseToolText(forkCall);
  const forkRow = db.prepare(`SELECT * FROM apps WHERE slug = 'agent-studio-fork'`).get();
  log('studio_fork_app creates private editable copy', forkPayload?.ok === true && forkRow?.visibility === 'private' && forkRow?.forked_from_app_id === publishedRow.id, forkCall.text);

  db.prepare(
    `INSERT INTO apps (id, slug, name, description, manifest, status, code_path, author, workspace_id, visibility, publish_status)
     VALUES ('app_claim_fixture', 'agent-claim-fixture', 'Claim Fixture', 'Claim me', ?, 'active', 'proxied:agent-claim-fixture', NULL, 'local', 'public', 'published')`,
  ).run(publishedRow.manifest);
  const claimCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 45,
    method: 'tools/call',
    params: { name: 'studio_claim_app', arguments: { slug: 'agent-claim-fixture' } },
  });
  const claimPayload = parseToolText(claimCall);
  const claimRow = db.prepare(`SELECT * FROM apps WHERE slug = 'agent-claim-fixture'`).get();
  log('studio_claim_app claims unowned local app and makes it private', claimPayload?.claimed === true && claimRow?.author === 'local' && claimRow?.visibility === 'private' && typeof claimRow?.claimed_at === 'string', claimCall.text);

  db.prepare(
    `INSERT INTO apps (id, slug, name, description, manifest, status, code_path, author, workspace_id, visibility, publish_status)
     VALUES ('app_install_fixture', 'agent-install-fixture', 'Install Fixture', 'Install me', ?, 'active', 'proxied:agent-install-fixture', 'alice', 'ws_alice', 'public_live', 'published')`,
  ).run(publishedRow.manifest);
  const installCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 46,
    method: 'tools/call',
    params: { name: 'studio_install_app', arguments: { slug: 'agent-install-fixture' } },
  });
  const installPayload = parseToolText(installCall);
  const installRowCount = db.prepare(`SELECT COUNT(*) AS n FROM app_installs WHERE app_id = 'app_install_fixture' AND workspace_id = 'local'`).get().n;
  log('studio_install_app pins public app without ownership', installPayload?.installed === true && installRowCount === 1, installCall.text);

  db.prepare(
    `INSERT INTO apps (id, slug, name, description, manifest, status, code_path, author, workspace_id, visibility, publish_status)
     VALUES ('app_install_pending_fixture', 'agent-install-pending-fixture', 'Pending Install Fixture', 'Owned pending app', ?, 'active', 'proxied:agent-install-pending-fixture', 'local', 'local', 'pending_review', 'pending_review')`,
  ).run(publishedRow.manifest);
  const pendingInstallCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 461,
    method: 'tools/call',
    params: { name: 'studio_install_app', arguments: { slug: 'agent-install-pending-fixture' } },
  });
  const pendingInstallPayload = parseToolText(pendingInstallCall);
  log(
    'studio_install_app returns 409 app_not_installable for owned pending-review app',
    pendingInstallCall.json?.result?.isError === true &&
      pendingInstallPayload?.status === 409 &&
      pendingInstallPayload?.details?.code === 'app_not_installable',
    pendingInstallCall.text,
  );

  const uninstallCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 47,
    method: 'tools/call',
    params: { name: 'studio_uninstall_app', arguments: { slug: 'agent-install-fixture' } },
  });
  const uninstallPayload = parseToolText(uninstallCall);
  const installRowCountAfter = db.prepare(`SELECT COUNT(*) AS n FROM app_installs WHERE app_id = 'app_install_fixture' AND workspace_id = 'local'`).get().n;
  log('studio_uninstall_app removes only install pin', uninstallPayload?.removed === true && installRowCountAfter === 0 && db.prepare(`SELECT 1 FROM apps WHERE id = 'app_install_fixture'`).get(), uninstallCall.text);

  const setRateLimit = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 48,
    method: 'tools/call',
    params: { name: 'studio_set_app_rate_limit', arguments: { slug: 'agent-studio-publish', run_rate_limit_per_hour: 12 } },
  });
  const setRateLimitPayload = parseToolText(setRateLimit);
  log('studio_set_app_rate_limit stores per-app cap', setRateLimitPayload?.ok === true && db.prepare(`SELECT run_rate_limit_per_hour FROM apps WHERE slug = 'agent-studio-publish'`).get().run_rate_limit_per_hour === 12, setRateLimit.text);

  const getRateLimit = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 49,
    method: 'tools/call',
    params: { name: 'studio_get_app_rate_limit', arguments: { slug: 'agent-studio-publish' } },
  });
  const getRateLimitPayload = parseToolText(getRateLimit);
  log('studio_get_app_rate_limit returns stored cap', getRateLimitPayload?.run_rate_limit_per_hour === 12, getRateLimit.text);

  const readAccountCall = await callMcp(server.port, readToken, {
    jsonrpc: '2.0',
    id: 22,
    method: 'tools/call',
    params: { name: 'account_get', arguments: {} },
  });
  log('read token cannot call account tools because they are not exposed', Boolean(readAccountCall.json?.error) || readAccountCall.json?.result?.isError === true, readAccountCall.text);

  const accountSetSecret = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 23,
    method: 'tools/call',
    params: { name: 'account_set_secret', arguments: { key: 'TEST_API_KEY', value: 'secret-value' } },
  });
  const accountSetSecretPayload = parseToolText(accountSetSecret);
  log('account_set_secret stores workspace secret without echoing value', accountSetSecretPayload?.ok === true && !accountSetSecret.text.includes('secret-value'), accountSetSecret.text);

  const accountListSecrets = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 24,
    method: 'tools/call',
    params: { name: 'account_list_secrets', arguments: {} },
  });
  const accountListSecretsPayload = parseToolText(accountListSecrets);
  log('account_list_secrets returns masked key inventory', Boolean((accountListSecretsPayload?.entries || []).find((entry) => entry.key === 'TEST_API_KEY')), accountListSecrets.text);

  const accountSetUserContext = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 241,
    method: 'tools/call',
    params: { name: 'account_set_user_context', arguments: { profile: { name: 'Federico' } } },
  });
  const accountSetUserContextPayload = parseToolText(accountSetUserContext);
  log('account_set_user_context stores JSON profile', accountSetUserContextPayload?.ok === true && accountSetUserContextPayload?.user_profile?.name === 'Federico', accountSetUserContext.text);

  const accountSetSecretLikeUserContext = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 2411,
    method: 'tools/call',
    params: { name: 'account_set_user_context', arguments: { profile: { nested: { clientSecret: 'plaintext-secret' } } } },
  });
  log(
    'account_set_user_context rejects secret-shaped profile keys',
    accountSetSecretLikeUserContext.json?.result?.isError === true &&
      !accountSetSecretLikeUserContext.text.includes('plaintext-secret'),
    accountSetSecretLikeUserContext.text,
  );

  const accountSetWorkspaceContext = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 242,
    method: 'tools/call',
    params: { name: 'account_set_workspace_context', arguments: { profile: { company: { name: 'Floom' } } } },
  });
  const accountSetWorkspaceContextPayload = parseToolText(accountSetWorkspaceContext);
  log('account_set_workspace_context stores JSON profile', accountSetWorkspaceContextPayload?.ok === true && accountSetWorkspaceContextPayload?.workspace_profile?.company?.name === 'Floom', accountSetWorkspaceContext.text);

  const accountGetContext = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 243,
    method: 'tools/call',
    params: { name: 'account_get_context', arguments: {} },
  });
  const accountGetContextPayload = parseToolText(accountGetContext);
  log(
    'account_get_context returns user + workspace profiles',
    accountGetContextPayload?.user_profile?.name === 'Federico' &&
      accountGetContextPayload?.workspace_profile?.company?.name === 'Floom',
    accountGetContext.text,
  );

  const perAppContextManifest = {
    name: 'Agent Context App',
    description: 'Per-app MCP context fill fixture',
    runtime: 'python',
    manifest_version: '2.0',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    actions: {
      run: {
        label: 'Run',
        inputs: [
          { name: 'person', label: 'Person', type: 'text', required: true, context_path: 'user.name' },
          { name: 'company', label: 'Company', type: 'text', required: true, context_path: 'workspace.company.name' },
        ],
        outputs: [{ name: 'result', label: 'Result', type: 'json' }],
        secrets_needed: [],
      },
    },
  };
  const perAppContextSpec = {
    openapi: '3.0.0',
    info: { title: 'Agent Context App', version: '1.0.0' },
    servers: [{ url: `http://localhost:${server.port}` }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'run',
          parameters: [
            { name: 'person', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'company', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  };
  db.prepare(
    `INSERT INTO apps
       (id, slug, name, description, manifest, status, code_path, author, workspace_id,
        visibility, publish_status, app_type, base_url, openapi_spec_cached)
     VALUES ('app_context_mcp', 'agent-context-app', 'Agent Context App',
       'Per-app MCP context fill fixture', ?, 'active', '', 'local', 'local',
       'private', 'published', 'proxied', ?, ?)`,
  ).run(
    JSON.stringify(perAppContextManifest),
    `http://localhost:${server.port}`,
    JSON.stringify(perAppContextSpec),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  const agentContextCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 2451,
    method: 'tools/call',
    params: { name: 'run_app', arguments: { slug: 'agent-context-app', use_context: true } },
  });
  const agentContextPayload = parseToolText(agentContextCall);
  const agentContextRun = db
    .prepare(`SELECT inputs, status FROM runs WHERE id = ?`)
    .get(agentContextPayload?.run_id || '');
  const agentContextInputs = agentContextRun?.inputs ? JSON.parse(agentContextRun.inputs) : {};
  log(
    'run_app use_context fills context-backed required inputs',
    agentContextPayload?.status === 'success' &&
      agentContextRun?.status === 'success' &&
      agentContextInputs.person === 'Federico' &&
      agentContextInputs.company === 'Floom',
    agentContextCall.text,
  );
  const perAppContextCall = await callMcpAt(server.port, '/mcp/app/agent-context-app', writeToken, {
    jsonrpc: '2.0',
    id: 246,
    method: 'tools/call',
    params: { name: 'agent_context_app', arguments: { _use_context: true } },
  });
  const perAppContextRun = db
    .prepare(`SELECT inputs, status FROM runs WHERE app_id = 'app_context_mcp' ORDER BY started_at DESC LIMIT 1`)
    .get();
  const perAppContextInputs = perAppContextRun?.inputs ? JSON.parse(perAppContextRun.inputs) : {};
  log(
    'per-app MCP _use_context fills context-backed required inputs',
    perAppContextRun?.status === 'success' &&
      perAppContextInputs.person === 'Federico' &&
      perAppContextInputs.company === 'Floom' &&
      !perAppContextCall.text.includes('Input validation error'),
    perAppContextCall.text,
  );

  const viewerSetSecret = await callMcp(server.port, viewerWriteToken, {
    jsonrpc: '2.0',
    id: 244,
    method: 'tools/call',
    params: { name: 'account_set_secret', arguments: { key: 'VIEWER_KEY', value: 'viewer-secret' } },
  });
  log(
    'viewer read-write token cannot write workspace secrets',
    viewerSetSecret.json?.result?.isError === true && !viewerSetSecret.text.includes('viewer-secret'),
    viewerSetSecret.text,
  );

  const viewerSetWorkspaceContext = await callMcp(server.port, viewerWriteToken, {
    jsonrpc: '2.0',
    id: 245,
    method: 'tools/call',
    params: { name: 'account_set_workspace_context', arguments: { profile: { company: { name: 'ViewerCorp' } } } },
  });
  log(
    'viewer read-write token cannot write workspace context',
    viewerSetWorkspaceContext.json?.result?.isError === true &&
      !viewerSetWorkspaceContext.text.includes('ViewerCorp'),
    viewerSetWorkspaceContext.text,
  );

  const accountDeleteSecret = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 25,
    method: 'tools/call',
    params: { name: 'account_delete_secret', arguments: { key: 'TEST_API_KEY' } },
  });
  const accountDeleteSecretPayload = parseToolText(accountDeleteSecret);
  log('account_delete_secret removes workspace secret', accountDeleteSecretPayload?.ok === true && accountDeleteSecretPayload?.removed === true, accountDeleteSecret.text);

  log(
    'read-write token does not expose agent-token governance tools',
    !writeNames.includes('account_create_agent_token') &&
      !writeNames.includes('account_list_agent_tokens') &&
      !writeNames.includes('account_revoke_agent_token'),
    JSON.stringify(writeNames),
  );

  const accountCreateToken = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 26,
    method: 'tools/call',
    params: {
      name: 'account_create_agent_token',
      arguments: { label: 'mcp child token', scope: 'read', rate_limit_per_minute: 77 },
    },
  });
  log(
    'account_create_agent_token is not callable via agent-token MCP auth',
    accountCreateToken.json?.error?.code === -32602 ||
      accountCreateToken.json?.error?.code === -32601 ||
      /not found|Unknown tool|not registered/i.test(accountCreateToken.text),
    accountCreateToken.text,
  );

  const accountListTokens = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 27,
    method: 'tools/call',
    params: { name: 'account_list_agent_tokens', arguments: {} },
  });
  log(
    'account_list_agent_tokens is not callable via agent-token MCP auth',
    accountListTokens.json?.error?.code === -32602 ||
      accountListTokens.json?.error?.code === -32601 ||
      /not found|Unknown tool|not registered/i.test(accountListTokens.text),
    accountListTokens.text,
  );

  const accountRevokeToken = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 28,
    method: 'tools/call',
    params: { name: 'account_revoke_agent_token', arguments: { token_id: 'agtok_missing' } },
  });
  log(
    'account_revoke_agent_token is not callable via agent-token MCP auth',
    accountRevokeToken.json?.error?.code === -32602 ||
      accountRevokeToken.json?.error?.code === -32601 ||
      /not found|Unknown tool|not registered/i.test(accountRevokeToken.text),
    accountRevokeToken.text,
  );

  const initialSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 29,
    method: 'tools/call',
    params: { name: 'studio_get_app_sharing', arguments: { slug: 'agent-studio-publish' } },
  });
  const initialSharingPayload = parseToolText(initialSharing);
  log('studio_get_app_sharing starts private without link token', initialSharingPayload?.visibility === 'private' && initialSharingPayload?.link_share_token === null, initialSharing.text);

  const linkSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'link' } },
  });
  const linkSharingPayload = parseToolText(linkSharing);
  log('studio_set_app_sharing enables link sharing with link URL', linkSharingPayload?.visibility === 'link' && typeof linkSharingPayload?.link_share_token === 'string' && linkSharingPayload?.link_url?.includes('/p/agent-studio-publish?key='), linkSharing.text);

  const rotatedSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'link', rotate_link_token: true } },
  });
  const rotatedSharingPayload = parseToolText(rotatedSharing);
  log('studio_set_app_sharing rotates link token', rotatedSharingPayload?.visibility === 'link' && rotatedSharingPayload?.link_share_token !== linkSharingPayload?.link_share_token, rotatedSharing.text);

  const invitedSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 311,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'invited' } },
  });
  const invitedSharingPayload = parseToolText(invitedSharing);
  log('studio_set_app_sharing moves link app to invited', invitedSharingPayload?.visibility === 'invited' && invitedSharingPayload?.link_share_token === null, invitedSharing.text);

  const relinkedSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 312,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'link' } },
  });
  const relinkedSharingPayload = parseToolText(relinkedSharing);
  log('studio_set_app_sharing moves invited app back to link', relinkedSharingPayload?.visibility === 'link' && typeof relinkedSharingPayload?.link_share_token === 'string', relinkedSharing.text);

  const privateSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'private' } },
  });
  const privateSharingPayload = parseToolText(privateSharing);
  log('studio_set_app_sharing returns app to private', privateSharingPayload?.visibility === 'private' && privateSharingPayload?.link_share_token === null, privateSharing.text);

  const submitReview = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 33,
    method: 'tools/call',
    params: { name: 'studio_submit_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const submitReviewPayload = parseToolText(submitReview);
  log('studio_submit_app_review moves private app to pending_review', submitReviewPayload?.ok === true && submitReviewPayload?.visibility === 'pending_review', submitReview.text);

  const submitReviewAgain = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 331,
    method: 'tools/call',
    params: { name: 'studio_submit_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const submitReviewAgainPayload = parseToolText(submitReviewAgain);
  log('studio_submit_app_review is idempotent while pending', submitReviewAgainPayload?.ok === true && submitReviewAgainPayload?.visibility === 'pending_review', submitReviewAgain.text);

  const withdrawReview = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 34,
    method: 'tools/call',
    params: { name: 'studio_withdraw_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const withdrawReviewPayload = parseToolText(withdrawReview);
  log('studio_withdraw_app_review returns pending app to private', withdrawReviewPayload?.ok === true && withdrawReviewPayload?.visibility === 'private', withdrawReview.text);

  const invalidWithdrawReview = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 345,
    method: 'tools/call',
    params: { name: 'studio_withdraw_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const invalidWithdrawReviewPayload = parseToolText(invalidWithdrawReview);
  log(
    'studio_withdraw_app_review maps illegal transition to 409 tool error',
    invalidWithdrawReview.json?.result?.isError === true &&
      invalidWithdrawReviewPayload?.status === 409 &&
      invalidWithdrawReviewPayload?.code === 'illegal_transition',
    invalidWithdrawReview.text,
  );

  const secretPolicies = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 35,
    method: 'tools/call',
    params: { name: 'studio_list_secret_policies', arguments: { slug: 'agent-studio-publish' } },
  });
  const secretPoliciesPayload = parseToolText(secretPolicies);
  log('studio_list_secret_policies includes declared api_key', Boolean((secretPoliciesPayload?.policies || []).find((policy) => policy.key === 'api_key' && policy.policy === 'user_vault')), secretPolicies.text);

  const setPolicy = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 36,
    method: 'tools/call',
    params: { name: 'studio_set_secret_policy', arguments: { slug: 'agent-studio-publish', key: 'api_key', policy: 'creator_override' } },
  });
  const setPolicyPayload = parseToolText(setPolicy);
  log('studio_set_secret_policy enables creator override', setPolicyPayload?.ok === true && setPolicyPayload?.policy === 'creator_override', setPolicy.text);

  const setCreatorSecret = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 37,
    method: 'tools/call',
    params: { name: 'studio_set_creator_secret', arguments: { slug: 'agent-studio-publish', key: 'api_key', value: 'creator-secret-value' } },
  });
  const setCreatorSecretPayload = parseToolText(setCreatorSecret);
  log('studio_set_creator_secret stores write-only creator secret', setCreatorSecretPayload?.ok === true && !setCreatorSecret.text.includes('creator-secret-value'), setCreatorSecret.text);

  db.prepare(
    `INSERT INTO app_secret_policies (app_id, key, policy, updated_at)
     VALUES (?, 'stale_key', 'creator_override', datetime('now'))`,
  ).run(publishedRow.id);
  const staleCreatorSecret = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 38,
    method: 'tools/call',
    params: { name: 'studio_set_creator_secret', arguments: { slug: 'agent-studio-publish', key: 'stale_key', value: 'stale-secret' } },
  });
  const staleCreatorSecretPayload = parseToolText(staleCreatorSecret);
  log('studio_set_creator_secret rejects stale undeclared policy keys', staleCreatorSecret.json?.result?.isError === true && staleCreatorSecretPayload?.error === 'invalid_input' && !staleCreatorSecret.text.includes('stale-secret'), staleCreatorSecret.text);

  const deleteCreatorSecret = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 39,
    method: 'tools/call',
    params: { name: 'studio_delete_creator_secret', arguments: { slug: 'agent-studio-publish', key: 'api_key' } },
  });
  const deleteCreatorSecretPayload = parseToolText(deleteCreatorSecret);
  log('studio_delete_creator_secret removes creator secret', deleteCreatorSecretPayload?.ok === true && deleteCreatorSecretPayload?.removed === true, deleteCreatorSecret.text);

  const updateApp = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 40,
    method: 'tools/call',
    params: { name: 'studio_update_app', arguments: { slug: 'agent-studio-publish', primary_action: 'echo' } },
  });
  const updateAppPayload = parseToolText(updateApp);
  const updatedManifest = JSON.parse(db.prepare('SELECT manifest FROM apps WHERE slug = ?').get('agent-studio-publish').manifest);
  log('studio_update_app pins a valid primary action', updateAppPayload?.ok === true && updatedManifest.primary_action === 'echo', updateApp.text);

  const invalidUpdateApp = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: { name: 'studio_update_app', arguments: { slug: 'agent-studio-publish', primary_action: 'missingAction' } },
  });
  const invalidUpdateAppPayload = parseToolText(invalidUpdateApp);
  log('studio_update_app rejects invalid primary action', invalidUpdateApp.json?.result?.isError === true && invalidUpdateAppPayload?.error === 'invalid_input', invalidUpdateApp.text);

  const deleteAppWithoutConfirm = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: { name: 'studio_delete_app', arguments: { slug: 'agent-studio-publish', confirm: false } },
  });
  log('studio_delete_app rejects missing confirm=true at schema layer', Boolean(deleteAppWithoutConfirm.json?.error) || deleteAppWithoutConfirm.json?.result?.isError === true, deleteAppWithoutConfirm.text);

  const deleteApp = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 43,
    method: 'tools/call',
    params: { name: 'studio_delete_app', arguments: { slug: 'agent-studio-publish', confirm: true } },
  });
  const deleteAppPayload = parseToolText(deleteApp);
  const deletedRow = db.prepare('SELECT * FROM apps WHERE slug = ?').get('agent-studio-publish');
  const deleteAudit = db.prepare(`SELECT * FROM audit_log WHERE action = 'app.deleted' AND target_id = ?`).get(publishedRow.id);
  log('studio_delete_app deletes owned app with confirm=true', deleteAppPayload?.ok === true && !deletedRow, deleteApp.text);
  log('studio_delete_app writes app.deleted audit log', Boolean(deleteAudit), JSON.stringify(deleteAudit));
} finally {
  await stopServer(server);
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
