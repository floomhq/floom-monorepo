# Floom MCP MVP Product Stress Test Report

- Date (UTC): 2026-04-28
- Tester: Codex (automated MCP integration testing)
- Environment: `https://mvp.floom.dev/mcp`
- Auth mode: Bearer agent token (`read-write` scope)
- Repository: `floomhq/floom`
- Branch: `launch-week-apps`

## 1) Executive Summary

This test pass covered live end-to-end behavior of the expanded MVP MCP surface, including discovery, app metadata, app execution, studio app lifecycle, reviews, secrets, and account token lifecycle.

### Overall result

- Primary stress suite actions executed: `43`
- Passed: `37`
- Failed: `6`
- Follow-up defect isolation suite: completed
- Temporary resources cleanup: completed (apps deleted, temp token revoked, temp account secret removed)

### Headline findings

1. The MCP has expanded significantly and is functional across most core product paths.
2. Most failures are concentrated in lifecycle transition semantics and error surfacing.
3. Several responses currently return `500 illegal_transition` where deterministic 4xx policy/transition errors are expected.

## 2) Scope and Coverage

## Tools discovered (live)

Total tools discovered during test: `38`

- Discovery & app read:
  - `discover_apps`, `get_app_skill`, `get_app_details`, `get_app_about`, `get_app_source`, `list_app_reviews`
- Run execution:
  - `run_app`, `get_run`, `list_my_runs`
- Reviews:
  - `submit_app_review`, `leave_app_review`
- Studio lifecycle:
  - `studio_publish_app`, `studio_detect_app`, `studio_ingest_hint`, `studio_list_my_apps`, `studio_fork_app`, `studio_claim_app`, `studio_install_app`, `studio_uninstall_app`, `studio_get_app_rate_limit`, `studio_set_app_rate_limit`, `studio_update_app`, `studio_delete_app`, `studio_get_app_sharing`, `studio_set_app_sharing`, `studio_submit_app_review`, `studio_withdraw_app_review`, `studio_list_secret_policies`, `studio_set_secret_policy`, `studio_set_creator_secret`, `studio_delete_creator_secret`
- Account:
  - `account_get`, `account_list_secrets`, `account_set_secret`, `account_delete_secret`, `account_list_agent_tokens`, `account_create_agent_token`, `account_revoke_agent_token`

## Tested user journeys

1. App discovery + metadata retrieval on public app (`floom-this`)
2. Multiple app runs + run retrieval (`base64`, `hash`, `floom-this`)
3. Studio app creation/detection/publish/update/delete with temporary app
4. Sharing and install/uninstall behavior on published app
5. Secret policy and creator secret management
6. Public review submission/update behavior
7. Account secrets CRUD and agent token create/revoke
8. Full cleanup verification

## 3) Methodology

- Tests executed via direct JSON-RPC MCP calls to `https://mvp.floom.dev/mcp`.
- Both positive and negative paths were exercised.
- Failure reproduction pass created two controlled temporary apps:
  - App A: no declared security keys
  - App B: OpenAPI with `components.securitySchemes.ApiKeyAuth`
- All temporary entities were removed at end of testing.

## 4) Results Matrix

## A. Core read/discovery

- `account_get`: ✅
- `account_list_secrets`: ✅
- `account_list_agent_tokens`: ✅
- `discover_apps` (limit/query): ✅
- `list_my_runs`: ✅
- `studio_list_my_apps`: ✅
- `get_app_skill/details/about/source`: ✅
- `list_app_reviews`: ✅

## B. App execution

- `run_app(base64)`: ✅ success
- `run_app(hash)`: ✅ success
- `run_app(floom-this analyzeFloomThis)`: ✅ success
- `get_run` on created run IDs: ✅ success

Representative run IDs:

- `run_5q2f0bzjrwg2` (`base64`)
- `run_7tpeff4ew2fb` (`hash`)
- `run_64j5pv2wr11c` (`floom-this`)

## C. Studio lifecycle

- `studio_detect_app`: ✅
- `studio_publish_app`: ✅ (returns `publish_status: pending_review`)
- `studio_get_app_sharing`: ✅
- `studio_set_app_sharing` to `link`: ✅
- `studio_get_app_rate_limit`: ✅
- `studio_set_app_rate_limit`: ✅
- `studio_update_app`: ✅
- `studio_delete_app`: ✅

### Studio failures observed

1. `studio_claim_app` on just-published/owned app: ❌ `409 already_owned`
2. `studio_install_app` on own pending-review app: ❌ `404 not_found`
3. `studio_set_secret_policy` on undeclared key: ❌ `400` (expected behavior)
4. `studio_set_creator_secret` on undeclared key: ❌ `400` (expected behavior)
5. `studio_submit_app_review` on own app: ❌ `500 illegal_transition`
6. `studio_withdraw_app_review` on own app: ❌ `500 illegal_transition`

