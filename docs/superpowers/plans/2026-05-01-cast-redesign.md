# Cast Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realign the cast sidebar tab with the chapters pattern shipped in PR #47 — drop the implicit Principal/Supporting split in favor of a single user-ordered list, restore the missing add affordance via a `DRAMATIS PERSONAE +` section header, gate row-level inline-confirm delete on a transient `selectedCharacterId` state, add drag-to-reorder with full keyboard/touch a11y, and persist the order via a new `Character.orderIndex` column.

**Architecture:** Bottom-up — backend schema migration adds `orderIndex` with `@@unique([storyId, orderIndex])` → repo gains `maxOrderIndex`, `reorder` (D16 two-phase swap), transactional `remove` with sequential repack → routes gain `PATCH /reorder` and the POST allocates `maxOrderIndex + 1` (with the same retry loop as chapters) → frontend hook gains `useReorderCharactersMutation` + `computeReorderedCharacters` + `computeCharactersAfterDelete`, and `useDeleteCharacterMutation` is extended with optimistic reassign + rollback + per-character cache eviction → new `useSelectedCharacterStore` Zustand slice → new `CastSectionHeader` component → `CastTab` rewrite (sortable list, conditional `×` on selected card, `<InlineConfirm/>` swap) → CSS extension to cover character rows with the existing chapter-row coarse-pointer rules → `EditorPage` wiring (set/clear selection + `onAdd`) → CastTab storybook refit (7 variants).

**Tech Stack:** Prisma + PostgreSQL (backend), TypeScript strict, React 19, TanStack Query, Zustand, dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`), Vitest + Testing Library, Storybook 10, Biome.

**Spec:** [`docs/superpowers/specs/2026-05-01-cast-redesign-design.md`](../specs/2026-05-01-cast-redesign-design.md).

**Branch:** `feat/cast-ui` (already created and checked out, with the spec committed at `99bccd9`).

**Conventions to follow:**
- TypeScript strict mode; no `any`.
- Backend repo tests hit the real test DB via `import { prisma } from '../setup'` and use `makeUserContext` / `createStoryRepo` / `createCharacterRepo` helpers.
- Frontend tests use Vitest + Testing Library + `userEvent` from `@testing-library/user-event`.
- The `@/` alias resolves to `frontend/src/`.
- Tailwind classes only; tokens via CSS custom properties.
- Commit message format: `[<area>] <terse summary>` — e.g. `[cast-ui] add Character.orderIndex column`.
- Most patterns mirror PR #47 (chapters); reuse rather than re-derive.

---

## Task 1: Add `Character.orderIndex` to Prisma schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260501000000_add_character_order_index/migration.sql`

- [ ] **Step 1: Edit `schema.prisma` — add `orderIndex` and the unique constraint to the `Character` model**

Locate the `model Character {` block (around line 124) and edit two things:

(a) Add `orderIndex Int` after `initial String?` and `color String?` (top of the field list, before the ciphertext fields):

```prisma
model Character {
  id                  String   @id @default(cuid())
  initial             String?
  color               String?
  orderIndex          Int
  // ... existing ciphertext fields ...
}
```

(b) Just before the closing `}`, add `@@unique([storyId, orderIndex])` next to the existing `@@index([storyId])`:

```prisma
  @@index([storyId])
  // [D16] Same race as Chapter — see backend/src/routes/chapters.routes.ts.
  @@unique([storyId, orderIndex])
}
```

- [ ] **Step 2: Generate the migration SQL**

Run: `cd backend && npx prisma migrate dev --name add_character_order_index --create-only`
Expected: a new directory under `backend/prisma/migrations/` with a `migration.sql` file that adds the column and the unique index. Verify the generated SQL — it should resemble:

```sql
-- AlterTable
ALTER TABLE "Character" ADD COLUMN "orderIndex" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Character_storyId_orderIndex_key" ON "Character"("storyId", "orderIndex");
```

If Prisma generated the migration in a directory with a different timestamp than `20260501000000_add_character_order_index`, that's fine — keep whatever timestamp Prisma assigned. The directory name is referenced nowhere except the file itself.

If the generated SQL lacks the unique index (Prisma sometimes emits only the column), append the `CREATE UNIQUE INDEX` line manually.

- [ ] **Step 3: Apply the migration to the dev DB**

Run: `cd backend && npx prisma migrate dev`
Expected: "Already in sync, no schema change or pending migration was found" OR a fast-forward apply that ends with "All migrations have been successfully applied."

- [ ] **Step 4: Verify the test DB picks up the migration**

Run: `cd backend && npm run db:test:reset`
Expected: exits 0; output ends with "Test database ready."

- [ ] **Step 5: Verify Prisma Client regenerated**

Run: `cd backend && npx tsc --noEmit`
Expected: clean (no errors about a missing `orderIndex` field on `CharacterCreateInput`).

This task is expected to break compilation in the next step until Task 2 updates the repo — that's intentional. Do NOT continue past this step until the migration applies cleanly. If the typecheck reveals a downstream break (e.g. `character.repo.create()` is now missing a required field), that's the failure mode Task 2 fixes.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "[cast-ui] add Character.orderIndex column with unique constraint"
```

---

## Task 2: Repo — `create` assigns sequential `orderIndex`, `findManyForStory` orders by `(orderIndex, createdAt)`, add `maxOrderIndex`

**Files:**
- Modify: `backend/src/repos/character.repo.ts`
- Test: `backend/tests/repos/character.repo.reorder.test.ts` (new — populated incrementally; this task adds the first assertions)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/repos/character.repo.reorder.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { makeUserContext, resetAllTables } from './_req';

describe('character.repo — orderIndex', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  describe('create()', () => {
    it('assigns orderIndex starting at 0 for the first character in a story', async () => {
      const ctx = await makeUserContext('co-first');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 0 });
      expect(a.orderIndex).toBe(0);
    });

    it('starts at maxOrderIndex + 1 in stories that already have characters', async () => {
      const ctx = await makeUserContext('co-next');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, name: 'B', orderIndex: 1 });
      const max = await repo.maxOrderIndex(story.id as string);
      expect(max).toBe(1);
    });

    it('maxOrderIndex returns null for an empty story', async () => {
      const ctx = await makeUserContext('co-empty');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      const max = await repo.maxOrderIndex(story.id as string);
      expect(max).toBeNull();
    });
  });

  describe('findManyForStory()', () => {
    it('orders by (orderIndex asc, createdAt asc)', async () => {
      const ctx = await makeUserContext('co-order');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      const a = await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 2 });
      const b = await repo.create({ storyId: story.id as string, name: 'B', orderIndex: 0 });
      const c = await repo.create({ storyId: story.id as string, name: 'C', orderIndex: 1 });
      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.id)).toEqual([b.id, c.id, a.id]);
    });
  });
});
```

The `_req.ts` helper module already exists (used by `chapter.repo.test.ts`); the imports here mirror that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: FAIL — `repo.create` does not accept `orderIndex`, `repo.maxOrderIndex` does not exist, the row insertion fails because `orderIndex` has no DEFAULT in the schema.

- [ ] **Step 3: Update `CharacterCreateInput` to require `orderIndex`**

Edit `backend/src/repos/character.repo.ts` — add `orderIndex` to `CharacterCreateInput`:

```ts
export interface CharacterCreateInput {
  storyId: string;
  name: string;
  orderIndex: number;
  role?: string | null;
  age?: string | null;
  appearance?: string | null;
  voice?: string | null;
  arc?: string | null;
  color?: string | null;
  initial?: string | null;
  physicalDescription?: string | null;
  personality?: string | null;
  backstory?: string | null;
  notes?: string | null;
}
```

- [ ] **Step 4: Pass `orderIndex` through `create()` to the Prisma insert**

In the `create` function body, modify the `data:` object so it includes `orderIndex`:

