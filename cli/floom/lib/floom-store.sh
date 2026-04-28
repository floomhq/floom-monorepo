#!/usr/bin/env bash
set -euo pipefail
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
usage() {
  cat <<'EOF'
floom store — browse public Store apps.

usage:
  floom store list [--category <category>] [--sort default|name|newest|category] [--include-fixtures]
  floom store search <query> [--category <category>] [--sort default|name|newest|category]
  floom store get <slug>

commands:
  list      list Store apps
  search    search Store apps by text
  get       inspect a Store app by slug
EOF
}
CMD="${1:-list}"; [[ $# -gt 0 ]] && shift || true
case "$CMD" in
  ""|-h|--help|help)
    usage ;;
  list)
    category=""; sort="default"; include=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --category) category="${2:-}"; shift 2 ;;
        --sort) sort="${2:-}"; shift 2 ;;
        --include-fixtures) include="&include_fixtures=1"; shift ;;
        *) echo "floom store list: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    [[ "$sort" =~ ^(default|name|newest|category)$ ]] || { echo "floom store list: --sort must be default, name, newest, or category" >&2; exit 1; }
    path="/api/hub?sort=$(urlencode "$sort")$include"
    [[ -n "$category" ]] && path="${path}&category=$(urlencode "$category")"
    exec bash "$LIB_DIR/floom-api.sh" GET "$path" ;;
  search)
    query="${1:-}"; [[ -n "$query" ]] || { echo "floom store search: missing <query>" >&2; exit 1; }
    shift || true
    category=""; sort="default"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --category) category="${2:-}"; shift 2 ;;
        --sort) sort="${2:-}"; shift 2 ;;
        *) echo "floom store search: unknown option '$1'" >&2; exit 1 ;;
      esac
    done
    path="/api/hub?q=$(urlencode "$query")&sort=$(urlencode "$sort")"
    [[ -n "$category" ]] && path="${path}&category=$(urlencode "$category")"
    exec bash "$LIB_DIR/floom-api.sh" GET "$path" ;;
  get)
    slug="${1:-}"; [[ -n "$slug" ]] || { echo "floom store get: missing <slug>" >&2; exit 1; }
    exec bash "$LIB_DIR/floom-api.sh" GET "/api/hub/$(urlencode "$slug")" ;;
  *) echo "floom store: unknown subcommand '$CMD'" >&2; exit 1 ;;
esac
