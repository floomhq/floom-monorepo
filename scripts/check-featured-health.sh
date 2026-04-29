#!/usr/bin/env bash
# check-featured-health.sh — probe all featured apps and alert on Discord when
# any are broken. Designed to run every 15 min via cron or systemd timer.
#
# Required env:
#   FLOOM_PUBLIC_ORIGIN   — canonical public URL (e.g. https://floom.dev)
#   FLOOM_AUTH_TOKEN      — admin bearer token for /api/admin/* endpoints
#
# Optional env:
#   DISCORD_ALERT_WEBHOOK_URL — Discord webhook; alert posted when broken > 0
#
# Usage (manual):
#   bash scripts/check-featured-health.sh
#
# Cron (every 15 min):
#   */15 * * * * /path/to/floom/scripts/check-featured-health.sh >> /var/log/floom-health.log 2>&1

set -euo pipefail

ORIGIN="${FLOOM_PUBLIC_ORIGIN:-}"
TOKEN="${FLOOM_AUTH_TOKEN:-}"
WEBHOOK="${DISCORD_ALERT_WEBHOOK_URL:-}"

if [[ -z "$ORIGIN" || -z "$TOKEN" ]]; then
  echo "[featured-health] ERROR: FLOOM_PUBLIC_ORIGIN and FLOOM_AUTH_TOKEN must be set" >&2
  exit 1
fi

ENDPOINT="${ORIGIN}/api/admin/featured-health"

echo "[featured-health] probing ${ENDPOINT} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

RESPONSE=$(curl -sf --max-time 30 \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" \
  "${ENDPOINT}" 2>&1) || {
  echo "[featured-health] ERROR: curl failed: $RESPONSE" >&2
  if [[ -n "$WEBHOOK" ]]; then
    curl -sf -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"🔴 Floom featured-health probe failed (curl error): ${RESPONSE:0:200}\"}" >/dev/null || true
  fi
  exit 1
}

BROKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('broken',0))" 2>/dev/null || echo "0")
TOTAL=$(echo "$RESPONSE"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "?")

echo "[featured-health] ${BROKEN}/${TOTAL} apps broken"

if [[ "$BROKEN" != "0" && "$BROKEN" != "" ]]; then
  SLUGS=$(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
broken = [r for r in d.get('results', []) if r.get('status') != 'ok']
for r in broken:
    print(f\"  {r['slug']}: {r.get('status')} — {r.get('error', '')}\")
" 2>/dev/null || echo "  (parse error)")

  MSG="🔴 Floom featured-health: ${BROKEN}/${TOTAL} apps broken at $(date -u +%H:%M) UTC
${SLUGS}
Env: ${ORIGIN}"

  echo "$MSG"

  if [[ -n "$WEBHOOK" ]]; then
    PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'content': sys.stdin.read()[:1900]}))" <<< "$MSG")
    curl -sf -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" >/dev/null || echo "[featured-health] WARNING: Discord post failed"
  fi
  exit 1
fi

echo "[featured-health] all ${TOTAL} featured apps OK"
