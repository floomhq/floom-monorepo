#!/usr/bin/env node
/**
 * Build script for @floomhq/cli.
 *
 *  - Copies cli/floom/ (the bash CLI source of truth) into vendor/floom/
 *    so the published tarball is self-contained.
 *  - Copies src/index.js into dist/index.js with a shebang preserved.
 *
 * Run via `npm run build` or `npm publish` (prepublishOnly).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(ROOT, 'vendor');
const BASH_CLI_SRC = path.join(REPO_ROOT, 'cli', 'floom');

function rm(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      // preserve exec bit for shell scripts and bin entries
      if (
        entry.name.endsWith('.sh') ||
        entry.name === 'floom' ||
        s.includes(`${path.sep}bin${path.sep}`)
      ) {
        fs.chmodSync(d, 0o755);
      }
    }
  }
}

function copySrc(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copySrc(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

console.log('[cli-npm build] cleaning dist/ + vendor/');
rm(DIST);
rm(VENDOR);

console.log('[cli-npm build] copying bash CLI from', BASH_CLI_SRC);
if (!fs.existsSync(BASH_CLI_SRC)) {
  console.error('[cli-npm build] FATAL: bash CLI not found at ' + BASH_CLI_SRC);
  process.exit(1);
}
copyDir(BASH_CLI_SRC, path.join(VENDOR, 'floom'));

console.log('[cli-npm build] copying src/ -> dist/');
copySrc(SRC, DIST);
const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
fs.chmodSync(path.join(DIST, 'index.js'), 0o755);

// Verify the entrypoint has a shebang.
if (!indexSrc.startsWith('#!')) {
  console.error('[cli-npm build] FATAL: dist/index.js is missing shebang');
  process.exit(1);
}

console.log('[cli-npm build] OK');
console.log('  dist/index.js   →', fs.statSync(path.join(DIST, 'index.js')).size, 'bytes');
console.log('  vendor/floom/   → bundled bash CLI');
