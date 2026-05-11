#!/bin/sh
# backend/docker-entrypoint.sh
set -e

# Apply pending Prisma migrations before starting the app.
# Safe to run on every container boot: migrate deploy is idempotent.
# Use npx so it resolves prisma from the hoisted workspace root node_modules
# (/app/node_modules/prisma) rather than a fragile relative path from WORKDIR.
echo "[entrypoint] running prisma migrate deploy"
npx prisma migrate deploy

echo "[entrypoint] starting backend"
exec node dist/index.js
