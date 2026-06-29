# Drafts Step 2 — Draft schema + EXPAND migration + minimal draft.repo + E12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Draft` narrative entity and an **expand-only** migration that copies each chapter's body/summary/wordCount into a backfilled draft, adds nullable `Chapter.activeDraftId` + `Chat.draftId`, and drops the dormant `Chapter.status` column — without dropping anything later-step code still reads.

**Architecture:** Per the spec's expand-contract delivery (§5a), this step is the **expand**: `Draft` is created and backfilled (verbatim ciphertext copy, no decryption) while `Chapter.body*/summary*/wordCount` and `Chat.chapterId` stay in place (their readers retire in steps 3–5). A minimal `draft.repo.ts` gives encrypt-on-write/decrypt-on-read symmetry so the E12 leak test can cover `Draft`. The backfill *logic* is proven here by a test that seeds a draftless chapter and runs the same backfill SQL.

**Tech Stack:** TypeScript (strict), Prisma 7 + Postgres 16, Vitest, AES-256-GCM envelope encryption via the per-user DEK. Monorepo workspace: `backend` (+ `backend/prisma`).

## Global Constraints

- TypeScript strict mode — no `any`. (CLAUDE.md)
- bd issue: **story-editor-9wk.2**. Commit format: `[story-editor-9wk.2] <desc>`. (CLAUDE.md Git Rules)
- Work from the **main checkout** `/home/asg/projects/story-editor` on branch `feature/chapter-drafts`. (Not a worktree.)
- Backend vitest requires the docker stack up: run `make dev` (Postgres healthy) **before** any `npm -w story-editor-backend run test`. `backend/vitest.config.ts` globalSetup unconditionally resets the test DB via docker exec, then `prisma migrate deploy`. (bd memory: backend tests need the stack)
- Spec: `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` (§3, §5/§5a, §9, §11 step 2).
- **EXPAND-ONLY.** This step must **not** drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount` (step 5) and must **not** drop `Chat.chapterId` or make `Chat.draftId` non-null (step 3). The **only** column dropped here is the dormant `Chapter.status` (its app readers were removed in step 1).
- **Decrypt-free migration.** The backfill relocates ciphertext **byte-for-byte** (same user, same DEK). No `decryptForRequest`/DEK is available or used at migration time.
- **No down-migration.** Rollback is restore-from-backup (house style). Squash-to-one-migration is **step 9** (`story-editor-9wk.9`), not here — leave the per-step scaffolding migration as-is.
- Narrative-entity boundary applies: every `Draft` read goes through decrypt, every write through encrypt; no `*Ciphertext`/`*Iv`/`*AuthTag` field ever appears in a return shape; `wordCount` is plaintext, supplied by the caller (computed before encryption at the route layer in step 4). `repo-boundary-reviewer` is in-lane at the close gate.
- Postgres 16 provides `gen_random_uuid()` built-in (no extension needed) — used to mint backfilled `Draft` ids in raw SQL.

---

### Task 1: Stop testing the dormant `Chapter.status` in raw-Prisma model tests

Step 1 removed every *app* reader of `Chapter.status` but deliberately left the raw-Prisma model tests asserting on the column "until step 2 drops it." Task 2 drops the column, so these references must go **first** (a standalone, green, pre-drop cleanup — the column still exists here, the tests simply stop asserting on it).

**Files:**
- Modify: `backend/tests/models/chapter.test.ts`
- Modify: `backend/tests/models/chapter-encrypted.test.ts`
- Modify: `backend/tests/models/chapter-body-json.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: raw-Prisma chapter model tests with **no** reference to `status`. Task 2's `DROP COLUMN "status"` then typechecks + runs clean.

- [ ] **Step 1: Remove the `status` assertion in `chapter.test.ts`**

Delete line 32: `expect(chapter.status).toBe('draft');`. Leave the rest of that test (it asserts other plaintext columns) intact.

- [ ] **Step 2: Remove `status` from `chapter-encrypted.test.ts`**

