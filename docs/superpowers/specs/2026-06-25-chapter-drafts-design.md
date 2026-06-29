# Chapter Drafts — Design Spec

**Date:** 2026-06-25
**Status:** Draft (awaiting review)
**Topic:** Multiple drafts per chapter, each with its own chat/scene history

---

## 1. Overview

Today a **Chapter** owns exactly one body (TipTap JSON), one summary, one word count, and a
flat set of **Chats** (`kind: 'ask' | 'scene'`). There is no way to keep more than one version
of a chapter.

This feature lets a writer keep **multiple competing drafts of a chapter** — try two or three
directions, each with its own prose *and* its own AI conversation history, then **pick one as the
active version**. The non-chosen drafts stay around (nothing is destroyed) until the user deletes
them.

### Goals
- Each chapter can hold N drafts; each draft has its own body, summary, word count, and its own
  Ask/Scene chat history.
- One draft per chapter is flagged **active** — the version used for export, AI prompt context
  (previous-chapter inclusion), and the chapter's headline word count.
- Switching, creating, naming, and deleting drafts is driven from the **left sidebar tree**.
- Single-draft chapters look exactly like today (progressive disclosure).

### Non-goals (out of scope)
- Diffing or merging drafts.
- Per-draft maturity status (see §4 — `Chapter.status` is being removed, not extended).
- Copying chat history when forking (fork copies prose only — see §3).
- Side-by-side draft comparison.

---

## 2. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Core purpose | **Try alternatives, pick one.** Competing versions; one eventually wins. |
| New draft origin | **Both** — a create dialog offers "fork current draft" or "start blank". |
| Forking chats | **Copy body, fresh chats.** Fork duplicates prose only; new draft starts with empty Ask/Scene history. |
| Picking a winner | **Keep the others, just mark active.** Non-destructive; losers persist, deletable later. |
| UI placement | **Sidebar tree only** (no editor-header tab strip — it fought the existing top bar). |
| Single-draft chrome | **Subtle affordance** — single-draft chapters stay clean; a hover "＋ new draft" link makes the feature discoverable without permanent chrome. |
| Draft edition label | **Reuse the existing `draftLabel` sub-row slot** in `Paper.tsx` (currently a dummy `'Draft 1'`), now bound to the viewed draft. |
| `Chapter.status` | **Remove it** — dormant/half-wired; no UI ever sets it. |

---

## 3. Data model

### New entity: `Draft`
A narrative entity. It goes through a new `draft.repo.ts` with encrypt-on-write / decrypt-on-read,
and is added to the E12 leak-test sentinel coverage.

| Field | Type / notes |
|---|---|
| `id` | PK (cuid) |
| `chapterId` | FK → `Chapter`, `onDelete: Cascade` |
| `bodyCiphertext` / `bodyIv` / `bodyAuthTag` | prose (TipTap JSON) — **moved off Chapter** |
| `summaryJsonCiphertext` / `summaryJsonIv` / `summaryJsonAuthTag` | per-draft summary — **moved off Chapter** |
| `summaryJsonUpdatedAt` | `DateTime?` — staleness tracking — **moved off Chapter** |
| `wordCount` | `Int` plaintext, computed from body before encryption — **moved off Chapter** |
| `labelCiphertext` / `labelIv` / `labelAuthTag` | **nullable.** Custom name ("darker take"). `null` ⇒ frontend renders positional "Draft A/B/C". Encrypted because a label can leak plot. |
| `orderIndex` | `Int`; `@@unique([chapterId, orderIndex])` — drives positional naming + tree order |
| `createdAt` / `updatedAt` | standard |

Indexes: `@@index([chapterId])` + the unique `[chapterId, orderIndex]`.

### Changed: `Chapter`
- **Keeps:** `titleCiphertext/Iv/AuthTag` (the title names the chapter, shared across drafts),
  `orderIndex`, `storyId`, timestamps.
- **Loses:** `bodyCiphertext/Iv/AuthTag`, `summaryJsonCiphertext/Iv/AuthTag`,
  `summaryJsonUpdatedAt`, `wordCount` (relocated to `Draft`), **and `status`** (§4).
- **Gains:** `activeDraftId` → `Draft`. Nullable at the DB level (breaks the create-time
  chicken-and-egg), but **enforced non-null in application logic** — every chapter always resolves
  to exactly one active draft.

