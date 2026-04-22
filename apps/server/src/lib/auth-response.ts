const TOKENLESS_AUTH_PATHS = new Set([
  '/auth/sign-in/email',
  '/auth/sign-up/email',
  '/auth/get-session',
  '/auth/change-password',
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function shouldRedactAuthResponse(req: Request): boolean {
  try {
    const url = new URL(req.url);
    return TOKENLESS_AUTH_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}

export function redactAuthTokens(payload: unknown): { payload: unknown; changed: boolean } {
  if (!isObjectRecord(payload)) return { payload, changed: false };

  let changed = false;
  const next: Record<string, unknown> = { ...payload };

  if ('token' in next) {
    next.token = null;
    changed = true;
  }

  if (isObjectRecord(next.session) && 'token' in next.session) {
    next.session = { ...next.session, token: null };
    changed = true;
  }

  return { payload: next, changed };
}

export async function sanitizeAuthResponse(req: Request, res: Response): Promise<Response> {
  if (!shouldRedactAuthResponse(req)) return res;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return res;

  const text = await res.clone().text().catch(() => '');
  if (!text) return res;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return res;
  }

  const { payload, changed } = redactAuthTokens(parsed);
  if (!changed) return res;

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(payload), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export const __test__ = {
  redactAuthTokens,
  shouldRedactAuthResponse,
};