## D. Secrets and account lifecycle

- `account_set_secret` / `account_delete_secret`: ✅
- verification via `account_list_secrets`: ✅
- `account_create_agent_token`: ✅
- `account_revoke_agent_token`: ✅

Temporary token created and revoked:

- `agtok_b17b5867-3483-440a-b1e6-9041eb8741a8`

## E. Reviews on public app

- `submit_app_review` on `floom-this`: ✅ upsert-style success
- `leave_app_review` on `floom-this`: ✅ upsert-style success

## 5) Deep-Dive Defect Isolation (Second Pass)

A focused second pass reproduced transition and secret-key behavior with controlled app specs.

### Repro bundle

Temporary apps:

- `mcp-bug-28085700a` (no secret declarations)
- `mcp-bug-28085700b` (declares `ApiKeyAuth` security scheme)

Both published successfully and then deleted successfully.

### Confirmed behaviors

1. Claiming owned app
- `studio_claim_app` returns structured conflict:
  - `status: 409`, `code: already_owned`
- Interpretation: expected behavior.

2. Secret policy key matching
- For app with no secrets:
  - `studio_list_secret_policies` returns `[]`
  - setting `API_KEY` fails with `400` and `valid_keys: []`
- For app with `ApiKeyAuth`:
  - `studio_list_secret_policies` includes key `ApiKeyAuth`
  - `studio_set_secret_policy(key="ApiKeyAuth")` succeeds
  - `studio_set_creator_secret(key="ApiKeyAuth")` succeeds
  - using header name `X-API-Key` fails with `400` + `valid_keys: ["ApiKeyAuth"]`
- Interpretation: expected behavior; key is the security scheme name, not header field name.

3. Sharing transition to `invited`
- `studio_set_app_sharing(state="invited")` returned:
  - `500 runtime_error illegal_transition`
- Interpretation: likely product defect (error class/contract), or missing prereq with incorrect surfacing.

4. Install behavior under pending review
- `studio_install_app` returned `404 not_found` after publish, under both `private` and `link` states.
- Interpretation: maybe intentional for pending-review apps, but error semantics are opaque.

5. Studio review transitions
- `studio_submit_app_review` and `studio_withdraw_app_review` on own published app both return `500 illegal_transition`.
- Interpretation: likely transition handling issue or unimplemented state path with internal error surfacing.

## 6) Severity-Ranked Issues

### High

1. `studio_set_app_sharing(state="invited")` -> `500 illegal_transition`
- Why high: state mutation path throws internal-class error instead of deterministic API policy response.

2. `studio_submit_app_review` / `studio_withdraw_app_review` -> `500 illegal_transition`
- Why high: review workflow path is unusable for this app state and leaks internal transition error.

### Medium

3. `studio_install_app` on own pending-review app -> `404 not_found`
- Why medium: likely policy-gated, but `404` obscures true reason and complicates client logic.

### Low / Expected-validation

4. secret key validation failures on undeclared keys (`API_KEY` / `X-API-Key`)
- Why low: behavior is correct and schema-consistent.

## 7) Product and API Contract Recommendations

1. Replace `500 illegal_transition` with explicit 4xx transition errors.
- Include `current_state`, `allowed_transitions`, and actionable reason.

2. Clarify install eligibility and return precise policy errors.
- If pending-review apps cannot be installed, return `409` or `422` with policy code, not `404`.

3. Document secret policy key mapping explicitly.
- State clearly that secret keys map to `securitySchemes` keys (e.g., `ApiKeyAuth`), not HTTP header names.

4. Add lifecycle introspection helper(s).
- Example: `studio_get_app_state` returning state machine + allowed actions.

5. Ensure parity between public review tools and studio review tools.
- Public review endpoints functioned; studio review transitions failed on tested state.

## 8) Cleanup Verification

Cleanup completed during both suites:

- Deleted temp stress app: `mcp-stress-28085521`
- Deleted defect-isolation apps:
  - `mcp-bug-28085700a`
  - `mcp-bug-28085700b`
- Revoked temp created agent-token row: `agtok_[redacted-test-id]`
- Removed temp account vault entry: `MCP_STRESS_085521`

## 9) Confidence and Limitations

Confidence level: high for surfaced behaviors; all findings are from live endpoint calls with direct payload/response inspection.

Limitations:

- No UI/browser workflow validation included in this report.
- Concurrency/race stress (parallel write bursts) was not included in this pass.
- Some policy decisions may be intentional; recommendations focus on API clarity and operational ergonomics.

## 10) Final Verdict for MVP

