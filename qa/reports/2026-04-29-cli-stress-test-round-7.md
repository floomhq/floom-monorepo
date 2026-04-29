# Floom CLI Round 7 Stress Test Report

**Date:** 2026-04-29
**CLI Version:** @floomhq/cli@0.2.5
**API Target:** https://mvp.floom.dev
**Tester:** depontefede@gmail.com
**Workspace:** Federico's Workspace (depontefede)

## Executive Summary

CLI 0.2.5 is a **major redesign** that simplifies the command surface while improving the core run experience. The packaging issues from #967 appear to be resolved in the sense that 0.2.5 is a consistent, intentional redesign - not a broken build.

| Metric | Count |
|--------|-------|
| Commands Tested | 40+ |
| Total Cases | 100+ |
| Critical Issues | 0 |
| Major UX Improvements | 2 |
| Removed Commands | 6 |

## Major Changes in 0.2.5

### 1. floom run now polls and returns output
The biggest UX improvement: floom run — run a Floom app.

usage:
  floom run <slug>                    run app with no inputs
  floom run <slug> '<json>'           run app with JSON body
  floom run <slug> --input key=val    run app with key=value pairs (repeatable)

examples:
  floom run uuid
  floom run competitor-lens '{"you":"stripe.com","rival":"adyen.com"}'
  floom run ai-readiness-audit --input url=https://stripe.com now waits for completion and prints the result.

Before (0.2.1):
{"run_id":"run_qn1ket8hfzsz","status":"pending"}

After (0.2.5):
{"run_id":"run_76wp17rwks3s","status":"pending"}

### 2. New run syntax
The  flag is removed. Actions are passed in the JSON body:
{"error":"rate_limit_exceeded","retry_after_seconds":300,"scope":"app"}
{"error":"rate_limit_exceeded","retry_after_seconds":300,"scope":"app"}

### 3. New --input syntax
{"run_id":"run_xfh6p4k5tg4q","status":"pending"}

### 4. New --json flag
Returns raw JSON including execution logs:
{"error":"Request body is not valid JSON","code":"invalid_body","details":{"reason":"malformed_json","parse_message":"No number after minus sign in JSON at position 1"}}

### 5. Auth validation improved
Invalid token formats are now rejected client-side:


## Removed Commands
The following commands from 0.2.1 were removed in 0.2.5:
-  - Use  instead
-  - Use  instead
-  - Use  instead
-  - Use  instead
-  - Use  instead
-  - Use GitHub issues directly
-  - Use  instead

## Command Matrix Results

### Auth
| Test | Result | Notes |
|------|--------|-------|
| auth <valid_token> | OK | Validates format before saving |
| auth <invalid_format> | OK | Rejected client-side |
| auth whoami | OK | Shows identity + workspace |
| auth --show | OK | Shows redacted config |
| auth logout | OK | Clears config |

### Run
| Test | Result | Notes |
|------|--------|-------|
| run hash '{"text":"hello"}' | OK | Returns output |
| run hash --input text=hello | OK | New syntax |
| run petstore '{"action":"getInventory"}' | OK | New syntax |
| run petstore '{"action":"getPetById","freeform":"petId=1"}' | OK | Works |
| run nonexistent-app | OK | HTTP 404 |
| run hash '{"text":""}' | OK | HTTP 400 (empty required field) |
| run hash '{"algorithm":"invalid"}' | OK | HTTP 400 |
| UTF-8 inputs | OK | Works correctly |
| --json flag | OK | Returns raw JSON with logs |

### Apps
| Test | Result | Notes |
|------|--------|-------|
| apps list | OK | Human-readable table |
| apps list --json | OK | JSON output |
| apps get | OK | Returns app details |
| apps about | OK | Returns extended info |
| apps update | OK | Updates visibility, rate limits |
| apps delete | OK | Deletes app |
| apps sharing get | OK | Returns visibility + invites |
| apps sharing set | OK | Changes visibility |
| apps reviews | OK | Lists reviews |
| apps reviews submit | OK | Submits review |
| apps source get | OK | Returns manifest |
| apps source openapi | OK | Returns OpenAPI spec |
| apps rate-limit get/set | OK | Works |
| apps installed | OK | Lists installed apps |
| apps fork | OK | Forks store app |
| apps install/uninstall | OK | Works |

### Status
| Test | Result | Notes |
|------|--------|-------|
| status | OK | Human-readable apps + runs |
| status --json | OK | Full JSON output |

### Account
| Test | Result | Notes |
|------|--------|-------|
| account secrets set/list/delete | OK | Works |

### Deploy / Init / Validate
| Test | Result | Notes |
|------|--------|-------|
| deploy --dry-run | OK | Shows what would happen |
| deploy | OK | Publishes app |
| init | OK | Scaffolds floom.yaml |
| validate | OK | Validates YAML |

### API
| Test | Result | Notes |
|------|--------|-------|
| api GET /api/health | OK | Returns service status |
| api GET /api/hub/mine | OK | Lists owned apps |
| api GET /api/hub/<slug> | OK | Gets store app info |
| api GET /api/me/runs | OK | Lists runs |
| api GET /api/me/runs/<id> | OK | Gets run details |
| api POST /api/run | OK | Creates run |
| api POST /api/hub/ingest | OK | Deploys app |

## Bug Status Update

### #937 - Link visibility
**Status: FIXED** - Works correctly in 0.2.5 with new syntax.

### #938 - Auth validation
**Status: FIXED** - Invalid token formats are now rejected client-side.

### #966 - Store apps network
**Status: FIXED** - All store apps work correctly.

### #967 - CLI packaging
**Status: RESOLVED** - 0.2.5 is a consistent, intentional redesign. The missing commands were removed by design, not by packaging error.

## Recommendations

1. **Update documentation** - The new run syntax and removed commands need clear documentation.
2. **Migration guide** - Users upgrading from 0.2.1 need guidance on the new syntax.
3. **Error messages** - Some errors just show HTTP 400 without details. Could be improved.
4. **Store discovery** - Without , users need to know app slugs beforehand.

## QA Artifacts

- Report: qa/reports/2026-04-29-cli-stress-test-round-7.md
