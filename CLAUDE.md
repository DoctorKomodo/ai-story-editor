# CLAUDE.md — Story Editor

This file is the operating manual for Claude Code on this project. Read it fully before touching any code. Update it when you discover something that should be remembered across sessions.

---

## Project Overview

A self-hosted, web-based story and text editor with Venice.ai integration. Users manage stories broken into chapters, attach characters for AI consistency, and invoke AI writing assistance from a TipTap rich text editor.

**Monorepo layout:**
```
/
├── frontend/          React + Vite + TypeScript + TailwindCSS + TipTap
├── backend/           Node.js + Express + TypeScript + Prisma
├── db/                Prisma schema and migrations
├── scripts/           Utility shell scripts (backup, seed, reset)
├── docs/              Architecture and API documentation
├── docker-compose.yml
├── docker-compose.override.yml  (local dev, hot reload)
├── .env.example
├── Makefile
├── TASKS.md           Source of truth for all work
└── SELF_HOSTING.md
```

---

## Task Completion Protocol

**NEVER mark a task `[x]` until its verify command passes with exit code 0.**

For every task:
1. Read the task and its `verify:` command before writing any code
2. Write the implementation
3. Write the test if one is required by the task
4. Run the verify command exactly as written
5. If it fails: fix the code — do not modify the test to make it pass
6. Mark `[x]` only when the verify command exits cleanly
7. Move to the next task immediately — do not refactor or add scope

If a task has no verify command, add one to `TASKS.md` before starting.

---

## Task Order

Work through tasks in this order unless instructed otherwise:

**S → D → AU → B → F → I → T → X**

Do not start backend feature tasks (B) before auth (AU) is complete.
Do not start frontend tasks (F) before the backend routes they depend on exist.
Do not start E2E tests (T9, T10) before the full stack runs via Docker Compose.

---

## Architecture Rules

### General
- TypeScript strict mode is on in both frontend and backend — no `any` types
- All environment variables must be documented in `.env.example` with a comment explaining what they are
- No secrets ever committed to git. `.env` is in `.gitignore`.
- Venice.ai API key lives only in the backend `.env`. It must never appear in frontend code or build output.

