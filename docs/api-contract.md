# API Contract

All endpoints are served from the Express backend at `/api`. Content type is `application/json` unless noted (SSE streams use `text/event-stream`). Timestamps are ISO-8601 UTC. IDs are CUIDs (except `Session.id`, which is an opaque hex session id — not exposed here).

---

## Conventions

- **Auth** — unless marked "Public", every endpoint requires the auth middleware and is scoped to `req.user.id`. Protected endpoints expect `Authorization: Bearer <JWT>`. The refresh-token cookie (`refreshToken`, `HttpOnly; SameSite=Lax; Path=/api/auth; Secure` in prod, `Max-Age` = 7 days) is read only by the `/api/auth/*` routes.
- **Ownership** — every route referencing a `:storyId`, `:chapterId`, `:characterId`, `:outlineItemId`, `:chatId`, or `:messageId` passes through the ownership middleware. Unknown id and id-owned-by-another-user both collapse to `403 { error: { message, code: "forbidden" } }` (no enumeration oracle). A nested resource owned by the caller but under a different `:storyId` than the URL returns `404 { error: { code: "not_found" } }`.
- **Validation** — request bodies are Zod-validated; invalid payloads return `400 { error: { message, code: "validation_error", issues } }` (`issues` is a `{ path, message }[]`).
- **Errors** — the global handler returns `{ error: { message, code } }`, with `err.stack` included only when `NODE_ENV !== 'production'`. Common non-Venice codes: `unauthorized`, `session_expired`, `invalid_credentials`, `invalid_refresh`, `username_unavailable`, `forbidden`, `not_found`, `validation_error`, `account_rate_limited`, `internal_error`. **Venice-specific codes are catalogued in [venice-integration.md](./venice-integration.md#error-catalog).**
- **Narrative fields** — responses for Story, Chapter, Character, OutlineItem, Chat, Message never include ciphertext columns (`*Ciphertext`/`*Iv`/`*AuthTag`). The repo decrypts and the `serialize*` layer builds the wire shape (also dropping `userId`/`chatId` and converting timestamps to ISO).
- **Secrets** — `passwordHash` and the `User` at-rest secret columns (DEK wraps, `veniceApiKeyEnc`) are never returned. The decrypted Venice key is never returned — `{ hasKey, lastSix, endpoint }` is the only read surface.

---

## Auth — `/api/auth`

### `POST /register` — Public
Body: `{ "username", "password", "name?" }` (`username` lowercased, 3–32 chars, `/^[a-z0-9_-]+$/`).
Response `201`: `{ "user": { "id", "username", "name", … }, "recoveryCode": "XXXX-XXXX-XXXX-XXXX" }`.
**Registration does not auto-login** — no cookie is set and no access token is returned; the one-time `recoveryCode` is shown once and the client then calls `/login`.
Errors: `409 { code: "username_unavailable" }` (timing-equalised), `400 validation_error`.

### `POST /login` — Public
Body: `{ "username", "password" }`.
Response `200`: `{ "user", "accessToken", "accessTokenExpiresAt" }` + sets the refresh cookie.
Errors: `401 { code: "invalid_credentials" }` — identical body + timing for unknown-user vs wrong-password.

### `POST /refresh` — Public (reads cookie)
Rotates the refresh token in a single transaction. Response `200`: `{ "user", "accessToken", "accessTokenExpiresAt" }` + a new refresh cookie.
Errors: `401 { code: "invalid_refresh" }` (clears the cookie).

### `POST /logout` — reads cookie
Deletes the presented refresh-token row and clears the cookie. Response `204`.

### `POST /reset-password` — Public (rate-limited per-IP + per-username)
Body: `{ "username", "recoveryCode", "newPassword" }`. Resets the password using the recovery code (the only path that can re-wrap the DEK without the old password).
Response `204`. Errors: `401 { code: "invalid_credentials" }` (masks unknown-user vs wrong-code).

### `POST /change-password` — auth (rate-limited)
Body: `{ "oldPassword", "newPassword" }`. Re-wraps the password copy of the DEK; narrative ciphertext is untouched. Outstanding refresh tokens are invalidated server-side. Response `204`.

### `POST /update-profile` — auth (rate-limited)
Body: `{ "name" }`. Response `200`: `{ "user" }` (same shape as `GET /me`).

### `POST /rotate-recovery-code` — auth (rate-limited)
Body: `{ "password" }`. Re-wraps the recovery copy of the DEK under a fresh code.
Response `200`: `{ "recoveryCode", "warning": "Save this recovery code now — it will not be shown again." }`.

### `POST /sign-out-everywhere` — auth (rate-limited)
Revokes all of the user's sessions/refresh tokens. Response `204` + clears the cookie.

### `DELETE /delete-account` — auth (rate-limited)
Body: `{ "password" }`. Cascades all user-owned data. Response `204` + clears the cookie.

### `GET /me` — auth
Response `200`: `{ "user": { "id", "email", "username", "name", "createdAt", "updatedAt" } }`.

---

## User — `/api/users/me`

### `GET /settings` · `PATCH /settings`
Read/write `User.settingsJson` (PATCH is a partial, `.strict()`-validated). Top-level groups:
- `theme` — `'paper' | 'sepia' | 'dark'`.
- `prose` — `{ font, size, lineHeight }`.
- `writing` — `{ spellcheck, typewriterMode, focusMode, dailyWordGoal, smartQuotes, emDashExpansion }`.
- `chat` — `{ model, overrides }`, where `overrides` is keyed by model id → `{ temperature, topP, maxTokens, reasoning }` (the `reasoning: false` per-model toggle disables reasoning on reasoning-capable models).
- `ai` — `{ includeVeniceSystemPrompt }` (boolean, default `true` when absent — drives `venice_parameters.include_venice_system_prompt`).
- `prompts` — user-level prompt overrides (below).

The `prompts` slice has **nine** `string | null` keys; `null` means use the built-in default:
```json
"prompts": {
  "system": "string | null", "continue": "string | null", "rewrite": "string | null",
  "expand": "string | null", "summarise": "string | null", "summariseChapter": "string | null",
  "describe": "string | null", "scene": "string | null", "ask": "string | null"
}
```
Defaults are exposed read-only via `GET /api/ai/default-prompts`. Response `200`: `{ "settings": { … } }`.

### `GET /venice-key`
Response `200`: `{ "hasKey", "lastSix", "endpoint" }`. Never returns the key.

### `PUT /venice-key`
Body: `{ "apiKey", "endpoint?" }`. Validates against Venice (`GET /v1/models`) before storing; encrypts at rest.
Response `200`: `{ "status": "saved", "lastSix", "endpoint" }`.
Errors: `400 { code: "venice_key_invalid" }` (Venice rejected the key), `502 { code: "venice_unreachable" }`, `400 validation_error`.

### `DELETE /venice-key`
Nulls the BYOK columns. Response `200`: `{ "status": "removed" }`.

### `GET /venice-account` — rate-limited 30 req/min/user
Probes Venice `GET /api_keys/rate_limits` and reads `data.balances.{USD,DIEM}`.
Response `200`: `{ "verified", "balanceUsd", "diem", "endpoint", "lastSix" }`. `balanceUsd`/`diem` may be `null`; `verified: false` (still 200) when no key is stored or the key was rejected.
Errors: `429 { code: "account_rate_limited" }` (our per-user limit), `429 { code: "venice_rate_limited", retryAfterSeconds, upstreamStatus }` (Venice), `502 { code: "venice_unavailable", upstreamStatus }`.

---

## Stories — `/api/stories`

### `GET /api/stories`
Response `200`: `{ "stories": [ … ] }`, each item = `{ "id", "title", "synopsis", "genre", "worldNotes", "targetWords", "includePreviousChaptersInPrompt", "createdAt", "updatedAt", "chapterCount", "totalWordCount" }`. The two aggregates are computed in one chapter `groupBy`, not stored.

### `POST /api/stories`
Body: `{ "title", "synopsis?", "genre?", "worldNotes?", "targetWords?", "includePreviousChaptersInPrompt?" }`. Response `201`: `{ "story" }`.

### `GET /api/stories/:id`
Response `200`: `{ "story" }` — the flat record (the list-item fields minus the aggregates). Chapters/characters/outline are fetched via their own endpoints.

### `PATCH /api/stories/:id`
Body: any subset of the create shape. Response `200`: `{ "story" }`.

### `DELETE /api/stories/:id`
Cascades chapters / characters / outline / chats / messages. Response `204`.

---

## Chapters — `/api/stories/:storyId/chapters`

### `GET /`
Response `200`: `{ "chapters": [ … ] }` — **metadata only**, sorted by `orderIndex`: `{ "id", "storyId", "title", "wordCount", "orderIndex", "status", "createdAt", "updatedAt", "hasSummary", "summaryIsStale" }`. `bodyJson` is omitted here; use the single-chapter GET.

### `POST /`
Body: `{ "title", "bodyJson?", "status?" }`. Backend assigns `orderIndex` and computes `wordCount` from `bodyJson` before encryption. Response `201`: `{ "chapter" }`.

### `GET /:chapterId`
Response `200`: `{ "chapter": { "id", "storyId", "title", "bodyJson", "wordCount", "orderIndex", "status", "createdAt", "updatedAt", "hasSummary", "summaryIsStale", "summary", "summaryUpdatedAt" } }`. `bodyJson` is the decrypted TipTap tree; `summary` is the structured summary (or `null`).

### `PATCH /:chapterId`
Body: any subset of `{ "title", "bodyJson", "status", "orderIndex" }`. If `bodyJson` is sent, `wordCount` is recomputed from it. Response `200`: `{ "chapter" }`.

### `DELETE /:chapterId`
Response `204` (remaining chapters are re-packed to sequential `orderIndex`).

### `PATCH /reorder`
Body: `{ "chapters": [{ "id", "orderIndex" }] }` (two-phase swap in one transaction). Response `204`; the client re-fetches the list.

### `PUT /:chapterId/summary`
Upsert a chapter summary directly (structured object). Response `200`: `{ "summary", "summaryUpdatedAt" }`.

### `POST /:chapterId/summarise` — non-streaming
Body: `{ "modelId" }`. Calls Venice with **structured output** (`response_format: json_schema`) and returns JSON (not SSE).
Response `200`: `{ "summary", "summaryUpdatedAt" }`.
Errors: `400 { code: "empty_chapter" }`, `400 { code: "model_unsupported_for_summarisation" }`, `502 { code: "summary_parse_failed" }`, plus the Venice error catalog.

---

## Characters — `/api/stories/:storyId/characters`

### `GET /`
Response `200`: `{ "characters": [ … ] }`, each = `{ "id", "storyId", "name", "role", "age", "appearance", "personality", "voice", "backstory", "arc", "relationships", "orderIndex", "color", "initial", "createdAt", "updatedAt" }`.

### `POST /`
Body: required `name` + any of `role, age, appearance, personality, voice, backstory, arc, relationships, color, initial`. Response `201`: `{ "character" }`.

### `GET | PATCH | DELETE /:characterId`
Standard CRUD (`PATCH` body is a partial of the create shape). Response `200` / `204`.

---

## Outline — `/api/stories/:storyId/outline`

### `GET /`
Response `200`: `{ "outline": [ … ] }`, each = `{ "id", "storyId", "title", "sub", "status", "order", "createdAt", "updatedAt" }`.

### `POST /`
Body: `{ "title", "sub?", "status" }` (`status` is a free-form 1–40 char string — `"queued"`/`"active"`/`"done"` by convention, no server enum). Backend assigns `order`. Response `201`: `{ "outlineItem" }`.

### `PATCH | DELETE /:outlineItemId`
`PATCH` body: any subset of `{ "title", "sub", "status", "order" }`. Response `200`: `{ "outlineItem" }` / `204`.

### `PATCH /reorder`
Body: `{ "items": [{ "id", "order" }] }` (one transaction). Response `204`; the client re-fetches.

---

## Chats & Messages

### `POST /api/chapters/:chapterId/chats`
Body: `{ "title?", "kind?" }` (`kind` = `'ask' | 'scene'`, default `'ask'`). Response `201`: `{ "chat": { "id", "chapterId", "title", "kind", "createdAt", "updatedAt", "lastActivityAt" } }`.

### `GET /api/chapters/:chapterId/chats`
Query: `?kind=ask|scene` (optional filter). Response `200`: `{ "chats": [ … ] }`, each = the chat fields above + `"messageCount"`.

### `PATCH /api/chats/:chatId`
Body: `{ "title" }` (rename). Response `200`: `{ "chat" }`.

### `DELETE /api/chats/:chatId`
Response `204` (cascades messages).

### `GET /api/chats/:chatId/messages`
Response `200`: `{ "messages": [ … ] }`, each = `{ "id", "role", "content", "attachmentJson", "citationsJson", "model", "tokens", "latencyMs", "createdAt", "updatedAt" }`. `content` is plaintext (decrypted); `updatedAt` is `null` unless the message was edited; `citationsJson` is `Citation[] | null`.

```ts
interface Citation { title: string; url: string; snippet: string; publishedAt: string | null }
```

### `POST /api/chats/:chatId/messages` — SSE stream
Body is one of three modes:
- **new**: `{ "content", "modelId", "enableWebSearch?", "attachment?": { "selectionText", "chapterId" } }`
- **retry**: `{ "retry": true, "modelId" }` (regenerate from the last user turn)
- **resend**: `{ "fromMessageId", "modelId" }` (regenerate from a specific user turn)

`enableWebSearch: true` sets the three Venice web-search params for the turn; when results come back, the stream opens with one `event: citations\ndata: {"citations":[…]}\n\n` frame before the content frames, then `data: [DONE]`. Forwards the `x-venice-remaining/limit/reset-{requests,tokens}` headers. Persists the user message, streams the assistant tokens, then persists the assistant message with `tokens`/`latencyMs`/`citationsJson`.
Errors (pre-stream JSON): `404 not_found`, `400 attachment_chapter_mismatch`, `400 retry_invalid_state`, `400 resend_invalid_state`, `409 venice_key_required`. Mid-stream failures are written as a terminal SSE frame (`mapVeniceErrorToSse`, fallback `code: "stream_error"`).

### `PATCH /api/chats/:chatId/messages/:id`
Edit a **user** message in place. Body: `{ "content" }`. Response `200`: `{ "message" }` with `updatedAt` now set. Error: `404 not_found` (missing / not owned / not a user message).

---

## AI — `/api/ai`

### `GET /models`
Response `200`: `{ "models": [ … ] }`, each = `{ "id", "name", "contextLength", "maxCompletionTokens", "supportsReasoning", "supportsVision", "supportsWebSearch", "supportsResponseSchema", "description", "pricing", "defaultTemperature", "defaultTopP" }`. `maxCompletionTokens` is the per-model output cap (the budgeting layer reads it); `supportsResponseSchema` gates structured output (chapter summarisation — see `model_unsupported_for_summarisation`); `description` is `string | null`; `defaultTemperature` / `defaultTopP` are `number | null` (the param resolver's fallback). `pricing` is atomic — `{ "inputUsdPerMTok", "outputUsdPerMTok" }` (USD per 1M tokens) or `null`; never partial. The full `ModelInfo` ships unprojected. Cached 10 min in memory.

### `GET /default-prompts` — auth
Response `200`: `{ "defaults": { … } }` — the nine default templates (`system`, `continue`, `rewrite`, `expand`, `summarise`, `summariseChapter`, `describe`, `scene`, `ask`) the builder falls back to. Changes only on deploy; the frontend caches with `staleTime: Infinity`.

### `POST /complete` — SSE stream
Body: `{ "action", "selectedText", "chapterId", "storyId", "modelId" }`, where `action` ∈ `continue | rephrase | expand | summarise | rewrite | describe`. `selectedText` and `chapterId` are required.
**Web search is not accepted here** — the schema omits `enableWebSearch`; web search is chat-only (citations have no inline UI). The route loads story/chapter/characters via the repo (decrypted), calls the prompt builder, and streams Venice tokens back as SSE (`data: <chunk>` … `data: [DONE]`). Sets `include_venice_system_prompt` from the user setting and `strip_thinking_response` / `prompt_cache_key` (top-level) as applicable; never sets the web-search params.
Response headers: `x-venice-remaining/limit/reset-{requests,tokens}`.
Errors: `409 venice_key_required`, `429 venice_rate_limited` (`retryAfterSeconds`), `402 venice_insufficient_balance`, `400 venice_key_invalid`, `502 venice_unavailable`.

---

## Health — `/api/health` — Public
Response `200`: `{ "status": "ok", "db": "connected" }`; `503 { "status": "degraded", "db": "unreachable" }` when Postgres is unreachable. Shape is intentionally outside the `{ error: {…} }` envelope.

---

## Rate Limits

- `/api/ai/*`: 20 req/min/IP.
- `/api/users/me/venice-account`: 30 req/min/user.
- Sensitive auth routes (`change-password`, `update-profile`, `rotate-recovery-code`, `sign-out-everywhere`, `delete-account`, `reset-password`) carry their own per-route limiters.
