'use strict';

const { providerFetch } = require('./http');

const DEFAULT_SUPABASE_API_URL = 'https://api.supabase.com';

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`invalid SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function sqlType(value) {
  const type = String(value || 'text').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*(\([0-9]+(,\s*[0-9]+)?\))?$/.test(type)) {
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

function renderMigrationSql(tables) {
  return (tables || [])
    .map((table) => {
      if (!table || !table.name) throw new Error('runtime.byo.database.tables entry is missing name');
      const columns = Array.isArray(table.columns) ? table.columns : [];
      if (columns.length === 0) throw new Error(`table ${table.name} has no columns`);
      const body = columns.map((column) => `  ${columnSql(column)}`).join(',\n');
      return `create table if not exists ${quoteIdent(table.name)} (\n${body}\n);`;
    })
    .join('\n\n');
}

function createSupabaseProvider({ token, baseUrl = process.env.FLOOM_BYO_SUPABASE_API_URL || DEFAULT_SUPABASE_API_URL } = {}) {
  return {
    async createProject(name) {
      const body = {
        name,
        organization_id: process.env.FLOOM_BYO_SUPABASE_ORG_ID || undefined,
        db_pass: process.env.FLOOM_BYO_SUPABASE_DB_PASSWORD || undefined,
        region: process.env.FLOOM_BYO_SUPABASE_REGION || undefined,
      };
      Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
      const { json } = await providerFetch(baseUrl, '/v1/projects', token, {
        method: 'POST',
        body,
        label: 'supabase create project',
      });
      return {
        id: String(json.id || json.project_id),
        url: String(json.url || json.api_url || json.endpoint || ''),
        anonKey: String(json.anonKey || json.anon_key || json.anon_key_jwt || ''),
        connectionString: json.connectionString || json.connection_string || json.database_url,
      };
    },

    async applyMigrations(projectId, manifestSchema) {
      const query = renderMigrationSql(manifestSchema || []);
      if (!query) return;
      await providerFetch(baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/database/query`, token, {
        method: 'POST',
        body: { query },
        label: 'supabase apply migrations',
      });
    },
  };
}

module.exports = {
  createSupabaseProvider,
  renderMigrationSql,
};
