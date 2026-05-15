# Chapter Entity Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Chapter entity onto `story-editor-shared` Zod schemas with runtime `.parse()` validation at the wire boundary — fifth and final narrative-entity consolidation following Character / Message / Story / Outline / Chat.

**Architecture:** Two-schema split inverted from Chat: `chapterMetaSchema` is the base (LIST payload — no body), `chapterSchema = chapterMetaSchema.extend({ bodyJson })` is the detail shape. Encrypted-field tuples (`CHAPTER_ENCRYPTED_FIELD_KEYS`, `CHAPTER_META_ENCRYPTED_FIELD_KEYS`) co-locate with the shared schemas. Backend gets `RepoChapter` / `RepoChapterMeta` type aliases (`type`, not `interface`, to satisfy `projectDecrypted<T>`'s `Record<string, unknown>` constraint), `serializeChapter` / `serializeChapterMeta` explicit-pick converters, and `respond(schema, res, data)` at every handler exit. Frontend hook runtime-`.parse()`s every success path and the existing inline `bodyJson` destructure at the one optimistic-cache-write site sheds its `as ChapterMeta` cast.

**Tech Stack:** TypeScript strict mode · Zod 4.4.3 · TanStack Query · Vitest · Express · Prisma · `respond()` egress helper (`backend/src/lib/respond.ts`) · `projectDecrypted` (`backend/src/repos/_narrative.ts`).

**Spec:** `docs/superpowers/specs/2026-05-15-chapter-entity-consolidation-design.md`

**bd issue:** `story-editor-ggl`

**Build invariant:** Every commit leaves typecheck + tests green. The two backend renames (`ChapterCreateInput` → `RepoChapterCreateInput`, same for Update) are bundled with the repo's two-line caller fix in Task 3 to avoid a transient broken-import state.

---

## File Structure

**Create:**
- `shared/src/schemas/chapter.ts` — canonical schemas, encrypted-field tuples, inferred types.
- `shared/src/schemas/chapter.test.ts` — schema unit tests (strictness, length caps, status enum, meta-vs-full distinction, response-envelope strictness).

**Modify:**
- `shared/src/index.ts` — re-export schemas + types + constants.
- `backend/src/repos/chapter.repo.ts` — add `RepoChapter` / `RepoChapterMeta` type aliases; rename `ChapterCreateInput` → `RepoChapterCreateInput` and `ChapterUpdateInput` → `RepoChapterUpdateInput`; replace local `ENCRYPTED_FIELDS` / `META_ENCRYPTED_FIELDS` with imported tuples; type `shape()` return as `RepoChapter`; type `shapeMeta()` projection with `<RepoChapterMeta>`.
- `backend/src/lib/serialize.ts` — add `serializeChapter` and `serializeChapterMeta`.
- `backend/tests/lib/serialize.test.ts` — add describe blocks for the two new serializers + a stray-key lock test.
- `backend/src/routes/chapters.routes.ts` — import shared schemas; delete the three inline `*Body` consts and the inline `ChapterStatus` enum; use `respond()` + `serializeChapter` / `serializeChapterMeta` at every handler exit; rename the repo-input import.
- `frontend/src/hooks/useChapters.ts` — delete local interface declarations; import types + schemas from shared; runtime `.parse()` every success path; drop the `as ChapterMeta` cast at line 348.
- 10 test fixture files (audit — most are no-ops, a few may need stray-key removal).

**Touch only if needed:**
- `backend/tests/repos/chapter.test.ts` — only if a `RepoChapter` import is added.

---

## Task 1: Shared Zod Schemas + Tests

**Files:**
- Create: `shared/src/schemas/chapter.ts`
- Create: `shared/src/schemas/chapter.test.ts`

- [ ] **Step 1: Write `chapter.test.ts` first (TDD)**

```ts
// shared/src/schemas/chapter.test.ts
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  CHAPTER_TITLE_MAX,
  CHAPTER_TITLE_MIN,
  chapterCreateSchema,
  chapterMetaSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chapterSchema,
  chapterStatusSchema,
  chapterUpdateSchema,
  chaptersResponseSchema,
} from './chapter.js';

const VALID_META = {
  id: 'c1',
  storyId: 's1',
  title: 'Chapter One',
  wordCount: 0,
  orderIndex: 0,
  status: 'draft' as const,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
};

describe('chapterStatusSchema', () => {
  it('accepts the three documented values', () => {
    expect(chapterStatusSchema.parse('draft')).toBe('draft');
    expect(chapterStatusSchema.parse('revision')).toBe('revision');
    expect(chapterStatusSchema.parse('final')).toBe('final');
  });

  it('rejects unknown status values', () => {
    expect(() => chapterStatusSchema.parse('archived')).toThrow();
    expect(() => chapterStatusSchema.parse('DRAFT')).toThrow();
    expect(() => chapterStatusSchema.parse(0)).toThrow();
  });
});

describe('chapterMetaSchema', () => {
  it('accepts a valid meta row', () => {
    expect(chapterMetaSchema.parse(VALID_META)).toEqual(VALID_META);
  });

  it('is strict — rejects unknown keys', () => {
    expect(() =>
      chapterMetaSchema.parse({ ...VALID_META, bodyJson: { type: 'doc' } }),
    ).toThrow();
    expect(() => chapterMetaSchema.parse({ ...VALID_META, userId: 'u1' })).toThrow();
  });

  it('rejects non-datetime created/updated strings', () => {
    expect(() => chapterMetaSchema.parse({ ...VALID_META, createdAt: '' })).toThrow();
    expect(() =>
      chapterMetaSchema.parse({ ...VALID_META, createdAt: 'yesterday' }),
    ).toThrow();
  });

  it('rejects negative wordCount or non-integer orderIndex', () => {
    expect(() => chapterMetaSchema.parse({ ...VALID_META, wordCount: -1 })).toThrow();
    expect(() => chapterMetaSchema.parse({ ...VALID_META, orderIndex: 1.5 })).toThrow();
  });
});

describe('chapterSchema', () => {
  it('accepts meta + bodyJson (full shape)', () => {
    const full = { ...VALID_META, bodyJson: { type: 'doc', content: [] } };
    expect(chapterSchema.parse(full)).toEqual(full);
  });

  it('accepts bodyJson: null (empty chapter)', () => {
    const full = { ...VALID_META, bodyJson: null };
    expect(chapterSchema.parse(full)).toEqual(full);
  });

  it('preserves strictness through .extend() — rejects keys beyond meta + bodyJson', () => {
    expect(() =>
      chapterSchema.parse({ ...VALID_META, bodyJson: null, userId: 'u1' }),
    ).toThrow();
  });
});

describe('chapterCreateSchema', () => {
  it('accepts title-only', () => {
    expect(chapterCreateSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
  });

  it('accepts title + bodyJson + status', () => {
    const input = { title: 'New', bodyJson: { type: 'doc' }, status: 'draft' as const };
    expect(chapterCreateSchema.parse(input)).toEqual(input);
  });

  it(`rejects title shorter than ${CHAPTER_TITLE_MIN} or longer than ${CHAPTER_TITLE_MAX}`, () => {
    expect(() => chapterCreateSchema.parse({ title: '' })).toThrow();
    expect(() => chapterCreateSchema.parse({ title: 'x'.repeat(CHAPTER_TITLE_MAX + 1) })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() =>
      chapterCreateSchema.parse({ title: 'New', orderIndex: 0 }),
    ).toThrow();
    expect(() =>
      chapterCreateSchema.parse({ title: 'New', wordCount: 0 }),
    ).toThrow();
  });
});

describe('chapterUpdateSchema', () => {
  it('accepts every optional field individually', () => {
    expect(chapterUpdateSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
    expect(chapterUpdateSchema.parse({ bodyJson: { type: 'doc' } })).toEqual({
      bodyJson: { type: 'doc' },
    });
    expect(chapterUpdateSchema.parse({ status: 'final' })).toEqual({ status: 'final' });
    expect(chapterUpdateSchema.parse({ orderIndex: 3 })).toEqual({ orderIndex: 3 });
  });

  it('accepts an empty object (no-op update)', () => {
    expect(chapterUpdateSchema.parse({})).toEqual({});
  });

  it('rejects unknown keys including server-derived wordCount', () => {
    expect(() => chapterUpdateSchema.parse({ wordCount: 5 })).toThrow();
    expect(() => chapterUpdateSchema.parse({ id: 'c1' })).toThrow();
  });
});

describe('chapterReorderSchema', () => {
  it('accepts a non-empty array of {id, orderIndex} pairs', () => {
    const input = { chapters: [{ id: 'c1', orderIndex: 0 }, { id: 'c2', orderIndex: 1 }] };
    expect(chapterReorderSchema.parse(input)).toEqual(input);
  });

  it('rejects empty arrays', () => {
    expect(() => chapterReorderSchema.parse({ chapters: [] })).toThrow();
  });

  it('rejects arrays over 500 items', () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, orderIndex: i }));
    expect(() => chapterReorderSchema.parse({ chapters: tooMany })).toThrow();
  });

  it('rejects extra keys on each item', () => {
    expect(() =>
      chapterReorderSchema.parse({
        chapters: [{ id: 'c1', orderIndex: 0, title: 'sneak' }],
      }),
    ).toThrow();
  });
});

describe('chapterResponseSchema / chaptersResponseSchema', () => {
  it('chapterResponseSchema wraps a full chapter', () => {
    const full = { ...VALID_META, bodyJson: null };
    expect(chapterResponseSchema.parse({ chapter: full })).toEqual({ chapter: full });
  });

  it('chapterResponseSchema rejects extra envelope keys', () => {
    expect(() =>
      chapterResponseSchema.parse({ chapter: { ...VALID_META, bodyJson: null }, ok: true }),
    ).toThrow();
  });

  it('chaptersResponseSchema wraps an array of metas', () => {
    expect(chaptersResponseSchema.parse({ chapters: [VALID_META] })).toEqual({
      chapters: [VALID_META],
    });
  });

  it('chaptersResponseSchema rejects bodyJson on individual entries', () => {
    expect(() =>
      chaptersResponseSchema.parse({
        chapters: [{ ...VALID_META, bodyJson: { type: 'doc' } }],
      }),
    ).toThrow();
  });
});

describe('encrypted-field tuples', () => {
  it('exports both tuples with the expected members', () => {
    expect(CHAPTER_ENCRYPTED_FIELD_KEYS).toEqual(['title', 'body']);
    expect(CHAPTER_META_ENCRYPTED_FIELD_KEYS).toEqual(['title']);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL (module not yet created)**

Run: `npm -w story-editor-shared test -- src/schemas/chapter.test.ts`
Expected: FAIL with `Cannot find module './chapter.js'` (or similar TS/Vitest module-resolution error).

- [ ] **Step 3: Write `shared/src/schemas/chapter.ts`**

```ts
// shared/src/schemas/chapter.ts
import { z } from 'zod';

export const CHAPTER_TITLE_MIN = 1;
export const CHAPTER_TITLE_MAX = 500;

export const chapterStatusSchema = z.enum(['draft', 'revision', 'final']);

/**
 * Chapter metadata — the LIST endpoint payload shape. Excludes the TipTap
 * body so the chapter-sidebar payload stays small. `chapterSchema` (below)
 * extends this with `bodyJson` for detail responses.
 */
export const chapterMetaSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  status: chapterStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Full chapter — meta + TipTap body. POST / PATCH / GET-by-id payload shape.
 * `bodyJson` is `z.unknown()` because TipTap's internal tree structure is
 * its own contract; we pass it through unvalidated.
 */
export const chapterSchema = chapterMetaSchema.extend({
  bodyJson: z.unknown(),
});

export const chapterCreateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX),
  bodyJson: z.unknown().optional(),
  status: chapterStatusSchema.optional(),
});

