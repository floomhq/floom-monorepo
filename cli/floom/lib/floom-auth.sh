#!/usr/bin/env bash
# floom-auth.sh — save an Agent token to ~/.floom/config.json.
#
# Usage:
#   floom auth <agent-token>                save token (api_url defaults to https://floom.dev)
#   floom auth <agent-token> <api-url>      save token + custom URL (for self-host)
#   floom auth login                        open token page + print login instructions
#   floom auth login --token=<agent-token>  alternate form used by CLI snippets
#   floom auth whoami                       print identity for current token
#   floom auth logout                       clear saved token
#   floom auth --show                       print redacted current config
#   floom auth --clear                      delete config file (alias: logout)

set -euo pipefail

CONFIG="${FLOOM_CONFIG:-$HOME/.floom/config.json}"
DEFAULT_HOST_FILE="${HOME}/.floom/default-host"

default_host() {
  if [[ -n "${FLOOM_API_URL:-}" ]]; then
    echo "$FLOOM_API_URL"
  elif [[ -f "$DEFAULT_HOST_FILE" ]]; then
    cat "$DEFAULT_HOST_FILE"
  else
    echo "https://floom.dev"
  fi
}

open_login_page() {
  local url="$1"
  if [[ "${FLOOM_CLI_NO_BROWSER:-}" == "1" || "${FLOOM_NO_BROWSER:-}" == "1" ]]; then
    return 1
  fi

  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin)
      command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1 && return 0
      ;;
    Linux)
      command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 && return 0
      ;;
    MINGW*|MSYS*|CYGWIN*)
      command -v cmd.exe >/dev/null 2>&1 && cmd.exe /c start "" "$url" >/dev/null 2>&1 && return 0
      ;;
  esac
  return 1
}

validate_token_file() {
  local api_url="$1"
  local token="$2"
  local out_file="$3"
  curl -sS -o "$out_file" -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    "${api_url%/}/api/session/me" 2>/dev/null || echo "000"
}

case "${1:-}" in
  --show)
    if [[ ! -f "$CONFIG" ]]; then
      echo "no config at $CONFIG"
      exit 1
    fi
    CONFIG_PATH="$CONFIG" python3 - <<'PY'
import json
import os

c = json.load(open(os.environ["CONFIG_PATH"]))
key = c.get("api_key", "")
red = key[:4] + "..." + key[-4:] if len(key) > 8 else "***"
print(f"api_url: {c.get('api_url', 'https://floom.dev')}")
print(f"agent_token: {red}")
PY
    exit 0 ;;
  --clear|logout)
    rm -f "$CONFIG"
    echo "cleared $CONFIG"
    exit 0 ;;
  whoami)
    if [[ ! -f "$CONFIG" && -z "${FLOOM_API_KEY:-}" ]]; then
      echo "not logged in. Run: floom auth <agent-token>"
      exit 1
    fi
    CONFIG_PATH="$CONFIG" python3 - <<'PY'
import json
import os

env_key = os.environ.get("FLOOM_API_KEY", "")
cfg_path = os.environ.get("CONFIG_PATH", "")
if env_key:
    key = env_key
    url = os.environ.get("FLOOM_API_URL", "https://floom.dev")
elif cfg_path and os.path.exists(cfg_path):
    c = json.load(open(cfg_path))
    key = c.get("api_key", "")
    url = c.get("api_url", "https://floom.dev")
else:
    print("not logged in. Run: floom auth <agent-token>")
    raise SystemExit(1)

if not key:
    print("not logged in. Run: floom auth <agent-token>")
    raise SystemExit(1)

