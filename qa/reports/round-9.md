# Round 9 QA Report — CLI Stress Test
**Date:** 2026-04-29  
**Tester:** federicodeponte  
**CLI Version:** 0.2.7 (via `npx @floomhq/cli@latest`)  
**API Target:** `https://mvp.floom.dev`  
**Backend Version:** 0.4.0-mvp.5

## Tokens Tested

| Token | Source | Status |
|-------|--------|--------|
| `floom_agent_lXhsevTDaKkwALZn7E3QuueJGdtH5G60` | User-provided for Round 9 | ❌ **INVALID** — HTTP 401 on all endpoints |
| `floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea` | Rounds 7-8 | ✅ **VALID** — Workspace `depontefede` |

> **Note:** The user-provided token for Round 9 was rejected by the backend with `invalid_agent_token`. All substantive functional tests below were performed with the still-valid Round 7-8 token to maintain test coverage.

---

## 1. Auth & Token Handling

### 1.1 New (Invalid) Token
```bash
floom auth floom_agent_lXhsevTDaKkwALZn7E3QuueJGdtH5G60
# → ERROR: Token rejected by https://mvp.floom.dev (HTTP 401).
#   Mint a fresh token at https://mvp.floom.dev/me/agent-keys and try again.
```
**Assessment:** ✅ CLI correctly rejects invalid tokens server-side with a clear, actionable error message. This is a major improvement over 0.2.1 behavior.

### 1.2 Valid Token
```bash
floom auth floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea
# → Logged in as depontefede@gmail.com at https://mvp.floom.dev
```
**Assessment:** ✅ Works correctly.

---

## 2. Core Commands

| Command | Status | Notes |
|---------|--------|-------|
| `floom auth <token>` | ✅ | Client-side format check + server-side validation |
| `floom status` | ✅ | Shows apps and recent runs correctly |
| `floom apps list` | ✅ | Lists `petstore` with 58 runs |
| `floom validate` | ✅ | Returns `floom.yaml not found` (expected, no yaml in cwd) |
| `floom deploy --help` | ✅ | Help text accurate |
| `floom init --help` | ✅ | Help text accurate |
| `floom account context get` | ✅ | Returns `{"user_profile":{},"workspace_profile":{}}` |
| `floom api GET /api/me/runs` | ✅ | Returns full runs array |

---

## 3. Store Apps Functional Test

All tested with `floom run <slug> '{"text":"round9"}'`:

| App | Status | Latency | Notes |
|-----|--------|---------|-------|
| `hash` | ✅ PASS | ~3-9ms | SHA256 digest returned |
| `base64` | ✅ PASS | ~4ms | Encode/decode works |
| `uuid` | ✅ PASS | ~3ms | UUID v4 generated |
| `slugify` | ✅ PASS | ~4ms | URL-safe slug returned |
| `word-count` | ✅ PASS | ~3ms | Count accurate |
| `json-format` | ✅ PASS | ~4ms | **Requires valid JSON string in `text` field**; fails with HTTP 400 if input is not valid JSON |
| `url-encode` | ✅ PASS | ~3ms | Encode/decode works |

**Assessment:** ✅ All 7 store apps functional. The `json-format` failure in initial testing was a **test input error**, not a bug.

---

## 4. Proxied Apps

| App | Status | Latency | Notes |
|-----|--------|---------|-------|
| `petstore` | ✅ PASS | ~550-650ms | `getInventory` returns inventory counts |

---

## 5. Concurrent Runs Stress Test

Launched 5 concurrent `hash` runs via direct API:
```bash
for i in 1..5; do
  curl -X POST /api/hash/run -d '{"text":"concurrent'"$i"'"}'
done
```

| Run ID | Status |
|--------|--------|
| run_0yrsywyd644k | ✅ success |
| run_0b5v2m5kht1h | ✅ success |
| run_pjm9ar56vxxd | ✅ success |
| run_2524f3jrks3w | ✅ success |
| run_76qwx09gmxnz | ✅ success |

