# HttpError Base Class + Central Error Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End the hand-rolled error-literal sprawl in the backend routes. Introduce a throwable `HttpError(status, code, message)` base class plus a central domain-error mapping table in the global error handler, so routes `throw` instead of hand-assembling `{ error: { message, code } }` literals (~25 copies today), and domain errors (`UnknownModelError`, `InvalidCredentialsError`, `ZodError`, …) stop falling through to `500 internal_error`. Exactly one deliberate wire-shape change ships: `UnknownModelError` becomes `400 unknown_model` instead of `500 internal_error`. Every other response keeps its exact JSON body, status code, and headers.

**Architecture:** Backend-only. One idiom, chosen deliberately: **throwable errors mapped centrally**, not response-helper functions. Routes throw an `HttpError` (via thin constructors `notFound()` / `forbidden()` / `unauthorized()` in `backend/src/lib/http-errors.ts`); domain/service errors stay transport-agnostic (`UnknownModelError` keeps living in `venice.models.service.ts` with no HTTP knowledge) and get status/code assigned by an instanceof table inside the global handler, exactly like the existing `NoVeniceKeyError` → 409 branch ([backend/src/index.ts](../../../backend/src/index.ts):183-191). Rationale: (a) `throw` composes with the existing `try { … } catch (err) { next(err) }` pattern and with `validateBody`'s `.catch(next)` ([backend/src/middleware/validate.ts](../../../backend/src/middleware/validate.ts):15-17) with zero plumbing; (b) keeping domain classes free of HTTP status keeps repos/services importable from scripts and tests without an Express dependency; (c) one mapping table is auditable — the API error catalog in `docs/api-contract.md` line 14 gets a single source of truth. The handler itself moves from `backend/src/index.ts` to a new `backend/src/middleware/error-handler.ts` (index.ts re-exports it so the three existing test files importing `{ globalErrorHandler } from '../../src/index'` keep working), because the table will import several service error classes and index.ts is bootstrap code.

**Sequencing constraint (read this before dispatching):** a concurrent plan, `docs/superpowers/plans/2026-07-02-venice-stream-service-extraction.md`, owns the streaming internals of `backend/src/routes/ai.routes.ts` and `backend/src/routes/chat.routes.ts`. **This plan executes AFTER that one lands.** To keep the overlap at zero even if they end up in flight together: this plan makes **no code edits** to either file — the `UnknownModelError` fix works purely through the central handler (both routes already re-`throw` non-Venice errors from their catch blocks: `ai.routes.ts:323-324` `if (mapVeniceError(...)) return; throw err;`), and the literal sweep (Task 3) deliberately skips both files. The only touch is a stale-comment fix in `ai.routes.ts` (Task 2, comment-only, trivially re-appliable if the extraction moved it). SSE error frames (`mapVeniceErrorToSse`, the `stream_error` fallback) are **out of scope entirely**.

**The mapping table** (verified against current source; "After" statuses in bold are behavior changes):

