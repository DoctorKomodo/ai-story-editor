# Story entity consolidation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `Story` to a single canonical Zod schema set in `story-editor-shared`, rip out the inline backend validators + the frontend hand-rolled interfaces, apply `respond()` egress on every surviving handler, delete the dead `/api/stories/:id/progress` endpoint, and rewrite `serializeCharacter` to explicit-pick — all in one PR.

**Architecture:** Pattern-copy of PR #100 (Character) / PR #104 (Message). The `shared/` workspace, `respond()`, `serialize*`, and the `*ResponseSchema.parse(…)` frontend idiom already exist — this plan extends them to Story. Tasks are ordered so backend typecheck stays green after each: shared schemas first (no consumers), then the `/progress` deletion (self-contained), then repo → serialize → routes (each leaves the build compiling), then frontend.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, Express 5, Prisma 7, React 19, Vite 8, TanStack Query. No new dependencies. No Prisma schema or migration changes.

**Spec:** `docs/superpowers/specs/2026-05-14-story-entity-consolidation-design.md`

**bd:** `story-editor-d7e`. Plan link applied via `bash scripts/bd-link-plan.sh story-editor-d7e docs/superpowers/plans/2026-05-14-story-entity-consolidation.md` *after user approval of this plan*.

**Branch:** `feature/story-entity-consolidation` (already created; the spec is committed on it).

---

## File structure

**Created:**
- `shared/src/schemas/story.ts` — canonical Story Zod schemas, types, `STORY_ENCRYPTED_FIELD_KEYS`, `STORY_*_MAX` caps
- `shared/tests/story.schema.test.ts` — schema unit tests

**Modified (shared):**
- `shared/src/index.ts` — re-export the new story symbols

**Modified (backend):**
- `backend/src/repos/story.repo.ts` — consume shared types, add `RepoStory`, `projectDecrypted<RepoStory>`, `STORY_ENCRYPTED_FIELD_KEYS`; delete `findTargetWords`
- `backend/src/repos/chapter.repo.ts` — delete `listWordCountsForStory` (only caller was the `/progress` route)
- `backend/src/routes/stories.routes.ts` — delete inline `CreateStoryBody`/`UpdateStoryBody` + the `/:id/progress` handler; consume shared schemas; `respond()` + `serializeStory` on every surviving handler
- `backend/src/lib/serialize.ts` — add `serializeStory`; rewrite `serializeCharacter` from spread to explicit-pick
- `backend/tests/routes/stories.test.ts` — add `no userId` assertions
- `backend/tests/routes/story-detail.test.ts` — add `no userId` assertions
- `backend/tests/lib/serialize.test.ts` — add `serializeStory()` block + a stray-key assertion to the `serializeCharacter()` block

**Modified (frontend):**
- `frontend/src/hooks/useStories.ts` — delete 6 hand-rolled interfaces, import from shared, runtime-validate responses
- `frontend/src/components/StoryModal.tsx` — `StoryInput` → `StoryCreateInput`/`StoryUpdateInput`; `*_MAX` constants from shared
- `frontend/src/components/StoryPicker.stories.tsx` — `StoryListItem` import path → `story-editor-shared`
- `frontend/tests/components/StoryPicker.test.tsx` — add a schema-drift smoke test

**Deleted:**
- `backend/tests/routes/story-progress.test.ts` — tests the deleted `/progress` endpoint

