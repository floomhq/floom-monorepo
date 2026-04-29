#!/usr/bin/env bash
# redeploy-mvp.sh — canonical redeploy for floom-mvp-preview (mvp.floom.dev)
#
# Why this script exists:
#   FLOOM_CLOUD_MODE=1 was lost three times during R7 agent rebuilds.
#   Each agent did its own ad-hoc `docker run` and missed env vars. Login
#   broke each time. This script is now the SINGLE supported redeploy
#   path. Any other rebuild path is a regression.
#
# What it does:
#   1. Build floom-mvp-preview:auto-<sha>-<tag> from current HEAD.
#   2. Capture the running container's full env (secrets included).
#   3. Merge with scripts/mvp.env.canonical (canonical wins on conflict
#      for non-secret keys; secrets passthrough from live container).
#   4. Stop + remove old container.
#   5. Run new container with merged env, correct port (3057:3000),
#      restart policy, and the same volume binds as before.
#   6. Health-check, verify FLOOM_CLOUD_MODE=1 is present in new env.
#   7. On failure: roll back to the previous image tag and abort.
#
# Usage:
#   bash scripts/redeploy-mvp.sh                 # builds from current HEAD, uses default tag
#   bash scripts/redeploy-mvp.sh r7ui            # builds with custom tag suffix
#   IMAGE_TAG=floom-mvp-preview:foo bash scripts/redeploy-mvp.sh  # use pre-built image
#
# DO NOT replace this with `docker run` ad-hoc. The whole point is that
# FLOOM_CLOUD_MODE=1 cannot drift. If you need to add a new env var,
# add it to scripts/mvp.env.canonical and re-run this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL_ENV="${REPO_ROOT}/scripts/mvp.env.canonical"
KILL_LIST="${REPO_ROOT}/scripts/launch-kill-list.txt"
CONTAINER=floom-mvp-preview
HOST_PORT=3057
CONTAINER_PORT=3000
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"

# Volume binds — match what's been live. Keep in sync if storage layout changes.
#
# docker.sock NOTE (2026-04-29): mvp keeps the docker.sock bind because 3 of
# the launch-week demo apps (competitor-lens, ai-readiness-audit, pitch-coach)
# are app_type=docker — they spawn a runner container per run via the host
# Docker daemon. Without this bind they error with `connect ENOENT
# /var/run/docker.sock`. PROD and PREVIEW intentionally DO NOT have this
# bind: the security exposure is unacceptable on user-facing surfaces. Once
# the Docker isolation pass lands (gVisor / kata-containers) we can re-add
# it everywhere.
BINDS=(
  "-v" "floom-mvp-data:/data"
  "-v" "/var/run/docker.sock:/var/run/docker.sock"
  "-v" "/opt/floom-preview-apps:/apps"
  "-v" "/opt/floom-mvp-file-inputs:/floom-file-inputs"
)

log() { printf '\033[36m[redeploy-mvp]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[redeploy-mvp]\033[0m %s\n' "$*" >&2; }

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
  TAG="floom-mvp-preview:auto-${SHA}-${SUFFIX}"
  log "building from current HEAD: sha=${SHA} tag=${TAG}"

  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    # Build args for client-side instrumentation (baked into web bundle).
    # All optional — if env var unset, the bundle ships without that hook.
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

# --- 2. Capture current image tag for rollback + capture current env ---

PREV_TAG=""
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  PREV_TAG=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
  log "current container image (rollback target): $PREV_TAG"

  # Pull the live container's env so we can preserve secrets + anything
  # canonical doesn't list. This is sourced as KEY=VALUE pairs.
  TMP_LIVE_ENV=$(mktemp)
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$TMP_LIVE_ENV"
  log "captured $(wc -l <"$TMP_LIVE_ENV") env vars from live container"
else
  TMP_LIVE_ENV=$(mktemp)
  log "no existing container; secrets must come from operator shell"
fi

# --- 3. Build the merged env file ---
#
# Strategy:
#   - Start with the live container's env (preserves all secrets).
#   - Drop runtime-only / Docker-injected keys that should not survive
#     (PATH, NODE_VERSION, YARN_VERSION, COMMIT_SHA — the new container's
#     image will set these correctly).
#   - Layer canonical env on top: every non-secret-placeholder line from
#     mvp.env.canonical wins over the live value.
#   - For secret placeholders (${VAR}), keep whatever the live container had.

MERGED_ENV=$(mktemp)
trap 'rm -f "$TMP_LIVE_ENV" "$MERGED_ENV"' EXIT

python3 - "$TMP_LIVE_ENV" "$CANONICAL_ENV" "$MERGED_ENV" <<'PY'
import sys, re

