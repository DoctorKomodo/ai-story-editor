# I5 — `scripts/backup-db.sh`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `scripts/backup-db.sh` shell script that runs `pg_dump` inside the running `postgres` container and writes a timestamped `.sql.gz` to `./backups/` on the host.

**Architecture:** Pure shell. Uses `docker compose exec` (or `docker exec`) to invoke `pg_dump` against the live database, pipes through `gzip`, redirects to a host file. Script is idempotent re: directory creation, exits non-zero on any failure (`set -euo pipefail`), and prints the resulting file path so cron / human runs can pipe the result somewhere.

**Tech Stack:** Bash, `docker compose exec`, `pg_dump`, `gzip`. POSIX-ish enough to run on the typical Linux self-host.

**Prerequisites:** `[I3]` (a running compose stack with a `postgres` service named `postgres`).

**Out of scope:**
- Restore script — the `psql ... | gunzip` recipe goes in `[I6]`'s `SELF_HOSTING.md`.
- Off-site rotation / S3 upload — operator's call; the script's output is well-suited for pipelining.
- Backing up `APP_ENCRYPTION_KEY` — covered separately in `SELF_HOSTING.md`.

---

### Task 1: Add the `backups/` directory marker

**Files:**
- Create: `backups/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create the directory placeholder**

```bash
mkdir -p backups
: > backups/.gitkeep
```

- [ ] **Step 2: Add `backups/*.sql.gz` to `.gitignore`**

Append to `.gitignore`:

```
backups/*.sql.gz
```

(Keep `backups/.gitkeep` tracked so the directory exists in fresh clones.)

- [ ] **Step 3: Commit**

```bash
git add backups/.gitkeep .gitignore
git commit -m "[I5] track backups/ directory and ignore generated dumps"
```

---

### Task 2: Write `scripts/backup-db.sh`

**Files:**
- Create: `scripts/backup-db.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/backup-db.sh — dump the live postgres database to ./backups/
#
# Usage:
#   bash scripts/backup-db.sh
#
# Output:
#   ./backups/inkwell-YYYYMMDD-HHMMSS.sql.gz
#
# Exit codes:
#   0  — backup written
#   1  — postgres container not running, or pg_dump failed
#
# Note: this dumps user data, including the encrypted-at-rest narrative
# columns and BYOK Venice ciphertext. The dump is *useless* without the
# corresponding APP_ENCRYPTION_KEY (for Venice keys) and the users' own
# passwords / recovery codes (for narrative). Treat it as if it were
# plaintext anyway — see SELF_HOSTING.md key-backup section.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="./backups"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/inkwell-$TIMESTAMP.sql.gz"

# Resolve the postgres user/db from the running container's env, falling back
# to the documented defaults so the script works on a default install.
SERVICE="postgres"
PG_USER="${POSTGRES_USER:-storyeditor}"
PG_DB="${POSTGRES_DB:-storyeditor}"

# Confirm the postgres service is up before we write any output file.
if ! docker compose ps --services --filter "status=running" | grep -qx "$SERVICE"; then
  echo "[backup-db] postgres service is not running — start the stack with 'make dev' first" >&2
  exit 1
fi

echo "[backup-db] dumping $PG_DB as $PG_USER -> $OUT_FILE"

# pg_dump streams to stdout; gzip on the host avoids needing gzip in the image.
docker compose exec -T "$SERVICE" pg_dump \
    --username "$PG_USER" \
    --dbname "$PG_DB" \
    --no-owner --no-acl \
  | gzip -c > "$OUT_FILE"

# pg_dump's exit status propagates because of `set -o pipefail`.
echo "[backup-db] wrote $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
```

- [ ] **Step 2: Mark it executable**

```bash
chmod +x scripts/backup-db.sh
```

- [ ] **Step 3: Manually run it once**

```bash
docker compose up -d
sleep 8
bash scripts/backup-db.sh
ls -lh backups/*.sql.gz | head -1
gunzip -t backups/*.sql.gz && echo "gzip integrity OK"
```

Expected: a `.sql.gz` is written; `gunzip -t` exits 0.

- [ ] **Step 4: Run the verify command verbatim**

```bash
bash scripts/backup-db.sh && ls backups/*.sql.gz | head -1
```

Expected: exit 0 and a path printed.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-db.sh
git commit -m "[I5] backup-db.sh: timestamped pg_dump to ./backups/"
```

---

### Task 3: Restore-recipe documentation pointer

**Files:**
- Modify: nothing here (the recipe lives in `[I6]`).

- [ ] **Step 1: Note in TASKS.md or a follow-up that the matching restore line goes in `SELF_HOSTING.md` under "Backup and restore"**

Suggested copy for `[I6]` to consume:

```bash
gunzip -c backups/inkwell-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose exec -T postgres psql -U storyeditor -d storyeditor
```

No commit on this step — it's a hand-off note for `[I6]`.

---

### Task 4: Verify gate

- [ ] **Step 1: Run via `/task-verify I5`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I5] tick — backup-db.sh"
```

---

## Self-Review Notes

- **`docker compose exec -T`** disables TTY allocation — required when piping `pg_dump` output to `gzip` on the host.
- **`--no-owner --no-acl`** keeps the dump portable across hosts. Restore creates the schema under whatever role psql is connected as.
- **`set -o pipefail`** makes a `pg_dump` failure surface even though `gzip` succeeds on partial input. Without it, a corrupt stream would silently produce a tiny gzipped file.
- **No retention sweep.** Cron-style rotation is operator policy; the script's job is "produce one good dump per invocation". Document the suggested `find ./backups -name '*.sql.gz' -mtime +30 -delete` in `[I6]`.
- **Encryption note in the header** — the dump preserves the at-rest ciphertext, which is unrecoverable without keys, but operators must still treat it as sensitive (it's everything an attacker would need for offline cracking attempts).
