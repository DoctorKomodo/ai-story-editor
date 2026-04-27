#!/usr/bin/env bash
# scripts/backup-restore-drill.sh — full backup-then-restore round trip.
#
# Spins up an isolated drill database on the running postgres, registers a
# test user, creates an encrypted chapter, takes a backup, wipes the drill
# DB, restores from the backup, logs back in, fetches the chapter, and
# asserts the decrypted body matches the sentinel string seeded earlier.
#
# Usage:
#   bash scripts/backup-restore-drill.sh
#
# Requirements:
#   - The compose stack's postgres service must be running.
#   - The story-editor-backend image must be present locally (built by [I1]).
#
# Exit codes:
#   0  — round trip succeeded; backup is recoverable
#   1  — drill failed somewhere; see logs

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------- helpers -------------------------------------------------------

log() { echo "[drill] $*" >&2; }

# Used by trap; safe to call at any point even before resources are created.
cleanup() {
  set +e
  if [[ -n "${BACKEND_CID:-}" ]]; then
    docker stop "$BACKEND_CID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${DRILL_DB:-}" ]]; then
    docker compose exec -T postgres dropdb -U storyeditor --if-exists "$DRILL_DB" \
      >/dev/null 2>&1 || true
  fi
  if [[ -n "${DRILL_BACKUP:-}" && -f "$DRILL_BACKUP" ]]; then
    rm -f "$DRILL_BACKUP"
  fi
  set -e
}
trap cleanup EXIT

# Random free TCP port so concurrent drills (or a running dev stack on 4000)
# never collide.
free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
}

# ---------- pre-flight ----------------------------------------------------

if ! docker compose ps --services --filter "status=running" | grep -qx postgres; then
  log "postgres service is not running — start the dev stack first"
  exit 1
fi

if ! docker image inspect story-editor-backend >/dev/null 2>&1; then
  log "story-editor-backend image not found — run [I1] first (docker build -t story-editor-backend ./backend)"
  exit 1
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "$cmd is required on the host"
    exit 1
  fi
done

# ---------- setup ---------------------------------------------------------

TS="$(date +%s)"
DRILL_DB="storyeditor_drill_${TS}"
DRILL_BACKUP="./backups/.drill-${TS}.sql.gz"
DRILL_PORT="$(free_port)"
DRILL_USERNAME="drill_user_${TS}"
DRILL_PASSWORD="drill-pw-${TS}-correct-horse-battery-staple"
SENTINEL="DRILL-SENTINEL-${TS}-do-not-occur-by-chance"

# Encryption key for the transient backend. Random per run; the dump-and-
# restore round trip preserves Venice-key ciphertext too, but this drill
# doesn't seed any Venice key so it's just here to satisfy boot validation.
APP_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"

# Network name (compose-default is "<project>_default"). Resolve dynamically
# from the running postgres container so we don't hard-code the project name.
PG_CID="$(docker compose ps -q postgres)"
NETWORK="$(docker inspect "$PG_CID" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"

log "drill DB: $DRILL_DB | port: $DRILL_PORT | network: $NETWORK"

# ---------- create the drill DB and migrate -------------------------------

log "creating drill database $DRILL_DB"
docker compose exec -T postgres createdb -U storyeditor -O storyeditor "$DRILL_DB"

# We let the backend's entrypoint run prisma migrate deploy on first boot,
# rather than running migrations from the host — keeps everything inside
# the same toolchain that real operators use.

# ---------- boot the transient backend ------------------------------------

log "booting transient backend on host port $DRILL_PORT"
BACKEND_CID="$(docker run --rm -d \
  --name "drill-backend-${TS}" \
  --network "$NETWORK" \
  -p "${DRILL_PORT}:4000" \
  -e "DATABASE_URL=postgresql://storyeditor:storyeditor@postgres:5432/${DRILL_DB}" \
  -e "JWT_SECRET=drill-jwt-${TS}" \
  -e "REFRESH_TOKEN_SECRET=drill-refresh-${TS}" \
  -e "APP_ENCRYPTION_KEY=${APP_KEY}" \
  -e "FRONTEND_URL=http://localhost:${DRILL_PORT}" \
  story-editor-backend)"

# Wait for /api/health to flip green. Migrations apply during this window.
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${DRILL_PORT}/api/health" \
       | grep -q '"status":"ok"' 2>/dev/null; then
    log "backend healthy after ${i}s"
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    log "backend never became healthy"
    docker logs "$BACKEND_CID" | tail -40 >&2
    exit 1
  fi
  sleep 1
done

# ---------- seed: register a user and create an encrypted chapter ---------

API="http://localhost:${DRILL_PORT}/api"

log "registering test user"
REG_RESPONSE="$(curl -sf -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$DRILL_USERNAME" --arg p "$DRILL_PASSWORD" --arg n "Drill User" \
        '{name:$n, username:$u, password:$p}')")"

RECOVERY_CODE="$(echo "$REG_RESPONSE" | jq -r '.recoveryCode')"
[[ "$RECOVERY_CODE" != "null" && -n "$RECOVERY_CODE" ]] || {
  log "register did not return recoveryCode: $REG_RESPONSE"; exit 1; }

