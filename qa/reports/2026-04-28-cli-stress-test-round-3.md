# Floom CLI Round 3 Stress Test Report

**Date:** 2026-04-28  
**CLI Version:** @floomhq/cli@0.2.1  
**API Target:** https://mvp.floom.dev  
**Tester:** depontefede@gmail.com  
**Workspace:** depontefede (ws_a5486affa24dccf63669186b)  

## Summary

| Metric | Count |
|--------|-------|
| Commands Tested | 35+ |
| Total Cases | 80+ |
| Critical Bugs Found | 1 (#937 still open) |
| Previously Filed Bugs Verified | 2 |
| Fixed Since Round 2 | 1 (#938) |
| New Findings | 2 |

---

## Previously Filed Bug Verification

### #937 - Link visibility breaks owner access 🔴 STILL BROKEN

**Status:** Unchanged since Round 1/Round 2.

**Reproduction:**
```bash
floom apps sharing set petstore --state link
# Wait 2+ seconds
floom run petstore getInventory
# → HTTP 404 {"error":"App not found"}
```

**Observation:** Non-deterministic behavior detected. When running *immediately* after setting link visibility, the app sometimes resolves (uses cached state). After a brief delay (~2s), it consistently 404s. This strongly suggests a caching/race condition in the run endpoint where visibility state is not atomically consistent with the app lookup.

**Impact:** HIGH. Owners cannot reliably run their own apps when link visibility is enabled.

**Workaround:** Set visibility back to `private` or `invited`.

---

### #938 - Silent auth failure with invalid tokens 🟡 PARTIALLY FIXED

**Status:** API calls now correctly reject invalid tokens.

**Reproduction (FIXED):**
```bash
# Save invalid token
floom auth clearly-invalid-token --api-url https://mvp.floom.dev
# → "Logged in as local at https://mvp.floom.dev"

# API call now correctly fails
floom status
# → HTTP 401 {"error":"Authentication required...","code":"auth_required"}
```

**Remaining Issue:** The `floom auth` command itself still accepts any string and reports "Logged in as local" without pinging the server. This is a UX bug — users may believe they're authenticated when they aren't. The token should be validated at save time.

**Recommendation:** Add a `GET /api/v1/me` or similar validation ping to `floom auth` before writing the token to config.

---

## Command Matrix Results

### Auth
| Test | Result | Notes |
|------|--------|-------|
| `auth <valid_token>` | ✅ | Works, token saved |
| `auth <invalid_token>` | ⚠️ | Saved without validation (see #938) |
| `auth --api-url` | ✅ | URL saved correctly |

### Apps
| Test | Result | Notes |
|------|--------|-------|
| `apps list` | ✅ | Lists owned apps |
| `apps get petstore` | ✅ | Returns full app object |
| `apps create` | ✅ | Creates app successfully |
| `apps update` | ✅ | Updates description |
| `apps delete` | ✅ | Deletes app (tested on temp) |
| `apps validate` | ✅ | Validates floom.yaml |
| `apps deploy` | ✅ | Deploys successfully |
| `apps deploy --dry-run` | ✅ | Dry run works |
| `apps source openapi` | ⚠️ | Works but prints broken pipe warning |
| `apps secrets set` | ✅ | Sets secret |
| `apps secrets get` | ✅ | Returns masked secret |
| `apps secrets rm` | ✅ | Removes secret |
| `apps sharing set private` | ✅ | Works |
| `apps sharing set invited` | ✅ | Works |
| `apps sharing set link` | ⚠️ | Sets correctly but breaks `run` (#937) |

### Run
| Test | Result | Notes |
|------|--------|-------|
| `run petstore getInventory` | ✅ | Returns pending run ID |
| `run petstore invalidAction` | ✅ | Returns HTTP 404 |
| `run petstore --inputs-json` | ✅ | Works |
| `run petstore --inputs-stdin` | ✅ | Works |
| `run hash "text"` | ✅ | Works |
| `run hash "<script>alert(1)</script>"` | ✅ | XSS-safe, properly hashed |
| `run base64 "日本語テスト"` | ✅ | UTF-8 safe |
| `run json-format` | ⚠️ | Input field is `text` not `json` — naming mismatch |
| `run floom-this` | ✅ | Works |

### Status
| Test | Result | Notes |
|------|--------|-------|
| `status` (valid token) | ✅ | Returns user info |
| `status` (invalid token) | ✅ | Returns HTTP 401 (FIXED) |

### Store
| Test | Result | Notes |
|------|--------|-------|
| `store list` | ✅ | Returns public apps |
| `store get json-format` | ✅ | Returns app metadata |
| `store search` | ✅ | Returns results |
| `store categories` | ✅ | Returns categories |

### Runs
| Test | Result | Notes |
|------|--------|-------|
| `runs list --slug petstore` | ✅ | Returns run history |
| `runs get <id>` | ✅ | Returns run details |

### Workspaces
| Test | Result | Notes |
|------|--------|-------|
| `workspaces list` | ✅ | Returns workspaces |
| `workspaces get` | ✅ | Returns current workspace |
| `workspaces set` | ✅ | Switches workspace |
| `workspaces rename` | ⚠️ | Name persists but may not reflect in UI immediately |

### Account
| Test | Result | Notes |
|------|--------|-------|
| `account me` | ✅ | Returns user info |
| `account set-name` | ✅ | Updates name |

### Feedback
| Test | Result | Notes |
|------|--------|-------|
| `feedback submit` | ✅ | Creates GitHub issue (#957) |

### API
| Test | Result | Notes |
|------|--------|-------|
| `api GET /api/hub/mine` | ✅ | Returns apps |

---

## New Findings

### 1. json-format store app input naming
The `json-format` app accepts an input field named `text`, not `json`. This is confusing given the app name. Documentation or the app's input schema should clarify this.

### 2. Broken pipe in `apps source openapi`
When piping or truncating output, `floom apps source openapi petstore` prints a shell "Broken pipe" warning from `floom-api.sh:129`. This is a minor CLI polish issue.

---

## Recommendations

1. **Priority 1: Fix #937** — Link visibility should not break owner access. The run endpoint needs to be consistent with the apps get endpoint regarding visibility state.

2. **Priority 2: Complete #938 fix** — Add server-side token validation to `floom auth` command.

3. **Priority 3: Review json-format inputs** — Consider aliasing or documenting the `text` field better.

4. **Priority 4: Fix broken pipe** — Handle pipe errors gracefully in `floom-api.sh`.

---

*Report generated by automated CLI stress test suite.*
