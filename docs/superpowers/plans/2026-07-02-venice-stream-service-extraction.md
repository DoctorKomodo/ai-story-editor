# Venice Call/Streaming Pipeline Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the triplicated Venice completion-call orchestration and SSE-streaming pipeline out of `ai.routes.ts`, `chat.routes.ts`, and `chapters.routes.ts` into one new service (`backend/src/services/venice-stream.service.ts`) — a **behavior-preserving refactor**. The wire format (SSE frames, `x-venice-*` headers, error envelopes, HTTP status codes, upstream request semantics) must be byte-identical before and after. No feature changes, no error-shape changes.

**Architecture:** Backend-only. Today the identical orchestration sequence — `findModel → buildVeniceParams → resolveReasoningEnabled → resolveTextGenWithFallback → logVeniceParams → promptCacheKey → snapshot → client.chat.completions.create(cast)` — is hand-assembled three times ([backend/src/routes/ai.routes.ts](../../../backend/src/routes/ai.routes.ts) ~152-223, [backend/src/routes/chat.routes.ts](../../../backend/src/routes/chat.routes.ts) ~441-507, [backend/src/routes/chapters.routes.ts](../../../backend/src/routes/chapters.routes.ts) ~296-374), and the ~40-line rate-limit-header-forwarding block plus SSE header setup, `req.on('close')` abort, chunk loop, stream-error frames, and `[DONE]` handling are byte-identical between ai.routes (~226-319) and chat.routes (~510-654) except for chat's citation latch, accumulation, and assistant-message persistence. The extraction is two layers on top of the existing leaf helpers in `venice-call.service.ts` (which stay put):

1. **`prepareVeniceCall(input): PreparedVeniceCall`** — the shared param/model/settings resolution tail. Produces the full Venice request-body object, the `VeniceRequestSnapshot`, and emits the `[venice.params]` dev log — one typed value the executors consume.
2. **`streamVeniceToResponse({ client, req, res, prepared, ctx, hooks })`** — the streaming executor: `create(…, stream: true).withResponse()`, SSE headers, rate-limit header forwarding, `flushHeaders`, client-abort wiring, chunk loop, terminal error frames, `[DONE]`, `res.end()`. Chat-specific behavior (citation latch, content/usage accumulation, assistant-message persistence) survives via two hooks: `onChunk` (may consume a chunk and write its own frames) and `onDone` (runs before `[DONE]`).
3. **`callVeniceCompletion({ client, prepared })`** — the non-streaming executor for `/summarise` (verified: it calls `create` **without** `stream: true` and awaits the full completion, chapters.routes.ts:354-374). Both modes share `prepareVeniceCall`.

All 9 route-level `as unknown as` casts (ai.routes.ts:215,216,275; chat.routes.ts:500,501,554,582; chapters.routes.ts:374,375) collapse into this ONE module — the routes end with **zero** `as unknown as` casts against the openai SDK.

**Tech Stack:** Node.js + Express 5 + TypeScript strict + openai SDK v6 (Venice-compatible client via `lib/venice.ts`) + vitest + supertest against the real test DB, Venice HTTP mocked via `vi.stubGlobal('fetch', …)`.

## Global Constraints

