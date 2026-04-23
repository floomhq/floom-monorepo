/**
 * TODO(Agent 9): replace path navigation with `WaitlistModal.open()` (or
 * equivalent) so the waitlist opens in-place without a full route.
 */
export function waitlistHref(source: string): string {
  return `/waitlist?source=${encodeURIComponent(source)}`;
}
