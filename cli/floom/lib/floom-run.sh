#!/usr/bin/env bash
# floom-run.sh — run a Floom app by slug, passing JSON inputs.
#
# Usage:
#   floom run <slug>                        run with no inputs (empty object)
#   floom run <slug> '{"key":"value"}'      run with JSON body
#   floom run <slug> --input key=value      run with key=value pairs
#   floom run <slug> --use-context          fill missing inputs from profiles
#   floom run <slug> --json                 print raw JSON
#   floom run --help                        show this help

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || -z "${1:-}" ]]; then
  cat <<EOF
floom run — run a Floom app.

usage:
  floom run <slug>                    run app with no inputs
  floom run <slug> '<json>'           run app with JSON body
  floom run <slug> --input key=val    run app with key=value pairs (repeatable)
  floom run <slug> --use-context      fill missing inputs from profiles
  floom run <slug> --json             print raw JSON

examples:
  floom run uuid
  floom run competitor-lens '{"you":"stripe.com","rival":"adyen.com"}'
  floom run ai-readiness-audit --input url=https://stripe.com

EOF
  [[ -z "${1:-}" ]] && exit 1
  exit 0
fi

SLUG="$1"
shift

# Parse remaining args: either a raw JSON string, or --input key=value pairs
BODY="{}"
INPUT_PAIRS=()
USE_CONTEXT=0
JSON_OUTPUT=0
WAIT_SECONDS="${FLOOM_RUN_WAIT_SECONDS:-60}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      bash "$0" --help
      exit 0 ;;
    --input)
      shift
      INPUT_PAIRS+=("$1")
      shift ;;
    --input=*)
      INPUT_PAIRS+=("${1#--input=}")
      shift ;;
    --use-context)
      USE_CONTEXT=1
      shift ;;
    --json)
      JSON_OUTPUT=1
      shift ;;
    *)
      # Treat as raw JSON body
      BODY="$1"
      shift ;;
  esac
done

# Build JSON from --input key=value pairs if any were provided
if [[ ${#INPUT_PAIRS[@]} -gt 0 ]]; then
  BODY=$(python3 - "${INPUT_PAIRS[@]}" <<'PY'
import json, sys
pairs = sys.argv[1:]
d = {}
for p in pairs:
    k, _, v = p.partition('=')
    d[k.strip()] = v.strip()
print(json.dumps(d))
PY
)
fi

if [[ "$USE_CONTEXT" == "1" ]]; then
  BODY=$(python3 - "$BODY" <<'PY'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except json.JSONDecodeError as exc:
    print(f"floom run: invalid JSON body: {exc}", file=sys.stderr)
    sys.exit(1)
if not isinstance(payload, dict):
    print("floom run: JSON body must be an object", file=sys.stderr)
    sys.exit(1)
payload["use_context"] = True
print(json.dumps(payload, separators=(",", ":")))
PY
)
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

INITIAL="$(FLOOM_API_ALLOW_ANON=1 FLOOM_COOKIE_JAR="$COOKIE_JAR" bash "$LIB_DIR/floom-api.sh" POST "/api/${SLUG}/run" "$BODY")"
RUN_ID="$(python3 - "$INITIAL" <<'PY'
import json, sys
try:
    payload = json.loads(sys.argv[1])
except Exception:
    print("")
    raise SystemExit
print(payload.get("run_id") or payload.get("id") or "")
PY
)"

if [[ -z "$RUN_ID" ]]; then
  printf '%s\n' "$INITIAL"
  exit 0
fi

FINAL="$INITIAL"
deadline=$((SECONDS + WAIT_SECONDS))
while [[ $SECONDS -le $deadline ]]; do
  SNAPSHOT="$(FLOOM_API_ALLOW_ANON=1 FLOOM_COOKIE_JAR="$COOKIE_JAR" bash "$LIB_DIR/floom-api.sh" GET "/api/run/${RUN_ID}" 2>/dev/null || true)"
  if ! python3 - "$SNAPSHOT" <<'PY'
import json, sys
try:
    status = json.loads(sys.argv[1]).get("status")
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if status in {"success", "succeeded", "error", "failed", "timeout"} else 1)
PY
  then
    SNAPSHOT="$(FLOOM_COOKIE_JAR="$COOKIE_JAR" bash "$LIB_DIR/floom-api.sh" GET "/api/me/runs/${RUN_ID}" 2>/dev/null || true)"
  fi
  if python3 - "$SNAPSHOT" <<'PY'
import json, sys
try:
    status = json.loads(sys.argv[1]).get("status")
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if status in {"success", "succeeded", "error", "failed", "timeout"} else 1)
PY
  then
    FINAL="$SNAPSHOT"
    break
  fi
  sleep 1
done

if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '%s\n' "$FINAL"
  exit 0
fi

python3 - "$FINAL" "$RUN_ID" <<'PY'
import json
import sys

raw, run_id = sys.argv[1], sys.argv[2]
try:
    payload = json.loads(raw)
except Exception:
    print(raw)
    raise SystemExit

status = payload.get("status") or "pending"
app = payload.get("app_slug") or payload.get("slug") or ""
label = f" ({app})" if app else ""

if status in {"success", "succeeded"}:
    print(f"Run succeeded: {run_id}{label}")
    out = payload.get("outputs", payload.get("output"))
    if out is not None:
        print("Output:")
        print(json.dumps(out, indent=2))
elif status in {"error", "failed", "timeout"}:
    print(f"Run failed: {run_id}{label}", file=sys.stderr)
    err = payload.get("error") or payload.get("message") or "unknown error"
    print(err, file=sys.stderr)
    raise SystemExit(2)
else:
    print(f"Run pending: {run_id}{label}")
    print(f"Check it with: floom api GET /api/me/runs/{run_id}")
PY
