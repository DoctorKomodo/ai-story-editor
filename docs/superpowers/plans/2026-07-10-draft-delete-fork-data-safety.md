# Draft Delete / Fork Data-Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:test-driven-development` — every step below is a red→green→commit cycle. Write the failing test, run it, watch it fail, implement, run it, watch it pass, commit. Do not batch multiple steps into one commit.

**Goal:** Warn before a draft delete cascade-destroys attached chats/scenes, and let fork optionally deep-copy those chats/scenes onto the new draft — so branching never silently strands or destroys conversation history.

**Architecture:** Add one derived `chatCount` to the list-only `DraftMeta` shape (via a `draftCoreSchema` split so the full-`Draft` shape stays byte-identical), populate it with a Prisma `_count` on the existing `findManyMetaForChapter` query, and make `createFork` a single-`$transaction` deep-copy through the repo layer (decrypt-on-read → encrypt-on-write, fresh IVs). Frontend: `DraftRow` branches to the `ConfirmDialog` primitive when `chatCount > 0`; `NewDraftDialog` gains a fork-only `CheckboxField`.

**Tech Stack:** Zod (shared schemas) · Prisma + Express + TypeScript (backend repo/routes) · React + TanStack Query + Tailwind v4 (frontend) · Vitest (shared/backend/frontend) · Storybook (design surface).

**Spec:** `docs/superpowers/specs/2026-07-09-draft-delete-fork-data-safety-design.md` (approved-in-shape; §6 defines exactly the three tasks below).

## Global Constraints

