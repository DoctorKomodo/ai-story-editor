# Drafts Step 3 — Chat/Message Ownership Re-point to Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the "every chapter has exactly one active draft" invariant at chapter-create time, re-point `Chat` from `chapterId` to `draftId` (ownership chains, wire contract, CONTRACT migration dropping `Chat.chapterId`), so chats become draft-scoped children.

**Architecture:** Green-at-each-commit ladder, because `Chat.chapterId` is NOT NULL today and `Chat.draftId` must become NOT NULL at the end: (1) chapter-create mints the initial draft; (2) chat-create **dual-writes** `draftId` alongside `chapterId`; (3) ownership chains flip to `draft.chapter.story.userId` (works pre-contract — every chat row now has `draftId`); (4) the wire contract flips (`chapterId`→`draftId` in responses); (5) one CONTRACT migration re-backfills then tightens (`draftId` NOT NULL + FK + indexes, drop `chapterId`) landing atomically with the `ChatCreateInput` flip and the test-fixture sweep. Chat routes stay **chapter-mounted** (step 4 re-scopes them), resolving `chapterId`→`activeDraftId` server-side.

**Tech Stack:** TypeScript (strict), Prisma 7 + Postgres 16, Vitest, Zod 4 (shared wire schemas), Express 5.

## Global Constraints

- TypeScript strict mode — no `any`. (CLAUDE.md)
- bd issue: **story-editor-9wk.3**. Commit format: `[story-editor-9wk.3] <desc>`. (CLAUDE.md Git Rules)
- Work from `/home/asg/projects/story-editor` on branch `feature/chapter-drafts`.
- Backend vitest requires the docker stack up: `make dev` before any `npm -w story-editor-backend run test`. globalSetup migrates a template DB and clones 4 per-worker DBs. (bd memory)
- Spec: `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` (§3, §5a, §6 "Chapter creation mints the initial draft", §9, §11 step 3).
- **This is an authz change** — the chat/message ownership chains are a security boundary. `security-reviewer` is in-lane at the close gate; do not weaken any `userId` filter while rewriting.
- **Contract scope is chat-only.** Do NOT drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount` (step 5) and do NOT touch the draft routes / body-endpoint moves (step 4).
- **No down-migration.** Rollback is restore-from-backup. The step-2/3 scaffolding migrations are squashed in step 9 — leave the expand migration file untouched.
- Frontend scope is **compile/test fixes only**: `useChat.ts` invalidation keys off `vars` instead of the response's `chapterId`; wire-shaped test fixtures rename `chapterId`→`draftId`. NO re-keying of query keys to draftId (step 6), NO component-prop changes (`ChatSceneTab`/stories keep their `chapterId` prop).
- New route-layer errors use the central `HttpError` idiom (`backend/src/lib/http-errors.ts`) — never hand-rolled `{ error: {…} }` literals. `HttpError.message` must be a static literal.

---

### Task 1: Chapter-create mints the initial draft

Every path that creates a chapter (interactive POST, seed, import) goes through `chapter.repo.create` — wiring the mint there covers all three. The chapter row and its draft are created in **one transaction**, and `activeDraftId` is set before the transaction commits.

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts` (the `create` function + `RepoChapter`/`RepoChapterMeta` types + `findManyForStory` select)
- Test: `backend/tests/repos/chapter.repo.initial-draft.test.ts` (create)

**Interfaces:**
- Consumes: `createDraftRepo(req, client)` from `backend/src/repos/draft.repo.ts` (step 2), `PrismaClient.$transaction`.
- Produces: `chapterRepo.create(...)` now returns a shape that includes `activeDraftId: string` (non-null for freshly created chapters). `RepoChapterMeta` gains `activeDraftId: string | null`. Tasks 2 and 5 rely on `chapter.activeDraftId` being non-null for every repo-created chapter; Task 5's import/export changes consume `activeDraftId` from the repo shapes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/repos/chapter.repo.initial-draft.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeUserContext } from './_req';

