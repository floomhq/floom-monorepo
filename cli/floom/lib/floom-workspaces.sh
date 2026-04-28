#!/usr/bin/env bash
# floom-workspaces.sh — manage workspaces, members, invites, and active workspace.

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"
CMD="${1:-}"

usage() {
  cat <<'EOF'
floom workspaces - manage workspace tenancy.

usage:
  floom workspaces me
  floom workspaces list
  floom workspaces get <workspace-id>
  floom workspaces create --name <name> [--slug <slug>]
  floom workspaces update <workspace-id> [--name <name>] [--slug <slug>]
  floom workspaces delete <workspace-id>
  floom workspaces switch <workspace-id>
  floom workspaces runs delete <workspace-id>
  floom workspaces members list <workspace-id>
  floom workspaces members set-role <workspace-id> <user-id> --role <admin|editor|viewer>
  floom workspaces members remove <workspace-id> <user-id>
  floom workspaces invites list <workspace-id>
  floom workspaces invites create <workspace-id> --email <email> [--role <admin|editor|viewer>]
  floom workspaces invites revoke <workspace-id> <invite-id>
  floom workspaces invites accept <workspace-id> --token <token>
EOF
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

json_workspace_body() {
  NAME="$1" SLUG="$2" REQUIRE_FIELD="$3" python3 - <<'PY'
import json
import os
body = {}
if os.environ["NAME"]:
    body["name"] = os.environ["NAME"]
if os.environ["SLUG"]:
    body["slug"] = os.environ["SLUG"]
if os.environ["REQUIRE_FIELD"] == "1" and not body:
    raise SystemExit("provide --name or --slug")
print(json.dumps(body, separators=(",", ":")))
PY
}

json_role_body() {
  python3 -c 'import json, sys; print(json.dumps({"role": sys.argv[1]}, separators=(",", ":")))' "$1"
}

json_invite_body() {
  EMAIL="$1" ROLE="$2" python3 - <<'PY'
import json
import os
body = {"email": os.environ["EMAIL"]}
if os.environ["ROLE"]:
    body["role"] = os.environ["ROLE"]
print(json.dumps(body, separators=(",", ":")))
PY
}

json_token_body() {
  python3 -c 'import json, sys; print(json.dumps({"token": sys.argv[1]}, separators=(",", ":")))' "$1"
}

json_switch_body() {
  python3 -c 'import json, sys; print(json.dumps({"workspace_id": sys.argv[1]}, separators=(",", ":")))' "$1"
}

parse_name_slug() {
  name=""
  slug=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="${2:-}"; shift 2 ;;
      --name=*) name="${1#--name=}"; shift ;;
      --slug) slug="${2:-}"; shift 2 ;;
      --slug=*) slug="${1#--slug=}"; shift ;;
      *) echo "$PARSE_CONTEXT: unknown option '$1'" >&2; exit 1 ;;
    esac
  done
}

valid_role() {
  [[ "$1" == "admin" || "$1" == "editor" || "$1" == "viewer" ]]
}

