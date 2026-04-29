'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const YAML = require('yaml');

const PROVIDER_NAMES = {
  database: 'supabase',
  hosting: 'vercel',
  sandbox: 'e2b',
};

const byoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    database: {
      type: 'object',
      additionalProperties: false,
      required: ['provider'],
      properties: {
        provider: { const: 'supabase' },
        project_name: { type: 'string', minLength: 1 },
        account: { type: 'string', minLength: 1 },
        tables: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'columns'],
            properties: {
              name: { type: 'string', minLength: 1 },
              tenant_scope: { enum: ['workspace', 'global'] },
              columns: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'type'],
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    type: { type: 'string', minLength: 1 },
                    primary_key: { type: 'boolean' },
                    nullable: { type: 'boolean' },
                    required: { type: 'boolean' },
                    default: { type: ['string', 'number', 'boolean', 'null'] },
                    references: { type: 'string', minLength: 1 },
                  },
                },
              },
            },
          },
        },
      },
    },
    hosting: {
      type: 'object',
      additionalProperties: false,
      required: ['provider'],
      properties: {
        provider: { const: 'vercel' },
        project_name: { type: 'string', minLength: 1 },
        account: { type: 'string', minLength: 1 },
        repo: {
          type: 'string',
          pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$',
        },
        build_command: { type: 'string', minLength: 1 },
        output_dir: { type: 'string', minLength: 1 },
      },
    },
    sandbox: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'template'],
      properties: {
        provider: { const: 'e2b' },
        account: { type: 'string', minLength: 1 },
        template: { type: 'string', minLength: 1 },
        image: { type: 'string', minLength: 1 },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateByo = ajv.compile(byoSchema);

function parseYamlSubset(source) {
  return YAML.parse(source) || {};
}

function slugify(value) {
  const normalized = String(value || 'app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = normalized.slice(0, 48) || 'app';
  if (normalized.length > 48) {
    console.warn(`warning: slug truncated to ${slug}`);
  }
  return slug;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function formatAjvError(error) {
  const field = error.instancePath ? `runtime.byo${error.instancePath}` : 'runtime.byo';
  if (error.keyword === 'additionalProperties') {
    return `${field} has unsupported field ${error.params.additionalProperty}`;
  }
  if (error.keyword === 'const') {
    return `${field} must be ${error.params.allowedValue}`;
  }
  return `${field} ${error.message}`;
}

function validateByoManifest(byo) {
  const ok = validateByo(byo);
  if (ok) return;
  const errors = (validateByo.errors || []).map(formatAjvError);
  throw new Error(`runtime.byo validation failed:\n- ${errors.join('\n- ')}`);
}

function loadByoManifest(repoDir) {
  const yamlPath = path.join(repoDir, 'floom.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`no floom.yaml in ${repoDir}`);
  }

  const source = fs.readFileSync(yamlPath, 'utf8');
  let manifest;
  try {
    manifest = parseYamlSubset(source);
  } catch (err) {
    throw new Error(`YAML parse error: ${err.message}`);
  }
  const runtime = manifest.runtime && typeof manifest.runtime === 'object' ? manifest.runtime : null;
  const byo = runtime && runtime.byo && typeof runtime.byo === 'object' ? runtime.byo : null;
  if (!byo) {
    throw new Error('runtime.byo is missing; use `floom deploy` for existing Floom Cloud manifests');
  }
  validateByoManifest(byo);

  const name = String(manifest.name || manifest.displayName || manifest.slug || 'app');
  const slug = slugify(manifest.slug || name);
  const actions = arrayOf(manifest.actions);
  const inputs = arrayOf(manifest.inputs);

  return {
    path: yamlPath,
    repoDir,
    source,
    manifest,
    byo,
    name,
    slug,
    actions,
    inputs,
  };
}

function persistProviderAccount(loaded, section, account) {
  const provider = PROVIDER_NAMES[section];
  if (!provider || !loaded || !loaded.path || !account) return;
  const doc = YAML.parseDocument(fs.readFileSync(loaded.path, 'utf8'));
  const runtime = doc.get('runtime', true) || {};
  if (!runtime.byo) runtime.byo = {};
  if (!runtime.byo[section]) runtime.byo[section] = { provider };
  runtime.byo[section].account = account;
  doc.set('runtime', runtime);
  fs.writeFileSync(loaded.path, String(doc), 'utf8');
  if (!loaded.byo[section]) loaded.byo[section] = { provider };
  loaded.byo[section].account = account;
}

module.exports = {
  loadByoManifest,
  parseYamlSubset,
  persistProviderAccount,
  slugify,
  validateByoManifest,
};
