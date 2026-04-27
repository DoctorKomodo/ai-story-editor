# I8 — Automated backup–restore drill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/backup-restore-drill.sh` that proves the full round-trip works end-to-end: register a user, encrypt a chapter, dump the database, wipe + restore, log back in, and confirm the decrypted body matches the original sentinel. Once green, `[I3]`'s destructive verify is no longer scary — the backup pipeline has been demonstrated to recover real encrypted user content.

This is the automation behind the manual recovery drill described in `SELF_HOSTING.md`'s `[E15]` section. Operators run it after a Postgres upgrade, schema migration, or major release as a smoke test that recovery still works.

**Architecture:** Pure shell. Re-uses the existing `postgres` service from the dev stack (creates an isolated `storyeditor_drill_<ts>` database on the same instance — never touches the user's primary DB). Boots the `[I1]` `story-editor-backend` image as a transient container twice (once to seed, once to verify post-restore), each pointed at the drill DB on a free host port. Exercises real HTTP routes, not direct Prisma access — so the assertion path matches what an operator would do via the browser, and any regression in the route or repo layer is caught.

**Tech Stack:** Bash, `docker run`, `docker compose exec postgres` (for `createdb` / `dropdb` / `psql`), `curl`, `jq` for parsing API JSON. The drill DB lives on the existing compose-managed postgres; the transient backend joins the compose network so it can resolve `postgres` by name.

**Prerequisites:**
- `[I1]` shipped — the `story-editor-backend` image must be buildable / present locally.
- `[I5]` shipped — `scripts/backup-db.sh` exists. This plan extends it with two flags (`--db`, `--out`) so it can dump a non-default database to a non-default path.
- The compose stack's postgres service must be running. The drill itself does not run against compose's `backend`; it spins its own.

**Out of scope:**
- Replacing `[I5]`'s simple verify — `backup-db.sh` stays single-responsibility for cron-style use.
- Multi-user drill (we register a single test user; that's enough for the encrypt/decrypt round trip).
- Drilling the recovery-code reset path — covered by `[T1]` / `[AU16]` integration tests, not this script's job.
- Off-site backup integrity (rsync to S3, etc.) — operator policy.

---

### Task 1: Add the `[I8]` task to `TASKS.md`

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Insert the task in the I-series after `[I7]`**

Find the line ending `[I7]` (around line 673) and append after its verify line:

```markdown

- [ ] **[I8]** Automated backup–restore drill: `scripts/backup-restore-drill.sh` exercises the full round trip — register a user, encrypt a chapter, dump the database, wipe + restore, log back in, and confirm the decrypted body matches the seeded sentinel. Re-uses the [I1] backend image and the existing dev postgres (isolated drill database, never touches the primary DB). Extends [I5]'s `backup-db.sh` with `--db` and `--out` flags. Operator-facing — also serves as the automated form of [E15]'s quarterly recovery drill.
  - verify: `bash scripts/backup-restore-drill.sh`
```

- [ ] **Step 2: Commit**

```bash
git add TASKS.md
git commit -m "[I8] add task: automated backup-restore drill"
```

---

### Task 2: Extend `backup-db.sh` with `--db` and `--out` flags

The drill script needs to dump a specific database (`storyeditor_drill_<ts>`) to a specific path (so it doesn't litter `./backups/` with drill artifacts). The default behaviour stays unchanged.

**Files:**
- Modify: `scripts/backup-db.sh`

- [ ] **Step 1: Add the flags**

Replace the variable-setup section (everything between `cd "$REPO_ROOT"` and the pre-flight `if !` block) with:

```bash
OUT_DIR="./backups"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

SERVICE="postgres"
PG_USER="${POSTGRES_USER:-storyeditor}"
PG_DB="${POSTGRES_DB:-storyeditor}"
OUT_FILE="$OUT_DIR/inkwell-$TIMESTAMP.sql.gz"

usage() {
  cat <<USAGE >&2
Usage: $0 [--db <name>] [--out <path>]

Options:
  --db <name>   Database to dump (default: \$POSTGRES_DB or 'storyeditor').
  --out <path>  Output .sql.gz path (default: ./backups/inkwell-<timestamp>.sql.gz).
  -h, --help    Show this message.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)  PG_DB="$2"; shift 2 ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done
```

- [ ] **Step 2: Confirm the existing call path still works**

```bash
bash scripts/backup-db.sh
ls -lh backups/inkwell-*.sql.gz | tail -1
```

Expected: still produces a default-named dump.

- [ ] **Step 3: Confirm the new flags work**

```bash
bash scripts/backup-db.sh --db storyeditor --out /tmp/test-backup.sql.gz
ls -lh /tmp/test-backup.sql.gz
gunzip -t /tmp/test-backup.sql.gz && echo OK
rm /tmp/test-backup.sql.gz
```

Expected: writes to `/tmp/test-backup.sql.gz`; gzip integrity passes.

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-db.sh
git commit -m "[I8] backup-db.sh: --db and --out flags for drill use"
```

---

### Task 3: Write `scripts/backup-restore-drill.sh`

**Files:**
- Create: `scripts/backup-restore-drill.sh`

- [ ] **Step 1: Write the script**

```bash
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
    docker compose exec -T -u postgres postgres dropdb --if-exists "$DRILL_DB" \
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
docker compose exec -T -u postgres postgres createdb -O storyeditor "$DRILL_DB"

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
  -d "$(jq -n --arg u "$DRILL_USERNAME" --arg p "$DRILL_PASSWORD" \
        '{username:$u, password:$p}')")"

ACCESS_TOKEN="$(echo "$REG_RESPONSE" | jq -r '.accessToken')"
RECOVERY_CODE="$(echo "$REG_RESPONSE" | jq -r '.recoveryCode')"
[[ "$ACCESS_TOKEN" != "null" && -n "$ACCESS_TOKEN" ]] || {
  log "register did not return accessToken: $REG_RESPONSE"; exit 1; }
[[ "$RECOVERY_CODE" != "null" && -n "$RECOVERY_CODE" ]] || {
  log "register did not return recoveryCode: $REG_RESPONSE"; exit 1; }

auth_h() { echo "Authorization: Bearer $ACCESS_TOKEN"; }

log "creating story"
STORY_ID="$(curl -sf -X POST "$API/stories" \
  -H 'Content-Type: application/json' \
  -H "$(auth_h)" \
  -d '{"title":"Drill story"}' | jq -r '.id')"
[[ -n "$STORY_ID" && "$STORY_ID" != "null" ]] || { log "story create failed"; exit 1; }

log "creating chapter with sentinel"
CHAPTER_ID="$(curl -sf -X POST "$API/stories/${STORY_ID}/chapters" \
  -H 'Content-Type: application/json' \
  -H "$(auth_h)" \
  -d "$(jq -n --arg s "$SENTINEL" \
        '{title:"Drill chapter",
          bodyJson:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:$s}]}]}}'
       )" | jq -r '.id')"