```ts
  async function create(input: CharacterCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);
    const row = await client.character.create({
      data: {
        storyId: input.storyId,
        orderIndex: input.orderIndex,
        color: input.color ?? null,
        initial: input.initial ?? null,
        ...encryptedDataFrom(req, input),
      },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }
```

- [ ] **Step 5: Update `findManyForStory` ordering**

Replace the `orderBy: { createdAt: 'asc' }` line in `findManyForStory` with:

```ts
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
```

- [ ] **Step 6: Add `maxOrderIndex`**

Inside `createCharacterRepo`, add:

```ts
  async function maxOrderIndex(storyId: string): Promise<number | null> {
    const userId = resolveUserId(req);
    const agg = await client.character.aggregate({
      where: { storyId, story: { userId } },
      _max: { orderIndex: true },
    });
    return agg._max.orderIndex ?? null;
  }
```

And add it to the returned object at the bottom of `createCharacterRepo`:

```ts
  return { create, findById, findManyForStory, update, remove, maxOrderIndex };
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: PASS — all four tests in this task.

- [ ] **Step 8: Verify pre-existing repo tests still pass**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo`
Expected: PASS — including pre-existing tests. Pre-existing tests that called `repo.create({ ... })` without `orderIndex` will fail compilation. If you find any, update the call site to include `orderIndex: 0` (or sequential values for tests that create multiple).

- [ ] **Step 9: Commit**

```bash
git add backend/src/repos/character.repo.ts backend/tests/repos/character.repo.reorder.test.ts
git commit -m "[cast-ui] character.repo: orderIndex on create + maxOrderIndex + ordered list"
```

---

## Task 3: Repo — transactional `remove` with sequential repack

**Files:**
- Modify: `backend/src/repos/character.repo.ts:116-120` (the `remove` function)
- Test: `backend/tests/repos/character.repo.reorder.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/repos/character.repo.reorder.test.ts` (after the existing `describe('findManyForStory()')` block, still inside the top-level `describe('character.repo — orderIndex')`):

```ts
  describe('remove()', () => {
    it('removes the character and reassigns sequential orderIndex 0..N-1 on the remainder', async () => {
      const ctx = await makeUserContext('cd-reseq');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, name: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId: story.id as string, name: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId: story.id as string, name: 'c', orderIndex: 2 });
      const d = await repo.create({ storyId: story.id as string, name: 'd', orderIndex: 3 });

      const ok = await repo.remove(b.id as string);
      expect(ok).toBe(true);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => [ch.id, ch.orderIndex])).toEqual([
        [a.id, 0],
        [c.id, 1],
        [d.id, 2],
      ]);
    });

    it('returns false when the id does not exist and does not mutate other rows', async () => {
      const ctx = await makeUserContext('cd-noop');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      await repo.create({ storyId: story.id as string, name: 'a', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, name: 'b', orderIndex: 1 });

      const ok = await repo.remove('non-existent-id');
      expect(ok).toBe(false);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.orderIndex)).toEqual([0, 1]);
    });

    it('refuses to remove another user\'s character and leaves their list intact', async () => {
      const alice = await makeUserContext('cd-alice');
      const bob = await makeUserContext('cd-bob');
      const story = await createStoryRepo(alice.req).create({ title: 's' });
      const ch = await createCharacterRepo(alice.req).create({
        storyId: story.id as string,
        name: 't',
        orderIndex: 0,
      });

      const ok = await createCharacterRepo(bob.req).remove(ch.id as string);
      expect(ok).toBe(false);

      const list = await createCharacterRepo(alice.req).findManyForStory(story.id as string);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(ch.id);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: the first new test (`reassigns sequential orderIndex 0..N-1`) FAILS — current `remove()` only deletes, leaving `[a:0, c:2, d:3]`.

- [ ] **Step 3: Replace the `remove()` implementation with a transactional version**

Edit `backend/src/repos/character.repo.ts` — replace the existing `async function remove(id: string)` body (lines ~116-120) with:

```ts
  async function remove(id: string) {
    const userId = resolveUserId(req);
    return client.$transaction(async (tx) => {
      const target = await tx.character.findFirst({
        where: { id, story: { userId } },
        select: { id: true, storyId: true },
      });
      if (!target) return false;

      await tx.character.delete({ where: { id: target.id } });

      // Re-pack remaining characters into sequential orderIndex 0..N-1, ordered
      // by their existing (orderIndex, createdAt) — same key as findManyForStory.
      // Mirrors the [D16] two-phase swap (negative parking values dodge the
      // @@unique([storyId, orderIndex]) constraint mid-transaction).
      const remaining = await tx.character.findMany({
        where: { storyId: target.storyId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.character.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.character.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: i },
        });
      }
      return true;
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: PASS — all three new cases plus the four from Task 2.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/character.repo.ts backend/tests/repos/character.repo.reorder.test.ts
git commit -m "[cast-ui] character.remove() reassigns sequential orderIndex"
```

---

## Task 4: Repo — `reorder()` with two-phase swap

**Files:**
- Modify: `backend/src/repos/character.repo.ts`
- Test: `backend/tests/repos/character.repo.reorder.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/repos/character.repo.reorder.test.ts`:

```ts
  describe('reorder()', () => {
    it('rewrites orderIndex via the [D16] two-phase swap (no P2002 mid-transaction)', async () => {
      const ctx = await makeUserContext('cr-swap');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      const a = await repo.create({ storyId: story.id as string, name: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId: story.id as string, name: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId: story.id as string, name: 'c', orderIndex: 2 });

      await repo.reorder(story.id as string, [
        { id: c.id as string, orderIndex: 0 },
        { id: a.id as string, orderIndex: 1 },
        { id: b.id as string, orderIndex: 2 },
      ]);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.id)).toEqual([c.id, a.id, b.id]);
      expect(list.map((ch) => ch.orderIndex)).toEqual([0, 1, 2]);
    });

    it('throws CharacterNotOwnedError when one of the ids belongs to another user', async () => {
      const alice = await makeUserContext('cr-alice');
      const bob = await makeUserContext('cr-bob');
      const story = await createStoryRepo(alice.req).create({ title: 's' });
      const a = await createCharacterRepo(alice.req).create({
        storyId: story.id as string,
        name: 'a',
        orderIndex: 0,
      });

      await expect(
        createCharacterRepo(bob.req).reorder(story.id as string, [
          { id: a.id as string, orderIndex: 0 },
        ]),
      ).rejects.toBeInstanceOf(CharacterNotOwnedError);
    });
  });
```

Add this import at the top of the test file (alongside the existing `createCharacterRepo`):

```ts
import { CharacterNotOwnedError, createCharacterRepo } from '../../src/repos/character.repo';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: FAIL — `repo.reorder` doesn't exist; `CharacterNotOwnedError` is not exported.

- [ ] **Step 3: Add `CharacterNotOwnedError` and `reorder()` to the repo**

Edit `backend/src/repos/character.repo.ts` — add this near the top of the file (after the imports, before `ENCRYPTED_FIELDS`):

```ts
export class CharacterNotOwnedError extends Error {
  constructor() {
    super('character.repo: one or more characters not owned by caller');
    this.name = 'CharacterNotOwnedError';
  }
}
```

Then inside `createCharacterRepo`, add the `reorder` function (after `remove`):

```ts
  async function reorder(
    storyId: string,
    items: Array<{ id: string; orderIndex: number }>,
  ): Promise<void> {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);

    const ids = items.map((i) => i.id);
    const found = await client.character.findMany({
      where: { id: { in: ids }, storyId, story: { userId } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new CharacterNotOwnedError();
    }

    // [D16] Two-phase swap. Phase 1 parks every targeted row at a NEGATIVE
    // temp value (cannot collide with real data; orderIndex >= 0 is enforced
    // at the route layer). Phase 2 writes the final values; the unique
    // constraint sees each target slot vacated. Both phases inside one
    // interactive transaction so the intermediate negative state is never
    // visible to readers.
    await client.$transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        await tx.character.update({
          where: { id: items[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (const item of items) {
        await tx.character.update({
          where: { id: item.id },
          data: { orderIndex: item.orderIndex },
        });
      }
    });
  }
```