describe('[9wk.3] chapter.repo.create mints the initial draft', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await resetDb();
  });

  it('creates exactly one draft, points activeDraftId at it, mirrors body + wordCount', async () => {
    const ctx = await makeUserContext('mint');
    const story = await createStoryRepo(ctx.req).create({ title: 'S' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mint me now' }] }],
      },
      wordCount: 3,
      orderIndex: 0,
    });

    // Repo shape carries the pointer (wire schema unchanged — serialize picks explicitly).
    expect(chapter.activeDraftId).toEqual(expect.any(String));

    const drafts = await prisma.draft.findMany({ where: { chapterId: chapter.id as string } });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.id).toBe(chapter.activeDraftId);
    expect(draft.orderIndex).toBe(0);
    expect(draft.labelCiphertext).toBeNull();
    expect(draft.wordCount).toBe(3);
    // Body is encrypted into the draft too (fresh IV, same plaintext).
    expect(draft.bodyCiphertext).not.toBeNull();

    const chapterRow = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id as string },
    });
    expect(chapterRow.activeDraftId).toBe(draft.id);
  });

  it('bodyless chapter mints a bodyless draft (wordCount 0)', async () => {
    const ctx = await makeUserContext('mint-empty');
    const story = await createStoryRepo(ctx.req).create({ title: 'S' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'Untitled',
      orderIndex: 0,
    });
    const draft = await prisma.draft.findFirstOrThrow({
      where: { chapterId: chapter.id as string },
    });
    expect(chapter.activeDraftId).toBe(draft.id);
    expect(draft.bodyCiphertext).toBeNull();
    expect(draft.wordCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make dev && npm -w story-editor-backend run test -- tests/repos/chapter.repo.initial-draft.test.ts`
Expected: FAIL — `chapter.activeDraftId` is `undefined`/`null` and `drafts` has length 0.

- [ ] **Step 3: Implement the mint in `chapter.repo.ts`**

In `backend/src/repos/chapter.repo.ts`:

3a. Add `activeDraftId` to `RepoChapter` (near the top of the file). `RepoChapterMeta` is a derived `Omit<RepoChapter, …>` alias, so it inherits the field automatically — do NOT edit it:

```ts
  // [9wk.3] Active-draft pointer. Non-null for every repo-created chapter
  // (create mints the initial draft in the same transaction). Nullable in
  // the type because the DB column is nullable (create-time chicken-and-egg).
  // NOT exposed on the wire — serializeChapter/serializeChapterMeta pick
  // explicitly and do not include it (step 4 adds it to the wire contract).
  activeDraftId: string | null;
```

3b. Add the import at the top of the file:

```ts
import { createDraftRepo } from './draft.repo';
```

3c. Replace the body of `create` (currently: ownership check → single `client.chapter.create` → `shape(row, req)`) with a transaction that creates the chapter, mints the draft via `draft.repo` (same plaintext body, fresh encryption), and sets the pointer:

```ts
  async function create(input: RepoChapterCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);

    // `null` and `undefined` both mean "no body": persist all-null body
    // triples rather than encrypting the literal string "null".
    const bodyPlaintext =
      input.bodyJson === undefined || input.bodyJson === null
        ? null
        : JSON.stringify(input.bodyJson);

    // [9wk.3] Chapter + initial draft + active pointer in ONE transaction:
    // the "every chapter has exactly one active draft" invariant (spec §3/§6)
    // must never be observable as violated. The draft re-encrypts the same
    // plaintext under the same DEK (fresh IV — ciphertexts differ; fine).
    const row = await client.$transaction(async (tx) => {
      const chapterRow = await tx.chapter.create({
        data: {
          storyId: input.storyId,
          orderIndex: input.orderIndex,
          wordCount: input.wordCount ?? 0,
          // Post-[E11]: narrative content is ciphertext-only.
          ...writeEncrypted(req, 'title', input.title),
          ...writeEncrypted(req, 'body', bodyPlaintext),
        },
      });
      // Same tx-client cast pattern as import.service.ts. draft.repo owns
      // Draft encryption; its ensureChapterOwned re-check inside the tx is
      // one cheap SELECT against the row created above.
      const draft = await createDraftRepo(req, tx as unknown as PrismaClient).create({
        chapterId: chapterRow.id,
        bodyJson: input.bodyJson,
        wordCount: input.wordCount ?? 0,
        orderIndex: 0,
      });
      return tx.chapter.update({
        where: { id: chapterRow.id },
        data: { activeDraftId: draft.id },
      });
    });
    return shape(row, req);
  }
```

3d. In `findManyForStory`'s `select` block (metadata read), add:

```ts
        activeDraftId: true,
```

(alongside `id: true, storyId: true, orderIndex: true, …` — Task 5's export change reads it from `RepoChapterMeta`.)

- [ ] **Step 4: Run the new test + the existing chapter suites**

Run: `npm -w story-editor-backend run test -- tests/repos/chapter.repo.initial-draft.test.ts tests/repos/chapter.repo.test.ts tests/routes/chapters-body-json.test.ts tests/migrations/drafts-expand-backfill.test.ts`

`drafts-expand-backfill.test.ts` MUST be adapted in this task — its seeded chapter is no longer draftless (the mint), which breaks the "backfill creates the draft" premise, and its chat seed becomes a green-ladder trap in later tasks (Task 2's dual-write would throw on a stripped pointer; Task 3's Cascade FK would delete the chat when the minted draft is stripped). Make BOTH changes now:

1. **Strip the minted draft** right after the `createChapterRepo(ctx.req).create(...)` call, restoring the pre-migration draftless shape:

```ts
    // [9wk.3] chapter.repo.create now mints a draft; this test needs the
    // PRE-migration shape (draftless chapter). Strip the minted draft.
    await prisma.chapter.update({
      where: { id: chapter.id as string },
      data: { activeDraftId: null },
    });
    await prisma.draft.deleteMany({ where: { chapterId: chapter.id as string } });
```

2. **Remove the chat seed + chat assertions entirely** (the `createChatRepo` import, the `const chat = await createChatRepo(...)` line, and the `chatAfter` block). The chat-repoint UPDATE statement keeps executing as an idempotent no-op; its historical correctness stands from step 2's gate, and the step-9 baseline-fixture harness re-proves the full pre-9wk transform end-to-end. (Keeping the seed is not an option: under Task 2's dual-write the chat would bind to the minted draft, and stripping that draft after Task 3's Cascade FK would delete the chat mid-test.)

Then the remaining assertions (verbatim copy, one draft, pointer set, idempotent) hold unchanged through every later task.
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/repos/chapter.repo.ts backend/tests/repos/chapter.repo.initial-draft.test.ts backend/tests/migrations/drafts-expand-backfill.test.ts
git commit -m "[story-editor-9wk.3] chapter.repo.create mints the initial draft + sets activeDraftId (one txn)"
```

---

### Task 2: Chat-create dual-writes `draftId`

Per spec §5a, chat-create must write `draftId` **before** the contract migration tightens it. `ChatCreateInput` keeps `chapterId` for now (the flip is Task 5, atomic with the column drop); the repo resolves the chapter's `activeDraftId` and writes both FKs.

**Files:**
- Modify: `backend/src/repos/chat.repo.ts` (the `create` function only)
- Test: `backend/tests/repos/chat.repo.test.ts` (add one test)

**Interfaces:**
- Consumes: `Chapter.activeDraftId` non-null for repo-created chapters (Task 1).
- Produces: every new `Chat` row has `draftId` set. Task 3's ownership chains and Task 5's NOT NULL depend on this.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/repos/chat.repo.test.ts` (inside the existing top-level describe, using that file's existing setup helpers — mirror how its current tests build a story + chapter):

```ts
  it('[9wk.3] create writes draftId = the chapter&apos;s activeDraftId (dual-write)', async () => {
    const ctx = await makeUserContext('chat-dualwrite');
    const story = await createStoryRepo(ctx.req).create({ title: 'S' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id as string });
    const row = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id as string } });
    expect(row.draftId).toBe(chapter.activeDraftId);
  });
