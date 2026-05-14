.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db test test-e2e logs shared-build shared-watch

# Build the shared workspace (shared/dist/) so backend + tests can resolve
# story-editor-shared at runtime. This is a host-side build; the Docker image
# also builds shared internally (see backend/Dockerfile builder/dev stages).
shared-build:
	npm -w story-editor-shared run build

# Watcher sidecar — keeps shared/dist/ up to date on the host while you edit
# shared/src/**. The override compose bind-mounts ./shared into the backend
# container (/app/shared), so ts-node-dev will pick up changes via the
# workspace symlink (node_modules/story-editor-shared → ../shared).
shared-watch:
	npx -w story-editor-shared tsc -p tsconfig.build.json --watch

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

stop:
	@docker compose down
	@if [ -f .watcher.pid ]; then PGID=$$(cat .watcher.pid | tr -d ' '); kill -- -$$PGID 2>/dev/null || true; rm -f .watcher.pid; fi

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

migrate:
	cd backend && npx prisma migrate deploy

seed:
	docker compose exec backend npx prisma generate
	docker compose restart backend
	@sleep 3
	docker compose exec backend npx ts-node --transpile-only prisma/seed.ts

reset-db:
	docker compose down -v
	docker compose up -d postgres
	@sleep 3
	cd backend && npx prisma migrate reset --force

test: shared-build
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test

test-e2e:
	npx playwright test

logs:
	docker compose logs -f --tail=100
