# Dev-container root-ownership fix + Docker setup cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dev containers from writing root-owned files into the host's bind-mounted workspace trees (so host-side tooling keeps working after `make dev`), and tidy the Docker setup while both Dockerfiles are open.

**Architecture:** The dev containers currently run as **root** (no `USER` directive). `/app/frontend/node_modules` (and `/app/backend/node_modules`, `/app/shared/node_modules`) sit *inside* the `./frontend` / `./backend` / `./shared` bind mounts — unlike `/app/node_modules`, which an anonymous volume already shields — so anything the container writes there lands on the host as `root:root`. The fix has two coordinated halves: **(1) install as `node`** — both Dockerfiles gain a `deps` stage that runs `npm ci` as the built-in non-root `node` user (uid 1000), so every `node_modules` tree the image produces is node-owned; `builder` and `dev` build `FROM deps`. **(2) shield the per-workspace trees** — `docker-compose.override.yml` gains anonymous volumes for `/app/frontend/node_modules`, `/app/backend/node_modules`, `/app/shared/node_modules`. Because the install now runs as `node`, those volumes initialise node-owned and the dev process (also `node`) can write its caches into them; nothing escapes to the host as root.

**Tech Stack:** Docker (multi-stage `node:24-alpine` images), Docker Compose (base + dev override), npm workspaces, Vite, ts-node-dev, Prisma.

**Spec / investigation:** Root cause was established via `superpowers:systematic-debugging` in the filing session — the frontend dev container runs as **root**, `/app/frontend/node_modules` is part of the `./frontend` bind mount, so Vite's writes land on the host as `root:root`. Confirmed with a probe: a container write as root → host sees `root(0)`; the same write as `node` → host sees `asg(1000)`. The backend has the same latent gap (it just doesn't trigger it today — ts-node-dev transpiles in memory rather than writing inside `node_modules`).

**bd:** `story-editor-lki`. Plan link applied via `bash scripts/bd-link-plan.sh story-editor-lki docs/superpowers/plans/2026-05-14-dev-container-permissions.md` *after user approval of this plan*.

**Branch:** stay on the current branch (`chore/claude-md-and-settings`) — per the user, the minor CLAUDE.md/settings changes already committed there are bundled with this work. Do **not** create a new branch.

---

## Scope

This started as the `story-editor-lki` permissions fix. While reviewing the four Docker files we found several frontend/backend inconsistencies that live in the *same files this fix already rewrites*; the user opted to fold them all in. The full touch-set:

1. **Permissions fix (the original `lki` scope)** — run the dev containers as `node`; add anonymous volumes for the per-workspace `node_modules` trees.
2. **Drop the corepack/npm-11 upgrade from `frontend/Dockerfile`** (both `builder` and `dev`). It exists only to force npm 11 onto `node:22-alpine`'s stock npm 10.9.7 — but once the base image is `node:24-alpine` (item 6), npm 11.x ships out of the box and there is nothing for corepack to do. (The comment justifying it — "npm 10.9.7 rejects this lockfile" — was *also* already stale: it predates the npm-workspaces lockfile regeneration, and the backend image, which never used corepack, builds fine on its stock npm.) corepack also actively fights this fix — its cache is per-user, so a `node`-user runtime re-downloads npm and defeats the pin.
3. **Add a `deps` stage to `frontend/Dockerfile`**; `builder` and `dev` build `FROM deps`. Matches the backend's existing structure and dedupes the install (today both frontend stages re-run `COPY manifests + npm ci` from scratch).
4. **Backend `runner`: use the built-in `node` user** instead of the hand-rolled `app` user (`addgroup`/`adduser`). `node:24-alpine` already ships `node` at uid 1000 — the same user the dev stage now uses — so prod and dev stop diverging for no reason.
5. **`docker-compose.override.yml`: bind-mount `./shared` into the frontend dev service** (so editing a shared Zod schema hot-reloads the frontend — it reads `shared/src` via a Vite alias, currently frozen at image-build time), and **drop the redundant `command:` keys** (they duplicate the Dockerfile dev-stage `CMD` verbatim).
6. **Bump the Docker base image from `node:22-alpine` to `node:24-alpine`.** The rest of the repo already standardized on Node 24 — `.nvmrc` is `24` and both CI workflows (`ci.yml`, `e2e.yml`) run `node-version: 24`. The Dockerfiles are the lone holdout. Node 22 ("Jod") is now **Maintenance LTS**; Node 24 ("Krypton") is the current **Active LTS**. The drift isn't just cosmetic: CI validates the test suite on Node 24 while the images build and ship on Node 22 — a different runtime than what's tested. Bump all three `FROM node:22-alpine` lines (frontend `deps`; backend `deps` and `runner`) to `node:24-alpine`. This also makes item 2 trivially correct — `node:24-alpine` ships npm 11.x natively.
7. **Pin the `nginx:alpine` base image** in the frontend `runner` stage to `nginx:1.31-alpine`. `nginx:alpine` is unpinned — it floats to the latest mainline nginx on every build, so the frontend prod image's nginx version is non-reproducible and unrecorded. It is also the lone unpinned base image (`node:24-alpine` and `postgres:16-alpine` are both pinned). `nginx:1.31-alpine` is the current mainline (1.31.0) — what `nginx:alpine` resolves to today — made explicit and reproducible, floating only on patch releases within 1.31. Low-risk: nginx serving a static bundle has no persistent state.
8. **Sync the docs + `make rebuild*` to the anon-volume model.** lki turns all three per-workspace `node_modules` trees into anonymous volumes, and `docker compose up` reuses anonymous volumes by default (confirmed against the Compose docs) — so `make rebuild*` (which delegates its `up` to `make dev`'s plain `docker compose up -d`) would stop picking up dependency changes: the rebuilt image's `node_modules` is shadowed by the stale anon volume. Fix the three `rebuild*` targets to pass `--renew-anon-volumes`, and bring the docs that describe this workflow in line — `README.md`'s dependency-rebuild paragraph, the `Makefile`'s `rebuild` comment, and two `CLAUDE.md` items: the now-resolved "Frontend tests may not run on the host" gotcha (it names `story-editor-lki` and is exactly the bug being fixed) and the "Backend container runs as a non-root user" rule (post-lki the frontend dev container and the backend prod runner are non-root too).

**Not in scope:** the frontend `runner` stage's *user model*. It is `nginx:alpine` — a different base image with no `node` user — it serves a static bundle, runs no Node, and has its own conventional non-root model (master root, workers as `nginx`). There is no `app`-vs-`node` redundancy to remove there; that asymmetry is inherent to the two prod services being different runtimes. The only change to that stage is the base-image pin (item 7).

A separate bd issue, **`story-editor-55k`**, tracks bumping `postgres:16-alpine` (two majors behind current stable) — deliberately *not* folded in here, because a Postgres major bump is a data-directory migration, not a tag swap.

**Note on the `Makefile`:** an earlier draft of this plan changed `make seed` to run `prisma generate` as `-u root`. That *specific* change is **dropped** — installing as `node` (item 1) makes the hoisted `/app/node_modules` node-owned too, so `prisma generate` works as the `node` user everywhere, *given the one-time `--renew-anon-volumes` rollout* (Task 4) that recreates the pre-existing root-owned `/app/node_modules` volume node-owned. A *different* `Makefile` change **is** in scope, though — the `rebuild*` targets (item 8 / Task 5) — because lki turns the per-workspace `node_modules` trees into anonymous volumes that `docker compose up` would otherwise reuse stale.

---

## Design: install as `node`, run as `node`

Running the dev process as `node` (uid 1000, the host user) is what makes bind-mount writes host-owned instead of root-owned. But an anonymous volume initialises its contents *from the image*, preserving the image's ownership — so for the per-workspace `node_modules` volumes to be writable by the `node` user, the image's `node_modules` must already be node-owned.

The clean way to get that is to **run `npm ci` as `node` in the first place**, rather than installing as root and then `chown -R`-ing afterwards (an expensive extra layer over a large tree). So the `deps` stage does:

```dockerfile
WORKDIR /app          # creates /app root-owned
RUN chown node:node /app
USER node             # everything below runs as node
COPY --chown=node:node <manifests> ./
RUN npm ci            # → every node_modules tree is node-owned
```

`COPY` always runs as root regardless of `USER`, so `--chown=node:node` is required on every `COPY` to keep ownership consistent. `npm ci` then runs as `node` and writes node-owned `node_modules` — root hoisted tree *and* every per-workspace tree.

The `deps` stage also runs `mkdir -p frontend/node_modules backend/node_modules shared/node_modules` (still as `node`). An anonymous volume initialises from the image dir it mounts over *only if that dir exists* — otherwise Docker creates the mountpoint root-owned and the EACCES bug survives. npm workspaces does create those per-workspace dirs today (often empty), but the `mkdir` makes "anon volume initialises node-owned" true **by construction**, not by incidental npm hoisting behaviour.

`builder` and `dev` build `FROM deps`, inheriting the node-owned install. `builder` runs `tsc` / `vite build` as `node`; `dev` runs the dev server as `node`. The backend `runner` (prod) keeps its existing root-install-then-`chown` shape — it has no bind mounts and no permissions problem; the only change there is `app` → the built-in `node` user.

---

## File structure

**Modified:**
- `frontend/Dockerfile` — new `deps` stage (install as `node`, no corepack); `builder` and `dev` build `FROM deps`; `runner` (nginx) base image pinned to `nginx:1.31-alpine` (Scope item 7).
- `backend/Dockerfile` — `deps` stage installs as `node`; `builder` and `dev` build `FROM deps`; `runner` switches the hand-rolled `app` user to the built-in `node` user.
- `docker-compose.override.yml` — anonymous volumes for the three per-workspace `node_modules` trees; `./shared` bind-mounted into the frontend service; redundant `command:` keys removed.
- `Makefile` — `rebuild*` targets pass `--renew-anon-volumes` (via a `COMPOSE_UP_FLAGS` variable on `dev`); the `rebuild` comment corrected (Task 5).
- `README.md` — dependency-rebuild paragraph corrected to the anon-volume model (Task 5).
- `CLAUDE.md` — drop the resolved "Frontend tests may not run on the host" gotcha; generalize the "Backend container runs as a non-root user" rule (Task 5).

**Verify line (applied to bd `--notes` at link-plan time):**

```
verify: make stop && make dev && timeout 150 bash -c 'until docker compose exec -T frontend true 2>/dev/null && docker compose exec -T backend true 2>/dev/null; do sleep 3; done' && docker compose exec -T frontend sh -c 'touch /app/frontend/.permcheck-lki' && test "$(stat -c %u frontend/.permcheck-lki)" = "$(id -u)" && rm -f frontend/.permcheck-lki && docker compose exec -T frontend sh -c 'touch /app/frontend/node_modules/.permcheck-lki && rm /app/frontend/node_modules/.permcheck-lki' && docker compose exec -T backend sh -c 'touch /app/backend/.permcheck-lki' && test "$(stat -c %u backend/.permcheck-lki)" = "$(id -u)" && rm -f backend/.permcheck-lki && docker compose exec -T backend sh -c 'touch /app/backend/node_modules/.permcheck-lki && rm /app/backend/node_modules/.permcheck-lki' && make stop
```

Per dev service it probes **both** halves of the fix: (1) a write into the bind-mount root lands host-owned (`test … = "$(id -u)"`) — the container runs as the host uid; and (2) a write into the per-workspace `node_modules` *anonymous volume* succeeds — the volume initialised node-owned and is writable by the runtime `node` user, which is the load-bearing mechanism. It bounces the whole stack and leaves it **stopped** (same shape as the original `lki` verify line). It rebuilds nothing — run the rollout in Task 4 first so the verify exercises the new images.

---

## Task 1 — `frontend/Dockerfile`: `deps` stage, install as `node`, drop corepack

Restructure into `deps` → `builder` → `dev` → `runner`. `deps` installs as the `node` user; `builder` and `dev` build `FROM deps`. The corepack/npm-11 upgrade is removed entirely — `node:24-alpine` ships npm 11.x natively (see Scope items 2 and 6). The `runner` (nginx) stage changes only its base-image pin (Scope item 7).

**Files:**
- Modify: `frontend/Dockerfile` (whole file)

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `frontend/Dockerfile` with:

```dockerfile
# frontend/Dockerfile
# Built with repo root as context per the workspaces adoption. See
# docker-compose.yml's frontend.build.{context,dockerfile}.

# ---- deps ----------------------------------------------------------------
# Shared install layer for `builder` and `dev`. Runs as the non-root `node`
# user (uid 1000, ships with node:24-alpine) so every node_modules tree it
# produces — the root hoisted tree and each per-workspace tree — is
# node-owned. `dev` inherits this and runs the dev server as `node`, so files
# it writes through the bind mount land owned by the host user, not root.
FROM node:24-alpine AS deps
WORKDIR /app
# WORKDIR creates /app root-owned; hand it to `node` before installing so
# `npm ci` (run as `node` below) can create node_modules under it.
RUN chown node:node /app
USER node
# Workspace-aware install: copy every workspace manifest and the single root
# lockfile, then npm ci installs all workspaces. node:24-alpine ships npm 11.x
# out of the box, so no corepack upgrade is needed here. COPY runs as root
# regardless of USER, so --chown is required to keep ownership node-owned.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/
COPY --chown=node:node shared/package.json ./shared/
RUN npm ci
# Guarantee the per-workspace node_modules dirs exist and are node-owned. The
# anonymous volumes in docker-compose.override.yml initialise from these dirs,
# preserving their ownership — but only if they exist in the image. npm
# workspaces does create them (often empty) today; this `mkdir` (run as `node`)
# makes that true by construction rather than by incidental npm behaviour.
RUN mkdir -p frontend/node_modules backend/node_modules shared/node_modules

# ---- builder -------------------------------------------------------------
FROM deps AS builder
# Frontend reads shared via Vite alias to shared/src — no shared build step
# needed here. (Backend builds shared in its own Dockerfile.)
COPY --chown=node:node . .

# VITE_* vars are inlined into the bundle at build time.
#
# Default: unset, which means api.ts falls back to its origin-relative
# `/api` base. The runner stage's nginx config then reverse-proxies
# `/api/*` to the backend service inside the compose network — that's the
# stock self-hosting topology and avoids CORS entirely.
#
# Operators who terminate on a different origin (e.g. a separate api.example.com)
# override this at build time so the SPA bundle calls that host directly:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api .
# In that case the operator must also configure CORS on the backend
# (FRONTEND_URL) and accept the cross-origin cookie scoping consequences.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm -w story-editor-frontend run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
# Placed before `runner` so a default `docker build` (no --target) lands on
# the runner stage. Compose's override selects this stage explicitly via
# `target: dev`.
FROM deps AS dev
ENV NODE_ENV=development
# Inherits the `node` user from `deps`. The dev server therefore runs as
# uid 1000; anything it writes into the bind-mounted ./frontend — chiefly
# Vite's node_modules/.vite cache — is owned by the host user, not root.
# frontend/node_modules is also shielded by an anonymous volume in
# docker-compose.override.yml; that volume initialises from this image's
# (node-owned) frontend/node_modules.
COPY --chown=node:node . .
EXPOSE 3000
# Run via npm workspace so npm sets CWD to frontend/ where vite.config.ts lives.
# The config already sets host:true and port:3000, so no extra CLI flags needed.
CMD ["npm", "-w", "story-editor-frontend", "run", "dev"]

# ---- runner --------------------------------------------------------------
# Pinned to the current nginx mainline (1.31) — `nginx:alpine` is unpinned and
# floats to the latest mainline on every build. Floats only on patch releases
# within 1.31; bump the minor deliberately.
FROM nginx:1.31-alpine AS runner
WORKDIR /usr/share/nginx/html

# Replace the default config with our SPA-fallback variant.
RUN rm /etc/nginx/conf.d/default.conf
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle — Vite outputs to frontend/dist relative to the repo root
# when built from the workspace root context.
COPY --from=builder /app/frontend/dist .

# nginx listens on 80 by default, but our config binds 3000.
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:3000/ | grep -q '<html' || exit 1
```

- [ ] **Step 2: Verify the prod image builds (`runner` target)**

Run: `docker compose -f docker-compose.yml build frontend`
Expected: builds cleanly through `deps` → `builder` → `runner` (the `runner` stage pulls the pinned `nginx:1.31-alpine` base — confirming Scope item 7). Passing **only** `-f docker-compose.yml` excludes `docker-compose.override.yml`, so no `target:` override applies and the Dockerfile's last stage (`runner`) is built — a bare `docker compose build frontend` would auto-merge the override and build `dev` instead. The key signal is that `RUN npm ci` in `deps` **succeeds on `node:24-alpine`'s stock npm 11.x** with no corepack — confirming Scope items 2 and 6. No "Corepack is about to download" lines anywhere.

- [ ] **Step 3: Verify the dev image builds (`dev` target)**

Run: `docker compose -f docker-compose.yml -f docker-compose.override.yml build frontend`
Expected: builds through `deps` → `dev`. Including `docker-compose.override.yml` applies its `target: dev`, so the `dev` stage is built instead of `runner`. Clean build.

- [ ] **Step 4: Verify the dev container runs as `node` and npm works**

Run: `docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm --no-deps frontend sh -c 'id -u && npm --version'`
Expected: prints `1000` (the `node` user) then an npm `11.x` version (whatever `node:24-alpine` ships), exit 0, no download lines.

- [ ] **Step 5: Commit**

```bash
git add frontend/Dockerfile
git commit -m "[lki] frontend Dockerfile: deps stage, install + run as node, drop stale corepack

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — `backend/Dockerfile`: install as `node`, `deps`-based `builder`/`dev`, `node` user in `runner`

The backend already has a `deps` stage; restructure it to install as `node`, make `builder` and `dev` build `FROM deps`, and switch the `runner` from the hand-rolled `app` user to the built-in `node` user. `npm ci`, the `shared` build, and `prisma generate` all run as `node` now — fine, because `deps` made `/app` and `node_modules` node-owned.

**Files:**
- Modify: `backend/Dockerfile` (whole file)

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `backend/Dockerfile` with:

```dockerfile
# backend/Dockerfile
# Built with repo root as context per the workspaces adoption. See
# docker-compose.yml's backend.build.{context,dockerfile}.

ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma

# ---- deps ----------------------------------------------------------------
# Shared install layer for `builder` and `dev`. Runs as the non-root `node`
# user (uid 1000, ships with node:24-alpine) so every node_modules tree it
# produces — the root hoisted tree and each per-workspace tree — is
# node-owned. `dev` inherits this and runs the dev server as `node`, so files
# it writes through the bind mount land owned by the host user, not root.
FROM node:24-alpine AS deps
WORKDIR /app
# WORKDIR creates /app root-owned; hand it to `node` before installing so
# `npm ci` (run as `node` below) can create node_modules under it.
RUN chown node:node /app
USER node
# Workspace-aware install: copy every workspace manifest and the single root
# lockfile, then npm ci installs all workspaces. COPY runs as root regardless
# of USER, so --chown is required to keep ownership node-owned.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/
COPY --chown=node:node shared/package.json ./shared/
RUN npm ci
# Guarantee the per-workspace node_modules dirs exist and are node-owned. The
# anonymous volumes in docker-compose.override.yml initialise from these dirs,
# preserving their ownership — but only if they exist in the image. npm
# workspaces does create them (often empty) today; this `mkdir` (run as `node`)
# makes that true by construction rather than by incidental npm behaviour.
RUN mkdir -p frontend/node_modules backend/node_modules shared/node_modules

# ---- builder -------------------------------------------------------------
FROM deps AS builder
ARG PRISMA_GENERATE_DATABASE_URL
COPY --chown=node:node . .
# Shared must be built before backend tsc — backend's compiled CJS will
# `require('story-editor-shared')` which resolves to shared/dist.
RUN npm -w story-editor-shared run build
ENV DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL}
RUN npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM deps AS dev
ARG PRISMA_GENERATE_DATABASE_URL
ENV NODE_ENV=development
COPY --chown=node:node . .
RUN npm -w story-editor-shared run build
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
# Inherits the `node` user from `deps`. The dev server runs as uid 1000;
# anything it writes into the bind-mounted ./backend and ./shared is owned by
# the host user, not root. backend/node_modules and shared/node_modules are
# also shielded by anonymous volumes in docker-compose.override.yml; those
# volumes initialise from this image's (node-owned) per-workspace dirs.
EXPOSE 4000
CMD ["npm", "-w", "story-editor-backend", "run", "dev"]

# ---- runner --------------------------------------------------------------
FROM node:24-alpine AS runner
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
# Use the built-in `node` user (uid 1000) — node:24-alpine already ships it,
# so there is no need to hand-roll an `app` user, and it matches the deps/dev
# stages and the dev container's runtime user. The install + generate steps
# below run as root (as before); the final `chown` + `USER node` drop
# privileges for the running process.

ENV NODE_ENV=production
ENV PORT=4000

# Prod deps only.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci --omit=dev --ignore-scripts -w story-editor-backend -w story-editor-shared --include-workspace-root

# Bring in the compiled output for backend AND shared. Backend's runtime
# does `require('story-editor-shared')` → resolves via workspace symlink in
# node_modules/ → shared/dist/index.js.
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/shared/dist ./shared/dist
COPY backend/prisma.config.ts ./backend/prisma.config.ts
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate \
    && chown -R node:node /app

USER node
WORKDIR /app/backend

EXPOSE 4000

# Healthcheck mirrors docker-compose.yml's HTTP probe so a misbehaving
# container is restarted under `restart: unless-stopped`.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
```

- [ ] **Step 2: Verify the prod image builds (`runner` target)**

Run: `docker compose -f docker-compose.yml build backend`
Expected: builds cleanly through `deps` → `builder` → `runner`. Passing **only** `-f docker-compose.yml` excludes the override, so the Dockerfile's last stage (`runner`) is built — a bare `docker compose build backend` would auto-merge the override and build `dev` instead. `npm ci`, the `shared` build, and `prisma generate` in `deps`/`builder` run as `node`; the `runner` install + generate run as root then `chown -R node:node /app` + `USER node`.

- [ ] **Step 3: Verify the dev image builds**

Run: `docker compose -f docker-compose.yml -f docker-compose.override.yml build backend`
Expected: builds through `deps` → `dev`. Clean build; `prisma generate` in the `dev` stage succeeds as the `node` user (it writes the now node-owned `/app/node_modules/.prisma`).

- [ ] **Step 4: Verify the dev container runs as `node` and npm works**

Run: `docker compose -f docker-compose.yml -f docker-compose.override.yml run --rm --no-deps backend sh -c 'id -u && npm --version'`
Expected: prints `1000` (the `node` user) then an npm `11.x` version (whatever `node:24-alpine` ships), exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile
git commit -m "[lki] backend Dockerfile: install + run dev as node, node user in runner

deps installs as the non-root node user so every node_modules tree is
node-owned; builder/dev build FROM deps. The prod runner swaps the
hand-rolled app user for the built-in node user (uid 1000), matching
the deps/dev stages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — `docker-compose.override.yml`: shield per-workspace node_modules + frontend `./shared` mount

Add an anonymous volume for each per-workspace `node_modules` the dev services bind-mount through — the same "node_modules trick" the file already applies to `/app/node_modules`, extended to the per-workspace trees the npm-workspaces layout introduced. Also bind-mount `./shared` into the frontend service (so shared-schema edits hot-reload the frontend) and drop the redundant `command:` keys (they duplicate the Dockerfile dev-stage `CMD`).

**Files:**
- Modify: `docker-compose.override.yml` (whole file)

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `docker-compose.override.yml` with:

```yaml
services:
  backend:
    # Distinct tag so the dev image and the prod runner don't share a name
    # — see docker-compose.yml's `inkwell-backend:prod` for the prod tag.
    image: inkwell-backend:dev
    build:
      context: .
      dockerfile: backend/Dockerfile
      target: dev
    # Make the host reachable by name from inside the container so the [T8]
    # E2E spec can stand up an in-process mock Venice server on the host and
    # have the backend's per-user BYOK client (createVeniceClient → baseURL)
    # reach it. Linux Docker doesn't synthesise host.docker.internal on its
    # own — `host-gateway` is the documented opt-in.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      NODE_ENV: development
    volumes:
      # Bind-mount the source for hot reload. ./shared is mounted so the
      # host-side shared watcher's shared/dist/ rebuilds reach the container.
      - ./backend:/app/backend
      - ./shared:/app/shared
      # Anonymous volumes shield every node_modules tree from the bind mounts
      # above — the root hoisted tree plus each per-workspace tree. Without
      # the per-workspace ones, the dev process writes node_modules churn
      # into the host's ./backend and ./shared trees. The dev image installs
      # as the `node` user, so these volumes initialise node-owned.
      - /app/node_modules
      - /app/backend/node_modules
      - /app/shared/node_modules
    # Start command comes from the Dockerfile dev-stage CMD — no override needed.

  frontend:
    image: inkwell-frontend:dev
    build:
      context: .
      dockerfile: frontend/Dockerfile
      target: dev
    environment:
      NODE_ENV: development
      # Vite's dev /api proxy target. Resolves to the backend service inside
      # the compose network so same-origin /api calls from the browser are
      # forwarded to backend:4000 without CORS.
      VITE_DEV_PROXY_TARGET: http://backend:4000
    volumes:
      # Bind-mount the source for hot reload. ./shared is mounted too so that
      # editing a shared Zod schema hot-reloads the frontend — it reads
      # shared/src directly via a Vite alias.
      - ./frontend:/app/frontend
      - ./shared:/app/shared
      # Anonymous volumes shield every node_modules tree (root hoisted + each
      # per-workspace tree) from the bind mounts above — chiefly Vite's
      # node_modules/.vite + .vite-temp churn.
      - /app/node_modules
      - /app/frontend/node_modules
      - /app/shared/node_modules
    # Start command comes from the Dockerfile dev-stage CMD — no override needed.
    # Vite's HMR talks back over the exposed port; nothing else changes.
```

- [ ] **Step 2: Verify the merged compose config parses**

Run: `docker compose config >/dev/null && echo OK`
Expected: prints `OK`. `docker compose config` merges `docker-compose.yml` + `docker-compose.override.yml` and validates the result.

- [ ] **Step 3: Confirm the new volumes + mounts are present in the merged config**

Run:
```bash
docker compose config | sed -n '/^  backend:/,/^  [a-z]/p' | grep -E 'node_modules|/app/shared'
docker compose config | sed -n '/^  frontend:/,/^volumes:/p' | grep -E 'node_modules|/app/shared'
```
Expected: `backend` shows `/app/node_modules`, `/app/backend/node_modules`, `/app/shared/node_modules`, and the `./shared:/app/shared` bind mount. `frontend` shows `/app/node_modules`, `/app/frontend/node_modules`, `/app/shared/node_modules`, and the `./shared:/app/shared` bind mount.

- [ ] **Step 4: Confirm the `command:` keys are gone**

Run: `grep -n 'command:' docker-compose.override.yml || echo "no command keys — OK"`
Expected: prints `no command keys — OK`. The start commands now come from the Dockerfile dev-stage `CMD`s.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.override.yml
git commit -m "[lki] dev override: anon volumes for per-workspace node_modules, shared/ into frontend

Adds anonymous volumes for /app/{frontend,backend,shared}/node_modules so
the dev containers' node_modules churn never lands on the host bind-mount
trees. Bind-mounts ./shared into the frontend so shared-schema edits
hot-reload it. Drops the redundant command: keys (duplicated the
Dockerfile dev-stage CMD).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Rebuild, integration-verify, update the bd verify line

Rebuild both dev images, bring the stack up on them with `--renew-anon-volumes`, and prove the bug is fixed end-to-end.

**Why `--renew-anon-volumes`:** the pre-existing `/app/node_modules` anonymous volume was created from an *old, root-installed* image, so it is root-owned on the host's Docker volume store. Reusing it would leave the hoisted `node_modules` root-owned even though the new image's is node-owned — and `make seed`'s `prisma generate` (which runs as the container's default `node` user and writes `/app/node_modules/.prisma`) would fail against it. `--renew-anon-volumes` recreates **all** anonymous volumes (the stale `/app/node_modules` and the new per-workspace ones) fresh from the new images, initialising them node-owned. It does **not** touch the named `pgdata` volume — that is only removed by `down -v`, which this rollout never runs. This is a one-time *manual* step; `make dev` thereafter reuses the now-correct volumes, and Task 5 makes `make rebuild*` recreate them on every dependency rebuild so they never go stale again.

**Files:**
- No source files — this task rebuilds and verifies. The bd `verify:` line is updated via `bd update` (Step 7).

- [ ] **Step 1: Stop the stack and rebuild both dev images**

Run: `make stop && docker compose build`
Expected: `make stop` brings the stack down and kills the shared watcher; `docker compose build` (with `docker-compose.override.yml` auto-merged, so the `dev` target is built for both services) rebuilds `inkwell-backend:dev` and `inkwell-frontend:dev` on the new Dockerfiles.

- [ ] **Step 2: Bring the stack up, recreating anonymous volumes**

Run: `docker compose up -d --renew-anon-volumes`
Expected: all three services (`postgres`, `backend`, `frontend`) start. The `/app/node_modules`, `/app/frontend/node_modules`, `/app/backend/node_modules`, `/app/shared/node_modules` anonymous volumes are recreated fresh (node-owned) from the rebuilt images. `pgdata` is untouched.

- [ ] **Step 3: Wait for both dev containers to be running**

Run:
```bash
timeout 150 bash -c 'until docker compose exec -T frontend true 2>/dev/null && docker compose exec -T backend true 2>/dev/null; do sleep 3; done' && echo "both up"
```
Expected: prints `both up` within the timeout. (The frontend `depends_on` the backend being healthy, which depends on postgres — first boot of the chain can take a minute.)

- [ ] **Step 4: Confirm both dev containers run as the host uid**

Run:
```bash
echo "host:   $(id -u)"
echo "front:  $(docker compose exec -T frontend id -u | tr -d '\r')"
echo "back:   $(docker compose exec -T backend id -u | tr -d '\r')"
```
Expected: all three print the same uid (`1000` on this host — the `node` user). Before this fix, the containers printed `0`.

- [ ] **Step 5: Confirm writes land correctly — bind-mount root host-owned, node_modules anon volume node-writable**

Run:
```bash
# (a) bind-mount root: a container write lands host-owned, not root
docker compose exec -T frontend sh -c 'touch /app/frontend/.permcheck-lki'
docker compose exec -T backend  sh -c 'touch /app/backend/.permcheck-lki'
stat -c '%U(%u)  %n' frontend/.permcheck-lki backend/.permcheck-lki
docker compose exec -T frontend rm -f /app/frontend/.permcheck-lki
docker compose exec -T backend  rm -f /app/backend/.permcheck-lki
# (b) per-workspace node_modules anon volume: the runtime node user can write it
docker compose exec -T frontend sh -c 'touch /app/frontend/node_modules/.permcheck-lki && rm /app/frontend/node_modules/.permcheck-lki' && echo "frontend node_modules: writable"
docker compose exec -T backend  sh -c 'touch /app/backend/node_modules/.permcheck-lki && rm /app/backend/node_modules/.permcheck-lki' && echo "backend node_modules: writable"
```
Expected: (a) both probe files show the host user (`asg(1000)` on this host), **not** `root(0)` — the container runs as the host uid. (b) both `node_modules` probes exit 0 and print the "writable" line — the anonymous volumes initialised node-owned (the load-bearing half of the fix: an anon volume preserves its image dir's ownership, and `deps` both installed and `mkdir`'d those dirs as `node`). A root-owned anon volume would fail (b) with `Permission denied`.

- [ ] **Step 6: Confirm the app works and `prisma generate` runs as `node`**

Run:
```bash
curl -sf http://localhost:4000/api/health && echo " <- backend OK"
curl -sf http://localhost:3000/ | grep -q '<' && echo "frontend serving OK"
docker compose exec -T backend npx -w story-editor-backend prisma generate >/dev/null && echo "prisma generate (as node) OK"
```
Expected: backend health endpoint returns 2xx; the frontend dev server serves HTML; `prisma generate` exits 0 as the container's default `node` user — proving the dropped Makefile change is genuinely unnecessary (it writes the now node-owned `/app/node_modules/.prisma`).

- [ ] **Step 7: Update the bd verify line**

Run:
```bash
bd update story-editor-lki --notes "$(printf 'plan: docs/superpowers/plans/2026-05-14-dev-container-permissions.md\nverify: make stop && make dev && timeout 150 bash -c '\''until docker compose exec -T frontend true 2>/dev/null && docker compose exec -T backend true 2>/dev/null; do sleep 3; done'\'' && docker compose exec -T frontend sh -c '\''touch /app/frontend/.permcheck-lki'\'' && test "$(stat -c %%u frontend/.permcheck-lki)" = "$(id -u)" && rm -f frontend/.permcheck-lki && docker compose exec -T frontend sh -c '\''touch /app/frontend/node_modules/.permcheck-lki && rm /app/frontend/node_modules/.permcheck-lki'\'' && docker compose exec -T backend sh -c '\''touch /app/backend/.permcheck-lki'\'' && test "$(stat -c %%u backend/.permcheck-lki)" = "$(id -u)" && rm -f backend/.permcheck-lki && docker compose exec -T backend sh -c '\''touch /app/backend/node_modules/.permcheck-lki && rm /app/backend/node_modules/.permcheck-lki'\'' && make stop')"
```
Expected: `bd` confirms the issue was updated. The new line probes two things per dev service: (1) a write into the bind-mount root lands host-owned (proves the container runs as the host uid), and (2) a write into the per-workspace `node_modules` *anonymous volume* succeeds (proves the volume initialised node-owned and is writable by the runtime `node` user — the load-bearing half of the fix). The original `lki` line checked `node_modules` ownership *on the host*, which the anon volume deliberately makes unobservable — the whole point is that those writes no longer reach the host — so the in-container writability check is the right way to keep the actual subject of the bug under test. `scripts/bd-link-plan.sh` will have already added the `plan:` line; this command rewrites the notes with both `plan:` and the new `verify:` together.

- [ ] **Step 8: Restart the stack for normal use**

Run: `make stop && make dev`
Expected: `make dev` brings the stack up (reusing the now node-owned anonymous volumes — no `--renew-anon-volumes` needed again) and starts the shared watcher. Confirm with `docker compose ps` that `frontend`, `backend`, and `postgres` are all up.

- [ ] **Step 9: Commit (no-op guard)**

This task changes no tracked source files (the bd notes update lands in `.beads/issues.jsonl` via bd's auto-export). Stage and commit only if `git status --short` shows `.beads/issues.jsonl` changed:

```bash
git add .beads/issues.jsonl 2>/dev/null
git diff --cached --quiet || git commit -m "[lki] update verify line for the permissions fix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — Sync the docs + `make rebuild*` to the anon-volume model

lki turns all three per-workspace `node_modules` trees into anonymous volumes. `docker compose up` **reuses** anonymous volumes by default — so the `make rebuild*` targets, which delegate their `up` to `make dev`'s plain `docker compose up -d`, would no longer pick up a dependency change: the rebuilt image's `node_modules` is shadowed by the stale anon volume. This task makes `make rebuild*` pass `--renew-anon-volumes`, and brings the docs that describe this workflow — plus the now-resolved `story-editor-lki` gotcha and the understated non-root rule — in line.

**Files:**
- Modify: `Makefile` (the `dev` target + the three `rebuild*` targets + the `rebuild` comment)
- Modify: `README.md` (the dependency-rebuild paragraph)
- Modify: `CLAUDE.md` (drop the resolved gotcha; generalize the non-root rule)

- [ ] **Step 1: Thread a `COMPOSE_UP_FLAGS` variable through the `dev` target**

In `Makefile`, replace the `dev` target — currently:

```makefile
dev: shared-build
	@( npx -w story-editor-shared tsc -p tsconfig.build.json --watch & BGPID=$$!; ps -o pgid= -p $$BGPID > .watcher.pid ) ; \
	 echo "shared watcher running in background; backend container will pick up shared/dist changes via bind-mount"
	docker compose up -d
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"
```

with:

```makefile
# Extra flags for `docker compose up` in the `dev` target. Empty for a plain
# `make dev`; the `rebuild*` targets set it to --renew-anon-volumes so a freshly
# built image's node_modules replace the (otherwise reused) anonymous volumes.
COMPOSE_UP_FLAGS ?=

dev: shared-build
	@( npx -w story-editor-shared tsc -p tsconfig.build.json --watch & BGPID=$$!; ps -o pgid= -p $$BGPID > .watcher.pid ) ; \
	 echo "shared watcher running in background; backend container will pick up shared/dist changes via bind-mount"
	docker compose up -d $(COMPOSE_UP_FLAGS)
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"
```

- [ ] **Step 2: Pass `--renew-anon-volumes` from the `rebuild*` targets, and fix the comment**

Still in `Makefile`, replace the `rebuild` comment + the three `rebuild*` targets — currently:

```makefile
# Rebuild a service image after a dependency change (e.g. new npm package),
# then bring the stack back up. Use this whenever package.json changes —
# the dev compose mounts source via bind-mount but keeps node_modules
# inside the image (anonymous volume), so a fresh `npm install` only takes
# effect after the image is rebuilt.
rebuild: stop
	docker compose build
	$(MAKE) dev

rebuild-frontend: stop
	docker compose build frontend
	$(MAKE) dev

rebuild-backend: stop
	docker compose build backend
	$(MAKE) dev
```

with:

```makefile
# Rebuild a service image after a dependency change (e.g. new npm package),
# then bring the stack back up. Use this whenever package.json changes —
# the dev compose bind-mounts source but keeps every node_modules tree in
# anonymous volumes. `docker compose up` reuses those volumes by default, so
# rebuilding alone is not enough: these targets pass --renew-anon-volumes (via
# COMPOSE_UP_FLAGS) so the freshly installed node_modules actually propagate.
rebuild: stop
	docker compose build
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes

rebuild-frontend: stop
	docker compose build frontend
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes

rebuild-backend: stop
	docker compose build backend
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes
```

- [ ] **Step 3: Verify the Makefile expands correctly**

Run: `make -n rebuild-frontend`
Expected: prints the recipe without executing it. The output includes `docker compose build frontend` and — from the recursive `$(MAKE) dev` invocation — `docker compose up -d --renew-anon-volumes`. No `make` syntax errors. (Cross-check `make -n dev` still shows a bare `docker compose up -d` with no flags.)

- [ ] **Step 4: Correct the README dependency-rebuild paragraph**

In `README.md`, replace:

```
After adding or upgrading an npm dependency, run `make rebuild-frontend` (or `make rebuild-backend`). The dev compose mounts source via bind-mount but keeps `node_modules` inside the container image, so a host-side `npm install` doesn't reach the running stack until the image is rebuilt.
```

with:

```
After adding or upgrading an npm dependency, run `make rebuild-frontend` (or `make rebuild-backend`). The dev compose bind-mounts source but keeps every `node_modules` tree in anonymous volumes, so a host-side `npm install` doesn't reach the running stack — `make rebuild*` rebuilds the image *and* recreates those volumes (`--renew-anon-volumes`) so the fresh install propagates.
```

- [ ] **Step 5: Update CLAUDE.md — drop the resolved gotcha, generalize the non-root rule**

In `CLAUDE.md`, **delete** this "Known Gotchas" bullet entirely — the dev containers now run as the host uid and `frontend/node_modules` is an anonymous volume, so Docker no longer writes root-owned files into the host tree; this is resolved by `story-editor-lki` itself:

```
- **Frontend tests may not run on the host.** Docker can leave `frontend/node_modules` root-owned, so host-side `npm -w story-editor-frontend test` (and `make test`'s frontend leg) fails EACCES on Vite's temp dir. Run them in the container (`docker compose exec -T frontend npm -w story-editor-frontend run test`) or `sudo chown -R $USER frontend/node_modules`. Tracked as `story-editor-lki`.
```

And in the "Docker & Infrastructure Rules" section, replace:

```
- Backend container runs as a non-root user
```

with:

```
- Containers run as a non-root user — dev containers and the backend prod runner all run as the built-in `node` user (uid 1000); the frontend prod image is `nginx:alpine`, which has its own conventional non-root worker model
```

- [ ] **Step 6: Commit**

```bash
git add Makefile README.md CLAUDE.md
git commit -m "[lki] sync docs + make rebuild* to the anon-volume model

make rebuild* now passes --renew-anon-volumes so a rebuilt image's
node_modules actually propagate (docker compose up reuses anon volumes
by default). README + the Makefile comment are corrected to match.
CLAUDE.md drops the now-resolved 'frontend tests may not run on the
host' gotcha and generalizes the non-root-user rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Trim the stale aside from the `when-migrating-an-entity-onto-shared-zod-schemas` bd memory**

That memory ends with an aside — "this host's frontend/node_modules can become root-owned by Docker, blocking host-side Vite/vitest" — that `story-editor-lki` resolves. Rewrite it without that sentence (keep the rest verbatim):

```bash
bd remember --key when-migrating-an-entity-onto-shared-zod-schemas "When migrating an entity onto shared Zod schemas with runtime .parse() validation in the frontend hook (the Story/Character/Message consolidation pattern), the plan's consumer analysis MUST check that test fetch-mock *fixtures* satisfy the strict schemas — not just that there are no hand-rolled *type* references. In story-editor-d7e, StoryModal.test.tsx's POST/PATCH mock 'story' objects carried chapterCount/totalWordCount keys that the strict storySchema rejects at runtime; TS never caught it because the mocks were untyped 'unknown'. Also: error-path component tests must allow for createQueryClient's 1-retry (~1000ms backoff) policy — use findByRole('alert', {}, { timeout: 3000 })."
```

Then commit the bd export only if it changed (`bd remember` writes to bd's store, which auto-exports under `.beads/`):

```bash
git add .beads/ 2>/dev/null
git diff --cached --quiet || git commit -m "[lki] drop resolved node_modules aside from bd memory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification & close-gate

- [ ] **F1.** Run the full verify line (from the bd notes):

```bash
make stop && make dev && timeout 150 bash -c 'until docker compose exec -T frontend true 2>/dev/null && docker compose exec -T backend true 2>/dev/null; do sleep 3; done' && docker compose exec -T frontend sh -c 'touch /app/frontend/.permcheck-lki' && test "$(stat -c %u frontend/.permcheck-lki)" = "$(id -u)" && rm -f frontend/.permcheck-lki && docker compose exec -T frontend sh -c 'touch /app/frontend/node_modules/.permcheck-lki && rm /app/frontend/node_modules/.permcheck-lki' && docker compose exec -T backend sh -c 'touch /app/backend/.permcheck-lki' && test "$(stat -c %u backend/.permcheck-lki)" = "$(id -u)" && rm -f backend/.permcheck-lki && docker compose exec -T backend sh -c 'touch /app/backend/node_modules/.permcheck-lki && rm /app/backend/node_modules/.permcheck-lki' && make stop
```

Expected: exits 0. (Leaves the stack stopped — run `make dev` afterward if you want it back up.)

- [ ] **F2.** Hand off to `/bd-close-reviewed story-editor-lki`. The diff touches `frontend/Dockerfile`, `backend/Dockerfile`, `docker-compose.override.yml`, `Makefile`, `README.md`, `CLAUDE.md` — no `backend/src/**`, no auth/crypto/narrative-route files, no migrations — so `/bd-close-reviewed`'s path-matched surface reviewers (`security-reviewer`, `repo-boundary-reviewer`) are correctly out of lane and SKIPPED. The typecheck phase is a near-no-op (no TS workspace source changed); the verify line is the real gate.

---

## Self-review notes

Checked against the investigation + the agreed (expanded) scope:

- **Permissions fix — install as `node`:** both Dockerfiles' `deps` stage does `chown node:node /app` → `USER node` → `COPY --chown` → `npm ci`, so every `node_modules` tree the image produces is node-owned (Tasks 1, 2). `builder` and `dev` build `FROM deps` and inherit it. ✓
- **Permissions fix — run as `node`:** the `dev` stages inherit the `node` user from `deps`; no explicit `USER` needed in `dev` (Tasks 1, 2). ✓
- **Permissions fix — shield per-workspace trees:** anonymous volumes for `/app/frontend/node_modules`, `/app/backend/node_modules`, `/app/shared/node_modules` (Task 3). They initialise node-owned because the `deps` stage both runs `npm ci` *and* `mkdir -p`s those three dirs as `node` — so they exist and are node-owned in the image by construction, not by incidental npm hoisting (Tasks 1, 2). ✓
- **A/B interaction:** because the install is node-owned, the anonymous volumes are node-writable with no `chown -R` layer — the cleaner end-state than installing as root then chowning. ✓
- **corepack dropped (Scope 2):** removed from `frontend/Dockerfile` entirely; `node:24-alpine` ships npm 11.x natively, so there is nothing for it to do. Task 1 Step 2 verifies `npm ci` succeeds with no corepack. ✓
- **`deps` stage for frontend (Scope 3):** added; `builder` and `dev` are `FROM deps` — matches the backend's structure, dedupes the install. ✓
- **Node base bumped to 24 (Scope 6):** all three `FROM node:22-alpine` lines → `node:24-alpine` (frontend `deps`; backend `deps` and `runner`), plus the Tech Stack line and the deps-stage comments. Aligns the images with `.nvmrc` and both CI workflows, which already run Node 24; the verify steps in Tasks 1–2 confirm the images build on it. ✓
- **Backend `runner` → `node` user (Scope 4):** `addgroup`/`adduser app` removed; `chown -R app:app` → `chown -R node:node`; `USER app` → `USER node`. The install/copy/generate steps still run as root, exactly as before — only the final dropped-privilege user changed. ✓
- **Frontend `./shared` mount + `command:` drop (Scope 5):** `./shared:/app/shared` added to the frontend service; both `command:` keys removed (Task 3, verified Step 3 + Step 4). ✓
- **Makefile change dropped:** Scope section + Task 4's `--renew-anon-volumes` rationale explain why — installing as `node` makes `/app/node_modules` node-owned, so `make seed`'s `prisma generate` works as `node`; Task 4 Step 6 proves it at runtime. ✓
- **`pgdata` safety:** the rollout uses `docker compose up -d --renew-anon-volumes`, never `down -v`. `--renew-anon-volumes` recreates only anonymous volumes; named volumes (`pgdata`) are untouched. Called out in Task 4's "Why" note. ✓
- **frontend `runner` user model left alone:** `nginx:alpine`, different base, no `node` user, no `app`-vs-`node` redundancy — out of scope, stated in the Scope section. ✓
- **nginx base image pinned (Scope 7):** `FROM nginx:alpine` → `FROM nginx:1.31-alpine` in the frontend `runner` stage — the current mainline, made explicit and reproducible. Verified by Task 1 Step 2's prod-image build (which pulls the pinned base). ✓
- **Docs + Makefile sync (Scope 8):** `make rebuild*` → `--renew-anon-volumes` via a `COMPOSE_UP_FLAGS` variable on `dev` (Task 5 Steps 1–3, verified with `make -n`); `README.md`'s dependency-rebuild paragraph and the `Makefile`'s `rebuild` comment corrected (Steps 2, 4); `CLAUDE.md`'s resolved "Frontend tests may not run on the host" gotcha dropped and the non-root-user rule generalized (Step 5); the stale node_modules aside trimmed from the `when-migrating-an-entity-onto-shared-zod-schemas` bd memory (Step 7). ✓
- **Verify line:** probes *both* halves of the fix per dev service — (1) a write into the bind-mount root lands host-owned (container runs as host uid), and (2) a write into the per-workspace `node_modules` anonymous volume succeeds (volume initialised node-owned, writable by the runtime `node` user — the load-bearing mechanism). The original `lki` verify checked `node_modules` ownership *on the host*, which the anon volume deliberately makes unobservable; the in-container writability check keeps the actual subject of the bug under test (Task 4 Steps 5 + 7, F1). ✓
- **Build-command selection:** the prod-image checks use `docker compose -f docker-compose.yml build` (override excluded → `runner` target); the dev-image checks use both `-f` files (override included → `dev` target). `docker compose` auto-merges `docker-compose.override.yml` by default, so a bare `docker compose build` is the *dev* target, not prod — the two are not interchangeable, and each step states the exact form (Tasks 1–2 Steps 2–3, Task 4 Step 1). ✓
- **No placeholders:** every Dockerfile / compose change shows the exact final file content; every step has an exact command and expected output.
- **Identifier consistency:** the `node` user, `COREPACK_HOME` is *gone* (not just unused), and the volume paths (`/app/{frontend,backend,shared}/node_modules`) are named identically in the Dockerfiles, the override, and the verify line.
- **Incremental safety:** Tasks 1–2 each verify both the prod (`runner`) image and the dev image build, plus a run-as check; Task 3 ends with `docker compose config` + grep assertions; Task 5 ends with `make -n rebuild-frontend` to confirm the recipe expands with `--renew-anon-volumes`. The full system rollout + verify is Task 4 / F1.
