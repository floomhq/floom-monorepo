#!/usr/bin/env bash
set -euo pipefail
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
usage() {
  cat <<'EOF'
floom feedback — submit product feedback.

usage:
  floom feedback submit (--text <text> | --text-stdin) [--email <email>] [--url <url>]

commands:
  submit     send feedback to Floom
EOF
}
CMD="${1:-submit}"; [[ $# -gt 0 ]] && shift || true
case "$CMD" in
  ""|-h|--help|help)
    usage
    exit 0 ;;
esac
[[ "$CMD" == "submit" ]] || { echo "floom feedback: unknown subcommand '$CMD'" >&2; exit 1; }
text=""; email=""; url=""; seen=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --text) [[ "$seen" == 0 ]] || { echo "floom feedback submit: use exactly one of --text or --text-stdin" >&2; exit 1; }; text="${2:-}"; seen=1; shift 2 ;;
    --text-stdin) [[ "$seen" == 0 ]] || { echo "floom feedback submit: use exactly one of --text or --text-stdin" >&2; exit 1; }; text="$(cat)"; seen=1; shift ;;
    --email) email="${2:-}"; shift 2 ;;
    --url) url="${2:-}"; shift 2 ;;
    *) echo "floom feedback submit: unknown option '$1'" >&2; exit 1 ;;
  esac
done
[[ -n "$text" ]] || { echo "floom feedback submit: provide --text or --text-stdin" >&2; exit 1; }
TEXT="$text" EMAIL="$email" URL_="$url" python3 - <<'PY' >/tmp/floom-feedback-body.$$
import json, os
body = {"text": os.environ["TEXT"]}
if os.environ["EMAIL"]: body["email"] = os.environ["EMAIL"]
if os.environ["URL_"]: body["url"] = os.environ["URL_"]
print(json.dumps(body, separators=(",", ":")))
PY
body="$(cat /tmp/floom-feedback-body.$$)"
rm -f /tmp/floom-feedback-body.$$
exec bash "$LIB_DIR/floom-api.sh" POST /api/feedback "$body"
