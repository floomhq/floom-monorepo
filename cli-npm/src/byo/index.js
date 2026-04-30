'use strict';

const path = require('path');
const { loadByoManifest, persistProviderAccount } = require('./manifest');
const { oauthToken } = require('./oauth');
const { createSupabaseProvider } = require('./providers/supabase');
const { createVercelProvider } = require('./providers/vercel');
const { createE2BProvider } = require('./providers/e2b');
const { prompt } = require('./util');

const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parseArgs(args) {
  const opts = {
    repoDir: process.cwd(),
    yes: false,
    json: false,
    nonInteractive: false,
    dryRun: false,
    forceRecreate: false,
    gitRef: process.env.FLOOM_BYO_GIT_REF || 'main',
    repo: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--non-interactive') opts.nonInteractive = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force-recreate') opts.forceRecreate = true;
    else if (arg === '--git-ref' && args[i + 1]) opts.gitRef = args[++i];
    else if (arg.startsWith('--git-ref=')) opts.gitRef = arg.slice('--git-ref='.length);
    else if (arg === '--repo' && args[i + 1]) opts.repo = args[++i];
    else if (arg.startsWith('--repo=')) opts.repo = arg.slice('--repo='.length);
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else opts.repoDir = path.resolve(arg);
  }

  if (opts.yes || opts.json || !process.stdin.isTTY) opts.nonInteractive = true;
  return opts;
}

function printHelp() {
  console.log([
    'floom byo-deploy — deploy a repo using user-owned Supabase, Vercel, and E2B accounts.',
    '',
    'usage:',
    '  floom byo-deploy [repo-dir]',
    '  floom byo-deploy ./my-app --yes',
    '',
    'options:',
    '  --yes, -y             connect all providers declared in runtime.byo',
    '  --json                print machine-readable deployment result',
    '  --repo <org/name>     GitHub repo passed to hosting provider',
    '  --git-ref <ref>       git ref passed to hosting provider (default: main)',
    '  --dry-run             print planned provider actions without mutating providers',
    '  --force-recreate      do not reuse existing provider projects on 409 conflicts',
    '  --non-interactive     fail instead of prompting for OAuth/API-key input',
    '',
    'test/provider overrides:',
    '  FLOOM_BYO_SUPABASE_API_URL, FLOOM_BYO_VERCEL_API_URL, FLOOM_BYO_E2B_API_URL',
    '  FLOOM_BYO_SUPABASE_TOKEN, FLOOM_BYO_VERCEL_TOKEN, FLOOM_BYO_E2B_TOKEN',
  ].join('\n'));
}

async function confirmProvider(name, autoYes) {
  if (autoYes) return true;
  const answer = await prompt(`Connect ${name}? [y/n]: `);
  return /^y(es)?$/i.test(answer);
}

function collectSecretEnv(manifest, dbProject, templateId) {
  const vars = {};
  if (dbProject) {
    if (dbProject.url) vars.SUPABASE_URL = dbProject.url;
    if (dbProject.anonKey) vars.SUPABASE_ANON_KEY = dbProject.anonKey;
    if (dbProject.connectionString) vars.DATABASE_URL = dbProject.connectionString;
  }
  if (templateId) vars.E2B_TEMPLATE_ID = templateId;

  const secrets = Array.isArray(manifest.secrets) ? manifest.secrets : [];
  for (const key of secrets) {
    if (typeof key === 'string' && process.env[key] !== undefined) {
      vars[key] = process.env[key];
    }
  }
  return vars;
}

function missingSecretEnv(manifest) {
  const secrets = Array.isArray(manifest.secrets) ? manifest.secrets : [];
  return secrets.filter((key) => typeof key === 'string' && process.env[key] === undefined);
}

function actionPath(actions) {
  const names = (Array.isArray(actions) ? actions : [])
    .map((action) => action && action.name)
    .filter(Boolean);
  if (names.length === 0) return ['/api/<action>'];
  return names.map((name) => `/api/${name}`);
}

function resolveRepo(opts, byo) {
  const repo = opts.repo || (byo.hosting && byo.hosting.repo) || '';
  if (!repo) {
    throw new Error('runtime.byo.hosting.repo is required (or pass --repo <org/name>)');
  }
  if (!GITHUB_REPO_RE.test(repo)) {
    throw new Error('runtime.byo.hosting.repo must match <org/name>');
  }
  return repo;
}

async function resolveAccount(loaded, section, provider, opts) {
  const configured = loaded.byo[section] && loaded.byo[section].account;
  if (configured) return configured;
  const account = opts.nonInteractive ? 'default' : ((await prompt(`${provider} account label [default]: `)) || 'default');
  if (!opts.dryRun) persistProviderAccount(loaded, section, account);
  return account;
}

