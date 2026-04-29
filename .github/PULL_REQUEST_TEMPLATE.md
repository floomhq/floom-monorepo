## Summary

<!-- What does this PR do? 1-3 bullets. -->

## Why

<!-- The motivation. Link the issue if there is one: Closes #123. -->

## How to verify

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm --filter @floom/server test` passes (if server changed)
- [ ] Manually verified the affected flow:
  - Steps:
  - Expected:

## Verification on live surface

<!--
After deploying to preview/mvp, verify the change actually works on the
live URL (not localhost). The issue-close-gate workflow looks for ONE of:
  - A "Verified at https://..." line (live URL, not localhost) — required
  AND ONE of:
  - A screenshot
  - A fenced `bash` block with curl + http_code
  - A reference to test/stress/test-*.mjs
This prevents the "claimed solved but never checked" pattern.
-->

Verified at: <!-- e.g. https://mvp.floom.dev/p/petstore at 2026-04-29 02:15 UTC -->

Evidence:
<!-- Screenshot OR curl block OR test path. Pick one. -->

## Screenshots or logs

<!-- Optional additional context. -->

## Checklist

- [ ] Small, focused diff (one concern)
- [ ] Docs and examples updated if behavior changed
- [ ] No secrets, tokens, or personal data in the diff
