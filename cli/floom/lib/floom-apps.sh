#!/usr/bin/env bash
# floom-apps.sh — list your published apps on Floom.
#
# Usage:
#   floom apps list             list all apps in the caller's workspace
#   floom apps list --help      show this help

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"

SUBCMD="${1:-list}"

case "$SUBCMD" in
  -h|--help|help)
    cat <<EOF
floom apps — manage your Floom apps.

usage:
  floom apps list    list all apps in your workspace

EOF
    exit 0 ;;
  list)
    shift || true
    if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
      echo "floom apps list — list all apps in your workspace"
      exit 0
    fi
    exec bash "$LIB_DIR/floom-api.sh" GET /api/hub/mine ;;
  *)
    echo "floom apps: unknown subcommand '$SUBCMD'" >&2
    echo "run 'floom apps --help' for usage." >&2
    exit 1 ;;
esac
