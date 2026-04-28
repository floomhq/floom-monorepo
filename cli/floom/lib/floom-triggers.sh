#!/usr/bin/env bash
# floom-triggers.sh — manage schedule and webhook triggers.

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"
CMD="${1:-}"

usage() {
  cat <<'EOF'
floom triggers - manage schedule and webhook triggers.

usage:
  floom triggers list
  floom triggers create <slug> --type schedule --action <action> --cron <expr> [--tz <iana>] [--inputs-json <json>|--inputs-stdin]
  floom triggers create <slug> --type webhook --action <action> [--inputs-json <json>|--inputs-stdin]
  floom triggers update <trigger-id> [--enabled true|false] [--action <action>] [--cron <expr>] [--tz <iana>] [--inputs-json <json>|--inputs-stdin]
  floom triggers delete <trigger-id>
EOF
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

json_create_body() {
  TYPE="$1" ACTION="$2" CRON="$3" TZ="$4" INPUTS="$5" python3 - <<'PY'
import json
import os
body = {
    "trigger_type": os.environ["TYPE"],
    "action": os.environ["ACTION"],
}
if os.environ["CRON"]:
    body["cron_expression"] = os.environ["CRON"]
if os.environ["TZ"]:
    body["tz"] = os.environ["TZ"]
raw = os.environ["INPUTS"]
if raw:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise SystemExit("inputs JSON must be an object")
    body["inputs"] = value
print(json.dumps(body, separators=(",", ":")))
PY
}

json_update_body() {
  ENABLED="$1" ACTION="$2" CRON="$3" TZ="$4" INPUTS="$5" python3 - <<'PY'
import json
import os
body = {}
enabled = os.environ["ENABLED"]
if enabled:
    body["enabled"] = enabled == "true"
if os.environ["ACTION"]:
    body["action"] = os.environ["ACTION"]
if os.environ["CRON"]:
    body["cron_expression"] = os.environ["CRON"]
if os.environ["TZ"]:
    body["tz"] = os.environ["TZ"]
raw = os.environ["INPUTS"]
if raw:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise SystemExit("inputs JSON must be an object")
    body["inputs"] = value
if not body:
    raise SystemExit("provide at least one field to update")
print(json.dumps(body, separators=(",", ":")))
PY
}

case "$CMD" in
  ""|-h|--help|help)
    usage
    [[ -z "$CMD" ]] && exit 1
    exit 0
    ;;
  list)
    shift || true
    exec bash "$LIB_DIR/floom-api.sh" GET /api/me/triggers
    ;;
  create)
    shift || true
    slug="${1:-}"
    [[ -n "$slug" ]] || { echo "floom triggers create: missing <slug>" >&2; exit 1; }
    shift || true
    type=""
    action=""
    cron=""
    tz=""
    inputs=""
    seen_inputs=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --type) type="${2:-}"; shift 2 ;;
        --type=*) type="${1#--type=}"; shift ;;
        --action) action="${2:-}"; shift 2 ;;
        --action=*) action="${1#--action=}"; shift ;;
        --cron) cron="${2:-}"; shift 2 ;;
        --cron=*) cron="${1#--cron=}"; shift ;;
        --tz) tz="${2:-}"; shift 2 ;;
        --tz=*) tz="${1#--tz=}"; shift ;;
        --inputs-json)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers create: use one inputs source" >&2; exit 1; }
          inputs="${2:-}"
          seen_inputs=1
          shift 2
          ;;
        --inputs-json=*)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers create: use one inputs source" >&2; exit 1; }
          inputs="${1#--inputs-json=}"
          seen_inputs=1
          shift
          ;;
        --inputs-stdin)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers create: use one inputs source" >&2; exit 1; }
          inputs="$(cat)"
          seen_inputs=1
          shift
          ;;
        *) echo "floom triggers create: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    [[ "$type" == "schedule" || "$type" == "webhook" ]] || { echo "floom triggers create: --type must be schedule or webhook" >&2; exit 1; }
    [[ -n "$action" ]] || { echo "floom triggers create: --action is required" >&2; exit 1; }
    if [[ "$type" == "schedule" && -z "$cron" ]]; then
      echo "floom triggers create: --cron is required for schedule triggers" >&2
      exit 1
    fi
    exec bash "$LIB_DIR/floom-api.sh" POST "/api/hub/$(urlencode "$slug")/triggers" "$(json_create_body "$type" "$action" "$cron" "$tz" "$inputs")"
    ;;
  update)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom triggers update: missing <trigger-id>" >&2; exit 1; }
    shift || true
    enabled=""
    action=""
    cron=""
    tz=""
    inputs=""
    seen_inputs=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --enabled) enabled="${2:-}"; shift 2 ;;
        --enabled=*) enabled="${1#--enabled=}"; shift ;;
        --action) action="${2:-}"; shift 2 ;;
        --action=*) action="${1#--action=}"; shift ;;
        --cron) cron="${2:-}"; shift 2 ;;
        --cron=*) cron="${1#--cron=}"; shift ;;
        --tz) tz="${2:-}"; shift 2 ;;
        --tz=*) tz="${1#--tz=}"; shift ;;
        --inputs-json)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers update: use one inputs source" >&2; exit 1; }
          inputs="${2:-}"
          seen_inputs=1
          shift 2
          ;;
        --inputs-json=*)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers update: use one inputs source" >&2; exit 1; }
          inputs="${1#--inputs-json=}"
          seen_inputs=1
          shift
          ;;
        --inputs-stdin)
          [[ "$seen_inputs" == 0 ]] || { echo "floom triggers update: use one inputs source" >&2; exit 1; }
          inputs="$(cat)"
          seen_inputs=1
          shift
          ;;
        *) echo "floom triggers update: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    [[ -z "$enabled" || "$enabled" == "true" || "$enabled" == "false" ]] || { echo "floom triggers update: --enabled must be true or false" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" PATCH "/api/me/triggers/$(urlencode "$id")" "$(json_update_body "$enabled" "$action" "$cron" "$tz" "$inputs")"
    ;;
  delete|rm|remove)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom triggers delete: missing <trigger-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/me/triggers/$(urlencode "$id")"
    ;;
  *)
    echo "floom triggers: unknown subcommand '$CMD'" >&2
    echo "run 'floom triggers --help' for usage." >&2
    exit 1
    ;;
esac
