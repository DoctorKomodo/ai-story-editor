# Drafts Step 4 — Draft Routes + Hard Cutover Design

> Step-level design delta for **story-editor-9wk.4**, refining the epic spec
> `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` (§6, §7, §11 step 4).
> Written 2026-07-04, after step 3 (chat ownership re-point) closed.
> **Decided during brainstorm:** transition strategy = **hard cutover** (user choice, option B):
> the chapter-mounted body/summary/chat endpoints are deleted in this step; the frontend
> catches up in step 6. Between steps 4 and 6 the running app's saves and chat-creates 404
> on the feature branch. Typecheck and all test suites stay green at every commit.

## Context: why the cutover needs one extra design piece

Since step 3, only chapter-**create** mints/writes a draft. Every body PATCH updates
`Chapter.body*` only — **drafts are already stale** for any chapter edited since its
create/backfill. With a hard cutover and no mirror, anything still *reading* Chapter columns
(export, prompt context, chapter GET) would serve frozen data between steps 4 and 5.
Section 3 below resolves this by re-pointing the **reads** at the repo layer in this step.

## 1. Draft repo grows to full surface (`backend/src/repos/draft.repo.ts`)

Today: `create` / `findById` / `findManyForChapter` only. It gains:

- **`update`** — body, label, summary. Preserves the same-instant summary trick
  (summary write sets `summaryJsonUpdatedAt` equal to the row's `updatedAt` so a fresh
  summary isn't instantly stale). Carries the optimistic-concurrency guard from the
  chapter PATCH: `expectedUpdatedAt` checked against `Draft.updatedAt`, throwing
  `DraftVersionConflictError` (renamed port of `ChapterVersionConflictError`).
- **`remove`** — one transaction: 409 if the draft is active, 409 if it's the chapter's
  last draft, then delete + gap-free `orderIndex` reindex using the existing two-phase
  negative-parking pattern from chapter reorder.
- **`setActive`** — owner-scoped `Chapter.activeDraftId` pointer swap.
- **List metadata** — `findManyForChapter` returns decrypted `label`, `wordCount`,
  `orderIndex`, `isActive`, and a summary-stale flag (`summaryJsonUpdatedAt < updatedAt`).
- **Fork/blank create** — fork decrypts the source (active) draft's body, **recomputes
  `wordCount` from that plaintext** (never copied), re-encrypts into the new draft,
  summary NULL, **no chats copied**; blank = empty body, wordCount 0. Both take the next
  `orderIndex`.

## 2. Routes — the hard cutover

**Added:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chapters/:chapterId/drafts` | GET | List drafts (metadata incl. `isActive`, stale flag) |
| `/api/chapters/:chapterId/drafts` | POST | Create: `{ mode: 'fork' \| 'blank', label? }` |
| `/api/chapters/:chapterId/drafts/:draftId` | PATCH | Rename (`label`; null/empty clears to positional) |
| `/api/chapters/:chapterId/drafts/:draftId` | DELETE | Delete (409 on active / last; reindex survivors) |
| `/api/chapters/:chapterId/active-draft` | PUT | Set active draft (`{ draftId }`) |
| draft-scoped body GET/PATCH | | Editor body load/save targets `:draftId` |
| draft-scoped summary PUT + summarise POST | | Summary ops target `:draftId` |
| `/api/drafts/:draftId/chats` | GET/POST | Chats re-mount under the draft |

**Removed:** chapter-mounted body PATCH, summary PUT, summarise POST, and the
`/api/chapters/:chapterId/chats` mount.

**Error idiom:** new `conflict()` helper in `backend/src/lib/http-errors.ts` for the 409
guards; the hand-rolled `ChapterVersionConflictError` catch in `chapters.routes.ts` folds
into the central error-handler `instanceof` table.

## 3. Chapter reads become draft-backed (the anti-staleness piece)

- `chapter.repo.findById` sources `bodyJson`/`summaryJson` from the **active draft**
  (the epic spec's own semantic: "the active draft *is* the chapter downstream").
- `findManyForStory` joins the active draft for `wordCount` + summary-staleness, and adds
  `draftCount` + `activeDraftId` to the chapter-meta wire shape (steps 6/7 need both).
- Consequence: **export, prompt context, and chapter GET are correct and fresh from step 4
  on — no staleness window** — and `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount`
  become fully dormant (never read, never written), awaiting step 5's contract drop.
- A step-4 **scaffolding migration re-syncs stale active drafts** first: verbatim ciphertext
  copy from the chapter row onto its active draft where the chapter row is newer
  (decrypt-free, idempotent, dev-DBs only, squashed away in step 9).

**Scope note:** this pulls the §6 metadata join forward from step 5's plan slot. Step 5
keeps `aggregateForStories`, the export `drafts[]` round-trip, and the column-drop
contract migration.

## 4. Cleanups (pre-approved scope-adds in the bd notes) + testing

- Hoist `resolveUserId`, `ensureChapterOwned`, and the body/summary decode blocks into
  `backend/src/repos/_narrative.ts` (currently duplicated across ~7 repos).
- New `shared/src/schemas/draft.ts`: draft wire schema + `DRAFT_ENCRYPTED_FIELD_KEYS`
  moved from the backend.
- **Tests:** new `backend/tests/routes/drafts.test.ts` (fork copies body + recomputed
  wordCount + no chats; blank; rename; delete guards 409 active/last + survivor reindex;
  set-active; list shape with no ciphertext egress); `chapters.concurrency.test.ts` ports
  to the draft body PATCH (matching / stale / no-precondition / deleted-mid-flight /
  no-ciphertext-egress); chat route tests re-mount; frontend gets compile/test fixes only.
- **Close gate:** `repo-boundary-reviewer` (new repo surface + narrative migration) and
  `security-reviewer` (new draft-mount ownership surface) both in-lane.

## Out of scope (unchanged from the epic spec)

- Step 5: `aggregateForStories` rewrite, export/import `drafts[]` round-trip,
  `Chapter.body*` column-drop contract migration.
- Step 6: frontend `selectedDraft` state, autosave-baseline re-seed, IndexedDB re-key,
  chat query re-keying, switching the frontend to the new endpoints.
- Step 7: sidebar draft tree + new-draft dialog.
