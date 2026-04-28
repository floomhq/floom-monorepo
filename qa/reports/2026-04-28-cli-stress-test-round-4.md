# Floom CLI Round 4 Stress Test Report

**Date:** 2026-04-28  
**CLI Version:** @floomhq/cli@0.2.1  
**API Target:** https://mvp.floom.dev  
**Tester:** depontefede@gmail.com  
**Workspace:** depontefede (ws_a5486affa24dccf63669186b)  

## Summary

| Metric | Count |
|--------|-------|
| Commands Tested | 40+ |
| Total Cases | 90+ |
| Critical Bugs Found | 1 NEW (Python store apps) |
| Previously Filed Bugs Verified | 2 |
| Fixed Since Round 3 | 0 |
| New Findings | 3 |

---

## Previously Filed Bug Verification

### #937 - Link visibility breaks owner access 🔴 STILL BROKEN

**Status:** Unchanged since Round 1/2/3.

**Reproduction:**
```bash
floom apps sharing set petstore --state link
floom apps get petstore
# → HTTP 404 {"error":"App not found"}

floom run petstore --action getInventory
# → HTTP 404 {"error":"App not found","code":"not_found"}
```

**Impact:** HIGH. Owners cannot access their own apps when link visibility is enabled.

**Workaround:** Set visibility back to `private`.

---

### #938 - Silent auth failure with invalid tokens 🟡 PARTIALLY FIXED

**Status:** Same as Round 3.

**Fixed:** API calls now correctly return HTTP 401 for invalid tokens.

**Still broken:** `floom auth clearly-invalid-token` saves any string without server validation.

---

## 🆕 NEW CRITICAL BUG: Python Store Apps Failing with `network_unreachable`

**Severity:** CRITICAL

**Summary:** All Python runtime store apps are failing with `error: fetch failed, error_type: network_unreachable`. Proxied apps work correctly.

**Affected Apps:**
| App | Status |
|-----|--------|
| hash | ❌ Error |
| base64 | ❌ Error |
| uuid | ❌ Error |
| slugify | ❌ Error |
| word-count | ❌ Error |
| json-format | ❌ Error (confirmed in Round 3) |
| url-encode | Likely affected (same runtime) |

**Working Apps:**
| App | Status |
|-----|--------|
| petstore (proxied) | ✅ Success |

**Error Pattern:**
```json
{
  "run_id": "run_xxx",
  "status": "error",
  "error": "fetch failed",
  "error_type": "network_unreachable",
  "model": "python",
  "duration_ms": 2
}
```

**Root Cause Hypothesis:** The Python sandbox/runtime environment has lost outbound network connectivity. This could be a Docker networking issue, firewall rule change, or infrastructure problem on the backend.

**Impact:** CRITICAL. All store apps are effectively broken. Users cannot use any utility apps.

**GitHub Issue Filed:** #966

---

## Command Matrix Results

