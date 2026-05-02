> Source of truth: `TASKS.md`. Closed [I]-series tasks archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## ☁️ I — DevOps & Infra

- [x] **[I1]** Multi-stage Dockerfile for backend: `builder` compiles TypeScript, `runner` runs as non-root user.
  - verify: `docker build -t story-editor-backend ./backend && docker inspect story-editor-backend | grep -q "User"`

- [x] **[I2]** Multi-stage Dockerfile for frontend: `builder` runs `npm run build`, `runner` serves dist on port 3000.
  - verify: `docker build -t story-editor-frontend ./frontend && docker run --rm -d -p 3001:3000 story-editor-frontend && sleep 3 && curl -sf http://localhost:3001 | grep -q "html" && docker stop $(docker ps -q --filter ancestor=story-editor-frontend)`

- [x] **[I3]** `docker-compose.yml` final: backend `depends_on` postgres with `condition: service_healthy`. `restart: unless-stopped` on all services. Postgres in named volume `pgdata`.
  - verify: `docker compose down -v && docker compose up -d && sleep 10 && curl -sf http://localhost:4000/api/health | grep '"status":"ok"'`

- [x] **[I4]** `docker-compose.override.yml` for local dev: hot reload mounts, all ports exposed, `NODE_ENV=development`.
  - verify: `docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet && echo "OVERRIDE OK"`

- [x] **[I5]** `scripts/backup-db.sh`: runs `pg_dump` inside the postgres container, saves timestamped `.sql.gz` to `./backups/`.
  - verify: `bash scripts/backup-db.sh && ls backups/*.sql.gz | head -1`

- [x] **[I6]** `SELF_HOSTING.md`: prerequisites, first-run steps, updating, backup/restore, port layout (frontend :3000, backend :4000), note that reverse proxy is expected upstream but not included.
  - verify: `test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "APP_ENCRYPTION_KEY" SELF_HOSTING.md`

- [x] **[I7]** BYOK env swap: remove `VENICE_API_KEY` from `.env.example` and supporting docs; add `APP_ENCRYPTION_KEY` (32-byte base64, documented with a generation one-liner in [I6]'s SELF_HOSTING.md). Backend startup fails fast with a clear message if `APP_ENCRYPTION_KEY` is missing or wrong length. Update [I6]'s `SELF_HOSTING.md` to reflect the BYOK model (each user enters their own key in Settings — operator does not need a Venice account).
  - verify: `grep -q "APP_ENCRYPTION_KEY" .env.example && ! grep -q "VENICE_API_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts`

- [x] **[I8]** Automated backup–restore drill: `scripts/backup-restore-drill.sh` exercises the full round trip — register a user, encrypt a chapter, dump the database, wipe + restore, log back in, and confirm the decrypted body matches the seeded sentinel. Re-uses the [I1] backend image and the existing dev postgres (isolated drill database, never touches the primary DB). Extends [I5]'s `backup-db.sh` with `--db` and `--out` flags. Operator-facing — also serves as the automated form of [E15]'s quarterly recovery drill.
  - verify: `bash scripts/backup-restore-drill.sh`

- [x] **[I9]** Same-origin `/api/` proxy on the frontend in both dev (Vite) and prod (nginx). Closes the gap from [I2]/[I3] where `frontend/nginx.conf` had no upstream rule and `frontend/vite.config.ts` had no dev proxy, so any UI request to `/api/...` (register, login, story CRUD, AI streaming) returned 404/500 against the live stack despite the backend being reachable on `:4000`. Same-origin keeps the refresh-cookie's `path=/api/auth` scope intact, avoids a CORS preflight on every request, and means `FRONTEND_URL` does not need to differ from the SPA host. Renames the dead `VITE_API_URL` build arg to `VITE_API_BASE_URL` so an operator-supplied override actually reaches `api.ts:resolveBaseUrl`. Default (empty) keeps origin-relative `/api`; setting it picks a different API host with the operator's CORS configuration.
  - verify: `docker compose up -d && bash scripts/i9-proxy-smoke.sh`

---
