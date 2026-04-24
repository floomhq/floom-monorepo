# Deploy Smoke Test Runbook

`deploy-prod.yml` now adds a post-deploy public check after the AX41 container swap.

## What the workflow does

1. Deploys the requested prod image on AX41 with the existing forced-command deploy key.
2. Probes `https://floom.dev/api/health` and expects HTTP 200.
3. Runs `scripts/smoke-launch-demos.sh` against `https://floom.dev`.
4. On failure, looks up the previous prod image tag from `/var/log/floom-deploy-prod.log` and re-runs `/usr/local/sbin/floom-deploy-prod.sh <previous-tag>`.
5. Marks the workflow failed even if rollback succeeds.

The smoke script uses the exact cached demo inputs for:

- `lead-scorer`
- `competitor-analyzer`
- `resume-screener`

That means the smoke path requires `cache_hit=true` on each app and does not spend live Gemini quota.

## Required GitHub secret

Workflow-side rollback needs a full shell SSH key in `AX41_SHELL_KEY`.

The existing `AX41_PROD_DEPLOY_KEY` is forced-command-only, so it can deploy a tag but it cannot read `/var/log/floom-deploy-prod.log` to resolve the previous tag.

The shell key only needs permission to:

- read `/var/log/floom-deploy-prod.log`
- run `/usr/local/sbin/floom-deploy-prod.sh <tag>`

## Emergency skip

Manual prod deploys now expose `skip_smoke` with default `false`.

Set `skip_smoke=true` only when you intentionally want to bypass:

- the public `/api/health` probe
- the 3-app smoke test
- the workflow auto-rollback path

## If the workflow fails

Check which step failed first:

- `Public health probe`: `https://floom.dev/api/health` was not HTTP 200 after deploy.
- `Demo smoke test`: one of the three app runs failed, returned `app_unavailable`, or did not return the expected cached output shape.
- `Auto-rollback to previous prod image`: the workflow could not resolve or redeploy the previous image tag on AX41.

## Manual rollback on AX41

If the workflow rollback step fails, run this on AX41:

```bash
set -euo pipefail
LOG=/var/log/floom-deploy-prod.log
mapfile -t tags < <(
  grep -oE '\[resolve\] IMAGE_TAG=[A-Za-z0-9:._-]+' "$LOG" | sed 's/^.*=//'
)
rollback_tag="${tags[${#tags[@]}-2]}"
/usr/local/sbin/floom-deploy-prod.sh "$rollback_tag"
```

Then verify:

```bash
status="$(curl -sS -o /tmp/floom-prod-health.json -w '%{http_code}' --max-time 30 https://floom.dev/api/health)"
[ "$status" = "200" ]
PROD_URL=https://floom.dev bash scripts/smoke-launch-demos.sh
```

## Expected smoke output

Healthy deploy:

```text
[PASS] lead-scorer ...
[PASS] competitor-analyzer ...
[PASS] resume-screener ...
Summary: pass=3 fail=0 skip=0
```

Unhealthy deploy:

```text
[FAIL] <slug> ...
Summary: pass=<n> fail=<m> skip=<k>
```