### Auth
| Test | Result | Notes |
|------|--------|-------|
| `auth <valid_token>` | ✅ | Works |
| `auth <invalid_token>` | ⚠️ | Saves without validation (#938) |
| `status` (valid) | ✅ | Returns user + apps + runs |
| `status` (invalid) | ✅ | Returns HTTP 401 (fixed) |

### Apps
| Test | Result | Notes |
|------|--------|-------|
| `apps list` | ✅ | Lists owned apps |
| `apps get petstore` | ✅ | Returns full app object |
| `apps about petstore` | ✅ | Returns app details |
| `apps installed` | ✅ | Returns empty array |
| `apps delete <slug>` | ✅ | Works on owned apps |
| `apps update` | ✅ | Updates metadata |
| `apps sharing get` | ✅ | Returns visibility + invites + review |
| `apps sharing set private` | ✅ | Works |
| `apps sharing set invited` | ✅ | Works |
| `apps sharing set link` | ⚠️ | Sets correctly but breaks access (#937) |
| `apps creator-secrets` | ✅ | Set/get/delete work |
| `apps source get` | ✅ | Returns manifest + install info |
| `apps source openapi` | ⚠️ | Works but broken pipe warning |
| `apps reviews` | ✅ | Returns reviews |
| `apps reviews submit` | ✅ | Submits review |

### Run
| Test | Result | Notes |
|------|--------|-------|
| `run petstore --action getInventory` | ✅ | Success |
| `run petstore --action addPet` | ⚠️ | Returns error (expected, missing inputs) |
| `run hash '{"text":"test"}'` | 🔴 | `network_unreachable` |
| `run base64 '{"text":"test"}'` | 🔴 | `network_unreachable` |
| `run uuid '{"version":"v4"}'` | 🔴 | `network_unreachable` |
| `run slugify '{"text":"test"}'` | 🔴 | `network_unreachable` |
| `run word-count '{"text":"test"}'` | 🔴 | `network_unreachable` |
| `run floom-this '{"text":"test"}'` | ⚠️ | Requires `repo_url` not `text` |

### Store
| Test | Result | Notes |
|------|--------|-------|
| `store list` | ✅ | Returns public apps |
| `store get hash` | ✅ | Returns metadata |
| `store search` | ✅ | Returns results |
| `store categories` | ❌ | Unknown subcommand |

### Runs
| Test | Result | Notes |
|------|--------|-------|
| `runs list` | ✅ | Returns run history |
| `runs get <id>` | ✅ | Returns run details |
| `runs list --slug petstore` | ✅ | Filtered by slug |

### Workspaces
| Test | Result | Notes |
|------|--------|-------|
| `workspaces list` | ✅ | Returns workspaces |
| `workspaces get` | ✅ | Returns current workspace |
| `workspaces set` | ✅ | Switches workspace |
| `workspaces rename` | ✅ | Renames workspace |

### Account
| Test | Result | Notes |
|------|--------|-------|
| `account --help` | ✅ | Shows correct subcommands |
| `account me` | ❌ | Unknown resource |
| `account agent-tokens list` | ⚠️ | Requires user session (401) |
| `account secrets` | ✅ | Set/list/delete work |

### Jobs
| Test | Result | Notes |
|------|--------|-------|
| `jobs create` | ✅ | Creates async job |
| `jobs get` | ✅ | Returns job details |
| `jobs cancel` | ✅ | Cancels job |

### Triggers
| Test | Result | Notes |
|------|--------|-------|
| `triggers list` | ✅ | Returns triggers |

### Feedback
| Test | Result | Notes |
|------|--------|-------|
| `feedback submit` | ✅ | Creates GitHub issue (#966) |

### API
| Test | Result | Notes |
|------|--------|-------|
| `api GET /api/hub/mine` | ✅ | Returns apps |
| `api GET /api/v1/me` | ❌ | 404 Not Found |

### Validate / Deploy
| Test | Result | Notes |
|------|--------|-------|
| `validate floom.yaml` | ✅ | Validates YAML |
| `deploy --dry-run` | ✅ | Dry run works |
| `deploy` | ✅ | Deploys successfully |

---

## Additional Findings

### 1. CLI Command Naming Inconsistencies
- `store categories` — doesn't exist (only `list`, `search`, `get`)
- `account me` — doesn't exist (account manages secrets and tokens)
- `apps validate` — doesn't exist as subcommand (use top-level `validate`)

These are minor UX/documentation issues.

### 2. floom-this and json-format Input Naming
- `floom-this` requires `repo_url` not `text`
- `json-format` requires `text` not `json`

Both are naming mismatches between app name and primary input field.

### 3. Review Author Display
Reviews show real author name (`author_name: "Federico De Ponte"`) rather than workspace/anonymous handle. Privacy concern noted in Round 1.

---

## Recommendations

1. **P0: Fix Python runtime network connectivity** — All store apps are broken. Check Docker networking, firewall rules, or sandbox egress configuration.

2. **P1: Fix #937** — Link visibility should not break owner access.

3. **P2: Complete #938 fix** — Add token validation to `floom auth`.

4. **P3: Document CLI commands** — Clarify which commands exist and their correct syntax.

---

*Report generated by automated CLI stress test suite.*
