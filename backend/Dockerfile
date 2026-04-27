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
# DATABASE_URL is read by prisma.config.ts at generate time but not used until
# `migrate deploy` runs at container start; a dummy value is fine here.
ENV DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma
RUN npx prisma generate
RUN npm run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
# Placed before `runner` so a default `docker build` (no --target) lands on
# the runner stage. Compose's override selects this stage explicitly via
# `target: dev`.
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same dummy DATABASE_URL trick as the builder stage — prisma.config.ts
# requires it at config-load time even though `prisma generate` doesn't
# touch the DB. The real value is provided as a runtime env var.
RUN DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

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
# the entrypoint. The prisma.config.ts is needed for `prisma generate` and
# `migrate deploy` in this stage.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Same dummy DATABASE_URL trick — only needed so `prisma generate` can load
# the config; the real value is provided as a runtime env var.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma npx prisma generate \
    && chown -R app:app /app

USER app

EXPOSE 4000

# Healthcheck mirrors docker-compose.yml's HTTP probe so a misbehaving
# container is restarted under `restart: unless-stopped`.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
