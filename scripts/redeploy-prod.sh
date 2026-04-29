#!/usr/bin/env bash
# redeploy-prod.sh — canonical redeploy for floom-prod-waitlist (floom.dev).
#
# Mirror of redeploy-mvp.sh but for the prod environment. Created 2026-04-29
# after the prod container drifted to a 2-day-old image and crash-looped on
# every restart. The previous floom-deploy-prod.sh in /usr/local/sbin/
# targeted a *different* container (floom-mcp-preview on :3051) that no
# longer matches reality. THIS script is the new source of truth.
#
# What it does:
#   1. Build floom-prod:auto-<sha>-<tag> from current HEAD (or use
#      pre-built IMAGE_TAG from env).
#   2. Capture the running container's secrets, layer prod.env.canonical
#      on top.
#   3. Stop + remove old prod container.
#   4. Run new container with merged env, port 3055, prod volume binds,
#      memory limits (6g hard cap, 2g reservation, oom-score-adj -500).
#   5. Health-check; on failure, roll back to previous image tag.
#
# Usage:
#   bash scripts/redeploy-prod.sh                # builds from HEAD
#   bash scripts/redeploy-prod.sh promote        # custom tag suffix
#   IMAGE_TAG=floom-prod:foo bash scripts/redeploy-prod.sh
#
# DO NOT replace this with `docker run` ad-hoc.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL_ENV="${REPO_ROOT}/scripts/prod.env.canonical"
KILL_LIST="${REPO_ROOT}/scripts/launch-kill-list.txt"
CONTAINER=floom-prod-waitlist
HOST_PORT=3055
CONTAINER_PORT=3000
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
IMAGE_REPO=floom-prod

BINDS=(
  "-v" "floom-chat-deploy_floom-chat-data:/data"
  # Never mount /var/run/docker.sock into public launch containers.
  # Launch demo Docker apps stay disabled until isolated runners land.
  "-v" "/opt/floom-preview-apps:/apps"
  "-v" "/opt/floom-preview-file-inputs:/floom-file-inputs"
)

log() { printf '\033[36m[redeploy-prod]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[redeploy-prod]\033[0m %s\n' "$*" >&2; }

if [ ! -f "$CANONICAL_ENV" ]; then
  err "missing canonical env file: $CANONICAL_ENV"
  exit 1
fi

# --- 1. Determine image tag ---

if [ -n "${IMAGE_TAG:-}" ]; then
  TAG="$IMAGE_TAG"
  log "using pre-built image: $TAG"
  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    err "pre-built image $TAG not found locally"
    exit 1
  fi
else
  cd "$REPO_ROOT"
  SHA=$(git rev-parse --short=8 HEAD)
  SUFFIX="${1:-auto}"
  TAG="${IMAGE_REPO}:auto-${SHA}-${SUFFIX}"
  log "building from current HEAD: sha=${SHA} tag=${TAG}"

  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    BUILD_ARGS=(--build-arg "COMMIT_SHA=${SHA}")
    [ -n "${VITE_SENTRY_WEB_DSN:-}" ] && BUILD_ARGS+=(--build-arg "VITE_SENTRY_WEB_DSN=${VITE_SENTRY_WEB_DSN}")
    [ -n "${VITE_POSTHOG_KEY:-}" ] && BUILD_ARGS+=(--build-arg "VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY}")
    [ -n "${VITE_POSTHOG_HOST:-}" ] && BUILD_ARGS+=(--build-arg "VITE_POSTHOG_HOST=${VITE_POSTHOG_HOST}")
    SECRET_ARGS=()
    [ -n "${SENTRY_AUTH_TOKEN:-}" ] && SECRET_ARGS+=(--secret "id=sentry_auth_token,env=SENTRY_AUTH_TOKEN")
    [ -n "${SENTRY_ORG:-}" ] && BUILD_ARGS+=(--build-arg "SENTRY_ORG=${SENTRY_ORG}")
    [ -n "${SENTRY_PROJECT:-}" ] && BUILD_ARGS+=(--build-arg "SENTRY_PROJECT=${SENTRY_PROJECT}")
    DOCKER_BUILDKIT=1 docker build "${BUILD_ARGS[@]}" "${SECRET_ARGS[@]}" -t "$TAG" -f docker/Dockerfile .
  else
    log "image $TAG already exists locally; skipping build"
  fi
fi

# --- 2. Capture rollback target + live env ---

PREV_TAG=""
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  PREV_TAG=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
  log "current container image (rollback target): $PREV_TAG"

  TMP_LIVE_ENV=$(mktemp)
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$TMP_LIVE_ENV"
  log "captured $(wc -l <"$TMP_LIVE_ENV") env vars from live container"
else
  TMP_LIVE_ENV=$(mktemp)
  log "no existing container; secrets must come from operator shell"
fi

# --- 3. Build merged env file ---

MERGED_ENV=$(mktemp)
trap 'rm -f "$TMP_LIVE_ENV" "$MERGED_ENV"' EXIT

python3 - "$TMP_LIVE_ENV" "$CANONICAL_ENV" "$MERGED_ENV" <<'PY'
import sys, re

live_path, canon_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
RUNTIME_DROP = {"PATH", "NODE_VERSION", "YARN_VERSION", "HOME", "HOSTNAME"}
env = {}

with open(live_path) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k in RUNTIME_DROP:
            continue
        env[k] = v

env.pop("COMMIT_SHA", None)