Two-way relation, named to disambiguate in Prisma:
- On `Chapter`: `activeDraft Draft? @relation("ActiveDraft", fields: [activeDraftId], references: [id], onDelete: SetNull)`
- On `Draft`: `chapter Chapter @relation("ChapterDrafts", fields: [chapterId], references: [id], onDelete: Cascade)`

(`onDelete: SetNull` on the active-pointer side is a safety net; application logic forbids deleting
the active draft outright — see §7.)

### Changed: `Chat`
- `chapterId` → **`draftId`** → `Draft`, `onDelete: Cascade`.
- Indexes re-point: `[draftId]`, `[draftId, kind]`, `[draftId, lastActivityAt]`.
- **`Message` unchanged** at the column level (still `chatId`-scoped) — but see the ownership-chain
  rewrite below, which touches `message.repo.ts`.

> **Ownership-chain rewrite (large, easy to miss — authz boundary).** Ownership of chats and
> messages is verified today via nested `where` clauses: `chat.chapter.story.userId` and
> `message.chat.chapter.story.userId`. After the re-point these become
> `chat.draft.chapter.story.userId` and `message.chat.draft.chapter.story.userId`. **Every** such
> clause must be rewritten:
> - `chat.repo.ts` — `ensureChapterOwned` + all `chapter: { story: { userId } }` filters.
> - `message.repo.ts` — all `chat: { chapter: {...} }` → `chat: { draft: { chapter: {...} } }`.
> - `ownership.middleware.ts` — the `chat` and `message` cases.
> This is an **authz change**, so `security-reviewer` is in-lane (corrects §9).

> **Chat wire-contract change.** `RepoChat`, `serializeChat`, the shared `chat` Zod schema, and
> `ChatCreateInput` all currently carry **`chapterId`**. Re-pointing changes the API response and
> create payload to **`draftId`**. Update the repo type, serializer, shared schema, and the
> create-input — and the Storybook fixtures that pass `chapterId` (`ChatTab.stories.tsx`,
> `SceneTab.stories.tsx`). Message keys stay chat-scoped and are unaffected.

### Resulting shape
```
Story
 └─ Chapter            (title, orderIndex, activeDraftId ──┐)
     └─ Draft          (body, summary, wordCount, label) ◀─┘ active pointer
         └─ Chat       (kind: ask | scene)
             └─ Message
```

---

## 4. Removing `Chapter.status`

`Chapter.status` (`@default("draft")`, enum `draft|revision|final`) is **dormant**: the backend
PATCH accepts it, but no frontend control ever writes `revision`/`final`, and the sub-row status
chip is fed a separate `storyStatus` path. It is a half-built feature, not a live one. Removing it:

- **shared:** delete `chapterStatusSchema` + `ChapterStatus`; remove `status` from the chapter
  base/create/update schemas and the `index.ts` re-exports.
- **backend:** remove `status` from `chapter.repo.ts` input/row types and the create/update route
  mapping in `chapters.routes.ts`.
- **frontend:** remove hardcoded `status: 'draft'` fixtures (`ChapterList.stories.tsx` — 6 fixtures,
  `ChapterSummaryPopover.stories.tsx`, and any backend test asserting `status` in a chapter response —
  grep `status:` across `*.stories.tsx` + route tests **and `backup.test.ts`** first). The live
  sub-row chip uses `storyStatus`, untouched.
- **migration:** `ALTER TABLE "Chapter" DROP COLUMN "status"` (folded into the drafts migration).
- **export/import compat (decided): accept the break, and bump the format version.**
  `chapterExportSchema` (`transfer.ts`) is a `z.strictObject` that currently *requires* `status`. The
  `status` field is removed outright. Because `importSchema === exportSchema` and removing a required
  field is a breaking format change, **bump `EXPORT_FORMAT_VERSION` 1 → 2** so importing an old
  backup fails with a clear "unsupported format version" rather than a confusing strict-validation
  error. No tolerate-and-ignore shim is added. (See §6 for the separate export-content change — the
  chapter export body/summary now come from the active draft.)

`OutlineItem.status` is a *different*, live field — **not touched.**

---

## 5. Migration (breaking, on populated data — but decrypt-free)

The net schema change is one logical migration written as explicit ordered DDL to avoid the
non-null/circular-FK trap (you cannot add a non-null FK to a populated table without a backfill
window). Its full ordered sequence is:

1. **Create the `Draft` table** (all columns), plus `Chapter.activeDraftId` as **nullable**, and add
   `Chat.draftId` as **nullable**.
