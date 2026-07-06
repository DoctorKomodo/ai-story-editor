# Drafts Step 4 — Draft Routes + Hard Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full draft management (list / fork / blank / rename / delete / set-active), hard cutover of body/summary/chat endpoints from chapter scope to draft scope, and draft-backed chapter reads so export/prompt/chapter-GET never serve stale data.

**Architecture:** Additive-first, cutover-last: (1) shared draft wire schemas; (2) `_narrative.ts` boilerplate hoists; (3) `draft.repo` grows its full surface (update with `expectedUpdatedAt` guard, transactional delete with 409 guards + reindex, set-active, list metadata, fork); (4) new draft routes + `ownership.middleware` `draft` case + `conflict()` helper go live alongside the old endpoints; (5) THE CUTOVER — one atomic task: a dev-only re-sync migration, chapter reads re-sourced from the active draft, chapter-mounted body/summary/summarise/chats endpoints removed, import re-pointed, test sweep. The read-flip and the write-removal MUST land in the same commit: draft-backed reads with chapter-column writes would make body PATCHes invisible.

**Tech Stack:** TypeScript (strict), Prisma 7 + Postgres 16, Vitest, Zod 4 (shared wire schemas), Express 5.

## Global Constraints

- TypeScript strict mode — no `any`. (CLAUDE.md)
- bd issue: **story-editor-9wk.4**. Commit format: `[story-editor-9wk.4] <desc>`. (CLAUDE.md Git Rules)
- Work from `/home/asg/projects/story-editor` on branch `feature/chapter-drafts`.
- Backend vitest requires the docker stack up: `make dev` before any `npm -w story-editor-backend run test`. (bd memory)
- Specs: `docs/superpowers/specs/2026-07-04-drafts-step4-cutover-design.md` (step delta, user-approved: **hard cutover**, draft-backed chapter reads pulled into this step) + `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §6/§7/§9/§10/§11-step-4.
- **Hard cutover is accepted breakage:** after Task 5, the running frontend's body saves / summary calls / chat-creates 404 or 400 until step 6 flips it. Typecheck and ALL test suites must stay green at every commit. Do not add compatibility shims or dual-writes — the user explicitly rejected them.
- **Contract scope:** do NOT drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount` columns (step 5's contract migration). They become dormant (never read, never written) after Task 5. Do NOT touch `aggregateForStories` (step 5) — story-list word totals read the dormant `Chapter.wordCount` and may go stale on dev DBs; accepted.
- **No down-migration.** Rollback is restore-from-backup. The new re-sync migration is scaffolding, squashed in step 9. Never edit shipped migration files (`20260629185340_drafts_expand`, `20260704161441_chat_draft_fk`, `20260704165922_drafts_contract_chat`).
- **Frontend scope is compile/test fixes only:** chapter-meta fixtures gain the new required fields; NO query re-keying, NO endpoint URL changes, NO component changes (all step 6). Frontend hooks keep calling the removed endpoints — that compiles and its tests mock fetch, so suites stay green.
- New route-layer errors use the central `HttpError` idiom (`backend/src/lib/http-errors.ts`); domain errors (repo-thrown) are mapped by the error-handler `instanceof` table — never hand-rolled `{ error: {…} }` literals in routes. `HttpError.message` must be a static literal.
- Draft ownership chains: every Draft read/write is owner-scoped `chapter: { story: { userId } }` at the data layer, independent of upstream checks. `security-reviewer` and `repo-boundary-reviewer` are both in-lane at the close gate.
- `wordCount` is computed from plaintext (TipTap JSON) BEFORE encryption, at the route layer via `computeWordCount` — except fork, where the repo recomputes from the decrypted source plaintext.
- Prisma client regeneration: after any migration, run `npx prisma generate` from `backend/` (host) and note that the dev backend container needs `docker compose restart backend` afterward.
- If `prisma migrate dev` prompts to RESET the database (drift), STOP and report NEEDS_CONTEXT — never accept a reset. (A destructive-change confirmation for an intended change is fine to accept; this step's migrations should prompt for neither.)

---

### Task 1: Shared draft wire schemas + `DRAFT_ENCRYPTED_FIELD_KEYS` move

**Files:**
- Create: `shared/src/schemas/draft.ts`
- Modify: `shared/src/index.ts` (export block)
- Modify: `backend/src/repos/draft.repo.ts` (import the shared keys; delete the local const)
- Test: `shared/tests/draft.schema.test.ts` (create)

**Interfaces:**
- Consumes: `chapterSummarySchema` from `shared/src/schemas/chapter.ts`.
- Produces: `draftMetaSchema`, `draftSchema`, `draftCreateSchema`, `draftUpdateSchema`, `activeDraftPutSchema`, `draftResponseSchema`, `draftsResponseSchema`, `DRAFT_ENCRYPTED_FIELD_KEYS`, types `Draft`, `DraftMeta`, `DraftCreateInput`, `DraftUpdateInput`. Tasks 3–5 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `shared/tests/draft.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  activeDraftPutSchema,
  DRAFT_ENCRYPTED_FIELD_KEYS,
  draftCreateSchema,
  draftMetaSchema,
  draftSchema,
  draftUpdateSchema,
} from '../src';

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
  it('draftMetaSchema accepts a meta row and rejects ciphertext keys', () => {
    expect(draftMetaSchema.parse(META)).toEqual(META);
    expect(() =>
      draftMetaSchema.parse({ ...META, bodyCiphertext: 'x' }),
    ).toThrow();
  });

  it('draftSchema = meta + bodyJson + summary + summaryUpdatedAt', () => {
    const full = { ...META, bodyJson: { type: 'doc' }, summary: null, summaryUpdatedAt: null };
    expect(draftSchema.parse(full)).toEqual(full);
  });

  it('draftCreateSchema: fork|blank mode, optional label', () => {
    expect(draftCreateSchema.parse({ mode: 'fork' })).toEqual({ mode: 'fork' });
    expect(draftCreateSchema.parse({ mode: 'blank', label: 'darker take' })).toEqual({
      mode: 'blank',
      label: 'darker take',
    });
    expect(() => draftCreateSchema.parse({ mode: 'copy' })).toThrow();
  });

  it('draftUpdateSchema: bodyJson / label / expectedUpdatedAt all optional; label nullable', () => {
    expect(draftUpdateSchema.parse({})).toEqual({});
    expect(draftUpdateSchema.parse({ label: null })).toEqual({ label: null });
    expect(
      draftUpdateSchema.parse({ bodyJson: { type: 'doc' }, expectedUpdatedAt: META.updatedAt }),
    ).toEqual({ bodyJson: { type: 'doc' }, expectedUpdatedAt: META.updatedAt });
  });

  it('activeDraftPutSchema requires draftId', () => {
    expect(activeDraftPutSchema.parse({ draftId: 'd1' })).toEqual({ draftId: 'd1' });
    expect(() => activeDraftPutSchema.parse({})).toThrow();
  });

  it('DRAFT_ENCRYPTED_FIELD_KEYS names the three encrypted fields', () => {
    expect(DRAFT_ENCRYPTED_FIELD_KEYS).toEqual(['body', 'summaryJson', 'label']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix shared run test`
Expected: FAIL — module has no export `draftMetaSchema` etc.

- [ ] **Step 3: Create the schema module**

Create `shared/src/schemas/draft.ts`:

```ts
import { z } from 'zod';
import { chapterSummarySchema } from './chapter';

export const DRAFT_LABEL_MAX = 200;

/**
 * Draft metadata — the LIST endpoint payload shape. Excludes the TipTap body
 * so the sidebar draft-tree payload stays small. `draftSchema` (below) extends
 * this with `bodyJson` + summary for detail responses.
 * `label: null` ⇒ the frontend renders a positional label ("Draft A/B/C").
 */
export const draftMetaSchema = z.strictObject({
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

/** Full draft — meta + TipTap body + decoded summary. */
export const draftSchema = draftMetaSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});

/** POST /api/chapters/:chapterId/drafts body. */
export const draftCreateSchema = z.strictObject({
  mode: z.enum(['fork', 'blank']),
  label: z.string().min(1).max(DRAFT_LABEL_MAX).optional(),
});

/**
 * PATCH /api/drafts/:draftId body. `label: null` clears back to positional.
 * `expectedUpdatedAt` is the optimistic-concurrency precondition against
 * Draft.updatedAt (ported from the chapter PATCH, 409 'conflict' when stale).
 */
export const draftUpdateSchema = z.strictObject({
  bodyJson: z.unknown().optional(),
  label: z.string().min(1).max(DRAFT_LABEL_MAX).nullable().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** PUT /api/chapters/:chapterId/active-draft body. */
export const activeDraftPutSchema = z.strictObject({
  draftId: z.string().min(1),
});

// Response envelopes
export const draftResponseSchema = z.strictObject({ draft: draftSchema });
export const draftsResponseSchema = z.strictObject({ drafts: z.array(draftMetaSchema) });

// Co-located encrypted-field tuple (moved from backend/src/repos/draft.repo.ts).
export const DRAFT_ENCRYPTED_FIELD_KEYS = ['body', 'summaryJson', 'label'] as const;

// z.infer type exports
export type Draft = z.infer<typeof draftSchema>;
export type DraftMeta = z.infer<typeof draftMetaSchema>;
export type DraftCreateInput = z.infer<typeof draftCreateSchema>;
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;
export type DraftEncryptedFieldKey = (typeof DRAFT_ENCRYPTED_FIELD_KEYS)[number];
```

- [ ] **Step 4: Export from `shared/src/index.ts`**

Add a draft export block alongside the existing chapter block (match the file's grouping style — one `export { … } from './schemas/draft';` group for values, and add the types to the type-export group):

```ts
export {
  activeDraftPutSchema,
  DRAFT_ENCRYPTED_FIELD_KEYS,
  DRAFT_LABEL_MAX,
  draftCreateSchema,
  draftMetaSchema,
  draftResponseSchema,
  draftSchema,
  draftsResponseSchema,
  draftUpdateSchema,
} from './schemas/draft';
export type {
  Draft,
  DraftCreateInput,
  DraftEncryptedFieldKey,
  DraftMeta,
  DraftUpdateInput,
} from './schemas/draft';
```

- [ ] **Step 5: Point `draft.repo.ts` at the shared keys**

In `backend/src/repos/draft.repo.ts`, delete the local line:

```ts
const DRAFT_ENCRYPTED_FIELD_KEYS = ['body', 'summaryJson', 'label'] as const;
```

and extend the existing `story-editor-shared` import:

```ts
import {
  type ChapterSummary,
  chapterSummarySchema,
  DRAFT_ENCRYPTED_FIELD_KEYS,
} from 'story-editor-shared';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm --prefix shared run test && npm --prefix shared run typecheck && npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src shared/tests backend/src/repos/draft.repo.ts
git commit -m "[story-editor-9wk.4] shared draft wire schemas + move DRAFT_ENCRYPTED_FIELD_KEYS to shared"
```

---

### Task 2: `_narrative.ts` boilerplate hoists

Every narrative repo duplicates `resolveUserId` (7 copies), and `chapter.repo` / `draft.repo` duplicate `ensureStoryOwned` / `ensureChapterOwned` and the body/summary decode blocks in their `shape()` functions. Hoist them. **Pure refactor — zero behavior change; the full backend suite is the regression net.**

**Files:**
- Modify: `backend/src/repos/_narrative.ts` (add helpers)
- Modify: `backend/src/repos/{chapter,draft,chat,message,story,character,outline}.repo.ts` (replace local copies — confirm the exact set with the grep below; edit only files that actually carry a copy)
- Test: existing suites (no new tests — refactor)

**Interfaces:**
- Produces: `resolveUserId(req, repoTag)`, `ensureStoryOwned(client, storyId, userId, repoTag)`, `ensureChapterOwned(client, chapterId, userId, repoTag)`, `decodeJsonField(projected, field, targetField)`, `decodeSummaryField(projected, row, repoTag)` — exact signatures below. Tasks 3 and 5 call these.

- [ ] **Step 1: Find every duplicate**

```bash
grep -rn "function resolveUserId" backend/src/repos/
grep -rn "function ensureStoryOwned\|function ensureChapterOwned" backend/src/repos/
```

Expected: `resolveUserId` in chapter/draft/chat/message/story/character/outline repos (7 hits; chat.repo's may be top-level); `ensureStoryOwned` in chapter.repo (and possibly character/outline — hoist those too if the body is identical); `ensureChapterOwned` in draft.repo.

- [ ] **Step 2: Add the helpers to `_narrative.ts`**

Append to `backend/src/repos/_narrative.ts` (below `projectDecrypted`):

```ts
import type { PrismaClient } from '@prisma/client';
import { type ChapterSummary, chapterSummarySchema } from 'story-editor-shared';

// ─── Repo boilerplate hoists ([9wk.4]) ──────────────────────────────────────
// Every narrative repo needs the same three guards and the same two decode
// blocks. `repoTag` keeps the per-repo error/log prefixes intact (e.g.
// 'chapter.repo') so messages stay grep-stable.

export function resolveUserId(req: Request, repoTag: string): string {
  const id = req.user?.id;
  if (!id) throw new Error(`${repoTag}: req.user.id is not set`);
  return id;
}

export async function ensureStoryOwned(
  client: PrismaClient,
  storyId: string,
  userId: string,
  repoTag: string,
): Promise<void> {
  const ok = await client.story.findFirst({ where: { id: storyId, userId } });
  if (!ok) throw new Error(`${repoTag}: story not owned by caller`);
}

export async function ensureChapterOwned(
  client: PrismaClient,
  chapterId: string,
  userId: string,
  repoTag: string,
): Promise<void> {
  const ok = await client.chapter.findFirst({ where: { id: chapterId, story: { userId } } });
  if (!ok) throw new Error(`${repoTag}: chapter not owned by caller`);
}

// Parse a decrypted JSON-string field in place: `projected[field]` (plaintext
// string | null) becomes `projected[targetField]` (parsed tree | raw string on
// parse failure | null). Mirrors the chapter/draft shape() body block.
export function decodeJsonField(
  projected: Record<string, unknown>,
  field: string,
  targetField: string,
): void {
  let parsed: unknown = null;
  if (typeof projected[field] === 'string' && (projected[field] as string).length > 0) {
    try {
      parsed = JSON.parse(projected[field] as string);
    } catch {
      parsed = projected[field];
    }
  }
  delete projected[field];
  projected[targetField] = parsed;
}

// Parse + validate a decrypted summaryJson field in place: sets
// `projected.summary` (ChapterSummary | null) and `projected.summaryUpdatedAt`
// (from the raw row), deleting the intermediate keys. Logs id-only on a
// corrupt blob — decrypted narrative content must never reach logs.
export function decodeSummaryField(
  projected: Record<string, unknown>,
  row: { summaryJsonUpdatedAt: Date | null },
  repoTag: string,
): void {
  let summary: ChapterSummary | null = null;
  if (typeof projected.summaryJson === 'string' && (projected.summaryJson as string).length > 0) {
    try {
      summary = chapterSummarySchema.parse(JSON.parse(projected.summaryJson as string));
    } catch {
      console.warn(`[${repoTag}] summary_parse_failed id=${projected.id as string}`);
      summary = null;
    }
  }
  delete projected.summaryJson;
  projected.summary = summary;
  projected.summaryUpdatedAt = row.summaryJsonUpdatedAt;
  delete projected.summaryJsonUpdatedAt;
}
```

Merge the two new imports into `_narrative.ts`'s existing import block (it already imports from `express`; add `@prisma/client` and `story-editor-shared`).

**Note:** the hoisted `decodeSummaryField` log line unifies the tag format to `id=` (draft.repo currently logs `draft=`, chapter.repo logs `chapter=`). That is an intentional, tiny log-format change; no test asserts on it (verify with `grep -rn "summary_parse_failed" backend/tests` — expect no hits).

- [ ] **Step 3: Replace the local copies, repo by repo**

For each repo found in Step 1: delete the local `resolveUserId` / `ensureStoryOwned` / `ensureChapterOwned` function and import from `./_narrative`, passing the repo tag, e.g. in `chapter.repo.ts`:

```ts
import {
  decodeJsonField,
  decodeSummaryField,
  ensureStoryOwned,
  projectDecrypted,
  resolveUserId,
  writeEncrypted,
} from './_narrative';
```

and every call site becomes `resolveUserId(req, 'chapter.repo')`, `ensureStoryOwned(client, input.storyId, userId, 'chapter.repo')`, etc. In `chapter.repo.ts`'s `shape()` replace the body-parse block (the `let bodyJson … projected.bodyJson = bodyJson;` lines) with `decodeJsonField(projected, 'body', 'bodyJson');` and the summary block with `decodeSummaryField(projected, row as { summaryJsonUpdatedAt: Date | null }, 'chapter.repo');` — **keep** the trailing `hasSummary`/`summaryIsStale` derivation lines (they read the raw row's ciphertext column, which the helper does not touch). Same transform in `draft.repo.ts`'s `shape()`. Do NOT change `chat.repo.ts`'s `ensureDraftOwned` (draft-specific, single copy — it stays local until a second consumer exists; YAGNI).

- [ ] **Step 4: Run the full backend suite + typecheck**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test`
Expected: ALL PASS (1124+ tests) — this is a refactor; any failure means a behavior change slipped in.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos
git commit -m "[story-editor-9wk.4] hoist repo boilerplate (resolveUserId/ensure*Owned/decode blocks) into _narrative.ts"
```

---

### Task 3: `draft.repo.ts` full surface

**Files:**
- Modify: `backend/src/repos/draft.repo.ts`
- Test: `backend/tests/repos/draft.repo.test.ts` (extend), `backend/tests/repos/draft.repo.concurrency.test.ts` (create — port of `chapters.concurrency.test.ts`'s 5 cases)

**Interfaces:**
- Consumes: `_narrative.ts` helpers (Task 2), `computeWordCount` from `backend/src/services/tiptap-text`.
- Produces (Tasks 4–5 call these exactly):
  - `update(id, input: RepoDraftUpdateInput, opts?: { expectedUpdatedAt?: Date }): Promise<RepoDraft | null>` — throws `DraftVersionConflictError` on stale precondition.
  - `remove(id): Promise<boolean>` — throws `DraftDeleteActiveError` / `DraftDeleteLastError`; reindexes survivors.
  - `setActive(chapterId, draftId): Promise<boolean>` — false when draft/chapter miss or mismatch.
  - `findManyMetaForChapter(chapterId): Promise<RepoDraftMeta[]>` — decrypts label only.
  - `createFork(chapterId, label?): Promise<RepoDraft>` / `createBlank(chapterId, label?): Promise<RepoDraft>`.
  - Types `RepoDraftUpdateInput`, `RepoDraftMeta`; errors `DraftVersionConflictError`, `DraftDeleteActiveError`, `DraftDeleteLastError` (all exported).

- [ ] **Step 1: Write the failing repo tests**

Extend `backend/tests/repos/draft.repo.test.ts` (reuse its existing context/setup helpers — read the file first and mirror its fixture style) with tests for each new method:

```ts
  it('[9wk.4] update writes body + recomputed fields and label; null label clears', async () => {
    // create a chapter (mints active draft) via chapterRepo, grab activeDraftId
    // update body → re-read via findById: bodyJson round-trips, updatedAt bumped
    // update label 'darker take' → label round-trips; update label null → label null
  });

  it('[9wk.4] update summary sets summaryUpdatedAt == updatedAt (same-instant, not stale)', async () => {
    // update({ summaryJson: {...} }) → re-read: summary parsed,
    // summaryUpdatedAt equals updatedAt exactly (getTime() ===)
  });

  it('[9wk.4] setActive swaps the chapter pointer; rejects a draft of another chapter', async () => {
    // two drafts (mint + createBlank); setActive to the blank → chapter.activeDraftId flips
    // setActive(chapterA.id, draftOfChapterB.id) → false, pointer unchanged
  });

  it('[9wk.4] remove: 409-guard errors on active and on last; deletes + reindexes otherwise', async () => {
    // remove(activeDraft) → throws DraftDeleteActiveError
    // single-draft chapter: setActive stays, remove(only draft) → DraftDeleteActiveError (it IS active)
    // three drafts (orderIndex 0,1,2; active=0): remove(index 1) → survivors reindex to 0,1
    // last-draft guard: chapter with active pointing at its only draft — cover
    //   DraftDeleteLastError via a draft that is last-but-not-active only if
    //   constructible; otherwise assert the active guard fires first (see repo
    //   comment: active-check precedes last-check; a sole draft is always active)
  });

  it('[9wk.4] createFork copies body plaintext (fresh ciphertext), recomputes wordCount, no summary', async () => {
    // chapter with body; createFork → new draft: bodyJson deep-equals source,
    // bodyCiphertext differs from source (raw prisma read), wordCount === computeWordCount(body),
    // summary null, orderIndex === max+1, label as passed
  });

  it('[9wk.4] createBlank: empty body, wordCount 0, next orderIndex', async () => { /* … */ });

  it('[9wk.4] findManyMetaForChapter returns isActive + staleness, no bodyJson, no ciphertext keys', async () => {
    // assert shape keys exactly; assert every key !endsWith Ciphertext/Iv/AuthTag
  });
```

Write the bodies out fully in the test file (the sketches above name the assertions; the implementer writes real code using the file's existing helpers — `makeUserContext`, `createStoryRepo`, `createChapterRepo`, `prisma`).

Create `backend/tests/repos/draft.repo.concurrency.test.ts` — port the five cases from `backend/tests/routes/chapters.concurrency.test.ts` (read it; keep its `makeFakeReq`/`paragraphDoc`/`assertNoCiphertextKeys` helpers, copied local to the new file), re-targeted at `createDraftRepo(req).update(draftId, { bodyJson }, { expectedUpdatedAt })`:
1. matching `expectedUpdatedAt` succeeds and returns the new `updatedAt`;
2. stale `expectedUpdatedAt` throws `DraftVersionConflictError` and does not write;
3. no precondition keeps last-write-wins;
4. deleted-mid-flight (delete the draft row via raw prisma first): returns `null`, does NOT throw the conflict error;
5. the thrown error / returned shapes never contain ciphertext keys.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts tests/repos/draft.repo.concurrency.test.ts`
Expected: FAIL — `update` / `setActive` / `remove` / `createFork` / `createBlank` / `findManyMetaForChapter` are not functions.

- [ ] **Step 3: Implement**

In `backend/src/repos/draft.repo.ts` — add imports (`computeWordCount` from `../services/tiptap-text`), the input/meta types, the three error classes, and the methods inside `createDraftRepo`:

```ts
export interface RepoDraftUpdateInput {
  bodyJson?: unknown;
  wordCount?: number;
  label?: string | null;
  summaryJson?: ChapterSummary | null;
}

export type RepoDraftMeta = {
  id: string;
  chapterId: string;
  label: string | null;
  wordCount: number;
  orderIndex: number;
  isActive: boolean;
  hasSummary: boolean;
  summaryIsStale: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Stale expectedUpdatedAt on update — route maps to 409 'conflict'. */
export class DraftVersionConflictError extends Error {
  constructor(message = 'draft.repo: expectedUpdatedAt no longer matches the current row') {
    super(message);
    this.name = 'DraftVersionConflictError';
  }
}
/** Delete refused: draft is the chapter's active draft — 409. */
export class DraftDeleteActiveError extends Error {
  constructor(message = 'draft.repo: cannot delete the active draft') {
    super(message);
    this.name = 'DraftDeleteActiveError';
  }
}
/** Delete refused: draft is the chapter's last draft — 409. */
export class DraftDeleteLastError extends Error {
  constructor(message = 'draft.repo: cannot delete the last draft') {
    super(message);
    this.name = 'DraftDeleteLastError';
  }
}
```

```ts
  async function update(
    id: string,
    input: RepoDraftUpdateInput,
    opts?: { expectedUpdatedAt?: Date },
  ) {
    const userId = resolveUserId(req, 'draft.repo');
    const data: Record<string, unknown> = {};
    if (input.bodyJson !== undefined) {
      const plaintext = input.bodyJson === null ? null : JSON.stringify(input.bodyJson);
      Object.assign(data, writeEncrypted(req, 'body', plaintext));
    }
    if (input.wordCount !== undefined) data.wordCount = input.wordCount;
    if (input.label !== undefined) {
      Object.assign(data, writeEncrypted(req, 'label', input.label));
    }
    if (input.summaryJson !== undefined) {
      const plaintext = input.summaryJson === null ? null : JSON.stringify(input.summaryJson);
      Object.assign(data, writeEncrypted(req, 'summaryJson', plaintext));
      if (input.summaryJson === null) {
        data.summaryJsonUpdatedAt = null;
      } else {
        const now = new Date();
        data.summaryJsonUpdatedAt = now;
        // Same instant as @updatedAt so a fresh summary isn't immediately
        // stale (this write bumps updatedAt otherwise). Ported from
        // chapter.repo's summary write path.
        data.updatedAt = now;
      }
    }

    const updated = await client.draft.updateMany({
      where: {
        id,
        chapter: { story: { userId } },
        ...(opts?.expectedUpdatedAt !== undefined ? { updatedAt: opts.expectedUpdatedAt } : {}),
      },
      data,
    });
    if (updated.count === 0) {
      if (opts?.expectedUpdatedAt !== undefined) {
        // Disambiguate: precondition failed (row moved — 409) vs row gone /
        // not owned (plain null → 404). Same pattern as chapter.repo had.
        const exists = await client.draft.findFirst({
          where: { id, chapter: { story: { userId } } },
          select: { id: true },
        });
        if (exists) throw new DraftVersionConflictError();
      }
      return null;
    }
    const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
    if (!row) return null;
    return shape(row, req);
  }

  async function setActive(chapterId: string, draftId: string): Promise<boolean> {
    const userId = resolveUserId(req, 'draft.repo');
    // One owner-scoped guard covering both: the draft must exist under THIS
    // chapter and the chapter under this user. Mismatch and not-found are
    // indistinguishable (no enumeration oracle).
    const draft = await client.draft.findFirst({
      where: { id: draftId, chapterId, chapter: { story: { userId } } },
      select: { id: true },
    });
    if (!draft) return false;
    await client.chapter.update({
      where: { id: chapterId },
      data: { activeDraftId: draftId },
    });
    return true;
  }

  async function remove(id: string): Promise<boolean> {
    const userId = resolveUserId(req, 'draft.repo');
    return client.$transaction(async (tx) => {
      const target = await tx.draft.findFirst({
        where: { id, chapter: { story: { userId } } },
        select: { id: true, chapterId: true, chapter: { select: { activeDraftId: true } } },
      });
      if (!target) return false;
      // Guard order matters for the sole-draft case: a chapter's only draft
      // is always its active draft, so the active guard fires first there.
      if (target.chapter.activeDraftId === target.id) throw new DraftDeleteActiveError();
      const siblingCount = await tx.draft.count({ where: { chapterId: target.chapterId } });
      if (siblingCount <= 1) throw new DraftDeleteLastError();

      await tx.draft.delete({ where: { id: target.id } });

      // Re-pack survivors into 0..N-1 with the [D16] two-phase negative
      // parking (dodges @@unique([chapterId, orderIndex]) mid-transaction).
      const remaining = await tx.draft.findMany({
        where: { chapterId: target.chapterId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.draft.update({ where: { id: remaining[i]!.id }, data: { orderIndex: -(i + 1) } });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.draft.update({ where: { id: remaining[i]!.id }, data: { orderIndex: i } });
      }
      return true;
    });
  }

  async function findManyMetaForChapter(chapterId: string): Promise<RepoDraftMeta[]> {
    const userId = resolveUserId(req, 'draft.repo');
    const chapter = await client.chapter.findFirst({
      where: { id: chapterId, story: { userId } },
      select: { activeDraftId: true },
    });
    if (!chapter) throw new Error('draft.repo: chapter not owned by caller');
    const rows = await client.draft.findMany({
      where: { chapterId, chapter: { story: { userId } } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
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
      },
    });
    return rows.map((r) => {
      const projected = projectDecrypted<Record<string, unknown>>(
        req,
        r as Record<string, unknown>,
        ['label'] as const,
      );
      const hasSummary = r.summaryJsonCiphertext != null;
      const summaryIsStale =
        hasSummary && r.summaryJsonUpdatedAt != null && r.summaryJsonUpdatedAt < r.updatedAt;
      delete projected.summaryJsonUpdatedAt;
      return {
        ...projected,
        isActive: r.id === chapter.activeDraftId,
        hasSummary,
        summaryIsStale,
      } as RepoDraftMeta;
    });
  }

  async function nextOrderIndex(chapterId: string): Promise<number> {
    const agg = await client.draft.aggregate({
      where: { chapterId },
      _max: { orderIndex: true },
    });
    return (agg._max.orderIndex ?? -1) + 1;
  }

  async function createFork(chapterId: string, label?: string) {
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
    // Fork copies prose only: body plaintext re-encrypted (fresh IV),
    // wordCount RECOMPUTED from the forked plaintext (never copied — the
    // wordCount-from-plaintext rule), summary NULL, no chats.
    return create({
      chapterId,
      bodyJson: source.bodyJson,
      wordCount: computeWordCount(source.bodyJson),
      label: label ?? null,
      orderIndex: await nextOrderIndex(chapterId),
    });
  }

  async function createBlank(chapterId: string, label?: string) {
    const userId = resolveUserId(req, 'draft.repo');
    await ensureChapterOwned(client, chapterId, userId, 'draft.repo');
    return create({
      chapterId,
      label: label ?? null,
      wordCount: 0,
      orderIndex: await nextOrderIndex(chapterId),
    });
  }
```

Update the returned object:

```ts
  return {
    create,
    createFork,
    createBlank,
    findById,
    findManyForChapter,
    findManyMetaForChapter,
    update,
    setActive,
    remove,
  };
```

`computeWordCount(bodyJson: unknown)` in `backend/src/services/tiptap-text.ts` is null-safe (non-object input yields `''` → 0), so `computeWordCount(source.bodyJson)` needs no guard — drop the `?? null` in the fork call and pass `source.bodyJson` directly.

- [ ] **Step 4: Run the draft repo suites + full backend**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts tests/repos/draft.repo.concurrency.test.ts && npm --prefix backend run typecheck`
Expected: PASS. Then `npm -w story-editor-backend run test` — full suite still green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/draft.repo.ts backend/tests/repos
git commit -m "[story-editor-9wk.4] draft.repo full surface: update+concurrency guard, guarded delete+reindex, setActive, list meta, fork/blank"
```

---

### Task 4: Draft routes + ownership `draft` case + `conflict()` + error-table fold

New endpoints go live **alongside** the old chapter-mounted ones (removed in Task 5). Route surface (flat per-draft mount mirrors the existing `/api/chats/:id` precedent; the spec's nested table pre-dates it — recorded deviation):

| Endpoint | Method | Handler |
|---|---|---|
| `/api/chapters/:chapterId/drafts` | GET | list metadata (`findManyMetaForChapter`) |
| `/api/chapters/:chapterId/drafts` | POST | `{ mode: 'fork'\|'blank', label? }` → 201 full draft |
| `/api/chapters/:chapterId/active-draft` | PUT | `{ draftId }` → 204 |
| `/api/drafts/:draftId` | GET | full draft (body + summary) |
| `/api/drafts/:draftId` | PATCH | `{ bodyJson?, label?, expectedUpdatedAt? }` → full draft |
| `/api/drafts/:draftId` | DELETE | 204; 409 via `DraftDeleteActiveError`/`DraftDeleteLastError` |
| `/api/drafts/:draftId/summary` | PUT | `chapterSummarySchema` body → summary envelope |
| `/api/drafts/:draftId/summarise` | POST | Venice structured-output summarise of the DRAFT body |

**Files:**
- Create: `backend/src/routes/drafts.routes.ts`
- Modify: `backend/src/middleware/ownership.middleware.ts` (add `'draft'` to `OwnedResource` + a `draft` case)
- Modify: `backend/src/lib/http-errors.ts` (add `conflict()`)
- Modify: `backend/src/middleware/error-handler.ts` (fold the three draft domain errors)
- Modify: `backend/src/lib/serialize.ts` (add `serializeDraft`, `serializeDraftMeta`)
- Modify: `backend/src/index.ts` (mounts)
- Test: `backend/tests/routes/drafts.test.ts` (create), `backend/tests/middleware/ownership.middleware.test.ts` (add `draft` case)

**Interfaces:**
- Consumes: Task 1 schemas, Task 3 repo surface.
- Produces: the route table above. Task 5's chat re-mount and test sweep target `/api/drafts/:draftId/...`; step 6 (frontend) consumes these endpoints.

- [ ] **Step 1: `conflict()` helper + error-table fold**

`backend/src/lib/http-errors.ts` — add below `unauthorized`:

```ts
export const conflict = (message: string, code = 'conflict'): HttpError =>
  new HttpError(409, code, message);
```

`backend/src/middleware/error-handler.ts` — import the three errors from `../repos/draft.repo` and `conflict` from `../lib/http-errors`; add to the instanceof table (message strings are static literals per the HttpError security invariant), normalizing through `conflict()` and the existing HttpError branch. Place the block ABOVE the `err instanceof HttpError` check so the reassignment flows into it, or (simpler, matching the table's existing style) as standalone branches:

```ts
  if (err instanceof DraftVersionConflictError) {
    const e = conflict('Draft was modified elsewhere');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
  if (err instanceof DraftDeleteActiveError) {
    const e = conflict('Cannot delete the active draft', 'cannot_delete_active_draft');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
  if (err instanceof DraftDeleteLastError) {
    const e = conflict('Cannot delete the last draft', 'cannot_delete_last_draft');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
```

(`globalErrorHandler` is annotated `: void` and every existing branch emits with `res.status(...).json(...); return;` — a `return res.status(...)` form is a TS2322. The statement + bare `return` shape above matches the file.)

- [ ] **Step 2: ownership middleware `draft` case**

`backend/src/middleware/ownership.middleware.ts`:

```ts
export type OwnedResource =
  | 'story'
  | 'chapter'
  | 'character'
  | 'outline'
  | 'chat'
  | 'message'
  | 'draft';
```

```ts
    case 'draft': {
      const row = await client.draft.findFirst({
        where: { id, chapter: { story: { userId } } },
        select,
      });
      return row !== null;
    }
```

Add to `backend/tests/middleware/ownership.middleware.test.ts`: a `draft` block mirroring the existing chapter/chat cases — owner passes, attacker 403, missing id 400 (copy the adjacent invocation style; the Task-3-era seed helper already creates a Draft row).

- [ ] **Step 3: serializers**

`backend/src/lib/serialize.ts` — add (explicit pick, matching the file's pattern):

```ts
import type { Draft, DraftMeta } from 'story-editor-shared';
import type { RepoDraft, RepoDraftMeta } from '../repos/draft.repo';

// Explicit pick (not spread): RepoDraft's runtime row carries chapterId +
// summaryJsonUpdatedAt remnants; picking keeps the wire shape exact.
export function serializeDraft(row: RepoDraft, isActive: boolean): Draft {
  return {
    id: row.id,
    chapterId: row.chapterId,
    label: row.label,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    isActive,
    hasSummary: row.summary !== null || row.summaryUpdatedAt !== null,
    summaryIsStale:
      row.summaryUpdatedAt !== null && row.summaryUpdatedAt < row.updatedAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bodyJson: row.bodyJson,
    summary: row.summary,
    summaryUpdatedAt: row.summaryUpdatedAt ? row.summaryUpdatedAt.toISOString() : null,
  };
}

export function serializeDraftMeta(row: RepoDraftMeta): DraftMeta {
  return {
    id: row.id,
    chapterId: row.chapterId,
    label: row.label,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    isActive: row.isActive,
    hasSummary: row.hasSummary,
    summaryIsStale: row.summaryIsStale,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

**`hasSummary` caveat:** `RepoDraft` (full shape) has no raw-ciphertext view after `shape()`, so `serializeDraft` derives `hasSummary` from decoded fields — a corrupt-but-present blob decodes to `summary: null` with `summaryUpdatedAt` set, still reporting `hasSummary: true` via the `summaryUpdatedAt !== null` arm. If during implementation this proves shaky, extend `RepoDraft` with explicit `hasSummary`/`summaryIsStale` booleans derived in `shape()` from the raw row (exactly how `chapter.repo`'s `shape()` does it) and simplify the serializer to a pick — prefer that variant if touching `shape()` anyway.

- [ ] **Step 4: write the failing route tests**

Create `backend/tests/routes/drafts.test.ts` — supertest-based, mirroring `backend/tests/routes/chapters-body-json.test.ts`'s app/auth/fixture setup (read that file first). Cover, at minimum:

1. `GET /api/chapters/:chapterId/drafts` → 200 list with the mint (isActive true), ordered, no ciphertext keys anywhere in the JSON (recursive key scan).
2. `POST … { mode: 'fork' }` → 201; bodyJson equals the active draft's; wordCount recomputed; summary null; orderIndex 1.
3. `POST … { mode: 'blank', label: 'x' }` → 201 empty body, wordCount 0, label 'x'.
4. `PATCH /api/drafts/:draftId { label: 'renamed' }` → 200; `{ label: null }` clears.
5. `PATCH /api/drafts/:draftId { bodyJson }` → 200 with recomputed wordCount; with stale `expectedUpdatedAt` → 409 `{ code: 'conflict' }`.
6. `DELETE` active → 409 `cannot_delete_active_draft`; DELETE last → covered via active (sole draft is active); DELETE non-active with 3 drafts → 204 + survivors reindexed 0..1 (assert via GET list).
7. `PUT /api/chapters/:chapterId/active-draft { draftId }` → 204 + list shows new isActive; a draftId from another chapter → 404/403 (assert the route's chosen guard — see Step 5).
8. `PUT /api/drafts/:draftId/summary` (valid `chapterSummarySchema` body) → 200 summary envelope; draft list now `hasSummary: true, summaryIsStale: false`.
9. `POST /api/drafts/:draftId/summarise` — mock the Venice client exactly as `backend/tests/routes/chapters.summarise.test.ts` does (read it; reuse its mocking approach against the new URL) → 200 summary envelope; empty-body draft → 400 `empty_chapter`.
10. Cross-user: attacker gets 403 on every route (ownership middleware) — one representative test per mount.

- [ ] **Step 5: implement `drafts.routes.ts`**

Create `backend/src/routes/drafts.routes.ts` with three exported factories, all `Router({ mergeParams: true })` + `requireAuth`, following `chapters.routes.ts`'s idioms (`validateBody`, `respond`, `serializeDraft(…)`, `notFound()`):

- `createChapterDraftsRouter()` (mount `/api/chapters/:chapterId/drafts`): GET list (`requireOwnership('chapter', { idParam: 'chapterId' })`, `findManyMetaForChapter` → `respond(draftsResponseSchema, …)`); POST create (`draftCreateSchema`; `mode === 'fork' ? repo.createFork(chapterId, body.label) : repo.createBlank(chapterId, body.label)`, wrapped in the same P2002-retry-×3 loop as chapters POST — re-run on unique-violation since `nextOrderIndex` races; 201 `respond(draftResponseSchema, { draft: serializeDraft(created, isActive) })` where `isActive` comes from re-reading the chapter's `activeDraftId` — false for a new fork/blank unless it's the first).
- `createActiveDraftRouter()` (mount `/api/chapters/:chapterId/active-draft`): PUT (`activeDraftPutSchema`; `requireOwnership('chapter', …)`; `const ok = await createDraftRepo(req).setActive(chapterId, body.draftId); if (!ok) throw notFound(); res.status(204).send();`).
- `createDraftCrudRouter()` (mount `/api/drafts`): `requireOwnership('draft', { idParam: 'draftId' })` on each `/:draftId` route; GET full (`findById` → 404 on null); PATCH (`draftUpdateSchema`; build `RepoDraftUpdateInput` — when `bodyJson !== undefined` also set `wordCount: computeWordCount(body.bodyJson)`; pass `opts` from `expectedUpdatedAt`; let `DraftVersionConflictError` propagate to the error handler; 404 on null); DELETE (`remove` → 404 on false, 204 on true; guard errors propagate); PUT `/:draftId/summary` (`chapterSummarySchema` → `repo.update(draftId, { summaryJson: body })` → summary envelope via `chapterSummaryResponseSchema`, exactly the shape the chapter version returns today); POST `/:draftId/summarise` — port the ENTIRE handler body from `chapters.routes.ts`'s `/:chapterId/summarise` (Venice model fetch, schema-capable check, `hydrateUserSettings`, `prepareVeniceCall` with `cacheKeyParts: [draftId, body.modelId]`, `callVeniceCompletion`, parse, then `repo.update(draftId, { summaryJson: parsed })`), sourcing the plaintext from `draft.bodyJson` and the `empty_chapter` 400 from `draft.wordCount === 0 || plaintext.length === 0`. Keep the existing error-mapping calls (`mapVeniceError`, `logVeniceErrorDev`) verbatim with `route: 'draft-summarise'`.

For `serializeDraft`'s `isActive` argument in GET/PATCH responses: resolve via one owner-scoped chapter read (`prisma` is off-limits — use `createChapterRepo(req).findById(draft.chapterId)` and compare `activeDraftId`, or add the cheap variant: `createDraftRepo(req).isActive(draftId)`; prefer reading the chapter through the repo you already have).

Mount in `backend/src/index.ts` (order: specific before generic, mirroring the chats/messages precedent):

```ts
app.use('/api/chapters/:chapterId/drafts', createChapterDraftsRouter());
app.use('/api/chapters/:chapterId/active-draft', createActiveDraftRouter());
app.use('/api/drafts', createDraftCrudRouter());
```

(Task 5 adds `/api/drafts/:draftId/chats` ABOVE the `/api/drafts` mount.)

- [ ] **Step 6: run the suites**

Run: `npm -w story-editor-backend run test -- tests/routes/drafts.test.ts tests/middleware/ownership.middleware.test.ts && npm --prefix backend run typecheck`
Expected: PASS. Then the full backend suite: PASS (old endpoints untouched so far).

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/tests
git commit -m "[story-editor-9wk.4] draft routes (list/fork/blank/rename/delete/set-active/summary/summarise) + ownership draft case + conflict() fold"
```

---

### Task 5: THE CUTOVER — re-sync migration, draft-backed chapter reads, remove chapter-mounted endpoints, chat re-mount, sweep

Everything in this task lands in ONE commit: draft-backed reads without the write-removal would make chapter body PATCHes invisible (write chapter columns, read draft), and vice versa leaves readers stale. Atomic or nothing.

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_drafts_resync_active/migration.sql`
- Modify: `backend/src/repos/chapter.repo.ts` (reads draft-backed; `RepoChapterUpdateInput` narrowed; `ChapterVersionConflictError` + `expectedUpdatedAt` support deleted)
- Modify: `backend/src/routes/chapters.routes.ts` (PATCH narrowed; summary/summarise handlers deleted; conflict catch deleted)
- Modify: `backend/src/routes/chat.routes.ts` (chapter-chats router → draft-chats router)
- Modify: `backend/src/index.ts` (chat mount swap)
- Modify: `backend/src/services/import.service.ts` (summary write re-pointed to the minted draft)
- Modify: `shared/src/schemas/chapter.ts` (`chapterMetaSchema` + `chapterUpdateSchema`)
- Modify: `backend/src/lib/serialize.ts` (`serializeChapter`/`serializeChapterMeta` pick the new fields)
- Modify: `docs/api-contract.md`
- Modify: backend + frontend test files (sweep lists below)

**Interfaces:**
- Consumes: Tasks 1–4 (draft routes must already be live — the sweep re-targets tests at them).
- Produces: wire `ChapterMeta` gains `draftCount: number` + `activeDraftId: string`; `chapterUpdateSchema` (shared) loses `bodyJson`/`expectedUpdatedAt`; chapter-mounted body-write/summary/summarise/chats endpoints are GONE. Step 5 (epic) consumes the dormant columns' drop; step 6 consumes the new endpoints.

- [ ] **Step 1: Re-sync scaffolding migration**

```bash
cd backend && npx prisma migrate dev --create-only --name drafts_resync_active && cd ..
```

The generated file must be EMPTY (no schema change). Paste in (idempotent, decrypt-free — the `updatedAt` copy makes re-runs no-ops):

```sql
-- [9wk.4] Dev-only re-sync: since 9wk.3, body/summary edits updated
-- Chapter.* only, so a chapter's ACTIVE draft can be stale. Before chapter
-- reads flip to the active draft (this step), copy the chapter's ciphertext
-- verbatim onto its active draft wherever the chapter row is newer.
-- Idempotent: the copied updatedAt equals the chapter's, so a second run
-- matches no rows. Fresh DBs and prod (squashed step-9 migration) no-op.
UPDATE "Draft" d
SET "bodyCiphertext"        = c."bodyCiphertext",
    "bodyIv"                = c."bodyIv",
    "bodyAuthTag"           = c."bodyAuthTag",
    "summaryJsonCiphertext" = c."summaryJsonCiphertext",
    "summaryJsonIv"         = c."summaryJsonIv",
    "summaryJsonAuthTag"    = c."summaryJsonAuthTag",
    "summaryJsonUpdatedAt"  = c."summaryJsonUpdatedAt",
    "wordCount"             = c."wordCount",
    "updatedAt"             = c."updatedAt"
FROM "Chapter" c
WHERE c."activeDraftId" = d."id"
  AND c."updatedAt" > d."updatedAt";
```

Then `cd backend && npx prisma generate && cd ..` (no client change expected, but keeps the ritual uniform) and note the dev-container restart in the report.

- [ ] **Step 2: chapter.repo — draft-backed reads**

`findById`: join the active draft and source body/summary from it.

```ts
  async function findById(id: string) {
    const userId = resolveUserId(req, 'chapter.repo');
    const row = await client.chapter.findFirst({
      where: { id, story: { userId } },
      include: {
        activeDraft: true,
        _count: { select: { drafts: true } },
      },
    });
    if (!row) return null;
    return shape(row, req);
  }
```

`shape(row, req)` rewires as a **two-projection split** — this is the step most likely to be botched, so be exact:

1. The chapter-level `projectDecrypted` call changes its field set from `CHAPTER_ENCRYPTED_FIELD_KEYS` (`['title','body','summaryJson']`) to **`['title'] as const` (title only)** — the chapter row still physically carries its dormant `bodyCiphertext`/`summaryJson*` columns until step 5 drops them, and decrypting them here would silently serve the STALE chapter copy. (`CHAPTER_ENCRYPTED_FIELD_KEYS` itself likely has no other consumer afterward — check with grep and slim/remove it in shared if dead.)
2. A second `projectDecrypted(req, row.activeDraft as Record<string, unknown>, ['body', 'summaryJson'] as const)` decrypts the DRAFT's triples; `bodyJson`, `summary`, `summaryUpdatedAt`, `hasSummary`, `summaryIsStale`, and `wordCount` all derive from the draft object (staleness = `draft.summaryJsonUpdatedAt < draft.updatedAt`; `hasSummary` = `draft.summaryJsonCiphertext != null` read from the raw draft row).

`activeDraft === null` is an invariant violation post-9wk.3 — throw `new Error('chapter.repo: chapter has no active draft (invariant violation)')`. Add `draftCount: row._count.drafts` to the output; keep `updatedAt` = the CHAPTER row's own timestamp (title/order edits bump it; body freshness lives on the draft, whose `updatedAt` travels on the draft wire shape). Update `RepoChapter`:

```ts
  // [9wk.4] Sourced from the ACTIVE draft (the active draft IS the chapter
  // downstream): bodyJson, summary, summaryUpdatedAt, hasSummary,
  // summaryIsStale, wordCount. title/orderIndex/timestamps stay chapter-own.
  activeDraftId: string | null;
  draftCount: number;
```

`findManyForStory`: replace the summary/body-related selects with an active-draft join:

```ts
      select: {
        id: true,
        storyId: true,
        orderIndex: true,
        createdAt: true,
        updatedAt: true,
        activeDraftId: true,
        titleCiphertext: true,
        titleIv: true,
        titleAuthTag: true,
        _count: { select: { drafts: true } },
        activeDraft: {
          select: {
            wordCount: true,
            updatedAt: true,
            summaryJsonCiphertext: true,
            summaryJsonUpdatedAt: true,
            ...(opts?.includeSummary ? { summaryJsonIv: true, summaryJsonAuthTag: true } : {}),
          },
        },
      },
```

`shapeMeta` sources `wordCount` from `row.activeDraft.wordCount`, `hasSummary` from `row.activeDraft.summaryJsonCiphertext != null`, `summaryIsStale` from the DRAFT's timestamps (`activeDraft.summaryJsonUpdatedAt < activeDraft.updatedAt`), and adds `draftCount: row._count.drafts` (throw the same invariant-violation error on a null `activeDraft`). The `includeSummary` overload decrypts `summaryJson` from the `activeDraft` sub-object instead of the chapter row (build a `projectDecrypted` call against `row.activeDraft`). `RepoChapterMeta` stays the derived `Omit` — it inherits `draftCount` automatically.

`create`: after the existing transaction, the returned row must ALSO satisfy the new `shape()` — re-read with the same `include` as `findById` inside the transaction's return (replace `return tx.chapter.update(…)` with the update followed by `tx.chapter.findFirstOrThrow({ where: { id: chapterRow.id }, include: { activeDraft: true, _count: { select: { drafts: true } } } })`).

`update`: narrow to structural fields ONLY and delete the concurrency machinery:

```ts
export interface RepoChapterUpdateInput {
  title?: string;
  orderIndex?: number;
}
```

Delete `ChapterVersionConflictError`, the `opts` parameter, the disambiguation re-read, and the `bodyJson`/`summaryJson`/`wordCount` branches. The post-update re-read uses the same `include` as `findById` so `shape()` works.

- [ ] **Step 3: shared schema + serializers**

`shared/src/schemas/chapter.ts`:

```ts
export const chapterMetaSchema = chapterMetaBase.extend({
  hasSummary: z.boolean(),
  summaryIsStale: z.boolean(),
  // [9wk.4] Draft-tree wire fields: the sidebar needs both without an extra
  // round-trip; wordCount/summary flags are sourced from the ACTIVE draft.
  draftCount: z.number().int().positive(),
  activeDraftId: z.string().min(1),
});
```

```ts
export const chapterUpdateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  // [9wk.4] bodyJson + expectedUpdatedAt moved to the draft-scoped PATCH
  // (/api/drafts/:draftId) — body writes to this endpoint now 400.
});
```

**BOTH** `serializeChapter` (full — the GET/POST/PATCH chapter path) **and** `serializeChapterMeta` pick the two new fields (`activeDraftId: assertActiveDraftId(row.activeDraftId)` with a local assert helper exactly like Task-4-era `assertDraftId` was — nullable repo type, non-null wire; `draftCount: row.draftCount`). `chapterSchema` extends `chapterMetaSchema`, so the full chapter response schema inherits both required fields — forgetting `serializeChapter` fails every chapter GET/POST/PATCH against the strict `respond()` re-parse.

**Frontend compile check:** `chapterUpdateSchema` losing `bodyJson`/`expectedUpdatedAt` breaks more than call sites: `ChapterUpdateInput` is embedded in the **exported** `UpdateChapterArgs.input` interface in `frontend/src/hooks/useChapters.ts` (~line 233), consumed by `EditorPage.tsx`, which sends `expectedUpdatedAt` (~lines 286/345) and `bodyJson` on the body PATCH. Fix by widening the hook's input type — e.g. `input: ChapterUpdateInput & { bodyJson?: unknown; expectedUpdatedAt?: string }` (or a named `ChapterBodyPatch` intersection) — so the hook and EditorPage payloads keep compiling WITHOUT changing URLs or behavior; the calls keep firing at the old endpoint and 400 at runtime until step 6 (accepted). Do NOT delete or rewire the hooks. Run `npm --prefix frontend run typecheck` to confirm the closure of fixes.

- [ ] **Step 4: chapters.routes.ts cutover**

- PATCH `/:chapterId`: body validation stays `chapterUpdateSchema` (now narrowed at the source); delete the `bodyJson`/`computeWordCount` branch, the `try/catch` around `update` and the 409 literal, and the now-unused imports (`ChapterVersionConflictError`, `computeWordCount` if unused elsewhere in the file, `chapterSummaryResponseSchema`, `chapterSummarySchema` where only the deleted handlers used them).
- Delete the `router.put('/:chapterId/summary', …)` and `router.post('/:chapterId/summarise', …)` handlers entirely (they live on `/api/drafts/:draftId/...` since Task 4) — along with the summarise-only imports (`resolvePrompt`, `veniceModelsService`, `hydrateUserSettings`, `veniceKeyService`, `callVeniceCompletion`, `prepareVeniceCall`, `getDekFromRequest`, `tipTapJsonToText`, `mapVeniceError`, `logVeniceErrorDev`, `chapterSummaryJsonSchema`, the `SummariseBody` schema) — keep any import the remaining handlers still use (verify with typecheck, not by eye).

- [ ] **Step 5: chat re-mount**

`backend/src/routes/chat.routes.ts`: rename `createChapterChatsRouter` → `createDraftChatsRouter`; the handlers take `req.params.draftId`, drop the chapter resolution + `activeDraftId` invariant checks entirely, and call the repo directly (its `ensureDraftOwned` covers authz):

```ts
  router.post(
    '/',
    validateBody(chatCreateSchema, async (body, req, res) => {
      const draftId = req.params.draftId as string;
      const chat = await createChatRepo(req).create({
        draftId,
        title: body.title ?? null,
        kind: body.kind ?? 'ask',
      });
      return respond(chatResponseSchema, res, { chat: serializeChat(chat) }, 201);
    }),
  );
```

GET mirrors it with `findManyForDraft(draftId, { kind })`. The repo's ensureDraftOwned throw currently surfaces as a 500 — wrap both handlers' repo calls the way the OLD handlers 404'd a missing chapter: pre-check with `requireOwnership('draft', { idParam: 'draftId' })` as router-level middleware (`router.use(requireOwnership('draft', { idParam: 'draftId' }))` after `requireAuth`) so cross-user/unknown draftIds 403 before the repo throw, matching the ownership-middleware convention used by every other mount.

`backend/src/index.ts`:

```ts
// [9wk.4] Chats are draft-scoped. Mounted BEFORE /api/drafts so the
// :draftId/chats segment doesn't collide with the draft CRUD router.
app.use('/api/drafts/:draftId/chats', createDraftChatsRouter());
```

(delete the `/api/chapters/:chapterId/chats` mount + import; keep messages/CRUD mounts untouched).

- [ ] **Step 6: import.service re-point**

In the chapter loop, replace:

```ts
        if (ch.summary) {
          await chapterRepo.update(created.id, { summaryJson: ch.summary });
        }
```

with (AFTER the existing `created.activeDraftId === null` guard — move the guard up if needed so it precedes this):

```ts
        if (ch.summary) {
          // Summary lives on the draft now; attach it to the minted initial
          // draft (drafts[] in the export format is step 5).
          await draftRepo.update(created.activeDraftId, { summaryJson: ch.summary });
        }
```

where `draftRepo = createDraftRepo(req, txc)` is created once next to the other repos at the top of the transaction callback.

- [ ] **Step 7: docs**

`docs/api-contract.md`: update the chapters section — PATCH loses `bodyJson`/`expectedUpdatedAt` (point to the draft PATCH), summary/summarise move under `/api/drafts/:draftId/...`, chats mount moves to `/api/drafts/:draftId/chats`, chapter meta gains `draftCount` + `activeDraftId`, and add the draft routes table from Task 4. Follow the doc's existing terse per-endpoint style.

- [ ] **Step 8: test sweep (typecheck- and failure-driven, but these are the known files)**

Backend — re-target or adapt. **Discovery greps (BOTH — the second catches repo-level callers of the narrowed `chapterRepo.update` that the first misses):**

```bash
grep -rln 'hasSummary\|chapters/' backend/tests
grep -rn 'chapterRepo\.update\|createChapterRepo(.*)\.update\|\.update(chapter' backend/tests | grep -v draft
```

- **`chapterRepo.update({ summaryJson | bodyJson | wordCount })` callers — every one type-errors when `RepoChapterUpdateInput` narrows; re-point each summary/body write to the DRAFT (`createDraftRepo(req).update(chapter.activeDraftId as string, { … })` — chapter reads are draft-backed now, so a draft-side write is what the read-side assertions observe):**
  - `tests/repos/chapter.repo.summary.test.ts` — the entire file exercises the chapter summary write/staleness path, which no longer exists. DELETE the file; its scenarios (summary write, same-instant staleness, corrupt-blob decode, clear-to-null) are owned by the draft-repo tests from Task 3 — verify each scenario has a draft-side equivalent there and add any that is missing (the corrupt-blob decode case likely needs porting).
  - `tests/repos/chapter.repo.test.ts` (~line 98, "update replaces body ciphertext; wordCount stays plaintext") — body/wordCount update semantics moved to the draft; re-target the case at `draftRepo.update` (raw-ciphertext assertions now against the `Draft` table) or delete if Task 3's round-trip already asserts it; keep the title/orderIndex update cases on the chapter.
  - `tests/security/encryption-leak.test.ts` (~line 101) — the sentinel-bearing `chapterRepo.update(chapter.id, { summaryJson: …SENTINEL… })` becomes `draftRepo.update(chapter.activeDraftId as string, { summaryJson: … })`. The sentinel MUST keep flowing into a summary write — E12's Draft-table coverage depends on it. Re-run E12 and confirm it still passes with real sentinel coverage (count>0 guards fire loud if not).
  - `tests/services/backup-roundtrip.test.ts` (~line 149) — `chapterRepo.update(chapter.id, { summaryJson })` becomes the draft-side write; export reads summaries through the draft-backed metadata join, so seeding the chapter column would silently stale the parity assertion.
- `tests/routes/chapters-body-json.test.ts` — body PATCH cases re-target `PATCH /api/drafts/:draftId` (get the draftId from the created chapter's `activeDraftId`); GET-body cases stay on chapter GET (now draft-backed — asserts unchanged).
- `tests/routes/chapters.test.ts` — PATCH bodyJson/wordCount cases move to the draft PATCH or are covered by `drafts.test.ts`; delete only what duplicates, keep title/orderIndex cases.
- `tests/routes/chapters.concurrency.test.ts` — DELETE the file (fully superseded by `draft.repo.concurrency.test.ts` from Task 3).
- `tests/routes/chapters.summary-put.test.ts`, `tests/routes/chapters.summarise.test.ts` — re-target `/api/drafts/:draftId/summary|summarise` (URL + fixture draftId; assertions unchanged).
- `tests/routes/chat.test.ts`, `tests/routes/chat-messages-list.test.ts`, `tests/ai/chat-persistence.test.ts`, `tests/ai/ask-ai-attachment.test.ts`, `tests/ai/chat-citations.test.ts`, `tests/ai/chat-rate-limit-headers.test.ts`, `tests/auth/delete-account.test.ts` — every `POST/GET /api/chapters/${chapterId}/chats` becomes `/api/drafts/${chapter.activeDraftId}/chats` (grep each file for `chats`).
- `tests/lib/serialize.test.ts` — chapter fixtures gain `draftCount` + `activeDraftId`.
- Any suite asserting chapter-meta shapes (`tests/routes/stories.test.ts` etc.) — new fields in expected objects. Let typecheck + the failing suites drive on top of the two greps above.

Frontend — fixtures only:
- `frontend/tests/fixtures/chapter.ts` + inline fixtures in the files from `grep -rln 'hasSummary' frontend/tests` gain `draftCount: 1, activeDraftId: 'draft-1'` (any non-empty string — opaque in tests). This covers BOTH meta fixtures and FULL `Chapter` fixtures — `chapterSchema` extends `chapterMetaSchema`, so full-chapter mocks parsed by `chapterResponseSchema` need the fields too. NO hook/component changes beyond the Step-3 compile fixes.

- [ ] **Step 9: full verification**

```bash
npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck
npm --prefix shared run test
npm -w story-editor-backend run test
npm --prefix frontend run test
```
Expected: ALL PASS, output pristine. (Backend requires the stack: `make dev` first.)

- [ ] **Step 10: Commit**

```bash
git add backend/prisma backend/src backend/tests shared/src shared/tests frontend/src frontend/tests docs/api-contract.md
git commit -m "[story-editor-9wk.4] CUTOVER: draft-backed chapter reads + re-sync migration; remove chapter-mounted body/summary/chats; re-mount chats under drafts"
```

---

### Task 6: Full-suite gate + tracker

**Interfaces:** none — final gate.

- [ ] **Step 1: Straggler greps**

```bash
# chapter-mounted chats / summary endpoints must be gone from src:
grep -rn "chapters/:chapterId/chats\|:chapterId/summar" backend/src
# chapter.repo must not write body/summary/wordCount anymore:
grep -n "bodyJson\|summaryJson\|wordCount" backend/src/repos/chapter.repo.ts
# expected: read-side (shape/select/activeDraft) hits only — no writeEncrypted('body'…)
# ChapterVersionConflictError fully gone:
grep -rn "ChapterVersionConflictError" backend/src backend/tests
```
Expected: first grep no hits; second grep read-side only; third grep no hits.

- [ ] **Step 2: `make verify`-equivalent**

```bash
make lint && make typecheck
make dev && make test
```
Expected: PASS across shared + backend + frontend.

- [ ] **Step 3: Fix the issue's verify line, then close through the gate**

Rewrite the 9wk.4 notes verify line (the current one is stale — it predates this plan). Keep the `plan:` link first; single `verify:` line (first match wins):

```bash
bd update story-editor-9wk.4 --notes "plan: docs/superpowers/plans/2026-07-04-drafts-step4-draft-routes-cutover.md
spec: docs/superpowers/specs/2026-07-04-drafts-step4-cutover-design.md + docs/superpowers/specs/2026-06-25-chapter-drafts-design.md (§6,§7,§9,§10,§11-step-4)
verify: make dev && npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix shared run test && npm -w story-editor-backend run test -- tests/routes/drafts.test.ts tests/repos/draft.repo.test.ts tests/repos/draft.repo.concurrency.test.ts tests/middleware/ownership.middleware.test.ts tests/routes/chapters-body-json.test.ts tests/routes/chapters.summary-put.test.ts tests/routes/chapters.summarise.test.ts tests/routes/chat.test.ts tests/routes/chat-messages-list.test.ts tests/security/encryption-leak.test.ts tests/routes/backup.test.ts && npm --prefix frontend run test
scope-note (2026-07-04, user-approved design): HARD CUTOVER — chapter-mounted body/summary/chat endpoints removed this step; frontend catches up in 9wk.6 (app saves 404 on the branch in between, accepted). Draft-backed chapter reads + §6 metadata join pulled INTO this step from 9wk.5 (anti-staleness); aggregateForStories + export drafts[] + Chapter.body* column drop stay in 9wk.5."
```

(Full-suite backend coverage comes from `make test` in Step 2 and the close gate's typecheck; the verify line lists the step's core suites plus the E12 leak test + round-trip guard, per the shared-schema-change rule the frontend runs its FULL suite.)

Then: do NOT `bd close` — run `/bd-close-reviewed story-editor-9wk.4`. **Both reviewers in-lane:** `security-reviewer` (new draft ownership surface: routes + middleware case) and `repo-boundary-reviewer` (draft.repo full surface, chapter-read re-sourcing, re-sync migration on narrative columns).

Also update `9wk.5`'s notes with a scope-remove: the §6 metadata join landed in 9wk.4 (`bd update story-editor-9wk.5 --append-notes "scope-remove (2026-07-04): chapters findManyForStory active-draft metadata join + prompt-context summary sourcing landed in 9wk.4 (cutover design); 9wk.5 keeps aggregateForStories, export/import drafts[] round-trip, Chapter narrative-column contract drop."`), and `9wk.6`'s with a scope-add pointer (`bd update story-editor-9wk.6 --append-notes "scope-add (2026-07-04): flip frontend to the draft-scoped endpoints landed in 9wk.4 (body/summary/chats moved; chapter-mounted mounts deleted) — includes useChapterSummary, useChat URLs, body PATCH + unload flush + conflict banner re-target."`).

---

## Self-Review

- **Spec coverage (step-delta design + epic §6/§7/§9/§10/§11-step-4):** draft CRUD routes + fork/blank semantics (T3/T4 — fork recomputes wordCount from plaintext, no chats, summary NULL; blank empty); delete guards 409 active/last + reindex in one transaction (T3); set-active (T3/T4); rename via PATCH label with null-clears (T1/T4); body/summary/summarise draft-scoped with the same-instant trick + `expectedUpdatedAt` against `Draft.updatedAt` (T3/T4); `conflict()` + central-table fold + `ChapterVersionConflictError` removal (T4/T5); chat re-mount `/api/drafts/:draftId/chats` (T5); hard cutover with chapter-mounted endpoints removed (T5); draft-backed chapter reads + metadata join + `draftCount`/`activeDraftId` wire fields (T5); re-sync migration (T5); `_narrative.ts` hoists (T2); shared draft schema + `DRAFT_ENCRYPTED_FIELD_KEYS` (T1); no ciphertext egress asserted in list/route tests (T4); staleness re-based on Draft timestamps (T3/T5). Out-of-scope respected: no `aggregateForStories`, no export `drafts[]`, no `Chapter.body*` drop, no frontend re-keying. ✓
- **Placeholder scan:** T3 Step 1 and T4 Step 4 name each test's assertions but delegate fixture wiring to the file's existing helpers (the implementer reads the file first — deliberate, matching this repo's established plan style); every production-code step shows the code or the exact transform. No TBDs. ✓
- **Type consistency:** `RepoDraftUpdateInput`/`RepoDraftMeta`/error classes (T3) match T4's route usage and T5's import re-point; `draftMetaSchema` fields (T1) match `serializeDraftMeta` (T4) and `findManyMetaForChapter` (T3); `draftCount`/`activeDraftId` flow repo (T5-Step2) → serializer (T5-Step3) → wire schema (T5-Step3) → fixtures (T5-Step8). `serializeDraft(row, isActive)` two-arg form used consistently in T4. ✓
- **Green-at-each-commit:** T1 additive schemas; T2 pure refactor (full suite = net); T3 additive repo methods; T4 additive routes (old endpoints still live); T5 atomic cutover (reads+writes+mounts+sweep in one commit — the sweep explicitly includes every `chapterRepo.update({summaryJson|bodyJson|wordCount})` caller: chapter.repo.summary.test.ts, chapter.repo.test.ts, encryption-leak.test.ts, backup-roundtrip.test.ts, found via the second discovery grep); T6 gate-only. The known intentional breakage (running frontend between T5 and step 6) is user-accepted and does not affect any suite. ✓
- **Adversarial review (Opus, 2026-07-04):** 1 blocker + 4 should-fixes found and folded in — the four missed `chapterRepo.update` test callers with draft-side re-point instructions (incl. the E12 sentinel write), the error-handler `void`-return emission style, the `UpdateChapterArgs.input` exported-interface widening + full-Chapter fixture coverage, the two-projection `shape()` split (title-only chapter projection), and the `serializeChapter` full-path emphasis. Reviewer confirmed: Prisma relation names/joins valid, re-sync SQL correct + idempotent (raw SQL bypasses `@updatedAt`), `--create-only` produces an empty migration for data-only SQL, import tx scope correct, no hidden chapter body/summary writers, ownership-test seeds already carry a Draft. ✓
