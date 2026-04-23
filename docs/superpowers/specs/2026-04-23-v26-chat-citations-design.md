# V26 — Chat web-search citations

**Status:** approved 2026-04-23
**Scope:** backend only (`POST /api/chats/:chatId/messages` SSE + `GET /api/chats/:chatId/messages` + `Message` schema)
**Predecessors:** V7 (web search opt-in), V15 (chat persistence), V17 (per-user Venice client), V22 (Venice API audit — found this gap)
**Frontend rendering:** separate task (queued as `[F50]`), not part of V26
**Deferred decision:** whether `/api/ai/complete` should keep `enable_web_search` at all (queued as `[X11]`)

---

## Problem

V7 shipped web-search opt-in for Venice by setting `venice_parameters.enable_web_search: 'auto'` + `enable_web_citations: true`. V22's Venice API audit flagged that we never parse citations back out of the response — they surface only as inline text that the model may or may not embed. The chat panel has no way to render a sources tray, and assistant turns lose their provenance on reload.

## Non-goals

- Inline AI (`/api/ai/complete`) citation rendering. That surface has no designed sources UI and lives in the selection-bubble flow, not a persistent conversation.
- Citation hover-cards / footnote markers inlined in assistant prose. Venice's inline `[1]` markers are unreliable.
- Aggregated "Sources" tab across an entire chat.
- Backfilling citations for messages that pre-date V26. Pre-deployment; no data to backfill.

## Design

### 1. Delivery mode + chat web-search toggle

Chat POST currently has no web-search path at all; `/api/ai/complete` is the only surface that wires `enable_web_search`. V26 adds the toggle to chat so the citations plumbing in §2–§6 is actually reachable.

**Request body:** extend `PostMessageBody` in `backend/src/routes/chat.routes.ts` with an optional `enableWebSearch?: boolean` field. `.strict()` already applies from V20 — unknown-key rejection stays. Default `false` when omitted.

**Venice params:** when `enableWebSearch === true`, the handler adds three keys to `venice_parameters` before starting the stream (mirroring `/api/ai/complete` for the first two, and adding the third):
- `enable_web_search: 'auto'`
- `enable_web_citations: true`
- `include_search_results_in_stream: true`

Venice documents `include_search_results_in_stream` as emitting a **non-standard first chunk** carrying `venice_search_results`, followed by regular `choices[0].delta.content` chunks. When `enableWebSearch` is false/omitted, none of the three keys are set and the stream behaves exactly as today.

Rejected alternatives:
- `return_search_results_as_documents: true` (tool-call shape) — adds tool-declaration plumbing to every AI route; `include_search_results_in_stream` is strictly simpler for SSE passthrough.
- Shipping V26 as parse-only, toggle deferred to a separate task — the citations plumbing would be dead code until the toggle lands. No benefit to splitting.

### 2. Stream parsing

In `backend/src/routes/chat.routes.ts`, inside the `for await (const chunk of stream)` loop:

- Before the loop, track `citationsEmitted = false` and `capturedCitations: Citation[] | null = null`.
- On each chunk, check for a `venice_search_results` property (Venice-specific, not part of the OpenAI chunk shape).
- If present and `!citationsEmitted`:
  1. Project the raw Venice results → `Citation[]` via `projectVeniceCitations()` (new helper, see §4).
  2. Cap at 10 items (slice).
  3. If the projected list is non-empty, write **one** SSE frame `event: citations\ndata: ${JSON.stringify({citations})}\n\n` before any content frame, set `citationsEmitted = true`, store on `capturedCitations`.
  4. If the projected list is empty, set `citationsEmitted = true` anyway (so a later malformed duplicate chunk can't re-trigger) but do **not** emit a frame and leave `capturedCitations = null`.
  5. Do **not** forward the `venice_search_results` chunk verbatim. Consume it.
- For all other chunks, forward as today (`data: ${JSON.stringify(chunk)}\n\n`).

After the loop, when persisting the assistant message (existing `messageRepo.create` call), pass `citationsJson: capturedCitations ?? null`.

### 3. SSE wire format

```
<optional, when web search produced results>
event: citations
data: {"citations":[{"title":"...","url":"...","snippet":"...","publishedAt":"2025-..."|null}, ...]}

<content frames, verbatim from Venice>
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Thick fog..."}, ...}]}
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":" clings..."}, ...}]}
...

<terminator>
data: [DONE]
```

The `event: citations` frame is emitted **at most once** per turn, before the first content frame. If Venice returns no search results (or web search was off), the frame is skipped entirely and the consumer sees only content frames. Frontend treats "no citations event arrived" as "this turn has no sources."

### 4. Citation projection

New helper, located in `backend/src/lib/venice-citations.ts`:

```ts
export interface Citation {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export function projectVeniceCitations(raw: unknown): Citation[] {
  // Defensive: Venice field names may drift; validate each item.
  // Expected Venice shape per docs: { title, url, content, date }.
  // Map: content → snippet, date → publishedAt (null if missing/unparseable).
  // Drop items missing title or url. Cap output at 10.
}
```

Rationale for renames:
- `content` → `snippet`: avoids collision with the dropped `Chapter.content` plaintext mirror and makes "this is a short preview, not the full page" explicit.
- `date` → `publishedAt`: explicit about what the date means; `| null` type prevents frontend from assuming presence.

Items with missing `title` or `url` are dropped silently (not logged — input-adjacent data). Cap is hard 10; extras discarded silently.

### 5. Persistence

Add three columns to `Message` in `backend/prisma/schema.prisma`:

```prisma
citationsJsonCiphertext String?
citationsJsonIv         String?
citationsJsonAuthTag    String?
```

Regenerate migration DDL via `prisma migrate dev --name add_message_citations`. **Schema-only — no data migration, no dual-write, no backfill SQL.** Consistent with CLAUDE.md's "migration handling is deferred" rule: there are no existing rows to migrate.

In `backend/src/repos/message.repo.ts`:

- Add `'citationsJson'` to `ENCRYPTED_FIELDS` (becomes `['contentJson', 'attachmentJson', 'citationsJson']`).
- Extend `MessageCreateInput` with `citationsJson?: Citation[] | null`.
- In `create()`, add `...writeCiphertextOnly(req, 'citationsJson', serialiseJsonField(input.citationsJson ?? null))`.
- `shape()` already `JSON.parse`s every encrypted field on decrypt — no new branch needed.
- Null triple → `projectDecrypted` returns `null` → message has `citationsJson: null` in the response.

In `backend/src/routes/chat.routes.ts` `GET /` (V21 handler, ~line 158), add `citationsJson: m.citationsJson ?? null` to the projected field list.

### 6. Null vs empty semantics

- `citationsJson === null`: web search was off for this turn, OR was on but Venice returned no results. Frontend does not render a sources pill.
- `citationsJson === []`: explicitly not used. Projection either yields ≥1 valid citation and stores an array, or yields 0 and stores null.
- `citationsJson: [{...}]` (length 1–10): normal case; frontend renders the pill.

### 7. Contract docs

- **`docs/api-contract.md`** § Chats:
  - Under `POST /api/chats/:chatId/messages — SSE stream`, update the body schema to include `enableWebSearch?: boolean` (default `false`, gates Venice web search + citations for this turn).
  - Under the same endpoint, add a paragraph: "When the assistant turn is backed by web search and Venice returned results, the stream opens with a single `event: citations\ndata: {\"citations\":[...]}\n\n` frame before the first content frame. Absent otherwise."
  - Under `GET /api/chats/:chatId/messages`, update each message entry: `{ id, role, contentJson, attachmentJson, citationsJson, model, tokens, latencyMs, createdAt }` with `citationsJson: Citation[] | null`.
  - Add a new `Citation` type definition block near the Message shape.

- **`docs/venice-integration.md`** § Citations (new subsection, to be added between the existing web-search section and the error-handling section): explain delivery-mode choice (`include_search_results_in_stream: true`), projection map (`content → snippet`, `date → publishedAt`), 10-item cap, null-vs-empty rule, and where the projected shape lives (`backend/src/lib/venice-citations.ts`).

- **`docs/data-model.md`** § Message: add `citationsJson` encrypted field to the column table; note it's only populated on assistant turns where web search produced results.

- **Gap-list entry in `docs/venice-integration.md`**: update the V22-audit Gap-list item for `[V26]` to reflect the settled decision (link to this spec).

### 8. Tests

New file `backend/tests/ai/chat-citations.test.ts`. Mock Venice's SSE via the same fixture pattern used in `chat-persistence.test.ts` (ReadableStream of JSON-encoded chunks).

1. **Citations frame precedes content.** Request body sets `enableWebSearch: true`. Fixture: first chunk is `{ venice_search_results: [3 items] }`, then 2 content chunks, then terminator. Assert Venice was called with `venice_parameters.enable_web_search === 'auto'` and `include_search_results_in_stream === true`; assert the response body contains `event: citations\n` before any `data: {"id":"chatcmpl-...` line, and the `data:` on the citations frame decodes to the projected `{ citations: [{title,url,snippet,publishedAt}, ...] }` shape.
2. **Empty results → no citations frame.** Request body sets `enableWebSearch: true`. Fixture: first chunk is `{ venice_search_results: [] }`, then content. Assert the response body contains no `event: citations\n` occurrence and the assistant message row is persisted with `citationsJsonCiphertext === null`.
3. **Toggle off → web-search params absent, no citations frame.** Request body omits `enableWebSearch` (or sets it to `false`). Fixture: plain content chunks only. Assert Venice was called without any of `enable_web_search` / `enable_web_citations` / `include_search_results_in_stream`; assert the response body contains no `event: citations\n` occurrence; assert persisted `citationsJsonCiphertext === null`.
4. **Persisted citations round-trip.** After (1)'s stream completes, call `GET /api/chats/:chatId/messages`; assert the assistant message response has `citationsJson` matching the projected array exactly.
5. **Cap enforcement.** Fixture: `venice_search_results` with 15 items. Assert the emitted frame and persisted row contain exactly 10 items (the first 10 in Venice's order).
6. **Projection correctness.** Fixture item with `{ title, url, content: "x", date: "2025-01-02" }` → assert the emitted/persisted item has `snippet: "x", publishedAt: "2025-01-02"`, no `content`/`date` keys.
7. **Drops items missing title or url.** Fixture: 3 items, one missing `url`. Assert emitted/persisted length is 2.
8. **No ciphertext leak on list endpoint.** Response JSON must not carry any `*Ciphertext` / `*Iv` / `*AuthTag` keys (reuses the existing pattern).
9. **Leak test sentinel.** Embed a unique sentinel string in a citation `snippet`. Assert it does NOT appear in the raw `Message.citationsJsonCiphertext` column (SELECT via `prisma.$queryRaw`), and DOES appear in the decrypted response.

### 9. Error handling

- Venice disconnects before the search-results chunk arrives → no citations frame, `capturedCitations` stays `null`, persisted citations null. Stream-error handling is unchanged.
- Venice returns a malformed `venice_search_results` (not an array, or items aren't objects) → `projectVeniceCitations` returns `[]` which maps to null; no frame, no persistence. Log nothing.
- Persistence failure on the final `messageRepo.create` → existing `console.error` path catches it; no change.
- Request aborted mid-stream after citations emitted but before content done → existing abort handling ends the response; partial accumulated content is not persisted (unchanged); citations are not persisted in that branch either (persistence only runs on the `!clientClosed` path).

### 10. Security

- Citations can contain user-visible strings originating from third-party web pages. They go through the same AES-256-GCM wrap as other narrative content via the repo layer; same leak-test coverage.
- URLs are **not** sanitized server-side — the frontend MUST render them via `<a href={url} target="_blank" rel="noopener noreferrer">` and must not render `snippet` as HTML. That constraint belongs in the frontend task `[F50]`, not here.
- No Venice key in error envelopes. Existing `mapVeniceError` / `mapVeniceErrorToSse` are untouched.

## Files touched

**New:**
- `backend/src/lib/venice-citations.ts` (projector + `Citation` type)
- `backend/tests/ai/chat-citations.test.ts`
- `backend/prisma/migrations/NNN_add_message_citations/migration.sql` (generated)

**Modified:**
- `backend/prisma/schema.prisma` (+3 columns on `Message`)
- `backend/src/repos/message.repo.ts` (extend `ENCRYPTED_FIELDS`, `MessageCreateInput`, `create()`)
- `backend/src/routes/chat.routes.ts` (extend `PostMessageBody` with `enableWebSearch?: boolean`; conditionally set `enable_web_search`/`enable_web_citations`/`include_search_results_in_stream` on `venice_parameters`; stream parse for `venice_search_results`; SSE citations frame; `GET /` projection; pass `citationsJson` to `messageRepo.create`)
- `docs/api-contract.md` (Chats section: new `enableWebSearch?` body field + Citation type + citations SSE frame)
- `docs/venice-integration.md` (new § Citations, update V22 Gap list)
- `docs/data-model.md` (Message: + citationsJson column)

## Verify

```
cd backend && npm run test:backend -- --run tests/ai/chat-citations.test.ts tests/routes/chat-messages-list.test.ts tests/ai/chat-persistence.test.ts tests/encryption/leak.test.ts
```

All four suites must pass. The existing two (chat-persistence, chat-messages-list) guard against regressions in neighboring paths; the leak test guards the new encrypted column.

## Follow-up tasks (queued separately, NOT part of V26)

- **`[F50]`** — chat panel web-search toggle + `<MessageCitations />` component. Two pieces:
  1. Web-search checkbox in the chat composer (beneath the message input, next to the model picker). When toggled on, the next `POST /api/chats/:chatId/messages` includes `enableWebSearch: true`; UI hint ("Web search on — may increase response time + cost"). Per-turn (resets to off after each send) to avoid silently burning credits across a whole conversation. Only visible when the selected model's `capabilities.supportsWebSearch` is true (mirrors F14's gating pattern).
  2. `<MessageCitations />` — inline disclosure pill (`Sources (N)`) under each assistant message with a non-null `citationsJson`. Expands to a card listing title (linked, `target="_blank" rel="noopener noreferrer"`), plain-text snippet, optional publishedAt. Hidden when `citationsJson` is null. Uses the chat messages list from `GET /api/chats/:chatId/messages`.
  Tests: render-hidden when null, pill count matches array length, expansion reveals all items, links open in new tab with safe rel attributes, snippet rendered as plain text (no HTML), toggle gated by `supportsWebSearch`, toggle resets between sends.
- **`[X11]`** — Reconsider whether `/api/ai/complete` should keep `enable_web_search: 'auto'` on at all. Since citations are dropped on that surface, users pay Venice web-search cost with zero user-visible benefit. Decide: (a) turn it off across all inline AI actions, (b) keep it on as a silent-fact-grounding nudge for accuracy, (c) extend V26's delivery to inline AI (requires F-design for sources UI on the inline card). Write the decision into `docs/venice-integration.md` § Web Search with rationale.