```

(If the file lacks `prisma`/repo imports used above, add them to its import block: `import { prisma } from '../setup';` etc. — match the file's existing style.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w story-editor-backend run test -- tests/repos/chat.repo.test.ts`
Expected: the new test FAILS — `row.draftId` is `null`.

- [ ] **Step 3: Implement the dual-write in `chat.repo.ts` `create`**

Replace the `create` function body:

```ts
  async function create(input: ChatCreateInput) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, input.chapterId, userId);
    // [9wk.3] Dual-write during the chat contract transition: resolve the
    // chapter's active draft and write BOTH FKs. Task 5's contract migration
    // makes draftId NOT NULL and drops chapterId; until then both columns
    // exist. A null activeDraftId is an invariant violation (chapter-create
    // mints the draft since 9wk.3) — fail loudly, never insert a NULL draftId.
    const chapter = await client.chapter.findUniqueOrThrow({
      where: { id: input.chapterId },
      select: { activeDraftId: true },
    });
    if (chapter.activeDraftId === null) {
      throw new Error('chat.repo: chapter has no active draft (invariant violation)');
    }
    const row = await client.chat.create({
      data: {
        chapterId: input.chapterId,
        draftId: chapter.activeDraftId,
        kind: input.kind ?? 'ask',
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }
```

- [ ] **Step 4: Run the chat + message suites**

Run: `npm -w story-editor-backend run test -- tests/repos/chat.repo.test.ts tests/repos/message.repo.test.ts tests/routes/chat-messages-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/chat.repo.ts backend/tests/repos/chat.repo.test.ts
git commit -m "[story-editor-9wk.3] chat.repo.create dual-writes draftId from the chapter's activeDraftId"
```

---

### Task 3: Ownership chains re-point to `draft.chapter.story.userId` (authz)

The security-sensitive rewrite. Every nested ownership `where` on Chat/Message flips from `chapter: { story: { userId } }` to `draft: { chapter: { story: { userId } } }`. Works pre-contract: every chat row in any test/dev world now carries `draftId` (Task 2 dual-write + expand backfill for pre-existing rows).

**Blocker check first:** the flip requires a Prisma **relation** on `Chat.draftId` (today it's a bare scalar — a nested `draft:` where-clause will not compile). Add the relation WITHOUT tightening anything (nullable FK; the NOT NULL + `chapterId` drop stay in Task 5).

**Files:**
- Modify: `backend/prisma/schema.prisma` (`Chat.draft` relation + `Draft.chats` back-relation)
- Create: `backend/prisma/migrations/<timestamp>_chat_draft_fk/migration.sql` (generated — FK only)
- Modify: `backend/src/repos/chat.repo.ts` (`ensureChapterOwned` stays for create; `findById`, `update`, `remove` chains)
- Modify: `backend/src/repos/message.repo.ts` (`ensureChatOwned` + `update`, `findById`, `findManyForChat`, `countForChat`, `deleteAllAfter` chains)
- Modify: `backend/src/middleware/ownership.middleware.ts` (`chat` + `message` cases)
- Test: `backend/tests/middleware/ownership.middleware.test.ts` (add cross-user regression through the draft chain)

**Interfaces:**
- Consumes: `Chat.draftId` populated on every row (Task 2).
- Produces: all Chat/Message authz resolves through `draft.chapter.story.userId`. Task 5 drops the old `chapter` relation with zero remaining consumers.

- [ ] **Step 1: Schema — add the relation (nullable, no other change)**

In `backend/prisma/schema.prisma` `model Chat`, replace the bare `draftId   String?` line with:

```prisma
  draftId   String?
  draft     Draft?  @relation("DraftChats", fields: [draftId], references: [id], onDelete: Cascade)
```

In `model Draft`, add alongside the existing relations:

```prisma
  chats Chat[] @relation("DraftChats")
```

- [ ] **Step 2: Generate the FK migration + regenerate the client**

```bash
cd backend && npx prisma migrate dev --create-only --name chat_draft_fk && npx prisma generate && cd ..
```

Open the generated `migration.sql` and verify it contains ONLY:
- `ALTER TABLE "Chat" ADD CONSTRAINT "Chat_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;`

(No NOT NULL, no index changes, no column drops.) If Prisma prompts to reset the dev DB (drift), STOP and report NEEDS_CONTEXT.

- [ ] **Step 3: Fix the middleware test's raw seeds (they are draftless — the flipped chain would 403 the OWNER)**

`backend/tests/middleware/ownership.middleware.test.ts` seeds with **raw Prisma**: the chapter is created draftless and the chat as `prisma.chat.create({ data: { chapterId: chapter.id } })` with no `draftId`. After Step 5 flips the middleware chains, those rows resolve nothing — the existing "traverses Chat →" / "traverses Message →" owner-gets-200 tests would fail. Extend the file's seed helper (`seedTwoUsersAndAStory` or equivalent) to create a real `Draft` row and point both FKs at it (a bare scalar `draftId: 'x'` is NOT enough once Step 2's FK exists):

```ts
    const draft = await prisma.draft.create({
      data: { chapterId: chapter.id, orderIndex: 0 },
    });
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { activeDraftId: draft.id },
    });
    const chat = await prisma.chat.create({
      data: { chapterId: chapter.id, draftId: draft.id },
    });
```

