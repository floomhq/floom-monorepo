# Round 10 QA Report — Super Deep Dive
**Date:** 2026-04-29  
**Tester:** federicodeponte  
**CLI Version:** 0.2.8 (via `npx @floomhq/cli@latest`)  
**API Target:** `https://mvp.floom.dev`  
**Backend Version:** 0.4.0-mvp.5  
**Methodology:** Direct IP access (`65.21.90.216` + `Host: mvp.floom.dev`) to bypass DNS flakiness observed in Round 9

---

## Executive Summary

Round 10 is a **security-focused, edge-case deep dive** across auth, input validation, concurrent load, payload limits, CORS, and CLI behavior gaps. The system is **functionally stable** but exhibits **several security and UX concerns** that should be addressed before broader adoption.

**Overall Score: 82/100** (Security: 70, Functionality: 90, API Design: 78, CLI UX: 82, Reliability: 88)

---

## 1. Token Status

| Token | Status | Detail |
|-------|--------|--------|
| `floom_agent_lXhsevTDaKkwALZn7E3QuueJGdtH5G60` | ❌ **INVALID** | HTTP 401 on all endpoints. Not found, revoked, or workspace-invalid. |
| `floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea` | ✅ **VALID** | Workspace `depontefede` (ws_a5486affa24dccf63669186b), admin role. Used for all tests. |

---

## 2. Auth & Security Deep Dive

### 2.1 Token Validation Matrix

| Scenario | HTTP Status | Body | Assessment |
|----------|-------------|------|------------|
| Valid token | 200 | Runs data | ✅ Correct |
| Invalid `floom_agent_*` token | 401 | `{"error":"invalid_agent_token",...}` | ✅ Correct |
| Malformed prefix (`bad_token_123`) | 401 | Same as above | ✅ Correct |
| **Missing Authorization header** | **200** | `{"runs":[]}` | ⚠️ **SECURITY CONCERN** — Should be 401 |
| **Empty bearer (`Bearer `)** | **200** | `{"runs":[]}` | ⚠️ **SECURITY CONCERN** — Should be 401 |
| **Basic auth scheme** | **200** | `{"runs":[]}` | ⚠️ **SECURITY CONCERN** — Should be 401 or 400 |
| Extra whitespace in token | 200 | `{"runs":[]}` | ⚠️ Treated as empty — should trim or 401 |
| 500-char fake token | 200 | `{"runs":[]}` | ⚠️ Treated as empty — length limit needed? |
| SQL injection in token | 200 | `{"runs":[]}` | ⚠️ Treated as empty |
| XSS in token | 200 | `{"runs":[]}` | ⚠️ Treated as empty |
| Unicode in token | 200 | `{"runs":[]}` | ⚠️ Treated as empty |
| Newline/header injection | 200 | `{"runs":[]}` | ⚠️ Treated as empty |

**Finding:** The API has **two distinct auth paths**:
1. **Well-formed `floom_agent_*` tokens** → Server validates and returns 401 if invalid ✅
2. **Malformed/missing/empty auth** → Treated as **anonymous/unauthenticated** and returns 200 with empty data ⚠️

This is a **security anti-pattern**. An unauthenticated request to `/api/me/runs` should return **401**, not 200 with an empty array. This makes it impossible for clients to distinguish between "no runs" and "not authenticated."

**Recommendation:** Return HTTP 401 for ALL requests to authenticated endpoints when auth is missing, empty, or malformed.

### 2.2 CLI Auth Edge Cases

| Input | CLI Behavior | Assessment |
|-------|--------------|------------|
| Empty string `""` | Prints `floom auth` **help text** | ❌ **BUG** — Should error "token required" |
| `floom_agent_` (no suffix) | `ERROR: Invalid Agent token format.` | ✅ Correct |
| 31-char suffix | `ERROR: Invalid Agent token format.` | ✅ Correct |
| 33-char suffix | `ERROR: Token rejected... (HTTP 401)` | ✅ Passed to server correctly |
| 32-char invalid suffix | `ERROR: Token rejected... (HTTP 401)` | ✅ Passed to server correctly |

---

## 3. Input Validation Fuzzing

### 3.1 hash App

