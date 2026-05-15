# OutlineItem entity consolidation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `OutlineItem` to a single canonical Zod schema set in `story-editor-shared`, rip out the inline backend validators + the frontend hand-rolled interfaces, apply `respond()` egress on every surviving success-path handler, and add `serializeOutlineItem` at the handler boundary — all in one PR.

**Architecture:** Pattern-copy of PR #100 (Character), PR #104 (Message), and PR #105 (Story). The `shared/` workspace, `respond()`, `serialize*`, and the `*ResponseSchema.parse(…)` frontend idiom already exist — this plan extends them to OutlineItem. Tasks are ordered so each typecheck stays green at commit time: shared schemas first (no consumers), then `serializeOutlineItem` (additive), then repo → routes (each leaves the build compiling), then frontend.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, Express 5, Prisma 7, React 19, Vite 8, TanStack Query. No new dependencies. No Prisma schema or migration changes.

**Spec:** `docs/superpowers/specs/2026-05-15-outline-entity-consolidation-design.md`

**bd:** `story-editor-lrd`. Plan link applied via `bash scripts/bd-link-plan.sh story-editor-lrd docs/superpowers/plans/2026-05-15-outline-entity-consolidation.md` *after user approval of this plan*.

**Branch:** `feature/outline-entity-consolidation` — created off freshly-pulled `main` at execution start. The spec is committed on `main` before branching.

---

## File structure

**Created:**
- `shared/src/schemas/outline.ts` — canonical OutlineItem Zod schemas, types, `OUTLINE_ENCRYPTED_FIELD_KEYS`, `OUTLINE_*_MAX` caps
- `shared/tests/outline.schema.test.ts` — schema unit tests

**Modified (shared):**
- `shared/src/index.ts` — re-export the new outline symbols

**Modified (backend):**
- `backend/src/repos/outline.repo.ts` — consume shared types, add `RepoOutlineItem`, `projectDecrypted<RepoOutlineItem>`, import `OUTLINE_ENCRYPTED_FIELD_KEYS`; repo-local `RepoCreateOutlineInput = OutlineCreateInput & { storyId; order }`
- `backend/src/routes/outline.routes.ts` — delete three inline schemas; consume shared schemas; `respond()` + `serializeOutlineItem` on four success-path handlers; reorder route keeps 204 + imperative dup checks + `OutlineNotOwnedError` → 403 unchanged
- `backend/src/lib/serialize.ts` — add `serializeOutlineItem` (explicit-pick form, matching the other three helpers)
- `backend/tests/routes/outline.test.ts` — response-shape assertions updated to the new wire shape
- `backend/tests/lib/serialize.test.ts` — add `serializeOutlineItem()` block with ISO-string / stray-key assertions

**Modified (frontend):**
- `frontend/src/hooks/useOutline.ts` — delete 6 hand-rolled interfaces, import from shared, runtime-validate responses, collapse `DeleteOutlineInput` to inline `{id: string}`, derive `ReorderOutlineInput.items` from shared schema
- `frontend/src/components/OutlineTab.tsx` — `OutlineItem` import path → `story-editor-shared`
- `frontend/tests/components/OutlineTab.test.tsx` — fixtures use shared `OutlineItem`; add a schema-drift smoke test

**Untouched (confirmed during planning):**
- `frontend/src/components/Sidebar.tsx` — `outlineBody?: ReactNode` ([Sidebar.tsx:25](../../frontend/src/components/Sidebar.tsx)); does not import `OutlineItem`. No edit.
- `frontend/src/pages/EditorPage.tsx` — grep returns zero matches for `OutlineItem` / `useOutline`. No edit.
- `backend/src/services/prompt.service.ts`, `backend/src/routes/ai.routes.ts`, `backend/src/routes/chat.routes.ts` — grep returns zero `Outline` references. No edit.
- `backend/tests/models/outline-*.test.ts` — Prisma-model-level tests, don't reference any deleted interface. Run in verify line for regression confidence only.
- `backend/tests/security/encryption-leak.test.ts` — Outline columns unchanged. Run in verify line.

**Verify line (applied to bd `--notes` at link-plan time):**

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/outline tests/routes/outline tests/repos/outline tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/OutlineTab
```

---

## Task 1 — Shared OutlineItem schemas + tests (TDD)

Add the canonical layer in `story-editor-shared`. No consumers touched; this task lands clean even if no other task runs.

**Files:**
- Create: `shared/tests/outline.schema.test.ts`
- Create: `shared/src/schemas/outline.ts`
- Modify: `shared/src/index.ts`

- [ ] **1a. Write the failing schema tests.** Create `shared/tests/outline.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  OUTLINE_STATUS_MAX,
  OUTLINE_SUB_MAX,
  OUTLINE_TITLE_MAX,
  outlineCreateSchema,
  outlineItemResponseSchema,
  outlineItemSchema,
  outlineListResponseSchema,
  outlineReorderSchema,
  outlineUpdateSchema,
} from '../src/schemas/outline';

const validItem = {
  id: 'cm0outline00001',
  storyId: 'cm0story0000001',
  title: 'Chapter 1 — the call',
  sub: 'protagonist receives the inciting incident',
  status: 'active',
  order: 0,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T01:00:00.000Z',
};

