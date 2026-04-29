#!/usr/bin/env bash
# floom-status.sh — list the caller's apps and recent runs.

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "floom status - list your apps and recent runs"
  echo
  echo "usage:"
  echo "  floom status          show a readable summary"
  echo "  floom status --json   print raw API JSON"
  exit 0
fi

RAW_JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      RAW_JSON=1
      shift
      ;;
    *)
      echo "floom status: unknown option '$1'" >&2
      exit 1
      ;;
  esac
done

if [[ "${FLOOM_DRY_RUN:-}" == "1" ]]; then
  echo "== your apps =="
  bash "$LIB_DIR/floom-api.sh" GET /api/hub/mine
  echo
  echo "== recent runs =="
  bash "$LIB_DIR/floom-api.sh" GET '/api/me/runs?limit=10'
  exit 0
fi

call_api() {
  local response
  local err_file
  local code
  err_file=$(mktemp)
  set +e
  response=$(bash "$LIB_DIR/floom-api.sh" "$@" 2>"$err_file")
  code=$?
  set -e
  if [[ "$code" != "0" ]]; then
    [[ -n "$response" ]] && printf '%s\n' "$response"
    cat "$err_file" >&2
    rm -f "$err_file"
    return "$code"
  fi
  rm -f "$err_file"
  printf '%s' "$response"
}

APPS_JSON="$(call_api GET /api/hub/mine)"
RUNS_JSON="$(call_api GET '/api/me/runs?limit=10')"

if [[ "$RAW_JSON" == "1" ]]; then
  APPS_JSON="$APPS_JSON" RUNS_JSON="$RUNS_JSON" python3 - <<'PY'
import json
import os

print(json.dumps({
    "apps": json.loads(os.environ["APPS_JSON"]).get("apps", []),
    "runs": json.loads(os.environ["RUNS_JSON"]).get("runs", []),
}, indent=2))
PY
  exit 0
fi

APPS_JSON="$APPS_JSON" RUNS_JSON="$RUNS_JSON" python3 - <<'PY'
import json
import os
import sys

try:
    apps = json.loads(os.environ["APPS_JSON"]).get("apps", [])
    runs = json.loads(os.environ["RUNS_JSON"]).get("runs", [])
except Exception as exc:
    print(f"floom status: could not parse API response: {exc}", file=sys.stderr)
    sys.exit(1)

print("Your apps")
if not apps:
    print("  No apps found.")
else:
    for app in apps[:10]:
        slug = app.get("slug") or "(unknown)"
        name = app.get("name") or slug
        status = app.get("status") or "unknown"
        visibility = app.get("visibility") or "unknown"
        run_count = app.get("run_count")
        suffix = f" - {run_count} runs" if run_count is not None else ""
        print(f"  {slug} - {name} ({status}, {visibility}){suffix}")

print()
print("Recent runs")
if not runs:
    print("  No recent runs found.")
else:
    for run in runs[:10]:
        run_id = run.get("id") or "(unknown)"
        slug = run.get("app_slug") or run.get("app_name") or "(unknown app)"
        status = run.get("status") or "unknown"
        started = run.get("started_at") or ""
        duration = run.get("duration_ms")
        duration_text = f", {duration} ms" if duration is not None else ""
        print(f"  {run_id} - {slug} - {status}{duration_text} {started}".rstrip())
PY
