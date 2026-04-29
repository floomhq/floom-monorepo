# Round 12 QA Report — Critical Regression & Mass Load Discovery
**Date:** 2026-04-29  
**Tester:** federicodeponte  
**CLI Version:** 0.2.10 (critical regression found; 0.2.1 used as fallback)  
**API Target:** `https://mvp.floom.dev`  
**Backend Version:** 0.4.0-mvp.5  
**Token:** `floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea` (valid)  
**Invalid Tokens Tested:** `floom_agent_sQ61VYpYLNMSvve4sRVH5dsLOSj8O3J0` (401)

---

## Executive Summary

Round 12 discovered a **critical CLI regression in 0.2.10** that crashes most commands on macOS (bash 3.2.57). Additionally, mass concurrent load testing revealed a **multi-layered rate limiting and circuit breaker system** that was invisible at lower concurrency levels.

**Overall Score: 72/100** (down from 80 due to CLI regression and circuit breaker recovery issues)

---

## 🔴 Critical Finding 1: CLI 0.2.10 Crashes on macOS

### Symptom
```bash
$ floom status
/Users/.../floom-api.sh: line 134: COOKIE_ARGS[@]: unbound variable
```

### Affected Commands
| Command | Status |
|---------|--------|
| `floom auth` | ✅ Works |
| `floom status` | ❌ **CRASH** |
| `floom apps list` | ❌ **CRASH** |
| `floom apps get` | ❌ **CRASH** |
| `floom account context get` | ❌ **CRASH** |
| `floom account context set-*` | ❌ **CRASH** |
| `floom account secrets list` | ❌ **CRASH** |
| `floom validate` | ✅ Works (local only) |
| `floom run` | ✅ Works (via direct curl path) |

### Root Cause
In `floom-api.sh` (line 28):
```bash
set -euo pipefail
```

Combined with empty array expansion on bash 3.2.57 (macOS default):
```bash
COOKIE_ARGS=()
if [[ -n "${FLOOM_COOKIE_JAR:-}" ]]; then
  COOKIE_ARGS+=("-b" "$FLOOM_COOKIE_JAR" "-c" "$FLOOM_COOKIE_JAR")
fi

curl ... "${COOKIE_ARGS[@]}"  # <-- crashes here when array is empty
```

On bash 3.x, `set -u` treats an empty array `()` as unbound when expanded with `[@]`.

### Workaround
```bash
export FLOOM_COOKIE_JAR=/tmp/floom_cookies.txt
floom status  # now works
```

### Verification
- **0.2.10** (cache `335f5ba77007fd8f`): ❌ Broken
- **0.2.1** (cache `3972768b2cd56e43`): ✅ Works
- **0.2.2** (cache `eac7c2bcc9d99684`): ✅ Works
- **0.2.4** (cache `df408f5af8aa117d`): ✅ Works

**Recommendation:** Fix by using `"${COOKIE_ARGS[@]:-}"` or `[[ ${#COOKIE_ARGS[@]} -gt 0 ]] && curl ... "${COOKIE_ARGS[@]}"`.

---

## 🟠 Critical Finding 2: Circuit Breaker Under Mass Load

### Test: 100 Concurrent Hash Runs
```bash
for i in 1..100; do
  curl -X POST /api/hash/run -d '{"text":"mass"}' &
done
```

### Results
| Metric | Value |
|--------|-------|
| Total launch time | 953ms |
| Success | 57 |
| Rate limited | 43 |
| Success rate | 57% |

### Error Taxonomy Discovered

| # | Error | Code | retry_after | Source |
|---|-------|------|-------------|--------|
| 1 | `rate_limit_exceeded` | — | 43s | `agent_token` |
| 2 | `server_overloaded` | `abuse_fuse_active` | 300s | server |
| 3 | `rate_limit_exceeded` | `edge_rate_limit` | varies | `nginx` |

### Recovery Behavior
- **5s wait**: Still `abuse_fuse_active` with 300s retry
- **10s wait**: Still `abuse_fuse_active`
- **~60s wait**: ✅ Server recovered, normal operation resumed

**Finding:** The server has a **circuit breaker** (`abuse_fuse_active`) that triggers after ~60 concurrent requests and requires ~60 seconds to cool down. This is separate from per-token rate limiting and nginx edge rate limiting.

### Layered Rate Limit Stack
```
Client → nginx (edge_rate_limit) → API (agent_token rate limit) → App server (abuse_fuse_active circuit breaker)
```

**Recommendation:** Document the circuit breaker behavior and provide guidance on burst vs sustained throughput.

---

## 3. App Visibility & Sharing (#937 Retest)

### Current State
| Property | Value |
|----------|-------|
| Visibility | `private` |
| Publish status | `pending_review` |
| Run rate limit | 10/hour |

### Access Matrix

| App | Auth | Result | Assessment |
|-----|------|--------|------------|
| petstore | Valid token | ✅ Run created | Owner access works |
| petstore | No auth | ❌ `App not found` | Private apps hidden from public |
| petstore | Invalid token | ❌ `invalid_token` | Properly rejected |
| hash (store) | No auth | ✅ Run created | Store apps are public |
| uuid (store) | No auth | ✅ Run created | Store apps are public |
| base64 (store) | No auth | ❌ `Unknown input: operation` | **Inconsistent behavior** |

### base64 Auth Inconsistency
With auth: `{"text":"hello","operation":"hack"}` → **accepted** (defaults to encode?)  
Without auth: `{"text":"hello","operation":"encode"}` → **rejected** (`Unknown input: operation`)

