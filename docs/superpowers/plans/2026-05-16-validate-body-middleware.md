# validateBody / validateQuery Ingress Middleware — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-handler `safeParse + early-return + try/catch` ingress boilerplate across 17 backend routes with a single type-safe wrapper, plus a small helper that harmonizes the reorder routes' post-parse semantic-error 400 envelope.

**Architecture:** Higher-order wrapper at `backend/src/middleware/validate.ts` exporting `validateBody<S>(schema, handler)` and `validateQuery<S>(schema, handler)`. The wrapper runs `schema.safeParse`, calls `badRequestFromZod` on failure, and invokes the handler with a `z.infer<S>`-typed `body` / `query` arg. Async-error safety is built in via `Promise.resolve(handler(...)).catch(next)`. A small `badRequest(res, message, path)` sibling helper added to `backend/src/lib/bad-request.ts` lets reorder routes' duplicate-id / duplicate-orderIndex semantic 400s emit the canonical `{ error: { message, code: 'validation_error', issues: [...] } }` envelope.

**Tech Stack:** Express 5 · TypeScript (strict) · Zod 4.4.3 · vitest.

**Spec:** [docs/superpowers/specs/2026-05-16-validate-body-middleware-design.md](../specs/2026-05-16-validate-body-middleware-design.md)

**bd issue:** `story-editor-xgb`

**Build invariant:** Every commit leaves typecheck + tests green. Each route file is its own task; the boilerplate-drop pattern is mechanical, the reorder-harmonization pattern is documented and exercised first in `characters.routes.ts` (Task 4) before being repeated in `chapters` and `outline`.

---

## File Structure

**Create:**
- `backend/src/middleware/validate.ts` — `validateBody` + `validateQuery` wrappers.
- `backend/tests/middleware/validate.test.ts` — wrapper unit tests (12 runtime + type-level proofs).

**Modify:**
- `backend/src/lib/bad-request.ts` — add `badRequest(res, message, path)` sibling helper.
- `backend/tests/lib/bad-request.test.ts` (create if missing) — test for the new helper.
- `backend/src/routes/stories.routes.ts` — 2 body sites.
- `backend/src/routes/characters.routes.ts` — 3 body sites incl. reorder semantic harmonization.
- `backend/src/routes/chapters.routes.ts` — 3 body sites incl. reorder.
- `backend/src/routes/outline.routes.ts` — 3 body sites incl. reorder.
- `backend/src/routes/chat.routes.ts` — 3 body + 1 query.
- `backend/src/routes/ai.routes.ts` — 1 body + envelope unification.
- `backend/src/routes/user-settings.routes.ts` — 1 body.

**Audit only (test files — should pass without changes; spec calls out three exceptions):**
- `backend/tests/routes/*.test.ts` — generally unchanged; AI completion tests update old-envelope assertions; reorder route tests update to expect the new `issues: [...]` field on semantic 400s.

**Total:** 17 callsites across 7 route files migrate to the wrappers; 6 reorder semantic-error sites adopt `badRequest`; 1 AI route envelope unifies onto the canonical shape.

---

## Task 1: `validateBody` / `validateQuery` Wrappers + Tests

