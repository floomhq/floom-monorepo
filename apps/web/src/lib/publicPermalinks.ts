export type PermalinkLoadOutcome = 'not_found' | 'retryable';

export function buildPublicRunPath(runId: string): string {
  return `/r/${encodeURIComponent(runId)}`;
}

export function classifyPermalinkLoadError(error: unknown): PermalinkLoadOutcome {
  const status = readStatus(error);
  return status === 404 ? 'not_found' : 'retryable';
}

export function getPermalinkLoadErrorMessage(target: 'app' | 'run'): string {
  if (target === 'run') {
    return "We couldn't open this shared run right now. Check your connection and try again.";
  }
  return "We couldn't load this app right now. Check your connection and try again.";
}

export function getRunStartErrorMessage(
  error: unknown,
  fallback = 'Run failed to start',
): string {
  const status = readStatus(error);
  const message = readMessage(error);
  if (status === 429 || message.toLowerCase().includes('rate_limit_exceeded')) {
    return "You've hit the current run limit. Wait a minute, then try again.";
  }
  return message || fallback;
}

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status === 'success' || status === 'error' || status === 'timeout';
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function readMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : '';
}