This is the "keeps orderIndex, status, storyId, wordCount plaintext" test (around lines 35–47):
- Retitle line 35 from `'keeps orderIndex, status, storyId, wordCount plaintext — needed for UI/progress'` → `'keeps orderIndex, storyId, wordCount plaintext — needed for UI/progress'`.
- Delete the `status: 'draft',` line (~42) from the `prisma.chapter.create({ data: { … } })` seed.
- Delete the assertion `expect(created.status).toBe('draft');` (~47).
- Leave the `orderIndex` / `storyId` / `wordCount` seed values and assertions intact.

- [ ] **Step 3: Remove the status-specific tests in `chapter-body-json.test.ts`**

- Update the file-header comment (line 7) from `// shape that remains plaintext (status, orderIndex, wordCount).` → `// shape that remains plaintext (orderIndex, wordCount).`
- In the `it('defaults status to "draft" and wordCount to 0', …)` block (~27): rename it to `it('defaults wordCount to 0', …)` and delete the `expect(chapter.status).toBe('draft');` assertion (~32). Keep the `wordCount` default assertion.
- Delete the **entire** `it('accepts the three known status values', …)` block (~39–46) — it exists only to exercise the `status` column via raw `prisma.chapter.create`, which the column drop removes. (The block loops the literal array `['draft', 'revised', 'final']` at line 41 — note it's `'revised'`, not `'revision'`; match on the `it(...)` title + the `prisma.chapter.create({ data: { …, status } })` call, not on `'revision'`.)

- [ ] **Step 4: Run the three model tests (stack must be up)**

Run:
```bash
make dev   # ensure Postgres healthy first
npm -w story-editor-backend run test -- tests/models/chapter.test.ts tests/models/chapter-encrypted.test.ts tests/models/chapter-body-json.test.ts
```
Expected: PASS (the column still exists; the tests just no longer touch it).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/models/chapter.test.ts backend/tests/models/chapter-encrypted.test.ts backend/tests/models/chapter-body-json.test.ts
git commit -m "[story-editor-9wk.2] stop testing dormant Chapter.status in raw-Prisma model tests (pre-drop)"
```

---

### Task 2: `Draft` model + `Chapter.activeDraftId` + `Chat.draftId` schema changes + the EXPAND migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_drafts_expand/migration.sql` (generated by Prisma, then hand-augmented)
- Modify: `backend/tests/repos/_req.ts` (add `Draft` to `resetAllTables`)

**Interfaces:**
- Consumes: nothing.
- Produces: a `Draft` Prisma model + client; `Chapter.activeDraftId String?` (named relation `ActiveDraft`, `onDelete: SetNull`) + `Chapter.drafts Draft[]` (named relation `ChapterDrafts`); `Chat.draftId String?` (scalar column, no FK/index yet — step 3 adds those); `Chapter.status` dropped. Tasks 3–5 build on the `Draft` model + the backfill SQL block.

- [ ] **Step 1: Edit `schema.prisma` — add the `Draft` model**

Add this model (place it after `Chapter`):

```prisma
model Draft {
  id                    String    @id @default(cuid())
  // [9wk.2] body + summary + wordCount relocated off Chapter (expand phase —
  // Chapter still carries its copies until step 5's contract drop). Ciphertext
  // triples are the SOLE source of truth, written by draft.repo via the
  // standard envelope-encryption helpers. `wordCount` is plaintext, derived
  // from the body before encryption at the route layer (step 4).
  bodyCiphertext        String?
  bodyIv                String?
  bodyAuthTag           String?
  summaryJsonCiphertext String?
  summaryJsonIv         String?
  summaryJsonAuthTag    String?
  summaryJsonUpdatedAt  DateTime?
  wordCount             Int       @default(0)
  // Custom draft name ("darker take"). NULL ⇒ frontend renders a positional
  // label. Encrypted because a label can leak plot.
  labelCiphertext       String?
  labelIv               String?
  labelAuthTag          String?
  orderIndex            Int
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  chapterId String
  chapter   Chapter @relation("ChapterDrafts", fields: [chapterId], references: [id], onDelete: Cascade)
  // Back-side of Chapter.activeDraft (the active-pointer relation).
  activeForChapter Chapter? @relation("ActiveDraft")

  @@unique([chapterId, orderIndex])
  @@index([chapterId])
}
```

- [ ] **Step 2: Edit `schema.prisma` — change `Chapter`**

In `model Chapter`:
- **Delete** the line `status String @default("draft")`.
- **Add** the active-draft pointer + the two-way relations. Add these alongside the existing relation block (after `chats Chat[]`):
  ```prisma
  activeDraftId String?
  activeDraft   Draft?  @relation("ActiveDraft", fields: [activeDraftId], references: [id], onDelete: SetNull)
  drafts        Draft[] @relation("ChapterDrafts")
  ```
- Leave `bodyCiphertext/Iv/AuthTag`, `summaryJson*`, `summaryJsonUpdatedAt`, `wordCount`, and all indexes **unchanged** (they are dropped in step 5, not here).

- [ ] **Step 3: Edit `schema.prisma` — change `Chat`**

In `model Chat`, add a single nullable scalar column (no relation, no index this step — step 3 adds the FK + the re-pointed indexes and drops `chapterId`):
```prisma
  draftId   String?
```
Place it next to `chapterId`. Leave `chapterId`, its relation, and all three `@@index([chapterId…])` lines **unchanged**.

- [ ] **Step 4: Generate the migration WITHOUT applying it**

Run:
```bash
cd backend && npx prisma migrate dev --create-only --name drafts_expand && cd ..
```
This writes `backend/prisma/migrations/<timestamp>_drafts_expand/migration.sql` from the schema diff **without applying the new migration**. Caveat: `--create-only` is **not** a pure offline diff — it still needs a reachable, non-drifted dev DB, applies any *already-pending* migrations to it, and spins up a temporary **shadow database**. `make dev` (above) satisfies the connection requirement, and there are no other pending migrations after step 1. **If Prisma prompts to reset the dev database (it detected drift), STOP and report it (NEEDS_CONTEXT) — do not reset the dev DB.** Then open the generated file and **verify it is expand-only**:
- It `CREATE TABLE "Draft"` with all the columns above + `Draft_pkey`.
- It `CREATE INDEX "Draft_chapterId_idx"` and `CREATE UNIQUE INDEX "Draft_chapterId_orderIndex_key"`.
- It `ALTER TABLE "Chapter" ... ADD COLUMN "activeDraftId" TEXT` and `DROP COLUMN "status"`.
- It `ALTER TABLE "Chat" ADD COLUMN "draftId" TEXT`.
- It adds FKs `Draft_chapterId_fkey` (`ON DELETE CASCADE`) and `Chapter_activeDraftId_fkey` (`ON DELETE SET NULL`).
- It does **NOT** drop `Chapter.body*/summaryJson*/wordCount`, does **NOT** drop `Chat.chapterId`, and does **NOT** add a NOT NULL or FK on `Chat.draftId`.

If the generated DDL drops anything beyond `status`, **stop and report it** (NEEDS_CONTEXT) — the schema edits drifted from expand-only.

- [ ] **Step 5: Hand-append the decrypt-free backfill block to the migration**

Append exactly this to the **end** of the generated `migration.sql` (after all `CREATE`/`ALTER`/FK statements, so every table, column, and FK already exists). The statements are **idempotent** (guarded by `NOT EXISTS` / `IS NULL`) so they can be re-run and reused by the Task 4 test:

```sql
-- [9wk.2] EXPAND backfill (decrypt-free): one Draft per existing Chapter,
-- ciphertext copied byte-for-byte (same user, same DEK — no decryption).
-- Idempotent: NOT EXISTS / IS NULL guards make re-runs and test reuse safe.
INSERT INTO "Draft" (
  "id", "chapterId",
  "bodyCiphertext", "bodyIv", "bodyAuthTag",
  "summaryJsonCiphertext", "summaryJsonIv", "summaryJsonAuthTag", "summaryJsonUpdatedAt",
  "wordCount",
  "labelCiphertext", "labelIv", "labelAuthTag",
  "orderIndex", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id",
  c."bodyCiphertext", c."bodyIv", c."bodyAuthTag",
  c."summaryJsonCiphertext", c."summaryJsonIv", c."summaryJsonAuthTag", c."summaryJsonUpdatedAt",
  c."wordCount",
  NULL, NULL, NULL,
  0, c."createdAt", c."updatedAt"
FROM "Chapter" c
WHERE NOT EXISTS (SELECT 1 FROM "Draft" d WHERE d."chapterId" = c."id");

-- Point each chapter at its (single) backfilled draft.
UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL;

-- Re-point each chat at its chapter's backfilled draft (chapterId stays until step 3).
UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = ch."chapterId" AND ch."draftId" IS NULL;
```

- [ ] **Step 6: Regenerate the Prisma client from the schema (no DB mutation)**

Run:
```bash
cd backend && npx prisma generate && cd ..
```
This refreshes the host client so backend code typechecks against the new `Draft` model. (The migration itself is applied to the **test DB** by vitest's globalSetup `migrate deploy` on the next test run, and to the **dev DB** when `make dev`'s entrypoint runs `migrate deploy`. The expand migration is non-destructive except for dropping the dormant `status` column; a `scripts/backup-db.sh` snapshot before the first real `make dev` on a populated dev DB is still prudent.)

- [ ] **Step 7: Add `Draft` to `resetAllTables`**

In `backend/tests/repos/_req.ts`, add a `Draft` delete to `resetAllTables`, between the `chat` and `chapter` deletes (drafts are cascade-deleted by chapter, and `Chapter.activeDraftId` is `SetNull` — deleting drafts first nulls the pointer cleanly):

```ts
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
```

- [ ] **Step 8: Typecheck + confirm the existing suite still green (migration applies to test DB)**

Run:
```bash
make dev
npm --prefix backend run typecheck
npm -w story-editor-backend run test -- tests/repos/chapter.repo.test.ts tests/models/chapter-body-json.test.ts
```
Expected: typecheck PASS; tests PASS. (globalSetup applies `drafts_expand` to the test DB; the existing chapter tests confirm the expand didn't break the chapter path. No test seeds `Draft` yet.)

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/repos/_req.ts
git commit -m "[story-editor-9wk.2] add Draft model + expand migration (backfill, activeDraftId, Chat.draftId); drop Chapter.status"
```

---

### Task 3: Minimal `draft.repo.ts` (encrypt-on-write / decrypt-on-read) + round-trip test

**Files:**
- Create: `backend/src/repos/draft.repo.ts`
- Create: `backend/tests/repos/draft.repo.test.ts`

**Interfaces:**
- Consumes: `Draft` model (Task 2); `writeEncrypted` / `projectDecrypted` from `./_narrative`; `chapterSummarySchema` / `ChapterSummary` from `story-editor-shared`.
- Produces: `createDraftRepo(req, client?)` → `{ create, findById, findManyForChapter }`. `create(input: RepoDraftCreateInput)` / reads return `RepoDraft` (plaintext-only shape). Tasks 4–5 use `create` (+ `findById` in the round-trip test).

- [ ] **Step 1: Write the failing round-trip test**

Create `backend/tests/repos/draft.repo.test.ts`:

```ts
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo } from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { makeUserContext, rawCiphertextMustNotEqual, resetAllTables } from './_req';
import { testDatabaseUrl } from '../setup';

describe('[9wk.2] draft.repo — encrypt on write / decrypt on read', () => {
  beforeEach(async () => {
    await resetAllTables();
  });
  afterEach(async () => {
    await resetAllTables();
  });

  it('round-trips body, summary, and label through the DEK', async () => {
    const ctx = await makeUserContext('draft-repo');
    const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });

    const draftRepo = createDraftRepo(ctx.req);
    const created = await draftRepo.create({
      chapterId: chapter.id,
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello drafts' }] }] },
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
      label: 'darker take',
      wordCount: 2,
      orderIndex: 0,
    });

    // Decrypted shape is correct, and carries no ciphertext columns.
    expect(created.label).toBe('darker take');
    expect(created.wordCount).toBe(2);
    expect(created.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });
    expect(JSON.stringify(created.bodyJson)).toContain('hello drafts');
    expect(Object.keys(created as Record<string, unknown>).some((k) => k.endsWith('Ciphertext'))).toBe(false);

    // Re-read decrypts identically.
    const read = await draftRepo.findById(created.id);
    expect(read?.label).toBe('darker take');
    expect(read?.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });

    // Raw columns are actually ciphertext (not naive base64 of plaintext) and
    // contain no plaintext.
    const pg = new Client({ connectionString: testDatabaseUrl });
    await pg.connect();
    try {
      const { rows } = await pg.query<{
        labelCiphertext: string | null;
        bodyCiphertext: string | null;
      }>(`SELECT "labelCiphertext", "bodyCiphertext" FROM "Draft" WHERE "id" = $1`, [created.id]);
      expect(rows).toHaveLength(1);
      rawCiphertextMustNotEqual(rows[0]!.labelCiphertext as string, 'darker take');
      expect(rows[0]!.bodyCiphertext).not.toContain('hello drafts');
    } finally {
      await pg.end();
    }
  });

  it('stores null triples for an absent body/summary/label', async () => {
    const ctx = await makeUserContext('draft-repo-null');
    const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
    const chapter = await createChapterRepo(ctx.req).create({ storyId: story.id as string, title: 'C', orderIndex: 0 });
    const created = await createDraftRepo(ctx.req).create({ chapterId: chapter.id, orderIndex: 0 });
    expect(created.bodyJson).toBeNull();
    expect(created.summary).toBeNull();
    expect(created.label).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make dev && npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts`
Expected: FAIL — `createDraftRepo` is not defined / `../../src/repos/draft.repo` not found.

- [ ] **Step 3: Implement `backend/src/repos/draft.repo.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { type ChapterSummary, chapterSummarySchema } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

// Draft narrative encrypted fields. Defined locally for the step-2 minimal
// repo; step 4 (full draft routes + shared Draft wire schema) may relocate
// this to the shared package, mirroring CHAPTER_ENCRYPTED_FIELD_KEYS.
const DRAFT_ENCRYPTED_FIELD_KEYS = ['body', 'summaryJson', 'label'] as const;

export interface RepoDraftCreateInput {
  chapterId: string;
  // TipTap JSON tree; serialised + encrypted by the repo.
  bodyJson?: unknown;
  summaryJson?: ChapterSummary | null;
  label?: string | null;
  // Plaintext, derived from bodyJson before encryption at the route layer
  // (step 4). The minimal repo takes it as given — see CLAUDE.md wordCount note.
  wordCount?: number;
  orderIndex: number;
}

/**
 * Fully-decrypted draft shape. `type` (not `interface`) so it satisfies the
 * `Record<string, unknown>` constraint on `projectDecrypted<T>`.
 */
export type RepoDraft = {
  id: string;
  chapterId: string;
  bodyJson: unknown;
  summary: ChapterSummary | null;
  summaryUpdatedAt: Date | null;
  label: string | null;
  wordCount: number;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
};

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('draft.repo: req.user.id is not set');
  return id;
}

async function ensureChapterOwned(
  client: PrismaClient,
  chapterId: string,
  userId: string,
): Promise<void> {
  const ok = await client.chapter.findFirst({ where: { id: chapterId, story: { userId } } });
  if (!ok) throw new Error('draft.repo: chapter not owned by caller');
}

export function createDraftRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: RepoDraftCreateInput) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, input.chapterId, userId);

    const bodyPlaintext =
      input.bodyJson === undefined || input.bodyJson === null ? null : JSON.stringify(input.bodyJson);
    const summaryPlaintext =
      input.summaryJson === undefined || input.summaryJson === null
        ? null
        : JSON.stringify(input.summaryJson);
    const labelPlaintext = input.label === undefined ? null : input.label;

    const data: Record<string, unknown> = {
      chapterId: input.chapterId,
      orderIndex: input.orderIndex,
      wordCount: input.wordCount ?? 0,
      ...writeEncrypted(req, 'body', bodyPlaintext),
      ...writeEncrypted(req, 'summaryJson', summaryPlaintext),
      ...writeEncrypted(req, 'label', labelPlaintext),
    };
    if (summaryPlaintext !== null) data.summaryJsonUpdatedAt = new Date();

    const row = await client.draft.create({ data });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
    if (!row) return null;
    return shape(row, req);
  }

  async function findManyForChapter(chapterId: string): Promise<RepoDraft[]> {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, chapterId, userId);
    const rows = await client.draft.findMany({
      where: { chapterId, chapter: { story: { userId } } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => shape(r, req));
  }

  return { create, findById, findManyForChapter };
}