Add it to the returned object:

```ts
  return { create, findById, findManyForStory, update, remove, reorder, maxOrderIndex };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`
Expected: PASS — all 9 cases (4 from Task 2, 3 from Task 3, 2 from Task 4).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/character.repo.ts backend/tests/repos/character.repo.reorder.test.ts
git commit -m "[cast-ui] character.repo.reorder() with [D16] two-phase swap"
```

---

## Task 5: Routes — POST allocates `orderIndex`, new `PATCH /reorder`, DELETE returns 204 + reassigned

**Files:**
- Modify: `backend/src/routes/characters.routes.ts`
- Test: `backend/tests/routes/characters.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/routes/characters.test.ts` inside the existing top-level `describe`:

```ts
  describe('POST + DELETE + PATCH /reorder integration', () => {
    it('POST allocates sequential orderIndex starting at 0', async () => {
      const accessToken = await registerAndLogin('cr-post-seq');
      const req = makeFakeReq(accessToken);
      const story = await createStoryRepo(req).create({ title: 's' });
      const storyId = story.id as string;

      for (const name of ['a', 'b', 'c']) {
        const res = await request(app)
          .post(`/api/stories/${storyId}/characters`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name });
        expect(res.status).toBe(201);
      }

      const list = await request(app)
        .get(`/api/stories/${storyId}/characters`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(list.status).toBe(200);
      expect((list.body.characters as Array<{ orderIndex: number }>).map((c) => c.orderIndex))
        .toEqual([0, 1, 2]);
    });

    it('DELETE /:characterId reassigns sequential orderIndex on the remaining list', async () => {
      const accessToken = await registerAndLogin('cr-del-reseq');
      const req = makeFakeReq(accessToken);
      const story = await createStoryRepo(req).create({ title: 's' });
      const storyId = story.id as string;

      const repo = createCharacterRepo(req);
      const a = await repo.create({ storyId, name: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId, name: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId, name: 'c', orderIndex: 2 });
      const d = await repo.create({ storyId, name: 'd', orderIndex: 3 });

      const del = await request(app)
        .delete(`/api/stories/${storyId}/characters/${b.id as string}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(del.status).toBe(204);

      const after = await request(app)
        .get(`/api/stories/${storyId}/characters`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.status).toBe(200);
      const remaining = after.body.characters as Array<{ id: string; orderIndex: number }>;
      expect(remaining.map((ch) => ch.orderIndex)).toEqual([0, 1, 2]);
      expect(remaining.map((ch) => ch.id)).toEqual([a.id, c.id, d.id]);
    });

    it('PATCH /reorder returns 204 and the next GET reflects the new order', async () => {
      const accessToken = await registerAndLogin('cr-reorder');
      const req = makeFakeReq(accessToken);
      const story = await createStoryRepo(req).create({ title: 's' });
      const storyId = story.id as string;

      const repo = createCharacterRepo(req);
      const a = await repo.create({ storyId, name: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId, name: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId, name: 'c', orderIndex: 2 });

      const reorder = await request(app)
        .patch(`/api/stories/${storyId}/characters/reorder`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          characters: [
            { id: c.id, orderIndex: 0 },
            { id: a.id, orderIndex: 1 },
            { id: b.id, orderIndex: 2 },
          ],
        });
      expect(reorder.status).toBe(204);

      const after = await request(app)
        .get(`/api/stories/${storyId}/characters`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect((after.body.characters as Array<{ id: string }>).map((ch) => ch.id))
        .toEqual([c.id, a.id, b.id]);
    });

    it('PATCH /reorder returns 400 on duplicate orderIndex values', async () => {
      const accessToken = await registerAndLogin('cr-dup-ord');
      const req = makeFakeReq(accessToken);
      const story = await createStoryRepo(req).create({ title: 's' });
      const storyId = story.id as string;
      const a = await createCharacterRepo(req).create({ storyId, name: 'a', orderIndex: 0 });
      const b = await createCharacterRepo(req).create({ storyId, name: 'b', orderIndex: 1 });

      const res = await request(app)
        .patch(`/api/stories/${storyId}/characters/reorder`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          characters: [
            { id: a.id, orderIndex: 0 },
            { id: b.id, orderIndex: 0 },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('PATCH /reorder returns 403 when one of the ids belongs to another user', async () => {
      const aliceToken = await registerAndLogin('cr-alice');
      const bobToken = await registerAndLogin('cr-bob');
      const aliceReq = makeFakeReq(aliceToken);
      const bobReq = makeFakeReq(bobToken);
      const aliceStory = await createStoryRepo(aliceReq).create({ title: 's' });
      const bobStory = await createStoryRepo(bobReq).create({ title: 's' });
      const aliceChar = await createCharacterRepo(aliceReq).create({
        storyId: aliceStory.id as string,
        name: 'a',
        orderIndex: 0,
      });

      const res = await request(app)
        .patch(`/api/stories/${bobStory.id as string}/characters/reorder`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ characters: [{ id: aliceChar.id, orderIndex: 0 }] });
      // Ownership middleware on the parent story rejects with 403; either
      // that, or the repo's CharacterNotOwnedError gets mapped to 403.
      expect(res.status).toBe(403);
    });
  });
```

If the test file does not already import `createCharacterRepo` or `request`/`app`, look at the top of the file — the existing tests already have those wired. Add only what's missing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run db:test:reset && npm run test -- routes/characters`
Expected: most new tests FAIL — POST doesn't allocate orderIndex automatically; PATCH /reorder route doesn't exist; DELETE doesn't reassign (the route does but the repo doesn't yet — wait, by Task 3 it does. So DELETE assertion may already pass).

- [ ] **Step 3: Add the POST orderIndex allocation + PATCH /reorder route**

Edit `backend/src/routes/characters.routes.ts`. The structure mirrors `chapters.routes.ts` exactly.

(a) **Add imports / constants** at the top of the file (after the existing imports):

```ts
import { Prisma } from '@prisma/client';
// existing imports unchanged

// [D16] retry budget for the POST orderIndex race — same shape as chapters.
const POST_ORDER_RETRY_ATTEMPTS = 3;

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
```

Update the existing `createCharacterRepo` import to also import `CharacterNotOwnedError`:

```ts
import {
  CharacterNotOwnedError,
  type CharacterUpdateInput,
  createCharacterRepo,
} from '../repos/character.repo';
```

(b) **Add the reorder Zod schema** alongside `CreateCharacterBody` / `UpdateCharacterBody`:

```ts
const ReorderCharactersBody = z
  .object({
    characters: z
      .array(
        z
          .object({
            id: z.string().min(1),
            orderIndex: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
```

(c) **Replace the POST handler** so it allocates `orderIndex` with the same retry pattern as chapters. Find the existing `router.post('/', ownStory, ...)` block and replace its body with:

```ts
  router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = CreateCharacterBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      const characterRepo = createCharacterRepo(req);

      let lastErr: unknown;
      let created: Awaited<ReturnType<ReturnType<typeof createCharacterRepo>['create']>> | null =
        null;
      for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
        const currentMax = await characterRepo.maxOrderIndex(storyId);
        const nextOrderIndex = currentMax === null ? 0 : currentMax + 1;
        try {
          created = await characterRepo.create({
            storyId,
            name: body.name,
            role: body.role,
            age: body.age,
            color: body.color,
            initial: body.initial,
            appearance: body.appearance,
            voice: body.voice,
            arc: body.arc,
            physicalDescription: body.physicalDescription,
            personality: body.personality,
            backstory: body.backstory,
            notes: body.notes,
            orderIndex: nextOrderIndex,
          });
          break;
        } catch (err) {
          if (!isPrismaUniqueViolation(err)) throw err;
          lastErr = err;
        }
      }

      if (created === null) {
        throw lastErr ?? new Error('characters POST: failed to allocate orderIndex');
      }

      res.status(201).json({ character: created });
    } catch (err) {
      next(err);
    }
  });
```

(d) **Add the PATCH /reorder route** — insert it BEFORE the existing `router.get('/:characterId', ...)` block (so Express doesn't match the literal "reorder" path against the `:characterId` param). The placement convention matches `chapters.routes.ts`:

```ts
  // PATCH /reorder — declared BEFORE /:characterId so Express doesn't match
  // the literal "reorder" path segment against the :characterId param.
  router.patch('/reorder', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = ReorderCharactersBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const items = parsed.data.characters;

    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const item of items) {
      if (seenIds.has(item.id)) {
        res.status(400).json({
          error: { message: 'Duplicate character id in payload', code: 'validation_error' },
        });
        return;
      }
      seenIds.add(item.id);
      if (seenOrders.has(item.orderIndex)) {
        res.status(400).json({
          error: { message: 'Duplicate orderIndex in payload', code: 'validation_error' },
        });
        return;
      }
      seenOrders.add(item.orderIndex);
    }

    try {
      await createCharacterRepo(req).reorder(storyId, items);
      res.status(204).send();
    } catch (err) {
      if (err instanceof CharacterNotOwnedError) {
        res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
        return;
      }
      next(err);
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm run db:test:reset && npm run test -- routes/characters`
Expected: PASS — including all five new cases plus pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/characters.routes.ts backend/tests/routes/characters.test.ts
git commit -m "[cast-ui] characters route: POST allocates orderIndex, add PATCH /reorder"
```

---

## Task 6: Update seed + any pre-existing repo callers to pass `orderIndex`

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: any other file that calls `createCharacterRepo(req).create(...)` without `orderIndex` (search to find them)

- [ ] **Step 1: Find all current callers of `character.create` that lack `orderIndex`**

Run: `grep -rnE "createCharacterRepo\(.+\)\.create\(" backend/ --include="*.ts" | head -20`

Inspect each match. Tests written in Tasks 2-5 already pass `orderIndex` explicitly. The remaining call sites likely include `seed.ts` and possibly an integration helper.

- [ ] **Step 2: Update `seed.ts`**

Edit `backend/prisma/seed.ts`. For each character `.create({ ... })` call inside the seed, add `orderIndex: <N>` where N is sequential per story (starting at 0). For example, if a story creates two characters, the first gets `orderIndex: 0` and the second `orderIndex: 1`.

- [ ] **Step 3: Verify typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean. If any caller was missed, the compiler points at it. Add `orderIndex` and re-run.

- [ ] **Step 4: Run the seed end-to-end (dev DB)**

Run: `cd backend && npm run db:test:reset` and then `make seed` from the repo root.
Expected: seed completes successfully; the final summary lists characters with sequential indices implicitly (the seed itself need not log them).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "[cast-ui] seed: pass orderIndex to character creates"
```

---

## Task 7: Frontend — `useSelectedCharacterStore` Zustand slice

**Files:**
- Create: `frontend/src/store/selectedCharacter.ts`
- Test: `frontend/tests/store/selectedCharacter.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create the directory if it doesn't exist (`mkdir -p frontend/tests/store`), then create `frontend/tests/store/selectedCharacter.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

describe('useSelectedCharacterStore', () => {
  beforeEach(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
  });

  it('initial state is null', () => {
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });

  it('setSelectedCharacterId(id) updates the store', () => {
    useSelectedCharacterStore.getState().setSelectedCharacterId('abc');
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBe('abc');
  });

  it('setSelectedCharacterId(null) clears the store', () => {
    useSelectedCharacterStore.setState({ selectedCharacterId: 'abc' });
    useSelectedCharacterStore.getState().setSelectedCharacterId(null);
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });
});
```

If `frontend/tests/store/` does not exist yet, this is the first store test — that's fine; Vitest's glob picks it up anywhere under `frontend/tests/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/store/selectedCharacter`
Expected: FAIL — `@/store/selectedCharacter` not found.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/selectedCharacter.ts`:

```ts
import { create } from 'zustand';

export interface SelectedCharacterState {
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
}

export const useSelectedCharacterStore = create<SelectedCharacterState>((set) => ({
  selectedCharacterId: null,
  setSelectedCharacterId: (selectedCharacterId) => set({ selectedCharacterId }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/store/selectedCharacter`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/selectedCharacter.ts frontend/tests/store/selectedCharacter.test.ts
git commit -m "[cast-ui] add useSelectedCharacterStore Zustand slice"
```

---

## Task 8: Frontend — pure helpers `computeReorderedCharacters` + `computeCharactersAfterDelete`

**Files:**
- Modify: `frontend/src/hooks/useCharacters.ts`
- Test: `frontend/tests/hooks/useCharacters.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/hooks/useCharacters.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import {
  type Character,
  computeCharactersAfterDelete,
  computeReorderedCharacters,
} from '@/hooks/useCharacters';

function meta(id: string, orderIndex: number): Character {
  return {
    id,
    storyId: 's',
    name: id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('computeReorderedCharacters', () => {
  it('returns null when overId is null', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedCharacters(list, 'a', null)).toBeNull();
  });

  it('returns null when active === over', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedCharacters(list, 'a', 'a')).toBeNull();
  });

  it('reorders and reassigns 0..N-1 (move down by 1)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('reorders and reassigns 0..N-1 (move up by 1)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('computeCharactersAfterDelete', () => {
  it('returns null when the id is not present', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeCharactersAfterDelete(list, 'zzz')).toBeNull();
  });

  it('removes the character and reassigns 0..N-1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)];
    const next = computeCharactersAfterDelete(list, 'b');
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useCharacters`
Expected: FAIL — `computeReorderedCharacters` and `computeCharactersAfterDelete` are not exported; `Character` does not have `orderIndex`.

- [ ] **Step 3: Add `orderIndex` to the `Character` interface**

Edit `frontend/src/hooks/useCharacters.ts` — extend the existing `Character` interface (around line 23):

```ts
export interface Character {
  id: string;
  storyId: string;
  name: string;
  role: string | null;
  age: string | null;
  appearance: string | null;
  voice: string | null;
  arc: string | null;
  personality: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Add the pure helpers**

Edit `frontend/src/hooks/useCharacters.ts` — append at the end of the file (after `useDeleteCharacterMutation`):

```ts
/**
 * Pure array-move helper. Returns a new array.
 */
function arrayMove<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list.slice();
  if (fromIndex < 0 || fromIndex >= list.length) return list.slice();
  if (toIndex < 0 || toIndex >= list.length) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}

function withSequentialOrderIndex<T extends { orderIndex: number }>(list: readonly T[]): T[] {
  return list.map((c, idx) => (c.orderIndex === idx ? c : { ...c, orderIndex: idx }));
}

/**
 * Pure handler used by the CastTab's `DndContext.onDragEnd`. Given the cache
 * and a dnd-kit `{active, over}` pair, returns the new list (with sequential
 * orderIndex). Returns null when nothing needs to change.
 */
export function computeReorderedCharacters(
  current: readonly Character[],
  activeId: string,
  overId: string | null,
): Character[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrderIndex(moved);
}

/**
 * Pure helper for the optimistic delete update — removes the character and
 * reassigns sequential orderIndex on the remainder. Returns null when the id
 * isn't present.
 */
export function computeCharactersAfterDelete(
  current: readonly Character[],
  characterId: string,
): Character[] | null {
  const idx = current.findIndex((c) => c.id === characterId);
  if (idx === -1) return null;
  const remaining = current.filter((c) => c.id !== characterId);
  return withSequentialOrderIndex(remaining);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useCharacters`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify pre-existing frontend tests still typecheck (the new `orderIndex` field on Character may require seed-data fixtures elsewhere to add it)**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors point at fixture functions in tests that build `Character` objects without `orderIndex`. For each, add `orderIndex: 0` (or sequential values for tests that build multiple characters). Common offenders: `CastTab.test.tsx`, `CastTab.stories.tsx`, `CharacterPopover.test.tsx`, `CharacterSheet.test.tsx`, the seed fixture in `tests/lib`. Update them all in this commit so the rest of the plan can proceed.

- [ ] **Step 7: Run the full frontend suite to confirm fixtures still pass**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/useCharacters.ts frontend/tests/hooks/useCharacters.test.tsx
# also stage any fixture files updated in Step 6
git add -u
git commit -m "[cast-ui] add Character.orderIndex + computeReorderedCharacters + computeCharactersAfterDelete"
```

---

## Task 9: Frontend — `useReorderCharactersMutation` + extended `useDeleteCharacterMutation`

**Files:**
- Modify: `frontend/src/hooks/useCharacters.ts`
- Test: `frontend/tests/hooks/useCharacters.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/hooks/useCharacters.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  characterQueryKey,
  charactersQueryKey,
  useDeleteCharacterMutation,
  useReorderCharactersMutation,
} from '@/hooks/useCharacters';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('useReorderCharactersMutation', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return Wrapper;
  }

  it('PATCHes /characters/reorder and writes optimistic cache; rolls back on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seed = [meta('a', 0), meta('b', 1)];
    qc.setQueryData(charactersQueryKey('s1'), seed);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useReorderCharactersMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync([
          { ...meta('b', 0) },
          { ...meta('a', 1) },
        ]),
      ).rejects.toBeDefined();
    });

    // Cache rolled back to original.
    expect(qc.getQueryData<typeof seed>(charactersQueryKey('s1'))?.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('useDeleteCharacterMutation — optimistic reassign', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return Wrapper;
  }

  it('removes optimistically with sequential reassign; evicts per-character cache on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(charactersQueryKey('s1'), [meta('a', 0), meta('b', 1), meta('c', 2)]);
    qc.setQueryData(characterQueryKey('s1', 'b'), { ...meta('b', 1) });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteCharacterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'b' });
    });

    expect(qc.getQueryData(characterQueryKey('s1', 'b'))).toBeUndefined();

    await waitFor(() => {
      const list = qc.getQueryData<{ id: string; orderIndex: number }[]>(
        charactersQueryKey('s1'),
      );
      expect(list?.map((c) => [c.id, c.orderIndex])).toEqual([
        ['a', 0],
        ['c', 1],
      ]);
    });
  });

  it('rolls back the cache on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(charactersQueryKey('s1'), [meta('a', 0), meta('b', 1)]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useDeleteCharacterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'b' })).rejects.toBeDefined();
    });

    expect(
      qc.getQueryData<{ id: string }[]>(charactersQueryKey('s1'))?.map((c) => c.id),
    ).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useCharacters`
Expected: FAIL — `useReorderCharactersMutation` not exported; existing `useDeleteCharacterMutation` does not do optimistic reassign + rollback.

- [ ] **Step 3: Add `useReorderCharactersMutation`**

Edit `frontend/src/hooks/useCharacters.ts` — append after the helpers from Task 8:

```ts
export interface ReorderItem {
  id: string;
  orderIndex: number;
}

