#!/bin/sh
# backend/docker-entrypoint.sh
set -e

# Apply pending Prisma migrations before starting the app.
# Safe to run on every container boot: migrate deploy is idempotent.
echo "[entrypoint] running prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting backend"
exec node dist/index.js