**Assessment:** ✅ All 5 concurrent runs completed successfully. No 502s observed in this round.

---

## 6. API Endpoint Changes Detected

| Endpoint | Round 8 Status | Round 9 Status | Change |
|----------|---------------|----------------|--------|
| `GET /api/me` | 200 (user profile) | **404** | ⚠️ **Removed or relocated** |
| `GET /api/me/apps` | 200 | **404** | ⚠️ **Removed or relocated** |
| `GET /api/me/runs` | 200 | ✅ 200 | Unchanged |
| `GET /api/workspaces` | 200 | ✅ 200 | Unchanged |
| `GET /api/hub/store` | 200 (store list) | **404 / {"error":"App not found"}** | ⚠️ **Routing changed** |
| `GET /api/hub` | Not tested | ✅ 200 (store list) | **New replacement endpoint** |

### Impact Assessment
- `floom api GET /api/hub/store` now fails because `/api/hub/store` is interpreted as an app route (`hub/store` as slug) rather than a dedicated store endpoint.
- **Workaround:** Use `floom api GET /api/hub` instead.
- This may break existing scripts/documentation referencing `/api/hub/store`.

---

## 7. Error Handling

| Scenario | Status | Behavior |
|----------|--------|----------|
| Invalid JSON body | ✅ | HTTP 400 with clear message |
| Non-existent app slug | ✅ | HTTP 404 with clear message |
| Invalid auth token | ✅ | HTTP 401 with `invalid_agent_token` code and hint |
| Missing required input field | ✅ | HTTP 400 naming the missing field |

---

## 8. CLI Version Drift Check

```bash
npx @floomhq/cli@latest --version
# → 0.2.7
```
✅ Version reported by CLI matches expected latest.

---

## Issues Summary

### New Findings (Round 9)

1. **User-provided token invalid** — `floom_agent_lXhsevTDaKkwALZn7E3QuueJGdtH5G60` returns HTTP 401 across all endpoints. Token may be revoked, expired, or created for a different workspace/URL.

2. **API endpoint migration** — `/api/hub/store` no longer works; replaced by `/api/hub`. `/api/me` and `/api/me/apps` return 404. This is a breaking API change.

### Previously Filed Issues Status

| Issue | Status | Round 9 Assessment |
|-------|--------|-------------------|
| #937 | 🔴 Open | Not re-tested (requires changing app visibility) |
| #938 | 🔴 Open | **Improved** — CLI 0.2.7 now validates tokens server-side during auth |
| #966 | 🔴 Open | Confirmed resolved — all store apps working |
| #967 | 🔴 Open | Confirmed resolved — 0.2.7 is stable and consistent |
| #968 | 🔴 Open | Confirmed resolved — 0.2.7 supersedes broken 0.2.4 |

---

## Score (Round 9)

| Category | Score | Notes |
|----------|-------|-------|
| Auth & Security | 90/100 | Server-side validation works; token lifecycle mgmt unclear |
| Core Functionality | 92/100 | All apps work; json-format requires correct input |
| API Stability | 75/100 | Endpoint migration (`/api/hub/store` → `/api/hub`) is breaking |
| Error Handling | 90/100 | Clear HTTP codes and messages |
| Concurrent Load | 95/100 | 5 concurrent runs all succeeded |
| **Overall** | **88/100** | Improvement from Round 8's 78/100 |

---

## Recommendations

1. **Close #966, #967, #968** — All resolved by 0.2.5+ redesign.
2. **Update #938** — CLI now validates server-side; note remaining backend behavior if any.
3. **Document API changes:**
   - `/api/hub/store` → `/api/hub`
   - `/api/me` and `/api/me/apps` removed (or relocated — verify with backend team)
4. **Deprecate or redirect `/api/hub/store`** to avoid breaking existing integrations.
5. **Verify token `floom_agent_lXhsevTDaKkwALZn7E3QuueJGdtH5G60`** — check if revoked, expired, or scoped to a different API URL.
