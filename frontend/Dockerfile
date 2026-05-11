# frontend/Dockerfile
# Built with repo root as context per the workspaces adoption. See
# docker-compose.yml's frontend.build.{context,dockerfile}.

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
# Upgrade npm to 11.x via corepack — node:22-alpine ships npm 10.9.7, whose
# resolver rejects this lockfile over an optional peer that npm 11 handles
# correctly. corepack ships with node 22 and side-steps npm's self-upgrade
# MODULE_NOT_FOUND bug on alpine. COREPACK_ENABLE_NPM is required because
# npm is opt-out by default in corepack on node 22 LTS.
RUN COREPACK_ENABLE_NPM=1 corepack enable npm \
 && corepack prepare npm@11.13.0 --activate

# Workspace-aware install: copy every workspace manifest and the single root
# lockfile, then npm ci installs all workspaces.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci

# Frontend reads shared via Vite alias to shared/src — no shared build step
# needed here. (Backend builds shared in its own Dockerfile.)
COPY . .

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
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
# Same corepack-based npm 11 upgrade as the builder stage — node:22-alpine
# ships npm 10.9.7 which can't resolve this lockfile (see builder stage
# comment for the full rationale).
RUN COREPACK_ENABLE_NPM=1 corepack enable npm \
 && corepack prepare npm@11.13.0 --activate
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci
COPY . .
EXPOSE 3000
# Run via npm workspace so npm sets CWD to frontend/ where vite.config.ts lives.
# The config already sets host:true and port:3000, so no extra CLI flags needed.
CMD ["npm", "-w", "story-editor-frontend", "run", "dev"]

# ---- runner --------------------------------------------------------------
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Replace the default config with our SPA-fallback variant.
RUN rm /etc/nginx/conf.d/default.conf
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle — Vite outputs to frontend/dist relative to the repo root
# when built from the workspace root context.
COPY --from=builder /app/frontend/dist .

# nginx:alpine listens on 80 by default, but our config binds 3000.
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:3000/ | grep -q '<html' || exit 1