describe('outlineItemSchema', () => {
  it('accepts a fully-populated valid item', () => {
    expect(() => outlineItemSchema.parse(validItem)).not.toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, userId: 'u1' })).toThrow();
  });

  it('accepts null sub', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, sub: null })).not.toThrow();
  });

  it('rejects negative order', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, order: -1 })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, id: '' })).toThrow();
  });

  it('rejects non-ISO datetime', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, createdAt: 'not-a-date' })).toThrow();
  });
});

describe('outlineCreateSchema', () => {
  const validCreate = { title: 'New beat', sub: null, status: 'queued' };

  it('accepts a minimal valid body', () => {
    expect(() => outlineCreateSchema.parse(validCreate)).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, title: '' })).toThrow();
  });

  it(`rejects title over ${OUTLINE_TITLE_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, title: 'x'.repeat(OUTLINE_TITLE_MAX + 1) }),
    ).toThrow();
  });

  it(`rejects sub over ${OUTLINE_SUB_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, sub: 'x'.repeat(OUTLINE_SUB_MAX + 1) }),
    ).toThrow();
  });

  it(`rejects status over ${OUTLINE_STATUS_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, status: 'x'.repeat(OUTLINE_STATUS_MAX + 1) }),
    ).toThrow();
  });

  it('rejects empty status', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, status: '' })).toThrow();
  });

  it('rejects unknown keys — notably order (create must not set order)', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, order: 0 })).toThrow();
  });

  it('accepts sub absent (undefined)', () => {
    const { sub: _sub, ...rest } = validCreate;
    expect(() => outlineCreateSchema.parse(rest)).not.toThrow();
  });
});

describe('outlineUpdateSchema', () => {
  it('accepts empty object', () => {
    expect(() => outlineUpdateSchema.parse({})).not.toThrow();
  });

  it('accepts any single-field subset', () => {
    expect(() => outlineUpdateSchema.parse({ title: 'x' })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ sub: null })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ status: 'done' })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ order: 5 })).not.toThrow();
  });

  it('rejects unknown keys (strictness preserved through .partial().extend())', () => {
    expect(() => outlineUpdateSchema.parse({ unknown: 1 })).toThrow();
  });

  it('rejects negative order', () => {
    expect(() => outlineUpdateSchema.parse({ order: -1 })).toThrow();
  });
});

describe('outlineReorderSchema', () => {
  const item = { id: 'a', order: 0 };

  it('accepts a single-item batch', () => {
    expect(() => outlineReorderSchema.parse({ items: [item] })).not.toThrow();
  });

  it('rejects an empty items array', () => {
    expect(() => outlineReorderSchema.parse({ items: [] })).toThrow();
  });

  it('rejects > 500 items', () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ id: `id-${i}`, order: i }));
    expect(() => outlineReorderSchema.parse({ items })).toThrow();
  });

  it('rejects unknown keys inside each item', () => {
    expect(() =>
      outlineReorderSchema.parse({ items: [{ ...item, extra: 1 }] }),
    ).toThrow();
  });
});

describe('response schemas', () => {
  it('outlineItemResponseSchema wraps the entity', () => {
    expect(() => outlineItemResponseSchema.parse({ outlineItem: validItem })).not.toThrow();
  });

  it('outlineListResponseSchema wraps an array', () => {
    expect(() => outlineListResponseSchema.parse({ outline: [validItem] })).not.toThrow();
  });
});
```

- [ ] **1b. Run the tests; expect a module-not-found failure.**

Run: `npm -w story-editor-shared test -- outline.schema`

Expected: FAIL — `Cannot find module '../src/schemas/outline'`.

- [ ] **1c. Implement `shared/src/schemas/outline.ts`:**

```ts
import { z } from 'zod';

// Field-length caps — single source of truth, exported so future `OutlineModal`
// (filed as story-editor-syb) imports them instead of re-declaring the numbers.
// Values copied verbatim from the legacy inline schemas in outline.routes.ts.
export const OUTLINE_TITLE_MAX = 300;
export const OUTLINE_SUB_MAX = 2000;
export const OUTLINE_STATUS_MAX = 40;

// `z.strictObject` rejects unknown keys at every layer — the load-bearing
// invariant that closes the Prisma↔Zod drift seam at egress-validation time,
// same as character.ts / message.ts / story.ts.
export const outlineItemSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  sub: z.string().nullable(),
  // `status` stays free-form: the DB column is plain `String`, no Prisma enum,
  // no server-enforced contract. The frontend convention 'queued'|'active'|'done'
  // lives in useOutline.ts as a UI rendering type alias and is intentionally
  // NOT exported from this package.
  status: z.string(),
  order: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// POST body — `order` is NOT settable here (the route auto-allocates via
// maxOrder + retry, guarded by @@unique([storyId, order])). `storyId` comes
// from the URL, not the body.
export const outlineCreateSchema = z.strictObject({
  title: z.string().min(1).max(OUTLINE_TITLE_MAX),
  sub: z.string().max(OUTLINE_SUB_MAX).nullable().optional(),
  status: z.string().min(1).max(OUTLINE_STATUS_MAX),
});

// PATCH body — every create field optional + `order` settable for per-item
// repositioning (bulk reorder goes through outlineReorderSchema). First
// migrated entity to use .partial().extend(...). In Zod 4 (the project's
// pinned version) both `.partial()` and `.extend()` on a strictObject preserve
// strictness, so unknown keys are still rejected on PATCH.
export const outlineUpdateSchema = outlineCreateSchema.partial().extend({
  order: z.number().int().nonnegative().optional(),
});

// PATCH /reorder body — semantic duplicate-id / duplicate-order checks live
// in the route (the error contract returns a per-failure human message that
// Zod's default .refine() formatting can't preserve cleanly). max(500) matches
// today's inline ReorderOutlineBody.
export const outlineReorderSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

export const outlineItemResponseSchema = z.strictObject({ outlineItem: outlineItemSchema });
export const outlineListResponseSchema = z.strictObject({ outline: z.array(outlineItemSchema) });

// Single source of truth for which OutlineItem fields are encrypted at rest.
// Imported by backend/src/repos/outline.repo.ts as ENCRYPTED_FIELDS. Repo-only
// consumer, but the tuple belongs beside the schema describing the same entity
// (matches the STORY / MESSAGE pattern).
export const OUTLINE_ENCRYPTED_FIELD_KEYS = ['title', 'sub'] as const;

export type OutlineItem = z.infer<typeof outlineItemSchema>;
export type OutlineCreateInput = z.infer<typeof outlineCreateSchema>;
export type OutlineUpdateInput = z.infer<typeof outlineUpdateSchema>;
export type OutlineReorderInput = z.infer<typeof outlineReorderSchema>;
export type OutlineEncryptedFieldKey = (typeof OUTLINE_ENCRYPTED_FIELD_KEYS)[number];
```

- [ ] **1d. Run the tests; expect PASS.**

Run: `npm -w story-editor-shared test -- outline.schema`

Expected: PASS (all blocks green).

- [ ] **1e. Modify `shared/src/index.ts` to re-export the new symbols.** Insert a new export block at the end of the file (mirror the existing `character.ts` / `message.ts` / `story.ts` blocks):

```ts
export type {
  OutlineItem,
  OutlineCreateInput,
  OutlineUpdateInput,
  OutlineReorderInput,
  OutlineEncryptedFieldKey,
} from './schemas/outline';
export {
  outlineItemSchema,
  outlineCreateSchema,
  outlineUpdateSchema,
  outlineReorderSchema,
  outlineItemResponseSchema,
  outlineListResponseSchema,
  OUTLINE_ENCRYPTED_FIELD_KEYS,
  OUTLINE_TITLE_MAX,
  OUTLINE_SUB_MAX,
  OUTLINE_STATUS_MAX,
} from './schemas/outline';
```

- [ ] **1f. Build the shared workspace; expect clean.**

Run: `npm -w story-editor-shared run build`

Expected: tsup completes, `shared/dist/` updated, no errors.

- [ ] **1g. Commit.**

```bash
git add shared/src/schemas/outline.ts shared/src/index.ts shared/tests/outline.schema.test.ts
git commit -m "shared: outline zod schemas + tests"
```

---

## Task 2 — `serializeOutlineItem` (TDD)

Add the handler-boundary converter for outline items. Pure addition — no consumer touched until Task 4.

**Files:**
- Modify: `backend/tests/lib/serialize.test.ts`
- Modify: `backend/src/lib/serialize.ts`

- [ ] **2a. Write the failing test block.** Append after the existing `describe('serializeStory()', ...)` block in `backend/tests/lib/serialize.test.ts`. Import `serializeOutlineItem` from `../../src/lib/serialize` and `outlineItemResponseSchema` from `story-editor-shared` (add to the existing imports at the top of the file):

```ts
describe('serializeOutlineItem()', () => {
  // RepoOutlineItem omits no extra columns today, but use explicit pick to
  // match the established pattern across all four serialize* helpers. Also
  // locks the contract via a stray-key assertion.
  const validRow = {
    id: 'cm0outline00001',
    storyId: 'cm0story0000001',
    title: 'Chapter 1 — the call',
    sub: 'protagonist receives the inciting incident',
    status: 'active',
    order: 0,
    createdAt: new Date('2026-05-15T00:00:00.000Z'),
    updatedAt: new Date('2026-05-15T01:00:00.000Z'),
  };

  it('ISO-strings Date fields', () => {
    const wire = serializeOutlineItem(validRow);
    expect(wire.createdAt).toBe('2026-05-15T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-15T01:00:00.000Z');
  });

  it('passes narrative + structural fields through unchanged', () => {
    const wire = serializeOutlineItem(validRow);
    expect(wire.id).toBe(validRow.id);
    expect(wire.storyId).toBe(validRow.storyId);
    expect(wire.title).toBe(validRow.title);
    expect(wire.sub).toBe(validRow.sub);
    expect(wire.status).toBe(validRow.status);
    expect(wire.order).toBe(validRow.order);
  });

  it('does not mutate the input row', () => {
    const before = { ...validRow };
    serializeOutlineItem(validRow);
    expect(validRow).toEqual(before);
  });

  it('excludes any stray runtime key from the wire shape (explicit pick)', () => {
    const rowWithExtra = {
      ...validRow,
      stray: 'should-not-leak',
    } as unknown as Parameters<typeof serializeOutlineItem>[0];
    const wire = serializeOutlineItem(rowWithExtra) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('stray');
  });

  it('produces a value that satisfies outlineItemResponseSchema egress validation', () => {
    const wire = serializeOutlineItem(validRow);
    expect(() => outlineItemResponseSchema.parse({ outlineItem: wire })).not.toThrow();
  });
});
```

- [ ] **2b. Run the test; expect failure.**

Run: `npm -w story-editor-backend test -- tests/lib/serialize`

Expected: FAIL — `serializeOutlineItem is not exported from '../../src/lib/serialize'`.

- [ ] **2c. Implement `serializeOutlineItem`.** In `backend/src/lib/serialize.ts`, add `OutlineItem` to the existing `import type` from `story-editor-shared`, add `RepoOutlineItem` to the imports at the top, and append the new function after `serializeStory`:

```ts
// In the existing imports at the top of the file, add OutlineItem:
import type { Character, Message, OutlineItem, Story } from 'story-editor-shared';
// And alongside the other repo type imports:
import type { RepoOutlineItem } from '../repos/outline.repo';

// Then append after serializeStory:

// Explicit pick (not spread): keeps every serialize* helper on one safe
// pattern. RepoOutlineItem happens to carry no extra runtime columns today,
// but picking hardens the example so a future entity author doesn't copy a
// spread that leaks an extra column.
export function serializeOutlineItem(row: RepoOutlineItem): OutlineItem {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    sub: row.sub,
    status: row.status,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

NOTE: `RepoOutlineItem` does not yet exist — Task 3 adds it. This file will not typecheck cleanly between this commit and Task 3's commit. **That is acceptable** because:
- The Task 2 commit only adds new lines that reference a not-yet-existing type.
- The next task immediately follows and adds the type.
- We commit at the end of Task 3 *only* after backend typecheck is clean.

**Therefore: do NOT commit yet.** Continue straight to Task 3.

---

## Task 3 — Outline repo onto shared types

Refactor `outline.repo.ts` to consume shared types and export `RepoOutlineItem`. Closes the typecheck gap opened in Task 2.

**Files:**
- Modify: `backend/src/repos/outline.repo.ts`

- [ ] **3a. Modify `backend/src/repos/outline.repo.ts`** — rewrite the type-related top of the file. Replace lines 1-16 with:

```ts
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import {
  OUTLINE_ENCRYPTED_FIELD_KEYS,
  type OutlineCreateInput,
  type OutlineItem,
  type OutlineUpdateInput,
} from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = OUTLINE_ENCRYPTED_FIELD_KEYS;

// The shared OutlineCreateInput is the request-body shape (no storyId, no
// order — storyId comes from req.params and order is auto-allocated by the
// route's POST handler). The repo's create() needs both, so augment locally.
export type RepoCreateOutlineInput = OutlineCreateInput & {
  storyId: string;
  order: number;
};

// Re-export the shared OutlineUpdateInput so existing callers can keep
// importing UpdateInput from this repo if they want to (minimises consumer
// churn — the route currently imports `type OutlineUpdateInput` from here).
export type { OutlineUpdateInput };

// Repo-typed projection: the wire shape (OutlineItem) has ISO-string
// createdAt/updatedAt; the repo returns Date objects from Prisma.
export type RepoOutlineItem = Omit<OutlineItem, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **3b. Type the four `projectDecrypted` call sites.** In the `createOutlineRepo` function, replace every `projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS)` with `projectDecrypted<RepoOutlineItem>(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS)`. There are four call sites (in `create`, `findById`, `findManyForStory`, `update`).

For example, in `create`:

```ts
async function create(input: RepoCreateOutlineInput) {
  const userId = resolveUserId(req);
  await ensureStoryOwned(client, input.storyId, userId);
  const row = await client.outlineItem.create({
    data: {
      storyId: input.storyId,
      order: input.order,
      status: input.status,
      ...writeEncrypted(req, 'title', input.title),
      ...writeEncrypted(req, 'sub', input.sub ?? null),
    },
  });
  return projectDecrypted<RepoOutlineItem>(
    req,
    row as unknown as Record<string, unknown>,
    ENCRYPTED_FIELDS,
  );
}
```

Make the equivalent type-annotation change in `findById`, `findManyForStory`, and `update`. The function bodies are otherwise unchanged.

- [ ] **3c. Update the create signature.** Change `async function create(input: OutlineCreateInput)` → `async function create(input: RepoCreateOutlineInput)`. The route caller already passes `{ storyId, order, title, sub, status }` — only the type changes.

- [ ] **3d. Sanity-check: `OutlineNotOwnedError`, `ensureStoryOwned`, the two-phase swap transaction, and `maxOrder` are all unchanged.** Confirm via a final pass through the file that nothing else moved.

- [ ] **3e. Typecheck both serialize.ts + outline.repo.ts.**

Run: `npm -w story-editor-backend run typecheck`

Expected: PASS — `serializeOutlineItem` finds `RepoOutlineItem`, and the repo's `projectDecrypted<RepoOutlineItem>` calls compile.

- [ ] **3f. Run the repo + serialize tests; expect PASS.**

Run: `npm -w story-editor-backend test -- tests/lib/serialize tests/repos/outline`

Expected: PASS — the new `serializeOutlineItem()` block passes; existing `outline.repo.test.ts` is unchanged shape.

- [ ] **3g. Commit Tasks 2 + 3 together.**

```bash
git add backend/src/lib/serialize.ts backend/src/repos/outline.repo.ts backend/tests/lib/serialize.test.ts
git commit -m "backend: serializeOutlineItem + outline.repo onto shared types"
```

---

## Task 4 — Outline route onto shared schemas + `respond()`

Delete the three inline schemas; wire `respond()` on the four success-path handlers; keep reorder route + all error branches untouched.

**Files:**
- Modify: `backend/src/routes/outline.routes.ts`
- Modify: `backend/tests/routes/outline.test.ts`

- [ ] **4a. Update the imports + delete inline schemas in `backend/src/routes/outline.routes.ts`.** Replace the import block at the top (lines 4-14) and delete the three inline schema declarations (lines 24-58):

```ts
// Replace the existing import block with:
import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  outlineCreateSchema,
  outlineItemResponseSchema,
  outlineListResponseSchema,
  outlineReorderSchema,
  outlineUpdateSchema,
} from 'story-editor-shared';
import { badRequestFromZod } from '../lib/bad-request';
import { respond } from '../lib/respond';
import { serializeOutlineItem } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import {
  createOutlineRepo,
  OutlineNotOwnedError,
  type OutlineUpdateInput,
} from '../repos/outline.repo';
```

Then **delete** the three inline schema declarations (`CreateOutlineBody`, `UpdateOutlineBody`, `ReorderOutlineBody`). The `POST_ORDER_RETRY_ATTEMPTS` constant and `isPrismaUniqueViolation` helper stay.

- [ ] **4b. Wire `respond()` + `serializeOutlineItem` on the GET list handler.** Replace the success-path body of `router.get('/', ...)`:

```ts
router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
  const storyId = req.params.storyId as string;
  try {
    const rows = await createOutlineRepo(req).findManyForStory(storyId);
    respond(outlineListResponseSchema, res, { outline: rows.map(serializeOutlineItem) });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **4c. Wire `respond()` on the POST handler.** In the existing handler, swap the `outlineCreateSchema` reference into `safeParse`, and replace the final success response. The retry loop and `body` destructure are unchanged; only the schema reference and the success response change:

```ts
router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
  const storyId = req.params.storyId as string;

  const parsed = outlineCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const body = parsed.data;

  try {
    const outlineRepo = createOutlineRepo(req);

    let lastErr: unknown;
    let created: Awaited<ReturnType<ReturnType<typeof createOutlineRepo>['create']>> | null = null;
    for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
      const currentMax = await outlineRepo.maxOrder(storyId);
      const nextOrder = currentMax === null ? 0 : currentMax + 1;

      try {
        created = await outlineRepo.create({
          storyId,
          title: body.title,
          sub: body.sub,
          status: body.status,
          order: nextOrder,
        });
        break;
      } catch (err) {
        if (!isPrismaUniqueViolation(err)) throw err;
        lastErr = err;
      }
    }

    if (created === null) {
      throw lastErr ?? new Error('outline POST: failed to allocate order');
    }

    respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(created) }, 201);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **4d. Update the reorder handler — schema swap ONLY.** Replace `ReorderOutlineBody.safeParse` with `outlineReorderSchema.safeParse`. **Do not touch** the imperative duplicate-id / duplicate-order checks (lines 141-158 today), the 204 response, or the `OutlineNotOwnedError` → 403 catch (lines 163-167). The 204 stays — it does not go through `respond()`.