The MCP is broadly functional and significantly advanced versus earlier builds.

MVP readiness status:

- Core discovery/run/account paths: strong
- Studio authoring lifecycle: mostly functional
- Remaining launch blockers to resolve or explicitly document:
  - lifecycle transition 500s (`invited` sharing, studio review actions)
  - install semantics for pending-review apps


---

## 11) Floom CLI Parity Test (vs MCP)

Date (UTC): 2026-04-28

CLI binary: `/Users/federicodeponte/.local/bin/floom`

Auth: `floom auth <agent-token>` succeeded and bound to `https://mvp.floom.dev`.

### CLI suite summary

- Total CLI actions: `36`
- Passed: `30`
- Failed: `6`
- Temporary CLI app slug: `cli-stress-28090741`
- Cleanup: ✅ app deleted and removal verified

### CLI actions that passed

- `floom init --name ... --slug ... --openapi-url ...`
- `floom deploy --dry-run`
- `floom deploy`
- `floom apps get/about/source/source openapi/reviews list`
- `floom apps sharing get/set (link/private)`
- `floom apps update --primary-action/--clear-primary-action/--run-rate-limit-per-hour`
- `floom apps rate-limit get/set/reset`
- `floom run <slug> '{...}'`
- `floom apps uninstall`
- `floom apps secret-policies list`
- `floom apps creator-secrets delete`
- `floom apps sharing submit-review`
- `floom apps sharing withdraw-review`
- `floom apps review ...` and `floom apps reviews submit ...`
- `floom account secrets set/list/delete`
- `floom apps delete` + verify removal via `floom apps list`

### CLI failures and interpretation

1. `floom apps update <slug> --visibility link` failed
- Error: CLI validation blocks visibility updates except `private`.
- Message suggests using `floom apps sharing submit-review <slug>` for public store review flow.
- Interpretation: expected CLI contract split (visibility link/invited handled by sharing subcommands).

2. `floom apps install <slug>` failed with `404 not_found`
- Same behavior observed via MCP for pending-review owned apps.
- Interpretation: likely policy/availability gate, but error semantics remain ambiguous.

3. `floom apps secret-policies set <slug> API_KEY ...` failed `400 unknown_secret_key`
4. `floom apps creator-secrets set <slug> API_KEY ...` failed `400 unknown_secret_key`
- For this generated app, valid secret key from policy list was `api_key` (lowercase), not `API_KEY`.
- Interpretation: expected key validation behavior.

5. `floom account agent-tokens list` failed `401 session_required`
6. `floom account agent-tokens create ...` failed `401 session_required`
- Interpretation: CLI token-management operations require user-session auth, not agent-token auth.

### CLI ↔ MCP parity conclusions

- Broad parity exists for app lifecycle, run, sharing, review submission, secret policy introspection, and account secrets.
- Cross-channel consistent behavior observed on install gate (`404 not_found`) for pending-review app.
- CLI presents some behaviors more clearly than MCP in this build:
  - `sharing submit-review/withdraw-review` returned structured success, where MCP studio review transitions previously surfaced `500 illegal_transition` on certain tested app states.
- Account token lifecycle diverges by auth mode:
  - MCP with read-write agent token allowed create/revoke in this test account.
  - CLI currently requires user session for agent-token management endpoints.


---

## 12) Re-Audit After Update (MCP + CLI)

Date (UTC): 2026-04-28

This section captures a fresh rerun after platform updates, including corrected sharing-transition checks.

### 12.1 MCP re-audit summary

Run timestamp: `20260428210233`

- Temporary app slug: `mcp-reaudit-28210233`
- Total actions: `34`
- Passed: `31`
- Failed: `3`
- Cleanup: ✅ app deleted, temp secret deleted, temp token revoked

#### MCP re-audit outcomes

Passed highlights:

- `tools/list` now reports `39` tools
- Core read paths (`account_get`, `discover_apps`, `get_app_details`, `list_my_runs`, `studio_list_my_apps`) ✅
- `run_app` + `get_run` (`base64`, `hash`, `floom-this`) ✅
- `studio_detect_app`, `studio_publish_app` ✅
- `studio_submit_app_review` and `studio_withdraw_app_review` ✅
- `account_set_secret/list/delete` ✅
- `account_create_agent_token` + `account_revoke_agent_token` ✅

Failed/expected-validation paths:

1. `studio_install_app` → `404 not_found`
- Still reproducible for newly published pending-review app.

2. `studio_set_secret_policy` with undeclared key `API_KEY` → `400 invalid_input`
3. `studio_set_creator_secret` with undeclared key `API_KEY` → `400 invalid_input`
- Expected validation given empty `valid_keys` for this app.

#### Corrected sharing transition verification