2. **Backfill drafts:** for each existing chapter, `INSERT` one `Draft` with the chapter's ciphertext
   triples + `wordCount` + summary fields **copied verbatim** (byte-for-byte — same user, same DEK,
   **no decryption**), `orderIndex = 0`, `label = NULL`.
3. **Backfill the active pointer:** `UPDATE "Chapter" SET "activeDraftId" = <its new draft>`.
4. **Backfill chats:** `UPDATE "Chat" SET "draftId" = <the chapter's new draft>` via join on the old
   `Chat.chapterId`.
5. **Tighten:** make `Chat.draftId` **non-null**, add its FK (`onDelete: Cascade`) + new indexes,
   then **drop `Chat.chapterId`** and its old indexes. Add the `Chapter.activeDraftId` FK
   (`onDelete: SetNull`).
6. **Drop** the moved columns (`body*`, `summaryJson*`, `summaryJsonUpdatedAt`, `wordCount`) **and
   `status`** from `Chapter`.

`Chapter.activeDraftId` stays nullable at the DB level (breaks the create-time cycle); the
"exactly one active draft" invariant is enforced in application logic, not by a DB NOT NULL.

The verbatim ciphertext copy (step 2) and the chat backfill (step 4) are **hand-written raw SQL**
inside the migration (`INSERT … SELECT` / `UPDATE … FROM`), not output of `prisma migrate diff` —
the generated diff covers the schema-shape changes; the data backfill is added by hand.

### 5a. Delivery: expand-contract across dev steps, squashed to one migration before merge

The build order (§11) splits this into independently-reviewable bd steps, and **each step ends at
`/bd-close-reviewed`, which runs the full typecheck + test suite.** A step therefore cannot drop a
column whose readers are retired in a *later* step, or its own suite would fail. So the sequence
above is delivered **expand-first, contract-last**, with the destructive drops landing in the step
that retires the last reader:

- **Step 2 (9wk.2) — expand:** sub-steps 1–4 above (create `Draft`, backfill drafts + active pointer
  + chat `draftId`) **plus `DROP COLUMN Chapter.status`** (safe — step 1 already removed every
  reader). Keeps `Chat.chapterId` (still read by the ownership chains until step 3) and keeps
  `Chapter.body*/summary*/wordCount` (still read until steps 4–5). **The backfill `INSERT…SELECT`
  logic is validated here**, while the old columns still exist: a test seeds a draftless chapter
  (raw Prisma) and runs the same backfill SQL, asserting one draft with byte-identical ciphertext +
  `wordCount` + `activeDraftId` set + chat re-pointed. This is the correctness gate for the
  data-moving SQL.
- **Step 3 (9wk.3) — contract (chat):** after the ownership chains are rewritten and chat-create
  writes `draftId`, make `Chat.draftId` non-null, add its FK, and **drop `Chat.chapterId`** + old
  indexes.