| Error class | Defined in | Today | After | Wire body (frozen unless bold) |
|---|---|---|---|---|
| `HttpError` (new) | `lib/http-errors.ts` | — | its own `status`/`code` | `{ error: { message, code } }` |
| `NoVeniceKeyError` | `lib/venice.ts:14` | 409 `venice_key_required` | unchanged | `message: 'No Venice API key is stored. Add yours in Settings to enable AI features.'` |
| `UnknownModelError` | `services/venice.models.service.ts:33` | 500 `internal_error` | **400 `unknown_model`** | **`message: err.message` (`Unknown Venice model: <modelId>`)** |
| `ZodError` | `zod` | 400 via per-route ladders / `validateBody`; 500 if it ever escapes | 400 `validation_error` centrally | `{ message: 'Invalid request body', code: 'validation_error', issues: [{ path, message }] }` — identical to `badRequestFromZod` |
| `InvalidCredentialsError` | `services/auth.service.ts:148` | 401 via 4 route ladders | 401 centrally | `{ message: 'Invalid credentials', code: 'invalid_credentials' }` |
| `UsernameUnavailableError` | `services/auth.service.ts:138` | 409 via register ladder | 409 centrally | `{ message: 'Username unavailable', code: 'username_unavailable' }` |
| `VeniceKeyInvalidError` | `services/venice-key.service.ts` | 400 via venice-key ladder | 400 centrally | `{ message: 'venice_key_invalid', code: 'venice_key_invalid' }` (message === code is the existing quirk — keep it) |
| `VeniceKeyCheckError` | `services/venice-key.service.ts` | 502 via venice-key ladder | 502 centrally | `{ message: 'venice_unreachable', code: 'venice_unreachable' }` |
| `ChapterNotOwnedError` / `CharacterNotOwnedError` / `OutlineNotOwnedError` | `repos/{chapter,character,outline}.repo.ts` | 403 via 3 route ladders | 403 centrally | `{ message: 'Forbidden', code: 'forbidden' }` |
| `DekNotAvailableError` | `services/content-crypto.service.ts:34` | 500 `internal_error` | **401 `session_expired`** | **`{ message: 'Session expired', code: 'session_expired' }`** — byte-identical to `auth.middleware.ts:42`, so the frontend's 401 → sign-in-again path recovers. Reachable only if a route calls `getDekFromRequest` without `requireAuth` (programmer error); failing closed as 401 beats serving a 500. Dev `console.error` still fires for it (see Task 1 ordering note). |
| `CiphertextMissingError` | `repos/_narrative.ts:29` | 500 `internal_error` | unchanged — deliberately **unmapped** | Half-written narrative row = data corruption; not client-fixable; a distinct code would be a wire change with no consumer. Stays catch-all 500. |
| `PromptValidationError` | `services/prompt.service.ts:7` | 500 `internal_error` | unchanged — deliberately **unmapped** | Thrown only for `scene`/`ask` actions with a missing `freeformInstruction` (`prompt.service.ts:232,238`); both call sites guarantee non-empty content via Zod `superRefine` / anchor validation, so reaching the handler means a server-side precondition broke — that is a 500, not a client 400. |
| APIError (openai SDK) | — | route-level `mapVeniceError` | unchanged — stays route-level | Owned by `lib/venice-errors.ts`; not this plan's surface. |

**Security posture (frozen, pinned by tests):** the production handler keeps stripping stack traces and replacing messages with `'Internal server error'` (pinned by `backend/tests/routes/error-handler.test.ts` and the production describe in `backend/tests/middleware/error-handler.test.ts:56-91`); the dev-mode `err.stack` inclusion on the catch-all 500 is preserved exactly; mapped errors (HttpError + table) never carry a stack in ANY environment (extending the existing NoVeniceKeyError pin at `error-handler.test.ts:49-54`); no secret can enter a mapped body — every mapped message is a string literal except `UnknownModelError`, whose message interpolates only the client-supplied `modelId`. `security-reviewer` will auto-dispatch at `/bd-close-reviewed` because this touches `backend/src/index.ts` (error/env bootstrap surface) and `backend/src/routes/auth.routes.ts` — expected, do not bypass.

**Tech Stack:** Node.js + Express 5 + TypeScript strict + Zod + Prisma; vitest + supertest integration tests against the real test DB (Venice mocked).

## Global Constraints

