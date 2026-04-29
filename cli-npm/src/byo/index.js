'use strict';

const path = require('path');
const readline = require('readline');
const { loadByoManifest } = require('./manifest');
const { oauthToken } = require('./oauth');
const { createSupabaseProvider } = require('./providers/supabase');
const { createVercelProvider } = require('./providers/vercel');
const { createE2BProvider } = require('./providers/e2b');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseArgs(args) {
  const opts = {
    repoDir: process.cwd(),
    yes: false,
    json: false,
    nonInteractive: false,
    gitRef: process.env.FLOOM_BYO_GIT_REF || 'main',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--non-interactive') opts.nonInteractive = true;
    else if (arg === '--git-ref' && args[i + 1]) opts.gitRef = args[++i];
    else if (arg.startsWith('--git-ref=')) opts.gitRef = arg.slice('--git-ref='.length);
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
    '  --git-ref <ref>       git ref passed to hosting provider (default: main)',
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

function actionPath(actions) {
  const first = Array.isArray(actions) && actions[0] && actions[0].name ? actions[0].name : '<action>';
  return `/api/${first}`;
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

  let dbProject = null;
  let template = null;
  let deployment = null;
  let hostingProject = null;

  if (byo.database) {
    if (byo.database.provider !== 'supabase') throw new Error('runtime.byo.database.provider must be supabase');
    if (await confirmProvider('Supabase', opts.yes)) {
      const token = await oauthToken('supabase', { nonInteractive: opts.nonInteractive });
      const supabase = createSupabaseProvider({ token: token.accessToken });
      const projectName = byo.database.project_name || `${loaded.slug}-floom-prod`;
      dbProject = await supabase.createProject(projectName);
      await supabase.applyMigrations(dbProject.id, Array.isArray(byo.database.tables) ? byo.database.tables : []);
      if (!opts.json) console.log(`  -> Supabase connected. Project: ${projectName}`);
    }
  }

  if (byo.sandbox) {
    if (byo.sandbox.provider !== 'e2b') throw new Error('runtime.byo.sandbox.provider must be e2b');
    if (await confirmProvider('E2B', opts.yes)) {
      const token = await oauthToken('e2b', { nonInteractive: opts.nonInteractive });
      const e2b = createE2BProvider({ token: token.accessToken });
      template = await e2b.createTemplate(byo.sandbox.image || byo.sandbox.template);
      if (!opts.json) console.log(`  -> E2B connected. Template: ${template.templateId}`);
    }
  }

  if (byo.hosting) {
    if (byo.hosting.provider !== 'vercel') throw new Error('runtime.byo.hosting.provider must be vercel');
    if (await confirmProvider('Vercel', opts.yes)) {
      const token = await oauthToken('vercel', { nonInteractive: opts.nonInteractive });
      const vercel = createVercelProvider({ token: token.accessToken });
      const projectName = byo.hosting.project_name || loaded.slug;
      hostingProject = await vercel.createProject(projectName, process.env.FLOOM_BYO_GITHUB_REPO || '');
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
    rest: web ? `POST ${web.replace(/\/$/, '')}${actionPath(loaded.actions)}` : '',
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
    console.log(`REST: ${result.rest}`);
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
