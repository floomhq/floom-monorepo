#!/usr/bin/env bash
# floom-run.sh — run a Floom app by slug.

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"

usage() {
  cat <<'EOF'
floom run - run a Floom app by slug.

usage:
  floom run <slug> [inputs-json]
  floom run <slug> --action <action> [--inputs-json <json>|--inputs-stdin] [--use-context]

examples:
  floom run slugify '{"text":"Hello World"}'
  floom run hash --action sha256 --inputs-json '{"text":"hello"}'
  echo '{"text":"hello"}' | floom run word-count --inputs-stdin
EOF
}

json_body() {
  SLUG="$1" ACTION="$2" INPUTS="$3" USE_CONTEXT="$4" python3 - <<'PY'
import json
import os

body = {"app_slug": os.environ["SLUG"]}
if os.environ["ACTION"]:
    body["action"] = os.environ["ACTION"]
if os.environ["USE_CONTEXT"] == "1":
    body["use_context"] = True
raw = os.environ["INPUTS"]
if raw:
    inputs = json.loads(raw)
    if not isinstance(inputs, dict):
        raise SystemExit("inputs JSON must be an object")
    body["inputs"] = inputs
else:
    body["inputs"] = {}
print(json.dumps(body, separators=(",", ":")))
PY
}

case "${1:-}" in
  ""|-h|--help|help)
    usage
    [[ -z "${1:-}" ]] && exit 1
    exit 0
    ;;
esac

slug="${1:-}"
shift || true
action=""
inputs=""
seen_inputs=0
use_context=0

if [[ $# -gt 0 && "${1:-}" != --* ]]; then
  inputs="$1"
  seen_inputs=1
  shift || true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action)
      action="${2:-}"
      shift 2
      ;;
    --action=*)
      action="${1#--action=}"
      shift
      ;;
    --inputs-json)
      [[ "$seen_inputs" == 0 ]] || { echo "floom run: use one inputs source" >&2; exit 1; }
      inputs="${2:-}"
      seen_inputs=1
      shift 2
      ;;
    --inputs-json=*)
      [[ "$seen_inputs" == 0 ]] || { echo "floom run: use one inputs source" >&2; exit 1; }
      inputs="${1#--inputs-json=}"
      seen_inputs=1
      shift
      ;;
    --inputs-stdin)
      [[ "$seen_inputs" == 0 ]] || { echo "floom run: use one inputs source" >&2; exit 1; }
      inputs="$(cat)"
      seen_inputs=1
      shift
      ;;
    --use-context)
      use_context=1
      shift
      ;;
    *)
      echo "floom run: unknown option '$1'" >&2
      exit 1
      ;;
  esac
done

exec bash "$LIB_DIR/floom-api.sh" POST /api/run "$(json_body "$slug" "$action" "$inputs" "$use_context")"