[[ -n "$CHAPTER_ID" && "$CHAPTER_ID" != "null" ]] || { log "chapter create failed"; exit 1; }

# Sanity: the chapter we just created decrypts before backup.
PRE_BODY="$(curl -sf "$API/chapters/${CHAPTER_ID}" -H "$(auth_h)" \
  | jq -r '.bodyJson.content[0].content[0].text')"
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
docker compose exec -T -u postgres postgres dropdb "$DRILL_DB"
docker compose exec -T -u postgres postgres createdb -O storyeditor "$DRILL_DB"

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
POST_BODY="$(curl -sf "$API/chapters/${CHAPTER_ID}" -H "$(auth_h)" \
  | jq -r '.bodyJson.content[0].content[0].text')"

if [[ "$POST_BODY" != "$SENTINEL" ]]; then
  log "FAIL: post-restore chapter body did not match sentinel"
  log "  expected: $SENTINEL"
  log "  got:      $POST_BODY"
  exit 1
fi

log "PASS — encrypted chapter survived backup → wipe → restore → decrypt round trip"
# Cleanup happens via trap.
```

- [ ] **Step 2: Mark it executable**

```bash
chmod +x scripts/backup-restore-drill.sh
```

- [ ] **Step 3: Run it once**

```bash
bash scripts/backup-restore-drill.sh
```

Expected output (last few lines):

```
[drill] login OK — DEK was unwrappable with the original password after restore
[drill] fetching chapter <uuid>
[drill] PASS — encrypted chapter survived backup → wipe → restore → decrypt round trip
```

Exit code 0.

- [ ] **Step 4: Confirm cleanup happened**

```bash
docker compose exec -T -u postgres postgres psql -lqt | grep -c storyeditor_drill
ls backups/.drill-*.sql.gz 2>/dev/null | wc -l
docker ps --filter name=drill-backend --format '{{.Names}}' | wc -l
```

Expected: all three print `0`. The trap-based cleanup must leave nothing behind.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-restore-drill.sh
git commit -m "[I8] backup-restore drill: register → encrypt → backup → wipe → restore → decrypt"
```

---

### Task 4: Update `SELF_HOSTING.md` to reference the drill script

The `[E15]` recovery-drill section currently describes a manual browser-based flow. Add a one-liner pointing operators at the automated version.

