# frontend/Dockerfile

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
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# VITE_* vars are inlined into the bundle at build time. Defaults match the
# stock docker-compose port layout (frontend :3000 talks to backend :4000 on
# the same host). Operators on non-localhost domains override at build time:
#   docker build --build-arg VITE_API_URL=https://api.example.com ./frontend
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ---- runner --------------------------------------------------------------
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Replace the default config with our SPA-fallback variant.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle.
COPY --from=builder /app/dist .

# nginx:alpine listens on 80 by default, but our config binds 3000.
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:3000/ | grep -q '<html' || exit 1

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
