#!/usr/bin/env node
import { readFileSync } from 'fs';
import { relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const blocked = [
  '@supabase/supabase-js',
  '@vercel/sdk',
  'e2b',
  'stripe',
  '@composio/',
  '@upstash/redis',
  'inngest',
];
const allowedPrefixes = [
  `cli-npm${sep}src${sep}byo${sep}providers${sep}`,
  `packages${sep}byo-providers${sep}`,
  `packages${sep}floom-cloud${sep}src${sep}providers${sep}`,
];

const files = execFileSync('rg', ['--files', '-g', '*.{js,mjs,cjs,ts,tsx}'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

const failures = [];
for (const file of files) {
  const normalized = file.split('/').join(sep);
  if (allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
  const source = readFileSync(resolve(repoRoot, file), 'utf8');
  for (const vendor of blocked) {
    const escaped = vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:from\\s+['"]${escaped}|require\\(['"]${escaped})`);
    if (re.test(source)) failures.push(`${relative(repoRoot, resolve(repoRoot, file))}: imports ${vendor}`);
  }
}

if (failures.length) {
  console.error('Vendor imports must stay behind provider abstractions:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('vendor import lint passed');