```ts
router.patch('/reorder', ownStory, async (req: Request, res: Response, next: NextFunction) => {
  const storyId = req.params.storyId as string;

  const parsed = outlineReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const items = parsed.data.items;

  // … duplicate-id / duplicate-order imperative checks unchanged …

  try {
    await createOutlineRepo(req).reorder(storyId, items);
    res.status(204).send();
  } catch (err) {
    if (err instanceof OutlineNotOwnedError) {
      res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
      return;
    }
    next(err);
  }
});
```

- [ ] **4e. Wire `respond()` + `serializeOutlineItem` on the GET `/:outlineId` handler.** The 404 / cross-story-id branches stay as plain `{ error: … }` responses (not through `respond()`); only the success branch changes:

```ts
router.get(
  '/:outlineId',
  ownStory,
  ownOutline,
  async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    const outlineId = req.params.outlineId as string;
    try {
      const row = await createOutlineRepo(req).findById(outlineId);
      if (!row || row.storyId !== storyId) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(row) });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **4f. Wire `respond()` + `serializeOutlineItem` on the PATCH handler.** Same shape — error branches plain, success through `respond()`. Swap `UpdateOutlineBody.safeParse` for `outlineUpdateSchema.safeParse`. The `'title' in body` / `'sub' in body` / `'status' in body` / `'order' in body` forwarding block is unchanged:

```ts
router.patch(
  '/:outlineId',
  ownStory,
  ownOutline,
  async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    const outlineId = req.params.outlineId as string;

    const parsed = outlineUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      const existing = await createOutlineRepo(req).findById(outlineId);
      if (!existing || existing.storyId !== storyId) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }

      const input: OutlineUpdateInput = {};
      if ('title' in body) input.title = body.title;
      if ('sub' in body) input.sub = body.sub;
      if ('status' in body) input.status = body.status;
      if ('order' in body) input.order = body.order;

      const updated = await createOutlineRepo(req).update(outlineId, input);
      if (!updated) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(updated) });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **4g. DELETE handler — no schema work; no edit needed.** The DELETE handler returns 204 and never had a request body schema. Confirm it is unchanged.

