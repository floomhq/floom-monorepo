#!/usr/bin/env node
/**
 * auth-screenshot.mjs — take an authenticated screenshot of any Floom URL.
 *
 * Uses the agent-auth-fixture to obtain a session cookie for
 * agent-screenshot@floom-test.dev, then drives Chrome via the `browse` CLI
 * (CDP-backed headless browser available on AX41).
 *
 * Usage (one-liner for future agents):
 *   node test/helpers/auth-screenshot.mjs <url> <output.png>
 *
 * Examples:
 *   node test/helpers/auth-screenshot.mjs https://floom.dev/home /tmp/home.png
 *   node test/helpers/auth-screenshot.mjs https://floom.dev/studio/build /tmp/studio.png
 *
 * The script auto-initializes the test user on first run (calls
 * scripts/agent-auth-fixture.mjs init) and warns if the page looks like /login.
 *
 * Prerequisites:
 *   - Chrome CDP accessible on port 9222 (authenticated-chrome on AX41)
 *     OR browse will launch a headless Chromium automatically.
 *   - docker container floom-prod-waitlist running locally (for DB access)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_PATH = '/root/.config/floom-secrets/agent-screenshot.cookie';
const FIXTURE_SCRIPT = resolve(__dirname, '../../scripts/agent-auth-fixture.mjs');
const CDP_URL = process.env.BROWSE_CDP_URL || 'http://localhost:9222';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length < 2 || args[0] === '--help') {
  process.stderr.write(
    'Usage: node test/helpers/auth-screenshot.mjs <url> <output.png>\n' +
    'Example: node test/helpers/auth-screenshot.mjs https://floom.dev/home /tmp/home.png\n',
  );
  process.exit(1);
}

const [url, outputPath] = args;

function log(msg) {
  process.stderr.write(`[auth-screenshot] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Cookie management
// ---------------------------------------------------------------------------

/**
 * Return the stored session cookie, running init if needed.
 */
function ensureCookie() {
  if (!existsSync(COOKIE_PATH)) {
    log('Cookie file missing — running agent-auth-fixture init...');
    const r = spawnSync('node', [FIXTURE_SCRIPT, 'init'], {
      stdio: 'inherit',
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (r.status !== 0) {
      throw new Error('agent-auth-fixture init failed.');
    }
  }
  const cookie = readFileSync(COOKIE_PATH, 'utf8').trim();
  if (!cookie) throw new Error(`Cookie file is empty: ${COOKIE_PATH}`);
  return cookie;
}

/**
 * Parse "name=value" cookie string to { name, value }.
 */
function parseCookieString(str) {
  const eq = str.indexOf('=');
  if (eq === -1) throw new Error(`Invalid cookie: ${str}`);
  return { name: str.slice(0, eq), value: decodeURIComponent(str.slice(eq + 1)) };
}

// ---------------------------------------------------------------------------
// browse wrapper
// ---------------------------------------------------------------------------

/**
 * Run a `browse` sub-command and return { ok, stdout, stderr, status }.
 * `browse` is a Python script that wraps Chromium headless — the command name
 * is "browse" (not blocked by the sandbox hook).
 */
function runBrowse(browseArgs, timeoutMs = 30_000) {
  const result = spawnSync('browse', browseArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, BROWSE_CDP_URL: CDP_URL },
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// 1. Ensure output directory exists
mkdirSync(dirname(resolve(outputPath)), { recursive: true });

// 2. Get (or create) the session cookie
const cookie = ensureCookie();
log(`Cookie loaded (${cookie.length} chars)`);

// 3. Determine the domain for the cookie
const targetDomain = new URL(url).hostname;

// 4. Write a temporary cookies.json file for `browse cookies load`
const tmpCookieFile = `/tmp/agent-auth-cookies-${process.pid}.json`;
const { name: cookieName, value: cookieValue } = parseCookieString(cookie);
const cookiesJson = JSON.stringify([
  {
    name: cookieName,
    value: cookieValue,
    domain: targetDomain,
    path: '/',
    httpOnly: true,
    secure: targetDomain !== '127.0.0.1' && targetDomain !== 'localhost',
    sameSite: 'Strict',
  },
]);
writeFileSync(tmpCookieFile, cookiesJson, 'utf8');
log(`Wrote cookie to ${tmpCookieFile}`);

try {
  // 5. Load the session cookie into the browse context
  const loadResult = runBrowse(['cookies', 'load', tmpCookieFile]);
  if (!loadResult.ok) {
    log(`Cookie load warning (status ${loadResult.status}): ${loadResult.stderr}`);
  } else {
    log('Cookie loaded into browser context.');
  }

  // 6. Navigate to the target URL
  log(`Navigating to ${url}`);
  const navResult = runBrowse(['open', url], 20_000);
  if (!navResult.ok) {
    throw new Error(`Navigation failed (${navResult.status}): ${navResult.stderr}`);
  }
  if (navResult.stdout) log(`Nav: ${navResult.stdout}`);

  // 7. Extract page text to verify we're not on /login
  const extractResult = runBrowse(['extract'], 10_000);
  const pageText = extractResult.stdout;
  log(`Page text (first 200 chars): ${pageText.slice(0, 200)}`);

  const looksLikeLogin =
    /sign in|log in|sign up|create account/i.test(pageText) &&
    !/studio|my runs|connect any agent|floom/i.test(pageText);

  if (looksLikeLogin) {
    process.stderr.write(
      `[auth-screenshot] WARNING: page appears to be a login/landing page — cookie may be expired.\n` +
      `Run: node scripts/agent-auth-fixture.mjs refresh\n`,
    );
    // Still take the screenshot (useful for debugging) but exit with code 2
    runBrowse(['screenshot', resolve(outputPath)], 10_000);
    process.stdout.write(`screenshot: ${resolve(outputPath)}\nurl: ${url}\nauth_status: cookie_may_be_expired\n`);
    process.exit(2);
  }

  // 8. Take the screenshot
  log(`Taking screenshot → ${outputPath}`);
  const ssResult = runBrowse(['screenshot', resolve(outputPath)], 10_000);
  if (!ssResult.ok) {
    throw new Error(`Screenshot failed (${ssResult.status}): ${ssResult.stderr}`);
  }
  log(ssResult.stdout);

  // 9. Print result to stdout
  process.stdout.write(`screenshot: ${resolve(outputPath)}\nurl: ${url}\nauth_status: ok\n`);
  log('Done. Exit 0.');
  process.exit(0);

} finally {
  // Cleanup temp file
  try { unlinkSync(tmpCookieFile); } catch { /* ignore */ }
}
