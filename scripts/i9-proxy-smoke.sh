#!/usr/bin/env bash
# [I9] Frontend /api proxy smoke test.
#
# Asserts that requests to the frontend port (:3000) are reverse-proxied to
# the backend (:4000). Runs against whichever compose variant is up — Vite's
# dev proxy under the dev override, or nginx in the prod runner stage.
#
# Pre-req: `make dev` (or `docker compose up -d`) — both the frontend and
# backend services must be healthy.
#
# Exit codes: 0 on full pass, non-zero on any failure (logged with context).

set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
READY_TIMEOUT_SECS="${READY_TIMEOUT_SECS:-60}"

fail() {
  echo "[I9] FAIL: $*" >&2
  exit 1
}

ok() {
  echo "[I9] OK: $*"
}

# Wait for the frontend port to be reachable. Vite (dev override) and nginx
# (prod runner) both bind to :3000; this loop covers both, including the
# cold-start window after `docker compose up -d --build frontend`.
deadline=$(( $(date +%s) + READY_TIMEOUT_SECS ))
until curl -fsS "${FRONTEND_URL}/" -o /dev/null 2>/dev/null; do
  if [ "$(date +%s)" -gt "${deadline}" ]; then
    fail "Frontend did not become ready at ${FRONTEND_URL} within ${READY_TIMEOUT_SECS}s"
  fi
  sleep 1
done
ok "Frontend reachable at ${FRONTEND_URL}"

# 1) GET /api/health through the frontend proxy must hit the backend's
#    health probe (NOT nginx's SPA fallback, which would return index.html).
health_body="$(curl -fsS "${FRONTEND_URL}/api/health" || true)"
if ! echo "${health_body}" | grep -q '"status":"ok"'; then
  fail "GET ${FRONTEND_URL}/api/health did not return backend health JSON. Got: ${health_body}"
fi
ok "GET /api/health via frontend proxy returned backend payload"

# 2) POST /api/auth/register through the proxy. Use a salted username so
#    repeated runs don't collide with prior registrations.
salt="$(date +%s%N)"
username="i9probe${salt}"
status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "${FRONTEND_URL}/api/auth/register" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${FRONTEND_URL}" \
  --data "{\"name\":\"${username}\",\"username\":\"${username}\",\"password\":\"correct-horse-battery\"}")"
if [ "${status}" != "201" ]; then
  fail "POST ${FRONTEND_URL}/api/auth/register returned ${status} (expected 201)"
fi
ok "POST /api/auth/register via frontend proxy returned 201"

echo "[I9] proxy smoke passed"
