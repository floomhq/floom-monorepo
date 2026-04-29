# Floom CLI Round 6 Stress Test Report

**Date:** 2026-04-29
**CLI Version Tested:** @floomhq/cli@0.2.4 (broken), @floomhq/cli@0.2.1 (working)
**API Target:** https://mvp.floom.dev
**Tester:** depontefede@gmail.com
**Workspace:** depontefede (ws_a5486affa24dccf63669186b)

## Executive Summary

Round 6 confirmed that **CLI 0.2.4 is still broken** - the packaging inconsistency from #967 was not fixed. All deep-dive testing was performed using the working 0.2.1 build.

| Metric | Count |
|--------|-------|
| Commands Tested | 60+ |
| Total Cases | 140+ |
| Critical Issues Confirmed | 1 (#967 still open in 0.2.4) |
| Features Verified Working | 20+ |
| Minor Findings | 3 |

## CLI 0.2.4 Packaging Status: STILL BROKEN

**Version 0.2.4 contains the same broken build as 0.2.2.**

Verified on fresh npx install (cache df408f5af8aa117d):
- package.json: version 0.2.4
- floom-run.sh: BROKEN (2583 bytes, missing --action support)
- Missing files: floom-runs.sh, floom-store.sh, floom-triggers.sh, floom-workspaces.sh, floom-feedback.sh

**Recommendation:** Do not use 0.2.4. Use 0.2.1 or fix the build pipeline before publishing 0.2.5.

## Bug Re-evaluation with Working CLI

### #937 - Link visibility -> CONFIRMED FIXED
Tested with correct CLI build. Both apps get and run work while link visibility is active.

### #938 - Auth validation -> PARTIALLY FIXED
floom_agent_* prefixed tokens are validated. Other formats are not.

### #966 - Store apps network -> CONFIRMED FIXED
All Python store apps work correctly.

### #967 - CLI packaging -> STILL BROKEN IN 0.2.4
No fix deployed. New version 0.2.4 contains same broken build.

## Feature Matrix Results

### Triggers
| Test | Result | Notes |
|------|--------|-------|
| triggers create webhook | OK | Returns URL and HMAC secret |
| triggers create schedule | OK | Returns next_run_at |
| triggers list | OK | Lists all triggers |
| triggers delete | OK | Deletes trigger |
| webhook fire with HMAC | OK | Signature validation works |
| webhook fire without HMAC | OK | Returns 401 with helpful hint |

### App Lifecycle
| Test | Result | Notes |
|------|--------|-------|
| apps fork | OK | Creates forked app |
| apps install | OK | Installs store app |
| apps uninstall | OK | Removes installed app |
| apps installed | OK | Lists installed apps |
| apps delete | OK | Deletes owned app |

### Workspaces
| Test | Result | Notes |
|------|--------|-------|
| workspaces list | OK | Lists workspaces |
| workspaces me | OK | Shows user + active workspace |
| workspaces get | OK | Requires workspace-id arg |
| workspaces update | OK | Renames workspace |
| workspaces create | OK | Creates new workspace |
| workspaces delete | OK | Deletes workspace |
| workspaces switch | OK | Switches workspace |

### Account
| Test | Result | Notes |
|------|--------|-------|
| account secrets set | OK | Sets workspace secret |
| account secrets list | OK | Lists secrets |
| account secrets delete | OK | Removes secret |
| account agent-tokens list | OK | Requires user session |

### Auth
| Test | Result | Notes |
|------|--------|-------|
| auth whoami | OK | Shows identity |
| auth --show | OK | Shows redacted config |
| auth logout | OK | Clears config |
| auth with valid token | OK | Validates and saves |
| auth with invalid floom_agent_* | OK | Rejected with 401 |
| auth with random string | FAIL | Saved without validation |

### Reviews
| Test | Result | Notes |
|------|--------|-------|
| reviews submit | OK | Submits review |
| reviews list | OK | Lists reviews |

**Minor bug:** submit response shows author_name: anonymous, but list shows author_name: Federico De Ponte.

### Rate Limits
| Test | Result | Notes |
|------|--------|-------|
| rate-limit get | OK | Shows current limit |
| rate-limit set | OK | Sets new limit |

### Deploy / Init
| Test | Result | Notes |
|------|--------|-------|
| deploy | OK | Publishes app |
| deploy --dry-run | OK | Preview mode |
| init --type custom | OK | Scaffolds custom app |
| init --openapi-url | OK | Scaffolds proxied app |

### Secrets
| Test | Result | Notes |
|------|--------|-------|
| secret-policies list | OK | Shows policies |
| creator-secrets set | OK | Only for declared secrets |
| creator-secrets get | FAIL | Subcommand does not exist |

### Renderer
| Test | Result | Notes |
|------|--------|-------|
| renderer get | OK | Returns 404 if not set |

### Quota
| Test | Result | Notes |
|------|--------|-------|
| quota | FAIL | Unknown subcommand list |

### Jobs
| Test | Result | Notes |
|------|--------|-------|
| jobs create | OK | Fails for non-async apps |
| jobs list | FAIL | Unknown subcommand |

## Security Observations

1. Webhook HMAC validation is properly implemented with helpful error messages.
2. SQL injection attempts are blocked at the system level.
3. XSS and path traversal payloads pass through to external APIs (expected for proxied apps).

## Recommendations

1. P0: Fix CLI 0.2.4 packaging before any further releases.
2. P1: Complete auth validation for all token formats.
3. P2: Fix inconsistent author_name in reviews API.
4. P3: Add missing creator-secrets get subcommand.
5. P3: Fix quota command routing.

## QA Artifacts

- Report: qa/reports/2026-04-29-cli-stress-test-round-6.md
- GitHub Issues: #937 (resolved), #938 (partial), #966 (resolved), #967 (open), #968 (feedback)
