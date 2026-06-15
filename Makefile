.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db lint typecheck test test-e2e verify logs clean-docker

# Extra flags for `docker compose up` in the `dev` target. Empty for a plain
# `make dev`; the `rebuild*` targets set it to --renew-anon-volumes so a freshly
# built image's node_modules replace the (otherwise reused) anonymous volumes.
COMPOSE_UP_FLAGS ?=

# App version surfaced in the Settings footer. Local builds and the dev server
# read this from the environment (docker-compose.yml build-arg + the override's
# env); we tag them `dev-<short-sha>` so a locally built/served frontend is
# obviously not an official release. A checkout with no git history falls back
# to `dev-local`. The release workflow injects a clean semver instead — this
# var is only ever consumed by `docker compose`, so exporting it globally is
# harmless for targets that don't rebuild the frontend. Override by setting
# VITE_APP_VERSION in your shell.
export VITE_APP_VERSION ?= dev-$(shell git rev-parse --short HEAD 2>/dev/null || echo local)

dev:
	docker compose up -d $(COMPOSE_UP_FLAGS)
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"

stop:
	@docker compose down

# Rebuild a service image after a dependency change (e.g. new npm package),
# then bring the stack back up. Use this whenever package.json changes —
# the dev compose bind-mounts source but keeps every node_modules tree in
# anonymous volumes. `docker compose up` reuses those volumes by default, so
# rebuilding alone is not enough: these targets pass --renew-anon-volumes (via
# COMPOSE_UP_FLAGS) so the freshly installed node_modules actually propagate.
rebuild: stop
	docker compose build
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes
	$(MAKE) clean-docker

rebuild-frontend: stop
	docker compose build frontend
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes
	$(MAKE) clean-docker

rebuild-backend: stop
	docker compose build backend
	$(MAKE) dev COMPOSE_UP_FLAGS=--renew-anon-volumes
	$(MAKE) clean-docker

# Reclaim disk from `make rebuild*`. Only removes resources unused by any
# container (so the running stack is safe) and older than 24h (so an image you
# just pulled but haven't started yet is spared). Run standalone any time:
#   make clean-docker
clean-docker:
	docker system prune -f --filter "until=24h"
	docker volume prune -f

migrate:
	cd backend && npx prisma migrate deploy
	# Restart the backend so its dev-stage `prisma generate` (in the `dev`
	# script) regenerates the client against the new schema — the container's
	# node_modules is an anonymous volume, so a host-side generate never
	# reaches it. Without this the running client lags the migrated DB.
	docker compose restart backend

seed:
	docker compose exec backend npx prisma generate
	docker compose restart backend
	@sleep 3
	docker compose exec backend npx tsx prisma/seed.ts

reset-db:
	docker compose down -v
	docker compose up -d postgres
	@sleep 3
	cd backend && npx prisma migrate reset --force

lint:
	npx biome check

typecheck:
	npm -w story-editor-shared run typecheck
	npm -w story-editor-backend run typecheck
	npm -w story-editor-frontend run typecheck

test:
	npm -w story-editor-shared run test
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test

test-e2e:
	npx playwright test

# Local CI-equivalent: lint, three typechecks, design-token lint, backend +
# frontend builds, three test suites. Backend tests require Postgres up
# (`make dev`) — vitest globalSetup hits the compose stack on every invocation.
verify: lint typecheck
	npm -w story-editor-frontend run lint:design
	npm -w story-editor-backend run build
	npm -w story-editor-frontend run build
	npm -w story-editor-shared run test
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test

logs:
	docker compose logs -f --tail=100
