> Source of truth: `TASKS.md`. Closed [B]-series tasks (including V19–V28 follow-ups and the [D17] schema fix that landed in the B-series branch) archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🖥️ B — Backend (non-AI routes)

- [x] **[B1]** `GET /api/stories` and `POST /api/stories`. GET returns all user stories with chapter count and total word count. POST validates with Zod.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts`

- [x] **[B2]** `GET|PATCH|DELETE /api/stories/:id`. All require auth + ownership middleware.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/story-detail.test.ts`

- [x] **[B3]** Chapters full CRUD under `/api/stories/:storyId/chapters`. POST auto-assigns `orderIndex`. `wordCount` computed and stored on create/update.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts`

- [x] **[B4]** `PATCH /api/stories/:storyId/chapters/reorder` — accepts `{ chapters: [{ id, orderIndex }] }`, updates all in a single Prisma transaction.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters-reorder.test.ts`

- [x] **[B5]** Characters full CRUD under `/api/stories/:storyId/characters`. All fields validated with Zod.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/characters.test.ts`

- [x] **[B6]** `GET /api/health` returns `{ status: "ok", db: "connected" }`. Returns 503 if DB unreachable.
  - verify: `curl -sf http://localhost:4000/api/health | grep '"status":"ok"'`

- [x] **[B7]** Global error handler: consistent `{ error: { message, code } }` JSON. No stack traces in production.
  - verify: `cd backend && npm run test:backend -- --run tests/middleware/error-handler.test.ts`

### B — Mockup-driven additions

- [x] **[B8]** Outline CRUD under `/api/stories/:storyId/outline`: list, create, patch, delete, plus `PATCH …/outline/reorder` (single transaction). Auth + ownership middleware required.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/outline.test.ts`

- [x] **[B9]** `GET /api/stories/:id/progress` — returns `{ wordCount, targetWords, percent, chapters: [{ id, wordCount }] }` for the sidebar progress footer (`42,318 / 90,000 words · 47%`).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/story-progress.test.ts`

- [x] **[B10]** Chapter save pipeline: when PATCH payload includes `bodyJson`, backend derives plain text + `wordCount` from the JSON tree (pure function `tipTapJsonToText()`) and writes both `bodyJson` and `content` in the same update. Existing text-only PATCH path (from [B3]) continues to work.
  - verify: `cd backend && npm run test:backend -- --run tests/services/tiptap-to-text.test.ts tests/routes/chapters-body-json.test.ts`

- [x] **[B11]** User settings passthrough: `GET /api/users/me/settings` and `PATCH /api/users/me/settings` read/write `User.settingsJson`. Zod schema enforces allowed keys (theme, proseFont, proseSize, lineHeight, writing toggles, daily goal, chat model + params, `ai.includeVeniceSystemPrompt` boolean defaulting to `true`).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/user-settings.test.ts`

- [x] **[B12]** `POST /api/auth/sign-out-everywhere` — authenticated endpoint that deletes every refresh token belonging to the caller, closes their in-memory sessions, and clears the caller's refresh cookie. 204 on success. Idempotent at the DB level. Rate-limited via the same `SENSITIVE_AUTH_LIMIT_OPTIONS` bucket as change-password / rotate-recovery-code. Used by `[F61]` Account & Privacy panel.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/sign-out-everywhere.test.ts`

### B — Post-B-series follow-ups (work next, before F)

Surfaced by the final cross-cutting review of the B-series branch + the V22 Venice-API audit. V-series contract gaps, Venice-API drift fixes, and one deferred schema fix. Work these before starting F so the frontend codes against a settled contract.