- TypeScript strict — no `any`. The refactor must REDUCE the `as unknown as` count: 9 sites across the three route files today → 0 in routes, all contained in `backend/src/services/venice-stream.service.ts` (expected: the streaming `create`+`.withResponse()` cast, the `controller?.abort?.()` duck-type cast, and the non-streaming `create` cast — nowhere else).
- Behavior-preserving: SSE frame bytes (`data: <json>\n\n`, `event: citations\ndata: …\n\n`, `data: [DONE]\n\n`, the generic `stream_error` frame), the six `x-venice-*` response headers and their absent-when-upstream-absent conditions, all HTTP status codes and JSON error envelopes, and the upstream request fields (`prompt_cache_key` top-level, `venice_parameters`, `reasoning: { enabled: false }` only when disabled, `stream_options: { include_usage: true }` chat-only) are frozen.
- Do NOT touch `backend/src/lib/venice-errors.ts` — its wire shapes (`mapVeniceError`, `mapVeniceErrorToSse`, `VeniceErrorBody`) are byte-frozen; a separate error-mapping plan owns changes there.
- The `[venice.params]` / `[venice.error]` / `[venice.error.dev]` log prefixes and the `[V15] Failed to persist assistant message` catch are pinned by `backend/tests/intentional-logs.ts` (lines 14-17) — schemas unchanged.
- Venice HTTP is mocked in ALL tests via the established pattern: `stubVeniceFetch()` / `jsonResponse` / `sseStreamResponse` in `backend/tests/routes/_chat-test-helpers.ts` (or its per-file clones, e.g. `backend/tests/ai/complete.test.ts:77-100`). No real API calls; do not touch `backend/tests/live/**`.
- Backend tests are real integration tests (supertest + test DB + repo layer). Stack must be up (`make dev`); run `npm -w story-editor-backend run db:test:reset` before a full suite.
- Naming: backend files camelCase/kebab per existing convention — the new file is `venice-stream.service.ts`, tests mirror at `backend/tests/services/venice-stream.service.test.ts`.
- Commit format: `[<bd-id>] description`, one commit per task, each task ends green.
- Verify: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- tests/services/venice-stream tests/ai tests/routes/chat tests/routes/chapters.summarise`

---

### Task 1: `prepareVeniceCall` — one typed preparation step

**Root cause:** The tail of the orchestration (findModel → buildVeniceParams → resolveReasoningEnabled → resolveTextGenWithFallback → logVeniceParams → promptCacheKey → snapshot → request-body literal) is duplicated three times with only parametric differences: chat adds `enableWebSearch`/`enableChatStreamHints` flags and `stream_options: { include_usage: true }` (chat.routes.ts:442-447,496); summarise passes `base: {}` + explicit `includeVeniceSystemPrompt` + a `response_format` block and uses `modelInfo.maxCompletionTokens` as the fallback (chapters.routes.ts:313-324,360-367); complete is the plain form (ai.routes.ts:152-202). Each copy re-derives the same `VeniceRequestSnapshot` and the same `as unknown as Parameters<…>` request cast.

**Fix:** A single `prepareVeniceCall(input)` in a new `backend/src/services/venice-stream.service.ts` that takes the already-diverged inputs (messages, base params, flags, fallback tokens, cache-key parts) and returns `{ requestParams, snapshot }`. It calls `veniceModelsService.findModel` internally and emits `[venice.params]` with the exact schema `logVeniceParams` produces today (including `enableWebSearch: venice_parameters.enable_web_search as string | undefined` — which is `undefined` for complete/summarise, matching current output). The leaf helpers stay in `venice-call.service.ts`; this module only orchestrates.

**Files:**
- Create: `backend/src/services/venice-stream.service.ts`
- Test: `backend/tests/services/venice-stream.service.test.ts` (create; sits beside `venice-call.service.test.ts`, the unit-test model for this layer)

**Interfaces:**
- Produces:

```ts
export type VeniceChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface PrepareVeniceCallInput {
  route: VeniceErrorContext['route'];        // 'ai-complete' | 'chat' | 'chapter-summarise'
  userId: string;
  modelId: string;
  messages: VeniceChatMessage[];
  settings: UserSettings;                    // from hydrateUserSettings (stays in routes)
  baseVeniceParams: Record<string, unknown>; // buildPrompt().venice_parameters, or {} (summarise)
  fallbackMaxCompletionTokens: number;       // buildPrompt().max_completion_tokens, or modelInfo.maxCompletionTokens
  cacheKeyParts: string[];                   // [storyId, modelId] / [chatId, modelId] / [chapterId, modelId]
  action: string;                            // body.action / 'ask'|'scene' / 'summariseChapter'
  modelCap: number | undefined;              // getModelMaxCompletionTokens result (stays in routes) / modelInfo cap
  enableWebSearch?: boolean;                 // chat only
  enableChatStreamHints?: boolean;           // chat only
  includeVeniceSystemPrompt?: boolean;       // summarise only (complete/chat embed it via buildPrompt's base)
  includeUsage?: boolean;                    // chat only → stream_options: { include_usage: true }
  responseFormat?: unknown;                  // summarise only → response_format (also mirrored into snapshot)
}

