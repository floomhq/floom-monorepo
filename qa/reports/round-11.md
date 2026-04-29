# Round 11 QA Report — Super Deep Dive (Even Deeper)
**Date:** 2026-04-29  
**Tester:** federicodeponte  
**CLI Version:** 0.2.8  
**API Target:** `https://mvp.floom.dev` (direct IP: `65.21.90.216` + `Host` header)  
**Backend Version:** 0.4.0-mvp.5  
**Tokens Tested:**
- `floom_agent_sQ61VYpYLNMSvve4sRVH5dsLOSj8O3J0` — ❌ INVALID (HTTP 401)
- `floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea` — ✅ VALID (Rounds 7-8 token, used for all tests)

---

## Executive Summary

Round 11 is the deepest QA pass yet, covering run lifecycle telemetry, response header audits, CORS behavior, pagination correctness, content-type validation, error taxonomy, timing distributions, secrets lifecycle, and deploy scaffolding. 

**Key discovery:** The `offset` pagination parameter is **non-functional** — it returns the same results as `limit` alone. Additionally, CORS is **inconsistently applied** across endpoints, and the API **does not validate Content-Type headers**.

**Overall Score: 80/100**

---

## 1. Token Validation

| Token | Status |
|-------|--------|
| `floom_agent_sQ61VYpYLNMSvve4sRVH5dsLOSj8O3J0` | ❌ HTTP 401 — `invalid_agent_token` |
| `floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea` | ✅ Active — `depontefede@gmail.com`, admin |

Both user-provided tokens (Round 9 and Round 11) were invalid. Only the original Round 7-8 token remains valid.

---

## 2. Run Lifecycle Deep Dive

### 2.1 hash (Python Store App)
- **Create → Complete latency:** ~8ms
- **Status transition:** `pending` → `success` (observed in single 100ms poll)
- **No intermediate `running` state observed**

### 2.2 petstore (Proxied App)
- **Create → Complete latency:** ~542ms
- **Status transition:** `pending` → `success`

### 2.3 Run Object Schema (from `/api/me/runs/<id>`)

```json
{
  "id": "run_xxx",
  "app_id": "app_xxx",
  "app_slug": "hash",
  "app_name": "Hash",
  "app_icon": "hash",
  "thread_id": null,
  "action": "hash",
  "inputs": {"text": "...", "algorithm": "sha256"},
  "outputs": {"algorithm": "sha256", "input_length": 9, "digest_hex": "...", "digest_length": 64},
  "status": "success",
  "error": null,
  "error_type": null,
  "upstream_status": null,
  "duration_ms": 8,
  "started_at": "2026-04-29 04:58:58",
  "finished_at": "2026-04-29 04:58:58",
  "logs": "[proxied] hash/hash → POST /hash/run\n[proxied] POST http://127.0.0.1:4200/hash/run\n[proxied] HTTP 200 (8ms)"
}
```

**Schema observations:**
- `thread_id`: Always `null` in observed runs (threading feature not used?)
- `upstream_status`: Always `null` (not populated for store apps)
- `logs`: Contains proxied routing info — useful for debugging
- `error_type`: `null` for success, `user_input_error` for validation failures

---

## 3. Auth & Security (Continued from Round 10)

### 3.1 Confirmed: Missing Auth Returns 200 + Empty Data

| Scenario | Status | Body |
|----------|--------|------|
| No `Authorization` header | 200 | `{"runs":[]}` |
| `Authorization: Bearer ` (empty) | 200 | `{"runs":[]}` |
| `Authorization: Basic dXNlcjpwYXNz` | 200 | `{"runs":[]}` |
| `Authorization: Bearer <valid>` | 200 | Full runs array |
| `Authorization: Bearer <invalid format>` | 401 | `invalid_token` |

**Severity: 🔴 Critical** — Authenticated endpoints must return 401 for missing/invalid auth.

### 3.2 Content-Type Validation

| Content-Type | Body | Result | Assessment |
|--------------|------|--------|------------|
| `application/json` | `{"text":"test"}` | Run created | ✅ Correct |
| `text/plain` | `{"text":"test"}` | Run created | ⚠️ Should reject |
| *(missing)* | `{"text":"test"}` | Run created | ⚠️ Should reject or assume JSON |
| `application/xml` | `<text>test</text>` | Rejected as invalid JSON | ✅ Correct |
| `multipart/form-data` | — | Rejected as invalid JSON | ✅ Correct |

**Finding:** The API does **not validate Content-Type**. It attempts to JSON-parse any body regardless of declared type.

---

## 4. Input Validation & Error Taxonomy

### 4.1 Body Shape Validation

| Body | Result | Error |
|------|--------|-------|
| `[]` (array) | Rejected | `{"code":"invalid_body","reason":"wrong_shape","parse_message":"Request body must be a JSON object"}` |
| `"string"` | Rejected | Same as above |
| `42` (number) | Rejected | Same as above |
| `true` (boolean) | Rejected | Same as above |
| `null` | Rejected | Same as above |
| `{}` (empty object) | Run created (then fails at app level) | App-specific error |