**Untouched (confirmed during planning — the spec's consumer list was conservative):**
- `frontend/src/pages/EditorPage.tsx` — imports only `useStoryQuery` (a value), no Story *type*; compiles unchanged once the hook returns the shared `Story`.
- `frontend/src/components/StoryPicker.tsx` — imports only `useStoriesQuery` (a value); compiles unchanged.
- `frontend/tests/components/StoryModal.test.tsx` / `StoryPickerEmpty.test.tsx` — no `StoryInput` / `*_MAX` / type references; pure render+fetch-mock behaviour tests.
- `backend/src/routes/ai.routes.ts` / `chat.routes.ts` — read `story.worldNotes` behind a `typeof … === 'string'` guard; typing `findById → RepoStory | null` keeps that guard valid (`worldNotes` becomes `string | null`). No edit.

**Verify line (applied to bd `--notes` at link-plan time):**

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/story tests/routes/stor tests/repos/story tests/repos/chapter tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/Story
```

---

## Task 1 — Shared Story schemas + tests

Add the canonical layer in `story-editor-shared`. No consumers touched — lands clean even if no other task runs.

**Files:**
- Create: `shared/src/schemas/story.ts`
- Modify: `shared/src/index.ts`
- Create: `shared/tests/story.schema.test.ts`

- [ ] **1a.** Create `shared/src/schemas/story.ts`:

```ts
import { z } from 'zod';

// Field-length caps — single source of truth, exported so the frontend form
// (StoryModal) imports them instead of re-declaring the same numbers. Values
// copied verbatim from the legacy inline CreateStoryBody in stories.routes.ts.
export const STORY_TITLE_MAX = 500;
export const STORY_GENRE_MAX = 200;
export const STORY_SYNOPSIS_MAX = 10_000;
export const STORY_WORLD_NOTES_MAX = 50_000;

// `z.strictObject` rejects unknown keys at every layer — the load-bearing
// invariant that closes the Prisma↔Zod drift seam at egress-validation time,
// same as character.ts / message.ts. NOTE: no `userId` — Story rows carry a
// userId FK, but it is dropped at the serialize boundary (serializeStory picks
// rather than spreads).
export const storySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  synopsis: z.string().nullable(),
  genre: z.string().nullable(),
  worldNotes: z.string().nullable(),
  targetWords: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Enriched shape for GET /api/stories — the list handler attaches per-story
// chapter aggregates. `.extend()` preserves strictObject strictness.
export const storyListItemSchema = storySchema.extend({
  chapterCount: z.number().int().nonnegative(),
  totalWordCount: z.number().int().nonnegative(),
});

// POST /api/stories request body. strictObject — the legacy inline
// CreateStoryBody was a plain z.object, so this tightens POST to reject
// unknown keys, matching the Character/Message pattern.
export const storyCreateSchema = z.strictObject({
  title: z.string().min(1).max(STORY_TITLE_MAX),
  synopsis: z.string().max(STORY_SYNOPSIS_MAX).nullable().optional(),
  genre: z.string().max(STORY_GENRE_MAX).nullable().optional(),
  worldNotes: z.string().max(STORY_WORLD_NOTES_MAX).nullable().optional(),
  targetWords: z.number().int().positive().nullable().optional(),
});

// PATCH /api/stories/:id request body — every field optional, still strict.
export const storyUpdateSchema = storyCreateSchema.partial();

export const storyResponseSchema = z.strictObject({ story: storySchema });
export const storiesResponseSchema = z.strictObject({
  stories: z.array(storyListItemSchema),
});

// Single source of truth for which Story fields are encrypted at rest.
// Imported by backend/src/repos/story.repo.ts as ENCRYPTED_FIELDS. Mirrors the
// MESSAGE_ENCRYPTED_FIELD_KEYS pattern — a repo-only consumer, but the tuple
// belongs beside the schema describing the same entity.
export const STORY_ENCRYPTED_FIELD_KEYS = ['title', 'synopsis', 'worldNotes'] as const;

export type Story = z.infer<typeof storySchema>;
export type StoryListItem = z.infer<typeof storyListItemSchema>;
export type StoryCreateInput = z.infer<typeof storyCreateSchema>;
export type StoryUpdateInput = z.infer<typeof storyUpdateSchema>;
export type StoryEncryptedFieldKey = (typeof STORY_ENCRYPTED_FIELD_KEYS)[number];
```

- [ ] **1b.** Append to `shared/src/index.ts` (after the existing message block):

```ts
export type {
  Story,
  StoryCreateInput,
  StoryEncryptedFieldKey,
  StoryListItem,
  StoryUpdateInput,
} from './schemas/story';
export {
  STORY_ENCRYPTED_FIELD_KEYS,
  STORY_GENRE_MAX,
  STORY_SYNOPSIS_MAX,
  STORY_TITLE_MAX,
  STORY_WORLD_NOTES_MAX,
  storyCreateSchema,
  storyListItemSchema,
  storyResponseSchema,
  storySchema,
  storiesResponseSchema,
  storyUpdateSchema,
} from './schemas/story';
```

- [ ] **1c.** Create `shared/tests/story.schema.test.ts` (mirrors `shared/tests/character.schema.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  STORY_GENRE_MAX,
  STORY_SYNOPSIS_MAX,
  STORY_TITLE_MAX,
  STORY_WORLD_NOTES_MAX,
  storyCreateSchema,
  storyListItemSchema,
  storyResponseSchema,
  storySchema,
  storiesResponseSchema,
  storyUpdateSchema,
} from '../src/schemas/story';

const validStory = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'The First Draft',
  synopsis: 'A writer meets a deadline.',
  genre: 'literary',
  worldNotes: 'Set in a quiet town.',
  targetWords: 50000,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T01:00:00.000Z',
};

const validListItem = { ...validStory, chapterCount: 3, totalWordCount: 425 };