(Adapt names to the helper's actual variables; the point is: Draft row exists, `chapter.activeDraftId` and `chat.draftId` reference it.)

- [ ] **Step 4: Write the authz regression test through the new chain**

Add to the same file. NOTE: this file currently uses `makeUser` + raw Prisma, NOT the repo-context helpers — the test below needs **new imports** (`makeUserContext` from `../repos/_req`, `createStoryRepo`/`createChapterRepo`/`createChatRepo`/`createMessageRepo` from `../../src/repos/…`). The middleware harness is the file's existing `mountProtected(resource, idParam, userId)`-style helper — pass the attacker's/owner's `ctx.user.id`:

```ts
  it('[9wk.3] chat/message ownership resolves through draft.chapter.story — cross-user denied', async () => {
    const owner = await makeUserContext('own-draftchain');
    const attacker = await makeUserContext('atk-draftchain');
    const story = await createStoryRepo(owner.req).create({ title: 'S' });
    const chapter = await createChapterRepo(owner.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const chat = await createChatRepo(owner.req).create({ chapterId: chapter.id as string });
    const message = await createMessageRepo(owner.req).create({
      chatId: chat.id as string,
      role: 'user',
      content: 'mine',
    });

    // Repo layer: attacker resolves nothing through the new chain.
    expect(await createChatRepo(attacker.req).findById(chat.id as string)).toBeNull();
    expect(await createMessageRepo(attacker.req).findById(message.id as string)).toBeNull();

    // Middleware layer: 403 for both resource types.
    // (Use this file's existing requireOwnership harness — runMiddleware(type, id, userId)
    // or equivalent; assert the attacker gets forbidden and the owner passes.)
  });
```

Fill the middleware-layer assertions using the file's existing harness (it already tests `chat` and `message` cases — copy the adjacent invocation style verbatim).

- [ ] **Step 5: Run the file — expect PASS, not fail-first**

Run: `npm -w story-editor-backend run test -- tests/middleware/ownership.middleware.test.ts`
Expected: PASS (the old `chapter.story` chain also denies cross-user access — the new test guards the REWRITE, it does not fail first). This is the one place TDD's fail-first is impossible: both chains deny attackers. Its value is catching a botched rewrite (e.g. a dropped `userId` filter) in the next step.

- [ ] **Step 6: Flip every chain**

Exact replacements (mechanical, but check each by eye — this is the authz surface):

`backend/src/repos/chat.repo.ts` — in `findById`, `update` (both the `updateMany` where and the re-read `findFirst`), `remove`:
- `where: { id, chapter: { story: { userId } } }` → `where: { id, draft: { chapter: { story: { userId } } } }`
- `findManyForChapter` keeps its `chapterId, chapter: { story: { userId } }` filter for now (it dies in Task 5).
- `ensureChapterOwned` stays (create still takes chapterId until Task 5).

`backend/src/repos/message.repo.ts` — in `ensureChatOwned`, `update` (the `findFirst` target check), `findById`, `findManyForChat`, `countForChat`, `deleteAllAfter` (both the ref lookup and the deleteMany):
- `chat: { chapter: { story: { userId } } }` → `chat: { draft: { chapter: { story: { userId } } } }`
- `where: { id: chatId, chapter: { story: { userId } } }` (ensureChatOwned) → `where: { id: chatId, draft: { chapter: { story: { userId } } } }`

`backend/src/middleware/ownership.middleware.ts` — `chat` case:
```ts
    case 'chat': {
      const row = await client.chat.findFirst({
        where: { id, draft: { chapter: { story: { userId } } } },
        select,
      });
      return row !== null;
    }
```
`message` case:
```ts
    case 'message': {
      const row = await client.message.findFirst({
        where: { id, chat: { draft: { chapter: { story: { userId } } } } },
        select,
      });
      return row !== null;
    }
```

- [ ] **Step 7: Run the authz + chat/message suites**

Run: `npm -w story-editor-backend run test -- tests/middleware/ownership.middleware.test.ts tests/repos/chat.repo.test.ts tests/repos/message.repo.test.ts tests/routes/chat-messages-list.test.ts tests/ai/chat-persistence.test.ts`
Expected: PASS. If a chat/message test fails with "not owned", the failing row was created by RAW Prisma without `draftId` — fix the TEST fixture to create its chat through `chatRepo.create` (repo-layer rule) or set `draftId` explicitly; do NOT weaken the chain.

- [ ] **Step 8: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/repos/chat.repo.ts backend/src/repos/message.repo.ts backend/src/middleware/ownership.middleware.ts backend/tests/middleware/ownership.middleware.test.ts
git commit -m "[story-editor-9wk.3] re-point chat/message ownership chains to draft.chapter.story (authz)"
```

---

### Task 4: Wire contract flip — `chatSchema.chapterId` → `draftId`

Response shape changes; create input does NOT (body never carried `chapterId` — it comes from the URL). Frontend gets mechanical fixes: `useChat.ts` keys invalidation off `vars`/args instead of the response, and wire-shaped fixtures rename the field.

**Files:**
- Modify: `shared/src/schemas/chat.ts` (`chatSchema.chapterId` → `draftId`)
- Modify: `backend/src/repos/chat.repo.ts` (`RepoChat` type: `chapterId` → `draftId`)
- Modify: `backend/src/lib/serialize.ts` (`serializeChat`)
- Modify: `backend/src/routes/chat.routes.ts` (`createChatMessagesRouter` reads `chat.chapterId` — re-resolve via the draft)
- Modify: `frontend/src/hooks/useChat.ts` (two invalidation sites)
- Modify: wire-shaped chat fixtures in `frontend/tests/hooks/useChat.test.tsx`, `frontend/tests/hooks/useScenes.test.tsx`, `frontend/tests/components/ChatTab.test.tsx`, `frontend/tests/components/SceneTab.test.tsx`, `frontend/tests/components/ChatSceneTab.test.tsx`
- Modify: `shared/tests/chat.schema.test.ts` (or wherever `chatSchema` fixtures carry `chapterId` — grep below)
- Test: existing suites drive this task (no new test file)

**Interfaces:**
- Consumes: `Chat.draftId` populated (Task 2).
- Produces: wire `Chat` = `{ id, draftId, title, kind, createdAt, updatedAt, lastActivityAt }`. Step 6 (frontend re-keying) consumes `draftId` later; nothing else changes shape.

- [ ] **Step 1: Flip the shared schema**

In `shared/src/schemas/chat.ts`, replace `chapterId: z.string().min(1),` with:

```ts
  // [9wk.3] Chats are draft-scoped: the wire carries the owning draft's id.
  // (chapterId was dropped when Chat re-pointed from Chapter to Draft.)
  draftId: z.string().min(1),
```

- [ ] **Step 2: Flip `RepoChat` + `serializeChat`**

`backend/src/repos/chat.repo.ts` `RepoChat`: replace `chapterId: string;` with:

```ts
  // Nullable in the DB until Task 5's contract migration; non-null at runtime
  // for every row (dual-write + backfill). serializeChat asserts.
  draftId: string | null;
```

`backend/src/lib/serialize.ts` `serializeChat`: replace the `chapterId: row.chapterId,` line with:

```ts
    draftId: assertDraftId(row.draftId),
```

and add above `serializeChat`:

```ts
// [9wk.3] draftId is nullable in the DB until the chat contract migration
// lands (same task-group); at runtime every row has it (dual-write +
// backfill). Zod would reject null anyway — this just fails with a clearer
// message and satisfies the compiler without a blind cast.
function assertDraftId(v: string | null): string {
  if (v === null) throw new Error('serializeChat: chat row has no draftId');
  return v;
}
```

- [ ] **Step 3: Backend consumer — the messages route resolves the chapter through the draft**

`backend/src/routes/chat.routes.ts` `createChatMessagesRouter` (POST `/api/chats/:chatId/messages` handler, ~line 233) reads the chat's chapter for the attachment-mismatch guard and prompt building:

```ts
const chatChapterId = chat.chapterId as string;
```

`RepoChat` no longer carries `chapterId` after this task — re-resolve through the draft (add `import { createDraftRepo } from '../repos/draft.repo';` to the file's imports):

```ts
      // [9wk.3] Chats are draft-scoped; the chapter is reached through the
      // draft. draft.repo.findById is owner-filtered, and the chat itself was
      // ownership-checked above — a miss here is an invariant violation.
      const chatDraft = await createDraftRepo(req).findById(chat.draftId as string);
      if (!chatDraft) {
        throw new Error('chat.routes: chat draft not resolvable (invariant violation)');
      }
      const chatChapterId = chatDraft.chapterId;
```

Every later use of `chatChapterId` in the handler (attachment guard, `createChapterRepo(req).findById(chatChapterId)` for prompt context) is unchanged. (`chat.draftId` is `string | null` until Task 5 tightens it — the `as string` cast carries the same runtime guarantee as `serializeChat`'s assert; Task 5 removes the cast.)

- [ ] **Step 4: Frontend — invalidate from args, not the response**

`frontend/src/hooks/useChat.ts` in the create-chat mutation's `onSuccess` (~lines 104–111): replace both uses of `chat.chapterId` with `vars.chapterId`:

```ts
    onSuccess: (chat, vars) => {
      const summary: ChatSummary = { ...chat, messageCount: 0 };
      const key = chatsQueryKey(vars.chapterId, vars.kind);
      qc.setQueryData<ChatSummary[]>(key, (prev) => [summary, ...(prev ?? [])]);
      // Invalidate by the 3-element prefix so ALL kind variants
      // (ask, scene, undefined) are swept — not just the undefined slot.
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(vars.chapterId) });
    },
