#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
GROUP="${1:-}"
shift || true
CMD="${1:-list}"
[[ $# -gt 0 ]] && shift || true

usage_runs() {
  cat <<'EOF'
floom runs — list, inspect, share, and delete runs.

usage:
  floom runs list [--limit <n>] [--slug <slug>]
  floom runs get <run-id>
  floom runs share <run-id>
  floom runs delete <run-id>
  floom runs activity [--limit <n>]

commands:
  list       list recent runs
  get        inspect a run
  share      create a public share link for a run
  delete     delete a run
  activity   list recent Studio activity
EOF
}

usage_jobs() {
  cat <<'EOF'
floom jobs — create, inspect, and cancel async jobs.

usage:
  floom jobs create <slug> [--action <action>] [--inputs-json <json> | --inputs-stdin] [--use-context]
  floom jobs get <slug> <job-id>
  floom jobs cancel <slug> <job-id>

commands:
  create     start an async app job
  get        inspect a job
  cancel     cancel a job
EOF
}

usage_quota() {
  cat <<'EOF'
floom quota — inspect app run quota.

usage:
  floom quota get <slug>

commands:
  get        show quota for an app slug
EOF
}

usage() {
  case "$GROUP" in
    runs) usage_runs ;;
    jobs) usage_jobs ;;
    quota) usage_quota ;;
    *)
      echo "usage: floom <runs|jobs|quota> --help" >&2
      return 1 ;;
  esac
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

json_inputs_body() {
  local action="$1" inputs="$2" use_context="${3:-0}"
  ACTION="$action" INPUTS="$inputs" USE_CONTEXT="$use_context" python3 - <<'PY'
import json, os
body = {"inputs": json.loads(os.environ["INPUTS"])}
if os.environ["ACTION"]:
    body["action"] = os.environ["ACTION"]
if os.environ["USE_CONTEXT"] == "1":
    body["use_context"] = True
print(json.dumps(body, separators=(",", ":")))
PY
}

case "$GROUP:$CMD" in
  runs:""|runs:-h|runs:--help|runs:help|jobs:""|jobs:-h|jobs:--help|jobs:help|quota:""|quota:-h|quota:--help|quota:help)
    usage ;;
  runs:list)
    limit=50
    slug=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --limit) limit="${2:-}"; shift 2 ;;
        --slug) slug="${2:-}"; shift 2 ;;
        *) echo "floom runs list: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    [[ "$limit" =~ ^[0-9]+$ ]] || { echo "floom runs list: --limit must be an integer" >&2; exit 1; }
    path="/api/agents/runs?limit=$limit"
    [[ -n "$slug" ]] && path="${path}&slug=$(urlencode "$slug")"
    exec bash "$LIB_DIR/floom-api.sh" GET "$path" ;;
  runs:get)
    run_id="${1:-}"
    [[ -n "$run_id" ]] || { echo "floom runs get: missing <run-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/agents/runs/$(urlencode "$run_id")" ;;
  runs:share)
    run_id="${1:-}"
    [[ -n "$run_id" ]] || { echo "floom runs share: missing <run-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" POST "/api/run/$(urlencode "$run_id")/share" "{}" ;;
  runs:delete)
    run_id="${1:-}"
    [[ -n "$run_id" ]] || { echo "floom runs delete: missing <run-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/me/runs/$(urlencode "$run_id")" ;;
  runs:activity)
    limit=5
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --limit) limit="${2:-}"; shift 2 ;;
        *) echo "floom runs activity: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    [[ "$limit" =~ ^[0-9]+$ ]] || { echo "floom runs activity: --limit must be an integer" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/me/studio/activity?limit=$limit" ;;
  jobs:create)
    slug="${1:-}"
    [[ -n "$slug" ]] || { echo "floom jobs create: missing <slug>" >&2; exit 1; }
    shift || true
    action=""
    inputs="{}"
    seen=0
    use_context=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --action) action="${2:-}"; shift 2 ;;
        --inputs-json)
          [[ "$seen" == 0 ]] || { echo "floom jobs create: use only one of --inputs-json or --inputs-stdin" >&2; exit 1; }
          inputs="${2:-}"; seen=1; shift 2 ;;
        --inputs-stdin)
          [[ "$seen" == 0 ]] || { echo "floom jobs create: use only one of --inputs-json or --inputs-stdin" >&2; exit 1; }
          inputs="$(cat)"; seen=1; shift ;;
        --use-context) use_context=1; shift ;;
        *) echo "floom jobs create: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    python3 -c 'import json,sys; v=json.loads(sys.argv[1]); assert isinstance(v,dict)' "$inputs" 2>/dev/null || { echo "floom jobs create: inputs JSON must be an object" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" POST "/api/$(urlencode "$slug")/jobs" "$(json_inputs_body "$action" "$inputs" "$use_context")" ;;
  jobs:get)
    slug="${1:-}"; job_id="${2:-}"
    [[ -n "$slug" && -n "$job_id" ]] || { echo "floom jobs get: missing <slug> <job-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/$(urlencode "$slug")/jobs/$(urlencode "$job_id")" ;;
  jobs:cancel)
    slug="${1:-}"; job_id="${2:-}"
    [[ -n "$slug" && -n "$job_id" ]] || { echo "floom jobs cancel: missing <slug> <job-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" POST "/api/$(urlencode "$slug")/jobs/$(urlencode "$job_id")/cancel" "{}" ;;
  quota:get)
    slug="${1:-}"
    [[ -n "$slug" ]] || { echo "floom quota get: missing <slug>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/$(urlencode "$slug")/quota" ;;
  *)
    echo "floom $GROUP: unknown subcommand '$CMD'" >&2
    exit 1 ;;
esac