describe('storySchema', () => {
  it('accepts a fully-populated valid story', () => {
    expect(() => storySchema.parse(validStory)).not.toThrow();
  });

  it('rejects unknown fields (strict) — notably userId', () => {
    expect(() => storySchema.parse({ ...validStory, userId: 'u1' })).toThrow();
  });

  it('rejects missing required title', () => {
    const { title: _title, ...rest } = validStory;
    expect(() => storySchema.parse(rest)).toThrow();
  });

  it('accepts null for synopsis, genre, worldNotes, targetWords', () => {
    expect(() =>
      storySchema.parse({
        ...validStory,
        synopsis: null,
        genre: null,
        worldNotes: null,
        targetWords: null,
      }),
    ).not.toThrow();
  });

  it('rejects non-ISO datetime in createdAt', () => {
    expect(() => storySchema.parse({ ...validStory, createdAt: 'not a date' })).toThrow();
  });

  it('rejects empty string id', () => {
    expect(() => storySchema.parse({ ...validStory, id: '' })).toThrow();
  });

  it('rejects a non-positive targetWords', () => {
    expect(() => storySchema.parse({ ...validStory, targetWords: 0 })).toThrow();
  });
});

describe('storyListItemSchema', () => {
  it('accepts a valid enriched list item', () => {
    expect(() => storyListItemSchema.parse(validListItem)).not.toThrow();
  });

  it('rejects a row missing the aggregates', () => {
    expect(() => storyListItemSchema.parse(validStory)).toThrow();
  });

  it('still rejects unknown keys (strict preserved through extend)', () => {
    expect(() => storyListItemSchema.parse({ ...validListItem, userId: 'u1' })).toThrow();
  });
});

describe('storyCreateSchema', () => {
  it('accepts minimal input (title only)', () => {
    expect(() => storyCreateSchema.parse({ title: 'Untitled' })).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => storyCreateSchema.parse({ title: '' })).toThrow();
  });

  it('rejects a title over STORY_TITLE_MAX', () => {
    expect(() => storyCreateSchema.parse({ title: 'x'.repeat(STORY_TITLE_MAX + 1) })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => storyCreateSchema.parse({ title: 'X', author: 'me' })).toThrow();
  });

  it('accepts all fields', () => {
    expect(() =>
      storyCreateSchema.parse({
        title: 'X',
        synopsis: 'a tale',
        genre: 'epic',
        worldNotes: 'notes',
        targetWords: 1000,
      }),
    ).not.toThrow();
  });
});

describe('storyUpdateSchema', () => {
  it('accepts empty input (all fields optional)', () => {
    expect(() => storyUpdateSchema.parse({})).not.toThrow();
  });

  it('accepts a single-field subset', () => {
    expect(() => storyUpdateSchema.parse({ genre: null })).not.toThrow();
  });

  it('still rejects unknown fields (strict preserved through partial)', () => {
    expect(() => storyUpdateSchema.parse({ author: 'me' })).toThrow();
  });
});

describe('response wrappers', () => {
  it('storyResponseSchema accepts { story }', () => {
    expect(() => storyResponseSchema.parse({ story: validStory })).not.toThrow();
  });

  it('storyResponseSchema rejects extra top-level fields', () => {
    expect(() => storyResponseSchema.parse({ story: validStory, foo: 1 })).toThrow();
  });

  it('storiesResponseSchema accepts { stories: [listItem] }', () => {
    expect(() => storiesResponseSchema.parse({ stories: [validListItem] })).not.toThrow();
  });

  it('storiesResponseSchema rejects base stories without aggregates', () => {
    expect(() => storiesResponseSchema.parse({ stories: [validStory] })).toThrow();
  });
});

describe('field-length cap constants', () => {
  it('match the legacy inline CreateStoryBody bounds', () => {
    expect(STORY_TITLE_MAX).toBe(500);
    expect(STORY_GENRE_MAX).toBe(200);
    expect(STORY_SYNOPSIS_MAX).toBe(10_000);
    expect(STORY_WORLD_NOTES_MAX).toBe(50_000);
  });
});
```

- [ ] **1d.** Verify: `npm -w story-editor-shared run build && npm -w story-editor-shared test`
  Expected: build succeeds; all `story.schema.test.ts` tests PASS.

- [ ] **1e.** Commit:

```bash
git add shared/src/schemas/story.ts shared/src/index.ts shared/tests/story.schema.test.ts
git commit -m "[d7e] task 1: canonical Story Zod schemas in story-editor-shared

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Delete the dead `/api/stories/:id/progress` endpoint

`/progress` has no consumer (the frontend Sidebar derives progress client-side). Delete the route handler and the two repo methods that exist solely to serve it, plus its test file. Self-contained — all callers are removed together, so the build stays green.

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`
- Modify: `backend/src/repos/story.repo.ts`
- Modify: `backend/src/repos/chapter.repo.ts`
- Delete: `backend/tests/routes/story-progress.test.ts`

- [ ] **2a.** In `backend/src/routes/stories.routes.ts`, delete the entire `GET /:id/progress` block — the leading comment (`// GET /api/stories/:id/progress — aggregate for the sidebar progress footer.` …) through the closing `});` of `router.get('/:id/progress', ownStory, …)`. Leave `const ownStory = …` and all other handlers intact. The `createChapterRepo` import stays (the `GET /` list handler still uses `aggregateForStories`).