```

(Check the mutation's `vars` type actually carries `chapterId` — it does: the mutation posts to `/chapters/${vars.chapterId}/chats`. If the variable name differs, use whatever field the mutation fn reads.) Grep for any OTHER frontend read of the response's `.chapterId` on a chat object:

```bash
grep -rn "\.chapterId" frontend/src frontend/tests | grep -vi "attachment\|outline\|chapter\.\|chapters/"
```

Known NON-chat hits to leave alone: `useAICompletion.ts:138`, `useUnloadFlush.ts:44`, `EditorPage.tsx` (~664/837 — summary-popover state), and `attachment.chapterId` inside useChat (a selection-source field, not the chat row). Only reads of a CHAT object's `.chapterId` change — as of writing that is exactly `useChat.ts:106` and `:110`; `:279` already uses `vars.chapterId`.

- [ ] **Step 5: Sweep wire-shaped fixtures**

Every mock chat object that feeds `chatSchema`/`chatsResponseSchema`/`chatResponseSchema` parsing must rename `chapterId:` → `draftId:`. Find them:

```bash
grep -rn "chapterId" frontend/tests/hooks/useChat.test.tsx frontend/tests/hooks/useScenes.test.tsx frontend/tests/components/ChatTab.test.tsx frontend/tests/components/SceneTab.test.tsx frontend/tests/components/ChatSceneTab.test.tsx shared/tests/ shared/src/schemas/chat*.test.ts 2>/dev/null
```

Transform rule: fixtures that are **API responses** (objects with `kind`/`lastActivityAt` parsed by the chat schemas) rename the key and keep the value (`draftId: 'chap-1'` is fine — it's an opaque id in tests). Component **props** named `chapterId` (e.g. `<ChatSceneTab chapterId=…>`, stories args) are NOT wire shapes — leave them untouched. Backend: `tests/routes/chat-messages-list.test.ts` and any route test asserting `res.body.chat.chapterId` / `res.body.chats[i].chapterId` flips to `.draftId` (assert it equals the chapter's `activeDraftId`).

- [ ] **Step 6: Run the affected suites**

```bash
npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck
npm --prefix shared run test
npm -w story-editor-backend run test -- tests/repos/chat.repo.test.ts tests/routes/chat-messages-list.test.ts
npm --prefix frontend run test
```
Expected: all PASS. Frontend full run per bd memory (shared-schema changes bite in integration tests, not just the edited suites).

- [ ] **Step 7: Commit**

```bash
git add shared/src/schemas/chat.ts backend/src/repos/chat.repo.ts backend/src/lib/serialize.ts frontend/src/hooks/useChat.ts frontend/tests shared/tests backend/tests
git commit -m "[story-editor-9wk.3] flip Chat wire contract chapterId->draftId (schema, RepoChat, serializeChat, fixtures)"
```

---

### Task 5: CONTRACT migration + `ChatCreateInput` flip + call-site sweep

The tightening lands atomically with everything that still references `Chat.chapterId`: the column drop, the input flip, route resolution, import/export, and the backend test call sites. After this task no code or schema references `Chat.chapterId`.

**Files:**
- Modify: `backend/prisma/schema.prisma` (Chat: drop `chapterId` + `chapter` relation + 3 old indexes; `draftId` non-null; 3 new indexes. Chapter: drop `chats Chat[]`)
- Create: `backend/prisma/migrations/<timestamp>_drafts_contract_chat/migration.sql` (generated + hand-prepended re-backfill)
- Modify: `backend/src/repos/chat.repo.ts` (`ChatCreateInput`, `create`, `findManyForChapter` → `findManyForDraft`, drop `ensureChapterOwned`)
- Modify: `backend/src/routes/chat.routes.ts` (resolve `chapterId`→`activeDraftId`; keep chapter mount)
- Modify: `backend/src/services/import.service.ts` (chat create under the minted draft)
- Modify: `backend/src/services/export.service.ts` (chats via `findManyForDraft(activeDraftId)`)
- Modify: `backend/tests/migrations/drafts-expand-backfill.test.ts` (filter to schema-valid statements)
- Modify: backend test call sites (list below)

**Interfaces:**
- Consumes: dual-write (Task 2), chains flipped (Task 3), wire flipped (Task 4), `RepoChapterMeta.activeDraftId` (Task 1).
- Produces: `chatRepo.create({ draftId, title?, kind? })`; `chatRepo.findManyForDraft(draftId, opts?)`; `Chat.draftId` NOT NULL + FK + indexes; `Chat.chapterId` gone. Step 4 (9wk.4) re-mounts routes onto `/api/drafts/:draftId/chats` against exactly this repo surface.

- [ ] **Step 1: Schema edits**

`model Chat` — final shape of the FK block (replace `chapterId`/`draftId`/`chapter`/`draft` lines and the three `@@index` lines):

```prisma
  draftId String
  draft   Draft  @relation("DraftChats", fields: [draftId], references: [id], onDelete: Cascade)

  messages Message[]

  @@index([draftId])
  @@index([draftId, kind])
  // story-editor-loj: index supports the findManyForDraft ORDER BY.
  @@index([draftId, lastActivityAt])