| Input | Status | Error | Assessment |
|-------|--------|-------|------------|
| `{}` (missing field) | Rejected | `Missing required input: text` | ✅ Correct |
| `{"text":null}` | Rejected | `Missing required input: text` | ✅ Correct |
| `{"text":""}` | Rejected | `Missing required input: text` | ⚠️ Empty string != missing — debatable |
| `{"text":123}` | Run then error | `HTTP 400: text must be a string` | ✅ Good type validation |
| `{"text":["a","b"]}` | Run then error | `HTTP 400: text must be a string` | ✅ Good type validation |
| `{"text":{"nested":true}}` | Run then error | `HTTP 400: text must be a string` | ✅ Good type validation |
| `{"text":true}` | Run then error | *(pending)* | ⚠️ Should reject at API level, not run |
| `{"text":3.14}` | Run then error | *(pending)* | ⚠️ Should reject at API level, not run |
| `{"text":"test","algorithm":"md6"}` | Rejected | `Input algorithm must be one of: md5, sha1, sha256, sha512` | ✅ Excellent |
| `{"text":"<script>alert(1)</script>"}` | Success | Hashed normally | ✅ XSS-safe |
| `{"text":"' OR '1'='1"}` | Success | Hashed normally | ✅ SQLi-safe |
| `{"text":"Hello 🌍 日本語 🔥"}` | Success | Hashed normally | ✅ Unicode-safe |
| `{"text":"B"*10000}` (10KB) | Success | 4ms | ✅ Large payload OK |
| `{"text":"M"*1000000}` (1MB) | Success | 16ms | ✅ Large payload OK |

### 3.2 base64 App

| Input | Status | Assessment |
|-------|--------|------------|
| `{"text":"hello","operation":"hack"}` | Success (defaults to encode?) | ⚠️ **Does not validate operation** — should reject invalid ops |

### 3.3 petstore App

| Input | Status | Error | Assessment |
|-------|--------|-------|------------|
| `{"action":"getInventory"}` | Success | — | ✅ Correct |
| `{"action":"deleteEverything"}` | Rejected | `Action "deleteEverything" not found` | ✅ Good validation |
| `{}` (no action) | Run then error | `HTTP 405: no data` | ⚠️ Should reject at API level |

### 3.4 Non-existent App

| Scenario | Status | Body | Assessment |
|----------|--------|------|------------|
| `POST /api/fakeapp/run` | 404 | `{"error":"App not found: fakeapp"}` | ✅ Clear error |
| `POST /api/../../../etc/passwd/run` | 200 (SPA HTML) | Page not found HTML | ✅ Path traversal safe |

---

## 4. Concurrent Load & Rate Limiting

### 4.1 20 Concurrent Runs
```bash
for i in 1..20; do
  curl -X POST /api/hash/run -d '{"text":"concurrent"}' &
done
```

**Result:** ✅ **All 20 runs succeeded** (status: `pending` → `success`). No 502s, no errors.

### 4.2 50 Rapid-Fire Requests
```bash
for i in 1..50; do
  curl -X POST /api/hash/run -d '{"text":"rate"}'
done
```

**Result:** ✅ **All 50 returned HTTP 200**. **No rate limiting detected.**

**Concern:** No rate limiting on authenticated run endpoints could enable abuse. Consider per-token or per-IP rate limits.

---

## 5. Payload Size Limits

| Size | Result | Status Code |
|------|--------|-------------|
| 10KB | ✅ Accepted | 200 |
| 100KB | ✅ Accepted | 200 |
| 1MB | ✅ Accepted | 200 |
| 5MB | ❌ Rejected | **413 Request Entity Too Large** (nginx) |
| 10MB | ❌ Rejected | **413 Request Entity Too Large** (nginx) |

**Finding:** nginx `client_max_body_size` appears to be set between 1MB and 5MB. This is reasonable but should be documented.

---

## 6. CORS Analysis

| Test | Status | CORS Headers | Assessment |
|------|--------|--------------|------------|
| `OPTIONS /api/hash/run` | 204 | **None** | ❌ **No CORS preflight support** |
| `POST /api/hash/run` with `Origin: https://evil.com` | 200 | **None** | ❌ **No CORS origin validation** |

**Finding:** The API does **not return any CORS headers**. This means:
- Browser-based clients on different origins **cannot use the API**
- There is **no origin whitelist**
- The 204 OPTIONS response is likely from the SPA catch-all, not actual CORS handling

**Recommendation:** Implement proper CORS middleware with configurable allowed origins.

