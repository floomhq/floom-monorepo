#!/usr/bin/env bash
# floom-deploy.sh — validate floom.yaml and publish the app.
#
# Flags:
#   --dry-run    set FLOOM_DRY_RUN=1 before calling the API (prints request, no send)
#
# Requires: floom.yaml in cwd, valid API key.

set -euo pipefail

_SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
LIB_DIR="$(cd "$(dirname "$_SCRIPT_PATH")" && pwd)"
CONFIG="${FLOOM_CONFIG:-$HOME/.floom/config.json}"
DEFAULT_HOST_FILE="${HOME}/.floom/default-host"

resolve_api_url() {
  if [[ -n "${FLOOM_API_URL:-}" ]]; then
    echo "$FLOOM_API_URL"
  elif [[ -f "$CONFIG" ]]; then
    CONFIG_PATH="$CONFIG" python3 - <<'PY'
import json
import os

try:
    c = json.load(open(os.environ["CONFIG_PATH"]))
    print(c.get("api_url") or "https://floom.dev")
except Exception:
    print("https://floom.dev")
PY
  elif [[ -f "$DEFAULT_HOST_FILE" ]]; then
    cat "$DEFAULT_HOST_FILE"
  else
    echo "https://floom.dev"
  fi
}

DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *)
      echo "floom deploy: unknown flag: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f floom.yaml ]]; then
  echo "floom deploy: no floom.yaml in $(pwd). Run 'floom init' first." >&2
  exit 1
fi

bash "$LIB_DIR/floom-validate.sh" floom.yaml

BODY_AND_META=$(python3 - <<'PY'
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("floom deploy: need PyYAML (pip install pyyaml)", file=sys.stderr)
    sys.exit(1)

manifest_path = Path("floom.yaml")
try:
    manifest = yaml.safe_load(manifest_path.read_text()) or {}
except yaml.YAMLError as exc:
    print(f"floom deploy: YAML parse error: {exc}", file=sys.stderr)
    sys.exit(1)

def add_if_present(body, key, value):
    if value is not None and value != "":
        body[key] = value

openapi_spec_url = manifest.get("openapi_spec_url")
openapi_url = manifest.get("openapi_url")
openapi_spec = manifest.get("openapi_spec")
docker_image_ref = manifest.get("docker_image_ref")

if openapi_spec_url and openapi_url and openapi_spec_url != openapi_url:
    print(
        "floom deploy: openapi_spec_url and openapi_url must match when both are present.",
        file=sys.stderr,
    )
    sys.exit(1)

sources = [
    bool(openapi_spec_url or openapi_url),
    bool(openapi_spec),
    bool(docker_image_ref),
]
if sum(1 for source in sources if source) != 1:
    print(
        "floom deploy: declare exactly one publish source: openapi_spec_url/openapi_url, openapi_spec, or docker_image_ref",
        file=sys.stderr,
    )
    sys.exit(1)

body = {
    "slug": manifest.get("slug", ""),
    "name": manifest.get("name", ""),
    "description": manifest.get("description", ""),
    "visibility": manifest.get("visibility") or "private",
}

if manifest.get("link_share_requires_auth") is True:
    body["link_share_requires_auth"] = True
if manifest.get("auth_required") is True:
    body["auth_required"] = True
add_if_present(body, "max_run_retention_days", manifest.get("max_run_retention_days"))

if openapi_spec_url or openapi_url:
    body["openapi_url"] = openapi_url or openapi_spec_url
elif openapi_spec:
    if isinstance(openapi_spec, dict):
        body["openapi_spec"] = openapi_spec
    elif isinstance(openapi_spec, str):
        spec_path = (manifest_path.parent / openapi_spec).resolve()
        if spec_path.exists():
            body["openapi_spec"] = yaml.safe_load(spec_path.read_text())
        else:
            parsed = yaml.safe_load(openapi_spec)
            if not isinstance(parsed, dict):
                print(
                    f"floom deploy: openapi_spec path not found or inline spec is not a mapping: {openapi_spec}",
                    file=sys.stderr,
                )
                sys.exit(1)
            body["openapi_spec"] = parsed
    else:
        print("floom deploy: openapi_spec must be a file path string or inline mapping", file=sys.stderr)
        sys.exit(1)
else:
    body["docker_image_ref"] = docker_image_ref
    add_if_present(body, "manifest", manifest.get("manifest"))
    add_if_present(body, "secret_bindings", manifest.get("secret_bindings"))

print(json.dumps({"body": body, "slug": body.get("slug") or "", "name": body.get("name") or ""}))
PY
)

BODY=$(printf '%s' "$BODY_AND_META" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["body"]))')
SLUG=$(printf '%s' "$BODY_AND_META" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("slug",""))')
NAME=$(printf '%s' "$BODY_AND_META" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')

if [[ "$DRY_RUN" == "1" ]]; then
  export FLOOM_DRY_RUN=1
fi

set +e
RESPONSE=$(bash "$LIB_DIR/floom-api.sh" POST /api/hub/ingest "$BODY")
API_STATUS=$?
set -e
printf '%s\n' "$RESPONSE"
if [[ "$API_STATUS" -ne 0 ]]; then
  exit "$API_STATUS"
fi

if [[ "$DRY_RUN" != "1" ]]; then
  API_URL="$(resolve_api_url)"
  DEPLOYED_SLUG=$(printf '%s' "$RESPONSE" | python3 -c "
import json, sys
fallback = '''$SLUG'''
try:
    print(json.load(sys.stdin).get('slug') or fallback)
except Exception:
    print(fallback)
")
  DEPLOYED_NAME=$(printf '%s' "$RESPONSE" | python3 -c "
import json, sys
fallback = '''$NAME'''
try:
    print(json.load(sys.stdin).get('name') or fallback)
except Exception:
    print(fallback)
")
  cat <<EOF

Published: $DEPLOYED_NAME
  App page:    ${API_URL%/}/p/$DEPLOYED_SLUG
  MCP URL:     ${API_URL%/}/mcp/app/$DEPLOYED_SLUG
  Owner view:  ${API_URL%/}/studio/$DEPLOYED_SLUG

Add to Claude Desktop config:
  {"mcpServers":{"floom-$DEPLOYED_SLUG":{"url":"${API_URL%/}/mcp/app/$DEPLOYED_SLUG"}}}
EOF
fi
