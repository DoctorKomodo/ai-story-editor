# backend/Dockerfile

# Dummy DATABASE_URL used only for `prisma generate` at build time. The real
# value is provided as a runtime env var; `migrate deploy` (run from the
# entrypoint) is the only path that actually connects. We keep one literal
# here and let each stage redeclare the ARG so a future change touches one
# line, not three.
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL}
RUN npx prisma generate
RUN npm run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
# Placed before `runner` so a default `docker build` (no --target) lands on
# the runner stage. Compose's override selects this stage explicitly via
# `target: dev`.
FROM node:22-alpine AS dev
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- runner --------------------------------------------------------------
FROM node:22-alpine AS runner
ARG PRISMA_GENERATE_DATABASE_URL
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
# the entrypoint. The prisma.config.ts is needed for `prisma generate` and
# `migrate deploy` in this stage.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx prisma generate \
    && chown -R app:app /app

USER app

EXPOSE 4000

# Healthcheck mirrors docker-compose.yml's HTTP probe so a misbehaving
# container is restarted under `restart: unless-stopped`.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