**Assessment:** ✅ Excellent body shape validation with clear, structured error codes.

### 4.2 Malformed JSON

```json
{"error":"Request body is not valid JSON","code":"invalid_body","details":{"reason":"malformed_json","parse_message":"Unexpected token 'o', \"not-json\" is not valid JSON"}}
```

**Assessment:** ✅ Excellent — includes specific parser error messages.

### 4.3 Missing Required Fields

```json
{"error":"Missing required input: text","field":"text"}
```

**Assessment:** ✅ Clear field-level errors.

---

## 5. Pagination Bug

### 5.1 Test Results

| Query | Runs Returned | IDs |
|-------|--------------|-----|
| `?limit=2` | 2 | `run_svr0yphvt0ah`, `run_xtrqh568b1v9` |
| `?limit=2&offset=2` | 2 | `run_svr0yphvt0ah`, `run_xtrqh568b1v9` |
| `?limit=4` | 4 | `run_svr0yphvt0ah`, `run_xtrqh568b1v9`, `run_177chg4zsyv1`, `run_aw14fnkcc04h` |

**Finding:** `offset=2` returns the **same first 2 runs** as `limit=2` alone. The `offset` parameter is **non-functional**.

**Expected:** `offset=2` should skip the first 2 runs and return runs 3-4.

**Severity: 🟠 High** — Breaks pagination for clients with many runs.

---

## 6. CORS Analysis (Revised from Round 10)

### 6.1 OPTIONS Preflight

Both `/api/health` and `/api/hash/run` return proper preflight headers:
```
access-control-allow-origin: *
access-control-allow-methods: GET,POST,OPTIONS
access-control-allow-headers: Content-Type,Authorization,Accept
vary: Access-Control-Request-Headers
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
```

### 6.2 Actual Request CORS Headers

| Endpoint | Method | `access-control-allow-origin` present? |
|----------|--------|----------------------------------------|
| `/api/health` | GET | ✅ Yes |
| `/api/hash/run` | POST | ✅ Yes |
| `/api/hub/store` | GET | ✅ Yes |
| `/api/me/runs` | GET | ❌ No |
| `/api/me` | GET | ❌ No |
| `/api/workspaces` | GET | ❌ No |
| `/api/me/apps` | GET | ❌ No |

**Finding:** CORS is **inconsistently applied**. Public/unauthenticated endpoints (`/api/health`, `/api/hub/store`) and run endpoints have CORS, but user-data endpoints (`/api/me/runs`, `/api/me`) do not.

**Severity: 🟡 Medium** — Breaks browser-based dashboards that fetch run history.

### 6.3 Security Headers (Present on All Responses)

```
content-security-policy: default-src 'self'; ...
cross-origin-embedder-policy: credentialless
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-site
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
```

**Assessment:** ✅ Strong security headers on all responses.

---

## 7. Response Header Audit

| Header | /api/health | /api/me/runs | /api/hash/run |
|--------|-------------|--------------|---------------|
| HTTP/2 | ✅ | ✅ | ✅ |
| server: nginx | ✅ | ✅ | ✅ |
| content-type: application/json | ✅ | ✅ | ✅ |
| access-control-allow-origin: * | ✅ | ❌ | ✅ |
| cache-control | ❌ | ❌ | ❌ |
| etag | ❌ | ❌ | ❌ |
| last-modified | ❌ | ❌ | ❌ |

**Finding:** No caching headers. Every request hits the origin. Consider adding `Cache-Control: no-cache` for authenticated endpoints.

---

## 8. Concurrent Load & Rate Limiting

| Test | Result |
|------|--------|
| 20 concurrent hash runs | ✅ All succeeded |
| 50 rapid-fire sequential runs | ✅ All returned HTTP 200 |

**No rate limiting detected.**

---

## 9. Payload Size Limits

| Size | Result | Status |
|------|--------|--------|
| 10KB | ✅ Accepted | 200 |
| 100KB | ✅ Accepted | 200 |
| 1MB | ✅ Accepted | 200 |
| 5MB | ❌ Rejected | 413 (nginx) |

---

## 10. Timing Distribution (Client-Measured)

| App | Min | Max | Avg | Median |
|-----|-----|-----|-----|--------|
| hash | 533ms | 592ms | 569ms | ~575ms |
| petstore | 533ms | 597ms | 566ms | ~570ms |

> Note: These are **client-measured round-trip times** including TLS handshake and network overhead. Server-side `duration_ms` for hash is ~3-8ms.

---

## 11. Run Statistics (from `/api/me/runs`)

| Metric | Value |
|--------|-------|
| Total runs in account | 50 (default page size) |
| Success rate | 48/50 (96%) |
| Error rate | 2/50 (4%) |
| Error types | `user_input_error` (2) |
| Runs with `thread_id` | 0 |
| Min duration | 1ms |
| Max duration | 542ms |
| Avg duration | 24.7ms |
| Median duration | 3ms |

