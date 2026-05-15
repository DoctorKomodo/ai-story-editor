.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db test test-e2e logs clean-docker

# Extra flags for `docker compose up` in the `dev` target. Empty for a plain
# `make dev`; the `rebuild*` targets set it to --renew-anon-volumes so a freshly
# built image's node_modules replace the (otherwise reused) anonymous volumes.
COMPOSE_UP_FLAGS ?=

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

test:
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test

test-e2e:
	npx playwright test

logs:
	docker compose logs -f --tail=100
