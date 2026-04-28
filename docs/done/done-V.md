> Source of truth: `TASKS.md`. Closed [V]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🤖 V — Venice.ai Integration

> Venice is OpenAI API-compatible. Use the `openai` npm package with Venice's base URL. Venice-specific features are passed via the `venice_parameters` object.

- [x] **[V1]** `GET /api/ai/models` — calls Venice `GET /v1/models`, filters to text models only, returns each model's `id`, `name`, `context_length`, and capability flags (`supportsReasoning`, `supportsVision`). Cache result in memory for 10 minutes.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/models.test.ts`

- [x] **[V2]** `backend/src/services/venice.models.service.ts` — fetches and caches model list. Exposes `getModelContextLength(modelId): number`. Used by the prompt builder to set dynamic context budgets. No token counts are hardcoded anywhere in the codebase.
  - verify: `cd backend && npm run test:backend -- --run tests/services/venice.models.service.test.ts`

- [x] **[V3]** `backend/src/services/prompt.service.ts` — builds prompts given: `action`, `selectedText`, `chapterContent`, `characters[]`, `worldNotes`, `modelContextLength`. Budget: reserve 20% of `modelContextLength` for the response. Use the remainder for prompt content. If budget exceeded, truncate `chapterContent` from the top (oldest content first). Never truncate character context or worldNotes.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts`

- [x] **[V4]** Prompt builder sets `venice_parameters.include_venice_system_prompt` from a caller-supplied `includeVeniceSystemPrompt` boolean. When the flag is `true`, Venice's own creative-writing prompt is prepended; when `false`, only Inkwell's system message (default or per-story `Story.systemPrompt`) is in effect. Default when omitted is `true`. Unit test covers all three branches: explicit `true` → flag is `true`; explicit `false` → flag is `false`; omitted → flag is `true`. The flag value is never hardcoded inside the prompt builder.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.venice-params.test.ts`

- [x] **[V5]** `POST /api/ai/complete` — accepts `{ action, selectedText, chapterId, storyId, modelId }` (plus optional `freeformInstruction`). Loads the chapter body + story characters + `worldNotes` server-side via the repo layer (decrypted on read) — the client never sends plaintext chapter content. Reads `req.user.settingsJson.ai.includeVeniceSystemPrompt` (default `true` if the key is missing) and passes it to the prompt builder. Calls prompt builder with model context length from cache. Calls Venice with `stream: true`. Pipes SSE stream back to client. 404 when chapter or story isn't owned by the caller; 409 `venice_key_required` when no BYOK key is stored.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/complete.test.ts`

- [x] **[V6]** Reasoning model support: if selected model has `supportsReasoning: true`, set `venice_parameters.strip_thinking_response = true` in the Venice request. Test confirms this is applied to reasoning models and not others.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/reasoning.test.ts`

- [x] **[V7]** Web search: add optional `enableWebSearch` boolean to `POST /api/ai/complete`. When true, set `venice_parameters.enable_web_search = "auto"` and `venice_parameters.enable_web_citations = true`. Useful for users researching facts for their story world.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/web-search.test.ts`

- [x] **[V8]** Prompt caching: set `venice_parameters.prompt_cache_key` to a deterministic hash of `storyId + modelId` on all `/api/ai/complete` requests. This improves cache hit rates by routing requests with the same story context to the same Venice backend infrastructure. Document in `docs/venice-integration.md`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/prompt-cache.test.ts`

- [x] **[V9]** Rate limit header forwarding: after each Venice call, read `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` from Venice response headers. Attach as `x-venice-remaining-requests` and `x-venice-remaining-tokens` on the backend response so the frontend can display usage.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/rate-limit-headers.test.ts`

- [x] **[V10]** `GET /api/ai/balance` (auth required) — reads `x-venice-balance-usd` and `x-venice-balance-diem` from a lightweight Venice API call and returns them. Frontend shows this in the user menu.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/balance.test.ts`

- [x] **[V11]** Venice error handling: map error codes to user-friendly messages. Handle `401` (invalid API key — log server-side, show generic error to user), `429` (rate limited — include reset time in response), `503` (Venice unavailable). Never expose raw Venice errors or stack traces to the frontend.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/error-handling.test.ts`

- [x] **[V12]** AI action system prompts — write and test the system prompt and user prompt template for each action. Each instructs the model to act as a creative writing assistant and return only the content with no preamble:
  - **Continue** — continues from where the selection ends, matching the established style
  - **Rephrase** — rewrites the selected text with different phrasing, preserving meaning
  - **Expand** — adds more detail, description, and depth to the selected passage
  - **Summarise** — condenses the selected text to its essential points
  - **Freeform** — passes the user's custom instruction as the direct prompt
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.actions.test.ts`

### V — Mockup-driven additions

- [x] **[V13]** Per-story system prompt in prompt builder: when `Story.systemPrompt` is non-null, use it as the primary system message; otherwise fall back to the default creative-writing system prompt. Unit tests cover both paths and confirm the Venice `include_venice_system_prompt` flag is driven entirely by the user setting — unaffected by whether `Story.systemPrompt` is set or null.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.system-prompt.test.ts`

- [x] **[V14]** Extend AI action set to cover mockup selection-bubble + chat actions: `rewrite`, `describe`, `expand` (inline result card), `continue` (cursor-context ~80-word continuation for ⌥↵), `ask` (routes selection into chat as attachment). Each has a dedicated prompt template. Complements [V12] — do not remove existing actions.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.mockup-actions.test.ts`

- [x] **[V15]** Chat persistence: `POST /api/chapters/:chapterId/chats` creates a chat; `GET /api/chapters/:chapterId/chats` lists; `POST /api/chats/:chatId/messages` appends a user message, streams an assistant reply via Venice (SSE passthrough), persists both messages with `tokens` + `latencyMs` captured from the Venice response.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V16]** Ask-AI attachment payload: `POST /api/chats/:chatId/messages` accepts optional `{ attachment: { selectionText, chapterId } }`. Stored as `attachmentJson` on the user message. Prompt builder prepends attachment text as additional user-role context when present.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/ask-ai-attachment.test.ts`

- [x] **[V17]** Per-user Venice client (supersedes the singleton in [A4]): `getVeniceClient(userId)` reads the user's encrypted key + endpoint, decrypts via [AU11], constructs a per-call `OpenAI` instance bound to that key + endpoint. Never cached across users. If the user has no stored key, throws `NoVeniceKeyError` (mapped to 409 `{ error: "venice_key_required" }` with a hint pointing at `/settings#venice`). Replaces all call sites across [V1]–[V12], [V15].
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-per-user.test.ts`

- [x] **[V18]** `POST /api/users/me/venice-key/verify` — re-validates the stored key by calling Venice (`GET /v1/models` + balance headers). Returns `{ verified: boolean, credits: number | null, diem: number | null, endpoint: string | null, lastFour: string | null }`. Frontend's Settings → Venice "Verified · 2.2k credits" pill reads this. Rate-limited per user (6 req/min) to avoid Venice abuse.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/venice-key-verify.test.ts`

---
