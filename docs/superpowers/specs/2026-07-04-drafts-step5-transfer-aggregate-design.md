# Drafts Step 5 — Transfer Round-Trip + Word-Count Aggregate + Chapter Contract (Design)

> Step-delta design note for **story-editor-9wk.5**, refining the epic spec
> `2026-06-25-chapter-drafts-design.md` (§5a step-5 contract, §6 export/import, §10 testing)
> after the 9wk.4 hard cutover landed. User-approved decisions 2026-07-04.

## 1. Context

After 9wk.4, chapter reads are draft-backed and the chapter-mounted body/summary/chat endpoints
are gone. Three step-5 obligations remain:

1. **Export/import round-trips ALL drafts** (today export walks only the active draft's chats;
   non-active drafts and their chats are silently dropped from backups).
2. **`aggregateForStories` still sums the dormant `Chapter.wordCount`** (stale for every
   post-cutover edit; correct only at create time via the deliberate create-time mirror write).
3. **The chapter contract migration**: drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount`
   once their last reader (the aggregate) and last writer (the create-time mirror) are retired.

The §6 prompt-context re-sourcing named in the original 9wk.5 issue landed transitively in 9wk.4
(scope-remove recorded on the bd issue); this step only adds a targeted test.

## 2. Decisions (user-approved, 2026-07-04)

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | **drafts[]-only export shape.** Chapter entry = `{ title, orderIndex, drafts[] }`; chapter-level `bodyJson`/`summary`/`chats` are deleted from the schema. Single source of truth; no duplicate prose; no divergence hazard in hand-edited files. Deviates from the epic spec's literal "gains a drafts[] array" wording — recorded here. | Keep redundant chapter-level `bodyJson`/`summary` as a manuscript-view convenience (import would ignore them = silent bloat + divergence hazard). |
| D2 | **Hard-require `drafts[].min(1)`.** Interim-v2 files (chapter-level body/summary/chats, no `drafts[]` — produced only by this unmerged branch between step 1 and step 5) are rejected at parse. No dual schema, no legacy mint path, no absent-drafts special case in the refine. Consistent with the epic's hard-cutover posture. Pre-epic v1 files were already rejected by the step-1 version bump (epic decision, unchanged here). | Accept both shapes with a fallback mint path — permanent complexity for transient dev files. |
| D3 | **Import mint-as-first-draft (Approach A).** Import keeps calling `chapter.repo.create` (which unconditionally mints the initial draft per the 9wk.3 invariant); the mint IS `drafts[0]`. No repo path can ever produce a draft-less chapter, even transiently. Deviates from the epic spec's literal three-phase text ("create the chapter with `activeDraftId = null`"), which predates the 9wk.3 mint invariant; the three-phase *semantics* (densified order, per-story transaction, pointer set from `isActive`) are preserved. | (B) opt-out `mintInitialDraft: false` flag on `chapter.repo.create` — a standing invariant-violating footgun; (C) bespoke `importChapter` repo method — YAGNI, duplicates the mint transaction. |
| D4 | **No format-version bump.** `EXPORT_FORMAT_VERSION` stays `2` — v2 has never shipped (the epic merges as one release), so the drafts[] shape is final v2. | Bump to 3 for a format no operator ever saw. |

## 3. Wire format (`shared/src/schemas/transfer.ts`)

New `draftExportSchema` (strictObject):

```
label:      z.string().min(1).max(DRAFT_LABEL_MAX).nullable().default(null)
orderIndex: z.number().int().nonnegative()
isActive:   z.boolean()
bodyJson:   z.unknown().optional()
summary:    chapterSummarySchema.nullable().default(null)
chats:      z.array(chatExportSchema).default([])
```

`chapterExportSchema` becomes (strictObject):

```
title:      unchanged
orderIndex: unchanged
drafts:     z.array(draftExportSchema).min(1)
```

with a refine enforcing **exactly one `isActive: true`** across `drafts[]` (zero or multiple
actives reject). The refine lives on the shared schema, so it runs server-side AND in the
frontend's file-pick `safeParse` with no frontend code change. **A refine violation is a
whole-file structural gate:** the import route validates the entire envelope via
`validateBody(importRequestSchema)` before `runImport` starts, so a malformed chapter 400s the
whole file — the per-story transaction isolates *runtime* failures only, not parse failures.
(Corrects the epic spec's "fails just that story" line for the refine case, which predates the
route's whole-body validation; the frontend picker rejects the same file the same way, so a bad
file never reaches the server in normal use.)

Zod-v4 note (verified): `.refine` on a `strictObject` preserves `.shape` access, so the
parity guard's `chapterExportSchema.shape.drafts` derivation composes fine — do not chase the
zod-v3 `ZodEffects` limitation.

`importResultSchema.imported` gains a required `drafts: z.number().int().nonnegative()`.

**Recorded lossiness** (same class as the existing message-`createdAt` re-stamping):
- `wordCount` is not in the file — import recomputes from `bodyJson` via `computeWordCount`
  (existing chapter-import convention).
- Per-draft timestamps are not round-tripped — a summary that was *stale* at export imports as
  *fresh* (the draft write path's same-instant trick stamps it).

Story-level `id` + `snapshotUpdatedAt` emission is unchanged (the #153 conflict-plan fields).

## 4. Export (`backend/src/services/export.service.ts`)

Per chapter:
- `title`/`orderIndex` from the existing `findManyForStory` meta (unchanged).
- `draftRepo.findManyForChapter(chapterId)` supplies full decrypted drafts (body + summary + label).
- `isActive` per draft = `draft.id === meta.activeDraftId`.
- The chats+messages loop moves inside the drafts loop: `chatRepo.findManyForDraft(draft.id)` per
  draft. Non-active drafts' chats now survive export (they are dropped today).
- The `chapterRepo.findById` call is deleted — it only fed the removed chapter-level `bodyJson`.

## 5. Import (`backend/src/services/import.service.ts`, Approach A)

Inside the existing per-story `$transaction`, per chapter:

1. Sort `drafts[]` by `orderIndex`; densify to the loop index (same convention as
   chapters/characters/outline).
2. **Mint = draft 0.** `chapterRepo.create({ storyId, title, orderIndex: i, bodyJson:
   drafts[0].bodyJson, wordCount: computeWordCount(drafts[0].bodyJson) })`. Then, when the file
   carries label and/or summary for draft 0, patch the minted draft in **one combined call**:
   `draftRepo.update(created.activeDraftId, { label, summaryJson })` (the existing
   null-activeDraftId invariant throw stays ahead of this write). One call, not two: a later
   label-only `update()` bumps `@updatedAt` without touching `summaryJsonUpdatedAt`, spuriously
   staling the just-written summary — the same failure class as the `create()` prerequisite fix
   below.
3. **`drafts[1..]`** via `draftRepo.create({ chapterId, bodyJson, wordCount: computeWordCount(…),
   label, summaryJson, orderIndex: <densified> })` — one call each.
   **Prerequisite fix (found in design self-review):** `draft.repo.create` currently stamps
   `summaryJsonUpdatedAt` with its own `new Date()` while Prisma's `@updatedAt` generates a
   separate, marginally later timestamp in the same insert — so a draft *created* with a summary
   can read as spuriously stale (`summaryJsonUpdatedAt < updatedAt` by milliseconds). Port the
   same-instant trick from `update()`: one `now`, written to both `summaryJsonUpdatedAt` and
   `updatedAt` when a summary is present. This step's import path is the first real consumer of
   create-with-summary, so the fix lands here with a regression test.
4. Each draft's `chats[]` (+ messages via `messageRepo.createWithin(tx, …)`) are created under that
   draft — the existing chat/message loop, re-parented from "the minted draft" to "each draft".
5. **Active pointer:** if the `isActive` entry is not draft 0, `draftRepo.setActive(chapterId,
   <its id>)`. (Draft 0 is already active via the mint.)
6. `counts.drafts` increments per created draft, mint included.

`replace` resolution needs no new handling — the story delete cascades chapter→draft→chat as
before.

## 6. Word-count aggregate (`backend/src/repos/chapter.repo.ts`)

`aggregateForStories` drops the `groupBy._sum(Chapter.wordCount)` (dormant column) for one
owner-scoped query + JS reduce:

```
client.chapter.findMany({
  where: { storyId: { in: storyIds }, story: { userId } },
  select: { storyId: true, activeDraft: { select: { wordCount: true } } },
})
```

reduced to the same `Map<storyId, { chapterCount, totalWordCount }>` (count rows per story; sum
`activeDraft.wordCount`). The reduce carries an **explicit** `activeDraft === null` check throwing
the standard invariant-violation error (a bare `.wordCount` access would raise an anonymous
TypeError). Zero-chapter stories behave identically to today: no map entry → the route's existing
`?? 0` defaults (verified against `stories.routes.ts`).
The `stories.test.ts` regression re-points: a chapter with several drafts counts once, at its
**active** draft's word count.

## 7. Chapter contract migration + create-time mirror removal

Ordering inside the step: the aggregate rewrite (§6) retires the last reader, then:

- `chapter.repo.create` stops writing the body ciphertext triple + `wordCount` onto the Chapter
  row (the 9wk.4 handoff note). `RepoChapterCreateInput` keeps `bodyJson`/`wordCount` — they feed
  the draft mint, now their only destination.
- Schema edit + `prisma migrate dev`: **drop `Chapter.bodyCiphertext`, `bodyIv`, `bodyAuthTag`,
  `summaryJsonCiphertext`, `summaryJsonIv`, `summaryJsonAuthTag`, `summaryJsonUpdatedAt`,
  `wordCount`.** No backfill: since the 9wk.4 re-sync migration + cutover, no data exists only on
  these columns. Dev-only scaffolding migration, squashed in step 9 with the others. Never edit
  shipped migration files. Prisma client regen + dev-container restart ritual applies.
- **E12 leak test:** Chapter sentinel coverage narrows to `title` (the dropped columns can no
  longer leak); Draft keeps full body/summary/label sentinel coverage from 9wk.4. Re-check the
  count>0 guards so the test still fails loud on empty coverage.

## 8. Prompt context — test only

The previous-chapters block already sources active-draft summaries transitively (9wk.4 metadata
join). This step adds one targeted test: a summary present only on a **non-active** draft must not
appear in the `<previous_chapters>` prompt context.

## 9. Testing

- **shared:** `drafts.min(1)`; refine rejects zero-active and two-active; a draftless interim-v2
  chapter entry rejects; `imported.drafts` required.
- **transfer.test.ts:** multi-draft round-trip (bodies, labels, summaries, non-active drafts'
  chats survive); `isActive` → `activeDraftId` restore; densification from a gappy/hand-edited
  file; `imported.drafts` count; a file containing a zero-active or two-active chapter is
  rejected **whole-file at 400** (`validation_error`) with nothing imported (see §3 — the refine
  is a parse-time gate, not a per-story runtime failure).
- **backup-roundtrip.test.ts parity guard:** `draftExportSchema` layer derived from
  `chapterExportSchema.shape.drafts`; drafts allowlist + nested-chats allowlist; `imported`
  deep-equal extended with `drafts`.
- **stories.test.ts:** aggregate regression per §6.
- **E12** per §7. **Prompt** per §8.
- **Frontend:** compile/test fixes only — no component changes (`SettingsDataTab` renders
  per-story `outcomes`, not `imported.*` counts — verified; the refine reaches the file picker
  via the shared schema). Budget honestly for the fixture churn though: every fixture that
  constructs an export file or an `ImportResult` needs `drafts[]` / the `drafts` count —
  `SettingsDataTab.test.tsx`, the `useBackup` mocks, and `shared`'s `transfer.test.ts`, whose
  `minimal` fixture still carries chapter-level `bodyJson`/`summary`/`chats` and must be
  **rewritten** (it now fails parse under D1/D2), not merely extended.

## 10. Out of scope

- Step-9 consolidated-migration squash (§5b of the epic spec).
- All frontend draft UX (9wk.6: selectedDraft state, autosave re-seed, chat re-keying, sidebar).
- Any change to `aggregateForStories`'s wire shape (story list keeps `chapterCount`/`totalWordCount`).

Close-gate reviewers in-lane: **security-reviewer** (import/export surface) and
**repo-boundary-reviewer** (repo reads, migration on narrative columns).