export interface ReorderCharactersMutationContext {
  previous: Character[] | undefined;
}

export function useReorderCharactersMutation(
  storyId: string,
): UseMutationResult<void, Error, Character[], ReorderCharactersMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, Character[], ReorderCharactersMutationContext>({
    mutationFn: async (nextList: Character[]): Promise<void> => {
      const items: ReorderItem[] = nextList.map((c) => ({ id: c.id, orderIndex: c.orderIndex }));
      await api<void>(`/stories/${encodeURIComponent(storyId)}/characters/reorder`, {
        method: 'PATCH',
        body: { characters: items },
      });
    },
    onMutate: async (nextList: Character[]): Promise<ReorderCharactersMutationContext> => {
      await qc.cancelQueries({ queryKey: charactersQueryKey(storyId) });
      const previous = qc.getQueryData<Character[]>(charactersQueryKey(storyId));
      qc.setQueryData<Character[]>(charactersQueryKey(storyId), nextList);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<Character[]>(charactersQueryKey(storyId), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: charactersQueryKey(storyId) });
    },
  });
}
```

- [ ] **Step 4: Replace `useDeleteCharacterMutation` with the extended version**

Replace the existing `useDeleteCharacterMutation` body:

```ts
export interface DeleteCharacterMutationContext {
  previous: Character[] | undefined;
}

