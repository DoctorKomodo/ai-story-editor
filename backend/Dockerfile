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
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM deps AS dev
ARG PRISMA_GENERATE_DATABASE_URL
ENV NODE_ENV=development
COPY --chown=node:node . .
# NOTE: unlike the `builder` stage, `dev` does NOT run
# `npm -w story-editor-shared run build`. The dev server resolves
# story-editor-shared straight from shared/src via the `source` export
# condition (NODE_OPTIONS=--conditions=source in backend/package.json's
# `dev` script) — there is no shared/dist for dev to build.
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