- TypeScript strict mode — no `any`.
- Backend filenames are camelCase/kebab-case per convention (`http-errors.ts`, `error-handler.ts` matching `bad-request.ts` / `origin-check.middleware.ts` precedent).
- **Wire shapes are frozen** except the single enumerated `unknown_model` change and the `DekNotAvailableError` 500→401 change (both listed in the table above). Every existing route test under `backend/tests/routes/**`, `backend/tests/ai/**`, `backend/tests/auth/**` must pass unmodified except where this plan explicitly says otherwise — they are the regression net (`stories.test.ts`, `chapters.test.ts`, `characters.test.ts`, `outline.test.ts`, `chat.test.ts`, `auth.routes.test.ts`, `venice-key.test.ts`, `error-handler*.test.ts` all pin exact `{ error: { message, code } }` bodies).
- **No edits to the streaming pipeline**: `ai.routes.ts` / `chat.routes.ts` bodies stay untouched (comment-only exception in Task 2); no SSE frame changes.
- Backend tests are integration tests: supertest against the exported app or a disposable app mounting the real handler; real test DB; Venice HTTP mocked. Run `npm -w story-editor-backend run db:test:reset` before a full-suite run; the dev stack (`make dev`) must be up.
- Commit format `[<bd-id>] description`; one green commit per task.
- Verify: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- error-handler http-errors respond complete chat-persistence stories chapters characters outline auth venice-key`

---

### Task 1: `HttpError` + central mapping table + handler extraction (behavior-preserving)

**Root cause:** The global error handler ([backend/src/index.ts](../../../backend/src/index.ts):174-208) special-cases exactly one domain error (`NoVeniceKeyError` → 409); everything else — including errors that already carry a `code` property like `UnknownModelError` — collapses to `500 internal_error`. Routes compensate with per-route catch ladders and ~25 hand-rolled response literals because there is nothing to `throw`.

**Fix:** New `backend/src/lib/http-errors.ts` with the `HttpError` class + `notFound`/`forbidden`/`unauthorized` constructors. Extract `globalErrorHandler` to `backend/src/middleware/error-handler.ts` (re-exported from `index.ts`) and add mapping branches — all of which are inert this task (route ladders still catch first) except the `DekNotAvailableError` 500→401 change. Wrap `respond()`'s egress `schema.parse` so a dev-mode egress-drift `ZodError` does **not** get misread as a client 400 by the new central `ZodError` branch.

**Files:**
- Create: `backend/src/lib/http-errors.ts`
- Create: `backend/src/middleware/error-handler.ts` (handler moves here)
- Modify: `backend/src/index.ts` (delete inline handler; import + `app.use` + re-export)
- Modify: `backend/src/lib/respond.ts` (egress-drift rethrow wrapper)
- Test: `backend/tests/middleware/error-handler.test.ts` (extend), `backend/tests/lib/respond.test.ts` (extend), `backend/tests/lib/http-errors.test.ts` (create)

**Interfaces:**
- Produces: `class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string) }`; `notFound(message = 'Not found'): HttpError` (404/`not_found`); `forbidden(message = 'Forbidden'): HttpError` (403/`forbidden`); `unauthorized(): HttpError` (401/`unauthorized`, message `'Unauthorized'`).
- Produces: `globalErrorHandler(err, req, res, next)` in `middleware/error-handler.ts`, re-exported from `src/index.ts` (three test files import it from there: `tests/routes/error-handler.test.ts:14`, `tests/middleware/error-handler.test.ts:4`, `tests/middleware/error-handler.venice.test.ts:4` — do not break them).
- Produces: `class EgressSchemaDriftError extends Error` in `lib/respond.ts` (internal; wraps the dev-mode egress ZodError so it still lands in the 500 catch-all).

- [ ] **Step 1: Write failing tests for `HttpError` and the new mapping branches**

Create `backend/tests/lib/http-errors.test.ts` (unit: constructors produce the right `status`/`code`/`message`, `instanceof Error` and `instanceof HttpError` both true). Extend `backend/tests/middleware/error-handler.test.ts` — reuse its existing `makeApp(throwValue)` disposable-app pattern (lines 12-19) — with cases:

```ts
it('maps a thrown HttpError to its own status/code/message', async () => {
  const res = await request(makeApp(new HttpError(404, 'not_found', 'Chapter not found'))).get('/boom');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: { message: 'Chapter not found', code: 'not_found' } });
});

it('never includes a stack for mapped errors, even in dev', async () => {
  const err = notFound();
  err.stack = 'Error: x\n    at fake (/tmp/fake.ts:1:1)';
  const res = await request(makeApp(err)).get('/boom');
  expect(JSON.stringify(res.body)).not.toContain('/tmp/fake.ts');
});

