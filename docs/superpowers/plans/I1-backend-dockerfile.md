# I1 — Backend multi-stage Dockerfile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-stage `backend/Dockerfile` whose `runner` stage runs `node dist/index.js` as a non-root user. Replace the `nginx:alpine` stub used in `docker-compose.yml`.

**Architecture:** Three stages — `deps` (npm ci with full deps for build), `builder` (`tsc` + `prisma generate`), `runner` (Alpine, non-root user, prod-only deps + `dist/` + `node_modules/.prisma` copied in). Entrypoint runs `prisma migrate deploy` then starts the server, so a fresh stack comes up clean without the operator running `make migrate` separately.

**Tech Stack:** `node:22-alpine`, `npm ci --omit=dev` for the runner, Prisma's pre-generated client.

**Prerequisites:** None — backend code, `tsc` build, and `prisma` schema are all shipped. `[I7]` is independent (env-swap concerns content of `.env.example`, not the Dockerfile).

**Out of scope:**
- `docker-compose.yml` swap from `nginx:alpine` to `build: ./backend` — that's `[I3]`.
- Hot-reload bind mounts — that's `[I4]`'s `docker-compose.override.yml`.
- Pushing the image to a registry.

---

### Task 1: Add `.dockerignore` to keep build context lean

**Files:**
- Create: `backend/.dockerignore`

- [ ] **Step 1: Write the ignore file**

```gitignore
node_modules
dist
.env
.env.*
!.env.example
tests
coverage
*.log
.git
.DS_Store
```

- [ ] **Step 2: Commit**

```bash
git add backend/.dockerignore
git commit -m "[I1] add backend .dockerignore"
```

---

### Task 2: Write the multi-stage Dockerfile

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/docker-entrypoint.sh`

- [ ] **Step 1: Write the entrypoint script**

```sh
#!/bin/sh
# backend/docker-entrypoint.sh
set -e

# Apply pending Prisma migrations before starting the app.
# Safe to run on every container boot: migrate deploy is idempotent.
echo "[entrypoint] running prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting backend"
exec node dist/index.js
```

- [ ] **Step 2: Make the entrypoint executable in git**

```bash
chmod +x backend/docker-entrypoint.sh
```

- [ ] **Step 3: Write the Dockerfile**

```dockerfile
# backend/Dockerfile

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runner --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for the app process.
RUN addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV PORT=4000

# Prod-only deps; the prisma client must be generated against these node_modules
# so we run `prisma generate` once more here against the schema.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Bring in the compiled output, the schema (for `prisma migrate deploy`), and
# the entrypoint.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && npx prisma generate \
    && chown -R app:app /app

USER app

EXPOSE 4000

# Healthcheck mirrors docker-compose.yml's HTTP probe so a misbehaving
# container is restarted under `restart: unless-stopped`.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
```

- [ ] **Step 4: Build the image to verify**

```bash
docker build -t story-editor-backend ./backend
```

Expected: build completes; `docker inspect story-editor-backend --format '{{.Config.User}}'` prints `app`.

- [ ] **Step 5: Confirm the verify command passes**

```bash
docker build -t story-editor-backend ./backend && docker inspect story-editor-backend | grep -q "User"
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/docker-entrypoint.sh
git commit -m "[I1] backend multi-stage Dockerfile + entrypoint"
```

---

### Task 3: Smoke-test the runtime

**Files:** none (manual sanity check, not part of `[I1]` verify).

- [ ] **Step 1: Boot the container against a transient Postgres**

```bash
docker network create inkwell-smoke-test
docker run --rm -d --name pg-smoke --network inkwell-smoke-test \
  -e POSTGRES_USER=storyeditor -e POSTGRES_PASSWORD=storyeditor -e POSTGRES_DB=storyeditor \
  postgres:16-alpine
sleep 5
docker run --rm -d --name be-smoke --network inkwell-smoke-test -p 4001:4000 \
  -e DATABASE_URL='postgresql://storyeditor:storyeditor@pg-smoke:5432/storyeditor' \
  -e JWT_SECRET=dev-jwt -e REFRESH_TOKEN_SECRET=dev-refresh \
  -e APP_ENCRYPTION_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))") \
  -e FRONTEND_URL=http://localhost:3000 \
  story-editor-backend
sleep 5
curl -sf http://localhost:4001/api/health
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 2: Tear down**

```bash
docker stop be-smoke pg-smoke
docker network rm inkwell-smoke-test
```

If the smoke test fails, fix `[I1]` before continuing — `[I3]` will inherit the failure.

---

### Task 4: Verify gate

- [ ] **Step 1: Run via `/task-verify I1`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I1] tick — backend multi-stage Dockerfile"
```

---

## Self-Review Notes

- **Migrations on boot.** `migrate deploy` is idempotent; running it on every container start avoids a separate `make migrate` step and matches the SELF_HOSTING.md "first run = `docker compose up`" flow.
- **Non-root user.** `app` is created with `-S` (system user, no shell, no password). Verify command's `grep "User"` match comes from the `Config.User` field in `docker inspect`.
- **Prisma client.** Generated twice (once in `builder` so `tsc` typechecks, once in `runner` against the prod-only `node_modules`). The runner copy is what gets executed; the builder copy is throwaway.
- **No `RUN apk add`** — Alpine's base node image already ships `wget` and `sh`, the only utilities the entrypoint and healthcheck need.
- **No build-time secrets.** `APP_ENCRYPTION_KEY`, `JWT_SECRET`, etc. are runtime env vars; the image is identical across operators.