*(copied verbatim from the spec's §Global Constraints)*

- No schema migration — `chatCount` is a read-time `_count` value, no new
  column. (If the implementer finds a migration is unavoidable, **stop and
  escalate** per CLAUDE.md — do not add a column silently.)
- Fork-copy goes **through the repo layer** (decrypt-on-read → encrypt-on-write,
  fresh IVs). No raw `*Ciphertext`/`*Iv`/`*AuthTag` copying; no ciphertext in
  any response body, log, or error.
- `wordCount` on the forked draft stays **recomputed from plaintext**, never
  copied (existing rule, unchanged by this work).
- The delete endpoint and its active/last-draft guards are unchanged; the
  warning is frontend-only.
- Token-only styling in `frontend/src/` (`lint:design`); TypeScript strict, no
  `any`; commit prefix `[story-editor-6ze]`.
- **Reuse before build:** consume the shipped DS primitives — `ConfirmDialog`
  for the delete warning (§2), `CheckboxField` for the fork option (§3a). No new
  bespoke confirm dialog and no hand-rolled `<input>` form control; introducing
  either is a blocking review finding.

---

## Existing-surface inventory (agent-workflow.md §2)

Enumerated by grep against the real tree, not memory:

| Surface | Path (verified) | Disposition |
|---|---|---|
| `ConfirmDialog` primitive | `frontend/src/design/primitives.tsx:855` (`ConfirmDialogProps`), `:875` (impl) | **reuse** as-is for the delete warning (Task 2). |
| `CheckboxField` primitive | `frontend/src/design/primitives.tsx:571` (`CheckboxFieldProps`), `:581` (impl) — `{ id, label, hint?, testId?, checked, disabled?, onChange:(next:boolean)=>void }`, **no `className`** | **reuse** as-is for the fork option (Task 3). |
| `RadioGroup` primitive | `frontend/src/design/primitives.tsx:522`; already consumed in `NewDraftDialog.tsx:103-113` | **reuse** — Task 3 renders the checkbox alongside it. |
| `message.repo.createWithin(tx, input)` | `backend/src/repos/message.repo.ts:45` — already takes `tx`, runs `ensureChatOwned(tx, …)` at `:47` | **reuse as-is** — the message copy loop calls it directly. |
| `_count` list aggregation pattern | `backend/src/repos/chapter.repo.ts:181` (`_count: { select: { drafts: true } }`) → mapped `:424` (`draftCount: r._count.drafts`) | **extend pattern** — mirror it for `chats` on the draft meta path. |
| `useInlineConfirm` inline-delete path | `frontend/src/components/DraftList.tsx:70,111-120` | **reuse unchanged** — the `chatCount === 0` branch keeps it. |
| `useDeleteDraftMutation` / `useCreateDraftMutation` | `frontend/src/hooks/useDrafts.ts:186` / `:126` | **reuse unchanged** — both branches/checkbox wire onto them; no signature change. |
| `chat.repo.createWithin(tx, input)` | **grep confirms it does NOT exist** (`grep -rn "createWithin" backend/src/repos/chat.repo.ts` → no match) | **genuinely-new** — the only new surface. Added in Task 1, mirroring `message.repo.createWithin`. |

The single genuinely-new surface is `chat.repo.createWithin`. Everything else is reuse or a one-line extension of an existing pattern.

---

## Task 1 — Count + fork API (shared + backend)

Lands the wire contract both frontend tasks consume: `DraftMeta.chatCount` and `draftCreateSchema.copyChats`.

### Files

**Modify**
- `shared/src/schemas/draft.ts` — split `draftMetaSchema` into `draftCoreSchema` (§1a); `draftMetaSchema = core.extend({ chatCount })`; `draftSchema = core.extend({ bodyJson, summary, summaryUpdatedAt })`; add `copyChats` to `draftCreateSchema` (`draft.ts:12-36`).
- `backend/src/repos/draft.repo.ts` — `RepoDraftMeta` gains `chatCount` (`:46`); `findManyMetaForChapter` `select` gains `_count` and its mapper assigns `chatCount` (`:279-310`); refactor `create` to delegate to a new tx-threaded `createWithin`; rewrite `createFork` to the single-`$transaction` deep-copy with the new signature (`:88-117`, `:321-343`).
- `backend/src/repos/chat.repo.ts` — add `createWithin(tx, input)` and refactor `create` to delegate; widen `ensureDraftOwned` to accept a tx client (`:36-60`, `:115`).
- `backend/src/lib/serialize.ts` — `serializeDraftMeta` maps `chatCount`; `serializeDraft` untouched (`:190-203`).
- `backend/src/routes/drafts.routes.ts` — POST handler threads `body.copyChats` into the new `createFork` opts object (`:82-85`).

**Test**
- `shared/tests/draft.schema.test.ts` — update `META` (core, no `chatCount`); add the meta-requires / full-rejects assertions (`:11-33`).
- `backend/tests/repos/draft.repo.test.ts` — update the existing `createFork` call site to the opts signature (`:315`); add `chatCount` and `copyChats` cases.
- `backend/tests/routes/drafts.test.ts` — add `copyChats` flag-threading cases.
- `backend/tests/security/encryption-leak.test.ts` — re-run only; no edit expected (verify it stays green).

### Interfaces

**Produces (consumed by Tasks 2 & 3):**
```ts
// shared: DraftMeta now carries
chatCount: number;            // int, ≥ 0 — asks + scenes combined
// shared: DraftCreateInput now carries
copyChats?: boolean;          // only meaningful when mode === 'fork'
```

**Produces (backend-internal):**
```ts
// chat.repo
createWithin(tx: Prisma.TransactionClient, input: ChatCreateInput): Promise<RepoChat>;
// draft.repo — signature CHANGE (was createFork(chapterId, label?))
createFork(chapterId: string, opts?: { label?: string | null; copyChats?: boolean }): Promise<RepoDraft>;
createWithin(tx: Prisma.TransactionClient, input: RepoDraftCreateInput): Promise<RepoDraft>;
```

**Consumes:** `message.repo.createWithin(tx, input)` (as-is).

---

### Step 1.1 — shared schema split (red → green → commit)

**Red.** Rewrite the top of `shared/tests/draft.schema.test.ts` so `META` is the *core* shape (no `chatCount`), and assert the split:

```ts
const META = {
  id: 'd1',
  chapterId: 'c1',
  label: null,
  wordCount: 42,
  orderIndex: 0,
  isActive: true,
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-07-04T12:00:00.000Z',
  updatedAt: '2026-07-04T12:00:00.000Z',
};

describe('draft schemas', () => {
  it('draftMetaSchema requires chatCount and rejects ciphertext keys', () => {
    const withCount = { ...META, chatCount: 0 };
    expect(draftMetaSchema.parse(withCount)).toEqual(withCount);
    // chatCount is required on meta now
    expect(() => draftMetaSchema.parse(META)).toThrow();
    expect(() => draftMetaSchema.parse({ ...withCount, bodyCiphertext: 'x' })).toThrow();
  });

  it('draftSchema = core + bodyJson + summary + summaryUpdatedAt, and has NO chatCount (egress trap)', () => {
    const full = { ...META, bodyJson: { type: 'doc' }, summary: null, summaryUpdatedAt: null };
    expect(draftSchema.parse(full)).toEqual(full);
    // The egress-trap guard: a full Draft must NOT carry chatCount.
    expect(() => draftSchema.parse({ ...full, chatCount: 3 })).toThrow();
  });
```

Leave the remaining `draftCreateSchema` / `draftUpdateSchema` / `activeDraftPutSchema` cases in place (the `copyChats` case is added in Step 1.2). Run `npm -w story-editor-shared run test -- draft.schema` → **fails** (schema not split yet; `draftMetaSchema.parse(META)` currently succeeds and `draftSchema.parse({...full, chatCount})` currently succeeds because `.extend` on the old meta keeps it loose only for base keys — the new strict guards fail).

**Green.** Edit `shared/src/schemas/draft.ts` (`:12-30`):

```ts
/**
 * Fields shared by the list-meta shape and the full-draft shape. Kept as a
 * private base so `chatCount` can live ONLY on meta (draftMetaSchema) without
 * riding onto the full-draft payload via `.extend` (the egress trap — see the
 * design §1a: adding a key to draftMetaSchema used to make it required on
 * draftSchema, 500-ing every full-draft endpoint through respond()'s hard parse).
 */
const draftCoreSchema = z.strictObject({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  label: z.string().max(DRAFT_LABEL_MAX).nullable(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  isActive: z.boolean(),
  hasSummary: z.boolean(),
  summaryIsStale: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Draft metadata — the LIST endpoint payload shape. Excludes the TipTap body
 * so the sidebar draft-tree payload stays small; carries `chatCount`, the
 * cascade-delete warning count. `label: null` ⇒ the frontend renders a
 * positional label ("Draft A/B/C").
 */
export const draftMetaSchema = draftCoreSchema.extend({
  // Every Chat row for the draft — asks + scenes combined (scenes are chats
  // with kind: "scene"). This is what cascade-deletes when the draft is deleted.
  chatCount: z.number().int().nonnegative(),
});

/** Full draft — core + TipTap body + decoded summary. NO chatCount (egress trap). */
export const draftSchema = draftCoreSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});
```

Run `npm -w story-editor-shared run test -- draft.schema` → **passes**. Run `npm -w story-editor-shared run typecheck`.

**Commit:** `[story-editor-6ze] split draftCoreSchema; chatCount on meta only`

### Step 1.2 — `copyChats` on the create schema (red → green → commit)

**Red.** Add to the `draftCreateSchema` block in `shared/tests/draft.schema.test.ts`:

```ts
  it('draftCreateSchema: optional copyChats boolean', () => {
    expect(draftCreateSchema.parse({ mode: 'fork', copyChats: true })).toEqual({
      mode: 'fork',
      copyChats: true,
    });
    expect(draftCreateSchema.parse({ mode: 'fork' })).toEqual({ mode: 'fork' });
    expect(() => draftCreateSchema.parse({ mode: 'fork', copyChats: 'yes' })).toThrow();
  });
```

Run → **fails** (`copyChats: 'yes'` currently passes strictObject's excess-key check? No — strictObject rejects unknown keys, so `copyChats: true` throws today). Confirm red.

**Green.** Edit `draftCreateSchema` (`shared/src/schemas/draft.ts:33-36`):

```ts
export const draftCreateSchema = z.strictObject({
  mode: z.enum(['fork', 'blank']),
  label: z.string().min(1).max(DRAFT_LABEL_MAX).optional(),
  copyChats: z.boolean().optional(), // only meaningful when mode === 'fork'
});
```

Run → **passes**. `npm -w story-editor-shared run typecheck`.

**Commit:** `[story-editor-6ze] add draftCreateSchema.copyChats`

### Step 1.3 — populate `chatCount` on the meta path (red → green → commit)

**Red.** Add to `backend/tests/repos/draft.repo.test.ts` (uses the file's existing `makeUserContext`, `createStoryRepo`, `createChapterRepo`, `createDraftRepo`, `createChatRepo` imports — add `createChatRepo` / `createMessageRepo` imports at the top alongside the existing ones):

```ts
it('[6ze] findManyMetaForChapter reports chatCount = asks + scenes (0 / ask-only / scene-only / mixed)', async () => {
  const ctx = await makeUserContext('draft-meta-count');
  const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
  const chapter = await createChapterRepo(ctx.req).create({
    storyId: story.id as string, title: 'C', orderIndex: 0,
  });
  const draftRepo = createDraftRepo(ctx.req);
  const chatRepo = createChatRepo(ctx.req);

  // chapter.repo minted an active draft at orderIndex 0 (the "0 chats" case).
  const active = chapter.activeDraftId as string;
  // a second draft with a mix of asks + scenes
  const mixed = await draftRepo.create({ chapterId: chapter.id, orderIndex: 1 });
  await chatRepo.create({ draftId: mixed.id, title: 'ask1', kind: 'ask' });
  await chatRepo.create({ draftId: mixed.id, title: 'scene1', kind: 'scene' });
  await chatRepo.create({ draftId: mixed.id, title: 'ask2', kind: 'ask' });

  const metas = await draftRepo.findManyMetaForChapter(chapter.id);
  const byId = new Map(metas.map((m) => [m.id, m]));
  expect(byId.get(active)!.chatCount).toBe(0);
  expect(byId.get(mixed.id)!.chatCount).toBe(3);
  // no ciphertext / _count remnants on the meta shape
  expect(Object.keys(byId.get(mixed.id)!)).not.toContain('_count');
});
```

Run (stack up — see verify line): `npm -w story-editor-backend run test -- draft.repo` → **fails** (`chatCount` undefined; `RepoDraftMeta` has no such key → typecheck/runtime fail).

**Green.**
1. `backend/src/repos/draft.repo.ts` — extend `RepoDraftMeta` (`:46-57`), add after `updatedAt: Date;`:
```ts
  chatCount: number;
```
2. `findManyMetaForChapter` `select` (`:279-291`) — add one line (mirrors `chapter.repo.ts:181`):
```ts
      select: {
        id: true,
        chapterId: true,
        wordCount: true,
        orderIndex: true,
        createdAt: true,
        updatedAt: true,
        labelCiphertext: true,
        labelIv: true,
        labelAuthTag: true,
        summaryJsonCiphertext: true,
        summaryJsonUpdatedAt: true,
        _count: { select: { chats: true } }, // asks + scenes; one query, no N+1
      },
```
3. The mapper (`:293-310`) — **`_count` DOES ride through the spread.** Verified: `projectDecrypted` returns `{ ...stripCiphertextFields(row), <decrypted fields> }` (`_narrative.ts:109`), and `stripCiphertextFields` skips only `*Ciphertext`/`*Iv`/`*AuthTag`, so `_count` lands in `projected`. (**This supersedes spec §1b**, whose first draft wrongly claimed `_count` would *not* ride through — the spec has since been corrected to match.) Note `serializeDraftMeta` is an explicit-pick serializer, so a stray `_count` would not actually reach the wire or 500 — but it pollutes the internal `RepoDraftMeta` shape. Assign `chatCount` explicitly from `r._count.chats` AND `delete projected._count` before the return so no `_count` remnant reaches `RepoDraftMeta` (the `Object.keys(...).not.toContain('_count')` assertion in Step 1.3's test guards this):
```ts
    return rows.map((r) => {
      const projected = projectDecrypted<Record<string, unknown>>(
        req,
        r as Record<string, unknown>,
        ['label'] as const,
      );
      const flags = deriveSummaryFlags(
        r.summaryJsonCiphertext != null,
        r.summaryJsonUpdatedAt,
        r.updatedAt,
      );
      delete projected.summaryJsonUpdatedAt;
      delete projected._count; // strip the aggregate remnant the spread carried in
      return {
        ...projected,
        isActive: r.id === chapter.activeDraftId,
        chatCount: r._count.chats, // explicit map — mirrors chapter.repo draftCount
        ...flags,
      } as RepoDraftMeta;
    });
```
   (`projectDecrypted` is called on `r`, whose typed row now includes `_count`; TypeScript infers `r._count.chats` from the `select`.)

4. `backend/src/lib/serialize.ts` — `serializeDraftMeta` (`:190-203`), add before the closing brace:
```ts
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    chatCount: row.chatCount,
  };
```

Run `npm -w story-editor-backend run test -- draft.repo` → **passes**. `npm -w story-editor-backend run typecheck`.

**Commit:** `[story-editor-6ze] populate DraftMeta.chatCount via _count (list path)`

### Step 1.4 — `chat.repo.createWithin` (red → green → commit)

**Red.** Add to `backend/tests/repos/` — extend the chat repo test (grep for the existing chat repo test file; if `backend/tests/repos/chat.repo.test.ts` exists, add there; otherwise add a focused case to `draft.repo.test.ts`'s fork coverage in Step 1.6 and skip a standalone here). Minimal standalone assertion that `createWithin` inserts under a tx and enforces ownership:

```ts
it('[6ze] chat.repo.createWithin inserts within a tx and decrypts back', async () => {
  const ctx = await makeUserContext('chat-createwithin');
  const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
  const chapter = await createChapterRepo(ctx.req).create({ storyId: story.id as string, title: 'C', orderIndex: 0 });
  const chatRepo = createChatRepo(ctx.req);
  const created = await prisma.$transaction((tx) =>
    chatRepo.createWithin(tx, { draftId: chapter.activeDraftId as string, title: 'hi', kind: 'scene' }),
  );
  expect(created.title).toBe('hi');
  expect(created.kind).toBe('scene');
});
```

Run → **fails** (`createWithin` not exported).

**Green.** Edit `backend/src/repos/chat.repo.ts`. Widen `ensureDraftOwned` to accept a tx client (mirror `message.repo.ensureChatOwned:28`), refactor `create` to delegate through a tx, and export `createWithin`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
// …
async function ensureDraftOwned(
  client: PrismaClient | Prisma.TransactionClient,
  draftId: string,
  userId: string,
): Promise<void> {
  const ok = await client.draft.findFirst({
    where: { id: draftId, chapter: { story: { userId } } },
  });
  if (!ok) throw new Error('chat.repo: draft not owned by caller');
}

export function createChatRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function createWithin(tx: Prisma.TransactionClient, input: ChatCreateInput) {
    const userId = resolveUserId(req, 'chat.repo');
    await ensureDraftOwned(tx, input.draftId, userId);
    const row = await tx.chat.create({
      data: {
        draftId: input.draftId,
        kind: input.kind ?? 'ask',
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function create(input: ChatCreateInput) {
    return client.$transaction((tx) => createWithin(tx, input));
  }
  // …findById / findManyForDraft / update / remove unchanged…
  return { create, createWithin, findById, findManyForDraft, update, remove };
}
```
Add `Prisma` to the type import (`import type { Prisma, PrismaClient } from '@prisma/client';`).

Run → **passes**. Typecheck.

**Commit:** `[story-editor-6ze] add chat.repo.createWithin (tx-threaded ownership + insert)`

### Step 1.5 — `draft.repo.createWithin` + tx-threaded `create` (refactor, green stays green → commit)

No new behavior — a behavior-preserving refactor so `createFork` can insert the fork body inside its transaction. Existing `draft.repo.test.ts` cases are the regression guard.

**Green.** Edit `backend/src/repos/draft.repo.ts`. Refactor `create` (`:88-117`) so its body lives in a tx-threaded `createWithin`, and `create` delegates:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
// …
export function createDraftRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function createWithin(tx: Prisma.TransactionClient, input: RepoDraftCreateInput) {
    const userId = resolveUserId(req, 'draft.repo');
    await ensureChapterOwned(tx, input.chapterId, userId, 'draft.repo');

    const bodyPlaintext =
      input.bodyJson === undefined || input.bodyJson === null
        ? null
        : JSON.stringify(input.bodyJson);
    const summaryPlaintext =
      input.summaryJson === undefined || input.summaryJson === null
        ? null
        : JSON.stringify(input.summaryJson);
    const labelPlaintext = input.label === undefined ? null : input.label;

    const now = new Date();
    const row = await tx.draft.create({
      data: {
        chapterId: input.chapterId,
        orderIndex: input.orderIndex,
        wordCount: input.wordCount ?? 0,
        ...(summaryPlaintext !== null ? { summaryJsonUpdatedAt: now, updatedAt: now } : {}),
        ...writeEncrypted(req, 'body', bodyPlaintext),
        ...writeEncrypted(req, 'summaryJson', summaryPlaintext),
        ...writeEncrypted(req, 'label', labelPlaintext),
      },
    });
    return shape(row, req);
  }

  async function create(input: RepoDraftCreateInput) {
    return client.$transaction((tx) => createWithin(tx, input));
  }
```
Confirm `ensureChapterOwned` accepts a tx client — check `backend/src/repos/_narrative.ts`; it takes `PrismaClient`. **Widen its first param to `PrismaClient | Prisma.TransactionClient`** (same one-line change as `chat.repo`/`message.repo` used). If `ensureChapterOwned` is shared by other repos, widening the param type is safe (superset). Do this as part of this step.

Add `createWithin` to the returned object.

Run the full existing `draft.repo` suite: `npm -w story-editor-backend run test -- draft.repo` → **still passes** (no behavior change). Typecheck.

**Commit:** `[story-editor-6ze] extract draft.repo.createWithin; route create through a tx`

### Step 1.6 — `createFork` deep-copy in one `$transaction` (red → green → commit)

**Red.** First update the existing fork test's call site (`draft.repo.test.ts:315`) to the new signature, then add the copy cases. Change `:315`:
```ts
    const forked = await draftRepo.createFork(chapter.id, { label: 'fork label' });
```
Add:
```ts
it('[6ze] createFork copyChats:false copies body only, zero chats (regression guard)', async () => {
  const ctx = await makeUserContext('fork-nochats');
  const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
  const chapter = await createChapterRepo(ctx.req).create({
    storyId: story.id as string, title: 'C', orderIndex: 0, bodyJson: paragraphDoc('src'), wordCount: 1,
  });
  const draftRepo = createDraftRepo(ctx.req);
  const chatRepo = createChatRepo(ctx.req);
  await chatRepo.create({ draftId: chapter.activeDraftId as string, title: 'a', kind: 'ask' });

  const forked = await draftRepo.createFork(chapter.id, { copyChats: false });
  const metas = await draftRepo.findManyMetaForChapter(chapter.id);
  expect(metas.find((m) => m.id === forked.id)!.chatCount).toBe(0);
});

it('[6ze] createFork copyChats:true deep-copies every chat + message; source untouched', async () => {
  const ctx = await makeUserContext('fork-copychats');
  const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
  const chapter = await createChapterRepo(ctx.req).create({
    storyId: story.id as string, title: 'C', orderIndex: 0, bodyJson: paragraphDoc('src body'), wordCount: 2,
  });
  const draftRepo = createDraftRepo(ctx.req);
  const chatRepo = createChatRepo(ctx.req);
  const msgRepo = createMessageRepo(ctx.req);
  const src = chapter.activeDraftId as string;

  const ask = await chatRepo.create({ draftId: src, title: 'ask chat', kind: 'ask' });
  const scene = await chatRepo.create({ draftId: src, title: 'scene chat', kind: 'scene' });
  await msgRepo.create({ chatId: ask.id, role: 'user', content: 'hello source' });
  await msgRepo.create({ chatId: ask.id, role: 'assistant', content: 'reply source' });
  await msgRepo.create({ chatId: scene.id, role: 'user', content: 'scene line' });

  const forked = await draftRepo.createFork(chapter.id, { copyChats: true });

  const forkChats = await chatRepo.findManyForDraft(forked.id);
  expect(forkChats).toHaveLength(2);
  expect(forkChats.map((c) => c.kind).sort()).toEqual(['ask', 'scene']);
  // decrypt yields source plaintext; rows point at the NEW draft
  const forkAsk = forkChats.find((c) => c.title === 'ask chat')!;
  expect(forkAsk.draftId).toBe(forked.id);
  const forkAskMsgs = await msgRepo.findManyForChat(forkAsk.id);
  expect(forkAskMsgs.map((m) => m.content)).toEqual(['hello source', 'reply source']); // source order
  expect(forkAskMsgs.every((m) => m.updatedAt === null)).toBe(true); // edit marker reset

  // source untouched: still exactly its two original chats
  const srcChats = await chatRepo.findManyForDraft(src);
  expect(srcChats).toHaveLength(2);
});
```
Run → **fails** (createFork ignores copyChats / new signature / no copy).

**Green.** Rewrite `createFork` (`backend/src/repos/draft.repo.ts:321-343`). Add repo-factory imports at the top of the file:
```ts
import { createChatRepo } from './chat.repo';
import { createMessageRepo } from './message.repo';
```
Then:
```ts
  async function createFork(
    chapterId: string,
    opts?: { label?: string | null; copyChats?: boolean },
  ) {
    const userId = resolveUserId(req, 'draft.repo');
    const chapter = await client.chapter.findFirst({
      where: { id: chapterId, story: { userId } },
      select: { activeDraftId: true },
    });
    if (!chapter) throw new Error('draft.repo: chapter not owned by caller');
    if (chapter.activeDraftId === null) {
      throw new Error('draft.repo: chapter has no active draft (invariant violation)');
    }
    const source = await findById(chapter.activeDraftId);
    if (!source) throw new Error('draft.repo: active draft not resolvable (invariant violation)');

    // Read the source chats + their messages (decrypted) BEFORE opening the tx.
    // Reuses the request-scoped repos; the copy re-encrypts under the same DEK.
    const chatRepo = createChatRepo(req, client);
    const messageRepo = createMessageRepo(req, client);
    const sourceChats = opts?.copyChats ? await chatRepo.findManyForDraft(source.id) : [];
    const chatsWithMessages = await Promise.all(
      sourceChats.map(async (c) => ({ chat: c, messages: await messageRepo.findManyForChat(c.id) })),
    );

    const orderIndex = await nextOrderIndex(chapterId);

    // ONE transaction for the whole fork: body-copy + chat/message deep-copy.
    // A mid-copy failure rolls the entire fork back (no half-copied draft).
    return client.$transaction(async (tx) => {
      // Fork copies prose only for the BODY: body plaintext re-encrypted (fresh
      // IV), wordCount RECOMPUTED (never copied), summary NULL.
      const fork = await createWithin(tx, {
        chapterId,
        bodyJson: source.bodyJson,
        wordCount: computeWordCount(source.bodyJson),
        label: opts?.label ?? null,
        orderIndex,
      });

      // Deep-copy chats (stable order) + messages (source order), fresh IVs.
      for (const { chat, messages } of chatsWithMessages) {
        const newChat = await chatRepo.createWithin(tx, {
          draftId: fork.id,
          title: chat.title,
          kind: chat.kind,
        });
        for (const m of messages) {
          await messageRepo.createWithin(tx, {
            chatId: newChat.id,
            role: m.role,
            content: m.content,
            attachmentJson: m.attachmentJson ?? null,
            citationsJson: m.citationsJson ?? null,
            model: m.model ?? null,
            tokens: m.tokens ?? null,
            latencyMs: m.latencyMs ?? null,
          });
        }
      }
      return fork;
    });
  }
```
Notes for the implementer:
- `createChatRepo(req, client)` / `createMessageRepo(req, client)` are passed the **module client** for the pre-tx reads; the writes explicitly go through `…createWithin(tx, …)`, so the writes are on the tx and the reads are on the module client (reads need no tx).
- `message.repo.createWithin` bumps `lastActivityAt` on each insert (that's fine — the copy gets a fresh, coherent activity time in source order).
- Verify `RepoMessage`'s `attachmentJson` / `citationsJson` / `model` / `tokens` / `latencyMs` field names against `message.repo.ts` `MessageCreateInput` — copy each through. `role` and `content` are required.

Run → **passes**. Typecheck.

**Commit:** `[story-editor-6ze] createFork: single-tx deep-copy of chats & messages`

### Step 1.7 — fork-copy atomicity (rollback) (red → green already green → commit)

**Red.** Add to `draft.repo.test.ts`. Force a mid-copy failure by spying on the message repo factory so its `createWithin` throws; assert the whole fork rolled back:

```ts
import * as messageRepoModule from '../../src/repos/message.repo';
import { vi } from 'vitest'; // add to the existing vitest import line

it('[6ze] createFork copyChats:true rolls back the whole fork on a mid-copy failure', async () => {
  const ctx = await makeUserContext('fork-rollback');
  const story = await createStoryRepo(ctx.req).create({ title: 'S', genre: null, targetWords: null });
  const chapter = await createChapterRepo(ctx.req).create({
    storyId: story.id as string, title: 'C', orderIndex: 0, bodyJson: paragraphDoc('b'), wordCount: 1,
  });
  const draftRepo = createDraftRepo(ctx.req);
  const chatRepo = createChatRepo(ctx.req);
  const msgRepo = createMessageRepo(ctx.req);
  const src = chapter.activeDraftId as string;
  const chat = await chatRepo.create({ draftId: src, title: 'c', kind: 'ask' });
  await msgRepo.create({ chatId: chat.id, role: 'user', content: 'x' });

  const draftsBefore = await prisma.draft.count({ where: { chapterId: chapter.id } });

  // Make the message copy throw AFTER the fork draft + its chat were inserted
  // in the same tx, proving the tx rolls both back.
  const real = messageRepoModule.createMessageRepo;
  const spy = vi.spyOn(messageRepoModule, 'createMessageRepo').mockImplementation((req) => {
    const inst = real(req);
    return { ...inst, createWithin: async () => { throw new Error('boom mid-copy'); } };
  });

  await expect(draftRepo.createFork(chapter.id, { copyChats: true })).rejects.toThrow('boom mid-copy');
  spy.mockRestore();

  // No fork draft, no orphaned copied chats.
  expect(await prisma.draft.count({ where: { chapterId: chapter.id } })).toBe(draftsBefore);
  const srcChats = await chatRepo.findManyForDraft(src);
  expect(srcChats).toHaveLength(1); // source chat only; no copy leaked
});
```

Design decision (spec was silent on *how* to force the failure): spy on the `createMessageRepo` **factory export** and swap `createWithin` to throw. This works because `createFork` calls `createMessageRepo(req, client)` at runtime through the live module binding, so vitest's `vi.spyOn` on the module namespace intercepts it. The failure fires *after* the fork draft and its first chat are inserted on the tx, which is exactly what proves full rollback (not just "message insert failed").

> **Fallback if the spy does not intercept** (some ESM/transpile configs bind the import eagerly): use `vi.mock('../../src/repos/message.repo', async (orig) => { … })` with a factory that wraps `createWithin`, or seed a message whose copy violates a DB constraint. Prefer the `vi.spyOn` form; only fall back if red can't be achieved.

**Green.** Already green from Step 1.6's single-`$transaction` (the rollback is a property of the transaction). Run → **passes** (no code change; if it fails, the tx boundary in 1.6 is wrong — fix `createFork`, not the test).

**Commit:** `[story-editor-6ze] test: fork-copy atomicity (mid-copy failure rolls back)`

### Step 1.8 — route wiring for `copyChats` (red → green → commit)

**Red.** Add to `backend/tests/routes/drafts.test.ts` (uses the file's `setupChapter`, `TEST_ORIGIN`, `paragraphDoc`, `assertNoCiphertextKeys` helpers). To assert flag threading end-to-end, seed a chat on the active draft first, then fork with the flag and read the new draft's meta count:

```ts
it('[6ze] POST { mode: fork, copyChats: true } deep-copies chats onto the fork', async () => {
  const { agent, chapterId, activeDraftId } = await setupChapter('drafts-fork-copy', 'one two');
  // seed a chat on the active (source) draft
  await agent.post(`/api/drafts/${activeDraftId}/chats`).set('Origin', TEST_ORIGIN).send({ kind: 'ask' });

  const res = await agent
    .post(`/api/chapters/${chapterId}/drafts`)
    .set('Origin', TEST_ORIGIN)
    .send({ mode: 'fork', copyChats: true });
  expect(res.status).toBe(201);
  const forkId = res.body.draft.id;

  const list = await agent.get(`/api/chapters/${chapterId}/drafts`);
  expect(list.body.drafts.find((d: { id: string }) => d.id === forkId).chatCount).toBe(1);
  assertNoCiphertextKeys(res.body);
});

it('[6ze] POST { mode: blank, copyChats: true } ignores copyChats', async () => {
  const { agent, chapterId } = await setupChapter('drafts-blank-copy');
  const res = await agent
    .post(`/api/chapters/${chapterId}/drafts`)
    .set('Origin', TEST_ORIGIN)
    .send({ mode: 'blank', copyChats: true });
  expect(res.status).toBe(201);
  expect(res.body.draft.bodyJson).toBeNull();
});
```
Confirm the chat-create route path (`POST /api/drafts/:draftId/chats`) against `backend/src/routes/chat.routes.ts` when writing the seed line; adjust the URL/body to the real chat-create contract if it differs.

Run → **fails** (route drops `copyChats`; fork copies nothing).

**Green.** `backend/src/routes/drafts.routes.ts` POST handler (`:82-85`) — thread the flag into the opts object:
```ts
          created =
            body.mode === 'fork'
              ? await repo.createFork(chapterId, {
                  label: body.label,
                  copyChats: body.copyChats,
                })
              : await repo.createBlank(chapterId, body.label);
```
Run → **passes**. Typecheck.

**Commit:** `[story-editor-6ze] route: thread copyChats into createFork`

### Step 1.9 — leak test stays green (verify only → commit if touched)

Run `npm -w story-editor-backend run test -- encryption-leak` → **passes** unchanged (`chatCount` is a plaintext row count; the copy path emits no ciphertext columns). No edit expected. If it regresses, the fix is in the code (never the test). No commit unless the test file itself needed a copy-path seed extension — the design says re-run, not edit.

### Task 1 verify

Backend vitest needs the stack up (globalSetup runs db-test-reset + `prisma migrate deploy`). Ordered:

```
verify: make dev && until curl -sf http://localhost:4000/api/health >/dev/null 2>&1; do sleep 1; done && npm -w story-editor-shared run typecheck && npm -w story-editor-backend run typecheck && npm -w story-editor-shared run test && npm -w story-editor-backend run test -- draft.repo drafts encryption-leak
```

---

## Task 2 — Delete-warning modal (frontend)

`DraftRow` branches on `chatCount`: `> 0` opens the `ConfirmDialog` primitive; `=== 0` keeps the existing `useInlineConfirm` path untouched. Consumes `DraftMeta.chatCount` from Task 1.

### Files

**Modify**
- `frontend/src/components/DraftList.tsx` — import `ConfirmDialog`; add a `confirmingModal` state to `DraftRow`; branch the delete affordance; render `ConfirmDialog` with the inline-ternary body (`:1-24`, `:56-164`). Surface the delete error to the modal via a per-row error string.
- `frontend/src/components/DraftList.stories.tsx` — `metaOf` defaults `chatCount: 0`; add a delete-modal story with a `chatCount > 0` draft (`:16-28`).
- `frontend/src/components/ChapterList.stories.tsx` — `metaOf` defaults `chatCount: 0` (`:115-127`).
- `frontend/tests/fixtures/chapter.ts` — `makeDraftMeta` defaults `chatCount: 0`; `makeDraft` **strips** `chatCount` from the meta spread (`:42-70`).

**Test**
- `frontend/tests/components/DraftList.test.tsx` (grep for the existing DraftList test file; add cases there) — `chatCount === 0` keeps inline confirm; `chatCount > 0` opens the modal with pluralized copy; Cancel/Escape dismiss with no mutation; Delete fires the mutation and removes the row.

### Interfaces

**Consumes:** `DraftMeta.chatCount` (Task 1), `ConfirmDialog` primitive, `useDeleteDraftMutation` (unchanged).
**Produces:** none (frontend-only UX).

### Step 2.1 — fixture defaults + the `makeDraft` strip (red → green → commit)

**Red.** The three-builder default is what keeps existing inline-confirm tests on the inline path, and the `makeDraft` strip is the fixture-level twin of the egress trap. Start with the strip guard in the fixtures' own test surface — add to the DraftList test file (or a fixtures test if one exists):

```ts
import { draftSchema } from 'story-editor-shared';
import { makeDraft, makeDraftMeta } from '../fixtures/chapter';

it('[6ze] makeDraftMeta carries chatCount; makeDraft (full Draft) does NOT', () => {
  expect(makeDraftMeta().chatCount).toBe(0);
  // full-Draft fixture must parse clean — i.e. NOT carry chatCount (strictObject)
  expect(() => draftSchema.parse(makeDraft())).not.toThrow();
  expect('chatCount' in makeDraft()).toBe(false);
});
```
Run `npm --prefix frontend run test -- DraftList` → **fails to typecheck / fails**: `makeDraftMeta()` has no `chatCount` yet, and once added by spread, `makeDraft()` would inherit it.

**Green.** `frontend/tests/fixtures/chapter.ts`:
- `makeDraftMeta` (`:42-56`) — add `chatCount: 0,` before `...overrides`:
```ts
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    chatCount: 0,
    ...overrides,
  };
```
- `makeDraft` (`:62-70`) — strip `chatCount` from the meta spread (spread props dodge TS excess-property checks, so the strip is mandatory, not cosmetic):
```ts
export function makeDraft(overrides: Partial<Draft> = {}): Draft {
  const { chatCount: _chatCount, ...core } = makeDraftMeta();
  return {
    ...core,
    bodyJson: { type: 'doc', content: [] },
    summary: null,
    summaryUpdatedAt: null,
    ...overrides,
  };
}
```
Run → **passes**. Typecheck: `npm --prefix frontend run typecheck`.

**Commit:** `[story-editor-6ze] fixtures: chatCount default on meta; strip from makeDraft`

### Step 2.2 — story `metaOf` defaults (green — Storybook build guard → commit)

**Green.** Both story builders default `chatCount: 0` so `tsc -p tsconfig.test.json` and the Storybook typecheck pass:
- `frontend/src/components/DraftList.stories.tsx:16-28` — add `chatCount: 0,` before `...overrides`.
- `frontend/src/components/ChapterList.stories.tsx:115-127` — same.

Run `npm --prefix frontend run typecheck`. (No behavior test; this is a compile guard. The delete-modal story is added in Step 2.4.)

**Commit:** `[story-editor-6ze] stories: default chatCount on the two metaOf builders`

### Step 2.3 — `DraftRow` ConfirmDialog branch (red → green → commit)

**Red.** Add to the DraftList test file:

```ts
it('[6ze] draft with chatCount 0 uses the inline confirm (no modal)', async () => {
  // render DraftList seeded with a chatCount:0 non-active draft; click delete;
  // assert the inline confirm testId appears and the modal testId does not.
  // (follow the file's existing render/seed helpers)
});

it('[6ze] draft with chatCount > 0 opens the ConfirmDialog with pluralized copy', async () => {
  // seed a non-active draft { id: 'd-b', isActive: false, chatCount: 3 };
  // click its delete IconButton (testId `draft-row-d-b-delete`);
  // expect modal testId `draft-row-d-b-confirm-modal` present, body contains
  //   'its 3 attached chats & scenes';
  // seed another with chatCount: 1 → body contains 'its 1 attached chat & scene'.
});

it('[6ze] modal Cancel dismisses with no delete mutation; Delete fires it', async () => {
  // Cancel (testId `…-confirm-modal-cancel`) → no DELETE request;
  // reopen, Delete (`…-confirm-modal-confirm`) → DELETE fired, row removed.
});
```
Follow the existing DraftList test's render harness (QueryClient seed + MSW/`vi.fn` for the DELETE). Run `npm --prefix frontend run test -- DraftList` → **fails**.

**Green.** Edit `frontend/src/components/DraftList.tsx`.
1. Import `ConfirmDialog` from `@/design/primitives` (add to the existing import block `:5-12`).
2. In `DraftRow` add modal state + an error string, alongside the existing `useInlineConfirm` (`:69-80`):
```ts
  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const hasAttached = draft.chatCount > 0;

  const onConfirmDelete = async (): Promise<void> => {
    setDeleteError(null);
    try {
      await onRequestDelete();
      confirm.dismiss();
      setConfirmingDelete(false);
    } catch {
      // Inline path: surfaced via onStatus (aria-live). Modal path: keep it
      // open and show the error inline on the dialog.
      if (hasAttached) setDeleteError("Delete failed — try again.");
    }
  };
```
   (`useState` is already imported at `:3`.)
3. The delete `IconButton`'s `onClick` (`:150-158`) picks the path by `hasAttached`:
```ts
            {draft.isActive ? null : (
              <IconButton
                ariaLabel={`Delete ${displayLabel}`}
                onClick={() => {
                  if (hasAttached) {
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  } else {
                    confirm.ask();
                  }
                }}
                testId={`draft-row-${draft.id}-delete`}
              >
                <CloseIcon />
              </IconButton>
            )}
```
4. Render the modal once, after the `</li>`-closing content — since `<li>` returns a single element, wrap the row body and the dialog in a fragment. Add the `ConfirmDialog` as a sibling inside the `<li>` (the primitive portals its own `Modal`, so nesting is fine):
```tsx
      )}
      {hasAttached ? (
        <ConfirmDialog
          open={confirmingDelete}
          title={`Delete "${displayLabel}"?`}
          body={
            `This permanently deletes its ${draft.chatCount} attached ` +
            `${draft.chatCount === 1 ? 'chat & scene' : 'chats & scenes'}. ` +
            `This can't be undone.`
          }
          confirmLabel="Delete draft"
          confirmVariant="danger"
          pending={isDeleting}
          error={deleteError}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
          testId={`draft-row-${draft.id}-confirm-modal`}
        />
      ) : null}
    </li>
```
   The `ConfirmDialog` renders nothing when `open={false}` (its `Modal` gates on `open`), so it's inert on rows the user isn't deleting. The `chatCount === 1` ternary lives only in the `body` string (inline pluralization — no shared helper, per the codebase idiom).

Run → **passes**. `npm --prefix frontend run lint:design && npm --prefix frontend run typecheck`.

**Commit:** `[story-editor-6ze] DraftRow: ConfirmDialog warning when chatCount > 0`

### Step 2.4 — delete-modal Storybook state (green → commit)

**Green.** Add a story to `frontend/src/components/DraftList.stories.tsx` seeding a non-active draft with `chatCount > 0` and (optionally) a `play` that clicks its delete button to show the modal open:
```ts
export const DeleteWarnsOnAttachedChats: StoryObj<typeof DraftList> = {
  decorators: [/* seeded QueryClient with metaOf({ id: 'd-b', orderIndex: 1, chatCount: 3 }) */],
  // optional play: click `draft-row-d-b-delete`, assert the modal is visible.
};
```
Follow the file's existing decorator/`seeded` pattern. Run `npm --prefix frontend run typecheck`.

**Commit:** `[story-editor-6ze] story: DraftList delete-warning modal state`

### Task 2 verify

Frontend vitest is jsdom — no stack needed:
```
verify: npm --prefix frontend run typecheck && npm --prefix frontend run test -- DraftList && npm --prefix frontend run lint:design
```

---

## Task 3 — Fork checkbox (frontend)

`NewDraftDialog` gains a fork-only `CheckboxField` ("Also copy chats & scenes"), wired to `copyChats` on the create call. Consumes `draftCreateSchema.copyChats` from Task 1.

### Files

**Modify**
- `frontend/src/components/NewDraftDialog.tsx` — import `CheckboxField`; add `copyChatsId = useId()` + `copyChats` state; render the fork-only checkbox indented under the `RadioGroup`; add `copyChats` to the create `input` (`:1-14`, `:61-113`, `:70-85`).
- `frontend/src/components/NewDraftDialog.stories.tsx` (grep to confirm the exact path; if none exists, skip the story add and note it) — a fork-with-copy story.

**Test**
- `frontend/tests/components/NewDraftDialog.test.tsx` (grep for the existing file) — checkbox visible only for fork; toggling it sets `copyChats: true` on the `useCreateDraftMutation` call; blank mode omits it.

### Interfaces

**Consumes:** `draftCreateSchema.copyChats` (Task 1), `CheckboxField` primitive, `useCreateDraftMutation` (unchanged — `input: DraftCreateInput` already carries `copyChats`).
**Produces:** none.

### Step 3.1 — checkbox render + wiring (red → green → commit)

**Red.** Add to the NewDraftDialog test:
```ts
it('[6ze] copy-chats checkbox shows only for fork mode', async () => {
  // render dialog (default mode 'fork') → checkbox testId `new-draft-copy-chats` present;
  // select the "Start blank" radio → checkbox gone.
});

it('[6ze] toggling copy-chats sets copyChats:true on the create call', async () => {
  // spy the create mutation (mock api POST); check the checkbox; click Create;
  // assert the POST body is { mode: 'fork', copyChats: true }.
});

it('[6ze] blank mode create omits copyChats', async () => {
  // switch to blank, Create → POST body has no copyChats.
});
```
Follow the file's existing render harness. Run `npm --prefix frontend run test -- NewDraftDialog` → **fails**.

**Green.** Edit `frontend/src/components/NewDraftDialog.tsx`.
1. Import `CheckboxField` (add to the `:4-14` import block).
2. State (`:61-65`):
```ts
  const titleId = useId();
  const nameId = useId();
  const copyChatsId = useId();
  const [mode, setMode] = useState<'fork' | 'blank'>('fork');
  const [name, setName] = useState('');
  const [copyChats, setCopyChats] = useState(false);
  const createDraft = useCreateDraftMutation();
```
3. Render the fork-only checkbox right after the `RadioGroup` (`:113`), indented via a wrapping `<div className="pl-6">` (`CheckboxField` takes no `className` — verified `primitives.tsx:571`):
```tsx
        </RadioGroup>
        {mode === 'fork' ? (
          <div className="pl-6">
            <CheckboxField
              id={copyChatsId}
              label="Also copy chats & scenes"
              checked={copyChats}
              disabled={createDraft.isPending}
              onChange={setCopyChats}
              testId="new-draft-copy-chats"
            />
          </div>
        ) : null}
```
   (`RadioGroup` is self-closing at `:103-113` — insert the block as a sibling in `ModalBody`, directly after the `RadioGroup` element and before the `Field`.)
4. Thread `copyChats` into the create input (`:70-85`):
```ts
  const handleCreate = (): void => {
    const trimmed = name.trim();
    createDraft.mutate(
      {
        chapterId,
        storyId,
        input: {
          mode,
          ...(trimmed.length > 0 ? { label: trimmed } : {}),
          ...(mode === 'fork' && copyChats ? { copyChats: true } : {}),
        },
      },
      {
        onSuccess: (draft) => {
          onClose();
          onCreated(draft);
        },
      },
    );
  };
```
   Guarding with `mode === 'fork'` means blank-mode creates never send `copyChats` (the backend ignores it anyway, but keeping the wire clean matches the spec's "ignored when blank").

Run → **passes**. `npm --prefix frontend run lint:design && npm --prefix frontend run typecheck`.

**Commit:** `[story-editor-6ze] NewDraftDialog: fork-only copy-chats CheckboxField`

### Step 3.2 — fork-with-copy Storybook state (green → commit)

**Green.** If `NewDraftDialog.stories.tsx` exists, add a story with the checkbox checked (fork mode). If it does not exist, note in the commit that NewDraftDialog has no story file and skip (do not create a lone new story file just for this — confirm by grep first). Run `npm --prefix frontend run typecheck`.

**Commit:** `[story-editor-6ze] story: NewDraftDialog fork-with-copy` (or skip per above)

### Task 3 verify

```
verify: npm --prefix frontend run typecheck && npm --prefix frontend run test -- NewDraftDialog && npm --prefix frontend run lint:design
```

---

## Full-suite verify (end of plan, before `/bd-close-reviewed`)

Backend needs the stack up; frontend/shared don't. One line:

```
verify: make dev && until curl -sf http://localhost:4000/api/health >/dev/null 2>&1; do sleep 1; done && make verify
```

`make verify` runs lint + typecheck + design-lint + builds + the shared/backend/frontend test suites (backend tests require the stack, which the `make dev` + health-wait prefix guarantees). Path-matched surface reviewers at the close gate: **`repo-boundary-reviewer`** (draft/chat/message repos, content-crypto symmetry, no ciphertext egress, leak test) and plausibly **`security-reviewer`** (DEK usage on the copy path) — both auto-dispatch via `/bd-close-reviewed`.