it('maps ZodError to the badRequestFromZod shape', async () => {
  const zerr = z.object({ title: z.string() }).safeParse({}).error!;
  const res = await request(makeApp(zerr)).get('/boom');
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('validation_error');
  expect(res.body.error.message).toBe('Invalid request body');
  expect(Array.isArray(res.body.error.issues)).toBe(true);
});
```

plus one case per table row: `InvalidCredentialsError` → 401 `invalid_credentials` / `'Invalid credentials'`; `UsernameUnavailableError` → 409 `username_unavailable` / `'Username unavailable'`; `VeniceKeyInvalidError` → 400 (message `'venice_key_invalid'`); `VeniceKeyCheckError` → 502 (message `'venice_unreachable'`); `ChapterNotOwnedError` / `CharacterNotOwnedError` / `OutlineNotOwnedError` → 403 `{ message: 'Forbidden', code: 'forbidden' }`; `DekNotAvailableError` → 401 `{ message: 'Session expired', code: 'session_expired' }` (assert byte-equality with the `auth.middleware.ts:42` body); and a **production-mode** case asserting a mapped `HttpError` still returns its real message/code in prod (only the catch-all genericises). Keep every pre-existing case in the file untouched — the prod stack-strip and dev-stack cases (lines 56-116) are the frozen contract.

- [ ] **Step 2: Run to verify failure**

Run: `npm -w story-editor-backend run test -- error-handler http-errors`
Expected: FAIL — `http-errors.ts` doesn't exist; new mapping cases 500.

- [ ] **Step 3: Implement `lib/http-errors.ts`**

```ts
// Throwable HTTP errors + thin constructors for the common cases. Routes
// `throw` these; the global error handler (middleware/error-handler.ts) is the
// single place that turns them into `{ error: { message, code } }` responses.
// Domain/service errors do NOT extend this class — they stay transport-agnostic
// and are mapped by the handler's instanceof table instead.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message = 'Not found'): HttpError =>
  new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Forbidden'): HttpError =>
  new HttpError(403, 'forbidden', message);
export const unauthorized = (): HttpError => new HttpError(401, 'unauthorized', 'Unauthorized');
```

- [ ] **Step 4: Extract + extend the handler in `middleware/error-handler.ts`**

Move the current `globalErrorHandler` body from `index.ts:174-208` verbatim, then insert the mapping branches **above** the existing `isProd` / `console.error('[error-handler.dev]', err)` block (this preserves the current behavior where mapped errors — today only `NoVeniceKeyError` — return before the dev log and never get a stack). Exception: give `DekNotAvailableError` a `console.error` in non-prod before responding, since it signals a missing `requireAuth` and must stay visible. Shape:

```ts
export function globalErrorHandler(err, _req, res, _next): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }
  if (err instanceof ZodError) { badRequestFromZod(res, err); return; }   // lib/bad-request.ts — exact shape reuse
  if (err instanceof NoVeniceKeyError) { /* existing 409 branch, verbatim */ }
  if (err instanceof UnknownModelError) { /* Task 2 */ }
  if (err instanceof InvalidCredentialsError) { /* 401 invalid_credentials */ }
  if (err instanceof UsernameUnavailableError) { /* 409 username_unavailable */ }
  if (err instanceof VeniceKeyInvalidError) { /* 400, message 'venice_key_invalid' */ }
  if (err instanceof VeniceKeyCheckError) { /* 502, message 'venice_unreachable' */ }
  if (err instanceof ChapterNotOwnedError || err instanceof CharacterNotOwnedError
      || err instanceof OutlineNotOwnedError) { /* 403 { 'Forbidden', 'forbidden' } */ }
  if (err instanceof DekNotAvailableError) { /* dev console.error, then 401 session_expired */ }
  // …existing catch-all 500 verbatim: dev console.error, prod message
  // genericisation, dev-only err.stack — DO NOT ALTER.
}
```

In `index.ts`: `import { globalErrorHandler } from './middleware/error-handler';`, keep `app.use(globalErrorHandler);` in place, and add `export { globalErrorHandler };` so the three test files' `from '../../src/index'` imports keep resolving. Body messages must be copied byte-for-byte from the table above.

- [ ] **Step 5: Wrap `respond()`'s egress parse**

In `backend/src/lib/respond.ts`, the dev-only `schema.parse(data)` (line 13) currently throws a raw `ZodError` which the comment says "the global error handler renders … 500 with stack in dev". With the new central `ZodError → 400 validation_error` branch, an egress-drift bug would masquerade as a client validation error. Wrap it:

```ts
export class EgressSchemaDriftError extends Error {
  constructor(zodMessage: string) {
    super(`egress schema drift: ${zodMessage}`);
    this.name = 'EgressSchemaDriftError';
  }
}
```

and in `respond()`: `try { schema.parse(data); } catch (err) { throw err instanceof ZodError ? new EgressSchemaDriftError(err.message) : err; }`. Extend `backend/tests/lib/respond.test.ts`: drift still throws (existing case at line 30 keeps passing), and the thrown value is `EgressSchemaDriftError`, **not** `instanceof ZodError`.

- [ ] **Step 6: Run tests to verify pass**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- error-handler http-errors respond`
Expected: all PASS, including every pre-existing error-handler case unmodified.