# Register doesn't return an accessToken — log in to get one.
log "logging in (post-register) to get access token"
LOGIN_RESPONSE="$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$DRILL_USERNAME" --arg p "$DRILL_PASSWORD" \
        '{username:$u, password:$p}')")"
ACCESS_TOKEN="$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')"
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || {
  log "post-register login failed: $LOGIN_RESPONSE"; exit 1; }

auth_h() { echo "Authorization: Bearer $ACCESS_TOKEN"; }

log "creating story"
STORY_ID="$(curl -sf -X POST "$API/stories" \
  -H 'Content-Type: application/json' \
  -H "$(auth_h)" \
  -d '{"title":"Drill story"}' | jq -r '.story.id')"
[[ -n "$STORY_ID" && "$STORY_ID" != "null" ]] || { log "story create failed"; exit 1; }

log "creating chapter with sentinel"
CHAPTER_ID="$(curl -sf -X POST "$API/stories/${STORY_ID}/chapters" \
  -H 'Content-Type: application/json' \
  -H "$(auth_h)" \
  -d "$(jq -n --arg s "$SENTINEL" \
        '{title:"Drill chapter",
          bodyJson:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:$s}]}]}}'
       )" | jq -r '.chapter.id')"
[[ -n "$CHAPTER_ID" && "$CHAPTER_ID" != "null" ]] || { log "chapter create failed"; exit 1; }

# Sanity: the chapter we just created decrypts before backup.
PRE_BODY="$(curl -sf "$API/stories/${STORY_ID}/chapters/${CHAPTER_ID}" -H "$(auth_h)" \
  | jq -r '.chapter.body.content[0].content[0].text')"
if [[ "$PRE_BODY" != "$SENTINEL" ]]; then
  log "pre-backup chapter body did not match sentinel ($PRE_BODY)"
  exit 1
fi
log "pre-backup decrypt OK"

# ---------- backup --------------------------------------------------------

log "running backup-db.sh against drill DB"
bash scripts/backup-db.sh --db "$DRILL_DB" --out "$DRILL_BACKUP"
gunzip -t "$DRILL_BACKUP" || { log "backup gzip integrity failed"; exit 1; }
log "backup written and gzip-verified ($(du -h "$DRILL_BACKUP" | cut -f1))"

# ---------- wipe + restore ------------------------------------------------

log "stopping transient backend before wipe"
docker stop "$BACKEND_CID" >/dev/null
BACKEND_CID=""

log "dropping and recreating drill DB"
docker compose exec -T postgres dropdb -U storyeditor "$DRILL_DB"
docker compose exec -T postgres createdb -U storyeditor -O storyeditor "$DRILL_DB"

log "restoring from backup"
gunzip -c "$DRILL_BACKUP" \
  | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U storyeditor -d "$DRILL_DB" \
    >/dev/null

# ---------- verify: log back in and confirm the sentinel decrypts ---------

log "rebooting transient backend against restored DB"
BACKEND_CID="$(docker run --rm -d \
  --name "drill-backend-${TS}-post" \
  --network "$NETWORK" \
  -p "${DRILL_PORT}:4000" \
  -e "DATABASE_URL=postgresql://storyeditor:storyeditor@postgres:5432/${DRILL_DB}" \
  -e "JWT_SECRET=drill-jwt-${TS}" \
  -e "REFRESH_TOKEN_SECRET=drill-refresh-${TS}" \
  -e "APP_ENCRYPTION_KEY=${APP_KEY}" \
  -e "FRONTEND_URL=http://localhost:${DRILL_PORT}" \
  story-editor-backend)"

for i in $(seq 1 30); do
  if curl -sf "http://localhost:${DRILL_PORT}/api/health" \
       | grep -q '"status":"ok"' 2>/dev/null; then
    log "backend healthy post-restore after ${i}s"
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    log "post-restore backend never became healthy"
    docker logs "$BACKEND_CID" | tail -40 >&2
    exit 1
  fi
  sleep 1
done

log "logging in as $DRILL_USERNAME"
LOGIN_RESPONSE="$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$DRILL_USERNAME" --arg p "$DRILL_PASSWORD" \
        '{username:$u, password:$p}')")"
ACCESS_TOKEN="$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')"
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || {
  log "post-restore login failed: $LOGIN_RESPONSE"; exit 1; }
log "login OK — DEK was unwrappable with the original password after restore"

log "fetching chapter $CHAPTER_ID"
POST_BODY="$(curl -sf "$API/stories/${STORY_ID}/chapters/${CHAPTER_ID}" -H "$(auth_h)" \
  | jq -r '.chapter.body.content[0].content[0].text')"

if [[ "$POST_BODY" != "$SENTINEL" ]]; then
  log "FAIL: post-restore chapter body did not match sentinel"
  log "  expected: $SENTINEL"
  log "  got:      $POST_BODY"
  exit 1
fi

log "PASS — encrypted chapter survived backup → wipe → restore → decrypt round trip"
# Cleanup happens via trap.