function shape(row: unknown, req: Request): RepoDraft {
  const projected = projectDecrypted(req, row as Record<string, unknown>, DRAFT_ENCRYPTED_FIELD_KEYS);

  // `body` column holds the serialised TipTap tree; surface it as `bodyJson`.
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

  let summary: ChapterSummary | null = null;
  if (typeof projected.summaryJson === 'string' && projected.summaryJson.length > 0) {
    try {
      summary = chapterSummarySchema.parse(JSON.parse(projected.summaryJson as string));
    } catch {
      // Never log decrypted content — static code + id only.
      console.warn(`[draft.repo] summary_parse_failed draft=${projected.id as string}`);
      summary = null;
    }
  }
  delete projected.summaryJson;
  projected.summary = summary;

  const rawRow = row as { summaryJsonUpdatedAt: Date | null };
  projected.summaryUpdatedAt = rawRow.summaryJsonUpdatedAt;
  // `label` is already a decrypted string|null on `projected` from projectDecrypted.

  return projected as RepoDraft;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts`
Expected: PASS (2 tests), output pristine.

- [ ] **Step 5: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/repos/draft.repo.ts backend/tests/repos/draft.repo.test.ts
git commit -m "[story-editor-9wk.2] add minimal draft.repo (encrypt/decrypt create+read) + round-trip test"
```

---

### Task 4: Backfill-logic test (verbatim ciphertext copy + pointer + chat re-point)

Proves the migration's backfill SQL while the old `Chapter.body*` columns still exist (§5a). Seeds a **draftless** chapter (+ a chat) via the repo layer, runs the **same** three backfill statements, and asserts the relocation is byte-identical and the pointers/chat are set.

**Files:**
- Create: `backend/tests/migrations/drafts-expand-backfill.test.ts`

**Interfaces:**
- Consumes: the backfill SQL from Task 2; repos from earlier tasks; `prisma` + raw `pg` from the test harness.
- Produces: none (final-ish gate for the data-moving SQL).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/migrations/drafts-expand-backfill.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { makeUserContext, resetAllTables } from '../repos/_req';
import { prisma } from '../setup';

// The three idempotent backfill statements from the drafts_expand migration,
// as SEPARATE statements. Prisma's $executeRawUnsafe submits one prepared
// statement per call (a semicolon-joined multi-statement string is rejected),
// so they run individually inside one transaction. The migration FILE keeps
// them as a single multi-statement block — the migration engine runs that
// fine; only this test path needs the split. Keep in sync with the migration.
const BACKFILL_STATEMENTS = [
  `INSERT INTO "Draft" (
  "id", "chapterId",
  "bodyCiphertext", "bodyIv", "bodyAuthTag",
  "summaryJsonCiphertext", "summaryJsonIv", "summaryJsonAuthTag", "summaryJsonUpdatedAt",
  "wordCount",
  "labelCiphertext", "labelIv", "labelAuthTag",
  "orderIndex", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id",
  c."bodyCiphertext", c."bodyIv", c."bodyAuthTag",
  c."summaryJsonCiphertext", c."summaryJsonIv", c."summaryJsonAuthTag", c."summaryJsonUpdatedAt",
  c."wordCount",
  NULL, NULL, NULL,
  0, c."createdAt", c."updatedAt"
FROM "Chapter" c
WHERE NOT EXISTS (SELECT 1 FROM "Draft" d WHERE d."chapterId" = c."id")`,

  `UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL`,

  `UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = ch."chapterId" AND ch."draftId" IS NULL`,
];

// Each element is a single prepared statement; run them in one transaction.
async function runBackfill() {
  await prisma.$transaction(BACKFILL_STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)));
}