**Finding:** base64 behavior differs between authenticated and unauthenticated requests. This suggests different code paths or app versions for auth vs no-auth.

### Visibility API Endpoints
| Endpoint | Status |
|----------|--------|
| `PATCH /api/apps/petstore` | 404 |
| `GET/POST/PUT/PATCH /api/apps/petstore/sharing` | 404 |

**Finding:** No API endpoint exists for changing app visibility. The `floom apps sharing set` command from Round 1 must have used a different endpoint or has been removed.

---

## 4. Deploy Lifecycle

| Step | Command | Result |
|------|---------|--------|
| Init | `floom init --name QATestApp --slug qa-test-app-r12` | ✅ `floom.yaml` generated |
| Validate | `floom validate` | ✅ `ok` |
| Dry-run deploy | `floom deploy --dry-run` | ⚠️ "custom Python/Node apps can't be published via HTTP yet" |
| Actual deploy | `floom deploy` | ⚠️ Same message — **not implemented** |
| App appears in list | — | ❌ No — deploy is a no-op |
| Run deployed app | `floom run qa-test-app-r12` | ❌ HTTP 404 |

**Finding:** Custom app deploy via CLI is **not yet implemented**. Only proxied apps (OpenAPI specs) can be published.

---

## 5. Webhook / Trigger Deep Dive

| Endpoint | Method | Status | Body |
|----------|--------|--------|------|
| `/api/me/triggers` | GET | 200 | `{"triggers":[]}` |
| `/api/me/triggers` | POST | 404 | Not implemented |
| `/api/triggers` | POST | 404 | Not implemented |
| `/api/apps/{slug}/webhook` | GET | 404 | Not implemented |

**Finding:** Trigger listing works but creation is not exposed via API.

---

## 6. Context Profiles & --use-context

Could not test due to CLI 0.2.10 regression. Verified that `floom run hash --input text=hello --use-context` works (bypasses the API path that crashes).

---

## 7. Run Deletion / Cleanup

| Endpoint | Method | Result |
|----------|--------|--------|
| `/api/me/runs/{id}` | DELETE | 503 (during circuit breaker) |
| `/api/apps/{slug}` | DELETE | 503 (during circuit breaker) |
| `/api/me/runs/{id}/archive` | POST | 503 (during circuit breaker) |

Retested after server recovery:
```bash
DELETE /api/me/runs/run_xxx → 404 Not Found
```

**Finding:** Run deletion endpoint does not exist. Returns 404 after recovery.

---

## 8. API Versioning

| Test | Result |
|------|--------|
| `/api/v1/me/runs` | 404 |
| `/api/v1/run` | 404 |
| `/api/v1/health` | 404 |
| API version header in responses | None |

**Finding:** No API versioning scheme is in place.

---

## 9. CLI Cache Contamination

During testing, `npx @floomhq/cli@latest` resolved to **four different caches**:

| Cache | Version | Status |
|-------|---------|--------|
| `335f5ba77007fd8f` | 0.2.10 | ❌ Broken (COOKIE_ARGS) |
| `3972768b2cd56e43` | 0.2.1 | ✅ Works |
| `df408f5af8aa117d` | 0.2.4 | ✅ Works |
| `eac7c2bcc9d99684` | 0.2.2 | ✅ Works |

**Finding:** `npx` caches multiple versions under the same `@latest` tag. Users may get different behavior on different machines or at different times.

---

## 10. Issues Status Update

| Issue | Status | Round 12 Finding |
|-------|--------|-----------------|
| #937 | 🔴 Open | Retested — private apps correctly hidden; no visibility API exists |
| #938 | 🔴 Open | Still relevant |
| #966 | 🔴 Open | Confirmed resolved |
| #967 | 🔴 Open | **0.2.10 introduces NEW critical bug** |
| #968 | 🔴 Open | Confirmed resolved |

**New issue to file:** CLI 0.2.10 `COOKIE_ARGS[@]` crash on macOS/bash 3.x.

---

## 11. Score Breakdown

| Category | Score | Notes |
|----------|-------|-------|
| Auth & Security | 72/100 | Store apps work without auth; base64 auth inconsistency |
| CLI Stability | 45/100 | **0.2.10 is broken on macOS**; 0.2.1 works fine |
| API Resilience | 70/100 | Circuit breaker works but recovery ~60s; layered rate limits |
| Rate Limiting | 85/100 | Well-implemented multi-layer system |
| Deploy Feature | 40/100 | Custom app deploy not implemented |
| Error Handling | 88/100 | Excellent structured errors with retry_after |
| **Overall** | **72/100** | ↓ from 80 (R11) due to CLI regression |

---

## 12. Recommendations

### Critical (Fix Immediately)
1. **Fix CLI 0.2.10 COOKIE_ARGS bug** — Use `"${COOKIE_ARGS[@]:-}"` for bash 3.x compatibility
2. **Document circuit breaker behavior** — Users need to know about 60s recovery after burst load

### High
3. **Fix base64 auth inconsistency** — Same inputs should produce same results with/without auth
4. **Implement custom app deploy** — Currently a no-op with misleading "ok" message

### Medium
5. **Add run deletion endpoint** — Currently impossible to clean up test runs
6. **Add API versioning** — `/api/v1/` or version headers
7. **Document rate limit tiers** — agent_token vs nginx vs abuse_fuse_active

### Low
8. **Expose trigger creation API** — Currently only listing works
9. **Add visibility management endpoints** — PATCH /api/apps/{slug} for visibility changes

---

## Raw Test Log

All tests performed 2026-04-29 06:13–06:18 UTC. Server entered circuit breaker mode at 06:16 and recovered by 06:18.
