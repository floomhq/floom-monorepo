# Floom CLI v0.2.1 — Round 2 Delta Report
**Date:** 2026-04-28  
**Target:** https://mvp.floom.dev  
**CLI Version:** @floomhq/cli@0.2.1 (unchanged)  
**Tester:** depontefede@gmail.com

---

## Summary

Re-ran the full stress test suite after frontend/backend updates (commits: v26 dashboard, settings pages, email branding, studio app access v1).  
**CLI did NOT change version**, but backend behavior shifted on at least one critical bug.

| Category | Round 1 | Round 2 | Delta |
|----------|---------|---------|-------|
| Commands tested | 60+ | 60+ | Same |
| Critical bugs | 2 | 2 | No change |
| Medium issues | 6 | 6 | No change |
| Minor issues | 4 | 4 | No change |

---

## Critical Bug #937 — Link Visibility Breaks App Execution

### Status: 🔴 PARTIALLY FIXED — NOW NON-DETERMINISTIC

| Test | Round 1 | Round 2 |
|------|---------|---------|
| `apps get <slug>` while link | ❌ HTTP 404 | ✅ **WORKS** |
| `run <slug>` while link (immediate) | ❌ HTTP 404 | ✅ **PENDING** (accepted) |
| `run <slug>` while link (after 2s delay) | ❌ HTTP 404 | ❌ **HTTP 404** |
| `apps source get <slug>` while link | Not tested | Not tested |

**Analysis:** The backend now allows `apps get` while in link state, which is an improvement. However, `run` behavior is **non-deterministic** — it depends on timing/cache propagation. A run queued immediately after `sharing set --state link` may succeed, but a run issued after a short delay fails with 404.

**This is worse than before** because:
1. Users cannot predict whether their app will be runnable
2. The inconsistency makes debugging harder
3. It suggests a race condition or cache invalidation issue in the backend

**Recommendation:** Ensure `run` endpoint uses the same authz check as `apps get` — owner should always be able to run regardless of visibility state, without timing-dependent behavior.

---

## Critical Bug #938 — Silent Auth Failure

### Status: 🔴 UNCHANGED

| Test | Round 1 | Round 2 |
|------|---------|---------|
| `floom auth clearly-invalid-token` | ❌ Accepted | ❌ **Accepted** |
| `floom status` with invalid token | ❌ Empty arrays | ❌ **Empty arrays** |

No change. Still returns empty `{"apps":[],"runs":[]}` instead of HTTP 401.

---

## Notable Changes (Round 2)

### ✅ Reviews now show real author name
**Round 1:** `"author_name":"anonymous"`  
**Round 2:** `"author_name":"Federico De Ponte"`  
**Impact:** Positive UX improvement.

### ✅ Competitor-lens rate limit reset
**Round 1:** `byok_required` after 5 runs  
**Round 2:** Works again  
**Impact:** Rate limits appear to reset on a schedule or after workspace runs are cleared.

### ✅ `--input` flag correctly rejected
**Round 1:** (Misreported as working — likely parallel output interleaving)  
**Round 2:** `floom run: unknown option '--input'`  
**Impact:** Confirms `--inputs-json` and `--inputs-stdin` are the only valid input methods.

### 🟡 `uuid` store app activity increased
**Round 1:** `runs_7d: 70`  
**Round 2:** `runs_7d: 401`  
**Impact:** Normal growth in usage.

---

## Unchanged Issues (confirmed still present)

| Issue | Status |
|-------|--------|
| `floom init --slug "BAD-SLUG"` misleading error | Still says "Pass --slug" |
| `floom init` sporadic flake | Not retested |
| Proxied app `--action` syntax not discoverable | Same help text |
| Empty share link returns generic "Run not found" | Same |
| `floom status` can overflow | Same |
| Agent-token management requires user session | Same |
| `floom apps sharing submit-review` without link state fails | Same |
| Whitespace-only strings accepted | Same |

---

## Regression Tests (all passed)

| Command | Result |
|---------|--------|
| `floom auth <valid_token>` | ✅ |
| `floom auth whoami` | ✅ |
| `floom apps list` | ✅ |
| `floom apps get petstore` | ✅ |
| `floom apps sharing get/set/invite/revoke` | ✅ |
| `floom apps creator-secrets set/delete` | ✅ |
| `floom apps secret-policies list/set` | ✅ |
| `floom apps reviews list/submit` | ✅ |
| `floom apps rate-limit get/set` | ✅ |
| `floom store list/search/get` | ✅ |
| `floom run hash/base64/petstore` | ✅ |
| `floom run` with edge cases (XSS, emoji, 10K) | ✅ |
| `floom runs list/get/share/delete` | ✅ |
| `floom triggers list/create/update/delete` | ✅ |
| `floom workspaces me/list/get/create/delete/switch` | ✅ |
| `floom workspaces members list/set-role/remove` | ✅ |
| `floom deploy --dry-run` | ✅ |
| `floom validate` | ✅ |
| `floom feedback submit` | ✅ |
| `floom api GET/POST/PATCH/DELETE` | ✅ |

---

## Test Artifacts (Round 2)

- **Feedback issue:** [#944](https://github.com/floomhq/floom/issues/944)
- **Store app activity:** uuid now at 401 runs/week
- **Petstore run count:** 9 total runs
- **Hash run:** 3ms average

---

## Recommendations (Updated)

1. **Fix link visibility race condition** — The partial fix introduced non-determinism. `run` endpoint should consistently allow owner access regardless of visibility state, matching `apps get` behavior.
2. **Fix auth validation** — Still critical. No change needed to recommendation.
3. **Cache invalidation audit** — The timing-dependent behavior on link visibility suggests a cache invalidation issue that should be investigated.