describe('[9wk.2] drafts expand backfill — verbatim ciphertext relocation', () => {
  beforeEach(async () => {
    await resetAllTables();
  });
  afterEach(async () => {
    await resetAllTables();
  });

  it('creates one draft per draftless chapter, copies ciphertext byte-for-byte, sets pointers', async () => {
    const ctx = await makeUserContext('backfill');
    const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
    // chapterRepo.create writes an encrypted body but does NOT create a draft —
    // so the chapter is "draftless", exactly the pre-migration shape.
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'backfill me' }] }] },
      wordCount: 2,
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id, title: 'T' });

    // Capture the chapter's raw body ciphertext BEFORE backfill.
    const before = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
      select: { bodyCiphertext: true, bodyIv: true, bodyAuthTag: true, wordCount: true },
    });

    // Run the backfill (the same SQL the migration runs).
    await runBackfill();

    // Exactly one draft for the chapter, ciphertext copied byte-for-byte.
    const drafts = await prisma.draft.findMany({ where: { chapterId: chapter.id } });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.bodyCiphertext).toBe(before.bodyCiphertext);
    expect(draft.bodyIv).toBe(before.bodyIv);
    expect(draft.bodyAuthTag).toBe(before.bodyAuthTag);
    expect(draft.wordCount).toBe(before.wordCount);
    expect(draft.orderIndex).toBe(0);
    expect(draft.labelCiphertext).toBeNull();

    // Pointers set.
    const chapterAfter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(chapterAfter.activeDraftId).toBe(draft.id);
    const chatAfter = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(chatAfter.draftId).toBe(draft.id);

    // Idempotent: a second run is a no-op (still exactly one draft).
    await runBackfill();
    expect(await prisma.draft.count({ where: { chapterId: chapter.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run it**

Run: `make dev && npm -w story-editor-backend run test -- tests/migrations/drafts-expand-backfill.test.ts`
Expected: PASS. (If the `tests/migrations/` directory isn't picked up by vitest, confirm `backend/vitest.config.ts`'s `include` globs `tests/**/*.test.ts`; it does — the E12 test lives under `tests/security/`.)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/migrations/drafts-expand-backfill.test.ts
git commit -m "[story-editor-9wk.2] test the expand backfill: verbatim ciphertext copy + activeDraftId + chat re-point"
```

---

### Task 5: Extend the E12 leak test to `Draft`

**Files:**
- Modify: `backend/tests/security/encryption-leak.test.ts`

**Interfaces:**
- Consumes: `createDraftRepo` (Task 3); the existing E12 harness.
- Produces: E12 coverage over `Draft` (body, summary, label) — the gate per CLAUDE.md testing rules before any `Draft` ciphertext ships.

- [ ] **Step 1: Add `Draft` to `NARRATIVE_TABLES`**

In the `NARRATIVE_TABLES` array, add `'Draft'` (place it after `'Chapter'`):

```ts
const NARRATIVE_TABLES = [
  'Story',
  'Chapter',
  'Draft',
  'Character',
  'OutlineItem',
  'Chat',
  'Message',
] as const;
```

- [ ] **Step 2: Seed a `Draft` with the sentinel in the first leak test**

In the `it('no narrative table row contains the sentinel …')` test, import the repo at the top of the file:
```ts
import { createDraftRepo } from '../../src/repos/draft.repo';
```
Then, after the `chapterRepo.update({ summaryJson: … })` call and before the `characterRepo.create(...)` call, seed a draft burying the sentinel in body, summary, and label:

```ts
    const draftRepo = createDraftRepo(ctx.req);
    await draftRepo.create({
      chapterId: chapter.id as string,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `draft-body ${SENTINEL}` }] }],
      },
      summaryJson: {
        events: `draft-events ${SENTINEL}`,
        stateAtEnd: `draft-state ${SENTINEL}`,
        openThreads: `draft-threads ${SENTINEL}`,
      },
      label: `draft-label ${SENTINEL}`,
      wordCount: 2,
      orderIndex: 0,
    });
