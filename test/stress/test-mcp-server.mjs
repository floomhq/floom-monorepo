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

function createToken(scope = 'read-write') {
  const raw = agentTokens.generateAgentToken();
  db.prepare(
    `INSERT INTO agent_tokens
       (id, prefix, hash, label, scope, workspace_id, user_id, created_at,
        last_used_at, revoked_at, rate_limit_per_minute)
     VALUES (?, ?, ?, ?, ?, 'local', 'local', ?, NULL, NULL, 1000)`,
  ).run(
    `agtok_${scope}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    agentTokens.extractAgentTokenPrefix(raw),
    agentTokens.hashAgentToken(raw),
    `test-${scope}`,
    scope,
    new Date().toISOString(),
  );
  db.pragma('wal_checkpoint(TRUNCATE)');
  return raw;
}

async function callMcp(port, token, body) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
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
    'create_job',
    'discover_apps',
    'feedback_submit',
    'get_app_quota',
    'get_app_about',
    'get_app_details',
    'get_app_skill',
    'get_app_source',
    'get_job',
    'get_run',
    'list_app_reviews',
    'list_my_runs',
    'run_app',
  ].sort();
  log('tools/list returns HTTP 200', readList.res.status === 200, readList.text);
  log('tools/list returns JSON-RPC 2.0', readList.json?.jsonrpc === '2.0', readList.text);
  log('read token /mcp exposes read/run/app-page tools', JSON.stringify(readNames) === JSON.stringify(readExpected), JSON.stringify(readNames));

  const writeList = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/list',
    params: {},
  });
  const writeNames = (writeList.json?.result?.tools || []).map((tool) => tool.name).sort();
  const writeExpected = [
    'account_create_agent_token',
    'account_delete_secret',
    'account_get',
    'account_list_agent_tokens',
    'account_list_secrets',
    'account_revoke_agent_token',
    'account_set_secret',
    'cancel_job',
    'create_job',
    'delete_run',
    'discover_apps',
    'feedback_submit',
    'get_app_quota',
    'get_app_about',
    'get_app_details',
    'get_app_skill',
    'get_app_source',
    'get_job',
    'get_run',
    'list_app_reviews',
    'list_my_runs',
    'leave_app_review',
    'run_app',
    'share_run',
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
    'studio_invite_app_user',
    'studio_revoke_app_invite',
    'studio_search_app_share_users',
    'studio_set_app_rate_limit',
    'studio_set_app_sharing',
    'studio_set_creator_secret',
    'studio_set_secret_policy',
    'studio_submit_app_review',
    'studio_uninstall_app',
    'studio_update_app',
    'studio_withdraw_app_review',
    'trigger_create',
    'trigger_delete',
    'trigger_list',
    'trigger_update',
    'workspace_accept_invite',
    'workspace_create',
    'workspace_create_invite',
    'workspace_delete',
    'workspace_delete_runs',
    'workspace_get',
    'workspace_list',
    'workspace_list_invites',
    'workspace_list_members',
    'workspace_remove_member',
    'workspace_revoke_invite',
    'workspace_set_member_role',
    'workspace_switch',
    'workspace_update',
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
    'feedback_submit',
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
    'studio_invite_app_user',
    'studio_revoke_app_invite',
    'studio_search_app_share_users',
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
  const shareRun = tools.find((tool) => tool.name === 'share_run');
  const deleteRun = tools.find((tool) => tool.name === 'delete_run');
  const createJobTool = tools.find((tool) => tool.name === 'create_job');
  const getJobTool = tools.find((tool) => tool.name === 'get_job');
  const cancelJobTool = tools.find((tool) => tool.name === 'cancel_job');
  const appQuota = tools.find((tool) => tool.name === 'get_app_quota');
  const feedbackSubmit = tools.find((tool) => tool.name === 'feedback_submit');
  const triggerCreate = tools.find((tool) => tool.name === 'trigger_create');
  const workspaceCreate = tools.find((tool) => tool.name === 'workspace_create');
  const publish = tools.find((tool) => tool.name === 'studio_publish_app');
  const appShareSearch = tools.find((tool) => tool.name === 'studio_search_app_share_users');
  const appInvite = tools.find((tool) => tool.name === 'studio_invite_app_user');
  const appInviteRevoke = tools.find((tool) => tool.name === 'studio_revoke_app_invite');
  log('discover_apps schema exposes q + category + limit + cursor', Boolean(discover?.inputSchema?.properties?.q) && Boolean(discover?.inputSchema?.properties?.category) && Boolean(discover?.inputSchema?.properties?.limit) && Boolean(discover?.inputSchema?.properties?.cursor));
  log('get_app_skill requires slug', Array.isArray(skill?.inputSchema?.required) && skill.inputSchema.required.includes('slug'));
  log('get_app_details requires slug', Array.isArray(detail?.inputSchema?.required) && detail.inputSchema.required.includes('slug'));
  log('get_app_source exposes include_openapi_spec', Boolean(source?.inputSchema?.properties?.include_openapi_spec));
  log('list_app_reviews exposes limit', Boolean(reviews?.inputSchema?.properties?.limit));
  log('run_app schema exposes slug + action + inputs', Boolean(run?.inputSchema?.properties?.slug) && Boolean(run?.inputSchema?.properties?.action) && Boolean(run?.inputSchema?.properties?.inputs));
  log('get_run requires run_id', Array.isArray(getRun?.inputSchema?.required) && getRun.inputSchema.required.includes('run_id'));
  log('list_my_runs schema exposes pagination args', Boolean(listRuns?.inputSchema?.properties?.limit) && Boolean(listRuns?.inputSchema?.properties?.cursor));
  log('share_run requires run_id', Array.isArray(shareRun?.inputSchema?.required) && shareRun.inputSchema.required.includes('run_id'));
  log('delete_run requires run_id', Array.isArray(deleteRun?.inputSchema?.required) && deleteRun.inputSchema.required.includes('run_id'));
  log('create_job schema exposes slug + action + inputs', Boolean(createJobTool?.inputSchema?.properties?.slug) && Boolean(createJobTool?.inputSchema?.properties?.action) && Boolean(createJobTool?.inputSchema?.properties?.inputs));
  log('get_job requires slug + job_id', Array.isArray(getJobTool?.inputSchema?.required) && getJobTool.inputSchema.required.includes('slug') && getJobTool.inputSchema.required.includes('job_id'));
  log('cancel_job requires slug + job_id', Array.isArray(cancelJobTool?.inputSchema?.required) && cancelJobTool.inputSchema.required.includes('slug') && cancelJobTool.inputSchema.required.includes('job_id'));
  log('get_app_quota requires slug', Array.isArray(appQuota?.inputSchema?.required) && appQuota.inputSchema.required.includes('slug'));
  log('feedback_submit requires text', Array.isArray(feedbackSubmit?.inputSchema?.required) && feedbackSubmit.inputSchema.required.includes('text'));
  log('trigger_create schema exposes slug + type + action', Boolean(triggerCreate?.inputSchema?.properties?.slug) && Boolean(triggerCreate?.inputSchema?.properties?.trigger_type) && Boolean(triggerCreate?.inputSchema?.properties?.action));
  log('workspace_create schema exposes name + slug', Boolean(workspaceCreate?.inputSchema?.properties?.name) && Boolean(workspaceCreate?.inputSchema?.properties?.slug));
  log('studio_publish_app schema exposes OpenAPI publish args', Boolean(publish?.inputSchema?.properties?.openapi_url) && Boolean(publish?.inputSchema?.properties?.openapi_spec) && Boolean(publish?.inputSchema?.properties?.visibility));
  log('studio_search_app_share_users requires slug + q', Array.isArray(appShareSearch?.inputSchema?.required) && appShareSearch.inputSchema.required.includes('slug') && appShareSearch.inputSchema.required.includes('q'));
  log('studio_invite_app_user exposes username/email invite inputs', Boolean(appInvite?.inputSchema?.properties?.username) && Boolean(appInvite?.inputSchema?.properties?.email));
  log('studio_revoke_app_invite requires slug + invite_id', Array.isArray(appInviteRevoke?.inputSchema?.required) && appInviteRevoke.inputSchema.required.includes('slug') && appInviteRevoke.inputSchema.required.includes('invite_id'));

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

  const runCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 118,
    method: 'tools/call',
    params: { name: 'run_app', arguments: { slug: 'agent-studio-publish', action: 'echo', inputs: { message: 'hello' } } },
  });
  const runPayload = parseToolText(runCall);
  log('run_app creates an owned run for run-management tools', typeof runPayload?.run_id === 'string', runCall.text);

  const shareRunCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 119,
    method: 'tools/call',
    params: { name: 'share_run', arguments: { run_id: runPayload?.run_id } },
  });
  const shareRunPayload = parseToolText(shareRunCall);
  log('share_run flips owned run public and returns URLs', shareRunPayload?.is_public === true && typeof shareRunPayload?.share_url === 'string', shareRunCall.text);

  const deleteRunCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 120,
    method: 'tools/call',
    params: { name: 'delete_run', arguments: { run_id: runPayload?.run_id } },
  });
  const deleteRunPayload = parseToolText(deleteRunCall);
  log('delete_run removes only an owned run', deleteRunPayload?.deleted_count === 1 && !db.prepare('SELECT id FROM runs WHERE id = ?').get(runPayload?.run_id), deleteRunCall.text);

  db.prepare(`UPDATE apps SET is_async = 1, async_mode = 'queued' WHERE slug = 'agent-studio-publish'`).run();

  const createJobCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 127,
    method: 'tools/call',
    params: { name: 'create_job', arguments: { slug: 'agent-studio-publish', action: 'echo', inputs: { message: 'async' } } },
  });
  const createJobPayload = parseToolText(createJobCall);
  log('create_job queues an owned async job', createJobPayload?.job?.status === 'queued' && createJobPayload?.job?.workspace_id === 'local' && createJobPayload?.job?.user_id === 'local', createJobCall.text);

  const getJobCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 128,
    method: 'tools/call',
    params: { name: 'get_job', arguments: { slug: 'agent-studio-publish', job_id: createJobPayload?.job?.id } },
  });
  const getJobPayload = parseToolText(getJobCall);
  log('get_job returns the owned queued job', getJobPayload?.id === createJobPayload?.job?.id && getJobPayload?.status === 'queued', getJobCall.text);

  const cancelJobCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 129,
    method: 'tools/call',
    params: { name: 'cancel_job', arguments: { slug: 'agent-studio-publish', job_id: createJobPayload?.job?.id } },
  });
  const cancelJobPayload = parseToolText(cancelJobCall);
  log('cancel_job cancels the owned queued job', cancelJobPayload?.id === createJobPayload?.job?.id && cancelJobPayload?.status === 'cancelled', cancelJobCall.text);

  const quotaCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 130,
    method: 'tools/call',
    params: { name: 'get_app_quota', arguments: { slug: 'agent-studio-publish' } },
  });
  const quotaPayload = parseToolText(quotaCall);
  log('get_app_quota returns BYOK/rate-limit decision payload', quotaPayload?.slug === 'agent-studio-publish' && typeof quotaPayload?.byok_required === 'boolean' && quotaPayload?.rate_limit, quotaCall.text);

  const feedbackCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 131,
    method: 'tools/call',
    params: { name: 'feedback_submit', arguments: { text: 'Headless feedback path', email: 'agent@example.com', url: `http://localhost:${server.port}/p/agent-studio-publish` } },
  });
  const feedbackPayload = parseToolText(feedbackCall);
  log('feedback_submit stores feedback with workspace context', feedbackPayload?.ok === true && db.prepare('SELECT workspace_id, user_id FROM feedback WHERE id = ?').get(feedbackPayload.id)?.workspace_id === 'local', feedbackCall.text);

  const triggerCreateCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 132,
    method: 'tools/call',
    params: { name: 'trigger_create', arguments: { slug: 'agent-studio-publish', action: 'echo', trigger_type: 'webhook', inputs: { message: 'webhook' } } },
  });
  const triggerCreatePayload = parseToolText(triggerCreateCall);
  log('trigger_create creates owned webhook trigger and returns one-time secret', triggerCreatePayload?.trigger?.trigger_type === 'webhook' && typeof triggerCreatePayload?.webhook_secret === 'string' && typeof triggerCreatePayload?.webhook_url === 'string', triggerCreateCall.text);

  const triggerListCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 133,
    method: 'tools/call',
    params: { name: 'trigger_list', arguments: {} },
  });
  const triggerListPayload = parseToolText(triggerListCall);
  log('trigger_list returns owned trigger with app slug', Boolean((triggerListPayload?.triggers || []).find((trigger) => trigger.id === triggerCreatePayload?.trigger?.id && trigger.app_slug === 'agent-studio-publish')), triggerListCall.text);

  const triggerUpdateCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 134,
    method: 'tools/call',
    params: { name: 'trigger_update', arguments: { trigger_id: triggerCreatePayload?.trigger?.id, enabled: false } },
  });
  const triggerUpdatePayload = parseToolText(triggerUpdateCall);
  log('trigger_update disables owned trigger', triggerUpdatePayload?.trigger?.enabled === false, triggerUpdateCall.text);

  const triggerDeleteCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 135,
    method: 'tools/call',
    params: { name: 'trigger_delete', arguments: { trigger_id: triggerCreatePayload?.trigger?.id } },
  });
  const triggerDeletePayload = parseToolText(triggerDeleteCall);
  log('trigger_delete removes owned trigger', triggerDeletePayload?.deleted === true && !db.prepare('SELECT id FROM triggers WHERE id = ?').get(triggerCreatePayload?.trigger?.id), triggerDeleteCall.text);

  const workspaceListCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 136,
    method: 'tools/call',
    params: { name: 'workspace_list', arguments: {} },
  });
  const workspaceListPayload = parseToolText(workspaceListCall);
  log('workspace_list returns local workspace without wrapped_dek', Boolean((workspaceListPayload?.workspaces || []).find((workspace) => workspace.id === 'local' && !('wrapped_dek' in workspace))), workspaceListCall.text);

  const workspaceCreateCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 137,
    method: 'tools/call',
    params: { name: 'workspace_create', arguments: { name: 'Agent Workspace', slug: 'agent-workspace' } },
  });
  const workspaceCreatePayload = parseToolText(workspaceCreateCall);
  const workspaceId = workspaceCreatePayload?.workspace?.id;
  log('workspace_create creates admin membership for token user', typeof workspaceId === 'string' && db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, 'local')?.role === 'admin', workspaceCreateCall.text);

  const workspaceUpdateCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 138,
    method: 'tools/call',
    params: { name: 'workspace_update', arguments: { workspace_id: workspaceId, name: 'Agent Workspace Updated' } },
  });
  const workspaceUpdatePayload = parseToolText(workspaceUpdateCall);
  log('workspace_update changes owned workspace metadata', workspaceUpdatePayload?.workspace?.name === 'Agent Workspace Updated', workspaceUpdateCall.text);

  const workspaceMembersCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 139,
    method: 'tools/call',
    params: { name: 'workspace_list_members', arguments: { workspace_id: workspaceId } },
  });
  const workspaceMembersPayload = parseToolText(workspaceMembersCall);
  log('workspace_list_members returns token user membership', Boolean((workspaceMembersPayload?.members || []).find((member) => member.user_id === 'local' && member.role === 'admin')), workspaceMembersCall.text);

  const workspaceInviteCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 140,
    method: 'tools/call',
    params: { name: 'workspace_create_invite', arguments: { workspace_id: workspaceId, email: 'invitee@example.com', role: 'viewer' } },
  });
  const workspaceInvitePayload = parseToolText(workspaceInviteCall);
  log('workspace_create_invite creates pending invite with accept URL', workspaceInvitePayload?.invite?.email === 'invitee@example.com' && typeof workspaceInvitePayload?.accept_url === 'string', workspaceInviteCall.text);

  const workspaceInvitesCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 141,
    method: 'tools/call',
    params: { name: 'workspace_list_invites', arguments: { workspace_id: workspaceId } },
  });
  const workspaceInvitesPayload = parseToolText(workspaceInvitesCall);
  log('workspace_list_invites returns created invite', Boolean((workspaceInvitesPayload?.invites || []).find((invite) => invite.id === workspaceInvitePayload?.invite?.id)), workspaceInvitesCall.text);

  const workspaceRevokeCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 142,
    method: 'tools/call',
    params: { name: 'workspace_revoke_invite', arguments: { workspace_id: workspaceId, invite_id: workspaceInvitePayload?.invite?.id } },
  });
  const workspaceRevokePayload = parseToolText(workspaceRevokeCall);
  log('workspace_revoke_invite revokes invite', workspaceRevokePayload?.revoked === true && db.prepare('SELECT status FROM workspace_invites WHERE id = ?').get(workspaceInvitePayload?.invite?.id)?.status === 'revoked', workspaceRevokeCall.text);

  const workspaceDeleteRunsCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 143,
    method: 'tools/call',
    params: { name: 'workspace_delete_runs', arguments: { workspace_id: workspaceId, confirm: true } },
  });
  const workspaceDeleteRunsPayload = parseToolText(workspaceDeleteRunsCall);
  log('workspace_delete_runs returns deletion count for owned workspace', workspaceDeleteRunsPayload?.ok === true && typeof workspaceDeleteRunsPayload?.deleted_count === 'number', workspaceDeleteRunsCall.text);

  const workspaceDeleteCall = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 144,
    method: 'tools/call',
    params: { name: 'workspace_delete', arguments: { workspace_id: workspaceId, confirm: true } },
  });
  const workspaceDeletePayload = parseToolText(workspaceDeleteCall);
  log('workspace_delete removes owned workspace with confirm=true', workspaceDeletePayload?.deleted === true && !db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId), workspaceDeleteCall.text);

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

  const accountDeleteSecret = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 25,
    method: 'tools/call',
    params: { name: 'account_delete_secret', arguments: { key: 'TEST_API_KEY' } },
  });
  const accountDeleteSecretPayload = parseToolText(accountDeleteSecret);
  log('account_delete_secret removes workspace secret', accountDeleteSecretPayload?.ok === true && accountDeleteSecretPayload?.removed === true, accountDeleteSecret.text);

  const accountCreateToken = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 26,
    method: 'tools/call',
    params: {
      name: 'account_create_agent_token',
      arguments: { label: 'mcp child token', scope: 'read', rate_limit_per_minute: 77 },
    },
  });
  const accountCreateTokenPayload = parseToolText(accountCreateToken);
  log('account_create_agent_token returns raw token once', typeof accountCreateTokenPayload?.raw_token === 'string' && accountCreateTokenPayload.raw_token.startsWith('floom_agent_'), accountCreateToken.text);
  log('account_create_agent_token does not leak hash material', accountCreateTokenPayload && !('hash' in accountCreateTokenPayload) && !accountCreateToken.text.includes(agentTokens.hashAgentToken(accountCreateTokenPayload.raw_token || '')), accountCreateToken.text);

  const accountListTokens = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 27,
    method: 'tools/call',
    params: { name: 'account_list_agent_tokens', arguments: {} },
  });
  const accountListTokensPayload = parseToolText(accountListTokens);
  const childTokenListRow = (accountListTokensPayload?.tokens || []).find((token) => token.id === accountCreateTokenPayload?.id);
  log('account_list_agent_tokens returns child token metadata', Boolean(childTokenListRow) && childTokenListRow.rate_limit_per_minute === 77, accountListTokens.text);
  log('account_list_agent_tokens never returns raw token or hash', Boolean(childTokenListRow) && !('raw_token' in childTokenListRow) && !('hash' in childTokenListRow), accountListTokens.text);

  const accountRevokeToken = await callMcp(server.port, writeToken, {
    jsonrpc: '2.0',
    id: 28,
    method: 'tools/call',
    params: { name: 'account_revoke_agent_token', arguments: { token_id: accountCreateTokenPayload?.id } },
  });
  const accountRevokeTokenPayload = parseToolText(accountRevokeToken);
  log('account_revoke_agent_token revokes workspace child token', accountRevokeTokenPayload?.ok === true && accountRevokeTokenPayload?.revoked === true, accountRevokeToken.text);

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

  const privateSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'private' } },
  });
  const privateSharingPayload = parseToolText(privateSharing);
  log('studio_set_app_sharing returns app to private', privateSharingPayload?.visibility === 'private' && privateSharingPayload?.link_share_token === null, privateSharing.text);

  db.prepare(
    `INSERT OR REPLACE INTO users (id, workspace_id, email, name, auth_provider, auth_subject)
     VALUES ('sharee_user', 'local', 'sharee@example.com', 'Sharee User', 'test', 'sharee-user')`,
  ).run();

  const shareUserSearch = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 321,
    method: 'tools/call',
    params: { name: 'studio_search_app_share_users', arguments: { slug: 'agent-studio-publish', q: 'sharee' } },
  });
  const shareUserSearchPayload = parseToolText(shareUserSearch);
  log('studio_search_app_share_users returns registered users for owned app', Boolean((shareUserSearchPayload?.users || []).find((user) => user.id === 'sharee_user' && user.email === 'sharee@example.com')), shareUserSearch.text);

  const appInviteCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 322,
    method: 'tools/call',
    params: { name: 'studio_invite_app_user', arguments: { slug: 'agent-studio-publish', email: 'sharee@example.com' } },
  });
  const appInvitePayload = parseToolText(appInviteCall);
  log('studio_invite_app_user creates pending app invite and switches private app to invited', appInvitePayload?.invite?.invited_user_id === 'sharee_user' && appInvitePayload?.invite?.state === 'pending_accept' && appInvitePayload?.visibility === 'invited', appInviteCall.text);
  log('studio_invite_app_user does not return plaintext accept token', appInvitePayload && !appInviteCall.text.includes('/login?invite_id=') && !('accept_url' in appInvitePayload), appInviteCall.text);

  const appInviteSharing = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 323,
    method: 'tools/call',
    params: { name: 'studio_get_app_sharing', arguments: { slug: 'agent-studio-publish' } },
  });
  const appInviteSharingPayload = parseToolText(appInviteSharing);
  log('studio_get_app_sharing lists MCP-created app invite', Boolean((appInviteSharingPayload?.invites || []).find((invite) => invite.id === appInvitePayload?.invite?.id && invite.invited_user_email === 'sharee@example.com')), appInviteSharing.text);

  const appInviteRevokeCall = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 324,
    method: 'tools/call',
    params: { name: 'studio_revoke_app_invite', arguments: { slug: 'agent-studio-publish', invite_id: appInvitePayload?.invite?.id } },
  });
  const appInviteRevokePayload = parseToolText(appInviteRevokeCall);
  log('studio_revoke_app_invite revokes app invite', appInviteRevokePayload?.revoked === true && db.prepare('SELECT state FROM app_invites WHERE id = ?').get(appInvitePayload?.invite?.id)?.state === 'revoked', appInviteRevokeCall.text);

  const privateAfterInvite = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 325,
    method: 'tools/call',
    params: { name: 'studio_set_app_sharing', arguments: { slug: 'agent-studio-publish', state: 'private' } },
  });
  const privateAfterInvitePayload = parseToolText(privateAfterInvite);
  log('studio_set_app_sharing returns invited app to private after invite tests', privateAfterInvitePayload?.visibility === 'private', privateAfterInvite.text);

  const submitReview = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 33,
    method: 'tools/call',
    params: { name: 'studio_submit_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const submitReviewPayload = parseToolText(submitReview);
  log('studio_submit_app_review moves private app to pending_review', submitReviewPayload?.ok === true && submitReviewPayload?.visibility === 'pending_review', submitReview.text);

  const withdrawReview = await callMcp(server.port, publishToken, {
    jsonrpc: '2.0',
    id: 34,
    method: 'tools/call',
    params: { name: 'studio_withdraw_app_review', arguments: { slug: 'agent-studio-publish' } },
  });
  const withdrawReviewPayload = parseToolText(withdrawReview);
  log('studio_withdraw_app_review returns pending app to private', withdrawReviewPayload?.ok === true && withdrawReviewPayload?.visibility === 'private', withdrawReview.text);

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