- [ ] **Step 7: Full backend suite (behavior-preservation gate)**

Run: `npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test`
Expected: PASS — the only route-observable change so far is `DekNotAvailableError` (nothing in the suite exercises it via HTTP; confirm no failures mention `session_expired`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/lib/http-errors.ts backend/src/middleware/error-handler.ts \
  backend/src/index.ts backend/src/lib/respond.ts \
  backend/tests/lib/http-errors.test.ts backend/tests/middleware/error-handler.test.ts \
  backend/tests/lib/respond.test.ts
git commit -m "[<bd-id>] backend: HttpError class + central domain-error mapping in global handler"
```

---

### Task 2: `UnknownModelError` → 400 `unknown_model` (the deliberate wire change)

**Root cause:** `UnknownModelError` (`backend/src/services/venice.models.service.ts:33-39`, thrown by `getModelContextLength`/`getModelMaxCompletionTokens` at lines 167/174) already carries `readonly code = 'unknown_model'` but reaches users as `500 internal_error`. The acknowledged TODO sits in `ai.routes.ts:80-82`: *"Also throws UnknownModelError when modelId isn't in Venice's list → propagates as 500 (V11 will refine later)."* Both throw sites are pre-stream (before any SSE headers flush), and both routes re-throw it out of their catch blocks into `next()` — so the central handler is the complete fix with zero route edits.

**Endpoints whose behavior changes** (enumerate-and-test, per the hard constraint):
1. `POST /api/ai/complete` — `ai.routes.ts:84` (`getModelContextLength`) and `:89` (`getModelMaxCompletionTokens`): 500 → **400 `unknown_model`**.
2. `POST /api/chats/:chatId/messages` — `chat.routes.ts:308` / `:313`: 500 → **400 `unknown_model`** (pre-stream JSON, not an SSE frame).

No other endpoint can throw it: `POST …/chapters/:chapterId/summarise` uses `findModel` (null → its own `400 model_unsupported_for_summarisation`, `chapters.routes.ts:296-306`), and `GET /api/ai/models` never looks up by id. **Consumer check (verified during planning):** `grep -r "internal_error\|unknown_model" frontend/src shared/src` — frontend matches no code-specific branch for either (banners render `code · message` generically: `InlineErrorBanner.tsx:35`, `VeniceErrorBanner.tsx` special-cases only `venice_*` codes), and `shared/src` defines **no error-code schema or type** — there is nothing to extend there. No existing backend test pins the 500 (verified: no `unknown_model` / bogus-model case exists in `backend/tests/`).

**Fix:** One branch in the central table + new integration tests + docs. Message goes on the wire as the class's own `err.message` (`Unknown Venice model: <modelId>` — interpolates only the client-supplied id).

**Files:**
- Modify: `backend/src/middleware/error-handler.ts` (fill in the `UnknownModelError` branch)
- Modify: `backend/src/routes/ai.routes.ts` (**comment-only**: rewrite the stale `:80-82` TODO to "→ 400 unknown_model via the global handler"; if the stream-extraction plan relocated this comment, apply at its new home)
- Test: `backend/tests/middleware/error-handler.test.ts` (extend), `backend/tests/ai/complete.test.ts` (extend), `backend/tests/ai/chat-persistence.test.ts` (extend)
- Docs: `docs/api-contract.md` (add `400 unknown_model` to the `/api/ai/complete` and chat-message-POST error lists — the latter is the "Errors (pre-stream JSON):" line ~206; drop `internal_error` implication), `docs/venice-integration.md` § error catalog (add `unknown_model`)

**Interfaces:**
- Produces (handler branch): `res.status(400).json({ error: { message: err.message, code: 'unknown_model' } })`.
- Consumes: the existing model-mock harness in `tests/ai/complete.test.ts` (its `fetch` stub returns a fixed `/v1/models` list) — request a `modelId` absent from that list.

- [ ] **Step 1: Write the failing tests**

Unit (error-handler.test.ts): `makeApp(new UnknownModelError('no-such-model'))` → 400, body `{ error: { message: 'Unknown Venice model: no-such-model', code: 'unknown_model' } }`, no stack in any env. Integration: in `tests/ai/complete.test.ts`, reuse the file's existing login + models-mock setup, POST `/api/ai/complete` with `modelId: 'model-not-in-list'` → expect `400` and `body.error.code === 'unknown_model'` (previously 500). Mirror in `tests/ai/chat-persistence.test.ts` for `POST /api/chats/:chatId/messages` using `_chat-test-helpers.ts` fixtures. Copy each file's established mock idiom — do not invent a new harness.

- [ ] **Step 2: Run to verify failure**

Run: `npm -w story-editor-backend run test -- error-handler complete chat-persistence`
Expected: new cases FAIL with status 500.

- [ ] **Step 3: Implement the branch + comment + docs**

Add the branch to the table (above the catch-all, alongside the other domain branches). Update the `ai.routes.ts:80-82` comment text only. Update `docs/api-contract.md` (both endpoint error lists; also add `unknown_model` to the venice-integration error catalog since it is Venice-model-adjacent).

- [ ] **Step 4: Run to verify pass, then full AI suite**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- error-handler complete chat-persistence && npm -w story-editor-backend run test -- ai/`
Expected: all PASS (no other ai test pinned the 500).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/error-handler.ts backend/src/routes/ai.routes.ts \
  backend/tests/middleware/error-handler.test.ts backend/tests/ai/complete.test.ts \
  backend/tests/ai/chat-persistence.test.ts docs/api-contract.md docs/venice-integration.md
git commit -m "[<bd-id>] ai: map UnknownModelError to 400 unknown_model (was 500 internal_error)"
```

---

### Task 3: Sweep `not_found` / `forbidden` literals in the non-streaming route files

**Root cause:** `lib/bad-request.ts` exists for 400s, but there is no equivalent for 404/403, so `{ error: { message: 'Not found', code: 'not_found' } }` and friends are hand-rolled: `stories.routes.ts:95,127,140`; `chapters.routes.ts:157,178,198,213,230,235,254,277,404`; `characters.routes.ts:126,147,167,173,190,195`; `outline.routes.ts:121,142,162,176,193,198`. Three of those (chapters `:156-158`, characters `:125-127`, outline `:120-122`) are `*NotOwnedError` catch ladders now handled centrally by Task 1.

**Fix:** Mechanical, file-by-file: replace each `res.status(404).json({ error: { message: '<msg>', code: 'not_found' } }); return;` with `throw notFound('<msg>');` — **preserving each route's exact message string** (`'Not found'` vs `'Chapter not found'` vs `'Message not editable'` etc. — the helper takes the message as its argument precisely because these differ and are frozen). Delete the three `*NotOwnedError` catch ladders (let the error propagate to the central 403 mapping). **Skip `ai.routes.ts` and `chat.routes.ts` entirely** (sequencing constraint — their `not_found` guards stay literal until after the stream-extraction plan; file a follow-up bd issue for that sweep rather than touching them here). Inside `validateBody` handlers a `throw` reaches the handler via `.catch(next)` (`validate.ts:15-17`); inside plain `try { … } catch (err) { next(err) }` handlers it forwards through the existing catch — no handler-signature changes needed.

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`, `backend/src/routes/chapters.routes.ts`, `backend/src/routes/characters.routes.ts`, `backend/src/routes/outline.routes.ts`
- Tests: **none created or modified** — `backend/tests/routes/{stories,story-detail,chapters,chapters-reorder,chapters.summarise,chapters.summary-put,characters,outline,chat-messages-list}.test.ts` already pin these exact 404/403 bodies (24 `not_found`/`forbidden` assertions across the suite) and are the regression net. If any of them fails, the sweep changed a message string — fix the code, not the test.

**Interfaces:**
- Consumes: `notFound` / `forbidden` from `../lib/http-errors`.
- Leaves alone: `badRequest` / `badRequestFromZod` call sites for semantic 400s (`chapters.routes.ts:139-147`, `characters.routes.ts:108-115`, `outline.routes.ts:107-113`) — those write a `validation_error` + `issues` body a plain `HttpError` can't carry; they stay response-helpers by design. Also leaves the domain-specific literals (`empty_chapter`, `model_unsupported_for_summarisation`, `summary_parse_failed` in chapters.routes; `attachment_chapter_mismatch` etc. in chat.routes) untouched — single-use, self-documenting, and (for chat.routes) out of bounds.

- [ ] **Step 1: Baseline green**

Run: `npm -w story-editor-backend run test -- stories story-detail chapters characters outline`
Expected: PASS (pre-change baseline).

- [ ] **Step 2: Sweep `stories.routes.ts`** — 3 literals → `throw notFound()` (message `'Not found'` for all three). Run `npm -w story-editor-backend run test -- stories story-detail`. Expected: PASS.

- [ ] **Step 3: Sweep `chapters.routes.ts`** — 8 `not_found` literals → `throw notFound('Not found')` / `throw notFound('Chapter not found')` (match each line's current message exactly); delete the `ChapterNotOwnedError` catch at `:156-161` (keep the surrounding `try`/`throw err` shape collapsing to a plain call — the reorder handler body becomes `await createChapterRepo(req).reorder(storyId, body.chapters); res.status(204).send();`). Keep the `Prisma P2002` retry logic (`:107-116`) untouched. Run `npm -w story-editor-backend run test -- chapters`. Expected: PASS (chapters.test.ts, chapters-reorder.test.ts pin the 403/404 bodies).

- [ ] **Step 4: Sweep `characters.routes.ts` and `outline.routes.ts`** — same pattern, delete their `*NotOwnedError` ladders. Run `npm -w story-editor-backend run test -- characters outline`. Expected: PASS.

- [ ] **Step 5: Typecheck + suite + commit**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- stories story-detail chapters characters outline`

```bash
git add backend/src/routes/stories.routes.ts backend/src/routes/chapters.routes.ts \
  backend/src/routes/characters.routes.ts backend/src/routes/outline.routes.ts
git commit -m "[<bd-id>] routes: replace hand-rolled not_found/forbidden literals with throwable helpers"
```

---

### Task 4: Collapse the auth.routes + venice-key.routes catch ladders

**Root cause:** `auth.routes.ts` repeats the same `catch { if ZodError → badRequestFromZod; if InvalidCredentialsError → 401; next(err) }` ladder 7 times (register `:150-162`, login `:170-182`, reset-password `:209-224`, change-password `:245-257`, update-profile `:275-281`, rotate-recovery-code `:327-339`, delete-account `:363-375`). `venice-key.routes.ts` has its own ladder (`:48-66`) **plus a drifted local duplicate of `badRequestFromZod`** (`:11-22`). All of these bodies are now produced identically by the Task 1 central table.

**Fix:** In each handler, replace the ladder body with a bare `catch (err) { next(err); }` (keep the explicit try/catch — Express 5 does auto-forward rejected async handlers, but the explicit `next(err)` keeps the diff minimal and unambiguous; do not restructure handlers beyond deleting the ladder rungs). Delete the now-unused imports (`ZodError` where no direct `.parse` catch remains — note the handlers still call `buildXSchema().parse(req.body)`, whose throw now rides `next(err)` to the central ZodError branch). In `venice-key.routes.ts`, delete the local `badRequestFromZod` clone and the whole ladder. **Do not change wire shapes**: the central branches reproduce every body byte-for-byte, including the reset-password/login timing-equality contract (`invalid_credentials` body identical across endpoints, [AU10] precedent noted at `auth.routes.ts:215-217` — preserve that comment by moving it onto the route's docblock). Leave the `if (!authed) { 401 unauthorized }` type-narrowing guards in place (they exist for TS narrowing of `req.user`, not as catch logic; converting them buys nothing).

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`, `backend/src/routes/venice-key.routes.ts`
- Tests: **none modified** — `backend/tests/auth/{auth.routes,login-username,register-username,reset-password,change-password,update-profile,rotate-recovery-code,delete-account,sign-out-everywhere}.test.ts` and `backend/tests/routes/venice-key.test.ts` pin every one of these bodies (69 `invalid_credentials`/`validation_error`/`username_unavailable` assertions across 20 files) and are the regression net.

**Interfaces:**
- Consumes: the Task 1 central branches for `ZodError`, `InvalidCredentialsError`, `UsernameUnavailableError`, `VeniceKeyInvalidError`, `VeniceKeyCheckError`.

- [ ] **Step 1: Baseline green** — `npm -w story-editor-backend run test -- auth venice-key`. Expected: PASS.

- [ ] **Step 2: Collapse `auth.routes.ts`** — delete the 7 ladders (each catch becomes `next(err)`), drop dead imports (`badRequestFromZod`, and `ZodError`/`InvalidCredentialsError`/`UsernameUnavailableError` if no longer referenced). Run `npm -w story-editor-backend run test -- auth`. Expected: PASS with zero test edits.

- [ ] **Step 3: Collapse `venice-key.routes.ts`** — delete the local `badRequestFromZod` duplicate (`:11-22`) and the PUT ladder (`:48-66` → `next(err)`); drop dead imports. Run `npm -w story-editor-backend run test -- venice-key`. Expected: PASS.

- [ ] **Step 4: Typecheck + full suite + commit**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test`
Expected: all PASS.

```bash
git add backend/src/routes/auth.routes.ts backend/src/routes/venice-key.routes.ts
git commit -m "[<bd-id>] auth/venice-key: collapse per-route catch ladders into central error mapping"
```

---

## Self-Review notes

- **Spec coverage:** error-literal sprawl → Tasks 3-4 (helpers + ladder collapse); domain errors reaching users as `internal_error` → Tasks 1-2 (central table; `UnknownModelError` is the one deliberate wire change, enumerated per-endpoint with new tests). `CiphertextMissingError` and `PromptValidationError` are decided-and-recorded as staying 500 (see table rationale) — deliberate non-mapping, not an omission.
- **Idiom decision recorded:** throwable `HttpError` + central instanceof table, NOT response helpers, with domain classes kept transport-agnostic (handler maps them; they never import Express). `badRequest`/`badRequestFromZod` intentionally survive as the only response-helpers because their `issues` payload doesn't fit the two-field `HttpError` body.
- **Sequencing:** executes after `2026-07-02-venice-stream-service-extraction.md`; zero code edits to `ai.routes.ts`/`chat.routes.ts` (one comment rewrite in Task 2 is the sole, trivially-rebased touch). SSE frames untouched. A follow-up bd issue should sweep those two files' `not_found` literals post-extraction.
- **Security invariants pinned:** prod stack-strip and message-genericisation are pre-existing tests left unmodified; a new test pins "mapped errors never carry a stack in any env"; every mapped message is a literal except `unknown_model` (client-supplied modelId only). `security-reviewer` auto-runs at close (touches `index.ts` bootstrap + `auth.routes.ts` + `venice-key.routes.ts`) — expected.
- **Egress-drift hazard closed:** central `ZodError → 400` would have reclassified `respond()`'s dev-mode egress-drift throw; Task 1 Step 5 wraps it in `EgressSchemaDriftError` so drift stays a 500, with a test.
- **Open items for implementer:** (1) confirm at implementation time that `chat.routes.ts`'s POST-messages catch re-throws non-Venice errors like `ai.routes.ts:323-324` does (read the tail of the handler; it was written to the same pattern) — if it swallows instead, the Task 2 chat-persistence test will catch it; (2) `DekNotAvailableError → 401 session_expired` is the plan's call but was flagged as a judgment call — if the user prefers it to stay a 500 (surfacing programmer error loudly), delete that branch and its test before dispatch; nothing else depends on it.
