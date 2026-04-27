.PHONY: dev stop migrate seed reset-db test test-e2e logs

dev:
	docker compose up -d
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"

stop:
	docker compose down

migrate:
	cd backend && npx prisma migrate deploy

seed:
	cd backend && npx ts-node-dev --transpile-only ../scripts/seed.ts

reset-db:
	docker compose down -v
	docker compose up -d postgres
	@sleep 3
	cd backend && npx prisma migrate reset --force

test:
	cd backend && npm run test
	cd frontend && npm run test

test-e2e:
	npx playwright test

logs:
	docker compose logs -f --tail=100