**Files:**
- Create: `backend/src/middleware/validate.ts`
- Create: `backend/tests/middleware/validate.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// backend/tests/middleware/validate.test.ts
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '../../src/middleware/validate.js';

function makeMocks(body: unknown, query: unknown = {}): {
  req: Request;
  res: Response;
  next: NextFunction;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn(() => ({ json })) as unknown as Response['status'];
  const res = { status } as unknown as Response;
  const req = { body, query } as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status: status as unknown as ReturnType<typeof vi.fn>, json };
}

const fooSchema = z.strictObject({ foo: z.string() });

describe('validateBody', () => {
  it('invokes handler with parsed body on valid input', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ foo: 'hello' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with canonical envelope on invalid input; handler not invoked', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next, status, json } = makeMocks({ wrongKey: 1 });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'validation_error',
          issues: expect.any(Array),
        }),
      }),
    );
  });

  it('returns 400 on strict-extra-key violation', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next, status } = makeMocks({ foo: 'hello', extra: 1 });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('does not call next when async handler resolves', async () => {
    const mw = validateBody(fooSchema, async () => {});
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when async handler rejects', async () => {
    const err = new Error('boom');
    const mw = validateBody(fooSchema, async () => {
      throw err;
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls next(err) when sync handler throws', async () => {
    const err = new Error('sync boom');
    const mw = validateBody(fooSchema, () => {
      throw err;
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });
});

const queryFooSchema = z.strictObject({ kind: z.enum(['ask', 'scene']).optional() });

describe('validateQuery', () => {
  it('invokes handler with parsed query on valid input', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ kind: 'ask' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with canonical envelope on invalid query', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next, status, json } = makeMocks({}, { kind: 'archived' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'validation_error' }),
      }),
    );
  });

  it('returns 400 on strict-extra-key in query', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next, status } = makeMocks({}, { kind: 'ask', extra: '1' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('does not call next when async handler resolves', async () => {
    const mw = validateQuery(queryFooSchema, async () => {});
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when async handler rejects', async () => {
    const err = new Error('query boom');
    const mw = validateQuery(queryFooSchema, async () => {
      throw err;
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls next(err) when sync handler throws', async () => {
    const err = new Error('query sync boom');
    const mw = validateQuery(queryFooSchema, () => {
      throw err;
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });
});

// Type-level proofs — never executed; @ts-expect-error catches regressions
// to the schema↔handler generic linkage.
void function _typecheck() {
  validateBody(z.object({ foo: z.string() }), async (body) => {
    const _foo: string = body.foo;
    // @ts-expect-error — `bar` is not on the inferred type.
    const _bar: string = body.bar;
    void _foo;
    void _bar;
  });
  validateQuery(z.object({ kind: z.enum(['ask', 'scene']) }), async (query) => {
    const _kind: 'ask' | 'scene' = query.kind;
    // @ts-expect-error — wrong literal narrowing.
    const _wrong: 'archived' = query.kind;
    void _kind;
    void _wrong;
  });
};
```

- [ ] **Step 2: Run the test, expect FAIL**

