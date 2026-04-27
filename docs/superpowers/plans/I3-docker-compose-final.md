# I3 — Final `docker-compose.yml`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `nginx:alpine` stubs in `docker-compose.yml` with `build:` directives pointing at the new `[I1]` / `[I2]` Dockerfiles, wire env-vars from a top-level `.env`, and confirm the stack boots cleanly with `/api/health` returning `{"status":"ok"}`.

**Architecture:** Three services — `postgres` (image, healthchecked), `backend` (built from `./backend`, depends on healthy postgres, env-file), `frontend` (built from `./frontend`). All `restart: unless-stopped`; `pgdata` named volume; published ports `3000` and `4000`. Postgres port `5432` stays published in `docker-compose.yml` (matches stub) so external tools can connect during dev — `[I4]` is where dev-only conveniences live, but exposing 5432 is harmless on a single-host self-host.

**Tech Stack:** Docker Compose v2 spec; Node + Postgres 16.

**Prerequisites:** `[I1]` and `[I2]` must be done so the `build:` references resolve. `[I7]` env-swap is independent — `docker-compose.yml` reads from `.env` regardless of which keys are in it.

**Out of scope:**
- Hot-reload mounts — `[I4]` (`docker-compose.override.yml`).
- The `.env.example` swap — `[I7]`.
- A bundled reverse proxy — explicitly out per CLAUDE.md ("the project has no built-in reverse proxy").

---

### Task 1: Rewrite `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Overwrite the file with the production compose**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-storyeditor}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-storyeditor}
      POSTGRES_DB: ${POSTGRES_DB:-storyeditor}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-storyeditor} -d ${POSTGRES_DB:-storyeditor}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: ./backend
    restart: unless-stopped
    ports:
      - "4000:4000"
    env_file:
      - .env
    environment:
      # Override the .env DB host so the backend container resolves postgres
      # via the compose network rather than localhost.
      DATABASE_URL: ${DATABASE_URL:-postgresql://storyeditor:storyeditor@postgres:5432/storyeditor}
      NODE_ENV: ${NODE_ENV:-production}
      PORT: "4000"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 6

  frontend:
    build:
      context: ./frontend
      args:
        # Operators self-hosting on a non-localhost host should set this in
        # their shell or `.env` before `docker compose build`.
        VITE_API_URL: ${VITE_API_URL:-http://localhost:4000}
    restart: unless-stopped
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/"]
      interval: 10s
      timeout: 5s
      retries: 6

volumes:
  pgdata:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "[I3] swap nginx stubs for backend/frontend builds + dependency order"
```

---

### Task 2: Sanity-check the compose schema

**Files:** none.

- [ ] **Step 1: Validate the compose file**

```bash
docker compose config --quiet && echo OK
```

Expected: `OK`. If `config` complains about missing `.env` keys, copy `.env.example` to `.env` first.

- [ ] **Step 2: Confirm `restart: unless-stopped` is on every service**

```bash
docker compose config | grep -c "restart: unless-stopped"
```

Expected: `3`.

---

### Task 3: Run the verify command

- [ ] **Step 1: Make sure `.env` exists with a valid `APP_ENCRYPTION_KEY`**

```bash
test -f .env || cp .env.example .env
grep -q '^APP_ENCRYPTION_KEY=' .env || \
  echo "APP_ENCRYPTION_KEY=$(node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\")" >> .env
```

(If you started from `.env.example`, replace placeholder values for `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `APP_ENCRYPTION_KEY` with real ones.)

- [ ] **Step 2: Run the verify command verbatim**

```bash
docker compose down -v && docker compose up -d && sleep 10 && \
  curl -sf http://localhost:4000/api/health | grep '"status":"ok"'
```

Expected: prints a JSON snippet containing `"status":"ok"`; exit 0.

- [ ] **Step 3: Tear down**

```bash
docker compose down
```

- [ ] **Step 4: Commit**

(Nothing to commit unless the verify run flagged a fix.)

---

### Task 4: Verify gate

- [ ] **Step 1: Run via `/task-verify I3`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I3] tick — production docker-compose.yml"
```

---

## Self-Review Notes

- **`DATABASE_URL` override.** The top-level `.env` typically points at `postgres:5432` (matches `.env.example`), but if an operator copies a host-network `.env` the override defaults still resolve to the compose service. The override is wrapped in `${DATABASE_URL:-...}` so an explicit value still wins.
- **`depends_on` chains.** Backend waits for postgres healthy; frontend waits for backend healthy. So `docker compose up -d` blocks until the backend's `/api/health` returns 200, which is what the verify command reads.
- **`pgdata` survives `docker compose down`.** It only goes away on `down -v`. The reset-db Makefile target already uses `down -v`.
- **No internal-only network.** Compose's default bridge network suffices; the existing `make logs` / `make migrate` workflows continue to work.
- **Frontend rebuild on API URL change.** Mentioned in `[I2]` self-review and in `[I6]`'s SELF_HOSTING entry — operators on non-localhost rebuild with `--build-arg VITE_API_URL=...`.
- **5432 stays exposed.** Removing it is a cosmetic change that breaks `make seed` and ad-hoc `psql` connections from the host. The host-side firewall is the operator's call.
