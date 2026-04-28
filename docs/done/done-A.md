> Source of truth: `TASKS.md`. Closed [A]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🏗️ A — Architecture

- [x] **[A1]** Write `docs/data-model.md` with a mermaid ER diagram: User -> Stories -> Chapters, User -> Stories -> Characters. All fields listed per entity.
  - verify: `test -f docs/data-model.md && grep -q "Character" docs/data-model.md && grep -q "Chapter" docs/data-model.md`

- [x] **[A2]** Write `docs/api-contract.md` documenting every REST endpoint: method, path, auth required, request body, response schema, error codes.
  - verify: `test -f docs/api-contract.md && grep -q "/api/stories" docs/api-contract.md && grep -q "/api/ai/complete" docs/api-contract.md`

- [x] **[A3]** Write `docs/venice-integration.md` covering: OpenAI-compatible client setup, venice_parameters used and why, prompt construction strategy, dynamic context window budgeting, streaming implementation, reasoning model handling, prompt caching strategy, rate limit and balance header usage.
  - verify: `test -f docs/venice-integration.md && grep -q "venice_parameters" docs/venice-integration.md && grep -q "context_length" docs/venice-integration.md`

- [x] **[A4]** Create `backend/src/lib/venice.ts` — single place that initialises the OpenAI client with Venice base URL and API key. Export the client instance. No other file imports `openai` directly.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice.test.ts`

---
