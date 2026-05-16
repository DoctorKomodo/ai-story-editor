# validateBody / validateQuery Ingress Middleware

**Status:** Draft
**Date:** 2026-05-16
**bd issue:** `story-editor-xgb`
**Related:** `story-editor-c0c` (richer Venice error passthrough — follow-up, not blocking)

## Goal

Replace the per-handler `safeParse + early-return + try/catch + console.error(tag) + next(err)` ingress boilerplate across all 17 schema-validating backend route handlers with a single, type-safe wrapper. Migration is workspace-wide in one PR per the bd issue's "avoid asymmetry" directive: 16 body-validation sites + 1 query-validation site = 17 callsites. The AI route is one of the body sites; its migration also unifies the bespoke error envelope. The three reorder routes additionally harmonize their post-parse semantic-error 400 shapes onto the canonical envelope (see "Reorder routes" below).

This is the consolidation series's symmetric ingress equivalent: the wire shape is owned by `story-editor-shared`, validated at egress via `respond(schema, res, data)`, and now validated at ingress via `validateBody(schema, handler)`.

## Two goals

1. **Eliminate ingress boilerplate.** Each route currently has 4–8 lines of `safeParse + early-return + try/catch` per handler — same shape 17 times. Replace with a single wrapper at route registration.
2. **Close the schema↔handler contract gap.** Today nothing prevents a handler from declaring `Request<_, _, FooInput>` while the middleware validates against `BarSchema`. The wrapper makes the schema's inferred type the *only* way to read `body` — TypeScript enforces the link, no cast, no module augmentation.

## The wrapper API

```ts
// backend/src/middleware/validate.ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType, z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';

export function validateBody<S extends ZodType>(
  schema: S,
  handler: (body: z.infer<S>, req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    Promise.resolve(handler(parsed.data, req, res)).catch(next);
  };
}

export function validateQuery<S extends ZodType>(
  schema: S,
  handler: (query: z.infer<S>, req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    Promise.resolve(handler(parsed.data, req, res)).catch(next);
  };
}
```

### Properties locked in by this shape