---

## 7. API Endpoint Surface

### 7.1 Discovered Endpoints (GET)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/health` | 200 | Public, no auth |
| `/api/me` | 200 | User profile |
| `/api/me/runs` | 200 | Runs list (⚠️ no auth required) |
| `/api/me/apps` | 200 | Apps list |
| `/api/session/me` | 200 | Same as `/api/me` |
| `/api/workspaces` | 200 | Workspace list |
| `/api/hub` | 200 | Store apps list |
| `/api/hub/store` | 200 | Same as `/api/hub` |
| `/api/me/threads` | 404 | Not implemented |
| `/api/me/settings` | 404 | Not implemented |
| `/api/billing` | 404 | Not implemented |
| `/api/integrations` | 404 | Not implemented |
| `/api/exports` | 404 | Not implemented |
| `/api/feedback` | 403 | Requires different auth |
| `/api/admin` | 403 | Requires admin privileges |

### 7.2 App Run Endpoints (POST)

| App | Empty Body | Assessment |
|-----|------------|------------|
| `hash` | 400 | ✅ Requires `text` |
| `base64` | 400 | ✅ Requires input |
| `uuid` | 200 | ⚠️ No input needed — acceptable |
| `slugify` | 400 | ✅ Requires `text` |
| `word-count` | 400 | ✅ Requires `text` |
| `json-format` | 400 | ✅ Requires `text` |
| `url-encode` | 400 | ✅ Requires `text` |
| `petstore` | 200 | ⚠️ Accepts empty but fails at runtime |

---

## 8. CLI Behavior Gaps

### 8.1 Bugs

| # | Bug | Severity |
|---|-----|----------|
| 1 | `floom auth ""` prints help text instead of erroring | Low |
| 2 | `floom api POST ... --data '{...}'` triggers macOS curl plist parser warnings | Low |
| 3 | `--data` body parsing fails with `malformed_json` on valid-looking JSON | Medium |

### 8.2 Verified Working

| Feature | Status |
|---------|--------|
| `floom run <slug> '<json>'` | ✅ |
| `floom run <slug> --input key=val` | ✅ |
| `floom run <slug> --json` | ✅ |
| `floom api GET/POST <path>` | ✅ |
| `floom status` | ✅ |
| `floom apps list` | ✅ |
| `floom apps get <slug>` | ✅ |
| `floom account context get` | ✅ |
| `floom account secrets list` | ✅ |
| `floom validate` | ✅ |

---

## 9. DNS Reliability

| Test | Result |
|------|--------|
| 10 sequential DNS lookups | ✅ 10/10 OK |
| 10 sequential curl requests via DNS | ✅ 10/10 HTTP 200 |

**Assessment:** DNS was stable during Round 10. The flakiness observed in Round 9 was likely transient.

---

## 10. Issues Status Update

| Issue | Status | Round 10 Finding |
|-------|--------|-----------------|
| #937 | 🔴 Open | Not re-tested |
| #938 | 🔴 Open | **Partially improved** — CLI validates server-side, but API still returns 200 for missing auth |
| #966 | 🔴 Open | Confirmed resolved |
| #967 | 🔴 Open | Confirmed resolved |
| #968 | 🔴 Open | Confirmed resolved |

---

## 11. New Recommendations (from Round 10)

### Critical
1. **Fix unauthenticated access to `/api/me/runs`** — Return 401, not 200 with empty array.
2. **Add rate limiting** — 50 requests in a loop without any throttle is a DoS vector.

### High
3. **Implement CORS** — Current lack of CORS headers blocks browser-based integrations.
4. **Validate `base64` operation parameter** — Reject invalid operations at API level.
5. **Validate `petstore` empty body** — Return 400 if required `action` is missing.

### Medium
6. **Document nginx payload limit** — Users need to know the ~1-5MB body size limit.
7. **Fix `floom auth ""`** — Should return error, not help text.
8. **Fix CLI `--data` parsing** — macOS curl warnings and JSON parsing issues.

### Low
9. **Distinguish empty string from missing field** — `{"text":""}` is not the same as `{}`.
10. **Add `Access-Control-*` headers to OPTIONS responses** — Even if just `Access-Control-Allow-Origin: *` for public endpoints.

---

## Raw Test Log

Full shell transcripts available in the test session history. All tests performed 2026-04-29 04:34–04:43 UTC.
