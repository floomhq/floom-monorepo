const PRIMARY_WEBHOOK_ENV = 'DISCORD_ALERT_WEBHOOK_URL';
const LEGACY_WEBHOOK_ENV = 'DISCORD_ALERTS_WEBHOOK_URL';
const DISCORD_WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const APP_UNAVAILABLE_THRESHOLD = 3;
const APP_UNAVAILABLE_WINDOW_MS = 10 * 60 * 1000;
const HEALTH_FAILURE_WINDOW_MS = 30 * 1000;
const DISCORD_CONTENT_LIMIT = 1900;

type AlertContext = Record<string, unknown>;

interface HealthFailureState {
  since: number;
  status: number;
  detail: string;
}

const lastSentByCombo = new Map<string, number>();
const appUnavailableHits = new Map<string, number[]>();
let healthFailure: HealthFailureState | null = null;
let loggedBootState = false;
let loggedMissingWebhook = false;

function truncateContent(raw: string): string {
  if (raw.length <= DISCORD_CONTENT_LIMIT) return raw;
  return raw.slice(0, DISCORD_CONTENT_LIMIT);
}

function normalizeDetail(detail: string): string {
  const collapsed = detail.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, 200) || 'n/a';
}

function currentWebhook():
  | { url: string; envName: typeof PRIMARY_WEBHOOK_ENV | typeof LEGACY_WEBHOOK_ENV }
  | null {
  const primary = process.env[PRIMARY_WEBHOOK_ENV];
  if (primary && primary.startsWith(DISCORD_WEBHOOK_PREFIX)) {
    return { url: primary, envName: PRIMARY_WEBHOOK_ENV };
  }
  const legacy = process.env[LEGACY_WEBHOOK_ENV];
  if (legacy && legacy.startsWith(DISCORD_WEBHOOK_PREFIX)) {
    return { url: legacy, envName: LEGACY_WEBHOOK_ENV };
  }
  return null;
}

function envLabel(): string {
  const raw = process.env.PUBLIC_URL;
  if (!raw) return 'unknown';
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

function comboKey(reason: string, slug: string): string {
  return `${reason}::${slug}`;
}

function shouldSend(reason: string, slug: string, now: number): boolean {
  const key = comboKey(reason, slug);
  const last = lastSentByCombo.get(key) ?? 0;
  if (now - last < ALERT_WINDOW_MS) return false;
  lastSentByCombo.set(key, now);
  return true;
}

function postDiscord(content: string): void {
  try {
    const webhook = currentWebhook();
    if (!webhook) {
      if (!loggedMissingWebhook) {
        loggedMissingWebhook = true;
        console.log(`[discord-alerts] skipped send (${PRIMARY_WEBHOOK_ENV} unset)`);
      }
      return;
    }
    void fetch(webhook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: truncateContent(content),
        allowed_mentions: { parse: [] as string[] },
      }),
    }).catch((err) => {
      console.warn(`[discord-alerts] post failed: ${(err as Error).message}`);
    });
  } catch (err) {
    console.warn(`[discord-alerts] post failed: ${(err as Error).message}`);
  }
}

export function discordAlertsEnabled(): boolean {
  return currentWebhook() !== null;
}

export function logAlertsBootState(): void {
  if (loggedBootState) return;
  loggedBootState = true;
  const webhook = currentWebhook();
  if (!webhook) {
    console.log(`[discord-alerts] disabled (${PRIMARY_WEBHOOK_ENV} unset)`);
    return;
  }
  if (webhook.envName === PRIMARY_WEBHOOK_ENV) {
    console.log(`[discord-alerts] enabled (${PRIMARY_WEBHOOK_ENV})`);
    return;
  }
  console.log(
    `[discord-alerts] enabled (${LEGACY_WEBHOOK_ENV} legacy fallback)`,
  );
}

export function formatAlertMessage(
  reason: string,
  slug: string,
  detail: string,
  now = Date.now(),
): string {
  return [
    `🔴 Floom alert: ${reason}`,
    `App: ${slug}`,
    `Env: ${envLabel()}`,
    `Time: ${new Date(now).toISOString()}`,
    `Detail: ${normalizeDetail(detail)}`,
  ].join('\n');
}

export function sendLayer5Alert(
  reason: string,
  slug: string,
  detail: string,
  now = Date.now(),
): void {
  if (!shouldSend(reason, slug, now)) return;
  postDiscord(formatAlertMessage(reason, slug, detail, now));
}

export function alertLaunchDemoInactive(
  slug: string,
  detail: string,
  now = Date.now(),
): void {
  sendLayer5Alert('launch_demo_inactive', slug, detail, now);
}

export function noteAppUnavailable(
  slug: string,
  detail: string,
  now = Date.now(),
): void {
  const recent = (appUnavailableHits.get(slug) ?? []).filter(
    (ts) => now - ts < APP_UNAVAILABLE_WINDOW_MS,
  );
  recent.push(now);
  appUnavailableHits.set(slug, recent);
  if (recent.length < APP_UNAVAILABLE_THRESHOLD) return;
  sendLayer5Alert(
    'app_unavailable',
    slug,
    `${recent.length} app_unavailable results in 10 minutes. ${detail}`,
    now,
  );
}

export function noteHealthStatus(
  status: number,
  detail: string,
  now = Date.now(),
): void {
  if (status < 500) {
    healthFailure = null;
    return;
  }
  if (!healthFailure) {
    healthFailure = { since: now, status, detail };
    return;
  }
  healthFailure = { since: healthFailure.since, status, detail };
  if (now - healthFailure.since < HEALTH_FAILURE_WINDOW_MS) return;
  sendLayer5Alert(
    'api_health_5xx_30s',
    'api-health',
    `status=${status}. ${detail}`,
    now,
  );
}

export function sendDiscordAlert(
  title: string,
  body: string,
  context?: AlertContext,
): void {
  const ctxLines = context
    ? Object.entries(context).map(([key, value]) =>
        `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
      )
    : [];
  if (!shouldSend(`system:${title}`, 'system', Date.now())) return;
  postDiscord([`**${title}**`, body, ...ctxLines].filter(Boolean).join('\n'));
}

export const __testing = {
  resetState(): void {
    lastSentByCombo.clear();
    appUnavailableHits.clear();
    healthFailure = null;
    loggedBootState = false;
    loggedMissingWebhook = false;
  },
  formatAlertMessage,
};
