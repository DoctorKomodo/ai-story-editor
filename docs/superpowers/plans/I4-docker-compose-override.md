# I4 — `docker-compose.override.yml` for local dev

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `docker-compose.override.yml` that flips the stack into dev mode — bind-mount source for hot reload, run `ts-node-dev` (backend) and `vite` (frontend), set `NODE_ENV=development`, and skip the production migration-on-boot entrypoint so a developer's iteration loop is fast.

**Architecture:** Compose's automatic override picks up `docker-compose.override.yml` whenever the operator runs `docker compose up` *without* `-f`. We override `command` and `volumes` for `backend` and `frontend`, and override `target` to a dev stage (or just override `image`/`command` and skip the build target). To keep things simple and reuse `[I1]` / `[I2]`'s images, we override `command` and bind-mount source over `/app` — the dev tooling (`ts-node-dev`, `vite`) is added via a `dev` build target.

**Tech Stack:** Compose v2 override semantics, `ts-node-dev` (already in backend deps), `vite` dev server.

**Prerequisites:** `[I3]` (`docker-compose.yml` is the base file the override layers onto).

**Out of scope:**
- Automatic schema reset — developer runs `make reset-db` explicitly.
- Production-grade dev images (the dev images are intentionally fatter).

---

### Task 1: Add a `dev` stage to each Dockerfile

We need a target that includes dev deps so `ts-node-dev` and `vite` resolve.

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `frontend/Dockerfile`

- [ ] **Step 1: Append a `dev` stage to `backend/Dockerfile`**

Add at the end of the file:

```dockerfile
# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]
```

- [ ] **Step 2: Append a `dev` stage to `frontend/Dockerfile`**

```dockerfile
# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
# Vite needs --host so it binds 0.0.0.0 inside the container.
CMD ["npx", "vite", "--host", "--port", "3000"]
```

- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile
git commit -m "[I4] add dev build stage to backend + frontend Dockerfiles"
```

---

### Task 2: Write `docker-compose.override.yml`

**Files:**
- Create: `docker-compose.override.yml`

- [ ] **Step 1: Write it**

```yaml
services:
  backend:
    build:
      context: ./backend
      target: dev
    environment:
      NODE_ENV: development
    volumes:
      # Bind-mount the source for hot reload. node_modules is kept inside the
      # container so the host's (potentially different-arch) node_modules
      # doesn't shadow what was installed at build time.
      - ./backend:/app
      - /app/node_modules
    command: ["npm", "run", "dev"]

  frontend:
    build:
      context: ./frontend
      target: dev
    environment:
      NODE_ENV: development
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: ["npx", "vite", "--host", "--port", "3000"]
    # Vite's HMR talks back over the exposed port; nothing else changes.
```

- [ ] **Step 2: Validate the merged config**

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet && echo "OVERRIDE OK"
```

Expected: `OVERRIDE OK`. This is also the verify command verbatim.

- [ ] **Step 3: Smoke-test hot reload**

```bash
docker compose up -d
sleep 8
curl -sf http://localhost:4000/api/health | grep '"status":"ok"'
# Edit a backend file
date > /tmp/touch-marker
echo "// touched at $(cat /tmp/touch-marker)" >> backend/src/index.ts
sleep 4
docker compose logs backend --tail=20 | grep -qi "restart\|reload\|listen"
```

Expected: backend logs show ts-node-dev restart. If not, check the bind mount + the `dev` script in `backend/package.json`.

Revert the touch:

```bash
git checkout -- backend/src/index.ts
```

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.override.yml
git commit -m "[I4] dev override with hot-reload bind mounts"
```

---

### Task 3: Verify gate

- [ ] **Step 1: Run via `/task-verify I4`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I4] tick — local dev compose override"
```

---

## Self-Review Notes

- **`make dev` still works.** The Makefile already runs `docker compose up -d`, which auto-merges the override file. No Makefile change needed.
- **node_modules anonymous volume.** Hides the host's `node_modules` from the bind mount so platform-specific deps (esbuild native bin, prisma engines) stay matched to the container's libc.
- **No prod migration entrypoint in dev.** The dev stage runs `npm run dev` directly, skipping `docker-entrypoint.sh`. Developers run `make migrate` themselves; this is the established workflow.
- **`vite --host`** is required because Vite defaults to `localhost`-only bind, which would make port 3000 unreachable from outside the container.
- **No `[I7]` coupling.** The override is environment-agnostic; all secrets continue to come from the top-level `.env`.