export function useDeleteCharacterMutation(
  storyId: string,
): UseMutationResult<void, Error, DeleteCharacterInput, DeleteCharacterMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteCharacterInput, DeleteCharacterMutationContext>({
    mutationFn: async ({ id }) => {
      await api<void>(
        `/stories/${encodeURIComponent(storyId)}/characters/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    onMutate: async ({ id }): Promise<DeleteCharacterMutationContext> => {
      await qc.cancelQueries({ queryKey: charactersQueryKey(storyId) });
      const previous = qc.getQueryData<Character[]>(charactersQueryKey(storyId));
      if (previous !== undefined) {
        const next = computeCharactersAfterDelete(previous, id);
        if (next !== null) {
          qc.setQueryData<Character[]>(charactersQueryKey(storyId), next);
        }
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<Character[]>(charactersQueryKey(storyId), context.previous);
      }
    },
    onSuccess: (_void, { id }) => {
      qc.removeQueries({ queryKey: characterQueryKey(storyId, id) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: charactersQueryKey(storyId) });
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/hooks/useCharacters`
Expected: PASS — all 9 tests (3 store, 6 helper, 3 reorder/delete).

Wait — the store tests are in `tests/store/`, not `tests/hooks/`. So the count is 6 helper + 3 reorder/delete = 9 in the hooks file. The exact tally doesn't matter as long as all PASS.

- [ ] **Step 6: Run the full frontend suite to confirm no regressions**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useCharacters.ts frontend/tests/hooks/useCharacters.test.tsx
git commit -m "[cast-ui] useReorderCharactersMutation + optimistic delete reassign"
```

---

## Task 10: `CastSectionHeader` component

**Files:**
- Create: `frontend/src/components/CastSectionHeader.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/CastSectionHeader.tsx`:

```tsx
import type { JSX } from 'react';
import { IconButton, Spinner } from '@/design/primitives';

interface PlusIconProps {
  className?: string;
}

function PlusIcon({ className }: PlusIconProps): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export interface CastSectionHeaderProps {
  onAdd: () => void;
  pending?: boolean;
}

/**
 * DRAMATIS PERSONAE + section header for the cast list. Stateless. Mirrors
 * the shape of ChapterListSectionHeader.
 */
export function CastSectionHeader({
  onAdd,
  pending = false,
}: CastSectionHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
      <span
        className="font-mono text-[11px] tracking-[.08em] uppercase text-ink-4"
        data-testid="cast-list-section-label"
      >
        DRAMATIS PERSONAE
      </span>
      <IconButton
        ariaLabel="Add character"
        onClick={onAdd}
        disabled={pending}
        testId="cast-list-add"
      >
        {pending ? <Spinner size={12} /> : <PlusIcon />}
      </IconButton>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CastSectionHeader.tsx
git commit -m "[cast-ui] add CastSectionHeader component"
```

---

## Task 11: `CastTab` rewrite — flat sortable list with selected `×` + InlineConfirm

**Files:**
- Modify: `frontend/src/components/CastTab.tsx`
- Test: `frontend/tests/components/CastTab.test.tsx` (rewrite the v1 tests)

This is the largest task. The component changes its props (gains internal mutations + selection store wiring) and its visual is fully restructured. Read the spec's Section 3 (Visual spec) and the current `CastTab.tsx` end-to-end before starting.

- [ ] **Step 1: Update `CastTab.test.tsx` to match the new contract**

Read `frontend/tests/components/CastTab.test.tsx` to map existing tests onto the new visual:

(a) **Drop** every test that asserts `Principal` / `Supporting` headers — they no longer exist.
(b) **Update** every test that asserts character ordering by createdAt — order is now driven by `orderIndex` (still createdAt-secondary, but the helper-fixture order matters).
(c) **Add** new tests below.

The new test file structure:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import type { Character } from '@/hooks/useCharacters';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function meta(id: string, orderIndex: number, name?: string): Character {
  return {
    id,
    storyId: 's1',
    name: name ?? id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

function renderCast(characters: Character[], opts?: { isLoading?: boolean; isError?: boolean }): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CastTab
        storyId="s1"
        characters={characters}
        onOpenCharacter={vi.fn()}
        isLoading={opts?.isLoading}
        isError={opts?.isError}
      />
    </QueryClientProvider>,
  );
}

describe('CastTab', () => {
  beforeEach(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
  });

  it('renders DRAMATIS PERSONAE header even when empty', () => {
    renderCast([]);
    expect(screen.getByTestId('cast-list-section-label')).toHaveTextContent('DRAMATIS PERSONAE');
    expect(screen.getByText('No characters yet')).toBeInTheDocument();
  });

  it('renders DRAMATIS PERSONAE header when loading', () => {
    renderCast([], { isLoading: true });
    expect(screen.getByTestId('cast-list-section-label')).toBeInTheDocument();
    expect(screen.getByText('Loading cast…')).toBeInTheDocument();
  });

  it('renders DRAMATIS PERSONAE header on error', () => {
    renderCast([], { isError: true });
    expect(screen.getByTestId('cast-list-section-label')).toBeInTheDocument();
    expect(screen.getByText('Failed to load characters')).toBeInTheDocument();
  });

  it('renders a flat ordered list — no Principal / Supporting headings', () => {
    renderCast([meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)]);
    expect(screen.queryByText('Principal')).toBeNull();
    expect(screen.queryByText('Supporting')).toBeNull();
    expect(screen.getByTestId('character-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('character-row-d')).toBeInTheDocument();
  });

  it('renders rows in orderIndex order', () => {
    renderCast([meta('a', 1), meta('b', 0), meta('c', 2)]);
    const rows = screen.getAllByTestId(/^character-row-[abc]$/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'character-row-b',
      'character-row-a',
      'character-row-c',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/CastTab.test`
Expected: FAIL — current `CastTab.tsx` does not accept `storyId`, does not render `cast-list-section-label`, still renders `Principal` / `Supporting`.

- [ ] **Step 3: Rewrite `CastTab.tsx`**

Replace `frontend/src/components/CastTab.tsx` with:

```tsx
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import { CastSectionHeader } from '@/components/CastSectionHeader';
import {
  CloseIcon,
  GripIcon,
  IconButton,
  InlineConfirm,
  useInlineConfirm,
} from '@/design/primitives';
import {
  type Character,
  charactersQueryKey,
  computeReorderedCharacters,
  useCreateCharacterMutation,
  useDeleteCharacterMutation,
  useReorderCharactersMutation,
} from '@/hooks/useCharacters';
import { ApiError } from '@/lib/api';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

/**
 * Cast sidebar tab — flat user-ordered list with inline-confirm delete on the
 * selected card and drag-to-reorder. Section header is `DRAMATIS PERSONAE +`.
 */
export interface CastTabProps {
  storyId: string;
  characters: Character[];
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
  isLoading?: boolean;
  isError?: boolean;
}

function avatarInitial(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

function displayName(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return 'Untitled';
  return trimmed;
}

function characterSecondary(c: Character): string {
  const parts: string[] = [];
  const role = c.role?.trim() ?? '';
  const age = c.age?.trim() ?? '';
  if (role.length > 0) parts.push(role);
  if (age.length > 0) parts.push(`Age ${age}`);
  return parts.join(' · ');
}

const AVATAR_PALETTE: readonly string[] = [
  'color-mix(in srgb, var(--ai) 18%, transparent)',
  'color-mix(in srgb, var(--accent-soft) 80%, transparent)',
  'color-mix(in srgb, var(--mark) 35%, transparent)',
  'color-mix(in srgb, var(--danger) 14%, transparent)',
  'color-mix(in srgb, var(--ai-soft) 90%, transparent)',
  'color-mix(in srgb, var(--line-2) 60%, transparent)',
];

function avatarBg(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx] as string;
}

interface CharRowProps {
  character: Character;
  selected: boolean;
  onSelect: (id: string, anchorEl: HTMLElement) => void;
  onRequestDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}

function CharRow({
  character,
  selected,
  onSelect,
  onRequestDelete,
  isDeleting,
}: CharRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: character.id });

  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);

  const setRefs = (node: HTMLLIElement | null): void => {
    liRef.current = node;
    setNodeRef(node);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const onConfirmDelete = async (): Promise<void> => {
    try {
      await onRequestDelete(character.id);
      confirm.dismiss();
    } catch {
      /* aria-live carries the message; keep confirm open for retry. */
    }
  };

  return (
    <li
      ref={setRefs}
      style={style}
      data-active={selected ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`character-row-${character.id}`}
      aria-current={selected ? 'true' : undefined}
      className={[
        'group relative flex items-center gap-2 px-2 py-2.5 mx-1 mb-1',
        'rounded-[var(--radius)] transition-colors w-[calc(100%-8px)]',
        selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
        isOver ? 'ring-1 ring-ink' : '',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        aria-label="Reorder"
        data-testid={`character-row-${character.id}-grip`}
        className={[
          'cursor-grab touch-none text-ink-4 hover:text-ink-2',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'flex-shrink-0',
        ].join(' ')}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <button
        type="button"
        onClick={(e) => {
          onSelect(character.id, e.currentTarget);
        }}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
      >
        <span
          className="grid place-items-center w-7 h-7 rounded-full font-serif italic text-[13px] text-ink border border-[var(--line-2)] flex-shrink-0"
          style={{ background: avatarBg(character.id || character.name) }}
          aria-hidden="true"
        >
          {avatarInitial(character)}
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[13px] font-medium text-ink truncate">
            {displayName(character)}
          </span>
          {characterSecondary(character).length > 0 ? (
            <span className="block text-[11px] text-ink-4 truncate tracking-[.02em]">
              {characterSecondary(character)}
            </span>
          ) : null}
        </span>
      </button>
      {confirm.open ? (
        <InlineConfirm
          {...confirm.props}
          label={`Delete ${displayName(character)}`}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          pending={isDeleting}
          testId={`character-row-${character.id}-confirm`}
        />
      ) : selected ? (
        <IconButton
          ariaLabel={`Delete ${displayName(character)}`}
          onClick={confirm.ask}
          testId={`character-row-${character.id}-delete`}
          className="flex-shrink-0"
        >
          <CloseIcon />
        </IconButton>
      ) : null}
    </li>
  );
}

export function CastTab({
  storyId,
  characters,
  onOpenCharacter,
  isLoading,
  isError,
}: CastTabProps): JSX.Element {
  const queryClient = useQueryClient();
  const createCharacter = useCreateCharacterMutation(storyId);
  const reorderCharacters = useReorderCharactersMutation(storyId);
  const deleteCharacter = useDeleteCharacterMutation(storyId);
  const selectedCharacterId = useSelectedCharacterStore((s) => s.selectedCharacterId);
  const setSelectedCharacterId = useSelectedCharacterStore((s) => s.setSelectedCharacterId);

  const [reorderStatus, setReorderStatus] = useState<string>('');
  const [deleteStatus, setDeleteStatus] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleAdd = useCallback((): void => {
    createCharacter.mutate(
      { name: 'Untitled' },
      {
        onSuccess: (created) => {
          setSelectedCharacterId(created.id);
        },
      },
    );
  }, [createCharacter, setSelectedCharacterId]);

  const handleSelect = useCallback(
    (id: string, anchorEl: HTMLElement): void => {
      setSelectedCharacterId(id);
      onOpenCharacter(id, anchorEl);
    },
    [onOpenCharacter, setSelectedCharacterId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const current = queryClient.getQueryData<Character[]>(charactersQueryKey(storyId));
      if (current === undefined) return;
      const next = computeReorderedCharacters(current, activeId, overId);
      if (next === null) return;
      setReorderStatus('');
      reorderCharacters.mutate(next, {
        onError: () => {
          setReorderStatus('Reorder failed — reverted');
        },
        onSuccess: () => {
          setReorderStatus('');
        },
      });
    },
    [queryClient, reorderCharacters, storyId],
  );

  const handleRequestDelete = useCallback(
    async (id: string): Promise<void> => {
      setDeleteStatus('');
      setPendingDeleteId(id);
      try {
        await deleteCharacter.mutateAsync({ id });
        if (selectedCharacterId === id) setSelectedCharacterId(null);
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Character already removed — refreshed'
            : 'Delete failed — try again';
        setDeleteStatus(message);
        throw err;
      } finally {
        setPendingDeleteId(null);
      }
    },
    [deleteCharacter, selectedCharacterId, setSelectedCharacterId],
  );

  const ids = characters.map((c) => c.id);

  return (
    <div className="flex flex-col" data-testid="cast-list">
      <CastSectionHeader onAdd={handleAdd} pending={createCharacter.isPending} />

      {isError === true ? (
        <p role="alert" className="px-3 py-2 text-[12px] text-danger">
          Failed to load characters
        </p>
      ) : isLoading === true && characters.length === 0 ? (
        <p
          role="status"
          aria-live="polite"
          className="px-3 py-2 text-[12px] text-ink-4"
        >
          Loading cast…
        </p>
      ) : characters.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-ink-4">No characters yet</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col">
              {characters.map((c) => (
                <CharRow
                  key={c.id}
                  character={c}
                  selected={selectedCharacterId === c.id}
                  onSelect={handleSelect}
                  onRequestDelete={handleRequestDelete}
                  isDeleting={pendingDeleteId === c.id}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {reorderStatus}
        {deleteStatus}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/CastTab.test`
Expected: PASS — the new tests from Step 1.

- [ ] **Step 5: Run typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. The new `storyId` prop on `CastTab` will require an EditorPage update — that lands in Task 14. If typecheck fails because `EditorPage.tsx` is now passing too few props, that's expected; defer to Task 14. Run typecheck without EditorPage:

```bash
cd frontend && npx tsc --noEmit | grep -v EditorPage | head
```

If only EditorPage errors remain, proceed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CastTab.tsx frontend/tests/components/CastTab.test.tsx
git commit -m "[cast-ui] CastTab rewrite: flat sortable list with inline-confirm delete"
```

---

## Task 12: Component test — `CastTab` delete flow

**Files:**
- Create: `frontend/tests/components/CastTab.delete.test.tsx`

- [ ] **Step 1: Create the test**

```tsx
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import type { Character } from '@/hooks/useCharacters';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chr(o: { id: string; orderIndex: number; name?: string }): Character {
  return {
    id: o.id,
    storyId: 's1',
    name: o.name ?? o.id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: o.orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

function renderCast(opts: { characters: Character[]; selected?: string | null }): {
  client: QueryClient;
} {
  const qc = createQueryClient();
  if (opts.selected !== undefined) {
    useSelectedCharacterStore.setState({ selectedCharacterId: opts.selected });
  }
  render(
    <QueryClientProvider client={qc}>
      <CastTab storyId="s1" characters={opts.characters} onOpenCharacter={() => {}} />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('CastTab — delete', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
  });

  it('× is only rendered for the selected card', () => {
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 }), chr({ id: 'b', orderIndex: 1 })],
      selected: 'b',
    });
    expect(screen.getByTestId('character-row-b-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('clicking × opens InlineConfirm and removes the × slot', async () => {
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    expect(screen.getByTestId('character-row-a-confirm-delete')).toHaveFocus();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('Escape dismisses the confirm', async () => {
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('character-row-a-confirm-delete')).toBeNull();
    });
  });

  it('clicking Delete fires DELETE, removes the row, and clears the selection', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(200, { characters: [] }));
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.click(screen.getByTestId('character-row-a-confirm-delete'));

    await waitFor(() => {
      expect(screen.queryByTestId('character-row-a')).toBeNull();
    });
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });

  it('on 500 the row is restored and aria-live announces failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.click(screen.getByTestId('character-row-a-confirm-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('character-row-a')).toBeInTheDocument();
    });
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd frontend && npx vitest run tests/components/CastTab.delete`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/components/CastTab.delete.test.tsx
git commit -m "[cast-ui] component test: CastTab delete flow"
```