- [x] **[V19]** Wrap `POST /api/chapters/:chapterId/chats` response body in `{ chat }` envelope to match `docs/api-contract.md:156`. Currently returns the bare `chat` object at the top level. Update `backend/src/routes/chat.routes.ts` and any test assertions in `backend/tests/ai/chat-persistence.test.ts` that relied on the flat shape.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V20]** Add `.strict()` to `CreateChatBody`, `PostMessageBody`, and the nested `attachment` sub-schema in `backend/src/routes/chat.routes.ts` so stray / misspelled keys return 400 instead of being silently dropped. Mirror the B-series precedent (`validation_error` envelope via `backend/src/lib/bad-request.ts`). Add tests for unknown-key rejection on both endpoints.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V21]** Implement `GET /api/chats/:chatId/messages` returning `{ messages: [{ id, role, contentJson, attachmentJson, model, tokens, latencyMs, createdAt }] }` per `docs/api-contract.md:161`. Route goes under `createChatMessagesRouter()` (`backend/src/routes/chat.routes.ts`), ordered by `createdAt asc`. Reuse `createMessageRepo(req).findManyForChat(chatId)` (ownership enforced by the repo). Required by the frontend chat panel to hydrate history on mount.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chat-messages-list.test.ts`

- [x] **[V22]** Code review of the Venice integration as implemented (V1–V21) against the **actual** Venice.ai API reference. Fetch the current Venice docs (Context7 preferred: resolve library id for `venice.ai` / `venice-ai`; web fallback: `https://docs.venice.ai/api-reference`) and compare against: `backend/src/services/venice.client.ts` (per-user OpenAI-compatible client construction, `[V17]`), `backend/src/services/prompt.service.ts` (prompt builder, dynamic context budget, `venice_parameters` passthrough), `backend/src/services/ai.service.ts` (streaming, reasoning strip, web search, prompt cache key), `backend/src/routes/ai.routes.ts` + `backend/src/routes/chat.routes.ts` (SSE shape, error mapping — `NoVeniceKeyError` → 409 `venice_key_required`, upstream auth → 401, rate limit → 429), and `backend/src/routes/venice-key.routes.ts` (`PUT`/`GET`/`DELETE` + `[V18]` verify). Confirm: (1) endpoint base URL + path for chat completions matches current Venice docs; (2) `venice_parameters` field names match exactly (`include_venice_system_prompt`, `strip_thinking_response`, `enable_web_search`, `enable_web_citations`, `prompt_cache_key`); (3) SSE `data: [DONE]` terminator + delta shape matches; (4) reasoning model handling is correct for the models Venice currently documents; (5) web-search citations are extracted from the Venice response shape Venice actually returns today; (6) model-listing endpoint (if used) still returns `context_length` under the same field name. Produce a written gap list — any mismatch becomes a follow-up task `[V23+]`. Do NOT fix gaps in this task; this is review-only. Output goes to `docs/venice-integration.md` under a new "### 2026-04 Venice API audit" section. If Context7 has no Venice entry, fall back to `WebFetch` against `https://docs.venice.ai/api-reference/api-spec` and `https://docs.venice.ai/welcome/guides/venice-parameters`.
  - verify: `test -s docs/venice-integration.md && grep -q '2026-04 Venice API audit' docs/venice-integration.md`

- [x] **[V23]** Move `prompt_cache_key` out of `venice_parameters` and onto the top-level chat-completion body. V22 audit flagged that Venice documents `prompt_cache_key` as a top-level field alongside `model` / `messages` / `stream`, not nested under `venice_parameters`; burying it in the nested object means Venice silently ignores the key and we pay cold-prompt cost on every call. Touch `backend/src/routes/ai.routes.ts` (~line 204) and `backend/src/routes/chat.routes.ts` (~line 333 — the `chatPromptCacheKey` call site) to spread the key at the top level of the `create()` args instead. Keep the computation helper (`chatPromptCacheKey` / the storyId+modelId sha256 helper in ai.routes) unchanged — this is a positioning fix only. Extend one test in each of `tests/ai/prompt-cache.test.ts` + `tests/ai/chat-persistence.test.ts` to assert the Venice-client mock receives `prompt_cache_key` at the top level and NOT inside `venice_parameters`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/prompt-cache.test.ts tests/ai/chat-persistence.test.ts`

- [x] **[V24]** Map Venice 402 `INSUFFICIENT_BALANCE` to a dedicated application error instead of the current generic 502 `venice_unavailable`. Update `backend/src/lib/venice-errors.ts`: add a 402 branch to `mapVeniceError` + `mapVeniceErrorToSse` emitting `{ error: { code: 'venice_insufficient_balance', message: '…', retryAfter: null } }` with HTTP 402 (JSON path) or an equivalent SSE frame followed by `[DONE]`. Add a hint URL `https://venice.ai/settings/api` in the message so the frontend can render a "Top up credits" CTA. Tests: add a unit test to `tests/lib/venice-errors.test.ts` (or the nearest equivalent) with a faked `APIError` whose `status === 402` and body code `'INSUFFICIENT_BALANCE'`. Do NOT leak the decrypted Venice key in the error envelope.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-errors.test.ts`

- [x] **[V25]** Rename `max_tokens` → `max_completion_tokens` across the prompt builder output and the two `chat.completions.create` call sites (`ai.routes.ts`, `chat.routes.ts`). Venice's current chat-completions spec flags `max_tokens` as deprecated in favor of `max_completion_tokens` (same semantics). Low-risk rename — the field is still accepted — but getting ahead of the deprecation avoids a silent behavioral change when Venice eventually drops the alias. Update `backend/src/services/prompt.service.ts` return shape (the field name in `BuildPromptResult`) plus both callers. Update any tests that read `max_tokens` off the builder output or off the mocked Venice call args.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/ai/chat-persistence.test.ts`