- **Step 5 (9wk.5) — contract (chapter):** after prompt/export/import/aggregates source from the
  active draft, **drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount`**.

Until the step-5 contract, body/summary/wordCount live in **both** `Chapter` and `Draft`. This
duplication never reaches an operator (see 5b) — it exists only inside the feature branch during
dev.

### 5b. The migration that ships on `main` is a single squashed migration

No operator ever deploys an in-between 9wk version; the schema change only becomes real when the
whole epic merges to `main`. So **before the epic merges, a consolidation task replaces the per-step
scaffolding migrations with one clean migration** (pre-9wk → post-9wk) carrying the full ordered
sequence 1–6 above. That single migration is validated by:

- a **`prisma migrate diff`** check proving the squashed migration reaches a schema **identical** to
  the staged per-step migrations (empty diff), and
- a **baseline-fixture harness:** a committed **schema-only** `pre-9wk` baseline (`pg_dump
  --schema-only` of a DB with only the pre-9wk migrations applied — regenerable from git, no
  production data) is loaded into a scratch schema, seeded with representative encrypted
  chapters/chats, then the consolidated migration is applied and the full transform asserted (drafts
  created, ciphertext byte-identical, pointers set, chats re-pointed, old columns gone, no orphans).

The backfill *logic* is already proven in step 2 (above); the consolidation only re-proves it on
populated pre-9wk data end-to-end, since after the drops it can no longer be seeded via the normal
`db:test:reset` path.

### 5c. Operator upgrade (one-shot, automatic)

The backend container entrypoint (`backend/docker-entrypoint.sh`) runs `prisma migrate deploy` on
every boot, so on `docker compose pull && up -d` the consolidated migration applies automatically
and atomically against the operator's populated `pgdata` — one shot, no manual step
(`SELF_HOSTING.md` already documents this expand-then-contract norm). **Rollback strategy:
restore-from-backup**, not a down-migration — consistent with house style (no down-migrations); the
`scripts/backup-db.sh` pg_dump path already covers the new `Draft` table table-agnostically. Because
the consolidated migration drops columns on real data, **the post-9wk release notes must flag it as
destructive** so operators take a `scripts/backup-db.sh` snapshot first (per `SELF_HOSTING.md`).

Properties:
- **No DEK at migration time** — encrypted bytes are relocated, never decrypted.
- **Existing data preserved exactly** — every chapter ends with one draft holding its current
  content and chats. Users see no change until they create a second draft.
- **E12 leak test extended to cover `Draft`** in step 2, before any `Draft` ciphertext exists in a
  shipped build (gate per CLAUDE.md testing rules).

> Per CLAUDE.md "When to Stop and Ask", this is a breaking data-model change (column drops + a new
> encrypted narrative column + re-pointed FK). It must be planned and reviewed with the user — this
> spec is that plan; the migration SQL is written and reviewed before it runs against real data.

---

## 6. Backend API

### New: draft routes
Mounted under the chapter; mirror the existing chapter/chat router patterns.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chapters/:chapterId/drafts` | GET | List drafts (metadata: `id`, `label`, `wordCount`, `orderIndex`, `isActive`, summary-stale flag). Ordered by `orderIndex`. |
| `/api/chapters/:chapterId/drafts` | POST | Create draft. Body `{ mode: 'fork' \| 'blank', label?: string }`. **fork** = repo-read the active draft body (decrypt) → create new draft with same plaintext (re-encrypt), **wordCount recomputed from the forked plaintext** (not copied — matches the wordCount-from-plaintext rule), summary `NULL`; **no chats copied**. **blank** = empty body, wordCount 0. New draft gets the next `orderIndex`. |
| `/api/chapters/:chapterId/drafts/:draftId` | PATCH | Rename (`label`) — `null`/empty clears back to positional. |
| `/api/chapters/:chapterId/drafts/:draftId` | DELETE | Delete a draft. **Refused** if it's the active draft or the chapter's last draft (see §7). |
| `/api/chapters/:chapterId/active-draft` | PUT | Set `Chapter.activeDraftId = { draftId }` ("pick the winner"). |

All draft reads/writes go through `draft.repo.ts` (encrypt/decrypt symmetry; no controller touches
Prisma for `Draft` directly — enforced by `repo-boundary-reviewer`).

### Moved: chapter body + summary endpoints → draft-scoped
The chapter body lives on the draft now, so the body GET/PATCH and the summary/summarise endpoints
operate on a **draft**, not the chapter:

- Body load/save: target `:draftId` (the editor loads/saves whichever draft is being viewed).
- `summary` (PUT) + `summarise` (POST): target `:draftId`.