export const chapterUpdateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX).optional(),
  bodyJson: z.unknown().optional(),
  status: chapterStatusSchema.optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

/**
 * Bulk reorder payload. Semantic checks (duplicate ids, duplicate orderIndex
 * values) live in the route handler — this schema only validates shape.
 */
export const chapterReorderSchema = z.strictObject({
  chapters: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        orderIndex: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

// Response envelopes
export const chapterResponseSchema = z.strictObject({ chapter: chapterSchema });
export const chaptersResponseSchema = z.strictObject({
  chapters: z.array(chapterMetaSchema),
});

// Co-located encrypted-field tuples. Two — full has body + title; meta has only title.
export const CHAPTER_ENCRYPTED_FIELD_KEYS = ['title', 'body'] as const;
export const CHAPTER_META_ENCRYPTED_FIELD_KEYS = ['title'] as const;

// z.infer type exports
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterMeta = z.infer<typeof chapterMetaSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type ChapterReorderInput = z.infer<typeof chapterReorderSchema>;
export type ChapterEncryptedFieldKey = (typeof CHAPTER_ENCRYPTED_FIELD_KEYS)[number];
export type ChapterMetaEncryptedFieldKey = (typeof CHAPTER_META_ENCRYPTED_FIELD_KEYS)[number];
```

- [ ] **Step 4: Run the tests, expect PASS**

Run: `npm -w story-editor-shared test -- src/schemas/chapter.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck shared workspace**

Run: `npm -w story-editor-shared run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/chapter.ts shared/src/schemas/chapter.test.ts
git commit -m "[story-editor-ggl] shared: canonical Chapter Zod schemas + tests"
```

---

## Task 2: Re-export from `shared/src/index.ts`

**Files:**
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Add the re-exports**

Open `shared/src/index.ts` and add the Chapter exports, alphabetised within the existing groups (look for how Outline / Chat are re-exported for the template). The block looks like this:

```ts
// types
  type Chapter,
  type ChapterCreateInput,
  type ChapterEncryptedFieldKey,
  type ChapterMeta,
  type ChapterMetaEncryptedFieldKey,
  type ChapterReorderInput,
  type ChapterStatus,
  type ChapterUpdateInput,
```

```ts
// schemas + constants
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  CHAPTER_TITLE_MAX,
  CHAPTER_TITLE_MIN,
  chapterCreateSchema,
  chapterMetaSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chapterSchema,
  chapterStatusSchema,
  chapterUpdateSchema,
  chaptersResponseSchema,
```

Source the re-export from `./schemas/chapter.js` (matching the path style used by other schema re-exports).

- [ ] **Step 2: Typecheck shared workspace**

Run: `npm -w story-editor-shared run typecheck`
Expected: no errors.

- [ ] **Step 3: Typecheck backend + frontend (verify no symbol collision yet)**

Run: `npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck`
Expected: no errors. (No consumer imports the new symbols yet; this just confirms the re-export doesn't break downstream typechecks.)

- [ ] **Step 4: Commit**

```bash
git add shared/src/index.ts
git commit -m "[story-editor-ggl] shared: re-export Chapter schemas + types"
```

---

## Task 3: Backend Repo Migration

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts`
- Modify: `backend/src/routes/chapters.routes.ts` (rename-only — the full route migration is Task 5)

This task is a single logical unit: it renames the repo's local `ChapterCreateInput` / `ChapterUpdateInput` interfaces, adds the new `RepoChapter` / `RepoChapterMeta` type aliases, swaps the encrypted-field tuples for shared imports, and updates the single rename-only line in `chapters.routes.ts:12` so the build stays green at every commit.

- [ ] **Step 1: Read current chapter.repo.ts to confirm line numbers**

Run: `grep -n "ChapterCreateInput\|ChapterUpdateInput\|ENCRYPTED_FIELDS\|META_ENCRYPTED_FIELDS\|function shape\|function shapeMeta" backend/src/repos/chapter.repo.ts`
Expected output (current state — line numbers may drift slightly; use the grep result as the authority):
- `ENCRYPTED_FIELDS = ['title', 'body']` near top
- `META_ENCRYPTED_FIELDS = ['title']` near top
- `export interface ChapterCreateInput` ~line 13
- `export interface ChapterUpdateInput` ~line 27
- `function create(input: ChapterCreateInput)` ~line 64
- `function update(id: string, input: ChapterUpdateInput)` ~line 128
- `function shapeMeta` ~line 282
- `function shape` ~line 286

- [ ] **Step 2: Edit `backend/src/repos/chapter.repo.ts`**

Make these changes in order:

1. **Add the shared imports** near the top of the file (next to the other `story-editor-shared` imports if any, otherwise after the existing imports):

```ts
import {
  type Chapter,
  type ChapterMeta,
  type ChapterStatus,
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_META_ENCRYPTED_FIELD_KEYS,
} from 'story-editor-shared';
```

2. **Delete the local consts:**

```ts
// DELETE these two lines (current ~lines 6, 11):
const ENCRYPTED_FIELDS = ['title', 'body'] as const;
const META_ENCRYPTED_FIELDS = ['title'] as const;
```

3. **Rename the two input interfaces and update their references:**

`export interface ChapterCreateInput` → `export interface RepoChapterCreateInput`.
`export interface ChapterUpdateInput` → `export interface RepoChapterUpdateInput`.
Find-replace in the same file: any reference to `ChapterCreateInput` becomes `RepoChapterCreateInput`; same for Update. The `create(input: ChapterCreateInput)` and `update(id: string, input: ChapterUpdateInput)` function signatures are the two main usage sites in the repo file.

4. **Add the new repo type aliases** right after the renamed input interfaces. **Use `type`, not `interface`** — load-bearing for `projectDecrypted<T>`'s `Record<string, unknown>` constraint (same gotcha the Chat consolidation hit at commit `9cae5cf`):

```ts
/**
 * Internal repo shape for a fully-decrypted chapter (post-rename of `body`
 * column to `bodyJson` parsed object — see `shape()`). Defined as a `type`
 * alias, not `interface`, so it satisfies `Record<string, unknown>` (the
 * constraint on `projectDecrypted<T>`'s generic).
 */
export type RepoChapter = {
  id: string;
  storyId: string;
  title: string;
  bodyJson: unknown;
  wordCount: number;
  orderIndex: number;
  status: ChapterStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Metadata-only repo shape — same as RepoChapter minus `bodyJson`. Returned
 * by `shapeMeta()`.
 */
export type RepoChapterMeta = Omit<RepoChapter, 'bodyJson'>;
```

5. **Update `shapeMeta()` to type the projection generic.** The current body is:

```ts
function shapeMeta(row: unknown, req: Request) {
  return projectDecrypted(req, row as Record<string, unknown>, META_ENCRYPTED_FIELDS);
}
```

Change to:

```ts
function shapeMeta(row: unknown, req: Request): RepoChapterMeta {
  return projectDecrypted<RepoChapterMeta>(
    req,
    row as Record<string, unknown>,
    CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  );
}
```

6. **Update `shape()` — type only the return value, NOT the inner `projectDecrypted` call.** Per the spec: at the projection step, the object still has `body: string` (the decrypted plaintext), and the rename to `bodyJson` happens after. Typing `projectDecrypted<RepoChapter>` would be a lie. The current body is:

```ts
function shape(row: unknown, req: Request) {
  const projected = projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS);
  // ... rename body -> bodyJson ...
  return projected;
}
```

Change to:

```ts
function shape(row: unknown, req: Request): RepoChapter {
  const projected = projectDecrypted(
    req,
    row as Record<string, unknown>,
    CHAPTER_ENCRYPTED_FIELD_KEYS,
  );
  // The encrypted column is named `body` (matching `bodyCiphertext/Iv/AuthTag`),
  // but the API contract surfaces the TipTap document tree as `bodyJson`. Parse
  // the serialised JSON and rename the field on the way out.
  let bodyJson: unknown = null;
  if (typeof projected.body === 'string' && projected.body.length > 0) {
    try {
      bodyJson = JSON.parse(projected.body as string);
    } catch {
      bodyJson = projected.body;
    }
  }
  delete projected.body;
  projected.bodyJson = bodyJson;
  return projected as RepoChapter;
}
```

(The inner block of `shape()` is unchanged — only the function signature and the final `return` cast are new.)

- [ ] **Step 3: Edit `backend/src/routes/chapters.routes.ts` — rename-only**

Open `chapters.routes.ts` and update the import + the single usage site:

```ts
// Find the import block referencing the repo (current ~line 12):
import {
  type ChapterUpdateInput,
  // ... other repo imports ...
} from '../repos/chapter.repo.js';

// Change to:
import {
  type RepoChapterUpdateInput,
  // ... other repo imports ...
} from '../repos/chapter.repo.js';
```

And the single usage site (currently at ~line 236):

```ts
// Before:
const input: ChapterUpdateInput = {};

// After:
const input: RepoChapterUpdateInput = {};
```

If grep finds a `ChapterCreateInput` import or usage in `chapters.routes.ts` (currently it doesn't, but verify), rename to `RepoChapterCreateInput` the same way.

- [ ] **Step 4: Typecheck backend**

Run: `npm -w story-editor-backend run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the backend chapter tests (requires stack up)**

```bash
# If stack not already up:
make dev
timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'

# Then:
npm -w story-editor-backend test -- tests/routes/chapters tests/repos/chapter
```

Expected: all chapter route + repo tests PASS. (No behavior changes; just types.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/repos/chapter.repo.ts backend/src/routes/chapters.routes.ts
git commit -m "[story-editor-ggl] backend: repo types + shared encrypted-field tuples"
```

---

## Task 4: Serializer + Stray-Key Lock Test

**Files:**
- Modify: `backend/src/lib/serialize.ts`
- Modify: `backend/tests/lib/serialize.test.ts`

- [ ] **Step 1: Write the serializer tests first (TDD)**

Open `backend/tests/lib/serialize.test.ts` and append two new describe blocks. The existing file pattern can be referenced for imports / shape — mirror how `serializeChat` is tested:

```ts
// New imports needed at top of the file:
import type { RepoChapter, RepoChapterMeta } from '../../src/repos/chapter.repo.js';
import { serializeChapter, serializeChapterMeta } from '../../src/lib/serialize.js';

// Sample fixtures used across the two describe blocks:
const ISO = '2026-05-15T00:00:00.000Z';
const REPO_CHAPTER: RepoChapter = {
  id: 'c1',
  storyId: 's1',
  title: 'Chapter One',
  bodyJson: { type: 'doc', content: [] },
  wordCount: 12,
  orderIndex: 0,
  status: 'draft',
  createdAt: new Date(ISO),
  updatedAt: new Date(ISO),
};

const REPO_CHAPTER_META: RepoChapterMeta = {
  id: 'c1',
  storyId: 's1',
  title: 'Chapter One',
  wordCount: 12,
  orderIndex: 0,
  status: 'draft',
  createdAt: new Date(ISO),
  updatedAt: new Date(ISO),
};

describe('serializeChapter', () => {
  it('emits the wire-shape Chapter from a RepoChapter row', () => {
    expect(serializeChapter(REPO_CHAPTER)).toEqual({
      id: 'c1',
      storyId: 's1',
      title: 'Chapter One',
      bodyJson: { type: 'doc', content: [] },
      wordCount: 12,
      orderIndex: 0,
      status: 'draft',
      createdAt: ISO,
      updatedAt: ISO,
    });
  });

  it('converts Date instances to ISO strings', () => {
    const out = serializeChapter(REPO_CHAPTER);
    expect(out.createdAt).toBe(ISO);
    expect(out.updatedAt).toBe(ISO);
  });

  it('passes bodyJson through unchanged (including null)', () => {
    const empty: RepoChapter = { ...REPO_CHAPTER, bodyJson: null };
    expect(serializeChapter(empty).bodyJson).toBeNull();
  });

  it('does not leak stray fields from the repo row', () => {
    // Explicit-pick contract: any future column added to RepoChapter that
    // isn't on the wire shape must not slip through to the response.
    const row = {
      ...REPO_CHAPTER,
      titleCiphertext: Buffer.from('xx'),
    } as unknown as RepoChapter;
    const out = serializeChapter(row);
    expect(out).not.toHaveProperty('titleCiphertext');
  });
});

describe('serializeChapterMeta', () => {
  it('emits the wire-shape ChapterMeta from a RepoChapterMeta row', () => {
    expect(serializeChapterMeta(REPO_CHAPTER_META)).toEqual({
      id: 'c1',
      storyId: 's1',
      title: 'Chapter One',
      wordCount: 12,
      orderIndex: 0,
      status: 'draft',
      createdAt: ISO,
      updatedAt: ISO,
    });
  });

  it('does not leak bodyJson if accidentally present on the input', () => {
    // Defensive: if a caller somehow feeds a RepoChapter (with bodyJson) into
    // serializeChapterMeta, the explicit pick still omits bodyJson.
    const wide = { ...REPO_CHAPTER_META, bodyJson: 'sneaky' } as unknown as RepoChapterMeta;
    const out = serializeChapterMeta(wide);
    expect(out).not.toHaveProperty('bodyJson');
  });

  it('does not leak stray fields from the repo row', () => {
    const row = {
      ...REPO_CHAPTER_META,
      titleCiphertext: Buffer.from('xx'),
    } as unknown as RepoChapterMeta;
    const out = serializeChapterMeta(row);
    expect(out).not.toHaveProperty('titleCiphertext');
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm -w story-editor-backend test -- tests/lib/serialize.test.ts`
Expected: FAIL — `serializeChapter` / `serializeChapterMeta` not exported.

- [ ] **Step 3: Add `serializeChapter` and `serializeChapterMeta` to `backend/src/lib/serialize.ts`**

Open `backend/src/lib/serialize.ts` and append two new exports (after `serializeOutlineItem`):

```ts
// Add to existing imports from story-editor-shared:
import type { Chapter, ChapterMeta /* + existing imports */ } from 'story-editor-shared';

// Add a new import from the chapter repo (at the top with the other repo imports):
import type { RepoChapter, RepoChapterMeta } from '../repos/chapter.repo.js';

// At the bottom of the file, after serializeOutlineItem:

export function serializeChapter(row: RepoChapter): Chapter {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    bodyJson: row.bodyJson,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeChapterMeta(row: RepoChapterMeta): ChapterMeta {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

Both helpers use **explicit pick** (not spread). This is the entire point — stray columns on the repo row do not leak to the wire.

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm -w story-editor-backend test -- tests/lib/serialize.test.ts`
Expected: PASS — all new describe blocks green.

- [ ] **Step 5: Typecheck backend**

Run: `npm -w story-editor-backend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/serialize.ts backend/tests/lib/serialize.test.ts
git commit -m "[story-editor-ggl] backend: serializeChapter + serializeChapterMeta + stray-key locks"
```

---

## Task 5: Route Migration to Shared Schemas

**Files:**
- Modify: `backend/src/routes/chapters.routes.ts`

- [ ] **Step 1: Add the shared schema imports near the top of the file**

```ts
import {
  type ChapterCreateInput,
  type ChapterUpdateInput,
  chapterCreateSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chapterStatusSchema,
  chapterUpdateSchema,
  chaptersResponseSchema,
} from 'story-editor-shared';
```

Also add the serializer imports:

```ts
import { serializeChapter, serializeChapterMeta } from '../lib/serialize.js';
```

And keep the existing `respond` import (or add it if not present — `../lib/respond.js`).

- [ ] **Step 2: Delete the inline schemas**

Remove these consts (current ~lines 29–62):

```ts
const ChapterStatus = z.enum(['draft', 'revision', 'final']);  // DELETE
const CreateChapterBody = z.strictObject({ ... });             // DELETE
const UpdateChapterBody = z.strictObject({ ... });             // DELETE
const ReorderChaptersBody = z.strictObject({ ... });           // DELETE
```

Update every callsite that previously referenced `CreateChapterBody.safeParse(...)` → `chapterCreateSchema.safeParse(...)`. Same for `UpdateChapterBody` → `chapterUpdateSchema`, `ReorderChaptersBody` → `chapterReorderSchema`. `ChapterStatus` (the enum) usages, if any beyond the inline schema, → `chapterStatusSchema`.

- [ ] **Step 3: Replace handler-exit `res.json(...)` with `respond(schema, res, data, status?)`**

For each handler:

**POST `/stories/:storyId/chapters` (create):**

```ts
// Before:
res.status(201).json({ chapter: shape(created, req) });

// After:
respond(chapterResponseSchema, res, { chapter: serializeChapter(shape(created, req)) }, 201);
```

(Note: `shape()` returns `RepoChapter`; `serializeChapter()` converts to the wire `Chapter`. The pipeline is `repo row → shape() (decrypted RepoChapter) → serializeChapter() (wire-shape) → respond() (validated + sent)`.)

**GET `/stories/:storyId/chapters` (list):**

```ts
// Before:
res.json({ chapters: rows.map((r) => shapeMeta(r, req)) });

// After:
respond(chaptersResponseSchema, res, {
  chapters: rows.map((r) => serializeChapterMeta(shapeMeta(r, req))),
});
```

**GET `/stories/:storyId/chapters/:chapterId` (detail):**

```ts
// Before:
res.json({ chapter: shape(row, req) });

// After:
respond(chapterResponseSchema, res, { chapter: serializeChapter(shape(row, req)) });
```

**PATCH `/stories/:storyId/chapters/:chapterId` (update):**

```ts
// Before:
res.json({ chapter: shape(updated, req) });

// After:
respond(chapterResponseSchema, res, { chapter: serializeChapter(shape(updated, req)) });
```

**PATCH `/stories/:storyId/chapters/reorder` (reorder):** Stays `res.status(204).end()` — no schema body.

**DELETE `/stories/:storyId/chapters/:chapterId`:** Stays `res.status(204).end()` — no schema body.

- [ ] **Step 4: Typecheck backend**

Run: `npm -w story-editor-backend run typecheck`
Expected: no errors. (If `z` is now unused after removing the inline schemas, drop the `import { z } from 'zod'` line.)

- [ ] **Step 5: Run the backend chapter route tests**

```bash
# Stack must be up — see Task 3 step 5 if not.
npm -w story-editor-backend test -- tests/routes/chapters tests/repos/chapter tests/lib/serialize tests/security/encryption-leak
```

Expected: all tests PASS. No behavior changes; the response bodies are identical, just validated on exit now.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/chapters.routes.ts
git commit -m "[story-editor-ggl] backend: route migration to shared Chapter schemas + respond() + serializeChapter"
```

---

## Task 6: Frontend Hook Migration

**Files:**
- Modify: `frontend/src/hooks/useChapters.ts`

- [ ] **Step 1: Replace the top-of-file imports**

```ts
// Before (current ~lines 1-9):
import {
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

// After:
import {
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Chapter,
  type ChapterCreateInput,
  type ChapterMeta,
  type ChapterUpdateInput,
  chapterResponseSchema,
  chaptersResponseSchema,
} from 'story-editor-shared';
import { api } from '@/lib/api';
```

- [ ] **Step 2: Delete the local interface declarations**

Remove these blocks (current line ranges in parens):

- `interface ChapterMeta` (~lines 18–27)
- `interface Chapter extends ChapterMeta` (~lines 35–37)
- `interface ChaptersResponse` (~lines 39–41)
- `interface ChapterResponse` (~lines 43–45)
- `interface CreateChapterInput` (~lines 68–71) — **renamed** to use shared `ChapterCreateInput` everywhere it was referenced
- `interface UpdateChapterInput` (~lines 265–268) — **renamed** to use shared `ChapterUpdateInput` everywhere it was referenced

Find-replace within `useChapters.ts`:
- `CreateChapterInput` → `ChapterCreateInput`
- `UpdateChapterInput` → `ChapterUpdateInput`

(The hook's exported `UpdateChapterArgs.input` type referenced `UpdateChapterInput` — that name becomes `ChapterCreateInput` / `ChapterUpdateInput` from shared. Callers in `EditorPage.tsx` that destructure `input` need no change because they pass strict subsets.)

- [ ] **Step 3: Runtime-`.parse()` every fetch success path**

**`useChaptersQuery`** (current ~lines 53–66):

```ts
// Before:
queryFn: async (): Promise<ChapterMeta[]> => {
  const res = await api<ChaptersResponse>(
    `/stories/${encodeURIComponent(storyId ?? '')}/chapters`,
  );
  return res.chapters;
},

// After:
queryFn: async (): Promise<ChapterMeta[]> => {
  const res = await api<unknown>(
    `/stories/${encodeURIComponent(storyId ?? '')}/chapters`,
  );
  return chaptersResponseSchema.parse(res).chapters;
},
```

**`useCreateChapterMutation`** (current ~lines 73–89):

```ts
// Before:
mutationFn: async (input: CreateChapterInput): Promise<Chapter> => {
  const res = await api<ChapterResponse>(`/stories/${encodeURIComponent(storyId)}/chapters`, {
    method: 'POST',
    body: input,
  });
  return res.chapter;
},

// After:
mutationFn: async (input: ChapterCreateInput): Promise<Chapter> => {
  const res = await api<unknown>(`/stories/${encodeURIComponent(storyId)}/chapters`, {
    method: 'POST',
    body: input,
  });
  return chapterResponseSchema.parse(res).chapter;
},
```

**`useChapterQuery`** (current ~lines 240–261):

```ts
// Before:
const res = await api<ChapterResponse>(
  `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
);
return res.chapter;

// After:
const res = await api<unknown>(
  `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
);
return chapterResponseSchema.parse(res).chapter;
```

**`useUpdateChapterMutation`** (current ~lines 332–354):

```ts
// Before:
const res = await api<ChapterResponse>(
  `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
  { method: 'PATCH', body: input as Record<string, unknown> },
);
return res.chapter;

// After:
const res = await api<unknown>(
  `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
  { method: 'PATCH', body: input as Record<string, unknown> },
);
return chapterResponseSchema.parse(res).chapter;
```

(`useDeleteChapterMutation` and `useReorderChaptersMutation` return `void` from the network call — no parse needed.)

- [ ] **Step 4: Drop the `as ChapterMeta` cast in the optimistic-cache write**

Current `useUpdateChapterMutation` onSuccess (line ~348):

```ts
onSuccess: (chapter) => {
  // List cache is metadata-only — strip `bodyJson` before merging.
  const { bodyJson: _bodyJson, ...meta } = chapter;
  void _bodyJson;
  qc.setQueryData<ChapterMeta[] | undefined>(chaptersQueryKey(chapter.storyId), (prev) => {
    if (!prev) return prev;
    return prev.map((c) => (c.id === chapter.id ? (meta as ChapterMeta) : c));
  });
  qc.setQueryData<Chapter>(chapterQueryKey(chapter.id), chapter);
},
```

Change `meta as ChapterMeta` to plain `meta`. The destructure already produces the right shape now that the types come from shared:

```ts
return prev.map((c) => (c.id === chapter.id ? meta : c));
```

- [ ] **Step 5: Typecheck frontend**

Run: `npm -w story-editor-frontend run typecheck`
Expected: no errors. If callers in `EditorPage.tsx` complain, inspect — they currently pass `{ bodyJson }` and `{ title }`, both strict subsets of shared `ChapterUpdateInput`.

- [ ] **Step 6: Run the frontend hook tests**

Run: `npm -w story-editor-frontend test -- tests/hooks/useChapter.test.tsx`
Expected: PASS. (If a runtime `.parse()` failure surfaces because a mock returns a shape that doesn't match `chapterSchema`, Task 7 handles the fixture audit.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useChapters.ts
git commit -m "[story-editor-ggl] frontend: useChapters onto shared types + runtime .parse() + drop ChapterMeta cast"
```

---

## Task 7: Test Fixture Audit

**Files:**
- Audit + (if drift found) modify each of:
  - `frontend/tests/pages/editor-shell.integration.test.tsx`
  - `frontend/tests/pages/editor-paper.integration.test.tsx`
  - `frontend/tests/pages/editor-ai.integration.test.tsx`
  - `frontend/tests/pages/editor-autosave.integration.test.tsx`
  - `frontend/tests/pages/character-popover.integration.test.tsx`
  - `frontend/tests/pages/chat-panel.integration.test.tsx`
  - `frontend/tests/pages/editor.test.tsx`
  - `frontend/tests/components/ChapterList.test.tsx`
  - `frontend/tests/components/ChapterList.delete.test.tsx`
  - `frontend/tests/hooks/useChapter.test.tsx`

This is an audit task. **Most fixtures will pass without modification** — the LIST-shape fixtures across these files already match `chapterMetaSchema`. The audit is to confirm, and to fix any drift that causes runtime `.parse()` failures.

**Mocking-style note (from bd memory `when-migrating-an-entity-onto-shared-zod-schemas`):**
- Fixtures fed through **`fetchMock`** (Vitest's `fetch` interceptor) → flow through the hook's `queryFn` → trigger `chaptersResponseSchema.parse()` / `chapterResponseSchema.parse()` at runtime. Strict schema rejects any stray key.
- Fixtures fed through **`vi.mocked(api.someFn).mockResolvedValue(...)`** → bypass the hook's queryFn entirely (the api wrapper is replaced). Strict schema is NOT triggered at runtime; only TypeScript narrowing applies.
- Fixtures fed through **`client.setQueryData(...)`** directly → never parsed.

For each test, identify which mocking style is used to feed chapter data, then audit accordingly. If a fixture goes through `fetchMock`, its keys must exactly match the strict schema.

- [ ] **Step 1: Audit `frontend/tests/components/ChapterList.test.tsx`**

```bash
grep -nE "fetchMock|vi\.mocked|setQueryData|makeChap|chap\(" frontend/tests/components/ChapterList.test.tsx | head -20
```

For each fixture object literal (whether inline or factory-produced), confirm the keys are exactly: `id, storyId, title, wordCount, orderIndex, status, createdAt, updatedAt`. No `bodyJson`. No `userId`. `createdAt` / `updatedAt` must be ISO datetime strings (not empty strings).

If drift is found, fix it. If the fixture goes through `vi.mocked(api.*)`, runtime parse won't fail but the fixture should still match the schema for documentation discipline.

- [ ] **Step 2: Audit `frontend/tests/components/ChapterList.delete.test.tsx`**

Same approach. Look for the `chap(...)` factory or inline object literals.

- [ ] **Step 3: Audit the seven page-integration test files**

For each of:
- `editor-shell.integration.test.tsx`
- `editor-paper.integration.test.tsx`
- `editor-ai.integration.test.tsx`
- `editor-autosave.integration.test.tsx`
- `character-popover.integration.test.tsx`
- `chat-panel.integration.test.tsx`
- `editor.test.tsx`

Run:

```bash
grep -nE "fetchMock|chap\(|makeChap|chapters: \[" frontend/tests/pages/<file> | head -20
```

Audit the chapter fixtures the same way. The page-integration tests most likely use `fetchMock`, so runtime parse runs.

- [ ] **Step 4: Audit `frontend/tests/hooks/useChapter.test.tsx` (detail-shape, the one file with bodyJson)**

```bash
grep -nE "fetchMock|chapter: \{|makeChapter|chap\(" frontend/tests/hooks/useChapter.test.tsx | head -20
```

This file feeds **detail-shape** fixtures (with `bodyJson`). The fixture must match `chapterSchema` (meta fields + `bodyJson`).

**Pre-existing oddity flagged in the spec:** `useChapter.test.tsx:147,155` sends `wordCount: 5` in the PATCH input body. This is intentional pre-existing test behavior — the fetch mock never triggers backend strict-validation. **Do not "fix" it** — leave the `wordCount: 5` as-is. Adding `wordCount` to `chapterUpdateSchema` would loosen the wire contract for no reason.

- [ ] **Step 5: Run the full frontend test suite**

```bash
npm -w story-editor-frontend test
```

Expected: PASS. If any test fails with a Zod `.parse()` error, return to step 1 for the offending file and fix the fixture drift surfaced by the failure.

- [ ] **Step 6: Commit (only if any fixture changed)**

```bash
git add frontend/tests/
git commit -m "[story-editor-ggl] frontend: audit chapter test fixtures for strict-schema compliance"
```

If no fixtures changed, skip the commit and continue.

---

## Task 8: Full Verify Run

This is the bd verify line for `story-editor-ggl`, run end-to-end from a clean state.

- [ ] **Step 1: Ensure the stack is up**

```bash
make dev
timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
```

- [ ] **Step 2: Run the canonical verify line**

```bash
npm -w story-editor-shared run typecheck \
 && npm -w story-editor-shared test \
 && npm -w story-editor-backend run typecheck \
 && npm -w story-editor-frontend run typecheck \
 && npm -w story-editor-backend test -- tests/routes/chapters tests/repos/chapter tests/lib/serialize tests/security/encryption-leak \
 && npm -w story-editor-frontend test -- tests/hooks/useChapter tests/components/ChapterList tests/pages/editor-paper.integration tests/pages/editor-shell.integration tests/pages/editor-autosave.integration
```

Expected: ALL green.

The `tests/security/encryption-leak` step is the critical gate — it's the sentinel test that runs across all narrative entities including Chapter, and a fixture-drift or missed encryption-field-tuple swap would leak plaintext into ciphertext columns and fail this test.

- [ ] **Step 3: Inspect the final git diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected diff:
- New: `shared/src/schemas/chapter.ts`, `shared/src/schemas/chapter.test.ts`
- Modified: `shared/src/index.ts`, `backend/src/repos/chapter.repo.ts`, `backend/src/routes/chapters.routes.ts`, `backend/src/lib/serialize.ts`, `backend/tests/lib/serialize.test.ts`, `frontend/src/hooks/useChapters.ts`
- Possibly modified: zero or more frontend test fixture files

No untracked files. No `.beads/issues.jsonl` drift (we already committed the bd notes update on the branch's first commit).

- [ ] **Step 4: Hand off to `/bd-close-reviewed`**

The implementation work is complete. Close the issue through the project's review gate:

```bash
/bd-close-reviewed story-editor-ggl
```

`/bd-close-reviewed` will:
1. Typecheck the affected workspaces.
2. Run the verify line from `--notes`.
3. Fan path-matched surface reviewers (`repo-boundary-reviewer` for the repo / serializer / routes touches; `security-reviewer` is **not** required here — no auth/crypto-primitive surface).
4. Refuse close on `BLOCK` / `FIX_BEFORE_MERGE`.

If a reviewer blocks, fix the underlying code (not the test, not the verify line) and re-run.

---

## Self-Review

**Spec coverage:** Walked through `docs/superpowers/specs/2026-05-15-chapter-entity-consolidation-design.md` section-by-section:
- Goal + two-schema split direction → Task 1 (chapterMetaSchema base, chapterSchema extends).
- Shared schemas file → Task 1.
- Backend repo migration (type aliases, rename, tuple imports, shape() typing asymmetry) → Task 3.
- Serializer + stray-key locks → Task 4.
- Routes migration (`respond()` + `serializeChapter` / `serializeChapterMeta`) → Task 5.
- Frontend hook migration (runtime parse, drop `as ChapterMeta`) → Task 6.
- Test fixture audit (10 files, mocking-style discrimination, `wordCount: 5` caveat) → Task 7.
- Verify line → Task 8.
- Non-goals (status UX, wordCount derivation) → tracked separately in `story-editor-bti` / `story-editor-ppn`; this plan honours them.

**Placeholder scan:** No TBDs / TODOs / "implement appropriately" / "fill in later". Every code block is complete.

**Type consistency:**
- `RepoChapter` / `RepoChapterMeta` named consistently from Task 3 through Task 4 and Task 5.
- `RepoChapterCreateInput` / `RepoChapterUpdateInput` (renamed locals) used consistently in Task 3.
- `ChapterCreateInput` / `ChapterUpdateInput` (shared wire types) used consistently from Task 1 onwards.
- `CHAPTER_ENCRYPTED_FIELD_KEYS` / `CHAPTER_META_ENCRYPTED_FIELD_KEYS` used consistently.
- `serializeChapter` / `serializeChapterMeta` named consistently.
- `chapterSchema` / `chapterMetaSchema` / `chapterResponseSchema` / `chaptersResponseSchema` used consistently across Task 1 (defined), Task 5 (consumed by `respond()`), Task 6 (consumed by `.parse()`).