- **Compiler-enforced schema↔handler link.** `body` / `query` is typed from `z.infer<S>` where `S` is the schema passed to the wrapper. There is no second place to declare the type, so no opportunity for drift.
- **Async-safe by construction.** `Promise.resolve(handler(...)).catch(next)` routes both sync throws and async rejections to Express's error pipeline. Handlers throw on error; the wrapper handles forwarding.
- **`req.body` is not mutated.** The parsed value lives in the wrapper closure and the handler's `body` arg only. `req.body` remains the raw client input. This is intentionally narrative-content-safe — there's no stable post-validation `req.body` that downstream code might accidentally log. (Narrative routes' `req.body` is plaintext title / TipTap body JSON; preserving it under a stable name where future code might log it is exactly the leak vector repo-boundary.md closes.)
- **Standard Express idiom for auth composition.** `requireAuth` middleware chains as today: `router.post('/', requireAuth, validateBody(schema, async (body, req, res) => ...))`.
- **Observability seam available.** The wrapper sees both edges of every wrapped handler (validation outcome + handler resolution). One drop-in point in `validate.ts` instruments all 17 routes. Not used in this PR; latent for when structured logging arrives.
- **Handler signature drops `next`.** None of the current 17 sites call `next()` directly to fall through to a subsequent handler; they only call `next(err)` from error paths, which the wrapper's `.catch(next)` now handles. Handlers throw to forward errors. If a future route needs middleware fall-through via explicit `next()`, add it to the handler signature at that point — not by default today.

### Why option C (wrapper) over A (overwrite `req.body`) or D (inline `parse`)

Three plausible alternatives were considered:

- **A.2 — standard middleware + typed `Request<P, _, T>` generic on the handler.** Express-idiomatic. Cast-free at use site (`req.body` typed via the handler's signature generic). Rejected because TypeScript cannot enforce that the route registration's middleware schema matches the handler's declared `T` — a developer can declare `Request<_, _, FooInput>` on a handler that was validated against `BarSchema`. That's the exact drift the consolidation series has been closing.
- **B — `req.validatedBody`, module-augmented.** Module-augment `Express.Request` with a `validatedBody?: unknown` prop. Dominated: same `as T` cast as A.1, plus a permanent global type addition, plus a stable post-validation prop where future logging could accidentally land narrative content.
- **D — inline `schema.parse(req.body)` at handler top + global error handler maps `ZodError → 400`.** Zero new abstraction, schema-handler contract is local. Rejected because the bd issue specifically wants middleware shape for route-registration-time visibility — "which routes validate which schema" is visible at the route table, not buried 30 lines into each handler.

C is the only option that delivers compiler-enforced schema↔handler linkage, async-error safety as a net upgrade, and registration-time visibility — at the cost of a small paradigm mix with `requireAuth` (cosmetic).

## File structure

**Create:**
- `backend/src/middleware/validate.ts` — the two wrappers (~30 lines including imports).
- `backend/tests/middleware/validate.test.ts` — unit tests for both wrappers.

**Modify `backend/src/lib/bad-request.ts`** — add a small sibling helper for non-Zod semantic 400s (the reorder routes' duplicate-id / duplicate-orderIndex checks). Same canonical envelope, synthesised `issues: [...]` array:

```ts
export function badRequest(
  res: Response,
  message: string,
  path: (string | number)[],
): Response {
  return res.status(400).json({
    error: {
      message,
      code: 'validation_error',
      issues: [{ path, message }],
    },
  });
}
```

**Modify (7 route files, 17 callsites — 16 body + 1 query; the AI route is one of the body sites and additionally drops its bespoke error envelope; the three reorder routes' semantic 400s adopt `badRequest`):**

| File | Sites | Notes |
|---|---|---|
| `backend/src/routes/stories.routes.ts` | POST `/`, PATCH `/:id` | Plain body. |
| `backend/src/routes/chapters.routes.ts` | POST `/`, PATCH `/reorder`, PATCH `/:chapterId` | Reorder route keeps its post-parse duplicate-id / duplicate-orderIndex semantic checks. |
| `backend/src/routes/characters.routes.ts` | POST `/`, PATCH `/reorder`, PATCH `/:characterId` | Same — reorder keeps semantic checks. |
| `backend/src/routes/outline.routes.ts` | POST `/`, PATCH `/reorder`, PATCH `/:outlineId` | Same. |
| `backend/src/routes/chat.routes.ts` | POST `/chats`, GET `/chats` (query), PATCH `/:id`, POST `/messages` | GET uses `validateQuery(ListChatsQuery, ...)`. |
| `backend/src/routes/ai.routes.ts` | POST `/complete` | **Envelope migration**: drops the bespoke `{ code: 'invalid_request', details: flatten() }` shape; adopts the canonical `{ code: 'validation_error', issues: [...] }` via `validateBody`. |
| `backend/src/routes/user-settings.routes.ts` | PATCH `/` | Plain body. |

The wrapper calls the existing `badRequestFromZod` on schema-validation failure; the new `badRequest` helper is only used by the reorder routes' semantic post-parse checks.

## Migration pattern

### The boilerplate-drop case (most sites)

**Before:**
```ts
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = chapterCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const body = parsed.data;
  try {
    // ... handler logic ...
    return respond(chapterResponseSchema, res, { chapter: serializeChapter(row) }, 201);
  } catch (err) {
    console.error('[chapter.create]', err);
    next(err);
  }
});
```

**After:**
```ts
router.post('/', requireAuth, validateBody(chapterCreateSchema, async (body, req, res) => {
  // body is typed ChapterCreateInput — no cast needed.
  // ... handler logic — throws on error, wrapper does .catch(next) ...
  return respond(chapterResponseSchema, res, { chapter: serializeChapter(row) }, 201);
}));
```

Net change per handler: −5 lines on average. The `[chapter.create]`-style `console.error` route tags are dropped — the global error handler in `src/index.ts` already logs the request path, so the tag is redundant. (If a tag turns out to be load-bearing during the migration, the wrapper can take an optional `name` param later; out of scope for this PR.)

### Reorder routes (chapters / characters / outline)

The three reorder routes do **post-parse semantic validation** (duplicate id, duplicate orderIndex checks). The post-parse semantic check stays in the handler — the wrapper only handles schema parse + 400 on schema failure. The semantic 400 shape **harmonizes onto the canonical envelope** via the new `badRequest` helper:

```ts
router.patch('/reorder', requireAuth, validateBody(chapterReorderSchema, async (body, req, res) => {
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const [i, item] of body.chapters.entries()) {
    if (seenIds.has(item.id)) {
      return badRequest(res, `Duplicate chapter id "${item.id}"`, ['chapters', i, 'id']);
    }
    if (seenOrders.has(item.orderIndex)) {
      return badRequest(res, `Duplicate orderIndex ${item.orderIndex}`, ['chapters', i, 'orderIndex']);
    }
    seenIds.add(item.id);
    seenOrders.add(item.orderIndex);
  }
  // ... persist reorder ...
  res.status(204).send();
}));
```

Wire-format change for the reorder semantic 400s: response now carries `issues: [{ path, message }]` alongside the existing `message` + `code: 'validation_error'`. The `code` is unchanged, so any frontend consumer switching on `code` is unaffected. The added `issues` field is additive — consumers that didn't read it continue to ignore it.

### AI route — envelope unification

**Before** (`ai.routes.ts:70`):
```ts
router.post('/complete', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: 'Invalid request',
        code: 'invalid_request',
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  const body = parsed.data;
  // ... handler ...
});
```

**After:**
```ts
router.post('/complete', requireAuth, validateBody(CompleteBody, async (body, req, res) => {
  // ... handler ...
}));
```

Wire-format change: the 400 response now carries `code: 'validation_error'` + `issues: [{ path, message }]` instead of `code: 'invalid_request'` + `details: flatten()`. Frontend `useAICompletion.ts:127` reads `err.code` generically (`code: err.code ?? null`) — verified to not depend on the old code string or the `details` shape. No frontend changes required.

### Venice-error catches stay

**Important precision point.** The migration drops only the **boilerplate** `try { ... } catch (err) { console.error(tag); next(err); }` pattern — catch blocks that map Venice errors to specific HTTP shapes (e.g., distinguishing `VeniceRateLimitError` → 429 with `retryAfterSeconds` from `VeniceUnauthorizedError` → 401) **stay**. Per backend.md: "No per-route try/catch unless the catch adds genuinely useful context" — Venice mapping IS context. The wrapper's `.catch(next)` is for the "no mapping needed, just forward" case.

This makes the routes that do (or should do) substantive Venice error mapping stand out clearly post-migration — a grep for `catch (err)` in `routes/` returns only the substantive cases. The follow-up `story-editor-c0c` (richer Venice error passthrough) builds on this — that work expands the substantive catches; this PR creates the clean baseline they'll grow from.

## Tests

`backend/tests/middleware/validate.test.ts` — plain vitest unit tests against `validateBody` / `validateQuery` directly. No Express server required; construct fake `req` / `res` / `next` objects.

Coverage matrix per wrapper (12 runtime tests total — 6 per wrapper):

- Valid input → handler invoked with parsed value typed via `z.infer<S>`.
- Invalid input → `res.status(400).json(...)` called with the canonical `{ code: 'validation_error', issues: [...] }` envelope; handler NOT invoked.
- Schema with strict-extra-key violation → 400 (uses the existing `chapterCreateSchema` or a tiny inline `z.strictObject` to exercise this).
- Async handler resolves → `next` NOT called.
- Async handler rejects → `next(err)` called with the rejection reason.
- Sync handler throws → `next(err)` called with the thrown error.

Plus **type-level proofs** (no runtime — `@ts-expect-error` annotations enforce at compile time that the wrapper's generic actually links the schema to the handler arg):

```ts
// Inside the test file, never executed at runtime:
void function _typecheck() {
  validateBody(z.object({ foo: z.string() }), async (body) => {
    const _foo: string = body.foo;           // typed from schema — compiles.
    // @ts-expect-error — `bar` is not on the inferred type.
    const _bar: string = body.bar;
  });
  validateQuery(z.object({ kind: z.enum(['ask', 'scene']) }), async (query) => {
    const _kind: 'ask' | 'scene' = query.kind;
    // @ts-expect-error — wrong literal narrowing.
    const _wrong: 'archived' = query.kind;
  });
};
```

The `@ts-expect-error` lines are the durable signal: if a future refactor weakens the wrapper's generic so that `body.bar` becomes valid, the `@ts-expect-error` itself becomes invalid (no error to suppress) and TypeScript fails the build. This catches regressions to the schema↔handler contract — the load-bearing property of Option C.

Existing route tests (`backend/tests/routes/*.test.ts`, ~15 files) are **not expected to change** for the body-validation migrations. The migration preserves HTTP behavior — same 400 envelope, same success-path responses. Three exceptions to audit:

1. AI route tests — any assertion on the old error envelope (`code: 'invalid_request'` or `details: ...`) gets updated to the canonical shape (`code: 'validation_error'`, `issues: [...]`).
2. Reorder route tests — any assertion on the semantic 400 envelope (duplicate-id / duplicate-orderIndex) gets updated to assert the canonical `issues: [...]` field is present alongside `message` + `code`.
3. If any test asserts on the absence of a field that the new shape adds, update it.

## Non-goals

- **Structured logging.** The wrapper has the observability seam available; this PR does not add a logger. Latent benefit.
- **`validateParams` wrapper.** Path params come from route definitions, are always strings, and are read directly. No route currently parses path params via Zod. Not needed.
- **Combined `validate({ body, query })` wrapper.** Zero current routes validate both body and query together. YAGNI — if the need lands later, add the combined wrapper at that point.
- **Custom error-formatter API on `validateBody`.** AI is the only outlier and is being unified. No future formatter API surface added.
- **Richer Venice error passthrough.** Tracked separately as `story-editor-c0c`. The migration creates the clean baseline by dropping boilerplate catches and preserving substantive ones — actually expanding the substantive catches is the follow-up's scope.

## Verify line

```
make dev
 && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
 && npm -w story-editor-backend run typecheck
 && npm -w story-editor-backend test -- tests/middleware/validate tests/routes
```

The full route test suite under `tests/routes/*` runs to confirm no migration site changed HTTP behavior.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| A substantive Venice-error catch is accidentally dropped during the migration as if it were boilerplate. | Spec calls this out explicitly; the implementer audits each catch block before dropping. A `git grep "catch (err)"` in `routes/` before vs after gives a sanity check. |
| The AI route's `code: 'invalid_request'` is depended on by some consumer the verification missed. | Verified `useAICompletion.ts` reads `err.code` generically. No other frontend consumer of `POST /api/ai/complete`. If an external consumer exists, it's not visible from the repo; the project is internal-only, so the risk is low. |
| Async handler errors that the wrapper forwards via `.catch(next)` reach the global error handler — which currently emits an opaque 500. If a route's substantive Venice catch had previously been emitting a specific 4xx, but during the migration someone accidentally drops that catch, the user-visible error degrades silently. | Same mitigation as the first row — implementer audits catches. Also covered by the existing route tests, which will fail if a specific-error path stops emitting its specific shape. |
| `respond()` return value flowing through the wrapper's `Promise.resolve(handler(...))` chain — does the wrapper care? | No. The wrapper only attaches a `.catch(next)`; the resolved value is discarded. `respond()` returns the `Response` object (chainable) — passing through harmlessly. |
| Reorder semantic 400 shape change (added `issues` field) breaks a consumer that asserts on the *absence* of `issues`. | Change is additive: `code` and `message` are preserved; only `issues` is new. The frontend consumer of reorder errors (ChapterList / similar dnd flows) renders `message` — no `issues`-shape dependency. Updated reorder route tests cover the new field. |

## Sequence (rough — full breakdown comes from `writing-plans`)

1. Write `backend/src/middleware/validate.ts` (validateBody + validateQuery) and add the `badRequest` helper to `backend/src/lib/bad-request.ts`. Write `tests/middleware/validate.test.ts` (12 runtime + type-level proofs); tests fail (modules not exported); implement; tests pass.
2. Migrate `stories.routes.ts` (2 sites — simplest pair, no semantic post-parse).
3. Migrate `characters.routes.ts` (3 sites incl. reorder — first site that exercises both `validateBody` AND the harmonized `badRequest` for the reorder semantic check; sets the pattern for chapters / outline).
4. Migrate `chapters.routes.ts` + `outline.routes.ts` (parallel — same shape as characters).
5. Migrate `chat.routes.ts` (3 body + 1 query — first use of `validateQuery`).
6. Migrate `ai.routes.ts` (envelope unification — update the AI-completion tests' error-shape assertions to the canonical envelope).
7. Migrate `user-settings.routes.ts` (1 site).
8. Run the full verify line.

Each step commits cleanly with the build green. The implementation plan will break each step into TDD-shaped tasks with checkpoints.