A separate focused rerun used valid tool calls:

- Temporary slug: `mcp-sharecheck-28210305`
- `studio_set_app_sharing(state=link)` ✅
- `studio_set_app_sharing(state=private)` ✅
- `studio_set_app_sharing(state=invited)` ✅
- cleanup delete ✅

Conclusion: MCP-side invited transition is functioning in the updated build.

### 12.2 CLI re-audit summary

Run timestamp: `20260428210329`

- Temporary app slug: `cli-reaudit-28210329`
- Total actions: `16`
- Passed: `13`
- Failed: `3`
- Cleanup: ✅ app deleted and removal verified

Passed highlights:

- `floom init`, `floom deploy --dry-run`, `floom deploy` ✅
- `floom apps get` ✅
- `floom apps sharing set --state link` ✅
- `floom apps sharing set --state private` ✅
- `floom run <slug>` ✅
- `floom apps uninstall` ✅
- `floom account secrets set/list/delete` ✅

CLI failures:

1. `floom apps sharing set <slug> --state invited` → `409 illegal_transition`
- This is now a clean 4xx contract response (improved over prior 500-style transition errors).

2. `floom apps install <slug>` → `404 not_found`
- Still consistent with pending-review install gate behavior.

3. `floom account agent-tokens list` → `401 session_required`
- CLI token-management remains user-session-gated.

### 12.3 Delta vs previous audit

Improvements observed:

- Studio review transitions via MCP now succeed (`submit` / `withdraw` returned `ok: true`).
- Sharing transition handling is cleaner in CLI (`409 illegal_transition` instead of runtime-style internal errors).

Open items still reproducible:

- Install by slug for fresh pending-review apps returns `404 not_found`.
- Secret policy/creator secret enforcement requires declared keys and returns proper validation errors.
- CLI agent-token management still requires user session auth.

### 12.4 Current launch-readiness interpretation

The updated build is more stable on lifecycle transitions than the prior pass. Remaining friction is concentrated in install semantics for pending-review apps and auth-mode constraints for CLI token management.




---

## 13) Third Rerun (Post-Update Validation)

Date (UTC): 2026-04-28
Run timestamp: `20260428234103`

### 13.1 MCP rerun summary

- Temp app: `mcp-rerun-28234103`
- Total: `12`
- Passed: `9`
- Failed: `3`
- Cleanup: ✅ (`studio_delete_app` succeeded)

Passed:

- `tools/list` (`count=39`)
- `account_get`
- `discover_apps`
- `studio_publish_app`
- `studio_set_app_sharing(link)`
- `studio_set_app_sharing(private)`
- `studio_submit_app_review`
- `studio_withdraw_app_review`
- `studio_delete_app`

Failures:

1. `run_app base64` returned runtime error
- `status: error`
- `error: fetch failed`
- `error_type: network_unreachable`
- Interpretation: intermittent runtime/network dependency issue (not schema/validation).

2. `studio_set_app_sharing(invited)` now consistently returns structured policy error:
- `409`
- `code: illegal_transition`
- `message: Illegal visibility transition.`
- Interpretation: behavior now explicit and deterministic; no server 500.

3. `studio_install_app` now returns explicit policy error:
- `409`
- `code: app_not_installable`
- message indicates only public Store apps are installable; pending-review app already available in Studio.
- Interpretation: clear improvement over earlier ambiguous not-found behavior.

### 13.2 CLI rerun summary

- Temp app: `cli-rerun-28234103`
- Total: `7`
- Passed: `5`
- Failed: `2`
- Cleanup: ✅ (`floom apps delete` succeeded)

Passed:

- `floom init`
- `floom deploy`
- `floom apps sharing set --state link`
- `floom apps sharing set --state private`
- `floom apps delete`

Failed:

1. `floom apps sharing set --state invited`
- `HTTP 409`
- `code: illegal_transition`

2. `floom apps install`
- `HTTP 409`
- message: only public Store apps can be installed

### 13.3 Delta from prior re-audit

Improvements observed:

- Install semantics are now explicit (`409 app_not_installable`) rather than opaque `404 not_found`.
- Sharing invited transition returns clean policy error (`409 illegal_transition`) across MCP and CLI.

New instability signal:

- `run_app` on known-good app (`base64`) produced intermittent `network_unreachable` in this rerun, indicating runtime/network reliability regression or transient outage.

### 13.4 Current status after third rerun

- API error contracts for sharing/install are substantially clearer than initial audit.
- Main remaining reliability concern: intermittent app runtime network failure (`fetch failed`) seen in MCP run path.


---

## 14) Deep Round (Higher-Depth Stress)

Date (UTC): 2026-04-29

This round added deeper coverage beyond prior suites:

- transition chains instead of one-step mutations
- repeated review submit/withdraw loops
- sequential latency metrics and concurrent burst success rates
- strict secret-key contract checks against declared security scheme names
- parity validation of CLI behavior under repeated state transitions and run bursts

### 14.1 MCP deep round

Run timestamp: `20260429003622`

- Temp apps:
  - `mcp-deep-29003622`
  - `mcp-deep-29003622-sec`
- Total checks: `41`
- Passed: `34`
- Failed: `7`
- Cleanup: ✅ both temp apps deleted

#### Reliability metrics

- Sequential `run_app(base64)` trials: `15/15` success
  - success rate: `100%`
  - p50 latency: `785 ms`
  - p95 latency: `906 ms`
- Concurrent `run_app(hash)` burst: `24/24` success
  - success rate: `100%`

#### Deep findings

1. Sharing transitions are state-dependent, not globally blocked.
- Direct `private -> invited` failed (`409 illegal_transition`).
- In chain `private -> link -> private -> invited`, invited succeeded.
- Interpretation: invited is allowed only from specific prior states.

2. Install gate is now explicit and consistent across states.
- For `private`, `link`, and `invited`, install returned:
  - `409`
  - `code: app_not_installable`
  - clear policy message about public Store eligibility.

3. Review submit/withdraw loops failed repeatedly under tested state.
- In this deep run, three submit/withdraw cycles each returned `409 illegal_transition`.
- This conflicts with earlier re-audit where these actions succeeded.
- Interpretation: transition preconditions are brittle or context-sensitive.

4. Secret key contract is deterministic.
- For security scheme app (`ApiKeyAuth`), only `ApiKeyAuth` key is valid.
- Header name (`X-API-Key`) is rejected with `400` and `valid_keys` guidance.

### 14.2 CLI deep round

Run timestamp: `20260429003725`

- Temp app: `cli-deep-29003725`
- Total checks: `34`
- Passed: `33`
- Failed: `1`
- Cleanup: ✅ app deleted and absence verified

#### Reliability metrics

- Sequential run enqueue (`floom run hash`): `10/10` success (run IDs returned)
- Concurrent enqueue burst: `18/18` success

#### Deep findings

1. Sharing transitions all succeeded in this run.
- `link`, `private`, `invited`, back to `private`, then `link`: all `ok`.

2. Install gate remains the only functional failure.
- `floom apps install <slug>` returned:
  - `409`
  - `code: app_not_installable`
- This is now clear and stable policy behavior.

3. Agent-token list behavior remains auth-mode gated.
- `floom account agent-tokens list` returns `401 session_required` under agent-token auth.
- Treated as expected in this round.

### 14.3 Deep-round interpretation

- Positive: run-path reliability was strong in this round (100% success in measured bursts).
- Positive: install errors are now policy-explicit (`app_not_installable`) instead of ambiguous not-found.
- Watch item: review-transition behavior remains inconsistent across rounds; in this deep pass it failed repeatedly with `illegal_transition`.

### 14.4 Recommended next test slice

1. Transition-state observability test
- Capture and log exact visibility/review state before each review action.

2. Deterministic review-transition matrix
- Enumerate allowed submit/withdraw transitions from every visibility state (`private`, `link`, `invited`, `pending_review`) and verify contract outputs.

3. Runtime network canary
- Keep a lightweight canary running `base64/hash` every minute for 30-60 minutes to detect intermittent `network_unreachable` regressions.

---

## 15) New-Token Deep Audit (Runtime + Onboarding + Static Consistency)

Date (UTC): 2026-04-29
Run timestamp: `20260429020326`

Token scope observed through `account_get`: `read-write`.

### 15.1 MCP runtime audit

Tool surface:

- `tools/list`: `39` tools
- New/changed surface vs earlier rounds:
  - `get_app_logs`
  - `account_get_context`
  - `account_set_user_context`
  - `account_set_workspace_context`
  - `account_create_agent_token` / `account_revoke_agent_token` no longer exposed for this token

Live checks:

- MCP checks: `45`
- Passed: `42`
- Failed: `3`
- Cleanup: `3/3` passed

Run reliability:

- Sequential `run_app(base64)`: `20/20` success
- p50 latency: `767 ms`
- p95 latency: `811 ms`
- Concurrent `run_app(hash)`: `24/30` success
- Concurrent failures: `HTTP 429 Too Many Requests`

Interpretation:

- Single-run reliability is currently healthy.
- The 30-way burst exceeded the active token/server rate envelope. This is a useful launch finding, not necessarily a backend bug, but responses need clear client-facing retry semantics.

Lifecycle checks:

- `studio_publish_app`: passed
- `studio_set_app_sharing`: `private`, `link`, `invited`, `private`, `link` all passed in this sequence
- `studio_install_app`: returned expected policy response `409 app_not_installable`
- `studio_submit_app_review`: failed with `409 illegal_transition`
- `studio_withdraw_app_review`: failed with `409 illegal_transition`
- Secret policy contract:
  - `ApiKeyAuth` accepted
  - `X-API-Key` rejected with `400` and `valid_keys: ["ApiKeyAuth"]`
- Account secrets:
  - set/list/delete passed

New read-only tool checks:

- `account_get_context`: returned empty `user_profile` and `workspace_profile`
- `get_app_logs(base64)`: returned no logs with reason `not_owned_or_not_found`

### 15.2 CLI audit with new token

CLI checks: `12`

- Passed: `11`
- Failed: `1`

Passed / expected-policy paths:

- `floom auth` with new token succeeded
- `floom init --slug ...` succeeded
- `floom deploy --dry-run` succeeded
- `floom deploy` succeeded
- `floom run uuid` returned a pending run id
- sharing `link`, `invited`, `private` succeeded
- install returned expected policy response `409 app_not_installable`
- agent-token list returned expected auth-mode response `401 session_required`
- temp app delete and absence verification succeeded

Failure:

- `floom init --name "Test App"` without explicit `--slug` still fails:
  - `derived slug 'test app' is invalid. Pass --slug.`

CLI onboarding findings still open:

- Installed CLI reports version `0.1.0` while repo package is `0.3.2` and package CLI internals are newer.
- `floom run uuid` still does not print the completed result; it only returns a pending run id.
- `floom deploy --dry-run` still prints `POST https://floom.dev/api/hub/ingest` while authenticated to `https://mvp.floom.dev`.

### 15.3 Static consistency findings reconfirmed

Product promise mismatch:

- `docs/PRODUCT.md` positions repo-hosting as primary: user pastes a repo URL and Floom hosts it.
- `README.md` leads with OpenAPI wrapping in the hero and quickstart.

Docker quickstart mismatch:

- `README.md` maps `3000:3000`.
- `docker/Dockerfile` sets `PORT=3051` and exposes `3051`.

CLI command drift:

- `cli/floom/bin/floom` advertises/dispatches commands such as `store`, `runs`, `triggers`, `workspaces`, and `feedback`.
- Installed CLI help is narrower and the broader command set remains inconsistent with what a new user can rely on.

### 15.4 Local verification

`pnpm typecheck` passed:

- Packages in scope: `@floom/cli`, `@floom/detect`, `@floom/hub-smoke`, `@floom/manifest`, `@floom/renderer`, `@floom/runtime`, `@floom/server`, `@floom/web`
- Result: `7 successful, 7 total`

### 15.5 Updated launch interpretation

Runtime/API readiness remains stronger than public onboarding readiness.

Current score after this round:

- Controlled beta / internal agent users: `7/10`
- Public launch readiness: `5/10`

Primary reasons public launch remains lower:

- Onboarding docs and product promise still conflict.
- CLI first-run path still has avoidable friction.
- Review transitions remain state-sensitive and can fail with `illegal_transition`.
- Concurrent burst behavior now rate-limits at this token/surface level; clients need retry guidance.

---

## 16) New-Token Diagnostic Rerun (Transition Matrix + Rate Envelope)

Date (UTC): 2026-04-29
Run timestamp: `20260429024835`

This round re-used the new token and focused on turning prior ambiguous failures into tighter product findings.

### 16.1 MCP diagnostics

Summary:

- MCP checks: `32`
- Passed: `28`
- Failed: `4`
- Cleanup: `2/2` passed
- Tool count: `39`

Run reliability:

- Sequential `run_app(base64)`: `12/12` success
- p50 latency: `762 ms`
- p95 latency: `769 ms`

Concurrency ladder:

- 4 workers / 12 runs: `12/12` success
- 6 workers / 18 runs: `16/18` success, failures were `HTTP 429 Too Many Requests`
- 8 workers / 24 runs: `4/24` success, failures were `HTTP 429 Too Many Requests`

Interpretation:

- The current agent token has a practical burst envelope below 6 parallel workers for this run shape.
- Rate limiting is functioning, but agents need retry/backoff guidance and ideally structured retry metadata.

Sharing transition matrix:

- `private -> link`: passed
- `link -> invited`: passed in this sequence
- `invited -> private`: passed
- repeated `private -> link -> invited`: passed

Review transition matrix:

- From `private`: submit succeeded, moved app to `pending_review`; withdraw succeeded, returned app to `private`
- From `link`: submit and withdraw both failed with `409 illegal_transition`
- From `invited`: submit and withdraw both failed with `409 illegal_transition`

Interpretation:

