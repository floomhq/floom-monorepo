/**
 * Manifest parser + validator.
 *
 * Reads a YAML string (or file) and validates it into a Manifest. Returns
 * either the typed manifest or a list of validation errors. Never throws
 * on invalid input — the caller (e.g. deployFromGithub) needs the error
 * list to ship back to the user verbatim (H6 Scenario 2).
 */
import { parse as parseYaml } from 'yaml';
import type { Manifest, Input, InputType, Output, OutputType, Integration } from './schema.ts';
import {
  ALLOWED_RUNTIMES,
  ALLOWED_INPUT_TYPES,
  ALLOWED_OUTPUT_TYPES,
  REQUIRED_FIELDS,
} from './schema.ts';

const MAX_ALLOWED_DOMAINS = 20;
const KNOWN_COMPOSIO_SLUGS = new Set([
  'gmail',
  'slack',
  'notion',
  'github',
  'stripe',
  'sheets',
  'google_sheets',
  'google-calendar',
  'calendar',
  'linear',
  'figma',
  'airtable',
  'hubspot',
  'shopify',
  'salesforce',
  'jira',
  'discord',
  'trello',
  'asana',
  'drive',
  'google_drive',
  'dropbox',
  'sendgrid',
  'resend',
  'mailchimp',
  'zendesk',
  'intercom',
  'twilio',
  'supabase',
  'postgres',
  'mongodb',
]);

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

function parseIntegrations(raw: unknown, errors: string[]): Integration[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('integrations must be a list');
    return [];
  }
  const out: Integration[] = [];
  raw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`integrations[${idx}] must be a mapping like { composio: gmail }`);
      return;
    }
    const value = (entry as Record<string, unknown>)['composio'];
    if (typeof value !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(value)) {
      errors.push(`integrations[${idx}].composio must be a lowercase Composio slug`);
      return;
    }
    const slug = value.trim().toLowerCase();
    if (!KNOWN_COMPOSIO_SLUGS.has(slug)) {
      errors.push(`integrations[${idx}].composio unknown Composio slug: ${slug}`);
      return;
    }
    out.push({ provider: 'composio', slug });
  });
  return out;
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

  // Required fields
  for (const field of REQUIRED_FIELDS) {
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
  const runtime = obj['runtime'];
  if (runtime !== undefined) {
    if (typeof runtime !== 'string' || !ALLOWED_RUNTIMES.includes(runtime as never)) {
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

  const integrations = parseIntegrations(obj['integrations'], errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: Manifest = {
    name: name as string,
    displayName: typeof obj['displayName'] === 'string' ? obj['displayName'] : (name as string),
    description: typeof obj['description'] === 'string' ? obj['description'] : '',
    creator: typeof obj['creator'] === 'string' ? obj['creator'] : 'unknown',
    runtime: runtime as Manifest['runtime'],
    run: run as string,
    inputs,
    outputs: output ?? { type: 'stdout' },
  };

  if (typeof obj['build'] === 'string') manifest.build = obj['build'];
  if (typeof obj['category'] === 'string') manifest.category = obj['category'];
  if (Array.isArray(obj['secrets'])) {
    manifest.secrets = (obj['secrets'] as unknown[]).filter(
      (s): s is string => typeof s === 'string',
    );
  }
  if (integrations.length > 0) manifest.integrations = integrations;
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