case "$CMD" in
  ""|-h|--help|help)
    usage
    [[ -z "$CMD" ]] && exit 1
    exit 0
    ;;
  me)
    shift || true
    exec bash "$LIB_DIR/floom-api.sh" GET /api/session/me
    ;;
  list)
    shift || true
    exec bash "$LIB_DIR/floom-api.sh" GET /api/workspaces
    ;;
  get)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom workspaces get: missing <workspace-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/workspaces/$(urlencode "$id")"
    ;;
  create)
    shift || true
    PARSE_CONTEXT="floom workspaces create"
    parse_name_slug "$@"
    [[ -n "$name" ]] || { echo "floom workspaces create: --name is required" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" POST /api/workspaces "$(json_workspace_body "$name" "$slug" 0)"
    ;;
  update)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom workspaces update: missing <workspace-id>" >&2; exit 1; }
    shift || true
    PARSE_CONTEXT="floom workspaces update"
    parse_name_slug "$@"
    exec bash "$LIB_DIR/floom-api.sh" PATCH "/api/workspaces/$(urlencode "$id")" "$(json_workspace_body "$name" "$slug" 1)"
    ;;
  delete|rm|remove)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom workspaces delete: missing <workspace-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/workspaces/$(urlencode "$id")"
    ;;
  switch)
    shift || true
    id="${1:-}"
    [[ -n "$id" ]] || { echo "floom workspaces switch: missing <workspace-id>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" POST /api/session/switch-workspace "$(json_switch_body "$id")"
    ;;
  runs)
    shift || true
    subcmd="${1:-}"
    case "$subcmd" in
      delete|clear)
        shift || true
        id="${1:-}"
        [[ -n "$id" ]] || { echo "floom workspaces runs delete: missing <workspace-id>" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/workspaces/$(urlencode "$id")/runs"
        ;;
      *)
        echo "floom workspaces runs: unknown subcommand '$subcmd'" >&2
        exit 1
        ;;
    esac
    ;;
  members)
    shift || true
    subcmd="${1:-}"
    case "$subcmd" in
      list)
        shift || true
        id="${1:-}"
        [[ -n "$id" ]] || { echo "floom workspaces members list: missing <workspace-id>" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" GET "/api/workspaces/$(urlencode "$id")/members"
        ;;
      set-role)
        shift || true
        id="${1:-}"
        user_id="${2:-}"
        [[ -n "$id" ]] || { echo "floom workspaces members set-role: missing <workspace-id>" >&2; exit 1; }
        [[ -n "$user_id" ]] || { echo "floom workspaces members set-role: missing <user-id>" >&2; exit 1; }
        shift 2 || true
        role=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --role) role="${2:-}"; shift 2 ;;
            --role=*) role="${1#--role=}"; shift ;;
            *) echo "floom workspaces members set-role: unknown option '$1'" >&2; exit 1 ;;
          esac
        done
        valid_role "$role" || { echo "floom workspaces members set-role: --role must be admin, editor, or viewer" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" PATCH "/api/workspaces/$(urlencode "$id")/members/$(urlencode "$user_id")" "$(json_role_body "$role")"
        ;;
      remove|delete|rm)
        shift || true
        id="${1:-}"
        user_id="${2:-}"
        [[ -n "$id" ]] || { echo "floom workspaces members remove: missing <workspace-id>" >&2; exit 1; }
        [[ -n "$user_id" ]] || { echo "floom workspaces members remove: missing <user-id>" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/workspaces/$(urlencode "$id")/members/$(urlencode "$user_id")"
        ;;
      *)
        echo "floom workspaces members: unknown subcommand '$subcmd'" >&2
        exit 1
        ;;
    esac
    ;;
  invites)
    shift || true
    subcmd="${1:-}"
    case "$subcmd" in
      list)
        shift || true
        id="${1:-}"
        [[ -n "$id" ]] || { echo "floom workspaces invites list: missing <workspace-id>" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" GET "/api/workspaces/$(urlencode "$id")/invites"
        ;;
      create)
        shift || true
        id="${1:-}"
        [[ -n "$id" ]] || { echo "floom workspaces invites create: missing <workspace-id>" >&2; exit 1; }
        shift || true
        email=""
        role=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --email) email="${2:-}"; shift 2 ;;
            --email=*) email="${1#--email=}"; shift ;;
            --role) role="${2:-}"; shift 2 ;;
            --role=*) role="${1#--role=}"; shift ;;
            *) echo "floom workspaces invites create: unknown option '$1'" >&2; exit 1 ;;
          esac
        done
        [[ -n "$email" ]] || { echo "floom workspaces invites create: --email is required" >&2; exit 1; }
        [[ -z "$role" ]] || valid_role "$role" || { echo "floom workspaces invites create: --role must be admin, editor, or viewer" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" POST "/api/workspaces/$(urlencode "$id")/members/invite" "$(json_invite_body "$email" "$role")"
        ;;
      revoke)
        shift || true
        id="${1:-}"
        invite_id="${2:-}"
        [[ -n "$id" ]] || { echo "floom workspaces invites revoke: missing <workspace-id>" >&2; exit 1; }
        [[ -n "$invite_id" ]] || { echo "floom workspaces invites revoke: missing <invite-id>" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" DELETE "/api/workspaces/$(urlencode "$id")/invites/$(urlencode "$invite_id")"
        ;;
      accept)
        shift || true
        id="${1:-}"
        [[ -n "$id" ]] || { echo "floom workspaces invites accept: missing <workspace-id>" >&2; exit 1; }
        shift || true
        token=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --token) token="${2:-}"; shift 2 ;;
            --token=*) token="${1#--token=}"; shift ;;
            *) echo "floom workspaces invites accept: unknown option '$1'" >&2; exit 1 ;;
          esac
        done
        [[ -n "$token" ]] || { echo "floom workspaces invites accept: --token is required" >&2; exit 1; }
        exec bash "$LIB_DIR/floom-api.sh" POST "/api/workspaces/$(urlencode "$id")/members/accept-invite" "$(json_token_body "$token")"
        ;;
      *)
        echo "floom workspaces invites: unknown subcommand '$subcmd'" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "floom workspaces: unknown subcommand '$CMD'" >&2
    echo "run 'floom workspaces --help' for usage." >&2
    exit 1
    ;;
esac
