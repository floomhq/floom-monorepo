#!/usr/bin/env node
// renderer-bundler: ingest-time entry-path safety.
//
// The existing resolveEntryPath() string-checks for absolute paths and ".."
// segments and then joins onto the manifest dir, but those checks operate on
// the unresolved path — a malicious app dir that contains a symlink named
// e.g. `entry.js` resolving to /etc/hosts would pass them and cause the
// bundler to read an attacker-chosen file at ingest time. This test asserts
// the realpath-based defense-in-depth: legit files accepted, symlink escape
// rejected, and a manifest dir that is itself a symlink to a real dir still
// works for a legit entry inside it.
//
// Deliberately standalone from test-renderer-bundler.mjs so it can run in
// isolation (no esbuild bundle step needed).

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'floom-renderer-entry-safety-'));
// resolveEntryPath does not touch DATA_DIR, but db.ts has import-time side
// effects (opens SQLite) when the module graph loads. Point DATA_DIR at the
// tmp dir so those side effects land in a throwaway spot.
process.env.DATA_DIR = tmp;

const { resolveEntryPath } = await import(
  '../../apps/server/src/services/renderer-bundler.ts'
);

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

function throws(fn, msg) {
  try {
    fn();
    return false;
  } catch (err) {
    if (msg && !String(err.message).includes(msg)) return false;
    return true;
  }
}

console.log('renderer entry-path safety tests');

// --- Case 1: legitimate entry inside app dir is accepted ---
const appA = join(tmp, 'app-a');
mkdirSync(appA, { recursive: true });
const legitEntry = join(appA, 'renderer.tsx');
writeFileSync(legitEntry, 'export default function X() { return null; }\n');
log(
  'legit entry inside app dir → resolves to absolute path inside dir',
  (() => {
    try {
      const out = resolveEntryPath('renderer.tsx', appA);
      return out === legitEntry;
    } catch (err) {
      console.error('    unexpected throw:', err.message);
      return false;
    }
  })(),
);

// --- Case 2: symlink inside app dir pointing OUTSIDE app dir is rejected ---
const appB = join(tmp, 'app-b');
mkdirSync(appB, { recursive: true });
const outsideTarget = join(tmp, 'secret.txt');
writeFileSync(outsideTarget, 'stolen\n');
const escapingLink = join(appB, 'entry.js');
try {
  symlinkSync(outsideTarget, escapingLink);
  log(
    'symlink whose target is outside the app dir → rejected',
    throws(
      () => resolveEntryPath('entry.js', appB),
      'symlink',
    ),
  );
} catch (err) {
  // Some CI filesystems refuse symlink creation; skip gracefully.
  console.log(`  skip  symlink case (could not create symlink: ${err.message})`);
}

// --- Case 3: app dir is ITSELF a symlink to a real dir; legit entry inside still works ---
const realAppRoot = join(tmp, 'real-app-c');
mkdirSync(realAppRoot, { recursive: true });
const insideEntry = join(realAppRoot, 'renderer.tsx');
writeFileSync(insideEntry, 'export default function Y() { return null; }\n');
const linkedAppRoot = join(tmp, 'linked-app-c');
try {
  symlinkSync(realAppRoot, linkedAppRoot);
  const realInside = realpathSync(insideEntry);
  log(
    'manifestDir is symlink → legit entry still accepted (realpath both sides)',
    (() => {
      try {
        const out = resolveEntryPath('renderer.tsx', linkedAppRoot);
        // The string-level prefix check passes because `absolute` is built
        // on the unresolved manifestDir; that is fine. What matters is the
        // realpath sides both collapse under the same real root, so no
        // throw.
        return typeof out === 'string' && realpathSync(out) === realInside;
      } catch (err) {
        console.error('    unexpected throw:', err.message);
        return false;
      }
    })(),
  );
} catch (err) {
  console.log(`  skip  symlinked-manifestDir case (could not create symlink: ${err.message})`);
}

// --- Case 4: absolute input still rejected (regression) ---
log(
  'absolute entry path → rejected',
  throws(() => resolveEntryPath('/etc/passwd', appA), 'absolute'),
);

// --- Case 5: ".." input still rejected (regression) ---
log(
  '".." entry path → rejected',
  throws(() => resolveEntryPath('../evil.tsx', appA), '..'),
);

// --- Case 6: missing file still rejected (regression) ---
log(
  'missing file → rejected',
  throws(() => resolveEntryPath('ghost.tsx', appA), 'does not exist'),
);

// --- Cleanup ---
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