placeholder_re = re.compile(r"^\$\{([A-Z_][A-Z0-9_]*)\}$")
with open(canon_path) as f:
    for line in f:
        line = line.rstrip("\n").rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        m = placeholder_re.match(v)
        if m:
            secret_name = m.group(1)
            if k in env and env[k]:
                continue
            shell_val = __import__("os").environ.get(secret_name, "")
            env[k] = shell_val
        else:
            env[k] = v

with open(out_path, "w") as f:
    for k, v in env.items():
        f.write(f"{k}={v}\n")

if env.get("FLOOM_CLOUD_MODE") != "1":
    print(f"FATAL: FLOOM_CLOUD_MODE != 1 in merged env (got {env.get('FLOOM_CLOUD_MODE')!r})", file=sys.stderr)
    sys.exit(2)

# Prod-specific guard: PUBLIC_URL MUST be https://floom.dev so generated URLs
# don't leak the preview origin.
if env.get("PUBLIC_URL") != "https://floom.dev":
    print(f"FATAL: prod PUBLIC_URL != https://floom.dev (got {env.get('PUBLIC_URL')!r})", file=sys.stderr)
    sys.exit(4)

critical = ["BETTER_AUTH_SECRET", "OPENAI_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY"]
missing = [k for k in critical if not env.get(k)]
if missing:
    print(f"FATAL: missing critical secrets: {missing}", file=sys.stderr)
    sys.exit(3)

print(f"merged env: {len(env)} keys", file=sys.stderr)
PY

log "merged env file: $MERGED_ENV"

# --- 3b. Append FLOOM_STORE_HIDE_SLUGS from kill list ---
#
# PROD adds the 3 docker-runtime apps on top of the shared kill list, because
# prod intentionally does NOT mount /var/run/docker.sock (security stance).
# The shared kill list (scripts/launch-kill-list.txt) hides ~100 SaaS-relay
# apps; the prod-extra list adds the docker apps so they don't surface in the
# directory and visitors don't click into a guaranteed-error.
PROD_EXTRA_HIDE="competitor-lens,ai-readiness-audit,pitch-coach"

if [ -f "$KILL_LIST" ] && ! grep -q '^FLOOM_STORE_HIDE_SLUGS=' "$MERGED_ENV"; then
  KILL_CSV=$(grep -v '^[[:space:]]*#' "$KILL_LIST" | grep -v '^[[:space:]]*$' | paste -sd, -)
  COMBINED="${KILL_CSV},${PROD_EXTRA_HIDE}"
  if [ -n "$COMBINED" ]; then
    echo "FLOOM_STORE_HIDE_SLUGS=${COMBINED}" >> "$MERGED_ENV"
    KILL_COUNT=$(echo "$COMBINED" | tr ',' '\n' | wc -l)
    log "appended FLOOM_STORE_HIDE_SLUGS (${KILL_COUNT} slugs: kill-list + prod docker apps)"
  fi
fi

# --- 4. Stop + remove old container ---

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  log "stopping + removing old container"
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
  docker rm "$CONTAINER" >/dev/null 2>&1 || true
fi

# --- 5. Run new container ---

log "starting new container with image $TAG"
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --memory 6g \
  --memory-reservation 2g \
  --memory-swap 6g \
  --oom-score-adj -500 \
  -p "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}" \
  --env-file "$MERGED_ENV" \
  "${BINDS[@]}" \
  "$TAG" >/dev/null

# --- 6. Verify ---

log "waiting for health check at $HEALTH_URL"
HEALTHY=0
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ $HEALTHY -ne 1 ]; then
  err "container failed health check after 60s"
  docker logs --tail 50 "$CONTAINER" >&2 || true
  if [ -n "$PREV_TAG" ]; then
    err "rolling back to $PREV_TAG"
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
    docker rm "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d \
      --name "$CONTAINER" \
      --restart unless-stopped \
      --memory 6g \
      --memory-reservation 2g \
      --memory-swap 6g \
      --oom-score-adj -500 \
      -p "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}" \
      --env-file "$MERGED_ENV" \
      "${BINDS[@]}" \
      "$PREV_TAG" >/dev/null
    err "rolled back. exiting nonzero so caller knows."
  fi
  exit 1
fi

# --- 7. Final guards: FLOOM_CLOUD_MODE + PUBLIC_URL must be live ---

LIVE_CLOUD=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^FLOOM_CLOUD_MODE=' | head -1 | cut -d= -f2-)
LIVE_PUBLIC_URL=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^PUBLIC_URL=' | head -1 | cut -d= -f2-)
LIVE_DOCKER_PUBLISH=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^FLOOM_ENABLE_DOCKER_PUBLISH=' | head -1 | cut -d= -f2-)
LIVE_SEED_APPS=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^FLOOM_SEED_APPS=' | head -1 | cut -d= -f2-)
if [ "$LIVE_CLOUD" != "1" ]; then
  err "FATAL: FLOOM_CLOUD_MODE != 1 in running container (got '$LIVE_CLOUD')"
  exit 1
fi
if [ "$LIVE_PUBLIC_URL" != "https://floom.dev" ]; then
  err "FATAL: PUBLIC_URL != https://floom.dev in running container (got '$LIVE_PUBLIC_URL')"
  exit 1
fi
if [ "$LIVE_DOCKER_PUBLISH" != "false" ]; then
  err "FATAL: FLOOM_ENABLE_DOCKER_PUBLISH != false in running container (got '$LIVE_DOCKER_PUBLISH')"
  exit 1
fi
if [ "$LIVE_SEED_APPS" != "false" ]; then
  err "FATAL: FLOOM_SEED_APPS != false in running container (got '$LIVE_SEED_APPS')"
  exit 1
fi

log "OK: container healthy, cloud/prod/security env gates verified"
log "image: $TAG"
log "url:   https://floom.dev"