**Files:**
- Modify: `SELF_HOSTING.md`

- [ ] **Step 1: Find the existing recovery-drill section**

Locate the heading `### 3. Recovery drill (operator guidance)` and its current numbered steps.

- [ ] **Step 2: Insert a new paragraph immediately above the numbered list**

Insert (preserving the existing numbered list exactly as it is):

```markdown
A scripted version of the drill ships as `scripts/backup-restore-drill.sh`
([I8]). It runs end-to-end against an isolated drill database on the live
postgres (no impact on the primary DB), so you can wire it into a cron or
CI step without touching production data:

```bash
bash scripts/backup-restore-drill.sh
```

Exit code 0 = encrypted user content was successfully recovered. The
manual recipe below is still the recommended human cross-check — at least
once per quarter, and after any Postgres major-version upgrade or schema
migration.
```

- [ ] **Step 3: Commit**

```bash
git add SELF_HOSTING.md
git commit -m "[I8] reference automated drill script in SELF_HOSTING recovery section"
```

---

### Task 5: Failure-mode regression check

Confirm the drill actually catches a broken backup. This is the test of the test — without it, a no-op script would still pass the verify.

**Files:** none (manual sanity check, no commit).

- [ ] **Step 1: Temporarily corrupt the backup mid-flight**

Edit `scripts/backup-restore-drill.sh` and add this line immediately *after* the line `gunzip -t "$DRILL_BACKUP" || …`:

```bash
# TEMP: corrupt the dump to confirm the drill actually catches a broken backup.
echo "BROKEN" >> "$DRILL_BACKUP"
```

- [ ] **Step 2: Run the drill**

```bash
bash scripts/backup-restore-drill.sh
echo "exit: $?"
```

Expected: non-zero exit, with logs showing the `psql` restore failing and the script exiting before it gets to the post-restore login. If the drill exits 0 with the corruption injected, the assertion is too lax — fix it before continuing.

- [ ] **Step 3: Revert the temporary corruption line**

```bash
git checkout -- scripts/backup-restore-drill.sh
```

Re-run the drill clean to confirm exit 0.

---

### Task 6: Verify gate

- [ ] **Step 1: Run via `/task-verify I8`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I8] tick — automated backup-restore drill"
```

---

## Self-Review Notes

- **Why two backend boots, not one.** A single backend can't have its `DATABASE_URL` flipped at runtime — Prisma resolves it on connect. Stopping/starting is the cleanest way to point the same image at a fresh-restored DB. Each boot is ~3-4 seconds; total drill runtime ~25 seconds.
- **Why a separate DB instead of `down -v`.** Using a separate database on the existing postgres means the drill is non-destructive to the operator's actual data. The `[I3]` verify (which *does* `down -v`) is now an independent concern; this drill establishes that the recovery pipeline works regardless.
- **Why API-driven, not direct-Prisma.** Per the design discussion: this matches what an operator does after a real disaster (they log in via the browser and read their chapters), so a green drill is concrete evidence of operator-eye-view recovery. A direct-Prisma assertion would prove only the crypto library, not that the route layer's decrypt-on-read still works.
- **Why a per-run `APP_ENCRYPTION_KEY`.** This drill never seeds a Venice key, so the encryption key only has to satisfy `validateEncryptionEnv()` at boot. Generating fresh per run avoids any temptation to pin a key in the repo.
- **Trap-based cleanup.** The `EXIT` trap fires on `set -e` failures too, so partial-run state (the drill DB, the transient container, the temp `.sql.gz`) gets cleaned up regardless of where the script bails.
- **`docker compose exec -u postgres postgres`** runs `createdb`/`dropdb`/`psql` as the postgres OS user — bypasses any password-prompt config that might be in place. Same approach `[I5]` uses.
- **`gunzip -t` after `backup-db.sh`.** Belt-and-braces: a corrupt gzip would also fail at `psql` restore time, but catching it earlier produces a clearer error.
- **Free-port discovery.** `python3` is reasonable to assume on a Docker-capable Linux host; if not, `node -e "require('net').createServer().listen(0, function(){console.log(this.address().port);this.close()})"` is the fallback. Keep python3 unless someone reports it missing.
- **Failure-injection sanity check (Task 5).** Adds confidence that the drill is doing actual work rather than silently no-op'ing on missing-data. Manual check, no commit needed.
- **Not in CI.** This drill runs against the live dev postgres on the operator's laptop; it's not appropriate for CI without a different orchestration. If a CI variant is wanted later, that's a follow-up — same script, but it spins its own postgres container instead of attaching to compose.
