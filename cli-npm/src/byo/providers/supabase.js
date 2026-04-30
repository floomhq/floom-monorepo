'use strict';

const { providerFetch } = require('./http');

const DEFAULT_SUPABASE_API_URL = 'https://api.supabase.com';
const SQL_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?(\([0-9]+(,\s*[0-9]+)?\))?(\[\])?$/;

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`invalid SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function sqlType(value) {
  const type = String(value || 'text').trim().toLowerCase();
  if (!SQL_TYPE_RE.test(type)) {
    throw new Error(`invalid SQL column type: ${value}`);
  }
  return type;
}

function referenceSql(value) {
  const ref = String(value || '').trim();
  const match = ref.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
  if (!match) throw new Error(`invalid SQL reference: ${value}`);
  return `${quoteIdent(match[1])}(${quoteIdent(match[2])})`;
}

function sqlLiteral(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function columnSql(column) {
  const parts = [quoteIdent(column.name), sqlType(column.type)];
  if (column.primary_key) parts.push('primary key');
  if (column.nullable === false || column.required === true) parts.push('not null');
  if (column.default !== undefined) parts.push('default', sqlLiteral(column.default));
  if (column.references) parts.push('references', referenceSql(column.references));
  return parts.join(' ');
}

function hasWorkspaceId(columns) {
  return columns.some((column) => column && column.name === 'workspace_id');
}

function tablePredicate() {
  return '(workspace_id = (select active_workspace_id from user_profiles where id = auth.uid()))';
}

function policySql(tableName) {
  const table = quoteIdent(tableName);
  const predicate = tablePredicate();
  return [
    `alter table ${table} enable row level security;`,
    `drop policy if exists ${quoteIdent(`${tableName}_workspace_select`)} on ${table};`,
    `create policy ${quoteIdent(`${tableName}_workspace_select`)} on ${table} for select using ${predicate};`,
    `drop policy if exists ${quoteIdent(`${tableName}_workspace_insert`)} on ${table};`,
    `create policy ${quoteIdent(`${tableName}_workspace_insert`)} on ${table} for insert with check ${predicate};`,
    `drop policy if exists ${quoteIdent(`${tableName}_workspace_update`)} on ${table};`,
    `create policy ${quoteIdent(`${tableName}_workspace_update`)} on ${table} for update using ${predicate} with check ${predicate};`,
    `drop policy if exists ${quoteIdent(`${tableName}_workspace_delete`)} on ${table};`,
    `create policy ${quoteIdent(`${tableName}_workspace_delete`)} on ${table} for delete using ${predicate};`,
  ];
}

function renderMigrationSql(tables) {
  const statements = [
    'begin;',
    'create table if not exists user_profiles (id uuid primary key references auth.users(id) on delete cascade, active_workspace_id uuid);',
  ];

  for (const table of tables || []) {
    if (!table || !table.name) throw new Error('runtime.byo.database.tables entry is missing name');
    const columns = Array.isArray(table.columns) ? [...table.columns] : [];
    if (columns.length === 0) throw new Error(`table ${table.name} has no columns`);
    if (table.tenant_scope !== 'global' && !hasWorkspaceId(columns)) {
      columns.push({ name: 'workspace_id', type: 'uuid', nullable: false });
    }
    const body = columns.map((column) => `  ${columnSql(column)}`).join(',\n');
    statements.push(`create table if not exists ${quoteIdent(table.name)} (\n${body}\n);`);
    if (table.tenant_scope === 'global') {
      console.warn(`warning: runtime.byo.database.tables.${table.name} uses tenant_scope: global; RLS is disabled for this table`);
    } else {
      statements.push(...policySql(table.name));
    }
  }

  statements.push('commit;');
  return statements.join('\n\n');
}

function assertId(label, id, response, pattern = /^[A-Za-z0-9_.:-]+$/) {
  if (typeof id !== 'string' || !id || !pattern.test(id)) {
    throw new Error(`${label} response did not include a valid id: ${JSON.stringify(response)}`);
  }
  return id;
}

function normalizeProject(json) {
  const id = assertId('supabase create project', String(json.id || json.project_id || ''), json, /^[A-Za-z0-9_-]+$/);
  return {
    id,
    url: String(json.url || json.api_url || json.endpoint || ''),
    anonKey: String(json.anonKey || json.anon_key || json.anon_key_jwt || ''),
    connectionString: json.connectionString || json.connection_string || json.database_url,
  };
}

async function getProjectByName(baseUrl, token, name) {
  const { json } = await providerFetch(baseUrl, '/v1/projects', token, {
    method: 'GET',
    label: 'supabase list projects',
  });
  const projects = Array.isArray(json) ? json : (Array.isArray(json && json.projects) ? json.projects : []);
  const match = projects.find((project) => project && project.name === name);
  if (!match) throw new Error(`supabase project already exists but could not be found by name: ${name}`);
  return normalizeProject(match);
}

function createSupabaseProvider({ token, baseUrl = process.env.FLOOM_BYO_SUPABASE_API_URL || DEFAULT_SUPABASE_API_URL } = {}) {
  return {
    async createProject(name, options = {}) {
      const body = {
        name,
        organization_id: process.env.FLOOM_BYO_SUPABASE_ORG_ID || undefined,
        db_pass: process.env.FLOOM_BYO_SUPABASE_DB_PASSWORD || undefined,
        region: process.env.FLOOM_BYO_SUPABASE_REGION || undefined,
      };
      Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
      try {
        const { json } = await providerFetch(baseUrl, '/v1/projects', token, {
          method: 'POST',
          body,
          label: 'supabase create project',
        });
        return normalizeProject(json || {});
      } catch (err) {
        if (!options.forceRecreate && err.status === 409) {
          return getProjectByName(baseUrl, token, name);
        }
        throw err;
      }
    },

    async applyMigrations(projectId, manifestSchema) {
      const query = renderMigrationSql(manifestSchema || []);
      await providerFetch(baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/database/query`, token, {
        method: 'POST',
        body: { query },
        label: 'supabase apply migrations',
      });
    },

    async read() {
      throw new Error('Supabase BYO read() is reserved for Cloud Phase 2');
    },

    async write() {
      throw new Error('Supabase BYO write() is reserved for Cloud Phase 2');
    },

    async query() {
      throw new Error('Supabase BYO query() is reserved for Cloud Phase 2');
    },

    async transaction() {
      throw new Error('Supabase BYO transaction() is reserved for Cloud Phase 2');
    },

    async configureRLS() {
      throw new Error('Supabase BYO configureRLS() is reserved for Cloud Phase 2');
    },
  };
}

module.exports = {
  createSupabaseProvider,
  renderMigrationSql,
  sqlType,
};
