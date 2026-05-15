# Chapter Entity Consolidation — Shared Zod Schemas

**Status:** Draft
**Date:** 2026-05-15
**bd issue:** `story-editor-ggl`
**Precedents:** PR #100 (Character), #104 (Message), #105 (Story), #110 (Outline), #111 (Chat)

## Goal

Migrate the Chapter entity onto `story-editor-shared` Zod schemas with runtime `.parse()` validation at the wire boundary. This is the fifth (and final narrative-entity) consolidation in the series — Character / Message / Story / Outline / Chat all shipped on the same pattern; Chapter completes the set.

No functional changes. Pure type-source-of-truth migration plus strict wire validation.

### Two goals (from the series)

1. **Reduce drift.** Today the Chapter wire shape lives in three places: inline Zod validators in `backend/src/routes/chapters.routes.ts`, the `ChapterMeta` / `Chapter` interfaces in `frontend/src/hooks/useChapters.ts`, and ad-hoc test-fixture object literals. Each one can drift from the others. After this change, there is **one** canonical shape in `story-editor-shared`; everything else imports or re-derives from it.
2. **Eliminate duplicated shapes.** Delete the hand-rolled frontend interfaces. Replace `respond()` callers' inline cast helpers with `serializeChapter()` / `serializeChapterMeta()` explicit-pick converters at the handler boundary. The repo gains `RepoChapter` / `RepoChapterMeta` type aliases so `projectDecrypted<T>` is typed.

## Chapter-specific shape decisions

Chapter has a **list-vs-detail asymmetry** that differs from every prior entity in the series:

- **Chat** (#111): detail is the base shape; LIST extends with derived `messageCount`. → `chatSchema` base, `chatSummarySchema = chatSchema.extend({ messageCount })`.
- **Chapter** (this work): LIST returns a *lighter* payload (no `bodyJson`); detail returns the *heavier* payload with TipTap body. → `chapterMetaSchema` base, `chapterSchema = chapterMetaSchema.extend({ bodyJson })`.

The schema direction (meta-as-base) mirrors the existing frontend types (`Chapter extends ChapterMeta`) and treats the TipTap body as the "heavy extra" field. This was decided in the brainstorm — alternative (detail-as-base with `.omit({ bodyJson })`) was rejected.

`bodyJson` is typed `z.unknown()`. TipTap's internal tree structure is TipTap's own contract — we don't validate its shape, we pass it through. Matches the existing route-layer `z.unknown().optional()`.

## Shared schemas — `shared/src/schemas/chapter.ts`

```ts
import { z } from 'zod';

export const CHAPTER_TITLE_MIN = 1;
export const CHAPTER_TITLE_MAX = 500;

export const chapterStatusSchema = z.enum(['draft', 'revision', 'final']);

/**
 * Chapter metadata — the LIST endpoint payload shape. Excludes the TipTap
 * body to keep the chapter-sidebar payload small. `chapterSchema` (below)
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
 * Bulk reorder payload. Mirrors the outline reorder schema in scope — semantic
 * checks (duplicate ids, duplicate orderIndex values) stay in the route handler.
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
// Repo layer imports these to type `projectDecrypted<T>` and `writeEncrypted()`.
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

`shared/src/index.ts` re-exports all of the above (schemas + constants + inferred types) following the Chat / Outline precedent.

## Backend changes

### `backend/src/repos/chapter.repo.ts`

Add two `type` aliases (NOT `interface` — `interface` declarations do not satisfy `Record<string, unknown>`, which is the constraint on `projectDecrypted<T>`'s generic parameter; this was caught in the Chat consolidation at commit `9cae5cf`):

```ts
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

export type RepoChapterMeta = Omit<RepoChapter, 'bodyJson'>;
```

Replace the local `ENCRYPTED_FIELDS` and `META_ENCRYPTED_FIELDS` consts with imports of `CHAPTER_ENCRYPTED_FIELD_KEYS` and `CHAPTER_META_ENCRYPTED_FIELD_KEYS` from `story-editor-shared`.

**Typing `shape()` vs `shapeMeta()` — important asymmetry.** The two helpers project differently and must be typed differently:

- `shapeMeta()` — `projectDecrypted()` produces the meta shape directly. Type the call: `projectDecrypted<RepoChapterMeta>(req, row, CHAPTER_META_ENCRYPTED_FIELD_KEYS)`.
- `shape()` — `projectDecrypted()` produces an object with `body: string | null` (the decrypted plaintext). The rename to `bodyJson` happens *after*, at the existing `delete projected.body; projected.bodyJson = JSON.parse(...)` step (chapter.repo.ts:301–302). So `projectDecrypted<RepoChapter>` at the projection step would be a typing lie — `RepoChapter.bodyJson` doesn't exist on the pre-rename object. **Type only the return value of `shape()` as `RepoChapter`**; leave the `projectDecrypted` call un-generic'd (it returns the wide `Record<string, unknown>` shape, and the rename block narrows it).

**Do not refactor where the `body` (string) → `bodyJson` (parsed JSON) conversion happens.** Today the repo's `shape()` does `JSON.parse()` on the decrypted plaintext and emits `bodyJson` (deleting the raw `body` field from the returned object). Preserve that; the `RepoChapter` type reflects the post-rename shape (`bodyJson: unknown`, no `body`). This keeps the change purely additive — no behaviour drift.

**`Chapter*Input` repo locals diverge from the wire — must be renamed to avoid an import collision.** The repo's `ChapterCreateInput` (chapter.repo.ts:13) carries `storyId`, `orderIndex`, and `wordCount` (all server-set, never on the wire); the repo's `ChapterUpdateInput` (chapter.repo.ts:27) carries `orderIndex` and `wordCount`. The shared `chapterCreateSchema` / `chapterUpdateSchema` deliberately don't have these. Today `chapters.routes.ts:12` imports the repo's `ChapterUpdateInput`; after migration the route will also want the shared `ChapterUpdateInput`. To eliminate the collision: **rename the repo locals to `RepoChapterCreateInput` and `RepoChapterUpdateInput`** at their declaration sites, and update all in-repo callers. The wire types from shared keep the clean `ChapterCreateInput` / `ChapterUpdateInput` names.

### `backend/src/lib/serialize.ts`

Add two explicit-pick helpers:

```ts
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

Both use explicit pick, not spread. The point is to lock the wire shape: if a stray Prisma column (e.g. `userId`, `body` ciphertext, a future-added column) appears on `RepoChapter`, the serializer's pick deliberately excludes it, and the test below verifies that.

Add a stray-key lock to `backend/tests/lib/serialize.test.ts` (mirrors the Chat / Outline pattern):

```ts
describe('serializeChapter', () => {
  // ...
  it('does not leak stray fields from the repo row', () => {
    const row = {
      // ...valid RepoChapter fields...
      titleCiphertext: Buffer.from('xx'),
    } as unknown as RepoChapter;
    const out = serializeChapter(row);
    expect(out).not.toHaveProperty('titleCiphertext');
  });
});
```

### `backend/src/routes/chapters.routes.ts`

- Import `chapterCreateSchema`, `chapterUpdateSchema`, `chapterReorderSchema`, `chapterResponseSchema`, `chaptersResponseSchema`, `chapterStatusSchema` from `story-editor-shared`.
- Delete the three inline `CreateChapterBody` / `UpdateChapterBody` / `ReorderChaptersBody` consts (lines 31–62 today).
- Delete the inline `ChapterStatus` enum (line 29) — replaced by `chapterStatusSchema`.
- Replace `res.status(...).json({ chapter: serialized })` calls with `respond(chapterResponseSchema, res, { chapter: serializeChapter(row) }, status?)` on POST / PATCH / GET-by-id.
- Replace LIST `res.json({ chapters: ... })` with `respond(chaptersResponseSchema, res, { chapters: rows.map(serializeChapterMeta) })`.
- DELETE stays 204 (no schema).
- PATCH `/reorder` stays 204 — just swap the inline `ReorderChaptersBody` for the shared `chapterReorderSchema`.

`computeWordCount(bodyJson)` (lines 64–68) stays in the route layer. Word count is plaintext and is derived from the TipTap JSON *before* encryption, per the Chapter encryption-at-rest contract — this is unchanged.

## Frontend changes

### `frontend/src/hooks/useChapters.ts`

Delete the local interface declarations (lines 18–45, 68–71, 265–268):

- `ChapterMeta`
- `Chapter` (which currently `extends ChapterMeta`)
- `ChaptersResponse`
- `ChapterResponse`
- `CreateChapterInput`
- `UpdateChapterInput`

Replace with imports from `story-editor-shared`:

```ts
import {
  type Chapter,
  type ChapterCreateInput,
  type ChapterMeta,
  type ChapterUpdateInput,
  chapterResponseSchema,
  chaptersResponseSchema,
} from 'story-editor-shared';
```

Every success path in the hook runs `.parse()`:

```ts
const res = await api<unknown>(`/stories/${storyId}/chapters`);
return chaptersResponseSchema.parse(res).chapters;
```

### Optimistic-cache projection (one site, already inline)

The Chat consolidation had to *synthesise* `messageCount: 0` when projecting a `Chat` into the `ChatSummary[]` LIST cache. Chapter is the mirror image: `Chapter` projects into `ChapterMeta[]` by **dropping** `bodyJson`.

Today there is **one** site that does this: `useUpdateChapterMutation` at `useChapters.ts:342–352`, which already has the destructure inline:

```ts
const { bodyJson: _bodyJson, ...meta } = chapter;
void _bodyJson;
qc.setQueryData<ChapterMeta[] | undefined>(...)
```

That site only needs its `as ChapterMeta` cast (line 348) removed once the types come from shared — the destructure already produces the right shape. **No new optimistic-write paths are added.** `useCreateChapterMutation` only invalidates (no optimistic write); `useReorderChaptersMutation` and `useDeleteChapterMutation` operate on `ChapterMeta[]` directly (no projection needed).

Implementer note: it's tempting to "promote" the inline destructure to a `toChapterMeta()` helper for consistency with the Chat helper pattern, but with only one call site, that's gratuitous abstraction — leave it inline.

## Test fixture audit (the bd-memory gotcha)

The standing memory `when-migrating-an-entity-onto-shared-zod-schemas` says: test fetch-mock *fixtures* must satisfy the strict schemas at runtime, not just type-check. The Story consolidation tripped on `StoryModal.test.tsx` POST/PATCH mocks carrying `chapterCount` / `totalWordCount` keys that the strict `storySchema` rejected at runtime; TS missed it because the mocks were untyped `unknown`.

Files to audit (per the Explore inventory):

**LIST-shape fixtures (must satisfy `chapterMetaSchema`, no `bodyJson`):**
- `frontend/tests/pages/editor-shell.integration.test.tsx`
- `frontend/tests/pages/editor-paper.integration.test.tsx`
- `frontend/tests/pages/editor-ai.integration.test.tsx`
- `frontend/tests/pages/editor-autosave.integration.test.tsx`
- `frontend/tests/pages/character-popover.integration.test.tsx`
- `frontend/tests/pages/chat-panel.integration.test.tsx`
- `frontend/tests/pages/editor.test.tsx`
- `frontend/tests/components/ChapterList.test.tsx`
- `frontend/tests/components/ChapterList.delete.test.tsx`

**Detail-shape fixture (must satisfy `chapterSchema`, with `bodyJson`):**
- `frontend/tests/hooks/useChapter.test.tsx`

Each fixture is checked field-by-field against the strict schema. Any stray key fails `.parse()`. Common pitfalls: stale `userId`, accidental `body` key (the ciphertext column name) instead of `bodyJson`, leftover `chapterCount` from a previous denormalisation.

**Pre-existing oddity to leave alone.** `useChapter.test.tsx:147,155` sends `wordCount: 5` in the PATCH input. `wordCount` is server-derived (computed from `bodyJson` before encryption), and the strict `chapterUpdateSchema` from shared doesn't list it. The test passes today because the fetch mock never round-trips through the backend's `.strict()` Zod validator — it just asserts on the literal payload passed to `fetch`. After migration the same is true: no `.parse()` runs on the request body in this test, so the fixture stays valid. Don't "fix" it — and don't add `wordCount` to `chapterUpdateSchema` to make it valid (that would loosen the wire contract for no reason).

## Verify line (replaces the old short form on `story-editor-ggl`)

The current bd verify on the issue predates the consolidation-canonical form. Replace with the form used on `story-editor-up6` (Chat) and `story-editor-lrd` (Outline). Per the `bd-verify-line-backend-test-needs-stack` memory, `make dev` + Postgres healthcheck wait must precede every backend-test step (vitest globalSetup unconditionally requires the docker-compose stack):

```
npm -w story-editor-shared run typecheck
 && npm -w story-editor-shared test
 && npm -w story-editor-backend run typecheck
 && npm -w story-editor-frontend run typecheck
 && make dev
 && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
 && npm -w story-editor-backend test -- tests/routes/chapters tests/repos/chapter tests/lib/serialize tests/security/encryption-leak
 && npm -w story-editor-frontend test -- tests/hooks/useChapter tests/components/ChapterList tests/pages/editor-paper.integration tests/pages/editor-shell.integration tests/pages/editor-autosave.integration
```

The frontend test bucket is trimmed to representatives — `editor-paper`, `editor-shell`, and `editor-autosave` exercise the LIST-shape fixture path through page integration; `ChapterList` exercises it at the component level (catches `ChapterList.test.tsx` + `ChapterList.delete.test.tsx` + `ChapterList.dragA11y.test.tsx` together); `useChapter` exercises the detail-shape path. The heavier integration tests (`editor-ai`, `character-popover`, `chat-panel`) share fixture shape with the trimmed set, and if their fixtures need updates they will be caught by typecheck / a broader local run.

## Non-goals

- **No functional changes.** Status semantics unchanged. wordCount derivation unchanged. TipTap body shape unchanged. Authorization / ownership / encryption order unchanged.
- **No refactor of the `body` → `bodyJson` JSON.parse location.** It lives in the repo today; it stays there.
- **No UX added for `status`.** The shared `ChapterUpdateInput` permits `status` (and `orderIndex`) because the wire contract does — existing frontend callers (body autosave + title rename) pass strict subsets and remain valid. The `status` field is UI-dead today (Paper.tsx accepts a `status` prop in `SubRowProps` but never renders it; no other frontend code reads it) and remains UI-dead after this PR. Tracked separately as `story-editor-bti`.
- **No `wordCount`-derivation refactor.** This consolidation types the wire field (`z.number().int().nonnegative()`) and threads it through the serializer + frontend `.parse()`, but does **not** touch the three-site derivation duplication (`computeWordCount` in chapters.routes.ts, `countWords` in Editor.tsx, `countWords` in Paper.tsx). Tracked separately as `story-editor-ppn`.
- **No DB schema changes.** No migration needed; columns are unchanged.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Strict schema rejects a fixture that TS happily passed | The audit checklist above lists every fixture file. Implementer reads each one and confirms it parses. |
| `interface RepoChapter` used instead of `type` (Chat consolidation hit this) | Spec explicitly mandates `type` alias. Code-quality-reviewer flagged this in the Chat loop; reviewers will catch a recurrence. |
| Optimistic cache writes write `Chapter` shapes into a `ChapterMeta[]` cache → strict `chapterMetaSchema` rejects on next refetch | One site only (useUpdateChapterMutation), and the destructure is already inline today. Only change is dropping the `as ChapterMeta` cast. |
| Repo-input symbol collision with shared `ChapterCreateInput`/`ChapterUpdateInput` | Repo locals are renamed to `RepoChapterCreateInput`/`RepoChapterUpdateInput` as part of step 2; route imports both sides under non-clashing names. |
| `projectDecrypted<RepoChapter>` typing lie if applied at the projection step (pre-`bodyJson` rename) | Spec mandates typing only `shape()`'s return as `RepoChapter`, not the inner `projectDecrypted` call. `shapeMeta()` is fine to type via projection. |
| Verify line runs backend tests before stack is up | The verify line above is ordered correctly. Implementer must not edit the order. |
| Encrypted-field tuples drift between repo internal const and shared export | The repo imports from shared; there is no internal copy. |

## Sequence (rough — full breakdown comes from `writing-plans`)

1. Write `shared/src/schemas/chapter.ts` + tests + re-exports from `shared/src/index.ts`. Test coverage mirrors prior consolidations: `chapterSchema` retains strictness through `.extend()` of `chapterMetaSchema` (assert rejection of stray keys), `chapterStatusSchema` enum coverage, title length caps, response-envelope strictness, meta-vs-full distinction (full has `bodyJson`, meta does not).
2. Add `RepoChapter` / `RepoChapterMeta` `type` aliases, rename the repo's `ChapterCreateInput`/`ChapterUpdateInput` locals to `RepoChapterCreateInput`/`RepoChapterUpdateInput`, and switch the repo to imported encrypted-field tuples.
3. Add `serializeChapter` / `serializeChapterMeta` to `backend/src/lib/serialize.ts` + stray-key lock test.
4. Migrate `backend/src/routes/chapters.routes.ts` to shared schemas + `respond()` + serializers. Import `ChapterUpdateInput` from shared (the repo's renamed type is also imported where the route hands data to the repo).
5. Migrate `frontend/src/hooks/useChapters.ts` to shared types + runtime `.parse()`. Drop the `as ChapterMeta` cast on the existing inline destructure at the one optimistic-cache-write site.
6. Audit and fix the 10 frontend test fixture files (9 LIST + 1 detail).
7. Run the full verify line.

This is the order; the implementation plan will break each step into tasks with checkpoints.