```

Add `'Draft'` **only** to the module-level `NARRATIVE_TABLES` array (near line 30) — do **NOT** touch `SEEDED_TABLES` (near line 306, used only by the second/seed-script `it`). The first `it`'s raw scan + its per-table `count > 0` sanity loop then cover `Draft`, and its draft seed (above) guarantees ≥1 `Draft` row. The second (seed-script) `it` stays unchanged: the seed writes no drafts, so its sanity loop intentionally remains `['Story','Chapter','Character']` — adding `'Draft'` to `NARRATIVE_TABLES` only widens its leak *scan* (harmless), it does not require a Draft row there.

- [ ] **Step 3: Run the E12 leak test**

Run: `make dev && npm -w story-editor-backend run test -- tests/security/encryption-leak.test.ts`
Expected: PASS — the sentinel must not appear in any `Draft` column, and the `Draft` row-count sanity check passes.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/security/encryption-leak.test.ts
git commit -m "[story-editor-9wk.2] extend E12 leak test to cover Draft (body, summary, label)"
```

---

### Task 6: Full-suite verification + close gate

**Interfaces:** none — final gate.

- [ ] **Step 1: Confirm no contract drops leaked into the migration**

Run:
```bash
grep -nE "DROP COLUMN" backend/prisma/migrations/*_drafts_expand/migration.sql
```
Expected: the **only** `DROP COLUMN` is `"status"`. If `body*`, `summaryJson*`, `wordCount`, or `chapterId` appear, this step over-reached into a contract phase — stop and fix.