- [ ] **2b.** In `backend/src/repos/story.repo.ts`, delete the `findTargetWords` function (the `// Plaintext scalar lookup used by the progress endpoint.` comment through its closing `}`) and remove `findTargetWords` from the returned object:

```ts
  return { create, findById, findManyForUser, update, remove };
```

- [ ] **2c.** In `backend/src/repos/chapter.repo.ts`, delete the `listWordCountsForStory` function and remove `listWordCountsForStory` from the returned object. Leave `aggregateForStories` and every other method untouched.

- [ ] **2d.** Delete the test file: `git rm backend/tests/routes/story-progress.test.ts`

- [ ] **2e.** Verify:

```bash
npm -w story-editor-backend run typecheck
npm -w story-editor-backend test -- tests/repos/story tests/repos/chapter
grep -rn ":id/progress\|findTargetWords\|listWordCountsForStory" backend/src backend/tests
```

Expected: typecheck clean; repo tests PASS; the `grep` prints nothing (exit 1).

- [ ] **2f.** Commit:

```bash
git add backend/src/routes/stories.routes.ts backend/src/repos/story.repo.ts backend/src/repos/chapter.repo.ts backend/tests/routes/story-progress.test.ts
git commit -m "[d7e] task 2: delete dead /api/stories/:id/progress endpoint

No consumer — the Sidebar progress footer derives wordCount/percent
client-side. Removes the route handler, story.repo.findTargetWords,
chapter.repo.listWordCountsForStory, and the route test. Closes
story-editor-9qg.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — `story.repo.ts` onto shared types + `RepoStory`

Replace the hand-rolled repo interfaces with the inferred shared types, add the `RepoStory` repo-shape type, and type the `projectDecrypted` calls. Also fix the one Story-type import in `stories.routes.ts` so the build stays green (the route file is otherwise migrated in Task 5).

**Files:**
- Modify: `backend/src/repos/story.repo.ts`
- Modify: `backend/src/routes/stories.routes.ts` (one import line only)

- [ ] **3a.** In `backend/src/repos/story.repo.ts`, update the imports — add:

```ts
import type { Story, StoryCreateInput, StoryUpdateInput } from 'story-editor-shared';
import { STORY_ENCRYPTED_FIELD_KEYS } from 'story-editor-shared';
```

- [ ] **3b.** Delete the two hand-rolled interfaces (`export interface StoryCreateInput { … }` and `export interface StoryUpdateInput { … }`) — they are now imported from shared.

- [ ] **3c.** Replace the local `ENCRYPTED_FIELDS` declaration:

```ts
// Keep the local ENCRYPTED_FIELDS name as the repo-local invariant (same as
// character.repo.ts) — sourced from the shared tuple.
const ENCRYPTED_FIELDS = STORY_ENCRYPTED_FIELD_KEYS;
```

- [ ] **3d.** Add the `RepoStory` type below the imports (mirrors `RepoCharacter` / `RepoMessage`):

```ts
// Repo-layer shape: narrative fields are plaintext strings (decrypted by the
// repo), timestamps are Date objects (Prisma's raw output). Distinct from the
// wire `Story` type (story-editor-shared), which has ISO string timestamps.
// serialize.ts converts between the two at the handler boundary.
export type RepoStory = Omit<Story, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **3e.** Add the `<RepoStory>` generic to all four `projectDecrypted(...)` calls (in `create`, `findById`, `findManyForUser`, `update`). Each currently reads `projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS)` — change to `projectDecrypted<RepoStory>(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS)`. (In `findManyForUser` the call is inside `rows.map((r) => …)` — same change.)

- [ ] **3f.** In `backend/src/routes/stories.routes.ts`, change the repo import line:

```ts
// before
import { createStoryRepo, type StoryUpdateInput } from '../repos/story.repo';
// after
import { createStoryRepo } from '../repos/story.repo';
import type { StoryUpdateInput } from 'story-editor-shared';
```