---

## 12. Webhook / Trigger Endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/triggers` | 404 | Not implemented |
| `GET /api/apps/{slug}/triggers` | 404 | Not implemented |
| `POST /api/triggers` | 404 | Not implemented |
| `GET /api/me/triggers` | 200 | Returns `{"triggers":[]}` |

**Assessment:** Trigger creation is not exposed via API. Only listing empty triggers works.

---

## 13. Secrets Lifecycle

| Operation | CLI Command | Result |
|-----------|-------------|--------|
| List | `floom account secrets list` | `{"entries":[]}` |
| Set | `floom account secrets set TEST_SECRET test_value` | `{"ok":true,"key":"TEST_SECRET"}` |
| List after set | `floom account secrets list` | `{"entries":[{"key":"TEST_SECRET",...}]}` |
| Delete | `floom account secrets delete TEST_SECRET` | `{"ok":true,"removed":true}` |

**Assessment:** ✅ Full CRUD works correctly.

---

## 14. Deploy Lifecycle

| Step | Command | Result |
|------|---------|--------|
| Init | `floom init --name "TestApp" --slug "test-app"` | ✅ Generates valid `floom.yaml` |
| Validate | `floom validate` | ✅ `ok` |
| Deploy (dry-run) | `floom deploy --dry-run` | Requires existing `floom.yaml` |

**Generated floom.yaml:**
```yaml
name: Test App
slug: test-app
description: A test app for stress testing
category: custom
runtime: python
actions:
  run:
    label: Run
    description: A test app for stress testing
    inputs:
      - {name: input, label: Input, type: textarea, required: true}
    outputs:
      - {name: result, label: Result, type: text}
python_dependencies: []
secrets_needed: []
manifest_version: "2.0"
```

---

## 15. Petstore Manifest Inconsistency

| Source | Actions Count | Notes |
|--------|--------------|-------|
| `floom apps get petstore` | ~20 actions | Full OpenAPI-derived manifest |
| `GET /api/me/apps` | 0 actions | No `manifest` field present |
| `GET /api/apps/petstore` | 404 | Endpoint does not exist |

**Finding:** The API response for `/api/me/apps` strips the `manifest` field from proxied apps. The CLI `floom apps get` must use a different endpoint or include a `?detail=true` parameter.

---

## 16. Idempotency

| Test | Result |
|------|--------|
| Same request twice | Two separate runs created with different IDs |
| Outputs | Identical (deterministic) |

**Assessment:** No idempotency key support. Every request creates a new run. This is expected behavior for a run execution API.

---

## 17. Issues Status

| Issue | Status | Round 11 Finding |
|-------|--------|-----------------|
| #937 | 🔴 Open | Not re-tested |
| #938 | 🔴 Open | Still relevant — missing auth returns 200 |
| #966 | 🔴 Open | Confirmed resolved |
| #967 | 🔴 Open | Confirmed resolved |
| #968 | 🔴 Open | Confirmed resolved |

---

## 18. New Findings (Round 11)

| # | Finding | Severity | Recommendation |
|---|---------|----------|----------------|
| 11.1 | `offset` pagination parameter is non-functional | 🟠 High | Fix SQL offset in `/api/me/runs` |
| 11.2 | CORS missing on `/api/me/runs`, `/api/me`, `/api/workspaces` | 🟡 Medium | Add CORS middleware to all API routes |
| 11.3 | Content-Type header not validated | 🟡 Medium | Reject non-JSON Content-Type for JSON endpoints |
| 11.4 | No rate limiting on run endpoints | 🟡 Medium | Add per-token rate limits |
| 11.5 | Petstore manifest missing from `/api/me/apps` | 🟡 Medium | Include manifest or document the difference |
| 11.6 | No cache headers on any endpoint | 🟢 Low | Add `Cache-Control` for performance |
| 11.7 | `thread_id` always null | 🟢 Low | Document threading feature status |
| 11.8 | Trigger creation API not exposed | 🟢 Low | Document or implement |

---

## 19. Score Breakdown

| Category | Score | Notes |
|----------|-------|-------|
| Auth & Security | 68/100 | Missing auth → 200 is critical; good token validation |
| API Consistency | 75/100 | Pagination bug, CORS inconsistency, manifest gaps |
| Input Validation | 90/100 | Excellent JSON and field-level errors |
| Error Handling | 92/100 | Structured errors with codes and details |
| Performance | 85/100 | Fast execution, no rate limits, no caching |
| CLI UX | 85/100 | Secrets CRUD, init, validate all work |
| Observability | 80/100 | Good logs, duration tracking, no thread_id usage |
| **Overall** | **80/100** | ↑ from 78 (R8), stable from 82 (R10) |

---

## Raw Test Log

All tests performed 2026-04-29 04:58–05:04 UTC via direct IP (`65.21.90.216`) with `Host: mvp.floom.dev` header to bypass DNS.
