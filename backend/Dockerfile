# backend/Dockerfile
# Built with repo root as context per the workspaces adoption. See
# docker-compose.yml's backend.build.{context,dockerfile}.

ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Workspace-aware install: copy every workspace manifest and the single root
# lockfile, then npm ci installs all workspaces.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Shared must be built before backend tsc — backend's compiled CJS will
# `require('story-editor-shared')` which resolves to shared/dist.
RUN npm -w story-editor-shared run build
ENV DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL}
RUN npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM node:22-alpine AS dev
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci
COPY . .
RUN npm -w story-editor-shared run build
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
EXPOSE 4000
CMD ["npm", "-w", "story-editor-backend", "run", "dev"]

# ---- runner --------------------------------------------------------------
FROM node:22-alpine AS runner
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

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
    && chown -R app:app /app

USER app
WORKDIR /app/backend

EXPOSE 4000

# Healthcheck mirrors docker-compose.yml's HTTP probe so a misbehaving
# container is restarted under `restart: unless-stopped`.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