`chapters.routes.ts` `GET (list)` (`findManyForStory` / `RepoChapterMeta` / `chapterMetaSchema`)
today reads only `Chapter` columns. It must now **join each chapter's active draft** to source
`wordCount`, `summary`, and the summary-stale flag from the active draft, plus add `draftCount`, so
the sidebar renders without an extra round-trip. This is a query change inside the existing
metadata read, not just a field rename. `chapterMetaSchema.wordCount` keeps its meaning ("the
chapter's word count") but is now sourced from the **active draft** — so the frontend story-total
reduce over `chapter.wordCount` (`EditorPage.tsx` `storyWordCount`) keeps working unchanged.

**Story-level word-count aggregate (`aggregateForStories`).** `chapter.repo.ts`'s
`aggregateForStories` computes per-story `totalWordCount` via `groupBy(['storyId'])` with
`_sum: { wordCount: true }` over `Chapter`, feeding `GET /api/stories`. Prisma `groupBy` **cannot
traverse a relation**, so once `wordCount` lives on `Draft` this must be rewritten as a filtered
aggregate over **active** `Draft` rows (the draft whose id equals its chapter's `activeDraftId`) —
e.g. a raw query or a `findMany` of active drafts reduced per story. Its existing regression test
must be updated.

### Re-scoped: chat routes
Chats nest under a draft: `/api/drafts/:draftId/chats` (create/list) replaces the
`/api/chapters/:chapterId/chats` mount. The `/api/chats/:id` CRUD and `/api/chats/:chatId/messages`
routers are **unchanged** (already chat-scoped).

### Previous-chapter summaries (prompt context)
Unchanged in mechanism; **only the summary source moves to the active draft.** For chapter N, the
prompt includes every prior chapter (`orderIndex < N`) whose **active draft** has a non-null summary,
rendered as the existing `<previous_chapters>` block (`events`/`state_at_end`/`open_threads`),
oldest-truncated under the token budget. Specifics:

- Each chapter feeds exactly **one** summary forward — its **active draft's**. Non-active drafts never
  enter prompt context (the active draft *is* "the chapter" downstream).
- `title` + `orderIndex` still come from `Chapter`; only `summary`/`wordCount` resolve through the
  active draft (the §6 metadata join in `findManyForStory(..., { includeSummary: true })`, consumed by
  `chat.routes.ts` + `ai.routes.ts`).
- The `summary !== null` filter is unchanged — a chapter whose active draft is unsummarised is simply
  skipped (as an unsummarised chapter is today).
- The draft you're *viewing* is irrelevant to prior-chapter context; "chapter so far" is the viewed
  draft's body, previous chapters are always their active drafts.
- Summarising targets the *viewed* draft and updates that draft's summary; it only begins feeding the
  next chapter's prompt once that draft is active. Staleness is per-draft
  (`Draft.summaryJsonUpdatedAt` vs `Draft.updatedAt`).

### Export reads the active draft for the manuscript, plus all drafts for round-trip
- `export.service.ts` renders the **active draft** body + summary per chapter for the manuscript view
  (today it reads `meta.summary` / `full.bodyJson` / `meta.status`; `status` is gone, body/summary come
  from the active draft).
- **Export scope (decided): round-trip ALL drafts.** `chapterExportSchema` gains a `drafts[]` array;
  each entry carries `{ label, orderIndex, isActive, bodyJson, summary, chats[] }`. The per-chapter
  `chats[]` moves **under** its draft (chats are draft-scoped now). This preserves "nothing is
  destroyed" (§1) across an export/import round-trip — non-active drafts and their chat history
  survive. (This is the schema change driving the `EXPORT_FORMAT_VERSION` 1→2 bump in §4.)
  `importResultSchema` gains a `drafts` count alongside the existing chats/messages counts.
- **Import is a three-phase per-chapter write** (the whole import already runs in one `$transaction`):
  1. create the chapter with `activeDraftId = null`;
  2. create its drafts **in `orderIndex` order** via `draft.repo` — and **re-densify `drafts[].orderIndex`
     from the loop index** (the same convention import already uses for chapter/character/outline order),
     so a hand-edited file can't violate `@@unique([chapterId, orderIndex])`;
  3. `update` the chapter to point `activeDraftId` at the draft whose `isActive === true`.
- **Exactly-one-active integrity.** Zod can't express "exactly one `isActive` per chapter" structurally
  — add a `.refine` on `chapterExportSchema` (exactly one `isActive: true` in `drafts[]`) so a malformed
  file can't import a chapter with zero/ambiguous active drafts (which would break the app invariant).

---

## 7. Behavior & edge cases

- **Viewing ≠ activating.** Opening/editing any draft saves to *that* draft. `activeDraftId` only
  changes via the explicit "Set as active" action. This is the core of "try alternatives, pick one."
- **Cannot delete the active draft.** The user must set another draft active first. (UI hides/disables
  delete on the active row; API returns 409.) The 409 guard, the delete, and the orderIndex reindex
  run **in one transaction** so the "exactly one active draft" invariant can't be raced. (The
  `onDelete: SetNull` on `activeDraftId` is only a DB-level safety net; it is never the intended path
  — a draft going NULL-active would be a bug.)
- **Cannot delete the last draft.** A chapter always has ≥1 draft. (Deleting the chapter is the way to
  remove the last one — existing chapter delete cascades drafts.)
- **OrderIndex reindex on delete.** Drafts use `@@unique([chapterId, orderIndex])`, so deletes reindex
  the survivors to stay gap-free, reusing the existing two-phase negative-parking pattern from
  `chapter.repo.ts` (chapter reorder).
- **Positional labels renumber on delete (decided).** `label = null` ⇒ frontend shows "Draft A/B/C…"
  = the draft's position in the orderIndex-sorted list. After deleting "Draft B" of A/B/C, the old C
  becomes B (it renumbers — accepted). Users who want a stable name use a **custom label** (the escape
  hatch). New blank/fork drafts default to `null` (next position's letter) unless named in the dialog.
- **Summary staleness re-based on Draft timestamps.** Today staleness = `summaryJsonUpdatedAt <
  chapter.updatedAt`. Body edits now bump `Draft.updatedAt`, so staleness moves to
  `Draft.summaryJsonUpdatedAt < Draft.updatedAt`. The summary PUT + summarise endpoints target the
  draft. **Preserve the existing same-instant trick:** a summary write currently sets
  `summaryJsonUpdatedAt` to the same instant as the row's `updatedAt` so a fresh summary isn't
  reported instantly stale — the draft write path must keep that behavior.
- **Fork copies prose only** — new draft starts with empty Ask/Scene history.
- **Active draft drives chapter headline** — the sidebar chapter row shows the **active** draft's word
  count; the editor sub-row shows the **currently-viewed** draft's word count.

---

## 8. Frontend

### State
- `activeChapter` store — unchanged (which chapter is open).
- **New `selectedDraft` state** (per chapter, ephemeral/UI-only) — which draft is being *viewed* in
  the editor. Defaults to the chapter's `activeDraftId`; resets on chapter switch. Distinct from the
  persisted `activeDraftId`.
- **Autosave baseline must reset on `selectedDraft`, not just `activeChapterId`.** Today the editor
  seeds its autosave baseline once per active-chapter switch (`EditorPage.tsx`). With drafts, the
  baseline must re-seed whenever the **viewed draft** changes; otherwise switching from Draft A to
  Draft B can flush A's buffered edits into B — a data-corruption-class bug. This is the single
  highest-risk frontend change.
- Chat hooks/query keys re-key from `chapterId` to `draftId` (`['draft', draftId, 'chats', kind]`,
  and the create/invalidate sites in `useChat.ts`). **Message keys stay chat-scoped**
  (`['chat', chatId, 'messages']`) and do not change. The `chatDraft` optimistic-UI store keys on
  `chatId` and is expected to be unaffected (confirm during implementation, don't churn it).

### Sidebar tree (`ChapterList.tsx`)
- Chapters with `draftCount > 1`: expandable; render draft child rows (active green dot, label, word
  count). Clicking a draft sets `selectedDraft`.
- Chapters with `draftCount === 1`: clean; a **subtle hover affordance** ("＋ new draft") opens the
  create dialog. No caret, no child rows.
- Draft row **hover actions**: ★ set active, ✎ rename, 🗑 delete (delete hidden/disabled on the active
  row). "＋ New draft…" child row opens the dialog.

### Editor (`Paper.tsx`)
- Bind the existing `draftLabel` sub-row slot (currently the dummy `'Draft 1'`) to the
  viewed draft's label. **No other top-bar change.**
- Editor body loads/saves the `selectedDraft`.

### New-draft dialog
- Radio: **fork current draft** (default) vs **start blank**; optional name field (blank ⇒ auto
  "Draft D"). Confirms → POST create → select the new draft.

### Chat panel
- Scoped to `selectedDraft` (Ask/Scene history follows the viewed draft).

---

## 9. Encryption / repo-boundary

- `Draft` is a narrative entity: new `draft.repo.ts` with `writeEncrypted` / `projectDecrypted`
  symmetry; `wordCount` computed from plaintext before encryption.
- No `*Ciphertext/*Iv/*AuthTag` field appears in any response body.
- `Draft` (body, summary, label) added to the **E12 leak-test sentinel** before merge.
- `repo-boundary-reviewer` is in-lane (new repo + narrative columns + migration).
- **`security-reviewer` IS in-lane** — the `Chat`→`Draft` re-point rewrites the chat/message
  **ownership chains** in `chat.repo.ts`, `message.repo.ts`, and `ownership.middleware.ts`, which is
  an authz boundary. (Corrects the earlier assumption that it wasn't needed.)

---

## 10. Testing

- **Migration:** verify each pre-existing chapter yields one draft with identical decrypted body +
  word count + summary, chats re-pointed, `activeDraftId` set.
- **Repo:** encrypt/decrypt round-trip for body/summary/label; positional-label derivation.
- **Routes:** create (fork copies body + recomputes wordCount, no chats; blank empty), set-active,
  rename, delete guards (409 on active / last draft) + survivor reindex, list shape (no ciphertext
  egress).
- **Ownership/authz:** a user cannot read/mutate another user's chats or messages through the new
  `chat.draft.chapter.story.userId` chain (regression test on `ownership.middleware.ts` +
  repo filters — this is the security-reviewer's lane).
- **E12 leak test:** extended to `Draft`.
- **Frontend:** sidebar expand/collapse + subtle affordance; draft switch swaps body + chat; new-draft
  dialog; sub-row label binding. **Autosave: switching A→B with unsaved edits in A must not write A's
  buffer into B** (baseline re-seed regression).
- **Prompt:** previous-chapter context pulls each prior chapter's **active draft** summary; viewing a
  non-active draft of the current chapter doesn't change prior-chapter context; unsummarised active
  draft is skipped.
- **Export/import round-trip:** all drafts survive (bodies, summaries, per-draft chats), the `isActive`
  draft is restored as `activeDraftId`, and the manuscript view renders the active draft;
  `EXPORT_FORMAT_VERSION` 2 rejects v1 backups cleanly; a malformed file with zero/multiple `isActive`
  drafts is rejected by the `.refine`; `drafts[].orderIndex` re-densifies on import.
- **Story word-count aggregate:** `aggregateForStories` totals only active-draft word counts; update its
  existing regression test to the new active-draft sourcing.

---

## 11. Suggested build order (for the plan)

Re-ordered so each step is independently shippable + reviewable, and the big authz rewrite is its
own unit (per review). Per §5a, the migration is **expand-first/contract-last**: each step that
touches the schema adds a per-step *scaffolding* migration that keeps its own close-gate green; per
§5b these scaffolding migrations are **squashed into one consolidated migration (step 9) before the
epic merges to `main`.**

1. **Remove `Chapter.status`** across shared/backend/frontend + export-schema change + format-version
   bump. Small, independent, de-risks the migration PR. (security/repo reviewers not triggered.) ✅ shipped.
2. **Draft schema + EXPAND migration** — new `Draft` entity; backfill one draft per chapter (verbatim
   ciphertext copy) + `activeDraftId` + `Chat.draftId` (both nullable); `DROP Chapter.status`; keep
   `Chat.chapterId` + `Chapter.body*/summary*/wordCount`. Minimal `draft.repo.ts` (encrypt/decrypt
   create+read) + **backfill-logic test** (§5a) + **E12 leak-test extension to `Draft`**.
   (repo-boundary-reviewer.)
3. **Ownership-chain + chat/message re-point** — rewrite the nested `where` clauses in
   `chat.repo.ts`, `message.repo.ts`, `ownership.middleware.ts`; flip the `Chat` wire contract
   (`chapterId`→`draftId`) in `RepoChat`/serializer/shared schema/create-input/stories; **CONTRACT
   migration: `Chat.draftId` non-null + FK, drop `Chat.chapterId`.** (**security-reviewer** gate.)
4. **`draft.repo.ts` + draft routes** (list/create-fork-blank/rename/delete-with-reindex/set-active);
   re-scope chat routes to draft; move body + summary/summarise endpoints to draft scope.
5. **Prompt + export/import + aggregates** — prompt previous-chapter context via the active-draft
   summary (metadata join); rewrite `aggregateForStories` to total active-draft word counts (raw/
   reduce, not `groupBy._sum`) + fix its test; export/import round-trips all drafts (`drafts[]` +
   per-draft chats, three-phase import write with `activeDraftId` restore + orderIndex densification +
   exactly-one-`isActive` refine, format version 2, `importResultSchema` draft count). **CONTRACT
   migration: drop `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount`.**
6. **Frontend state** — `selectedDraft` + autosave-baseline re-seed + chat query re-keying.
7. **Sidebar tree** — draft children, hover actions, subtle single-draft affordance + new-draft
   dialog.
8. **Editor sub-row label binding** to the viewed draft.
9. **Squash migrations + consolidation gate (pre-merge)** — replace the step-2/3/5 scaffolding
   migrations with one consolidated migration (§5b); validate with the `prisma migrate diff`
   equality check + the committed pre-9wk schema-baseline harness; add the destructive-migration flag
   to the release notes (§5c). Runs last, just before the epic merges to `main`.