(The route still uses its inline `CreateStoryBody` / `UpdateStoryBody` schemas — Task 5 replaces those. `StoryUpdateInput` from shared is shape-compatible with the inline `UpdateStoryBody`'s inferred type, so the build compiles.)

- [ ] **3g.** Verify: `npm -w story-editor-backend run typecheck && npm -w story-editor-backend test -- tests/repos/story`
  Expected: typecheck clean; `story.repo.test.ts` PASS. (If `story.repo.test.ts` referenced the deleted interface *names* in a type annotation, update it to the shared imports — fixture values are unaffected.)

- [ ] **3h.** Commit:

```bash
git add backend/src/repos/story.repo.ts backend/src/routes/stories.routes.ts
git commit -m "[d7e] task 3: story.repo onto shared types + RepoStory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `serialize.ts`: add `serializeStory`, rewrite `serializeCharacter` to explicit-pick

**Files:**
- Modify: `backend/src/lib/serialize.ts`
- Modify: `backend/tests/lib/serialize.test.ts`

- [ ] **4a.** In `backend/src/lib/serialize.ts`, update the imports:

```ts
import type { Character, Message, Story } from 'story-editor-shared';
import type { RepoCharacter } from '../repos/character.repo';
import type { RepoMessage } from '../repos/message.repo';
import type { RepoStory } from '../repos/story.repo';
```

- [ ] **4b.** Rewrite `serializeCharacter` from spread to explicit-pick, and update its comment:

```ts
// Explicit pick (not spread): keeps every serialize* helper on one safe
// pattern. RepoCharacter happens to carry no extra runtime columns today, so
// pick and spread produce identical output — but picking hardens the example
// so a future entity author doesn't copy a spread that leaks an extra column.
export function serializeCharacter(row: RepoCharacter): Character {
  return {
    id: row.id,
    storyId: row.storyId,
    name: row.name,
    role: row.role,
    age: row.age,
    appearance: row.appearance,
    personality: row.personality,
    voice: row.voice,
    backstory: row.backstory,
    arc: row.arc,
    relationships: row.relationships,
    orderIndex: row.orderIndex,
    color: row.color,
    initial: row.initial,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **4c.** Add `serializeStory` (place it after `serializeMessage`):

```ts
// Explicit pick (not spread): RepoStory's type omits userId, but the runtime
// row still carries it because projectDecrypted only strips ciphertext-triple
// columns. Spreading into storySchema (strictObject) would throw — same
// situation as serializeMessage / chatId.
export function serializeStory(row: RepoStory): Story {
  return {
    id: row.id,
    title: row.title,
    synopsis: row.synopsis,
    genre: row.genre,
    worldNotes: row.worldNotes,
    targetWords: row.targetWords,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **4d.** In `backend/tests/lib/serialize.test.ts`, update the imports to add `serializeStory`, `storyResponseSchema`, and the `RepoCharacter` / `RepoStory` types:

```ts
import { messagesResponseSchema, storyResponseSchema } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';
import { serializeCharacter, serializeMessage, serializeStory } from '../../src/lib/serialize';
import type { RepoCharacter } from '../../src/repos/character.repo';
import type { RepoMessage } from '../../src/repos/message.repo';
import type { RepoStory } from '../../src/repos/story.repo';
```

- [ ] **4e.** Add a stray-key test inside the existing `describe('serializeCharacter()', …)` block — this locks the explicit-pick rewrite so a future revert to spread fails:

```ts
  it('excludes any stray runtime key from the wire shape (explicit pick)', () => {
    const rowWithExtra = { ...dbRow, leakedColumn: 'should not appear' } as unknown as RepoCharacter;
    const wire = serializeCharacter(rowWithExtra) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('leakedColumn');
  });
```

- [ ] **4f.** Add a new `describe('serializeStory()', …)` block (mirrors `serializeMessage()`):

```ts
describe('serializeStory()', () => {
  // RepoStory's TYPE omits userId, but the runtime row from storyRepo still
  // carries it (projectDecrypted strips only ciphertext triples). serializeStory
  // uses an explicit pick rather than spread specifically to keep userId out of
  // the wire shape — this fixture deliberately includes an extra userId at
  // runtime to lock that invariant.
  const dbRow = {
    id: 'story-1',
    userId: 'user-extra-should-not-leak',
    title: 'The First Draft',
    synopsis: 'A synopsis.',
    genre: 'literary',
    worldNotes: 'World notes.',
    targetWords: 50000,
    createdAt: new Date('2026-05-14T00:00:00.000Z'),
    updatedAt: new Date('2026-05-14T01:00:00.000Z'),
  } as unknown as RepoStory;

  it('ISO-strings Date fields', () => {
    const wire = serializeStory(dbRow);
    expect(wire.createdAt).toBe('2026-05-14T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-14T01:00:00.000Z');
  });

  it('excludes userId from the wire shape', () => {
    const wire = serializeStory(dbRow) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('userId');
  });

  it('produces a value that satisfies storyResponseSchema egress validation', () => {
    expect(() => storyResponseSchema.parse({ story: serializeStory(dbRow) })).not.toThrow();
  });
});
```

- [ ] **4g.** Verify: `npm -w story-editor-backend run typecheck && npm -w story-editor-backend test -- tests/lib/serialize`
  Expected: typecheck clean; all `serialize.test.ts` tests PASS (the three existing `serializeCharacter()` assertions still pass — pick produces identical output for the fixture).

- [ ] **4h.** Commit:

```bash
git add backend/src/lib/serialize.ts backend/tests/lib/serialize.test.ts
git commit -m "[d7e] task 4: add serializeStory, rewrite serializeCharacter to explicit-pick

All three serialize* helpers now use the one safe pick pattern. No
generic helper. Closes story-editor-ehi.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `stories.routes.ts` migration to shared schemas + `respond()`

Delete the inline validators, consume the shared schemas, route every surviving handler through `respond()` + `serializeStory`.

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`
- Modify: `backend/tests/routes/stories.test.ts`
- Modify: `backend/tests/routes/story-detail.test.ts`

- [ ] **5a.** In `backend/src/routes/stories.routes.ts`, replace the imports — drop the inline-schema `z` import if now unused, and add the shared schemas + `respond` + `serializeStory`:

```ts
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type StoryUpdateInput,
  storiesResponseSchema,
  storyCreateSchema,
  storyResponseSchema,
  storyUpdateSchema,
} from 'story-editor-shared';
import { badRequestFromZod } from '../lib/bad-request';
import { respond } from '../lib/respond';
import { serializeStory } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { createChapterRepo } from '../repos/chapter.repo';
import { createStoryRepo } from '../repos/story.repo';
```

(`z` is no longer needed — the inline schemas are deleted in 5b. If any other use of `z` remains, keep the import; there is none in this file after 5b.)

- [ ] **5b.** Delete the inline `CreateStoryBody` and `UpdateStoryBody` `z.object` / `z.strictObject` declarations and their leading comment blocks.

- [ ] **5c.** Rewrite the `GET /` handler body to serialize each row and `respond()`:

```ts
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stories = await createStoryRepo(req).findManyForUser();
      const ids = stories.map((s) => s.id);

      const byStoryId = await createChapterRepo(req).aggregateForStories(ids);

      const enriched = stories.map((s) => {
        const agg = byStoryId.get(s.id);
        return {
          ...serializeStory(s),
          chapterCount: agg?.chapterCount ?? 0,
          totalWordCount: agg?.totalWordCount ?? 0,
        };
      });

      respond(storiesResponseSchema, res, { stories: enriched });
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **5d.** Rewrite the `POST /` handler to use `storyCreateSchema` + `respond()`:

```ts
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = storyCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      const story = await createStoryRepo(req).create({
        title: body.title,
        synopsis: body.synopsis ?? null,
        genre: body.genre ?? null,
        worldNotes: body.worldNotes ?? null,
        targetWords: body.targetWords ?? null,
      });

      respond(storyResponseSchema, res, { story: serializeStory(story) }, 201);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **5e.** Rewrite the `GET /:id` handler to `respond()` + `serializeStory`:

```ts
  router.get('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    try {
      const story = await createStoryRepo(req).findById(id);
      if (!story) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(storyResponseSchema, res, { story: serializeStory(story) });
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **5f.** Rewrite the `PATCH /:id` handler to use `storyUpdateSchema` + `respond()` + `serializeStory`. Keep the explicit `undefined`-vs-`null` forwarding block — the repo distinguishes "leave alone" (`undefined`) from "clear" (`null`):

```ts
  router.patch('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    const parsed = storyUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }

    // Forward only the keys the caller actually supplied so we preserve the
    // `undefined` vs `null` contract that the repo relies on.
    const body = parsed.data;
    const input: StoryUpdateInput = {};
    if (body.title !== undefined) input.title = body.title;
    if (body.synopsis !== undefined) input.synopsis = body.synopsis;
    if (body.genre !== undefined) input.genre = body.genre;
    if (body.worldNotes !== undefined) input.worldNotes = body.worldNotes;
    if (body.targetWords !== undefined) input.targetWords = body.targetWords;

    try {
      const story = await createStoryRepo(req).update(id, input);
      if (!story) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(storyResponseSchema, res, { story: serializeStory(story) });
    } catch (err) {
      next(err);
    }
  });
```

The `DELETE /:id` handler is unchanged (it returns `204` with no body — no `respond()`).

- [ ] **5g.** In `backend/tests/routes/stories.test.ts`, add a `no userId` assertion to the `POST` success test and the `GET /api/stories` list test. In the POST test (after the existing `const story = res.body.story;` field assertions, alongside the ciphertext-suffix loop):

```ts
    expect(story).not.toHaveProperty('userId');
```

In the `GET /api/stories returns only the caller's stories` test, inside the existing `for (const s of res.body.stories) { … }` loop:

```ts
      expect(s).not.toHaveProperty('userId');
```

- [ ] **5h.** In `backend/tests/routes/story-detail.test.ts`, add `expect(story).not.toHaveProperty('userId')` to the `GET /:id` success test (alongside the existing ciphertext-suffix `for` loop), and `expect(patchRes.body.story).not.toHaveProperty('userId')` to the `PATCH /:id updates only the provided fields` test.

- [ ] **5i.** Verify: `npm -w story-editor-backend run typecheck && npm -w story-editor-backend test -- tests/routes/stor tests/security/encryption-leak`
  Expected: typecheck clean; `stories.test.ts`, `story-detail.test.ts`, and `encryption-leak.test.ts` PASS.

- [ ] **5j.** Commit:

```bash
git add backend/src/routes/stories.routes.ts backend/tests/routes/stories.test.ts backend/tests/routes/story-detail.test.ts
git commit -m "[d7e] task 5: stories.routes onto shared schemas + respond() egress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — Frontend: `useStories.ts` + consumers + drift test

Rewrite the hook to consume the shared schemas with runtime validation, update the two real consumer files, and add the schema-drift smoke test.

**Files:**
- Modify: `frontend/src/hooks/useStories.ts`
- Modify: `frontend/src/components/StoryModal.tsx`
- Modify: `frontend/src/components/StoryPicker.stories.tsx`
- Modify: `frontend/tests/components/StoryPicker.test.tsx`

- [ ] **6a.** Replace the contents of `frontend/src/hooks/useStories.ts` — delete the six hand-rolled interfaces (`StoryListItem`, `StoriesResponse`, `StoryResponse`, `Story`, `StoryDetailResponse`, `StoryInput`), import from shared, runtime-validate every response:

```ts
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Story,
  type StoryCreateInput,
  type StoryListItem,
  type StoryUpdateInput,
  storiesResponseSchema,
  storyResponseSchema,
} from 'story-editor-shared';
import { api } from '@/lib/api';

export const storyQueryKey = (id: string): readonly [string, string] => ['story', id] as const;
export const storiesQueryKey = ['stories'] as const;

export function useStoriesQuery(): UseQueryResult<StoryListItem[], Error> {
  return useQuery({
    queryKey: storiesQueryKey,
    queryFn: async (): Promise<StoryListItem[]> => {
      const raw = await api<unknown>('/stories');
      return storiesResponseSchema.parse(raw).stories;
    },
  });
}

export function useStoryQuery(id: string | undefined): UseQueryResult<Story, Error> {
  return useQuery({
    queryKey: storyQueryKey(id ?? ''),
    queryFn: async (): Promise<Story> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(id ?? '')}`);
      return storyResponseSchema.parse(raw).story;
    },
    enabled: Boolean(id),
  });
}

export function useCreateStoryMutation(): UseMutationResult<Story, Error, StoryCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoryCreateInput): Promise<Story> => {
      const raw = await api<unknown>('/stories', { method: 'POST', body: input });
      return storyResponseSchema.parse(raw).story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}

export interface UpdateStoryArgs {
  id: string;
  input: StoryUpdateInput;
}

export function useUpdateStoryMutation(): UseMutationResult<Story, Error, UpdateStoryArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: UpdateStoryArgs): Promise<Story> => {
      const raw = await api<unknown>(`/stories/${id}`, { method: 'PATCH', body: input });
      return storyResponseSchema.parse(raw).story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}
```

Keep any JSDoc comment blocks from the original that still apply (the backend-contract summary); drop comments that described the deleted interfaces.

- [ ] **6b.** In `frontend/src/components/StoryModal.tsx`, update the imports — drop `type StoryInput` from the `@/hooks/useStories` import, and add the shared types + cap constants:

```ts
import {
  STORY_GENRE_MAX,
  STORY_SYNOPSIS_MAX,
  STORY_TITLE_MAX,
  STORY_WORLD_NOTES_MAX,
  type StoryCreateInput,
  type StoryUpdateInput,
} from 'story-editor-shared';
import { useCreateStoryMutation, useUpdateStoryMutation } from '@/hooks/useStories';
```

- [ ] **6c.** In `StoryModal.tsx`, delete the four local constants:

```ts
const TITLE_MAX = 500;
const GENRE_MAX = 200;
const SYNOPSIS_MAX = 10_000;
const WORLD_NOTES_MAX = 50_000;
```

- [ ] **6d.** In `StoryModal.tsx`, update `diffForPatch`'s signature and local — `Partial<StoryInput>` → `StoryUpdateInput` (both the return type and the `const payload` annotation):

```ts
function diffForPatch(
  initial: StoryModalInitial,
  current: { title: string; genre: string; synopsis: string; worldNotes: string },
): StoryUpdateInput {
  const payload: StoryUpdateInput = {};
  // …rest of the body unchanged…
}
```

- [ ] **6e.** In `StoryModal.tsx` `handleSubmit`, change the create-payload annotation `StoryInput` → `StoryCreateInput`:

```ts
        const payload: StoryCreateInput = {
          title: trimmedTitle,
          genre: nullable(genre),
          synopsis: nullable(synopsis),
          worldNotes: nullable(worldNotes),
        };
```

- [ ] **6f.** In `StoryModal.tsx`, replace every reference to the deleted constants with the shared ones: `TITLE_MAX` → `STORY_TITLE_MAX` (the `titleInvalid` check at the `trimmedTitle.length > …` line, and the `maxLength={…}` on the title `Input`), `GENRE_MAX` → `STORY_GENRE_MAX` (genre `Input` `maxLength`), `SYNOPSIS_MAX` → `STORY_SYNOPSIS_MAX` (synopsis `Textarea` `maxLength`), `WORLD_NOTES_MAX` → `STORY_WORLD_NOTES_MAX` (world-notes `Textarea` `maxLength`).

- [ ] **6g.** In `frontend/src/components/StoryPicker.stories.tsx`, change the `StoryListItem` type import to come from shared (the `storiesQueryKey` value import stays on `@/hooks/useStories`):

```ts
import type { StoryListItem } from 'story-editor-shared';
import { storiesQueryKey } from '@/hooks/useStories';
```

- [ ] **6h.** In `frontend/tests/components/StoryPicker.test.tsx`, add a schema-drift smoke test at the end of the `describe('StoryPicker (F30)', …)` block:

```ts
  it('surfaces an error when the /stories response is malformed (schema drift)', async () => {
    // chapterCount as a string violates storyListItemSchema — the hook's
    // storiesResponseSchema.parse() throws a ZodError, so the query lands in
    // its error state and StoryPicker renders the role="alert" branch.
    fetchMock.mockResolvedValue(
      jsonResponse(200, { stories: [makeStory('s1', { chapterCount: 'not-a-number' })] }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('story-picker-row-s1')).toBeNull();
  });
```

- [ ] **6i.** Verify:

```bash
npm -w story-editor-frontend run typecheck
npm -w story-editor-frontend run lint:design
npm -w story-editor-frontend test -- tests/components/Story
```

Expected: typecheck clean; `lint:design` clean; `StoryModal.test.tsx`, `StoryPicker.test.tsx` (including the new drift test), `StoryPickerEmpty.test.tsx` all PASS.

- [ ] **6j.** Commit:

```bash
git add frontend/src/hooks/useStories.ts frontend/src/components/StoryModal.tsx frontend/src/components/StoryPicker.stories.tsx frontend/tests/components/StoryPicker.test.tsx
git commit -m "[d7e] task 6: frontend useStories + consumers onto shared Story schemas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification & close-gate

- [ ] **F1.** Run the full verify line:

```bash
npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/story tests/routes/stor tests/repos/story tests/repos/chapter tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/Story
```

Expected: every step exits 0.

- [ ] **F2.** Confirm the dead-code grep is clean:

```bash
grep -rn ":id/progress\|findTargetWords\|listWordCountsForStory" backend/src backend/tests
```

Expected: prints nothing (exit 1).

- [ ] **F3.** Hand off to `/bd-close-reviewed story-editor-d7e` — runs typecheck on affected workspaces, fans `security-reviewer` (touches `backend/src/repos/`, `backend/src/routes/`) + `repo-boundary-reviewer` (touches `backend/src/repos/**`, narrative routes), and the verify line. Treat `BLOCK` / `FIX_BEFORE_MERGE` as hard gates.

---

## Self-review notes

Checked against the spec:

- **Spec coverage:** shared schemas + index + tests (Task 1) ✓; `/progress` deletion incl. both repo methods + test file (Task 2) ✓; `story.repo.ts` shared types + `RepoStory` + `STORY_ENCRYPTED_FIELD_KEYS` (Task 3) ✓; `serializeStory` + `serializeCharacter` pick-rewrite (Task 4) ✓; `stories.routes.ts` shared schemas + `respond()` on all four surviving handlers (Task 5) ✓; frontend hook + runtime validation + `StoryModal` caps + `StoryPicker.stories` import + drift test (Task 6) ✓; `STORY_*_MAX` single source of truth ✓; "no `StoryPromptInput`" — nothing to do, no task needed ✓; encryption-leak + model tests covered by the verify line ✓.
- **Consumer-list refinement:** the spec listed `EditorPage` / `StoryPicker.tsx` as consumers to repoint; planning confirmed both import only hook *values*, not Story *types*, so they need no edit — recorded under "Untouched" in the File structure section. Likewise `StoryModal.test.tsx` / `StoryPickerEmpty.test.tsx` carry no type/const references. This narrows the spec's consumer claim but satisfies its acceptance criterion (no consumer imports a hand-rolled Story type).
- **Type consistency:** `RepoStory` defined in Task 3, consumed by `serialize.ts` in Task 4 and `serialize.test.ts` in Task 4 — same name throughout. `StoryCreateInput` / `StoryUpdateInput` flow shared → `story.repo.ts` (Task 3) → `stories.routes.ts` (Task 5) → `useStories.ts` / `StoryModal.tsx` (Task 6) consistently. `STORY_*_MAX` defined in Task 1, consumed in Task 6.
- **Green-at-each-step:** Task 2's deletions remove all callers together; Task 3 fixes the lone `stories.routes.ts` Story-type import inline; Tasks 4–6 are additive or self-contained. Each task's verify includes `typecheck`.
- **No placeholders:** every code step shows complete code; test modifications (Tasks 5g/5h) point at specific named tests with the exact assertion to add.