The backend test suite requires the docker-compose stack up (bd memory `bd-verify-line-backend-test-needs-stack` — vitest's `globalSetup` unconditionally runs `db-test-reset.sh`). If not already running:

```bash
make dev
timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
```

Then:

```bash
npm -w story-editor-backend test -- tests/middleware/validate.test.ts
```

Expected: FAIL with `Cannot find module '../../src/middleware/validate.js'`.

- [ ] **Step 3: Write `backend/src/middleware/validate.ts`**

```ts
// backend/src/middleware/validate.ts
import type { Request, RequestHandler, Response } from 'express';
import type { z, ZodType } from 'zod';
import { badRequestFromZod } from '../lib/bad-request.js';

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

- [ ] **Step 4: Run the test, expect PASS**

```bash
npm -w story-editor-backend test -- tests/middleware/validate.test.ts
```

Expected: all 12 runtime tests PASS. Type-level `@ts-expect-error` proofs are enforced at typecheck time (next step).

- [ ] **Step 5: Typecheck the backend workspace**

```bash
npm -w story-editor-backend run typecheck
```

Expected: no errors. The `@ts-expect-error` lines in the test file are themselves required by TypeScript to be suppressing a real error — if the generic linkage is weakened later and `body.bar` becomes valid, this typecheck breaks.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/validate.ts backend/tests/middleware/validate.test.ts
git commit -m "[story-editor-xgb] backend: validateBody / validateQuery wrappers + tests"
```

---

## Task 2: `badRequest` Sibling Helper

**Files:**
- Modify: `backend/src/lib/bad-request.ts`
- Create or modify: `backend/tests/lib/bad-request.test.ts`

- [ ] **Step 1: Check whether a test file already exists**

```bash
ls backend/tests/lib/bad-request.test.ts 2>&1
```

If it exists, append the new describe block. If not, create the full file.

- [ ] **Step 2: Write the failing test (append or create)**

If creating the file from scratch, use:

```ts
// backend/tests/lib/bad-request.test.ts
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { badRequest } from '../../src/lib/bad-request.js';

describe('badRequest', () => {
  it('emits canonical envelope with synthesised issues array', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Duplicate id', ['chapters', 0, 'id']);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Duplicate id',
        code: 'validation_error',
        issues: [{ path: ['chapters', 0, 'id'], message: 'Duplicate id' }],
      },
    });
  });

  it('accepts an empty path array', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Top-level error', []);

    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Top-level error',
        code: 'validation_error',
        issues: [{ path: [], message: 'Top-level error' }],
      },
    });
  });

  it('accepts numeric path segments', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Bad index', [0, 1, 2]);

    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Bad index',
        code: 'validation_error',
        issues: [{ path: [0, 1, 2], message: 'Bad index' }],
      },
    });
  });
});
```

If the file already exists, just append the `describe('badRequest', ...)` block (and add the import for `badRequest`).

- [ ] **Step 3: Run the test, expect FAIL**

```bash
npm -w story-editor-backend test -- tests/lib/bad-request.test.ts
```

Expected: FAIL — `badRequest` not exported.

- [ ] **Step 4: Add `badRequest` to `backend/src/lib/bad-request.ts`**

Open `backend/src/lib/bad-request.ts`. After the existing `badRequestFromZod` export, append:

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

(`Response` is already imported in this file by `badRequestFromZod`; no new import needed.)

- [ ] **Step 5: Run the test, expect PASS**

```bash
npm -w story-editor-backend test -- tests/lib/bad-request.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/bad-request.ts backend/tests/lib/bad-request.test.ts
git commit -m "[story-editor-xgb] backend: badRequest helper for non-Zod semantic 400s"
```

---

## Task 3: Migrate `stories.routes.ts`

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`

Two body-validation sites, both straightforward (no reorder, no query, no Venice). Sets the migration pattern for the simpler routes.

- [ ] **Step 1: Confirm current site locations via grep**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/stories.routes.ts
```

Expected output:
```
63: ... storyCreateSchema.safeParse(req.body) ...
115: ... storyUpdateSchema.safeParse(req.body) ...
```

- [ ] **Step 2: Add imports**

At the top of `stories.routes.ts`, add (alphabetised within existing groups):

```ts
import { validateBody } from '../middleware/validate.js';
```

- [ ] **Step 3: Migrate the POST `/` handler (~line 63)**

Find the current handler shape:

```ts
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = storyCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const body = parsed.data;
  try {
    // ... existing handler logic ...
    return respond(storyResponseSchema, res, { story: serializeStory(row) }, 201);
  } catch (err) {
    console.error('[story.create]', err);
    next(err);
  }
});
```

Replace with:

```ts
router.post('/', requireAuth, validateBody(storyCreateSchema, async (body, req, res) => {
  // ... existing handler logic, unchanged except `parsed.data` → `body` ...
  return respond(storyResponseSchema, res, { story: serializeStory(row) }, 201);
}));
```

Concrete edits:
- Remove `safeParse + early-return` block (3 lines: declaration, `if (!parsed.success)`, `return`).
- Remove `const body = parsed.data;` if present.
- Remove the surrounding `try { ... } catch (err) { console.error('[story.create]', err); next(err); }` IF the catch is the boilerplate shape (just `console.error(tag) + next(err)`). The wrapper's `.catch(next)` covers it.
- Wrap the remaining handler body in `validateBody(storyCreateSchema, async (body, req, res) => { ... })`.
- Change handler signature from `(req, res, next)` to `(body, req, res)` (drop `next`).

**Important:** if the catch block does anything besides `console.error + next(err)` (e.g., maps a specific error to a specific HTTP status), keep it. Per spec: substantive catches stay. For `stories.routes.ts`, both catches should be boilerplate — verify before dropping.

- [ ] **Step 4: Migrate the PATCH `/:id` handler (~line 115)**

Same pattern. Replace:

```ts
router.patch('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = storyUpdateSchema.safeParse(req.body);
  // ... safeParse block + try/catch boilerplate ...
});
```

With:

```ts
router.patch('/:id', requireAuth, validateBody(storyUpdateSchema, async (body, req, res) => {
  // ... handler logic, with parsed.data → body ...
}));
```

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: no errors.

- [ ] **Step 6: Run the stories route tests**

Stack must be up (see Task 1 step 2).

```bash
npm -w story-editor-backend test -- tests/routes/stories tests/routes/story-detail
```

Expected: all tests PASS. No behavior change; same HTTP responses.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/stories.routes.ts
git commit -m "[story-editor-xgb] backend: stories.routes onto validateBody"
```

---

## Task 4: Migrate `characters.routes.ts` (first route with reorder harmonization)

**Files:**
- Modify: `backend/src/routes/characters.routes.ts`

Three body-validation sites: POST, PATCH `/reorder`, PATCH `/:characterId`. The reorder route's post-parse semantic checks (duplicate id, duplicate orderIndex) harmonize via `badRequest`. This task establishes the reorder pattern for chapters + outline.

- [ ] **Step 1: Confirm current site locations**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/characters.routes.ts
grep -nE "Duplicate|seenIds|seenOrders" backend/src/routes/characters.routes.ts
```

Expected output:
```
52:    ... characterCreateSchema.safeParse(req.body) ...
102:   ... characterReorderSchema.safeParse(req.body) ...
176:   ... characterUpdateSchema.safeParse(req.body) ...
```

Plus a few lines showing the current semantic-check `res.status(400).json(...)` calls in the reorder handler.

- [ ] **Step 2: Add imports**

```ts
import { validateBody } from '../middleware/validate.js';
import { badRequest } from '../lib/bad-request.js';
```

(If `bad-request.js` is already imported for `badRequestFromZod`, just add `badRequest` to the existing import block.)

- [ ] **Step 3: Migrate the POST `/` handler (~line 52)**

Same pattern as Task 3:

```ts
router.post('/', requireAuth, validateBody(characterCreateSchema, async (body, req, res) => {
  // ... handler logic, parsed.data → body ...
}));
```

Drop boilerplate try/catch if present.

- [ ] **Step 4: Migrate the PATCH `/reorder` handler (~line 102) with reorder harmonization**

This is the new pattern. Replace the current handler:

```ts
router.patch('/reorder', requireAuth, async (req, res, next) => {
  const parsed = characterReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const item of parsed.data.characters) {
    if (seenIds.has(item.id)) {
      res.status(400).json({ error: { message: 'Duplicate id', code: 'validation_error' } });
      return;
    }
    if (seenOrders.has(item.orderIndex)) {
      res.status(400).json({ error: { message: 'Duplicate orderIndex', code: 'validation_error' } });
      return;
    }
    seenIds.add(item.id);
    seenOrders.add(item.orderIndex);
  }
  // ... persist reorder ...
  res.status(204).send();
});
```

With (note: read the actual current handler body and preserve its persist-reorder logic verbatim — only the safeParse + semantic-400 shape changes):

```ts
router.patch('/reorder', requireAuth, validateBody(characterReorderSchema, async (body, req, res) => {
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const [i, item] of body.characters.entries()) {
    if (seenIds.has(item.id)) {
      return badRequest(res, `Duplicate character id "${item.id}"`, ['characters', i, 'id']);
    }
    if (seenOrders.has(item.orderIndex)) {
      return badRequest(res, `Duplicate orderIndex ${item.orderIndex}`, ['characters', i, 'orderIndex']);
    }
    seenIds.add(item.id);
    seenOrders.add(item.orderIndex);
  }
  // ... existing persist-reorder logic, unchanged ...
  res.status(204).send();
}));
```

Three concrete changes vs. the current handler:
1. Drop the `safeParse + early-return` block (the wrapper handles it).
2. Use `body.characters` instead of `parsed.data.characters`.
3. Replace each `res.status(400).json({ error: { message, code: 'validation_error' } })` with `return badRequest(res, message, path)`. The `path` is `['characters', i, 'id']` for duplicate-id and `['characters', i, 'orderIndex']` for duplicate-orderIndex.
4. Refactor the `for (const item of ...)` loop to `for (const [i, item] of ....entries())` so the index is available for the path.

- [ ] **Step 5: Migrate the PATCH `/:characterId` handler (~line 176)**

Same pattern as Task 3's PATCH handler:

```ts
router.patch('/:characterId', requireAuth, validateBody(characterUpdateSchema, async (body, req, res) => {
  // ... handler logic, parsed.data → body ...
}));
```

- [ ] **Step 6: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: no errors.

- [ ] **Step 7: Run characters route tests (and audit reorder tests)**

```bash
npm -w story-editor-backend test -- tests/routes/characters
```

Expected: most tests PASS as-is. The reorder duplicate-id / duplicate-orderIndex tests may need updating to expect the new `issues: [...]` field. If a test fails because it asserts on a `message` that included `"index N"` (e.g., the old `Duplicate id at index 1`), update the assertion to match the new message format (`Duplicate character id "xyz"`). The new shape has the index in `path: ['characters', i, 'id']` instead.

**If a reorder test fails:** update the test assertion. Don't change `badRequest` to emit the old shape. The migration is shape harmonization — the new envelope is the intended state.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/characters.routes.ts backend/tests/routes/characters.test.ts
git commit -m "[story-editor-xgb] backend: characters.routes onto validateBody + reorder harmonization"
```

---

## Task 5: Migrate `chapters.routes.ts`

**Files:**
- Modify: `backend/src/routes/chapters.routes.ts`

Three body-validation sites: POST, PATCH `/reorder`, PATCH `/:chapterId`. Same pattern as characters (Task 4). The reorder semantic check harmonizes via `badRequest`.

- [ ] **Step 1: Confirm current sites**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/chapters.routes.ts
```

Expected:
```
63:   chapterCreateSchema.safeParse(req.body)
118:  chapterReorderSchema.safeParse(req.body)
195:  chapterUpdateSchema.safeParse(req.body)
```

- [ ] **Step 2: Add imports**

```ts
import { validateBody } from '../middleware/validate.js';
import { badRequest } from '../lib/bad-request.js';
```

- [ ] **Step 3: Migrate POST `/` (~line 63)**

```ts
router.post('/', requireAuth, validateBody(chapterCreateSchema, async (body, req, res) => {
  // ... handler logic; parsed.data → body; preserve computeWordCount(body.bodyJson) ...
}));
```

The wordCount computation (`const wordCount = body.bodyJson === undefined ? 0 : computeWordCount(body.bodyJson);` at ~line 76 in the current file) stays — it's plaintext-from-JSON-before-encryption, the repo-boundary invariant.

- [ ] **Step 4: Migrate PATCH `/reorder` (~line 118) with reorder harmonization**

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
  // ... existing persist-reorder logic, unchanged ...
  res.status(204).send();
}));
```

- [ ] **Step 5: Migrate PATCH `/:chapterId` (~line 195)**

```ts
router.patch('/:chapterId', requireAuth, validateBody(chapterUpdateSchema, async (body, req, res) => {
  // ... handler logic; preserve the wordCount recomputation when body.bodyJson is present ...
  // (existing: `if (body.bodyJson !== undefined) input.wordCount = computeWordCount(body.bodyJson);`)
}));
```

- [ ] **Step 6: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

- [ ] **Step 7: Run chapter route tests**

```bash
npm -w story-editor-backend test -- tests/routes/chapters tests/routes/chapters-body-json tests/routes/chapters-reorder
```

Expected: all PASS. Same reorder-test caveat as Task 4 step 7.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/chapters.routes.ts backend/tests/routes/chapters-reorder.test.ts backend/tests/routes/chapters.test.ts backend/tests/routes/chapters-body-json.test.ts
git commit -m "[story-editor-xgb] backend: chapters.routes onto validateBody + reorder harmonization"
```

