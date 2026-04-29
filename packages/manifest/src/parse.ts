/**
 * Manifest parser + validator.
 *
 * Reads a YAML string (or file) and validates it into a Manifest. Returns
 * either the typed manifest or a list of validation errors. Never throws
 * on invalid input — the caller (e.g. deployFromGithub) needs the error
 * list to ship back to the user verbatim (H6 Scenario 2).
 */
import { parse as parseYaml } from 'yaml';
import type { Manifest, Input, InputType, Output, OutputType } from './schema.ts';
import type { ByoRuntimeConfig, TableColumnSchema, TableSchema } from '@floom/byo-providers';
import {
  ALLOWED_RUNTIMES,
  ALLOWED_INPUT_TYPES,
  ALLOWED_OUTPUT_TYPES,
  REQUIRED_FIELDS,
} from './schema.ts';

const MAX_ALLOWED_DOMAINS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseTableColumns(raw: unknown, path: string, errors: string[]): TableColumnSchema[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be a list`);
    return [];
  }

  const columns: TableColumnSchema[] = [];
  raw.forEach((entry, idx) => {
    if (!isRecord(entry)) {
      errors.push(`${path}[${idx}] must be a mapping`);
      return;
    }
    const name = optionalString(entry['name']);
    const type = optionalString(entry['type']);
    if (!name) errors.push(`${path}[${idx}].name must be a string`);
    if (!type) errors.push(`${path}[${idx}].type must be a string`);
    if (!name || !type) return;

    const column: TableColumnSchema = { name, type };
    if (typeof entry['primary_key'] === 'boolean') column.primary_key = entry['primary_key'];
    if (typeof entry['nullable'] === 'boolean') column.nullable = entry['nullable'];
    if (
      entry['default'] === null ||
      ['string', 'number', 'boolean'].includes(typeof entry['default'])
    ) {
      column.default = entry['default'] as string | number | boolean | null;
    }
    if (typeof entry['references'] === 'string') column.references = entry['references'];
    columns.push(column);
  });
  return columns;
}

function parseTables(raw: unknown, path: string, errors: string[]): TableSchema[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be a list`);
    return [];
  }

  const tables: TableSchema[] = [];
  raw.forEach((entry, idx) => {
    if (!isRecord(entry)) {
      errors.push(`${path}[${idx}] must be a mapping`);
      return;
    }
    const name = optionalString(entry['name']);
    if (!name) {
      errors.push(`${path}[${idx}].name must be a string`);
      return;
    }
    tables.push({
      name,
      columns: parseTableColumns(entry['columns'], `${path}[${idx}].columns`, errors),
    });
  });
  return tables;
}

function parseByoRuntime(raw: unknown, errors: string[]): ByoRuntimeConfig | undefined {
  if (!isRecord(raw) || !isRecord(raw['byo'])) return undefined;

  const byoRaw = raw['byo'];
  const byo: ByoRuntimeConfig = {};

  if (byoRaw['database'] !== undefined) {
    if (!isRecord(byoRaw['database'])) {
      errors.push('runtime.byo.database must be a mapping');
    } else {
      const db = byoRaw['database'];
      if (db['provider'] !== 'supabase') {
        errors.push('runtime.byo.database.provider must be supabase');
      } else {
        byo.database = {
          provider: 'supabase',
          project_name: optionalString(db['project_name']),
          tables: parseTables(db['tables'], 'runtime.byo.database.tables', errors),
        };
      }
    }
  }

  if (byoRaw['hosting'] !== undefined) {
    if (!isRecord(byoRaw['hosting'])) {
      errors.push('runtime.byo.hosting must be a mapping');
    } else {
      const hosting = byoRaw['hosting'];
      if (hosting['provider'] !== 'vercel') {
        errors.push('runtime.byo.hosting.provider must be vercel');
      } else {
        byo.hosting = {
          provider: 'vercel',
          project_name: optionalString(hosting['project_name']),
          build_command: optionalString(hosting['build_command']),
          output_dir: optionalString(hosting['output_dir']),
        };
      }
    }
  }

  if (byoRaw['sandbox'] !== undefined) {
    if (!isRecord(byoRaw['sandbox'])) {
      errors.push('runtime.byo.sandbox must be a mapping');
    } else {
      const sandbox = byoRaw['sandbox'];
      if (sandbox['provider'] !== 'e2b') {
        errors.push('runtime.byo.sandbox.provider must be e2b');
      } else {
        const template = optionalString(sandbox['template']);
        if (!template) {
          errors.push('runtime.byo.sandbox.template must be a string');
        } else {
          byo.sandbox = {
            provider: 'e2b',
            template,
            image: optionalString(sandbox['image']),
          };
        }
      }
    }
  }

  return byo;
}