- [x] **[V26]** Chat panel web-search citations — backend delivery, parsing, and persistence. Full design + rationale in [`docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md`](docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md); follow the spec exactly. Summary: (1) Extend `PostMessageBody` in `backend/src/routes/chat.routes.ts` with optional `enableWebSearch?: boolean` (default `false`, `.strict()` stays); when `true` the handler sets `venice_parameters.enable_web_search = 'auto'`, `enable_web_citations = true`, `include_search_results_in_stream = true` before starting the stream. (2) New helper `backend/src/lib/venice-citations.ts` exporting `Citation = { title: string, url: string, snippet: string, publishedAt: string | null }` + `projectVeniceCitations(raw)` — maps Venice's `{ title, url, content, date }` shape → ours, drops items missing title/url, caps at 10. (3) In the chat POST stream loop, detect the Venice-only `venice_search_results` chunk property, project it, emit ONE SSE frame `event: citations\ndata: {"citations":[...]}\n\n` before the first content `data:`, consume (do NOT forward) that chunk; skip the frame when projection yields empty. (4) Add encrypted narrative triple `citationsJsonCiphertext / citationsJsonIv / citationsJsonAuthTag` (all `String?`) to `Message` in `backend/prisma/schema.prisma`; regenerate migration via `prisma migrate dev --name add_message_citations` — schema DDL only, no backfill. (5) Extend `backend/src/repos/message.repo.ts`: add `'citationsJson'` to `ENCRYPTED_FIELDS`, extend `MessageCreateInput`, write via `writeCiphertextOnly`. (6) In the V21 `GET /` handler projection, add `citationsJson: m.citationsJson ?? null`. (7) Update `docs/api-contract.md` § Chats (`enableWebSearch?` body field + Citation type + citations SSE frame), `docs/venice-integration.md` (new § Citations + update V22 Gap-list entry for V26 to point at this spec), `docs/data-model.md` § Message (+ citationsJson column). Null-vs-empty: null means "no search / no results"; never store `[]`. No ciphertext or Venice key leaks in logs or responses. Frontend rendering is `[F50]`; inline-AI web-search reconsideration is `[X11]`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-citations.test.ts tests/routes/chat-messages-list.test.ts tests/ai/chat-persistence.test.ts tests/security/encryption-leak.test.ts`

- [x] **[V27]** Extend `parseRetryAfter` in `backend/src/lib/venice-errors.ts:27–45` to fall back to the `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` headers when the standard `Retry-After` header is absent. V22 audit flagged this as uncertain — Venice may populate only the reset-* headers on chat-completion 429s. Use whichever `reset-*` value is smaller (soonest) as the retry hint. Add unit coverage in `tests/lib/venice-errors.test.ts` for: (a) only `Retry-After` set, (b) only `x-ratelimit-reset-tokens` set, (c) both set — soonest wins, (d) neither set → returns `null`. If feasible, add an opt-in L-series probe under `backend/tests/live/` that hammers a low-cap endpoint to confirm which header(s) Venice actually sends today; gate it behind the existing `npm run test:live` entrypoint.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-errors.test.ts`

- [x] **[V28]** (low priority) Forward `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens` alongside the `remaining-*` headers we already forward in `ai.routes.ts` (SSE response headers before first flush) and `chat.routes.ts`. Prefix with `x-venice-` to stay consistent with the existing `x-venice-remaining-*` naming. Rationale: the frontend can then compute "X / Y remaining until HH:MM" without a second round-trip. Extend the streaming tests to assert the additional headers are copied through when present on the upstream response.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/rate-limit-headers.test.ts tests/ai/chat-rate-limit-headers.test.ts`

- [x] **[D17]** Investigate and, if confirmed needed, add `@@unique([storyId, orderIndex])` to `Chapter` and `@@unique([storyId, order])` to `OutlineItem` in `backend/prisma/schema.prisma`. Background: B3/B4/B8 left `TODO(B4)` / `TODO(schema)` markers in the chapter + outline repos because the `aggregate(_max) → insert` auto-assign pattern in their POST handlers is racy — concurrent POSTs to the same story can produce duplicate `orderIndex` / `order` rows with no DB-level guard. Breaking schema changes are acceptable (there is no deployed data to migrate per CLAUDE.md's "migration handling is deferred" rule). After adding the constraint, update the POST handlers to catch Prisma `P2002` (unique violation) and retry the aggregate, and extend the reorder transaction to use a two-phase swap (negative temp values → final) to avoid unique-constraint violations mid-transaction. Remove the two TODO markers. If the investigation concludes the constraint is not worth the complexity cost, document the rationale in `docs/data-model.md` and remove the TODOs.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts tests/routes/chapters-reorder.test.ts tests/routes/outline.test.ts`

---
