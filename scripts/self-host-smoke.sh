#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${FLOOM_SELF_HOST_SMOKE_PROJECT:-floom_selfhost_smoke_$(date +%s)_$$}"
IMAGE_TAG="${FLOOM_SELF_HOST_SMOKE_IMAGE:-floom-selfhost-smoke:${PROJECT_NAME}}"
HOST_PORT="${FLOOM_SELF_HOST_SMOKE_PORT:-}"
TMP_DIR="$(mktemp -d /tmp/floom-selfhost-smoke.XXXXXX)"

cleanup() {
  set +e
  docker compose -p "$PROJECT_NAME" -f "$TMP_DIR/docker-compose.yml" -f "$TMP_DIR/docker-compose.override.yml" down -v --remove-orphans >/dev/null 2>&1
  docker image rm "$IMAGE_TAG" >/dev/null 2>&1
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if ! docker compose version >/dev/null 2>&1; then
  echo "[self-host-smoke] docker compose is required" >&2
  exit 1
fi

if [ -z "$HOST_PORT" ]; then
  HOST_PORT="$(node -e "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});")"
fi

export FLOOM_HOST=127.0.0.1
export FLOOM_HOST_PORT="$HOST_PORT"
export NODE_ENV=development
export PORT=3051
export PUBLIC_URL="http://localhost:${HOST_PORT}"

cp "$ROOT_DIR/docker/docker-compose.yml" "$TMP_DIR/docker-compose.yml"
cp "$ROOT_DIR/docker/apps.yaml.example" "$TMP_DIR/apps.yaml"

cat > "$TMP_DIR/docker-compose.override.yml" <<EOF
services:
  floom:
    image: ${IMAGE_TAG}
    build:
      context: ${ROOT_DIR}
      dockerfile: docker/Dockerfile
    environment:
      NODE_ENV: development
      PORT: "3051"
      PUBLIC_URL: "http://localhost:${HOST_PORT}"
      FLOOM_FAST_APPS: "false"
EOF

echo "[self-host-smoke] project=$PROJECT_NAME image=$IMAGE_TAG port=$HOST_PORT"
docker compose -p "$PROJECT_NAME" -f "$TMP_DIR/docker-compose.yml" -f "$TMP_DIR/docker-compose.override.yml" up -d --build

deadline=$((SECONDS + 90))
health_url="http://127.0.0.1:${HOST_PORT}/api/health"
session_url="http://127.0.0.1:${HOST_PORT}/api/session/me"
health_json="$TMP_DIR/health.json"
session_json="$TMP_DIR/session.json"

until curl -fsS "$health_url" >"$health_json"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "[self-host-smoke] timed out waiting for $health_url" >&2
    docker compose -p "$PROJECT_NAME" -f "$TMP_DIR/docker-compose.yml" -f "$TMP_DIR/docker-compose.override.yml" logs --tail=120 floom >&2 || true
    exit 1
  fi
  sleep 2
done

node -e "const fs=require('node:fs'); const h=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if (h.status !== 'ok') { console.error(h); process.exit(1); }" "$health_json"
curl -fsS "$session_url" >"$session_json"

echo "[self-host-smoke] health ok: $(cat "$health_json")"
echo "[self-host-smoke] session ok: $(cat "$session_json")"