(Only stage the test files that were actually modified.)

---

## Task 6: Migrate `outline.routes.ts`

**Files:**
- Modify: `backend/src/routes/outline.routes.ts`

Same pattern as Task 5. Three sites: POST, PATCH `/reorder`, PATCH `/:outlineId`.

- [ ] **Step 1: Confirm current sites**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/outline.routes.ts
```

Expected:
```
52:  outlineCreateSchema.safeParse(req.body)
101: outlineReorderSchema.safeParse(req.body)
175: outlineUpdateSchema.safeParse(req.body)
```

- [ ] **Step 2: Add imports**

```ts
import { validateBody } from '../middleware/validate.js';
import { badRequest } from '../lib/bad-request.js';
```

- [ ] **Step 3: Migrate POST `/`**

```ts
router.post('/', requireAuth, validateBody(outlineCreateSchema, async (body, req, res) => {
  // ... handler logic ...
}));
```

- [ ] **Step 4: Migrate PATCH `/reorder` with reorder harmonization**

```ts
router.patch('/reorder', requireAuth, validateBody(outlineReorderSchema, async (body, req, res) => {
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const [i, item] of body.items.entries()) {
    if (seenIds.has(item.id)) {
      return badRequest(res, `Duplicate outline item id "${item.id}"`, ['items', i, 'id']);
    }
    if (seenOrders.has(item.order)) {
      return badRequest(res, `Duplicate order ${item.order}`, ['items', i, 'order']);
    }
    seenIds.add(item.id);
    seenOrders.add(item.order);
  }
  // ... existing persist-reorder logic ...
  res.status(204).send();
}));
```

**Note for the implementer:** verify the actual field names in `outlineReorderSchema` before pasting. Outline items use `order` (not `orderIndex`) and the reorder payload's array field name may be `items` (or whatever the current schema declares). Read the schema to confirm, then adjust the loop iteration and path tuples accordingly. The pattern is unchanged; only the field names differ from chapters/characters.

- [ ] **Step 5: Migrate PATCH `/:outlineId`**

```ts
router.patch('/:outlineId', requireAuth, validateBody(outlineUpdateSchema, async (body, req, res) => {
  // ... handler logic ...
}));
```

- [ ] **Step 6: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

- [ ] **Step 7: Run outline route tests**

```bash
npm -w story-editor-backend test -- tests/routes/outline
```

Expected: PASS. Same reorder-test caveat as Task 4 step 7.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/outline.routes.ts backend/tests/routes/outline.test.ts
git commit -m "[story-editor-xgb] backend: outline.routes onto validateBody + reorder harmonization"
```