- [ ] **4h. Backend typecheck.**

Run: `npm -w story-editor-backend run typecheck`

Expected: PASS.

- [ ] **4i. Update route test assertions in `backend/tests/routes/outline.test.ts`** — wherever assertions read response fields, confirm the wire shape `{ outlineItem: { id, storyId, title, sub, status, order, createdAt, updatedAt } }` (for single-item responses) or `{ outline: [...] }` (for list responses). Most existing assertions should already match this shape since today's response is the same; this step is a focused review pass, not a rewrite.

  Specifically check: `expect(body).toHaveProperty('outline')` (list), `expect(body).toHaveProperty('outlineItem')` (single), no stray `userId` (Outline has none — sanity), `createdAt` / `updatedAt` are ISO strings.

  If any assertion was reading a different shape (e.g. spread directly), tighten it.

- [ ] **4j. Run the route tests; expect PASS.**

Run: `npm -w story-editor-backend test -- tests/routes/outline`

Expected: PASS — all CRUD + reorder + ownership tests green. Tests against `validation_error` codes (duplicate id / duplicate order in payload) still pass since those branches are unchanged.

- [ ] **4k. Commit.**

```bash
git add backend/src/routes/outline.routes.ts backend/tests/routes/outline.test.ts
git commit -m "backend: outline.routes onto shared schemas + respond()"
```

