# I2 — Frontend multi-stage Dockerfile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-stage `frontend/Dockerfile` whose `runner` stage serves the Vite-built `dist/` on port 3000 with SPA-friendly fallback (`/` for unknown paths). Replace the `nginx:alpine` stub used in `docker-compose.yml`.

**Architecture:** Two stages — `builder` runs `npm ci && npm run build` to produce `dist/`; `runner` is `nginx:alpine` serving `dist/` from `/usr/share/nginx/html` with a config that falls through to `index.html` so React Router's client-side routes work on direct page loads. Listens on port 3000 (per `docker-compose.yml`).

**Tech Stack:** `node:22-alpine` for build, `nginx:alpine` for runtime. SPA fallback via `try_files $uri /index.html`.

**Prerequisites:** None. Vite build already passes (`frontend/dist/` exists from prior local builds).

**Out of scope:**
- Runtime API base-URL injection (operators on non-localhost domains will need `VITE_API_URL` set at build time, or a future runtime-config follow-up — see Self-Review).
- HTTPS termination — handled by the operator's upstream reverse proxy per `SELF_HOSTING.md`.
- Compose wiring — `[I3]`.

---

### Task 1: Add `.dockerignore`

**Files:**
- Create: `frontend/.dockerignore`

- [ ] **Step 1: Write it**

```gitignore
node_modules
dist
.env
.env.*
!.env.example
tests
playwright-report
test-results
coverage
*.log
.git
.DS_Store
```

- [ ] **Step 2: Commit**

```bash
git add frontend/.dockerignore
git commit -m "[I2] add frontend .dockerignore"
```

---

### Task 2: Write the nginx config

**Files:**
- Create: `frontend/nginx.conf`

- [ ] **Step 1: Write it**

```nginx
server {
  listen 3000 default_server;
  listen [::]:3000 default_server;

  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Long-cache hashed assets, no-cache the entry HTML so SPA bumps deploy cleanly.
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }

  location = /index.html {
    add_header Cache-Control "no-store";
    try_files $uri =404;
  }

  # SPA fallback — any unknown route serves index.html so client routing works
  # on direct page load / refresh.
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Don't leak nginx version in headers/error pages.
  server_tokens off;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/nginx.conf
git commit -m "[I2] frontend nginx config with SPA fallback"
```

---

### Task 3: Write the Dockerfile

**Files:**
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Write it**

```dockerfile
# frontend/Dockerfile

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
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
```

- [ ] **Step 2: Build the image**

```bash
docker build -t story-editor-frontend ./frontend
```

Expected: build succeeds.

- [ ] **Step 3: Run and curl it**

```bash
docker run --rm -d -p 3001:3000 --name fe-smoke story-editor-frontend
sleep 3
curl -sf http://localhost:3001 | grep -q "html"
echo $?
docker stop fe-smoke
```

Expected: exit 0 from the grep.

- [ ] **Step 4: Confirm the verify command passes verbatim**

```bash
docker build -t story-editor-frontend ./frontend && \
  docker run --rm -d -p 3001:3000 story-editor-frontend && \
  sleep 3 && \
  curl -sf http://localhost:3001 | grep -q "html" && \
  docker stop $(docker ps -q --filter ancestor=story-editor-frontend)
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/Dockerfile
git commit -m "[I2] frontend multi-stage Dockerfile with SPA-fallback nginx"
```

---

### Task 4: SPA-fallback regression check

**Files:** none (manual).

- [ ] **Step 1: Confirm a deep-link route hits index.html**

```bash
docker run --rm -d -p 3001:3000 --name fe-smoke story-editor-frontend
sleep 2
curl -sf http://localhost:3001/stories/abcd1234 | grep -q '<div id="root">'
docker stop fe-smoke
```

Expected: exit 0. If the response is a 404, the `try_files` clause is wrong; fix before continuing.

---

### Task 5: Verify gate

- [ ] **Step 1: Run via `/task-verify I2`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I2] tick — frontend multi-stage Dockerfile"
```

---

## Self-Review Notes

- **Build-time `VITE_API_URL`.** Vite inlines `import.meta.env.*` at build time, so operators changing the API URL must rebuild. The default value (`http://localhost:4000`) matches the bundled compose stack on a self-hosting laptop. For multi-host deployments, document the `--build-arg` recipe in `[I6]`'s `SELF_HOSTING.md`. This is intentional ("Don't add features beyond what the task requires"); a runtime-config fallback can be a future X-task if a real user needs it.
- **`nginx:alpine`** is already pulled by the stub `docker-compose.yml`, so the layer cache is warm and the production image stays small (~25 MB).
- **No non-root user step.** `[I1]`'s verify checks for the `User` instruction; `[I2]`'s does not, so we keep nginx's default. nginx workers drop to `nginx` user automatically per the base image's config.
- **Healthcheck.** Mirrors the existing stub; `wget` ships with `nginx:alpine`'s busybox.
