.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db test test-e2e logs shared-build shared-watch

# Build the shared workspace (shared/dist/) so backend + tests can resolve
# story-editor-shared at runtime. This is a host-side build; the Docker image
# also builds shared internally (see backend/Dockerfile builder/dev stages).
shared-build:
	npm -w story-editor-shared run build

# Watcher sidecar — keeps shared/dist/ up to date on the host while you edit
# shared/src/**. Useful for host-side TypeScript tooling (IDE, typecheck).
# Note: shared/dist inside the running Docker container is baked in at image-
# build time (./shared is not bind-mounted), so editing shared/src during dev
# requires `make rebuild-backend` to take effect inside the container.
shared-watch:
	npx -w story-editor-shared tsc -p tsconfig.build.json --watch

dev: shared-build
	@( npx -w story-editor-shared tsc -p tsconfig.build.json --watch & ) ; \
	 echo "shared watcher running in background (host-side only; kill tsc manually if needed)"
	docker compose up -d
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"

stop:
	docker compose down

# Rebuild a service image after a dependency change (e.g. new npm package),
# then bring the stack back up. Use this whenever package.json changes —
# the dev compose mounts source via bind-mount but keeps node_modules
# inside the image (anonymous volume), so a fresh `npm install` only takes
# effect after the image is rebuilt.
rebuild: stop
	docker compose build
	$(MAKE) dev

rebuild-frontend: stop
	docker compose build frontend
	$(MAKE) dev

rebuild-backend: stop
	docker compose build backend
	$(MAKE) dev

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
	cd backend && npm run test
	cd frontend && npm run test

test-e2e:
	npx playwright test

logs:
	docker compose logs -f --tail=100