---

## Task 5 — Frontend hook + consumer onto shared types

Delete the hand-rolled interfaces in `useOutline.ts`; import shared types; add runtime validation; collapse `DeleteOutlineInput` to inline; derive `ReorderOutlineInput.items` from shared. Swap the import path in the one consumer (`OutlineTab.tsx`).

**Files:**
- Modify: `frontend/src/hooks/useOutline.ts`
- Modify: `frontend/src/components/OutlineTab.tsx`

- [ ] **5a. Rewrite `frontend/src/hooks/useOutline.ts`.** Replace the entire file (this is a clean rewrite — the old hand-rolled types and the new imports overlap too much to do this incrementally):

```ts
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type OutlineCreateInput,
  type OutlineItem,
  type OutlineReorderInput,
  type OutlineUpdateInput,
  outlineItemResponseSchema,
  outlineListResponseSchema,
} from 'story-editor-shared';
import { api } from '@/lib/api';

/**
 * F29 — outline (Story Arc) queries + create / update / delete / reorder
 * mutations. Mirrors `useChapters.ts` for the optimistic-reorder pattern.
 *
 * Backend contract (B8):
 * - GET    /api/stories/:storyId/outline                → { outline: OutlineItem[] }
 * - POST   /api/stories/:storyId/outline                → { outlineItem: OutlineItem }
 * - PATCH  /api/stories/:storyId/outline/:id            → { outlineItem: OutlineItem }
 * - DELETE /api/stories/:storyId/outline/:id            → 204
 * - PATCH  /api/stories/:storyId/outline/reorder        → 204 (body { items: [{id, order}] })
 *
 * Types and response schemas are imported from `story-editor-shared`. The
 * `OutlineStatus` union below is a frontend-only UI rendering convention —
 * the wire contract / DB column are both free-form string, by deliberate
 * design (see outline.routes.ts:28-30 and schema.prisma:175).
 */
export type OutlineStatus = 'queued' | 'active' | 'done';

export const outlineQueryKey = (storyId: string): readonly ['outline', string] =>
  ['outline', storyId] as const;

export function useOutlineQuery(storyId: string | undefined): UseQueryResult<OutlineItem[], Error> {
  return useQuery({
    queryKey: outlineQueryKey(storyId ?? ''),
    queryFn: async (): Promise<OutlineItem[]> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(storyId ?? '')}/outline`);
      const { outline } = outlineListResponseSchema.parse(raw);
      // Sort defensively — the backend already returns ordered, but the cache
      // shape this hook commits to is "sorted ascending by `order`" so the
      // optimistic-reorder path can skip a sort step.
      return [...outline].sort((a, b) => a.order - b.order);
    },
    enabled: Boolean(storyId),
    staleTime: 30_000,
  });
}