function dryRunResult(loaded, repo) {
  const actions = [];
  if (loaded.byo.database) {
    actions.push(`create/reuse Supabase project ${loaded.byo.database.project_name || `${loaded.slug}-floom-prod`}`);
    actions.push(`apply Supabase migrations for ${(loaded.byo.database.tables || []).length} tables`);
  }
  if (loaded.byo.sandbox) {
    actions.push(`create/reuse E2B template ${loaded.byo.sandbox.image || loaded.byo.sandbox.template}`);
  }
  if (loaded.byo.hosting) {
    actions.push(`create/reuse Vercel project ${loaded.byo.hosting.project_name || loaded.slug} from ${repo}`);
    actions.push(`deploy Vercel git ref`);
  }
  return { name: loaded.name, slug: loaded.slug, dryRun: true, actions };
}

async function runByoDeploy(args) {
  const opts = parseArgs(args);
  if (opts.help) {
    printHelp();
    return;
  }

  const loaded = loadByoManifest(opts.repoDir);
  const byo = loaded.byo;
  const summary = `ok (${loaded.actions.length} actions, ${loaded.inputs.length} inputs)`;
  if (!opts.json) console.log(`Reading floom.yaml... ${summary}`);

  const missing = missingSecretEnv(loaded.manifest);
  if (missing.length > 0) {
    throw new Error(`missing required env vars: ${missing.join(', ')}`);
  }

  const repo = byo.hosting ? resolveRepo(opts, byo) : '';
  if (opts.dryRun) {
    const planned = dryRunResult(loaded, repo);
    if (opts.json) {
      console.log(JSON.stringify(planned, null, 2));
    } else {
      console.log('Planned BYO actions:');
      for (const action of planned.actions) console.log(`  - ${action}`);
    }
    return planned;
  }

  let dbProject = null;
  let template = null;
  let deployment = null;
  let hostingProject = null;

  if (byo.database) {
    if (byo.database.provider !== 'supabase') throw new Error('runtime.byo.database.provider must be supabase');
    if (await confirmProvider('Supabase', opts.yes)) {
      const account = await resolveAccount(loaded, 'database', 'Supabase', opts);
      const token = await oauthToken('supabase', { nonInteractive: opts.nonInteractive, account });
      const supabase = createSupabaseProvider({ token: token.accessToken });
      const projectName = byo.database.project_name || `${loaded.slug}-floom-prod`;
      dbProject = await supabase.createProject(projectName, { forceRecreate: opts.forceRecreate });
      await supabase.applyMigrations(dbProject.id, Array.isArray(byo.database.tables) ? byo.database.tables : []);
      if (!opts.json) console.log(`  -> Supabase connected. Project: ${projectName}`);
    }
  }

  if (byo.sandbox) {
    if (byo.sandbox.provider !== 'e2b') throw new Error('runtime.byo.sandbox.provider must be e2b');
    if (await confirmProvider('E2B', opts.yes)) {
      const account = await resolveAccount(loaded, 'sandbox', 'E2B', opts);
      const token = await oauthToken('e2b', { nonInteractive: opts.nonInteractive, account });
      const e2b = createE2BProvider({ token: token.accessToken });
      template = await e2b.createTemplate(byo.sandbox.image || byo.sandbox.template);
      if (!opts.json) console.log(`  -> E2B connected. Template: ${template.templateId}`);
    }
  }

  if (byo.hosting) {
    if (byo.hosting.provider !== 'vercel') throw new Error('runtime.byo.hosting.provider must be vercel');
    if (await confirmProvider('Vercel', opts.yes)) {
      const account = await resolveAccount(loaded, 'hosting', 'Vercel', opts);
      const token = await oauthToken('vercel', { nonInteractive: opts.nonInteractive, account });
      const vercel = createVercelProvider({ token: token.accessToken });
      const projectName = byo.hosting.project_name || loaded.slug;
      hostingProject = await vercel.createProject(projectName, repo, byo.hosting, { forceRecreate: opts.forceRecreate });
      const env = collectSecretEnv(loaded.manifest, dbProject, template && template.templateId);
      await vercel.setEnv(hostingProject.id, env);
      deployment = await vercel.deploy(hostingProject.id, opts.gitRef);
      if (!opts.json) console.log(`  -> Vercel connected. Project: ${projectName}`);
    }
  }

  const web = deployment ? deployment.deploymentUrl : (hostingProject && hostingProject.url) || '';
  const result = {
    name: loaded.name,
    slug: loaded.slug,
    web,
    mcp: web ? `${web.replace(/\/$/, '')}/mcp` : '',
    rest: web ? actionPath(loaded.actions).map((apiPath) => `POST ${web.replace(/\/$/, '')}${apiPath}`) : [],
    cli: `floom run ${loaded.slug}`,
    stored: dbProject && dbProject.connectionString ? dbProject.connectionString : (dbProject && dbProject.url) || '',
    supabaseProjectId: dbProject && dbProject.id,
    vercelProjectId: hostingProject && hostingProject.id,
    e2bTemplateId: template && template.templateId,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (web) {
    console.log(`Web: ${result.web}`);
    console.log(`MCP: ${result.mcp}`);
    for (const rest of result.rest) console.log(`REST: ${rest}`);
    console.log(`CLI: ${result.cli}`);
  }
  if (result.stored) console.log(`Stored: ${result.stored}`);
  return result;
}

module.exports = {
  runByoDeploy,
  parseArgs,
  collectSecretEnv,
};