---

## Task 13: Drag a11y unit test

**Files:**
- Create: `frontend/tests/components/CastTab.dragA11y.test.tsx`

- [ ] **Step 1: Create the test**

```tsx
import { describe, expect, it } from 'vitest';
import { computeReorderedCharacters } from '@/hooks/useCharacters';
import type { Character } from '@/hooks/useCharacters';

function meta(id: string, orderIndex: number): Character {
  return {
    id,
    storyId: 's',
    name: id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('Cast reorder — keyboard-shift index math', () => {
  it('moves a row down by 1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('moves a row up by 1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns null when active === over', () => {
    expect(computeReorderedCharacters([meta('a', 0)], 'a', 'a')).toBeNull();
  });

  it('returns null when overId is null', () => {
    expect(computeReorderedCharacters([meta('a', 0)], 'a', null)).toBeNull();
  });
});

describe('CastTab — KeyboardSensor wiring', () => {
  it('imports KeyboardSensor + sortableKeyboardCoordinates from dnd-kit', async () => {
    const core = await import('@dnd-kit/core');
    const sortable = await import('@dnd-kit/sortable');
    expect(core.KeyboardSensor).toBeDefined();
    expect(core.TouchSensor).toBeDefined();
    expect(sortable.sortableKeyboardCoordinates).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd frontend && npx vitest run tests/components/CastTab.dragA11y`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/components/CastTab.dragA11y.test.tsx