### Backend
- All route handlers must be thin — logic goes in service files in `src/services/`
- All request bodies must be validated with Zod before reaching a controller
- All routes except `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, and `/api/health` require the auth middleware
- All story, chapter, and character routes require both auth middleware AND ownership middleware
- Errors are handled by the global error handler — do not write per-route try/catch unless it adds meaningful context
- Never expose `passwordHash` in any API response
- Never expose stack traces in responses when `NODE_ENV=production`

### Frontend
- JWT access token is stored in memory (React context) — never in localStorage or sessionStorage
- Refresh token lives in an httpOnly cookie set by the backend — the frontend never reads it directly
- All API calls go through `src/lib/api.ts` — never call `fetch` directly in components
- Components do not contain business logic — use hooks in `src/hooks/`
- Use TailwindCSS for all styling — no inline styles, no separate CSS files except `index.css`

### Database
- All DB access goes through Prisma — no raw SQL except in migration files
- Every model must have `createdAt` and `updatedAt` timestamps
- Foreign key fields must have indexes
- Cascading deletes must be defined in the schema — do not handle cascade logic in application code

### AI Integration
- All Venice.ai calls are proxied through the backend — the frontend only talks to `/api/ai/*`
- The AI service (`src/services/ai.service.ts`) is the only place that imports or calls Venice.ai
- Prompt construction logic lives in `src/services/prompt.service.ts` — keep it separate and unit testable
- Chapter content sent to the AI must be truncated if it exceeds 3000 tokens — implement this in the prompt service
- Character context must be condensed (name, role, key traits only) to avoid consuming too much of the context window

---

## Testing Rules

- Backend tests use a separate test database defined in `.env.test` — never run tests against the development database
- Run `npm run db:test:reset` before a full test suite run to ensure a clean state
- Each test file sets up its own test data and tears it down — no test should depend on data created by another test
- Do not mock the database in integration tests — use the test DB with real Prisma queries
- The Venice.ai HTTP client must be mocked in all tests — no real API calls in the test suite
- Do not skip or delete a failing test — fix the code until the test passes
- Frontend tests use jsdom — do not write tests that require a real browser (use Playwright for that)

---

## Docker & Infrastructure Rules

- The project has no built-in reverse proxy — the docker-compose.yml exposes ports directly (frontend :3000, backend :4000). An external proxy is handled by the operator.
- All Docker services must have `restart: unless-stopped`
- Postgres data must be in a named volume (`pgdata`) so it survives `docker compose down`
- The backend must not start until Postgres passes its health check (`depends_on` with `condition: service_healthy`)
- Multi-stage Dockerfiles only — no single-stage builds in production
- Backend container runs as a non-root user

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files (backend) | camelCase | `auth.service.ts` |
| Files (frontend) | PascalCase for components | `CharacterSheet.tsx` |
| Files (frontend) | camelCase for hooks/lib | `useAuth.ts`, `api.ts` |
| Database models | PascalCase | `Story`, `Chapter` |
| Database fields | camelCase | `worldNotes`, `storyId` |
| API routes | kebab-case nouns | `/api/stories`, `/api/ai/complete` |
| React components | PascalCase | `CharacterSheet` |
| React hooks | camelCase, `use` prefix | `useAuth`, `useStory` |
| Environment vars | SCREAMING_SNAKE_CASE | `VENICE_API_KEY` |
| Test files | mirror source path + `.test.ts` | `tests/routes/stories.test.ts` |

---

## Git Rules

- Create a new branch for each task group (e.g. `feature/auth`, `feature/stories-crud`)
- Commit after each passing verify command — small, frequent commits
- Commit message format: `[TASK_ID] brief description` e.g. `[AU1] add user registration with bcrypt`
- Never commit directly to `main`
- Never commit `.env` or any file containing real credentials

---

## Security Review

The `security-reviewer` subagent (`.claude/agents/security-reviewer.md`) is a read-only reviewer tuned to this project's auth/session/key surface. **Invoke it automatically** before marking any of these task groups `[x]`:

- **Completion of AU1–AU4** — password hashing, login, JWT issuance, refresh rotation.
- **AU5–AU7** — auth middleware, ownership middleware, helmet/CORS/rate-limit.
- **AU8** — Venice key isolation; invoke *after* the frontend build exists.
- Any change to files under `backend/src/services/auth.service.ts`, `backend/src/middleware/`, `backend/src/services/ai.service.ts`, `backend/src/routes/auth.routes.ts`, or the `cookie`/`cors`/`helmet`/`rate-limit` configuration in `backend/src/index.ts`.

Invoke via the Agent tool with `subagent_type: security-reviewer` and a concrete scope in the prompt (e.g. "review AU1–AU4 as currently implemented" or "review the refresh rotation logic in auth.service.ts"). Treat `BLOCK` and `FIX_BEFORE_MERGE` findings as hard gates before ticking the box — if the hook (see `.claude/hooks/pre-tasks-edit.sh`) says the verify passed but the reviewer says `BLOCK`, do not tick.

---

## When to Stop and Ask

Stop and ask before proceeding if:
- A task requires an architectural decision not covered in this file or `TASKS.md`
- A verify command cannot pass due to an external dependency issue (e.g. Venice.ai API is unreachable)
- A task conflicts with a decision already made in a previous task
- You are about to modify the Prisma schema after the initial migration has been run
- You are about to add a new dependency that significantly increases bundle or image size

Do not ask for permission to:
- Choose between equivalent utility libraries (lodash vs native, etc.)
- Add TypeScript types or interfaces
- Add comments or JSDoc
- Improve error messages
- Fix linting warnings

---

## Known Gotchas

- TipTap's `useEditor` hook must be used inside a component with a stable reference — wrap in `useMemo` if you see re-render issues
- Prisma's `cascade` delete behaviour must be set on the relation field using `onDelete: Cascade` — it does not cascade by default
- Venice.ai streaming responses use SSE — use `ReadableStream` on the frontend to consume them, not a standard `fetch().then(res => res.json())`
- `wordCount` on `Chapter` is computed and stored on save — it is not a Prisma computed field. Calculate it in the service layer before calling `prisma.chapter.update()`
- Refresh token rotation: when a refresh token is used, delete the old one and create a new one in the same transaction
- Docker hot reload for the backend requires `ts-node-dev` or `nodemon` in the override compose file — the production Dockerfile does not include these

---

## Lessons Learned

> Add to this section whenever Claude does something wrong that should not be repeated.

*(empty — update as the project progresses)*
