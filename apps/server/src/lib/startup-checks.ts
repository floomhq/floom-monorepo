interface StartupEnv {
  readonly [name: string]: string | undefined;
}

export interface StartupCheckFailure {
  ok: false;
  code: 'missing_resend_api_key' | 'missing_waitlist_ip_hash_secret';
  message: string;
}

export interface StartupCheckSuccess {
  ok: true;
}

export type StartupCheckResult = StartupCheckSuccess | StartupCheckFailure;

/**
 * Production is keyed off NODE_ENV across the server. Preview is detected the
 * same way as the SEO noindex gate: PUBLIC_URL containing `preview.`.
 * DEPLOY_ENABLED only controls the publish/waitlist surface and is not a
 * deployment-mode signal.
 */
export function isProductionEnv(env: StartupEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isPreviewEnv(env: StartupEnv = process.env): boolean {
  return (env.PUBLIC_URL || '').includes('preview.');
}

function envFlag(raw: string | undefined): boolean | null {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return null;
}

export function isCloudModeEnv(env: StartupEnv = process.env): boolean {
  return envFlag(env.FLOOM_CLOUD_MODE) === true;
}

export function isWaitlistModeEnv(env: StartupEnv = process.env): boolean {
  if (envFlag(env.FLOOM_WAITLIST_MODE) === true) return true;

  const deployEnabled = envFlag(env.DEPLOY_ENABLED);
  if (deployEnabled !== null) return !deployEnabled;

  return false;
}

export function requiresResendApiKey(env: StartupEnv = process.env): boolean {
  return isProductionEnv(env) && !isPreviewEnv(env);
}

export function requiresWaitlistIpHashSecret(env: StartupEnv = process.env): boolean {
  return (
    (isProductionEnv(env) || isCloudModeEnv(env)) &&
    !isPreviewEnv(env) &&
    isWaitlistModeEnv(env)
  );
}

export const DEV_WAITLIST_IP_HASH_SECRET = 'floom-waitlist-dev-only';

export function getWaitlistIpHashSecret(env: StartupEnv = process.env): string | null {
  const configured = env.WAITLIST_IP_HASH_SECRET?.trim();
  if (configured) return configured;

  if (isProductionEnv(env) || isCloudModeEnv(env)) return null;

  return DEV_WAITLIST_IP_HASH_SECRET;
}

export function checkStartupEnvironment(
  env: StartupEnv = process.env,
): StartupCheckResult {
  if (requiresResendApiKey(env) && !env.RESEND_API_KEY?.trim()) {
    return {
      ok: false,
      code: 'missing_resend_api_key',
      message:
        '[startup] fatal: NODE_ENV=production with non-preview PUBLIC_URL requires RESEND_API_KEY. ' +
        'ADR-010 forbids silently logging password-reset and signup-verification ' +
        'emails to stdout in production.',
    };
  }

  if (requiresWaitlistIpHashSecret(env) && !env.WAITLIST_IP_HASH_SECRET?.trim()) {
    return {
      ok: false,
      code: 'missing_waitlist_ip_hash_secret',
      message:
        '[startup] fatal: production/cloud waitlist mode requires WAITLIST_IP_HASH_SECRET. ' +
        'Set a high-entropy secret so waitlist_signups.ip_hash never falls back to a hardcoded value.',
    };
  }

  return { ok: true };
}

export function enforceStartupChecks(): void {
  const result = checkStartupEnvironment();
  if (result.ok) return;

  console.error(result.message);
  process.exit(1);
}
