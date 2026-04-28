> Source of truth: `TASKS.md`. Closed [S]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## ⚙️ S — Tech Stack & Project Setup

- [x] **[S1]** Scaffold monorepo with `/frontend`, `/backend`, `/db` folders and root-level `docker-compose.yml`, `.env.example`, `.gitignore`, and `README.md`
  - verify: `test -f docker-compose.yml && test -d frontend && test -d backend && test -d db`

- [x] **[S2]** Create `docker-compose.yml` with services: `frontend` (port 3000), `backend` (port 4000), `postgres` (port 5432). All services use named volumes. Postgres uses a health check. No reverse proxy service.
  - verify: `docker compose config --quiet && docker compose up -d && sleep 8 && docker compose ps | grep -E "(healthy|running)" | wc -l | grep -E "^[3-9]"`

- [x] **[S3]** Configure environment variable strategy — `.env.example` documents all required vars for backend (`DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `VENICE_API_KEY`, `FRONTEND_URL`, `PORT`) and frontend (`VITE_API_URL`). Add `.env` to `.gitignore`.
  - verify: `test -f .env.example && grep -q VENICE_API_KEY .env.example && grep -q JWT_SECRET .env.example && grep "\.env" .gitignore`

- [x] **[S4]** Set up Vite + React + TypeScript frontend with TailwindCSS, path aliases (`@/` -> `src/`), and a working dev server.
  - verify: `cd frontend && npm install && npm run build 2>&1 | grep -iv "error" && echo "BUILD OK"`

- [x] **[S5]** Set up Express + TypeScript backend with folder structure: `src/routes`, `src/controllers`, `src/services`, `src/middleware`, `src/lib`. Install: `openai`, `prisma`, `@prisma/client`, `zod`, `bcryptjs`, `jsonwebtoken`, `morgan`, `helmet`, `cors`, `express-rate-limit`.
  - verify: `cd backend && npm install && npm run build 2>&1 | grep -iv "error" && echo "BUILD OK"`

- [x] **[S6]** Add `Makefile` at project root with targets: `dev`, `stop`, `migrate`, `seed`, `reset-db`, `test`, `test-e2e`, `logs`
  - verify: `make --dry-run dev && make --dry-run migrate && make --dry-run test`

- [x] **[S7]** Install and configure Vitest + Supertest for backend. Create `backend/tests/setup.ts` connecting to test DB, running migrations, exporting teardown.
  - verify: `cd backend && npm run test:backend -- --run tests/setup.test.ts`

- [x] **[S8]** Create `.env.test` with a separate test `DATABASE_URL`. Add `npm run db:test:reset` script that drops, recreates, and migrates the test DB.
  - verify: `cd backend && npm run db:test:reset && echo "TEST DB OK"`

- [x] **[S9]** Install and configure Vitest + React Testing Library + jsdom for frontend. Add `frontend/tests/setup.ts` with jest-dom matchers.
  - verify: `cd frontend && npm run test:frontend -- --run tests/setup.test.tsx`

- [x] **[S10]** Install Playwright at root level. Configure against `http://localhost:3000`. Write a placeholder smoke test that visits the home page and asserts a heading is visible.
  - verify: `npx playwright install chromium && docker compose up -d && npx playwright test --reporter=line tests/smoke.spec.ts`

---