```

`model Chapter` — delete the `chats Chat[]` relation line.

- [ ] **Step 2: Generate, then hand-prepend the re-backfill**

```bash
cd backend && npx prisma migrate dev --create-only --name drafts_contract_chat && cd ..
```

Verify the generated DDL: drops `Chat_chapterId_*` indexes + FK + column, `ALTER COLUMN "draftId" SET NOT NULL`, creates the three new indexes. It must NOT touch `Chapter.body*`/`summaryJson*`/`wordCount`/`Draft`. Then **prepend** this block at the TOP of the generated file (before the NOT NULL), so dev DBs with rows created between expand and contract tighten cleanly (idempotent; fresh DBs no-op; the step-9 squash folds all of this into one migration for operators):

```sql
-- [9wk.3] Contract-phase re-backfill: cover rows created between the expand
-- migration and this one (dev DBs only — chapter-create mints drafts and
-- chat-create dual-writes draftId since 9wk.3, but rows from before those
-- code paths landed may exist). Same statements as the expand backfill.
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

UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL;

UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d, "Chapter" c
WHERE ch."chapterId" = c."id" AND d."chapterId" = c."id" AND ch."draftId" IS NULL;
```

Then regenerate the client: `cd backend && npx prisma generate && cd ..`

- [ ] **Step 3: Flip the repo input + list method**

`backend/src/repos/chat.repo.ts`:

```ts
// Repo-local input shapes. The shared chatCreateSchema can't cover these
// directly because `draftId` comes from the URL-resolved draft (not the body).
export interface ChatCreateInput {
  draftId: string;
  title?: string | null;
  kind?: ChatKind;
}
```

`create` becomes (replaces the Task-2 dual-write version; `ensureChapterOwned` and the `activeDraftId` lookup are deleted — ownership now checks the draft):

```ts
  async function ensureDraftOwned(
    client: PrismaClient,
    draftId: string,
    userId: string,
  ): Promise<void> {
    const ok = await client.draft.findFirst({
      where: { id: draftId, chapter: { story: { userId } } },
    });
    if (!ok) throw new Error('chat.repo: draft not owned by caller');
  }