live_path, canon_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

# Keys that the new container's image/runtime should set, not us.
RUNTIME_DROP = {"PATH", "NODE_VERSION", "YARN_VERSION", "HOME", "HOSTNAME"}

env = {}

# 1. Load live env (preserves secrets).
with open(live_path) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k in RUNTIME_DROP:
            continue
        env[k] = v  # last write wins (handles duplicate COMMIT_SHA case)

# Specifically nuke COMMIT_SHA — image will set it fresh via build-arg if needed.
env.pop("COMMIT_SHA", None)

# 2. Layer canonical on top. Lines are KEY=VALUE; empty values OK.
#    For VALUE that looks like ${SECRET_NAME}, preserve live value if present.
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
            # Use the live value if present; else keep whatever shell exports.
            if k in env and env[k]:
                continue  # already preserved from live env
            shell_val = __import__("os").environ.get(secret_name, "")
            env[k] = shell_val
        else:
            # Canonical wins (literal value).
            env[k] = v

# 3. Write merged env file.
with open(out_path, "w") as f:
    for k, v in env.items():
        # Quote in env-file format: docker --env-file does NOT do shell parsing.
        # Newlines/= in values are illegal anyway; just write KEY=VALUE.
        f.write(f"{k}={v}\n")

# 4. Sanity: FLOOM_CLOUD_MODE MUST be set to "1".
if env.get("FLOOM_CLOUD_MODE") != "1":
    print(f"FATAL: FLOOM_CLOUD_MODE != 1 in merged env (got {env.get('FLOOM_CLOUD_MODE')!r})", file=sys.stderr)
    sys.exit(2)

# 5. Sanity: critical secrets present.
critical = ["BETTER_AUTH_SECRET", "OPENAI_API_KEY", "GEMINI_API_KEY"]
missing = [k for k in critical if not env.get(k)]
if missing:
    print(f"FATAL: missing critical secrets: {missing}", file=sys.stderr)
    sys.exit(3)

print(f"merged env: {len(env)} keys", file=sys.stderr)
PY

log "merged env file: $MERGED_ENV"

# --- 3b. Append FLOOM_STORE_HIDE_SLUGS from the kill list, if present. ---
#
# data/launch-kill-list.txt is the durable in-repo source of truth for which
# SaaS-relay apps to suppress from the public directory. The server reads
# FLOOM_STORE_HIDE_SLUGS at boot (apps/server/src/routes/hub.ts), so we
# materialize it into the merged env file here. Canonical env wins on
# conflict — if the file already declares FLOOM_STORE_HIDE_SLUGS we leave
# it alone.

if [ -f "$KILL_LIST" ] && ! grep -q '^FLOOM_STORE_HIDE_SLUGS=' "$MERGED_ENV"; then
  KILL_CSV=$(grep -v '^[[:space:]]*#' "$KILL_LIST" | grep -v '^[[:space:]]*$' | paste -sd, -)
  if [ -n "$KILL_CSV" ]; then
    echo "FLOOM_STORE_HIDE_SLUGS=${KILL_CSV}" >> "$MERGED_ENV"
    KILL_COUNT=$(echo "$KILL_CSV" | tr ',' '\n' | wc -l)
    log "FLOOM_STORE_HIDE_SLUGS loaded from data/launch-kill-list.txt (${KILL_COUNT} slugs)"
  fi
fi

# --- 4. Stop + remove old container ---

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  log "stopping + removing old container"
  docker stop "$CONTAINER" >/dev/null
  docker rm "$CONTAINER" >/dev/null
fi

# --- 5. Run new container ---

log "starting new container with image $TAG"
# Memory protection (added 2026-04-29 after AX41 OOM event killed sidecars):
#   --memory 6g            hard cap (prevent floom from runaway)
#   --memory-reservation 2g  soft floor (kernel kills others first)
#   --oom-score-adj -500   make this container the LAST thing OOM killer picks
# Without these, when AX41 hits memory pressure, the container's child sidecars
# (fast-apps, launch-week) get SIGTERM'd by OOM and demo apps go down.
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

# Verify FLOOM_CLOUD_MODE=1 is actually in the new container env.
if ! docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q '^FLOOM_CLOUD_MODE=1$'; then
  err "FLOOM_CLOUD_MODE=1 NOT present in new container env. This is the bug we're trying to prevent."
  err "Investigate $MERGED_ENV and the env-file precedence."
  exit 1
fi

log "OK: container healthy, FLOOM_CLOUD_MODE=1 verified"
log "image: $TAG"
log "url:   https://mvp.floom.dev"