function isIpLiteral(value: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(value) ||
    value === '::1' ||
    value.includes(':')
  );
}

function isValidDomain(value: string): boolean {
  if (value.length < 1 || value.length > 253 || value.includes('..')) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      !label.startsWith('-') &&
      !label.endsWith('-') &&
      /^[a-z0-9-]+$/i.test(label),
  );
}

function validateAllowedDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (normalized === '*') return 'network.allowed_domains cannot contain "*"';
  if (
    normalized.includes('/') ||
    normalized.includes('@') ||
    isIpLiteral(normalized)
  ) {
    return `network.allowed_domains entry "${value}" must be a domain name or "*.domain" glob`;
  }
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(2);
    return isValidDomain(suffix)
      ? null
      : `network.allowed_domains entry "${value}" is not a valid wildcard domain`;
  }
  if (normalized.includes('*')) {
    return `network.allowed_domains entry "${value}" must use the "*.domain" wildcard form`;
  }
  return isValidDomain(normalized)
    ? null
    : `network.allowed_domains entry "${value}" is not a valid domain`;
}

export interface ParseResult {
  ok: boolean;
  manifest?: Manifest;
  errors: string[];
}

export function parseManifest(yamlSource: string): ParseResult {
  const errors: string[] = [];
  let raw: unknown;

  try {
    raw = parseYaml(yamlSource);
  } catch (err) {
    return {
      ok: false,
      errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Manifest must be a YAML mapping (not a list or scalar)'] };
  }

  const obj = raw as Record<string, unknown>;

  const runtimeRaw = obj['runtime'];
  const byoRuntime = parseByoRuntime(runtimeRaw, errors);
  const isByoManifest = !!byoRuntime;

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (isByoManifest && field === 'run') continue;
    if (!(field in obj)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  // name
  const name = obj['name'];
  if (name !== undefined && typeof name !== 'string') {
    errors.push('name must be a string');
  }

  // runtime
  const runtime = runtimeRaw;
  if (runtime !== undefined) {
    if (isByoManifest) {
      // runtime.byo is normalized onto manifest.byo below while preserving the
      // legacy Manifest.runtime string contract for existing runtime callers.
    } else if (typeof runtime !== 'string' || !ALLOWED_RUNTIMES.includes(runtime as never)) {
      errors.push(
        `runtime must be one of: ${ALLOWED_RUNTIMES.join(', ')} (got ${JSON.stringify(runtime)})`,
      );
    }
  }

  // run
  const run = obj['run'];
  if (run !== undefined && typeof run !== 'string') {
    errors.push('run must be a string');
  }

  // inputs
  const inputs: Input[] = [];
  const inputsRaw = obj['inputs'];
  if (inputsRaw !== undefined) {
    if (!Array.isArray(inputsRaw)) {
      errors.push('inputs must be a list');
    } else {
      inputsRaw.forEach((entry, idx) => {
        if (!entry || typeof entry !== 'object') {
          errors.push(`inputs[${idx}] must be a mapping`);
          return;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e['name'] !== 'string') {
          errors.push(`inputs[${idx}].name must be a string`);
          return;
        }
        const type = e['type'] as string | undefined;
        if (type !== undefined && !ALLOWED_INPUT_TYPES.includes(type as never)) {
          errors.push(
            `inputs[${idx}].type must be one of: ${ALLOWED_INPUT_TYPES.join(', ')}`,
          );
          return;
        }
        const input: Input = {
          name: e['name'],
          type: (type ?? 'string') as InputType,
          required: e['required'] === true,
        };
        if (e['default'] !== undefined) input.default = e['default'];
        if (typeof e['label'] === 'string') input.label = e['label'];
        if (typeof e['description'] === 'string') input.description = e['description'];
        if (typeof e['placeholder'] === 'string') input.placeholder = e['placeholder'];
        if (typeof e['from'] === 'string' && ['argv', 'env', 'stdin'].includes(e['from'])) {
          input.from = e['from'] as 'argv' | 'env' | 'stdin';
        }
        inputs.push(input);
      });
    }
  }

  // outputs
  let output: Output | undefined;
  const outputsRaw = obj['outputs'];
  if (outputsRaw !== undefined) {
    if (!outputsRaw || typeof outputsRaw !== 'object' || Array.isArray(outputsRaw)) {
      errors.push('outputs must be a mapping like { type: stdout }');
    } else {
      const o = outputsRaw as Record<string, unknown>;
      const type = o['type'];
      if (typeof type !== 'string' || !ALLOWED_OUTPUT_TYPES.includes(type as never)) {
        errors.push(
          `outputs.type must be one of: ${ALLOWED_OUTPUT_TYPES.join(', ')}`,
        );
      } else {
        output = { type: type as OutputType };
        if (typeof o['field'] === 'string') output.field = o['field'];
      }
    }
  }

  const retentionDays = obj['max_run_retention_days'];
  if (retentionDays !== undefined) {
    if (typeof retentionDays !== 'number' || !Number.isInteger(retentionDays)) {
      errors.push('max_run_retention_days must be a positive integer');
    } else if (retentionDays < 1 || retentionDays > 3650) {
      errors.push('max_run_retention_days must be between 1 and 3650');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: Manifest = {
    name: name as string,
    displayName: typeof obj['displayName'] === 'string' ? obj['displayName'] : (name as string),
    description: typeof obj['description'] === 'string' ? obj['description'] : '',
    creator: typeof obj['creator'] === 'string' ? obj['creator'] : 'unknown',
    runtime: (isByoManifest ? 'node22' : runtime) as Manifest['runtime'],
    run: typeof run === 'string' ? run : '',
    inputs,
    outputs: output ?? { type: 'stdout' },
  };

  if (byoRuntime) manifest.byo = byoRuntime;

  if (typeof obj['build'] === 'string') manifest.build = obj['build'];
  if (typeof obj['category'] === 'string') manifest.category = obj['category'];
  if (Array.isArray(obj['secrets'])) {
    manifest.secrets = (obj['secrets'] as unknown[]).filter(
      (s): s is string => typeof s === 'string',
    );
  }
  if (typeof obj['memoryMb'] === 'number') manifest.memoryMb = obj['memoryMb'];
  if (typeof obj['timeout'] === 'string') manifest.timeout = obj['timeout'];
  if (typeof obj['workdir'] === 'string') manifest.workdir = obj['workdir'];
  if (Array.isArray(obj['egressAllowlist'])) {
    manifest.egressAllowlist = (obj['egressAllowlist'] as unknown[]).filter(
      (s): s is string => typeof s === 'string',
    );
  }
  if (typeof retentionDays === 'number') {
    manifest.max_run_retention_days = retentionDays;
  }

  if ('network' in obj) {
    const network = obj['network'];
    if (!network || typeof network !== 'object' || Array.isArray(network)) {
      return { ok: false, errors: ['network must be a mapping'] };
    }
    const allowed = (network as Record<string, unknown>)['allowed_domains'];
    if (allowed !== undefined) {
      if (!Array.isArray(allowed) || allowed.some((entry) => typeof entry !== 'string')) {
        return {
          ok: false,
          errors: ['network.allowed_domains must be a list of strings'],
        };
      }
      if (allowed.length > MAX_ALLOWED_DOMAINS) {
        return {
          ok: false,
          errors: [`network.allowed_domains can contain at most ${MAX_ALLOWED_DOMAINS} domains`],
        };
      }
      for (const entry of allowed) {
        const error = validateAllowedDomain(entry);
        if (error) return { ok: false, errors: [error] };
      }
      manifest.network = { allowed_domains: allowed.map((entry) => entry.trim().toLowerCase().replace(/\.$/, '')) };
    } else {
      manifest.network = { allowed_domains: [] };
    }
  } else {
    manifest.network = { allowed_domains: [] };
  }

  return { ok: true, manifest, errors: [] };
}