git commit -m "[cast-ui] unit-test cast reorder index math + dnd-kit symbol presence"
```

---

## Task 14: EditorPage wiring — pass `storyId` to CastTab; clear selection on chapter/story switch

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Inspect the existing CastTab render**

Run: `grep -n "<CastTab\|setOpenCharacterId\|charactersQuery" frontend/src/pages/EditorPage.tsx`

Note the current `<CastTab characters={...} onOpenCharacter={...} isLoading={...} isError={...} />` invocation.

- [ ] **Step 2: Add `storyId` to the CastTab render**

Find the JSX `<CastTab … />` and add `storyId={story.id}` (the `story` variable is in scope by the time the Sidebar bodies are constructed; if not, use `storyId={story?.id ?? ''}` consistent with how ChapterList is wired).

- [ ] **Step 3: Add an effect that clears the selection when the active chapter or story changes**

Add the import:

```tsx
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
```

In the `EditorPage` body, just below the existing `useActiveChapterStore` hooks:

```tsx
  const setSelectedCharacterId = useSelectedCharacterStore((s) => s.setSelectedCharacterId);

  // Clear cast selection when the active chapter or story changes — keeps
  // the inline-delete affordance scoped to a single editing context.
  useEffect(() => {
    setSelectedCharacterId(null);
  }, [activeChapterId, story?.id, setSelectedCharacterId]);
```

If `useEffect` is not already imported from `'react'`, add it.

- [ ] **Step 4: Verify typecheck and full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: clean + PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[cast-ui] EditorPage: pass storyId to CastTab + clear selection on chapter/story switch"
```

---

## Task 15: CSS — extend coarse-pointer + active-grip rules to character rows

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Find the existing rules**

Run: `grep -n "chapter-row-" frontend/src/index.css`
Expected: two rules. Both gain `character-row-` selectors.