- Review actions are valid only from `private` in this observed state machine.
- This is now deterministic enough to document. The remaining product issue is discoverability: clients need `allowed_transitions` or a clear error with valid next states.

Install behavior:

- Pending-review/non-public app install returned expected `409 app_not_installable`.

Logs:

- `get_app_logs` on the owned temp app returned an empty log set with no error.

### 16.2 CLI diagnostics

Summary:

- CLI checks: `10`
- Passed: `9`
- Failed: `1`

Passed / expected-policy paths:

- `floom init --slug ...`
- `floom deploy --dry-run`
- `floom deploy`
- `floom run uuid` returned a pending run id
- `floom status`
- `floom apps sharing set --state invited`
- install returned expected `409 app_not_installable`
- temp app delete succeeded

Failure:

- `floom init --name "Test App"` without explicit `--slug` still fails with:
  - `derived slug 'test app' is invalid. Pass --slug.`

CLI onboarding findings reconfirmed:

- `floom --version`: `0.1.0`
- `floom run uuid` still returns only a pending run id
- `floom status` still emits raw JSON-heavy output
- `floom deploy --dry-run` still prints `https://floom.dev` while authenticated to `https://mvp.floom.dev`

### 16.3 Static consistency checks

Static checks: `4`

- Passed: `0`
- Failed: `4`

Reconfirmed issues:

- README Docker quickstart maps `3000:3000`, while Dockerfile sets/exposes `3051`
- README leads with OpenAPI wrapping, while `docs/PRODUCT.md` says repo-hosting is primary
- `cli/floom/bin/floom` dispatches missing libraries:
  - `floom-store.sh`
  - `floom-runs.sh`
  - `floom-triggers.sh`
  - `floom-workspaces.sh`
  - `floom-feedback.sh`
- Installed CLI version remains `0.1.0`

### 16.4 Updated recommendation

The fastest path to a stronger launch score is now specific:

1. Document the review state machine immediately: review submit/withdraw is valid from `private`, not from `link` or `invited`.
2. Add transition introspection to MCP/CLI responses: `current_state`, `allowed_transitions`, and `retry_after` where relevant.
3. Fix the CLI first-run experience: slug derivation, pending result polling, raw JSON output, and dry-run host mismatch.
4. Align README with the actual launch promise or explicitly label OpenAPI wrapping as the current MVP path.
5. Fix Docker quickstart ports before public users copy the command.

---

## 17) Round 17 Audit (Rate-Limit Payloads + Review State Proof)

Date (UTC): 2026-04-29
Run timestamp: `20260429030958`

This round focused on evidence quality: exact rate-limit payloads, app-log behavior, repo CLI command availability, and review state transitions with before/after state capture.

### 17.1 MCP checks

Summary:

- Checks: `29`
- Passed: `17`
- Failed: `12`
- Cleanup: `1/1` passed
- Tool count: `39`

Read checks:

- `account_get`: passed; token rate limit reported as `60/min`
- `account_get_context`: passed; both profiles empty
- `get_app_logs(petstore)`: passed; owned app logs returned recent run summaries
- `get_app_logs(base64)`: passed with `not_owned_or_not_found`

Run reliability:

- Sequential `run_app(hash)`: `4/8` success
- Failures: four consecutive `HTTP 502 Bad Gateway`
- Cooldown retry after 20 seconds: `4/4` success

Interpretation:

- The `502` behavior was transient under the tested traffic pattern, not a deterministic `hash` app failure.
- Runtime/proxy reliability still needs a canary because transient 5xx responses are launch-visible.

Concurrency:

- 5 workers / 15 runs: `15/15` success
- 6 workers / 18 runs: `14/18` success
- 6-worker failures were `HTTP 429 Too Many Requests`

Exact 429 response sample:

- Body was nginx HTML, not JSON:
  - `<html><head><title>429 Too Many Requests</title></head>...<center>nginx</center>`
- Headers included standard security headers but no observed structured retry metadata:
  - `Server: nginx`
  - `Content-Type: text/html`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

Interpretation:

- Rate limiting works, but agent callers receive an HTML proxy response instead of a machine-readable MCP/JSON error with `retry_after`.

### 17.2 Review state proof

Temporary app: `mcp-round17-29030958`

Observed matrix:

- From `private`:
  - `studio_submit_app_review` passed and moved visibility to `pending_review`
  - `studio_withdraw_app_review` passed and returned visibility to `private`
- From `link`:
  - submit failed with `409 illegal_transition`
  - withdraw failed with `409 illegal_transition`
- From `invited`:
  - submit failed with `409 illegal_transition`
  - withdraw failed with `409 illegal_transition`

Conclusion:

- Review submit/withdraw is valid from `private` only in this observed state model.
- This is acceptable if intentional, but it must be surfaced as an allowed-transition list or documented precondition.

