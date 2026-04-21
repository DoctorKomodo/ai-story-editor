#!/usr/bin/env bash
# Drops, recreates, and (if a Prisma schema is present) migrates the test database.
# Reads DATABASE_URL from .env.test at the project root.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.test"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

# Parse DATABASE_URL. Expected: postgresql://user:pass@host:port/dbname
url_no_scheme="${DATABASE_URL#postgresql://}"
url_no_scheme="${url_no_scheme#postgres://}"
creds_host="${url_no_scheme%%/*}"
DB_NAME="${url_no_scheme#*/}"
DB_NAME="${DB_NAME%%\?*}"
USER_PASS="${creds_host%@*}"
DB_USER="${USER_PASS%%:*}"

CONTAINER="${POSTGRES_CONTAINER:-story-editor-postgres-1}"

run_psql() {
  printf '%s\n' "$1" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1
}

echo "Resetting test database '$DB_NAME' as user '$DB_USER'..."
run_psql "DROP DATABASE IF EXISTS \"$DB_NAME\";"
run_psql "CREATE DATABASE \"$DB_NAME\";"

if [ -f "$ROOT_DIR/backend/prisma/schema.prisma" ]; then
  echo "Applying Prisma migrations..."
  (cd "$ROOT_DIR/backend" && DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy)
else
  echo "No Prisma schema found yet — skipping migrate (will run once [D1] is complete)."
fi

echo "Test database ready."
