#!/usr/bin/env bash
# floom-auth.sh — save an Agent token to ~/.floom/config.json.
#
# Usage:
#   floom auth <agent-token>            save token (api_url defaults to https://floom.dev)
#   floom auth <agent-token> <api-url>  save token + custom URL (for self-host)
#   floom auth --show               print redacted current config
#   floom auth --clear              delete config file

set -euo pipefail

CONFIG="${FLOOM_CONFIG:-$HOME/.floom/config.json}"

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
  --clear)
    rm -f "$CONFIG"
    echo "cleared $CONFIG"
    exit 0 ;;
  -h|--help|"")
    cat <<EOF
floom auth — save Agent token.

usage:
  floom auth <agent-token>            save token (defaults to https://floom.dev)
  floom auth <agent-token> <api-url>  save token + custom URL (self-host)
  floom auth --show               print redacted config
  floom auth --clear              delete config

Create an Agent token in Workspace settings:
  https://floom.dev/settings/agent-tokens

Agent tokens look like:
  floom_agent_...
EOF
    [[ "${1:-}" == "" ]] && exit 1
    exit 0 ;;
esac

AGENT_TOKEN="$1"
API_URL="${2:-https://floom.dev}"

mkdir -p "$(dirname "$CONFIG")"
CONFIG_PATH="$CONFIG" AGENT_TOKEN="$AGENT_TOKEN" API_URL="$API_URL" python3 - <<'PY'
import json
import os

with open(os.environ["CONFIG_PATH"], "w") as f:
    json.dump({"api_key": os.environ["AGENT_TOKEN"], "api_url": os.environ["API_URL"]}, f)
PY
chmod 600 "$CONFIG"
echo "saved $CONFIG (api_url: $API_URL)"