export function useCreateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, OutlineCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OutlineCreateInput): Promise<OutlineItem> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(storyId)}/outline`, {
        method: 'POST',
        body: input,
      });
      const { outlineItem } = outlineItemResponseSchema.parse(raw);
      return outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export interface UpdateOutlineArgs {
  id: string;
  patch: OutlineUpdateInput;
}

export function useUpdateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, UpdateOutlineArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateOutlineArgs): Promise<OutlineItem> => {
      const raw = await api<unknown>(
        `/stories/${encodeURIComponent(storyId)}/outline/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: patch,
        },
      );
      const { outlineItem } = outlineItemResponseSchema.parse(raw);
      return outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export function useDeleteOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      await api<void>(`/stories/${encodeURIComponent(storyId)}/outline/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

/**
 * Pure array-move helper. Returns a new array; out-of-range indices return a
 * shallow copy unchanged. Same behaviour as `arrayMove` in `useChapters.ts`.
 */
export function arrayMove<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list.slice();
  if (fromIndex < 0 || fromIndex >= list.length) return list.slice();
  if (toIndex < 0 || toIndex >= list.length) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}

/**
 * Reassign sequential `order` values 0..N-1 across the given items. The backend
 * requires unique `order` values; passing 0..N-1 keeps the contract trivial.
 */
export function withSequentialOrder(list: readonly OutlineItem[]): OutlineItem[] {
  return list.map((item, idx) => (item.order === idx ? item : { ...item, order: idx }));
}

/**
 * Pure handler for `DndContext.onDragEnd`. Returns `null` when nothing needs
 * to change (no `over`, same id, or unknown ids). Mirrors
 * `computeReorderedChapters`.
 */
export function computeReorderedOutline(
  current: readonly OutlineItem[],
  activeId: string,
  overId: string | null,
): OutlineItem[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrder(moved);
}

export interface ReorderOutlineMutationContext {
  previous: OutlineItem[] | undefined;
}

// `items` derived from the shared schema so a wire-shape change surfaces here
// as a type error, not a runtime drift. `previousItems` has no wire analog
// (frontend-only optimistic rollback), so it stays as a hook-local field.
export interface ReorderOutlineInputArgs {
  items: OutlineReorderInput['items'];
  previousItems: OutlineItem[];
}

export function useReorderOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, ReorderOutlineInputArgs, ReorderOutlineMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, ReorderOutlineInputArgs, ReorderOutlineMutationContext>({
    mutationFn: async ({ items }: ReorderOutlineInputArgs): Promise<void> => {
      await api<void>(`/stories/${encodeURIComponent(storyId)}/outline/reorder`, {
        method: 'PATCH',
        body: { items },
      });
    },
    onMutate: async ({
      previousItems,
    }: ReorderOutlineInputArgs): Promise<ReorderOutlineMutationContext> => {
      await qc.cancelQueries({ queryKey: outlineQueryKey(storyId) });
      const previous = qc.getQueryData<OutlineItem[]>(outlineQueryKey(storyId));
      qc.setQueryData<OutlineItem[]>(outlineQueryKey(storyId), previousItems);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<OutlineItem[]>(outlineQueryKey(storyId), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}
```

Note: the public mutation-args interface name changed from `ReorderOutlineInput` → `ReorderOutlineInputArgs` (avoids name collision with the shared `OutlineReorderInput` type, which is the wire-body shape). `UpdateOutlineInput` from the old hook becomes `UpdateOutlineArgs` for the same reason. Consumer test fixtures may reference these — Task 6 handles that.

- [ ] **5b. Update the one component consumer: `frontend/src/components/OutlineTab.tsx`.** Find the `import type { OutlineItem ... } from '@/hooks/useOutline'` line (or wherever it imports the type) and swap the import source:

```ts
import type { OutlineItem } from 'story-editor-shared';
```

If the file also imports `OutlineStatus`, leave that one importing from `@/hooks/useOutline` — it's the frontend-only convention.

- [ ] **5c. Frontend typecheck.**

Run: `npm -w story-editor-frontend run typecheck`

Expected: PASS — `OutlineItem` references in `OutlineTab.tsx` resolve through the new shared import. Verified via grep that no consumer references the old `UpdateOutlineInput` / `ReorderOutlineInput` / `OutlineListResponse` / `OutlineItemResponse` / `CreateOutlineInput` / `DeleteOutlineInput` / `UpdateOutlinePatch` names — the renames in Task 5a are purely internal to the hook and don't break any consumer.

**If the typecheck surfaces an unexpected consumer** that DID import one of the deleted names, halt and re-survey the codebase — the planning grep may have missed it. The expected outcome is a clean typecheck here.

- [ ] **5d. Don't commit yet** — the test file's import path still points to the old location. Continue to Task 6 (single-line swap in the test file), then commit Tasks 5 + 6 together.

---

## Task 6 — Frontend tests: fixtures + drift smoke test

Update `OutlineTab.test.tsx` fixtures to the shared `OutlineItem` type, fix the mutation-args renames, and add a drift smoke test.

**Files:**
- Modify: `frontend/tests/components/OutlineTab.test.tsx`

- [ ] **6a. Swap the `OutlineItem` import path.** Confirmed via grep: `OutlineTab.test.tsx` imports exactly six symbols from `@/hooks/useOutline` (lines 7-14) — `arrayMove`, `computeReorderedOutline`, `type OutlineItem`, `outlineQueryKey`, `useReorderOutlineMutation`, `withSequentialOrder`. Only `OutlineItem` moves. Edit lines 7-14 to:

```ts
import {
  arrayMove,
  computeReorderedOutline,
  outlineQueryKey,
  useReorderOutlineMutation,
  withSequentialOrder,
} from '@/hooks/useOutline';
import type { OutlineItem } from 'story-editor-shared';
```

The existing `item()` fixture builder on lines 28-38 already satisfies the strict `outlineItemSchema` — all eight required fields present (`id` + `order` from overrides; `storyId`, `title`, `sub`, `status`, `createdAt`, `updatedAt` in the body), ISO-string timestamps. **No fixture changes needed.** The test file does not reference any of the deleted interface names (`OutlineListResponse`, `OutlineItemResponse`, `CreateOutlineInput`, `UpdateOutlineInput`, `UpdateOutlinePatch`, `DeleteOutlineInput`, `ReorderOutlineInput`) or `OutlineStatus` — verified via grep.

- [ ] **6b. Add a schema-drift smoke test.** Append a new `describe` block at the end of `OutlineTab.test.tsx` using the file's existing `fetchMock` pattern (the test file uses `vi.stubGlobal('fetch', fetchMock)`, not MSW):

```tsx
describe('OutlineTab schema drift', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  // A malformed wire response must surface as a ZodError through the hook's
  // runtime parse — NOT silently render garbage. Locks the consolidation
  // contract: shared/src/schemas/outline.ts ↔ /api/stories/:id/outline.
  it('does not render content when /outline omits a required field (order)', async () => {
    const malformed = {
      outline: [
        {
          id: 'cm0',
          storyId: 'story-1',
          title: 'broken-item',
          sub: null,
          status: 'queued',
          // order deliberately omitted — schema requires it
          createdAt: '2026-05-15T00:00:00.000Z',
          updatedAt: '2026-05-15T00:00:00.000Z',
        },
      ],
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(jsonResponse(200, malformed));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    // The malformed-item title never reaches the DOM — the query fails its
    // runtime parse and stays in error state. The component falls back to
    // its existing empty/error UI.
    await waitFor(() => {
      expect(screen.queryByText(/broken-item/)).not.toBeInTheDocument();
    });
  });
});
```

NOTE on the `ReorderOutlineInputArgs` / `UpdateOutlineArgs` renames from Task 5a: the test file imports `useReorderOutlineMutation` (the hook itself, not its args type), so the renames don't surface here. No additional test changes needed for those names.

- [ ] **6c. Run the frontend tests; expect PASS.**

Run: `npm -w story-editor-frontend test -- tests/components/OutlineTab`

Expected: PASS — all existing tests still pass against the shared `OutlineItem` type; the new drift smoke test passes.

- [ ] **6d. Frontend typecheck — final.**

Run: `npm -w story-editor-frontend run typecheck`

Expected: PASS — no references to deleted interface names.

- [ ] **6e. Commit Tasks 5 + 6 together.**

```bash
git add frontend/src/hooks/useOutline.ts frontend/src/components/OutlineTab.tsx frontend/tests/components/OutlineTab.test.tsx
git commit -m "frontend: useOutline + OutlineTab onto shared types + drift test"
```

---

## Task 7 — Full verify line + push + close gate

Run the full verify line, confirm everything green, push the branch, and hand off to `/bd-close-reviewed`.

- [ ] **7a. Run the full verify command.**

Run:

```bash
npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/outline tests/routes/outline tests/repos/outline tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/OutlineTab
```

Expected: every command green. If any step fails, halt and surface the failure; do not push.

- [ ] **7b. Confirm clean working tree.**

Run: `git status`

Expected: "nothing to commit, working tree clean" — all four commits (`shared:`, `backend: serialize + repo`, `backend: routes`, `frontend:`) on the branch.

- [ ] **7c. Push the branch.**

Run: `git push -u origin feature/outline-entity-consolidation`

Expected: branch published; GitHub PR URL printed.

- [ ] **7d. Hand off to `/bd-close-reviewed story-editor-lrd`.** The close-gate skill runs typecheck + verify-line + path-matched surface reviewers (`repo-boundary-reviewer` will match on the outline repo + route changes) and refuses close on `BLOCK` / `FIX_BEFORE_MERGE` findings. If a reviewer blocks, fix the code (not the test, not the verify) and re-loop. **Override path requires explicit user-ack with `--override-block "<reviewer> — <reason>"`** — do not bypass without it.

---

## Acceptance criteria summary

All criteria from [the spec's "Acceptance criteria" section](../specs/2026-05-15-outline-entity-consolidation-design.md) must hold:

- Single canonical `OutlineItem` Zod schema set in `shared/src/schemas/outline.ts`; no other hand-maintained interface anywhere.
- `shared/src/index.ts` re-exports exactly the documented symbol list — no `OutlineStatus`, no other symbols leaking.
- `outline.routes.ts` consumes shared schemas; four success-path handlers go through `respond()`; reorder stays 204 + imperative dup checks + `OutlineNotOwnedError` → 403 unchanged.
- `outline.repo.ts` consumes shared types + `OUTLINE_ENCRYPTED_FIELD_KEYS`; `RepoOutlineItem` exported; `RepoCreateOutlineInput` private repo-local augmentation.
- `serializeOutlineItem` exists, picks (not spread), converts `Date → ISO`; `serialize.test.ts` has a stray-key assertion.
- Frontend `useOutline.ts` runtime-validates every successful response; a drift smoke test in `OutlineTab.test.tsx` covers ZodError surfacing.
- `OutlineStatus` remains in `useOutline.ts` as a frontend-only convention.
- Encryption leak test passes; outline columns unchanged.
- `lint:design`, three typechecks, and the full verify line all green.
- `repo-boundary-reviewer` CLEAN at close-gate.