---

## Task 7: Migrate `chat.routes.ts` (first use of `validateQuery`)

**Files:**
- Modify: `backend/src/routes/chat.routes.ts`

Four sites: 3 body + 1 query.

- [ ] **Step 1: Confirm current sites**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/chat.routes.ts
```

Expected:
```
70:  chatCreateSchema.safeParse(req.body)
102: ListChatsQuery.safeParse(req.query)
145: chatUpdateSchema.safeParse(req.body)
231: sendMessageBodySchema.safeParse(req.body)
```

- [ ] **Step 2: Add imports**

```ts
import { validateBody, validateQuery } from '../middleware/validate.js';
```

- [ ] **Step 3: Migrate POST `/chats` (~line 70)**

```ts
router.post('/', requireAuth, validateBody(chatCreateSchema, async (body, req, res) => {
  const chapterId = req.params.chapterId as string;
  // ... handler logic; preserve ownership check on chapter ...
}));
```

Note: this handler currently has a `try { ... } catch (err) { console.error('[chat.create]', err); next(err); }` block. That's boilerplate — drop it; the wrapper's `.catch(next)` covers it.

- [ ] **Step 4: Migrate GET `/chats` (~line 102) — query validation**

```ts
router.get('/', requireAuth, validateQuery(ListChatsQuery, async (query, req, res) => {
  const chapterId = req.params.chapterId as string;
  const { kind } = query;
  // ... handler logic ...
}));
```

The `try { ... } catch (err) { console.error('[chat.list]', err); next(err); }` block is also boilerplate — drop.

- [ ] **Step 5: Migrate PATCH `/:id` (~line 145)**

```ts
router.patch('/:id', requireAuth, validateBody(chatUpdateSchema, async (body, req, res) => {
  const id = req.params.id as string;
  // ... handler logic; preserve ownership-via-repo ...
}));
```

Boilerplate catch — drop.

- [ ] **Step 6: Migrate POST `/:chatId/messages` (~line 231)**

```ts
router.post('/', requireAuth, validateBody(sendMessageBodySchema, async (body, req, res) => {
  const chatId = req.params.chatId as string;
  // ... handler logic ...
}));
```

**Important — Venice-error catch decision:** this handler calls Venice via the streaming pipeline. If the existing catch block does anything beyond `console.error + next(err)` (e.g., maps a specific Venice error type to a specific HTTP status, calls `mapVeniceError`, or emits a specific SSE error frame), **keep it.** Per spec: substantive catches stay.

Audit: read the current catch block carefully. If it does only `console.error(tag); next(err);` → drop. If it does `mapVeniceErrorToSse(...)` or similar → keep the catch (the wrapper's `.catch(next)` only fires for errors that escape past the substantive catch).

- [ ] **Step 7: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

- [ ] **Step 8: Run chat route tests**

```bash
npm -w story-editor-backend test -- tests/routes/chat
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/chat.routes.ts
git commit -m "[story-editor-xgb] backend: chat.routes onto validateBody / validateQuery"
```

---

## Task 8: Migrate `ai.routes.ts` (envelope unification)

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`
- Modify: `backend/tests/routes/ai-*.test.ts` (any test that asserts on the old envelope shape)