```

```ts
  async function create(input: ChatCreateInput) {
    const userId = resolveUserId(req);
    await ensureDraftOwned(client, input.draftId, userId);
    const row = await client.chat.create({
      data: {
        draftId: input.draftId,
        kind: input.kind ?? 'ask',
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }
```

Rename `findManyForChapter` → `findManyForDraft` (same ordering comment preserved):

```ts
  async function findManyForDraft(draftId: string, opts?: { kind?: ChatKind }) {
    const userId = resolveUserId(req);
    await ensureDraftOwned(client, draftId, userId);
    const rows = await client.chat.findMany({
      where: {
        draftId,
        draft: { chapter: { story: { userId } } },
        ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
      },
      orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => projectDecrypted<RepoChat>(req, r, ENCRYPTED_FIELDS));
  }
```

Update the returned object: `return { create, findById, findManyForDraft, update, remove };`
`RepoChat.draftId` tightens to `string` (drop the `| null` and the Task-4 comment); `serialize.ts` drops `assertDraftId` and picks `draftId: row.draftId,` directly.

- [ ] **Step 4: Routes resolve the active draft (mount unchanged)**

`backend/src/routes/chat.routes.ts` `createChapterChatsRouter` — both handlers currently do `createChapterRepo(req).findById(chapterId)` for existence. Extend that resolution (POST shown; GET is identical):

```ts
      const chapterId = req.params.chapterId as string;
      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter) throw notFound();
      // [9wk.3] Chats are draft-scoped; this chapter-mounted route resolves
      // the ACTIVE draft (step 4 re-mounts chats under /drafts/:draftId).
      // Null is an invariant violation post-9wk.3 — 500 is correct.
      if (chapter.activeDraftId === null) {
        throw new Error('chat.routes: chapter has no active draft (invariant violation)');
      }
      const chat = await createChatRepo(req).create({
        draftId: chapter.activeDraftId,
        ...
```

(Keep each handler's existing not-found/error style — if the handler currently returns a literal 404 JSON, keep that shape rather than importing `notFound()`; match what's there. GET: `findManyForDraft(chapter.activeDraftId, { kind })`.) `chapter.activeDraftId` is available because `RepoChapter` carries it (Task 1) — `findById` returns the full row shape.

- [ ] **Step 5: import/export services**

`backend/src/services/import.service.ts` (~line 119 area): the chapter loop currently does `chatRepo.create({ chapterId: created.id, … })`. `created` is the repo shape from `chapterRepo.create` → use its pointer:

```ts
        if (created.activeDraftId === null) {
          throw new Error('import: minted chapter has no active draft');
        }
        // chats attach to the chapter's minted initial draft (drafts[] in the
        // export format is step 5 — this keeps v2-no-drafts files importing).
        const chat = await chatRepo.create({ draftId: created.activeDraftId, ... });
```

`backend/src/services/export.service.ts`: chats per chapter currently via `findManyForChapter(chapterId)`. The meta rows now carry `activeDraftId` (Task 1). Replace with:

```ts
      const chats =
        meta.activeDraftId === null
          ? []
          : await chatRepo.findManyForDraft(meta.activeDraftId);
```

(`meta.activeDraftId` null cannot happen post-9wk.3, but the meta type is nullable — the empty-array arm keeps the compiler honest without inventing an error path in export.)

- [ ] **Step 6: Expand-backfill test — filter to schema-valid statements**

`backend/tests/migrations/drafts-expand-backfill.test.ts`: the expand migration's third statement UPDATEs `Chat` via `ch."chapterId"`, which no longer exists after the contract migration — it can no longer run against the live schema (the migration CHAIN is untouched and still correct historically; step 9's baseline-fixture harness proves the end-to-end squash). Changes:

1. In `loadBackfillStatements()`, filter out the now-untestable chat statement and assert the remainder:

```ts
  return sql
    .slice(markerAt)
    .split(';')
    .map((stmt) =>
      stmt
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((stmt) => stmt.length > 0)
    // [9wk.3] The chat re-point statement references Chat."chapterId",
    // dropped by the contract migration — it can't run against the live
    // schema. Its logic is re-proven end-to-end by the step-9 squash harness.
    .filter((stmt) => !stmt.startsWith('UPDATE "Chat"'));
```

2. The structural-guard test flips to `toHaveLength(2)` and drops the third `toMatch`.
3. Remove the chat seed + `chatAfter` assertions from the main test (`createChatRepo` import, the `chat` creation line, the `chatAfter` block).

- [ ] **Step 7: Backend call-site sweep (typecheck-driven)**

Flip every remaining `chatRepo.create({ chapterId: … })` call and `findManyForChapter` use to the new surface. The compiler finds them all:

```bash
npm --prefix backend run typecheck 2>&1 | head -50
```

Known sites (from grep; each follows the same transform — the test already has the chapter in scope, so pass `draftId: chapter.activeDraftId as string`):
- `backend/tests/ai/ask-ai-attachment.test.ts`
- `backend/tests/ai/chat-citations.test.ts`
- `backend/tests/ai/chat-persistence.test.ts`
- `backend/tests/ai/chat-rate-limit-headers.test.ts`
- `backend/tests/repos/chat.repo.test.ts` (incl. deleting the Task-2 dual-write test — superseded by: create with `draftId` writes `draftId`; keep a variant asserting the row's `draftId` equals the passed id)
- `backend/tests/repos/message.repo.test.ts`
- `backend/tests/repos/story.repo.test.ts`
- `backend/tests/routes/chat-messages-list.test.ts` (route still posts to `/api/chapters/:chapterId/chats` — only repo-level fixtures change)
- `backend/tests/security/encryption-leak.test.ts` (its chat seed re-points to the seeded draft or the chapter's `activeDraftId`)
- `backend/tests/services/backup-roundtrip.test.ts`
- `backend/tests/services/export.service.test.ts`

**Raw-Prisma seeds (different transform — these bypass the repos, so there is no `activeDraftId` to read; each needs a hand-created `Draft` row first, then `draftId` in the chat data and the `chapterId` key deleted):**
- `backend/tests/models/chat.test.ts` (~lines 28, 38; also asserts `chat.chapterId` at ~30 → flip to `draftId`)
- `backend/tests/models/message.test.ts` (~line 20)
- `backend/tests/models/chat-message-encrypted.test.ts` (~line 14)
- `backend/tests/models/_helpers.ts` (`createChatRow` at ~25 — give it a `draftId` parameter or create the Draft inside; all its callers follow)
- `backend/tests/auth/delete-account.test.ts` (~line 77)

Raw-seed template (matches the ownership-middleware fix from Task 3):

```ts
    const draft = await prisma.draft.create({ data: { chapterId: chapter.id, orderIndex: 0 } });
    const chat = await prisma.chat.create({ data: { draftId: draft.id } });
```

Where a test asserts `chat.chapterId`, flip to `chat.draftId` + the draft id it expects. Where a test needs "the chapter's draft", read `chapter.activeDraftId` from the repo-create return.

- [ ] **Step 8: Full backend + shared + frontend verification**

```bash
npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck
make dev
npm -w story-editor-backend run test
npm --prefix shared run test && npm --prefix frontend run test
```
Expected: ALL PASS, output pristine.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/src backend/tests
git commit -m "[story-editor-9wk.3] CONTRACT: Chat.draftId NOT NULL + FK + indexes, drop Chat.chapterId; ChatCreateInput->draftId; route/import/export resolve active draft"
```

---

### Task 6: Full-suite gate + tracker

**Interfaces:** none — final gate.

- [ ] **Step 1: Grep for stragglers**

```bash
grep -rn "chapterId" backend/src/repos/chat.repo.ts backend/src/repos/message.repo.ts shared/src/schemas/chat.ts backend/src/lib/serialize.ts | grep -v "draft" ; echo "expect: only chat.routes.ts URL params remain repo-side clean"
grep -rn "findManyForChapter" backend/src backend/tests
```
Expected: no hits for `findManyForChapter`; no `chapterId` in the chat repo/schema/serializer outside comments; `chat.routes.ts` still reads `req.params.chapterId` (mount unchanged — correct until step 4).

- [ ] **Step 2: `make verify`-equivalent**

```bash
make lint && make typecheck
make dev && make test
```
Expected: PASS across shared + backend + frontend.

- [ ] **Step 3: Fix the issue's verify line, then close through the gate**

The issue's `verify:` names a nonexistent path (`tests/middleware/ownership.test.ts`). Update it (single line, first-match-wins):

```bash
bd update story-editor-9wk.3 --append-notes "verify: make dev && npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm -w story-editor-backend run test -- tests/middleware/ownership.middleware.test.ts tests/repos/chat.repo.test.ts tests/repos/message.repo.test.ts tests/repos/chapter.repo.initial-draft.test.ts tests/routes/chat-messages-list.test.ts tests/migrations/drafts-expand-backfill.test.ts tests/security/encryption-leak.test.ts && npm --prefix frontend run test"
```

(Note: the stale verify line above it stays; if `/bd-close-reviewed` picks the OLD line first, edit notes to remove the stale line — first matching `verify:` wins.) Then: do NOT `bd close` — run `/bd-close-reviewed story-editor-9wk.3`. **security-reviewer is in-lane** (ownership chains + middleware); `repo-boundary-reviewer` is in-lane (chat/message repos + migration touching narrative tables).

---

## Self-Review

- **Spec coverage (§3/§5a/§6/§9/§11 step 3):** initial-draft mint at chapter-create incl. seed/import via repo (T1); chat-create writes draftId before tightening (T2 dual-write, exactly §5a's ordering); ownership-chain rewrite in chat.repo/message.repo/ownership.middleware (T3); wire flip RepoChat/serializeChat/shared schema + fixtures, frontend mechanical-only (T4); CONTRACT migration with re-backfill + NOT NULL + FK + re-pointed indexes + chapterId drop, ChatCreateInput flip, chapter-mounted routes resolving activeDraftId (T5); cross-user authz regression test through the new chain (T3 — spec §10). Steps 4/5/6 scope explicitly excluded. ✓
- **Placeholder scan:** every code step shows the code; the two mechanical sweeps (T4 fixtures, T5 call sites) give the exact transform rule + exact file lists + the compiler/grep as the completeness check. ✓
- **Type consistency:** `ChatCreateInput{draftId}` (T5) matches route/import call sites (T5); `RepoChat.draftId: string|null` (T4) tightens to `string` in T5 alongside the NOT NULL; `findManyForDraft` name consistent in repo/routes/export (T5); `RepoChapter.activeDraftId` produced in T1, consumed in T2/T5. ✓
- **Green-at-each-commit:** T1 additive AND adapts the expand-backfill test in the same commit (strip minted draft, remove chat seed — the seed would break under T2's dual-write and T3's Cascade FK); T2 dual-write valid while both columns exist; T3 chains valid because every row has draftId (T2 + backfills) and the middleware test's raw seeds gain a real Draft row in the same commit; T4 response-shape flip with all consumers in-commit (incl. the messages-router `chat.chapterId` read, re-resolved via draft.repo); T5 atomic contract (schema+migration+input+repo call sites+raw-Prisma seeds); expand-test statement filter in the same commit as the column drop. ✓
- **Adversarial review (Opus, 2026-07-04):** 2 blockers + 2 should-fixes + 3 nits found and folded in — messages-router consumer (T4 Step 3), middleware-test draftless seeds (T3 Step 3), raw-Prisma sweep sites incl. `models/_helpers.ts createChatRow` (T5 Step 7), expand-test chat seed moved to T1, RepoChapterMeta derived-type wording, harness-import callout, grep caveat. Reviewer confirmed: quoted code matches reality, migration ordering sound, `chatExportSchema` carries no chapterId (export format untouched this step), e2e/storybook unaffected. ✓
