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
