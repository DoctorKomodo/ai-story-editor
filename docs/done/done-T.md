> Source of truth: `TASKS.md`. Closed [T]-series tasks (T1–T9 + T8.1) archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🧪 T — Testing

- [x] **[T1]** Auth route integration tests: register, duplicate email, login, wrong password, refresh, logout.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/`

- [x] **[T2]** Stories route integration tests: CRUD, ownership enforcement, word count aggregation.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts tests/routes/story-detail.test.ts`

- [x] **[T3]** Chapters route integration tests: CRUD, reordering, word count on save.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts tests/routes/chapters-reorder.test.ts`

- [x] **[T4]** Characters route integration tests: CRUD, story scoping, cascade delete.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/characters.test.ts`

- [x] **[T5]** Prompt builder unit tests: all 5 action types, character context present, worldNotes present, `include_venice_system_prompt` reflects the caller-supplied `includeVeniceSystemPrompt` setting (default `true`) independent of action type, model, and `Story.systemPrompt`, truncation removes from top of chapterContent only, budget respects model context length.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts`

- [x] **[T6]** Venice AI service unit tests (mocked HTTP): correct payload, stream forwarded, reasoning model flag applied correctly, rate limit headers extracted, error codes mapped, no raw Venice errors leaked.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/`

- [x] **[T7]** Frontend component tests: Editor, AIPanel, ModelSelector, UsageIndicator, CharacterSheet, WebSearchToggle.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/`

- [x] **[T8]** Playwright E2E (tier-2 PR-blocking smoke). Drives the live `make dev` stack through register → create story → BYOK Venice key save → add chapter → type into TipTap → trigger AI Continue → assert streamed mock response in the Continue-Writing region → assert the mock saw a chat-completion call. Venice is mocked in-process via `tests/e2e/fixtures/mock-venice.ts` (in-proc OpenAI-compatible HTTP server speaking SSE on `/v1/chat/completions` + `/v1/models`); the dockerised backend reaches it via `host.docker.internal` thanks to `extra_hosts: host-gateway` in the dev compose override. Per-user BYOK `endpoint` field steers the per-user OpenAI client at the mock without touching production code paths. Tier-3 (`tests/e2e-extended/` + cross-browser / soak runs) is intentionally NOT introduced here — add when first such case appears. Two assertions from the original blurb — "Saved ✓" autosave indicator and UsageIndicator delta — are tracked under [T8.1] (autosave never fires under the live stack inside the spec, suggesting a TanStack Query refetch races the local-draft useEffect in `EditorPage:215`; UsageIndicator only mounts inside `<AIPanel>`, which the Continue-Writing path doesn't surface).
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`

- [x] **[T8.1]** Restore the autosave + usage-indicator assertions to the [T8] full-flow spec. The first hypothesis (the `[activeChapterId, chapterQuery.data]` effect wiping `draftBodyJson` on a late-arriving query resolve) was confirmed and fixed — the seed effect now tracks the last-seeded chapter id via a ref so the seed is strictly idempotent per chapter; for chapters that load with `bodyJson === null` it seeds with the canonical empty TipTap doc so `useAutosave`'s baseline-skip logic doesn't swallow the user's first keystroke. Two further bugs surfaced once the chain unblocked: (a) `useAutosave`'s `mountedRef` was never reset to `true` on remount, so under React.StrictMode dev the first synthetic cleanup permanently disabled every scheduled save (every `if (!mountedRef.current) return;` guard fired); (b) the EditorPage autosave was POSTing `{ bodyJson, wordCount }` but the backend `UpdateChapterBody` is `.strict()` and recomputes `wordCount` server-side, so every PATCH was a 400. UsageIndicator was orphaned at F55 when `<AIPanel>` was unmounted — restored it inside `<ContinueWriting>` (which already exposes `completion.usage` via `useAICompletion`) and updated `tests/e2e/fixtures/mock-venice.ts` to send `x-ratelimit-remaining-{requests,tokens}` headers; the spec now asserts the rendered "4.2K requests / 988K tokens remaining" text after the AI completion finishes.
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`

- [x] **[T9]** Full suite run — all tests pass before marking complete.
  - verify: `cd backend && npm run test:backend -- --run && cd ../frontend && npm run test:frontend -- --run && echo "ALL TESTS PASSED"`

---
