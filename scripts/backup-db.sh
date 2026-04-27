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