export interface PreparedVeniceCall {
  requestParams: Record<string, unknown>;    // full Venice body WITHOUT `stream` — executors add it
  snapshot: VeniceRequestSnapshot;
}

export function prepareVeniceCall(input: PrepareVeniceCallInput): PreparedVeniceCall;
```

- Consumes: `buildVeniceParams`, `resolveReasoningEnabled`, `resolveTextGenWithFallback`, `logVeniceParams`, `promptCacheKey` from `./venice-call.service`; `veniceModelsService.findModel`; `VeniceRequestSnapshot`, `VeniceErrorContext` types from `../lib/venice-errors`.
- `requestParams` field set, exactly mirroring today's three call sites: `model`, `messages`, `temperature`, `top_p`, `max_completion_tokens`, `stream_options` (only when `includeUsage === true`), `response_format` (only when `responseFormat !== undefined`), `prompt_cache_key`, `venice_parameters`, and `reasoning: { enabled: false }` only when `resolveReasoningEnabled(...)` is false (spread-omitted otherwise, as in ai.routes.ts:214).
- `snapshot` field-for-field identical to the three current literals (ai.routes.ts:188-202, chat.routes.ts:471-485, chapters.routes.ts:338-349): `model`, `messageCount`, `systemMessagePreview` (first message content when string), `userMessagePreview` (last message content when string), `venice_parameters`, `response_format` (only when provided — note summarise's snapshot carries the SHORT form `{ type: 'json_schema', name: 'ChapterSummary' }`, not the full schema; the input therefore takes a separate optional `snapshotResponseFormat` OR the route passes the short form for the snapshot — implementer picks one, but the snapshot value must stay the short form), `promptCacheKey`, `temperature`, `top_p`, `max_completion_tokens`.

- [ ] **Step 1: Write failing unit tests for `prepareVeniceCall`**

Create `backend/tests/services/venice-stream.service.test.ts`. Pure unit tests, no HTTP, no DB writes (construct `UserSettings` literals; seed `veniceModelsService` via a locally-created `createVeniceModelsService` with an injected `getClient` — or simpler, follow `venice-call.service.test.ts`'s style and pass a `findModel` result by priming the singleton cache with a stubbed fetch, matching `MODEL_LIST_BODY` fixtures from `_chat-test-helpers.ts`). Cover at minimum:

- plain complete-shape input → `requestParams` has `prompt_cache_key` at TOP level (not inside `venice_parameters`), no `stream_options`, no `response_format`, no `reasoning` key when reasoning stays enabled;
- reasoning-capable model with per-model override `reasoning: false` → `requestParams.reasoning` equals `{ enabled: false }`; `strip_thinking_response: true` inside `venice_parameters`;
- chat-shape input (`enableWebSearch: true, enableChatStreamHints: true, includeUsage: true`) → `venice_parameters.enable_web_search === 'auto'`, `enable_web_citations === true`, `include_search_results_in_stream === true`, `stream_options` equals `{ include_usage: true }`;
- summarise-shape input (`includeVeniceSystemPrompt: false`, `responseFormat` set) → `venice_parameters.include_venice_system_prompt === false`, `response_format` present;
- snapshot: `messageCount`, previews, `promptCacheKey === promptCacheKey(...parts)`, resolved temperature/top_p/max_completion_tokens mirrored;
- unknown model (findModel → null) → falls back through `resolveTextGenWithFallback` (max_completion_tokens = fallback, temperature/top_p undefined).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w story-editor-backend run test -- tests/services/venice-stream`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `prepareVeniceCall`**

Create `backend/src/services/venice-stream.service.ts` with the interface above. Transcribe the shared tail from ai.routes.ts:152-202 verbatim, parameterised per the input flags; call `logVeniceParams` with `enableWebSearch: venice_parameters.enable_web_search as string | undefined` (safe: `buildVeniceParams` only ever writes the string `'auto'` there). No `as unknown as` needed in this function.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w story-editor-backend run test -- tests/services/venice-stream`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm --prefix backend run typecheck`