- [ ] **Step 2: Edit `index.css`**

Replace the existing chapter-row block with:

```css
/* ============================================================================
 * Chapters / Cast — affordance visibility on active or drop-target rows + coarse
 * pointer (touch) hit-target enlargement. Selectors scoped by testId prefix to
 * avoid collisions with unrelated `*-delete` testIds.
 * ========================================================================== */
[data-testid^="chapter-row-"][data-active="true"] [data-testid$="-grip"],
[data-testid^="chapter-row-"][data-over="true"] [data-testid$="-grip"],
[data-testid^="character-row-"][data-active="true"] [data-testid$="-grip"],
[data-testid^="character-row-"][data-over="true"] [data-testid$="-grip"] {
  opacity: 1;
}

@media (pointer: coarse) {
  [data-testid^="chapter-row-"][data-testid$="-grip"],
  [data-testid^="chapter-row-"][data-testid$="-delete"],
  [data-testid^="character-row-"][data-testid$="-grip"],
  [data-testid^="character-row-"][data-testid$="-delete"] {
    opacity: 1;
    min-width: 32px;
    min-height: 32px;
  }
}
```

- [ ] **Step 3: Smoke-build the frontend**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "[cast-ui] CSS: extend coarse-pointer + active-grip rules to character rows"
```

---

## Task 16: Refit `CastTab.stories.tsx`

**Files:**
- Modify: `frontend/src/components/CastTab.stories.tsx`

- [ ] **Step 1: Replace the stories file**

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CastTab } from './CastTab';
import type { Character } from '@/hooks/useCharacters';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

const STORY_ID = 'story-demo';

const sampleCharacters: Character[] = [
  { id: 'c1', storyId: STORY_ID, name: 'Ilonoré Maulster', role: 'protagonist', age: '34', appearance: null, voice: null, arc: null, personality: null, orderIndex: 0, createdAt: '2026-04-01T12:00:00Z', updatedAt: '2026-04-01T12:00:00Z' },
  { id: 'c2', storyId: STORY_ID, name: 'Eliza Halsey', role: 'mentor', age: '62', appearance: null, voice: null, arc: null, personality: null, orderIndex: 1, createdAt: '2026-04-02T12:00:00Z', updatedAt: '2026-04-02T12:00:00Z' },
  { id: 'c3', storyId: STORY_ID, name: 'The Stranger', role: 'antagonist', age: null, appearance: null, voice: null, arc: null, personality: null, orderIndex: 2, createdAt: '2026-04-03T12:00:00Z', updatedAt: '2026-04-03T12:00:00Z' },
  { id: 'c4', storyId: STORY_ID, name: 'Cassidy Wren', role: 'ally', age: '28', appearance: null, voice: null, arc: null, personality: null, orderIndex: 3, createdAt: '2026-04-04T12:00:00Z', updatedAt: '2026-04-04T12:00:00Z' },
  { id: 'c5', storyId: STORY_ID, name: 'Father Obed', role: null, age: null, appearance: null, voice: null, arc: null, personality: null, orderIndex: 4, createdAt: '2026-04-05T12:00:00Z', updatedAt: '2026-04-05T12:00:00Z' },
];

function ResetSelected({ to, children }: { to: string | null; children: React.ReactNode }): React.ReactElement {
  useEffect(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: to });
    return () => {
      useSelectedCharacterStore.setState({ selectedCharacterId: null });
    };
  }, [to]);
  return <>{children}</>;
}

function withClient(selected: string | null) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    return (
      <QueryClientProvider client={client}>
        <ResetSelected to={selected}>
          <div style={{ width: 280, border: '1px solid var(--line)' }}>
            <Story />
          </div>
        </ResetSelected>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/CastTab',
  component: CastTab,
  args: {
    storyId: STORY_ID,
    characters: sampleCharacters,
    onOpenCharacter: () => {},
  },
} satisfies Meta<typeof CastTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withClient(null)],
};

export const WithSelected: Story = {
  decorators: [withClient('c2')],
};

/**
 * Click `×` on the selected card to see the inline Delete/Cancel pair. The
 * mutation will fail (no MSW handler) — the visual swap is what's being
 * eyeballed.
 */
export const DeleteConfirm: Story = {
  decorators: [withClient('c2')],
};

export const Empty: Story = {
  args: { characters: [] },
  decorators: [withClient(null)],
};

export const Loading: Story = {
  args: { characters: [], isLoading: true },
  decorators: [withClient(null)],
};

export const ErrorState: Story = {
  args: { characters: [], isError: true },
  decorators: [withClient(null)],
};
```

(Six explicit variants. The seventh "Dragging" variant from the spec is omitted — Storybook can't simulate dnd-kit's mid-drag state cleanly without a custom decorator harness; the X24 Playwright sweep covers real-DOM drag visuals.)

- [ ] **Step 2: Smoke-build Storybook**

Run: `cd frontend && npm run build-storybook 2>&1 | tail -8`
Expected: build succeeds, output mentions `Components/CastTab`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CastTab.stories.tsx
git commit -m "[cast-ui] storybook: refit CastTab to flat list + selected/confirm states"
```

---

## Task 17: Aggregate verification

This is the final gate before opening the PR.

- [ ] **Step 1: Backend test DB reset + full backend suite**

Run: `cd backend && npm run db:test:reset && npm run test`
Expected: PASS.

- [ ] **Step 2: Backend typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Frontend full suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 4: Frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Biome**

Run from repo root: `npx biome check frontend backend`
Expected: zero warnings, zero errors. If formatting drifts, run `npx biome check --write frontend backend` and commit the result with `[cast-ui] biome format`.

- [ ] **Step 6: Storybook smoke build**

Run: `cd frontend && npm run build-storybook`
Expected: build succeeds.

- [ ] **Step 7: Frontend production build**

Run: `cd frontend && npx vite build`
Expected: build succeeds.

- [ ] **Step 8: Manual sanity check via dev stack**

Run: `make dev`
Open `http://localhost:3000`, log in with the seeded dev user, switch to the Cast tab, and confirm:
- `DRAMATIS PERSONAE +` header is present.
- Clicking `+` adds a new character and selects it (popover opens).
- Clicking a card selects it (soft fill); clicking another card replaces the selection.
- The `×` appears only on the selected card; clicking it opens `Delete | Cancel`; Esc / outside-click dismiss; Delete removes the row optimistically.
- Drag-and-drop reorder works; the order persists on reload.
- Sidebar tab strip's `CAST` count updates as characters are added/removed.

If any of these fail, file a fix task before merging.

- [ ] **Step 9: Push the branch**

```bash
git push -u origin feat/cast-ui
```

(The PR itself is opened by the user via `gh pr create`, not by this plan.)

---

## Self-review notes (written at plan-time)

- All locked decisions in the spec map to tasks: schema (Task 1), repo orderIndex (Task 2), repo remove transactional repack (Task 3), repo reorder (Task 4), routes (Task 5), seed (Task 6), Zustand selection store (Task 7), pure helpers (Task 8), mutations (Task 9), section header (Task 10), CastTab rewrite (Task 11), delete component test (Task 12), drag a11y test (Task 13), EditorPage wiring (Task 14), CSS extension (Task 15), Storybook refit (Task 16), aggregate (Task 17).
- No placeholders. Every code-bearing step shows full code; every test step shows the assertions.
- Type consistency: `Character.orderIndex` added once in Task 8 and used throughout; `CastTabProps.storyId` added once in Task 11 and consumed in Task 14; `useSelectedCharacterStore` API matches all four read sites (CastTab, EditorPage, tests, story decorator).
- Out of scope items from the spec stay out (Outline tab, avatar redesign, numbered cards, exposing orderIndex beyond list ordering).
- Risks called out in the spec are mitigated: KeyboardSensor flakiness handled via Task 13's pure-handler test; selection leak prevented by Task 14's effect; broad CSS suffix selectors scoped to row-prefix prefixes.