### 17.3 CLI and static checks

CLI checks:

- `floom --version`: `0.1.0`
- `floom init --name "Test App"` without `--slug`: failed with invalid derived slug
- Repo CLI direct checks:
  - `bash cli/floom/bin/floom runs --help`: unknown command
  - `bash cli/floom/bin/floom store --help`: unknown command
  - `bash cli/floom/bin/floom feedback --help`: unknown command

Static checks reconfirmed:

- CLI library files still missing in the audited checkout:
  - `floom-store.sh`
  - `floom-runs.sh`
  - `floom-triggers.sh`
  - `floom-workspaces.sh`
  - `floom-feedback.sh`
- Docker quickstart and product-promise consistency remain launch-readiness risks from prior rounds.

### 17.4 Round 17 recommendation

Priority fixes from this pass:

1. Convert proxy-level `429` HTML into JSON/MCP errors with retry metadata.
2. Add a canary for transient 5xx on simple built-in apps.
3. Document review preconditions: submit/withdraw requires `private` visibility.
4. Remove, hide, or implement CLI commands that are absent in the shipped/repo CLI surface.
5. Fix CLI slug derivation and first-run result polling before public CLI onboarding.

## 18. Round 18 Prod Token Host-Mismatch Audit

Date: 2026-04-29

Token under test: `floom_agent_lX...5G60` (redacted)

Launch state during this round:

- `origin/launch-mvp`: `b723c6a2`
- Prod image: `floom-prod:auto-b723c6a2-r29-png-only`
- MVP image: `floom-mvp-preview:auto-b723c6a2-r29-png-only`
- Preview image: `floom-preview:auto-dd89d322-r37-launch-dd89`

### 18.1 Token validity by host

The new token is valid on prod and invalid on MVP/preview.

Observed results:

| Host | `/api/session/me` | `/mcp tools/list` | Interpretation |
| --- | --- | --- | --- |
| `https://floom.dev` | `200` | `200`, 39 tools | Token belongs to prod DB |
| `https://mvp.floom.dev` | `401 invalid_agent_token` | `401 invalid_agent_token` | Host/DB mismatch |
| `https://preview.floom.dev` | `401 invalid_agent_token` | `401 invalid_agent_token` | Host/DB mismatch |

Root cause of the failed CLI/MCP attempt:

- The test used `https://mvp.floom.dev`.
- The token validates on `https://floom.dev`.
- Agent tokens are host-scoped because each host has its own backing DB.

### 18.2 MCP prod run proof

Using `https://floom.dev/mcp` with the same token:

- `tools/list`: `39` tools
- `run_app(hash)`: success
- `get_run`: success
- `list_my_runs`: success

Representative run:

- `run_id`: `run_kg7vy1zt6nzg`
- `slug`: `hash`
- `status`: `success`
- `duration_ms`: `11`
- `digest_hex`: `b3fd21521270a8b91f64ab4e34e4ff453f3e5e97ee62bda92416504777bcc646`

### 18.3 CLI virgin-session prod proof

Fresh temporary `HOME` with `npx -y @floomhq/cli@latest`:

- CLI version: `0.2.7`
- `floom auth <token> https://floom.dev`: success
- Saved config API URL: `https://floom.dev`
- `floom run hash '{"text":"cli-prod-round","algorithm":"sha256"}' --json`: success

Representative CLI run:

- `run_id`: `run_jdytvdrqj2y4`
- `slug`: `hash`
- `status`: `success`
- `duration_ms`: `4`
- `digest_hex`: `a97b383146cdc8ce83046f515037c4b844d3fc86a2402667c48f1bf0b726d993`

CLI JSON shape note:

- Current CLI JSON uses `id`, `app_slug`, and `outputs`.
- Older report projections that expected `run_id`, `slug`, and `output` read as null even though the run succeeded.

### 18.4 Public boundary checks

For `floom.dev`, `mvp.floom.dev`, and `preview.floom.dev`:

- `/api/health`: `200`, version `0.4.0-mvp.5`
- Invalid MCP bearer: `401` JSON with `code=invalid_token`
- `/metrics`: `404`
- No-auth `/api/session/me`: `200` local synthetic session, expected for public browse/run surfaces

Port surface after cleanup:

- Public `4310-4316`: closed
- Public `3056`: closed
- `floom-v26-preview`: stopped, restart policy `no`

### 18.5 Round 18 conclusion

The Round 18 token failure was not a token-generation failure. It was a host mismatch:

- Use this token with `https://floom.dev`.
- Do not use this token with `https://mvp.floom.dev` or `https://preview.floom.dev`.

Prod MCP and prod CLI both passed with the token.
