// Shared tiny time formatters used by dashboard pages.
//
// Negative-duration guard (2026-04-19): backend timestamps can be slightly
// ahead of the client clock on preview.floom.dev (container time vs user's
// Mac), which used to render as `-25135s ago`. Clamping `diff` at 0 and
// returning "just now" for anything under 60 seconds keeps the UI honest
// without requiring server-side clock sync. (Issue #102: fresh runs should
// read "just now", not "45s ago" or a stale wall-clock bucket.)

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const t = d.getTime();
    if (Number.isNaN(t)) return iso;
    const now = Date.now();
    // Treat future-dated and brand-new timestamps as "just now" so clock
    // skew never surfaces as "-25135s ago" to the user.
    const diff = Math.max(0, now - t);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
