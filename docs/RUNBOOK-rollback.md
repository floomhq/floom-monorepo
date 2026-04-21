# Rollback runbook

Plain-English steps to roll floom.dev back to the last working version.
Copy-paste as you go. All commands run on AX41 (`ssh ax41`).

## What is production

- `preview.floom.dev` and `floom.dev` both point at the same container
  (reconciled 2026-04-21). No separate prod stack.
- Nginx forwards both hosts to `127.0.0.1:3051` → `floom-mcp-preview` container.
- Compose file: `/opt/floom-mcp-preview/docker-compose.yml`.
- `/opt/floom-deploy/` is dead; `PROMOTE-LOG.md` there is kept as history only.

## Step 1 — See what is running right now

```bash
docker ps --format '{{.Names}} {{.Image}}' | grep floom-mcp-preview
```

Prints e.g. `floom-mcp-preview floom-preview-local:launch-hero-f682baf`.
The part after the colon is the **current tag**. Write it down (you need
it to roll forward if the rollback itself fails).

## Step 2 — Find the last known-good tag

```bash
cat /opt/floom-deploy/PROMOTE-LOG.md                                       # history log
docker images floom-preview-local --format '{{.Tag}} {{.CreatedSince}}' | head -10
```

Pick the tag live right before the current one. Names look like
`launch-batch-7ed23df` or `launch-hero-<shortsha>`.

## Step 3 — Pin the old tag and restart

```bash
cd /opt/floom-mcp-preview
cp docker-compose.yml docker-compose.yml.$(date +%Y%m%d-%H%M%S).bak        # snapshot
sed -i 's|floom-preview-local:[^ ]*|floom-preview-local:OLD_TAG|' docker-compose.yml
docker compose up -d --no-deps floom-mcp-preview                           # ~2 sec boot
```

Replace `OLD_TAG` with the tag from Step 2. `--no-deps` leaves nginx alone.

## Step 4 — Smoke test after rollback

Every one must return `200`:

```bash
for p in / /apps /pricing /p/lead-scorer /api/health; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://floom.dev$p)  $p"
done
curl -s https://floom.dev/ | grep -oE '<title>[^<]+</title>'
# expected: <title>Ship AI apps fast · Floom</title>
```

If any fail, the rollback tag is also bad. Pick an older tag and retry.

## When to roll back

Roll back if any of these is true for **more than 2 minutes**:

- Home page shows an error, blank screen, or stack trace.
- More than 5% of requests to floom.dev return a 5xx.
- More than half of demo runs fail (`/p/lead-scorer`,
  `/p/competitor-analyzer`, `/p/resume-screener`).
- The "Try it" button on the homepage does nothing.

Single-app failures: check if a config fix is faster before rolling back.

## After a rollback

1. Tell Federico immediately. Loop in any cofounder later added.
2. Open issue on `floomhq/floom`: `rollback YYYY-MM-DD: <reason>`.
3. Include: rolled-to tag, bad tag, smoke-test output, suspected cause.
4. Don't fix-forward the same day unless the fix is tiny and locally verified.

## Common gotchas

- Never `docker compose down` then `up`. Always swap in place with
  `docker compose up -d --no-deps`. Down + up can lose the Better Auth
  session DB.
- `floom-preview-local:<tag>` images only live on AX41 (no registry push).
  Pruned tags must be rebuilt from git (see `docs/SELF_HOST.md`).
- Rollback does not revert DB migrations. If the bad release added one,
  restoring the old image on the same volume may crash on boot. Ask
  Federico; volume snapshots: `/var/lib/docker/volumes/floom-chat-deploy_floom-chat-data/`.