- [ ] **Step 2: Typecheck the backend**

Run: `npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the affected + new backend suites end-to-end (stack up)**

Run:
```bash
make dev
npm -w story-editor-backend run test -- \
  tests/security/encryption-leak.test.ts \
  tests/repos/draft.repo.test.ts \
  tests/migrations/drafts-expand-backfill.test.ts \
  tests/repos/chapter.repo.test.ts \
  tests/models/chapter.test.ts \
  tests/models/chapter-encrypted.test.ts \
  tests/models/chapter-body-json.test.ts
```
Expected: PASS, output pristine.

- [ ] **Step 4: Close through the gate**

Do not `bd close` directly. Run `/bd-close-reviewed story-editor-9wk.2`. (`repo-boundary-reviewer` is in-lane — new narrative repo + narrative columns + migration; `security-reviewer` is **not** triggered this step — the ownership-chain rewrite is step 3.)

---

## Self-Review

- **Spec coverage (§3/§5a/§9/§11 step 2):** `Draft` model + indexes (T2); `Chapter.activeDraftId` nullable + `ActiveDraft`/`ChapterDrafts` named relations (T2); `Chat.draftId` nullable scalar, `chapterId` kept (T2); expand migration with decrypt-free verbatim backfill + idempotent guards (T2); `DROP Chapter.status` only (T2, T6 grep); minimal `draft.repo.ts` encrypt/decrypt symmetry (T3); backfill-logic proof while old columns persist (T4); E12 extended to `Draft` (T5). Contract drops (`Chat.chapterId`, `Chapter.body*`) and squash are explicitly **out of scope** (steps 3/5/9). ✓
- **Placeholder scan:** every step has exact files, exact SQL, exact code, exact commands + expected output. ✓
- **Type consistency:** `RepoDraftCreateInput` / `RepoDraft` / `createDraftRepo` names match across T3 (definition) and T4/T5 (use); `DRAFT_ENCRYPTED_FIELD_KEYS = ['body','summaryJson','label']` matches the `writeEncrypted` field names and the `Draft` ciphertext columns. ✓
- **Expand-only invariant:** no NOT NULL/FK on `Chat.draftId`; no drop of body/summary/wordCount/chapterId; backfill copies ciphertext byte-for-byte with no DEK. Guarded by the T6 `DROP COLUMN` grep. ✓
- **Green-at-each-step:** T1 removes status test refs before the column drop; T2 drops the column + updates `resetAllTables` so the suite stays green; T3–T5 are additive. Each task ends on a passing focused run. ✓
- **Backfill testability:** the backfill SQL is duplicated into the T4 test — as three single statements run in one `$transaction` (Prisma `$executeRawUnsafe` rejects multi-statement strings; the migration file keeps the multi-statement block, run by the migration engine) — so the data-moving logic is proven while `Chapter.body*` still exists, the property §5a relies on. ✓
- **bd verify line:** the issue's current `verify:` points at a wrong path (`tests/encryption-leak.test.ts`) and only runs the leak test. At link time it will be strengthened to: `make dev && npm --prefix backend run typecheck && npm -w story-editor-backend run test -- tests/security/encryption-leak.test.ts tests/repos/draft.repo.test.ts tests/migrations/drafts-expand-backfill.test.ts tests/repos/chapter.repo.test.ts tests/models/chapter.test.ts tests/models/chapter-encrypted.test.ts tests/models/chapter-body-json.test.ts`. ✓