The AI route's bespoke `{ code: 'invalid_request', details: flatten() }` envelope migrates onto the canonical `{ code: 'validation_error', issues: [...] }`. Frontend `useAICompletion.ts:127` passes `err.code` through generically — verified safe.

- [ ] **Step 1: Confirm current site**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/ai.routes.ts
grep -n "invalid_request\|flatten" backend/src/routes/ai.routes.ts
```

Expected:
```
70: CompleteBody.safeParse(req.body)
73: ... 'invalid_request' ...
75: ... parsed.error.flatten() ...
```

- [ ] **Step 2: Add imports**

```ts
import { validateBody } from '../middleware/validate.js';
```

- [ ] **Step 3: Migrate POST `/complete` (~line 70)**

Replace the current handler:

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
  // ...
});
```

With:

```ts
router.post('/complete', requireAuth, validateBody(CompleteBody, async (body, req, res) => {
  // ... existing handler logic, parsed.data → body ...
}));
```

The 400 response now carries `code: 'validation_error'` + `issues: [{ path, message }]` instead of `code: 'invalid_request'` + `details: flatten()`. This is intentional per the spec.

**Venice-error catches stay.** This route has substantive Venice-error handling (e.g., `NoVeniceKeyError → 409`, model errors → 500). Audit the catch blocks carefully — keep the substantive ones, drop only `console.error + next(err)` boilerplate.