```bash
git add backend/src/services/venice-stream.service.ts backend/tests/services/venice-stream.service.test.ts
git commit -m "[<bd-id>] extract prepareVeniceCall: shared Venice request preparation"
```

---

### Task 2: `streamVeniceToResponse` — one SSE executor with hooks

**Root cause:** ai.routes.ts:204-319 and chat.routes.ts:487-654 duplicate: the `create(… stream: true).withResponse()` double cast; SSE header setup (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`); the byte-identical six-header rate-limit forwarding block (ai.routes.ts:235-258 ≡ chat.routes.ts:519-542); `flushHeaders`; the `clientClosed` + `req.on('close')` abort with the `(stream as unknown as { controller?: { abort?: () => void } })` duck-type (ai.routes.ts:275, chat.routes.ts:554); the chunk loop; the `mapVeniceErrorToSse`-with-generic-fallback stream-error handling; and `[DONE]` + `res.end()`. Chat has since diverged inside the loop only: citation latch (chat.routes.ts:581-597), content/usage accumulation (600-608), and pre-`[DONE]` assistant persistence (614-631).

**Fix:** One executor owning everything from `create()` to `res.end()`, with the divergence expressed as hooks. Errors thrown by `create()` itself propagate to the caller (they occur BEFORE any header is written — the route's existing `catch` keeps mapping them to JSON via `mapVeniceError`, so pre-stream status codes are untouched). After `flushHeaders`, errors become terminal SSE frames exactly as today.

**Files:**
- Modify: `backend/src/services/venice-stream.service.ts`
- Test: `backend/tests/services/venice-stream.service.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export interface VeniceStreamChunk {
  choices: Array<{ delta: { content?: string | null }; finish_reason: string | null }>;
  usage?: { total_tokens?: number } | null;
  // Venice extension chunk ([V26]); typed here so hook callers need no cast.
  venice_search_results?: unknown;
}

export interface VeniceStreamHooks {
  /** Called per upstream chunk BEFORE default forwarding. Return 'consume' to
   *  suppress the default `data: <chunk>\n\n` frame (the hook may write its own
   *  frames via `write`). Default when absent: forward. */
  onChunk?: (chunk: VeniceStreamChunk, write: (frame: string) => void) => 'consume' | 'forward';
  /** Runs after the loop, before `data: [DONE]`, only when the client is still
   *  connected. Hooks MUST catch their own errors (see chat's persist catch) —
   *  a throw here would otherwise surface as a stream_error frame. */
  onDone?: () => Promise<void>;
}

export async function streamVeniceToResponse(opts: {
  client: OpenAI;
  req: Request;   // express
  res: Response;  // express
  prepared: PreparedVeniceCall;
  ctx: VeniceErrorContext;
  hooks?: VeniceStreamHooks;
}): Promise<void>;
```

- Consumes: `logVeniceErrorDev`, `mapVeniceErrorToSse` from `../lib/venice-errors` (untouched).
- Internal casts (the contained sites): `{ ...prepared.requestParams, stream: true } as unknown as Parameters<typeof client.chat.completions.create>[0]`, the `.withResponse()` structural result `{ data: AsyncIterable<VeniceStreamChunk>; response: { headers: { get(name: string): string | null } } }`, and the `controller?.abort?.()` duck-type. These three lines are the ONLY `as unknown as` in the module and, post-plan, in the whole Venice call path.

- [ ] **Step 1: Write failing executor tests**

Extend `backend/tests/services/venice-stream.service.test.ts`. Build a REAL client via `createVeniceClient({ apiKey: 'sk-test…' })` with `vi.stubGlobal('fetch', fetchSpy)` (the house mock pattern — `lib/venice.ts:32-33` rebinds to `globalThis.fetch` lazily precisely so this works); fake `req` as an `EventEmitter` cast per the `makeFakeReq` precedent, fake `res` capturing `setHeader`/`write`/`end`. Cover the gaps the route tests do NOT pin:

- client disconnect: emit `'close'` mid-stream → loop stops, no `[DONE]` written, upstream abort attempted (no throw when controller absent);
- non-APIError mid-stream → generic frame `data: {"error":"An internal stream error occurred.","code":"stream_error","message":"An internal stream error occurred."}\n\n` then `data: [DONE]\n\n` then `end()` (byte-compare the frames);
- APIError mid-stream → `mapVeniceErrorToSse` frames written (already unit-tested in `tests/lib/venice-errors.test.ts` — assert only that the mapped path is taken);
- `onChunk` returning `'consume'` suppresses the default frame; hook-written frames appear in order before later chunks;
- `onDone` runs after the last chunk and before `[DONE]`;
- rate-limit forwarding: headers present ↔ set, absent ↔ not set (spot-check two; the full 6-header matrix stays pinned by `tests/ai/rate-limit-headers.test.ts` + `tests/ai/chat-rate-limit-headers.test.ts`).

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm -w story-editor-backend run test -- tests/services/venice-stream` → FAIL. Implement `streamVeniceToResponse` by transcribing ai.routes.ts:204-319 (the superset structure) with the hook seams at chat's divergence points. Order of operations is frozen: create/withResponse → `res.status(200)` → 3 SSE headers → 6-header forwarding block → `flushHeaders` → close-wiring → loop → (`onDone` → `[DONE]`) / catch → `finally res.end()`.

- [ ] **Step 3: Verify green + typecheck**

Run: `npm -w story-editor-backend run test -- tests/services/venice-stream && npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/venice-stream.service.ts backend/tests/services/venice-stream.service.test.ts
git commit -m "[<bd-id>] add streamVeniceToResponse: shared SSE executor with chunk/done hooks"
```

---

### Task 3: Migrate `/api/ai/complete` (behavior-frozen)

**Root cause / Fix:** ai.routes.ts:152-319 is the plain instantiation of the pipeline; replace steps 10-13 with `prepareVeniceCall` + `streamVeniceToResponse` and no hooks. Everything before (fetchModels, context lengths, `hydrateUserSettings`, repo loads, `buildPrompt`) stays in the route.

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`
- Tests (regression net, no changes expected): `backend/tests/ai/complete.test.ts`, `rate-limit-headers.test.ts`, `error-handling.test.ts`, `prompt-cache.test.ts`, `reasoning.test.ts`, `web-search.test.ts`

**Interfaces:**
- Consumes: `prepareVeniceCall`, `streamVeniceToResponse` from `../services/venice-stream.service`. The route's imports from `venice-call.service` shrink to `hydrateUserSettings` only.
- Route keeps: `let snapshot: VeniceRequestSnapshot | undefined` + its `catch` (`logVeniceErrorDev` + `mapVeniceError` + rethrow, ai.routes.ts:320-325) — assign `snapshot = prepared.snapshot` immediately after `prepareVeniceCall` so pre-stream failures keep logging the request context.

- [ ] **Step 1: Baseline — regression net green before touching the route**

Run: `npm -w story-editor-backend run test -- tests/ai/complete tests/ai/rate-limit-headers tests/ai/error-handling tests/ai/prompt-cache tests/ai/reasoning tests/ai/web-search`
Expected: PASS (this suite already pins: chunk passthrough + `[DONE]`, Authorization key, messages/max_completion_tokens/temperature/top_p on the wire, `prompt_cache_key` top-level, `strip_thinking_response`, `reasoning:{enabled:false}`, all six header-forwarding cases, 401→400/429/503/418 mappings, sentinel no-leak).

- [ ] **Step 2: Migrate the route**

Replace ai.routes.ts steps 10-13 (lines ~151-319) with:

```ts
const prepared = prepareVeniceCall({
  route: 'ai-complete',
  userId,
  modelId: body.modelId,
  messages,
  settings,
  baseVeniceParams,
  fallbackMaxCompletionTokens: max_completion_tokens,
  cacheKeyParts: [body.storyId, body.modelId],
  action: body.action,
  modelCap: modelMaxCompletionTokens,
});
snapshot = prepared.snapshot;

const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);
await streamVeniceToResponse({
  client, req, res, prepared,
  ctx: { userId, route: 'ai-complete' },
});
```

Delete the now-unused imports (`buildVeniceParams`, `logVeniceParams`, `promptCacheKey`, `resolveReasoningEnabled`, `resolveTextGenWithFallback`, `mapVeniceErrorToSse`, `veniceModelsService.findModel` usage). Note one reviewed-acceptable dev-only divergence: `snapshot` is now assigned BEFORE `getClient`, so a `NoVeniceKeyError` at that point logs a richer `[venice.error.dev]` payload than before (previously `request: undefined`). No wire-format or status-code change — the 409 mapping is unchanged.

- [ ] **Step 3: Regression net + typecheck green after**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- tests/ai/complete tests/ai/rate-limit-headers tests/ai/error-handling tests/ai/prompt-cache tests/ai/reasoning tests/ai/web-search tests/services/venice-stream`
Expected: PASS, zero test edits. Also: `grep -c "as unknown as" backend/src/routes/ai.routes.ts` → 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/ai.routes.ts
git commit -m "[<bd-id>] ai/complete: use venice-stream service (behavior-frozen)"
```

---

### Task 4: Migrate chat message streaming (hooks carry the divergence)

**Root cause / Fix:** chat.routes.ts:441-654 is the same pipeline plus three chat-only behaviors that MUST be preserved via hooks, not flattened: (1) the citation latch (chat.routes.ts:565-597 — latches on the FIRST `venice_search_results` chunk whether valid or malformed, consumes that chunk instead of forwarding it, emits `event: citations\ndata: {"citations":[…]}\n\n` only when `projectVeniceCitations` yields >0 items, and persists `null` — not `[]` — when none); (2) content + `usage.total_tokens` accumulation (600-608); (3) assistant-message persistence with `latencyMs` before `[DONE]`, its own try/catch, and the exact `console.error('[V15] Failed to persist assistant message', persistErr)` fallback (613-631). Everything else is byte-identical to complete's copy.

**Files:**
- Modify: `backend/src/routes/chat.routes.ts` (POST `/` handler in `createChatMessagesRouter` only; CRUD routers untouched)
- Tests (regression net, no changes expected): `backend/tests/ai/chat-persistence.test.ts`, `chat-citations.test.ts`, `chat-rate-limit-headers.test.ts`, `ask-ai-attachment.test.ts`, `web-search.test.ts`, `backend/tests/routes/chat.test.ts`, `chat-messages-list.test.ts`

**Interfaces:**
- Consumes: `prepareVeniceCall` (with `enableWebSearch`/`enableChatStreamHints`/`includeUsage`), `streamVeniceToResponse` with both hooks. Closure state (`accumulatedContent`, `capturedTotalTokens`, `citationsHandled`, `capturedCitations`, `startedAt`) lives in the route handler, captured by the hooks — the service stays stateless.

- [ ] **Step 1: Baseline green**

Run: `npm -w story-editor-backend run test -- tests/ai/chat-persistence tests/ai/chat-citations tests/ai/chat-rate-limit-headers tests/ai/ask-ai-attachment tests/routes/chat tests/routes/chat-messages-list`
Expected: PASS (pins: citations frame BEFORE content + web-search params, empty-results → no frame + null persisted, tokens/latencyMs persistence, persist-skip on post-persist rate-limit error, retry/resend deletion semantics, header forwarding).

- [ ] **Step 2: Migrate the handler**

Replace chat.routes.ts steps 9b-13 (~438-654). `startedAt = Date.now()` stays where it is today (before `create`, i.e. before `streamVeniceToResponse`). Hooks, transcribed — NOT rewritten — from the current loop:

```ts
let accumulatedContent = '';
let capturedTotalTokens: number | null = null;
let citationsHandled = false;
let capturedCitations: Citation[] | null = null;