red = key[:14] + "..." + key[-4:] if len(key) > 18 else key[:4] + "..."
print(f"logged in  api_url: {url}")
print(f"token:     {red}")
PY
    exit $? ;;
  login)
    AGENT_TOKEN=""
    API_URL="$(default_host)"
    shift
    while [[ $# -gt 0 ]]; do
      arg="$1"
      case "$arg" in
        -h|--help)
          cat <<EOF
floom auth login — open the token page or save an Agent token.

usage:
  floom login [--api-url=<api_url>]
  floom auth login [--api-url=<api_url>]
  floom auth login --token=<agent_token> [--api-url=<api_url>]

options:
  --token=<token>      Agent token. Get yours at <api_url>/home
  --api-url=<url>      Override API base URL (default: install host or https://floom.dev)
  --url=<url>          Alias for --api-url

EOF
          exit 0 ;;
        --token=*)   AGENT_TOKEN="${arg#--token=}" ;;
        --token)     shift; AGENT_TOKEN="${1:-}" ;;
        --api-url=*) API_URL="${arg#--api-url=}" ;;
        --api-url)   shift; API_URL="${1:-}" ;;
        --url=*)     API_URL="${arg#--url=}" ;;
        --url)       shift; API_URL="${1:-}" ;;
        *)           echo "floom auth login: unknown option: $arg" >&2; exit 1 ;;
      esac
      shift
    done
    if [[ -z "$AGENT_TOKEN" ]]; then
      LOGIN_URL="${API_URL%/}/home"
      if open_login_page "$LOGIN_URL"; then
        echo "Opened ${LOGIN_URL}"
      else
        echo "Open this URL to mint an Agent token:"
        echo "  ${LOGIN_URL}"
      fi
      echo
      echo "Then run:"
      echo "  floom auth login --token=<agent_token> --api-url=${API_URL}"
      exit 0
    fi
    VALIDATE_FILE=$(mktemp)
    trap 'rm -f "$VALIDATE_FILE"' RETURN
    HTTP_CODE=$(validate_token_file "$API_URL" "$AGENT_TOKEN" "$VALIDATE_FILE")
    if [[ "$HTTP_CODE" != "200" && "${API_URL%/}" == "https://floom.dev" ]]; then
      for CANDIDATE_URL in "https://mvp.floom.dev" "https://v26.floom.dev"; do
        HTTP_CODE=$(validate_token_file "$CANDIDATE_URL" "$AGENT_TOKEN" "$VALIDATE_FILE")
        if [[ "$HTTP_CODE" == "200" ]]; then
          API_URL="$CANDIDATE_URL"
          break
        fi
      done
    fi
    if [[ "$HTTP_CODE" != "200" ]]; then
      echo "ERROR: Token rejected by ${API_URL} (HTTP ${HTTP_CODE})." >&2
      echo "Mint a fresh token at ${API_URL}/home and try again." >&2
      exit 1
    fi
    mkdir -p "$(dirname "$CONFIG")"
    CONFIG_PATH="$CONFIG" AGENT_TOKEN="$AGENT_TOKEN" API_URL="$API_URL" python3 - <<'PY'
import json
import os

with open(os.environ["CONFIG_PATH"], "w") as f:
    json.dump({"api_key": os.environ["AGENT_TOKEN"], "api_url": os.environ["API_URL"]}, f)
PY
    chmod 600 "$CONFIG"
    IDENTITY=$(python3 -c "
import json
try:
  d = json.load(open('$VALIDATE_FILE'))
  u = d.get('user', {})
  print(u.get('email') or u.get('id') or 'unknown')
except Exception:
  print('unknown')
" 2>/dev/null || echo "unknown")
    echo "Logged in as ${IDENTITY} at ${API_URL}"
    exit 0 ;;
  -h|--help|"")
    cat <<EOF
floom auth — manage Agent token authentication.

usage:
  floom login                                  open token page + print login command
  floom auth <agent-token>                     save token (defaults to https://floom.dev)
  floom auth <agent-token> <api-url>           save token + custom URL (self-host)
  floom auth login                             open token page + print login command
  floom auth login --token=<agent-token>       save token (recommended form)
  floom auth whoami                            show identity for current token
  floom auth logout                            clear saved token
  floom auth --show                            print redacted config

Get your Agent token:
  https://floom.dev/home

Agent tokens look like:
  floom_agent_...
EOF
    [[ "${1:-}" == "" ]] && exit 1
    exit 0 ;;
esac

AGENT_TOKEN="$1"
API_URL="${2:-$(default_host)}"

exec bash "$0" login "--token=$AGENT_TOKEN" "--api-url=$API_URL"