- [ ] **Step 4: Audit AI-completion tests for envelope assertions**

```bash
grep -rnE "invalid_request|flatten|details:" backend/tests/routes/ | head -20
```

For each test that asserts on the old envelope (`expect(...).code).toBe('invalid_request')` or similar), update the assertion to the canonical shape:

```ts
// Before:
expect(res.body.error.code).toBe('invalid_request');
expect(res.body.error.details).toBeDefined();

// After:
expect(res.body.error.code).toBe('validation_error');
expect(res.body.error.issues).toBeInstanceOf(Array);
```

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

- [ ] **Step 6: Run AI route tests**

```bash
npm -w story-editor-backend test -- tests/routes/ai
```

Expected: all PASS after the envelope-assertion updates in Step 4.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ai.routes.ts backend/tests/routes/ai-*.test.ts
git commit -m "[story-editor-xgb] backend: ai.routes onto validateBody + canonical error envelope"
```

---

## Task 9: Migrate `user-settings.routes.ts`

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts`

One body-validation site: PATCH `/`. Simplest of the bunch.

- [ ] **Step 1: Confirm current site**

```bash
grep -nE "\.safeParse\(req\." backend/src/routes/user-settings.routes.ts
```

Expected:
```
190: SettingsSchema.safeParse(req.body)
```

- [ ] **Step 2: Add imports**

```ts
import { validateBody } from '../middleware/validate.js';
```

- [ ] **Step 3: Migrate PATCH `/` (~line 190)**

```ts
router.patch('/', requireAuth, validateBody(SettingsSchema, async (body, req, res) => {
  // ... handler logic; parsed.data → body ...
}));
```

Drop boilerplate try/catch if present.

- [ ] **Step 4: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

- [ ] **Step 5: Run user-settings route tests**