await streamVeniceToResponse({
  client, req, res, prepared,
  ctx: { userId, route: 'chat' },
  hooks: {
    onChunk: (chunk, write) => {
      if (!citationsHandled && chunk.venice_search_results !== undefined) {
        citationsHandled = true;
        const projected = projectVeniceCitations(chunk.venice_search_results);
        if (projected.length > 0) {
          capturedCitations = projected;
          write(`event: citations\ndata: ${JSON.stringify({ citations: projected })}\n\n`);
        }
        return 'consume';
      }
      const deltaContent = chunk.choices[0]?.delta?.content;
      if (typeof deltaContent === 'string') accumulatedContent += deltaContent;
      if (chunk.usage?.total_tokens != null) capturedTotalTokens = chunk.usage.total_tokens;
      return 'forward';
    },
    onDone: async () => {
      const latencyMs = Date.now() - startedAt;
      try {
        await messageRepo.create({ chatId, role: 'assistant' as MessageRole,
          content: accumulatedContent, citationsJson: capturedCitations,
          model: body.modelId, tokens: capturedTotalTokens, latencyMs });
      } catch (persistErr) {
        console.error('[V15] Failed to persist assistant message', persistErr);
      }
    },
  },
});
```

Note the `venice_search_results` cast (chat.routes.ts:582) disappears — `VeniceStreamChunk` types it. The user-message persistence (step 9a), replay logic, and prompt/history assembly stay untouched above. Drop the now-unused imports.

- [ ] **Step 3: Regression net + typecheck green after**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- tests/ai/chat-persistence tests/ai/chat-citations tests/ai/chat-rate-limit-headers tests/ai/ask-ai-attachment tests/ai/web-search tests/routes/chat tests/routes/chat-messages-list tests/services/venice-stream`
Expected: PASS, zero test edits. `grep -c "as unknown as" backend/src/routes/chat.routes.ts` → 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/chat.routes.ts
git commit -m "[<bd-id>] chat: use venice-stream service; citation latch + persistence via hooks"
```

---

### Task 5: `callVeniceCompletion` + migrate `/summarise`; cast-containment sweep

**Root cause / Fix:** `/summarise` (chapters.routes.ts:266-412) is NON-streaming — `create` without `stream: true`, whole completion awaited, then `chapterSummarySchema.parse` and repo persistence — but it hand-copies the same preparation and both casts (`as unknown as Parameters<…>` at :374 and `raw = completion as unknown as typeof raw` at :375). Give the service a small non-streaming executor sharing `prepareVeniceCall`; the route keeps its capability gate (`supportsResponseSchema`, :296-306), empty-chapter 400, `summary_parse_failed` 502, and persistence — those are route policy, not pipeline.

**Files:**
- Modify: `backend/src/services/venice-stream.service.ts` (add `callVeniceCompletion`)
- Modify: `backend/src/routes/chapters.routes.ts`
- Test: `backend/tests/services/venice-stream.service.test.ts` (extend); regression net `backend/tests/routes/chapters.summarise.test.ts` (no changes expected)

**Interfaces:**
- Produces:

```ts
export interface VeniceCompletionResult {
  choices?: Array<{ message?: { content?: string } }>;
}
export async function callVeniceCompletion(opts: {
  client: OpenAI;
  prepared: PreparedVeniceCall;
}): Promise<VeniceCompletionResult>;
```

Internally: `client.chat.completions.create(prepared.requestParams as unknown as Parameters<…>[0])` then the structural result cast — the last two contained cast sites. Errors propagate (route keeps its existing `catch` → `logVeniceErrorDev` + `mapVeniceError`, chapters.routes.ts:376-380).

- [ ] **Step 1: Failing unit test for `callVeniceCompletion`** — stubbed fetch returns a JSON (non-SSE) completion body; assert the returned `choices[0].message.content` and that the request body carried `response_format` + no `stream` key. Run `npm -w story-editor-backend run test -- tests/services/venice-stream` → FAIL, implement, → PASS.

- [ ] **Step 2: Baseline green, then migrate the route**

Run: `npm -w story-editor-backend run test -- tests/routes/chapters.summarise` → PASS (pins: `empty_chapter` 400, `model_unsupported_for_summarisation` 400, happy-path persistence, `summary_parse_failed` 502, temperature/top_p/max_completion_tokens/venice_parameters/prompt_cache_key/persona on the wire, `strip_thinking_response`, `reasoning:{enabled:false}`, `include_venice_system_prompt=false`).

Then replace chapters.routes.ts:313-375 with `prepareVeniceCall({ route: 'chapter-summarise', …, baseVeniceParams: {}, includeVeniceSystemPrompt, fallbackMaxCompletionTokens: modelInfo.maxCompletionTokens, cacheKeyParts: [chapterId, body.modelId], action: 'summariseChapter', modelCap: modelInfo.maxCompletionTokens, responseFormat: { type: 'json_schema', json_schema: { name: 'ChapterSummary', schema: chapterSummaryJsonSchema(), strict: true } } })` + `callVeniceCompletion`. Snapshot must keep the short `{ type: 'json_schema', name: 'ChapterSummary' }` form (see Task 1 interface note). The route's early `findModel` capability gate stays (findModel is a cheap cache lookup; prepare re-calling it is fine).

- [ ] **Step 3: Regression + typecheck + cast sweep**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- tests/routes/chapters.summarise tests/services/venice-stream`
Expected: PASS. Then the containment proof:

```bash
grep -rn "as unknown as" backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts backend/src/routes/chapters.routes.ts
```

Expected: **no matches**. `grep -c "as unknown as" backend/src/services/venice-stream.service.ts` → ≤ 3 (streaming create/withResponse, controller abort, non-streaming create/result).

- [ ] **Step 4: Full backend suite (final whole-branch gate)**

Run: `npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test`
Expected: PASS — including `tests/security/byok-leak.test.ts` and `tests/intentional-logs.test.ts` (log-prefix allowlist).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/venice-stream.service.ts backend/src/routes/chapters.routes.ts backend/tests/services/venice-stream.service.test.ts
git commit -m "[<bd-id>] summarise: use venice-stream service; contain all Venice SDK casts in one module"
```

---

## Self-Review notes

- **Behavior freeze is the spec.** No task changes any SSE frame byte, header, status code, error envelope, upstream request semantic, or persisted row. The 25+ existing route tests (complete: 15, chat: ~40 across 6 files, summarise: 10) are the regression net and must pass UNEDITED at every task boundary; new tests only fill genuinely unpinned gaps (client-abort, consume-hook ordering, generic stream_error frame bytes, onDone-before-[DONE]).
- **Divergence preserved, not flattened:** chat's citation latch (first-chunk latch incl. malformed, consume-not-forward, `null`-not-`[]` persistence) and persist-with-own-catch live in route-owned hooks transcribed verbatim; `[V15]` console.error string unchanged (intentional-logs allowlist).
- **Cast accounting is explicit:** 9 route-level `as unknown as` today (ai:215,216,275; chat:500,501,554,582; chapters:374,375) → 0 in routes, ≤3 inside `venice-stream.service.ts`, proven by the Task 5 grep step. `VeniceStreamChunk.venice_search_results?: unknown` is what eliminates chat's chunk cast without a new one.
- **Error-mapping plan boundary respected:** `lib/venice-errors.ts` is read-only in this plan; both executors call it with unchanged arguments so its wire shapes stay byte-identical.
- **Reviewed-acceptable dev-only divergences (2):** (a) `snapshot` assigned before `getClient` in ai/chat routes means a `NoVeniceKeyError` now logs request context in `[venice.error.dev]` (previously `undefined`) — dev-log-only, prod is a no-op; (b) summarise's `[venice.params]` line gains nothing (enableWebSearch stays `undefined` there, as today). Neither touches the wire.
- **Reviewer lanes:** the diff touches `backend/src/routes/{chapters,chat}.routes.ts` (repo-boundary-reviewer in-lane) and a new Venice-call service (security-reviewer adjacent via the BYOK client handoff — `veniceKeyService.getClient` stays in routes, plaintext key never enters the new module; only the constructed `OpenAI` client does). `/bd-close-reviewed` path-matching handles dispatch.
- **Open item for implementer:** Task 1's snapshot `response_format` short-form — pick either a separate `snapshotResponseFormat` input or have the summarise route pass the short form explicitly; whichever is chosen, the snapshot value must remain `{ type: 'json_schema', name: 'ChapterSummary' }` (chapters.routes.ts:344), not the full JSON schema.
- **Open item for implementer:** the executor unit tests build a real client via `createVeniceClient` + `vi.stubGlobal('fetch', …)` (house pattern, no SDK mocks); if the openai SDK's stream iterator proves awkward against a hand-rolled `ReadableStream`, reuse `sseStreamResponse` from `tests/routes/_chat-test-helpers.ts` — it is already proven against the SDK's consumer.