```bash
npm -w story-editor-backend test -- tests/routes/user-settings
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts
git commit -m "[story-editor-xgb] backend: user-settings.routes onto validateBody"
```

---

## Task 10: Full Verify Run + Handoff to `/bd-close-reviewed`

The bd verify line for `story-editor-xgb`, run end-to-end.

- [ ] **Step 1: Confirm stack is up**

```bash
make dev
timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
```

- [ ] **Step 2: Run the canonical verify line**

```bash
npm -w story-editor-backend run typecheck \
 && npm -w story-editor-backend test -- tests/middleware/validate tests/lib/bad-request tests/routes
```

Expected: ALL green. ~150+ tests covering the wrapper, the helper, and every migrated route.

- [ ] **Step 3: Sanity-grep for leftover safeParse and old envelope**

```bash
# No raw safeParse(req.body/query) should remain in routes/:
grep -rnE "\.safeParse\(req\." backend/src/routes/ || echo "✓ no leftover safeParse"

# No 'invalid_request' code should remain anywhere:
grep -rn "'invalid_request'" backend/src/ || echo "✓ no invalid_request leftover"

# No boilerplate console.error tags should remain on bare-catch shape:
grep -rnE "console\.error\('\\[[a-z\\.]+\\]'" backend/src/routes/
# The remaining matches should be only inside SUBSTANTIVE catches (Venice mapping, etc.) — review each.
```

- [ ] **Step 4: Inspect the final diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected file list:
- `backend/src/middleware/validate.ts` (new)
- `backend/tests/middleware/validate.test.ts` (new)
- `backend/src/lib/bad-request.ts` (modified)
- `backend/tests/lib/bad-request.test.ts` (new or modified)
- `backend/src/routes/{stories,characters,chapters,outline,chat,ai,user-settings}.routes.ts` (7 modified)
- `backend/tests/routes/ai-*.test.ts` (modified — envelope-assertion updates)
- Possibly `backend/tests/routes/{characters,chapters,outline}.test.ts` if reorder semantic-error assertions were updated

No untracked files. No bd state drift inside the migration tasks (bd close happens in Step 5).

- [ ] **Step 5: Hand off to `/bd-close-reviewed`**

```
/bd-close-reviewed story-editor-xgb
```

`/bd-close-reviewed` runs typecheck, the verify line, and the path-matched surface reviewers. Path-matched here:
- `security-reviewer` is **out of lane** (no auth / middleware / Venice-key / crypto-bootstrap touches).
- `repo-boundary-reviewer` is **out of lane** (no repo changes, no narrative-route encryption surface changes — validateBody only handles ingress validation upstream of the repo).

So the close-gate will run typecheck + verify only. On clean: `bd close`.

---

## Self-Review

**Spec coverage:** every section of `docs/superpowers/specs/2026-05-16-validate-body-middleware-design.md` is implemented:
- Wrapper API → Task 1 (with both runtime tests + type-level proofs).
- File structure (validate.ts, badRequest helper) → Task 1 + Task 2.
- 17 callsites across 7 route files → Tasks 3–9.
- Boilerplate-drop pattern → Tasks 3–9 step descriptions.
- Reorder-harmonization pattern → Task 4 (first), Task 5 + 6 (repeat).
- AI envelope unification → Task 8.
- Venice-error catch preservation → called out in Task 7 (chat messages) and Task 8 (ai.complete).
- Verify line → Task 10.

**Placeholder scan:** no TBDs, no TODOs, every step has the actual content. Reorder field-name caveat in Task 6 step 4 is a real instruction (read the schema, adjust the field names), not a TBD.

**Type consistency:** every reference uses `validateBody` / `validateQuery` / `badRequest` / `badRequestFromZod` consistently. The `body` / `query` arg name is consistent across tasks. The handler signature shape `(body, req, res) => ...` is the same in every route migration.

**Sequence ordering:** Task 2 (badRequest helper) lands before Task 4 (first route to use it). Task 1 (validate.ts) lands before Task 3 (first route to use it). Tasks 5 + 6 can run in parallel after Task 4 (they share the reorder pattern from characters). Otherwise sequential.
