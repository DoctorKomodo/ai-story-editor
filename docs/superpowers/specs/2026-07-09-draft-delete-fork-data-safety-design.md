# Draft Delete / Fork Data-Safety — Design

**bd:** story-editor-6ze (split from story-editor-322 items 5–6)
**Date:** 2026-07-09 · **revised 2026-07-10** (unblocked)
**Status:** design drafted → **BLOCKED** on DS cleanup (story-editor-8hb
`ConfirmDialog` primitive, story-editor-0x2 `Checkbox`/`Radio` primitives) →
**REVISED & READY.** Both blockers landed on `main` (8hb #162 `7f710f2`,
0x2 #163 `5f17664`). The revision pass called for at block time is done:
§2 now consumes the `ConfirmDialog` primitive (was: inline `Modal`
composition), §3a now consumes the `Checkbox` primitive (was: hand-rolled
`<input>`), and §8's two follow-ups are marked shipped. The rest of the design
(schema split, `_count`, fork transaction/copy, fixtures) was unaffected and
stands as originally written.

## Problem

Deleting a draft cascade-deletes every chat and scene attached to it
(`Chat.draftId ON DELETE CASCADE`, and `Message.chatId ON DELETE CASCADE`
below that). The delete flow gives **no warning** that this content is about
to be destroyed.

The footgun surfaced in dev testing: fork a draft (fork copies **body only** —
chats stay pinned to the source draft), make the fork active, then delete the
now-inactive source draft. All of the source draft's chats/scenes are
cascade-deleted silently. The user intended to keep exploring; the delete
button gave no hint that conversations were attached.

Two independent flows contribute and both are addressed here:

1. **Delete (item 5)** — the delete confirm must warn, with counts, when a
   draft has attached chats/scenes.
2. **Fork (item 6)** — fork should be able to carry the source draft's
   chats/scenes onto the new draft, so branching doesn't strand them.

**Not in scope / confirmed intended:** per-draft scoping of chats/scenes
(`Chat.draftId`) stays. The data model is correct; only the delete and fork
*flows* change. No schema migration is required (see §2).

## Design Overview

- Add one **derived count** to `DraftMeta` (`chatCount` — every `Chat` row for
  the draft, both `kind: "ask"` and `kind: "scene"`, since scenes are just chats
  with a `kind`) so the sidebar draft-tree already knows, synchronously, whether
  a draft has attached chats/scenes and how many — no extra fetch when the
  delete button is clicked.
- **Delete UX:** count 0 → today's inline confirm, untouched. Count ≥ 1 → a
  confirmation **modal** that spells out exactly what will be destroyed
  ("N attached chats & scenes").
- **Fork UX:** `NewDraftDialog` gains an opt-in **"Also copy chats & scenes"**
  checkbox under the Fork radio. When set, `createFork` deep-copies the source
  (active) draft's chats + messages onto the new draft, **through the repo
  layer** (decrypt source plaintext → re-encrypt under the user's DEK with
  fresh IVs) — keeping the encrypt-on-write / decrypt-on-read symmetry intact.

## 1. Data & API changes

### 1a. `DraftMeta` — one derived count (list-only, via a schema split)

The count belongs **only on the list-meta shape**, not on the full-draft
detail shape. This is a hard constraint, not a preference:

> **Egress trap (must avoid).** Today `draftSchema = draftMetaSchema.extend({ bodyJson, summary, … })`
> (`shared/src/schemas/draft.ts:26`). `.extend` on a strict object keeps the
> base keys **required**, so adding counts to `draftMetaSchema` makes them
> required on `draftSchema` too — the payload for `GET /:draftId`, `POST`
> (create **and fork**), and `PATCH`. Those go through `serializeDraft`
> (`backend/src/lib/serialize.ts:171`), which does **not** compute the count, and
> `respond()` hard-parses every response against its schema in dev/test
> (`backend/src/lib/respond.ts:21`), throwing `EgressSchemaDriftError` (500) on
> drift. So a naïve add would 500 every full-draft endpoint — including the
> fork this feature builds — across the entire test suite.

**Fix — split the schema so the count lives only on meta:**

```ts
// all fields draftMetaSchema currently has:
const draftCoreSchema = z.strictObject({
  id, chapterId, label, wordCount, orderIndex, isActive,
  hasSummary, summaryIsStale, createdAt, updatedAt,
});

export const draftMetaSchema = draftCoreSchema.extend({
  // Every Chat row for the draft — asks + scenes combined (scenes are chats
  // with kind: "scene"). This is what cascade-deletes when the draft is deleted.
  chatCount: z.number().int().nonnegative(),
});

export const draftSchema = draftCoreSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});
```

Now the **list** shape (`DraftMeta`, what the sidebar tree and `DraftRow`
consume) carries the count; the **full-draft** shape (`Draft`, returned by
create/fork/get/patch) is byte-identical to today — `serializeDraft` untouched,
no egress drift. No frontend consumer reads the count off a full `Draft`: after
a create/fork the list query is invalidated and the count arrives via the list
refetch.

`chatCount` is a **structural row count, not narrative content** — no ciphertext
egress, no leak-test surface. A single total (not an ask/scene split) is a
deliberate choice: it rides the exact `_count` pattern `ChapterMeta.draftCount`
already uses (§1b), and since scenes *are* chats the merged "chats & scenes"
wording is unambiguous. A by-kind split was rejected — it can't use `_count`
(Prisma can't key the same relation twice by `kind`) and would force a second
`groupBy` query for marginal copy polish.

### 1b. Backend — populate the count (list path only)

`backend/src/repos/draft.repo.ts` → `findManyMetaForChapter` gains the count.
`serializeDraftMeta` (`serialize.ts:190`) maps it onto the wire shape; the
full-draft `serializeDraft` is **not** touched.

**Pattern-exact with `draftCount`.** `findManyMetaForChapter` already does a
`client.draft.findMany({ where: { chapterId, … }, select: { … } })`. Add one
line to that `select` — mirroring `ChapterMeta.draftCount`
(`chapter.repo.ts:181`, `_count: { select: { drafts: true } }`):

```ts
_count: { select: { chats: true } },   // asks + scenes; one query, no N+1
```

then map `r._count.chats → chatCount` **explicitly** in the meta shaper. Note
the shaper currently returns `{ ...projected, isActive, ...flags }` by spread
(`draft.repo.ts:305`), and `projectDecrypted` (`_narrative.ts`) strips **only**
keys ending in `Ciphertext`/`Iv`/`AuthTag` (`stripCiphertextFields`). `_count`
is none of those, so it **does** ride through `...stripCiphertextFields(row)`
into `projected._count` — and `serializeDraftMeta` is an explicit-pick serializer, so a
stray `_count` on `RepoDraftMeta` would not itself reach the wire or 500 — but
it pollutes the internal `RepoDraftMeta` shape and its repo-level test. So the
mapper must both **assign** `chatCount: r._count.chats` by hand
**and remove** the phantom `_count` (`delete projected._count`, or build the
meta object without spreading `_count`), with `RepoDraftMeta` (`draft.repo.ts`)
extended to carry `chatCount`. This mirrors `chapter.repo`'s explicit
`draftCount` map. No second query, no `groupBy`.

No new column, no migration — read-time aggregation only.

### 1c. Fork API — `copyChats` flag

`shared/src/schemas/draft.ts` — `draftCreateSchema` gains:

```ts
copyChats: z.boolean().optional(),   // only meaningful when mode === 'fork'
```

`backend/src/routes/drafts.routes.ts` POST handler passes `copyChats` through
to `createFork`. When `mode: 'blank'`, `copyChats` is ignored.

### 1d. Delete API — unchanged

`DELETE /api/drafts/:draftId` is **not** changed. The cascade already does the
right thing; all new delete behavior is frontend, driven off the meta count.
The existing active-draft and last-draft guards stay exactly as they are.

## 2. Delete-warning UX

`frontend/src/components/DraftList.tsx` (`DraftRow`):

- Read `hasAttached = draft.chatCount > 0`.
- **`hasAttached === false`** → the existing `useInlineConfirm` inline
  Delete/Cancel row. No change.
- **`hasAttached === true`** → clicking × opens a **confirm modal**:

  > **Delete "{draft label}"?**
  > This permanently deletes its **{N} attached chats & scenes**. This can't be
  > undone.
  > `[Cancel]` `[Delete draft]`

  - Singular/plural handled inline (`chatCount === 1 ? 'chat & scene' : 'chats
    & scenes'`, or simply "1 attached chat/scene" vs "N attached chats &
    scenes"). No shared `pluralize` helper exists and none is added — inline
    ternary is the codebase idiom.
  - **Consume the `ConfirmDialog` primitive** (`frontend/src/design/primitives.tsx`,
    shipped by story-editor-8hb). It is the standard confirm surface now that
    8hb migrated `ResendConfirmDialog`, `StoryPicker` delete, `CharacterSheet`
    delete, and `ChatSceneTab` onto it — building a new bespoke `Modal`
    composition here would reintroduce exactly the drift 8hb removed (a
    blocking "Reuse before build" review finding). Wire it directly:

    ```tsx
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
      onConfirm={() => { void onConfirmDelete(); }}
      onCancel={() => { setConfirmingDelete(false); }}
      testId={`draft-row-${draft.id}-confirm-modal`}
    />
    ```

    The primitive already provides `size="sm"`, `role="alertdialog"`, the
    `useId()`-labelled header, the danger action button, the `pending`
    spinner + Cancel-disable, and the `error` (`role="alert"`, dialog stays
    open) — so no inline chrome is written. The `chatCount === 1` ternary lives
    in the `body` string only.
  - Confirm calls the **same** `useDeleteDraftMutation` the inline path uses;
    the mutation, optimistic removal, error handling (`cannot_delete_active_draft`
    resync), and `pendingDeleteId` state are unchanged. On failure the row keeps
    the modal open via the primitive's `error` prop (§4) rather than the inline
    path's aria-live-only surface.
  - Dismiss (Escape / Cancel / backdrop) closes with no side effect.

Active/last-draft drafts: the delete affordance is already hidden on the active
row (`DraftList.tsx:150`, delete `IconButton` renders only when
`!draft.isActive`), so the modal only ever appears for a deletable (inactive)
draft. No new guard logic.

> **Not adopted: soft-delete/undo.** `StoryPicker` deletes via `useSoftDelete`
> (5s undo, commit f2fefb1). We keep the explicit modal-confirm here rather than
> switch draft delete to soft-delete/undo — the goal is *warning before an
> irreversible cascade*, and a modal that names what's lost serves that
> directly. Adopting undo for drafts is a separate UX direction, out of scope.

## 3. Fork-copy behavior

### 3a. Dialog

`frontend/src/components/NewDraftDialog.tsx`:

- Under the Fork radio, an indented checkbox: **`[ ] Also copy chats & scenes`**.
- **Consume the `CheckboxField` primitive** (`frontend/src/design/primitives.tsx`,
  shipped by story-editor-0x2 — `{ id, label, hint?, checked, onChange: (next:
  boolean) => void, testId? }`). NewDraftDialog's radios are *already* the
  `RadioGroup` primitive after 0x2's migration (`NewDraftDialog.tsx:103-113`),
  so a hand-rolled `<input type="checkbox">` here would be the lone raw control
  in an otherwise primitive-based dialog — a "Reuse before build" finding.
  `CheckboxField` renders the `<label htmlFor>` + `Checkbox` + text at the same
  `text-[12px]` scale the dialog uses; feed it a `useId()`:

  ```tsx
  const copyChatsId = useId();
  const [copyChats, setCopyChats] = useState(false);
  // …rendered only when mode === 'fork', indented under the RadioGroup.
  // CheckboxField takes no className (verified frontend/src/design/primitives.tsx),
  // so the pl-6 indent goes on a wrapping <div>:
  {mode === 'fork' ? (
    <div className="pl-6">
      <CheckboxField
        id={copyChatsId}
        label="Also copy chats & scenes"
        checked={copyChats}
        onChange={setCopyChats}
        testId="new-draft-copy-chats"
      />
    </div>
  ) : null}
  ```
- Rendered only when `mode === 'fork'` (hidden for blank).
- **No count in the label.** An earlier draft proposed "Also copy chats &
  scenes (N)", but `NewDraftDialog` has no access to the source count:
  fork always forks the *target chapter's active draft*
  (`draft.repo.ts:328`, no source param), the dialog receives only
  `{ chapterId, storyId, draftCount, viewedIsActive, … }`
  (`NewDraftDialog.tsx:36`), and the dialog can target a chapter whose drafts
  aren't even loaded (`newDraftChapterId` need not equal the open
  `activeChapterId`). Plumbing the active draft's counts in for a cosmetic
  "(N)" isn't worth it — the checkbox is a plain label. Copying zero chats is a
  harmless no-op, so the checkbox always shows for fork mode.
- Checkbox state feeds `input.copyChats` on the `useCreateDraftMutation` call.
- Default **unchecked** (opt-in, matches the decision).

### 3b. Repo deep-copy

`backend/src/repos/draft.repo.ts` → `createFork(chapterId, { label, copyChats })`:

1. Create the fork body-copy exactly as today (prose re-encrypted, wordCount
   recomputed, summary NULL).
2. If `copyChats`, within the **same transaction**:
   - Read the source (active) draft's chats via the chat repo
     (`findManyForDraft` → decrypted `{ title, kind, ... }`).
   - For each source chat, create a new chat on the fork
     (`chat.repo.create({ draftId: fork.id, title, kind })` — re-encrypts the
     title under the user's DEK, fresh IV).
   - Read that chat's messages (`message.repo.findManyForChat` → decrypted
     `{ role, content, attachmentJson, citationsJson, model, tokens, latencyMs }`).
   - Re-create each message on the new chat in **source order** via
     `message.repo.createWithin(tx, …)` (re-encrypts content/attachment/citations
     with fresh IVs).

**Encryption:** the copy goes through the normal repo write paths, so every
copied field is decrypted-on-read from the source and encrypted-on-write to the
destination — no raw ciphertext handling, no `*Ciphertext`/`*Iv`/`*AuthTag`
egress, and `repo-boundary-reviewer`'s symmetry invariant holds. The user's DEK
is request-scoped and available on the authenticated fork call.

**Transaction — the whole fork, not just the copies.** Today `createFork`
(`draft.repo.ts:321`) calls `create()`, which inserts on the **module client,
not a tx** (`draft.repo.ts:105`) — there is no transaction anywhere in the fork
path. For the "no half-copied draft" guarantee, the fork-body insert **and**
the chat/message copies must share one `$transaction`; otherwise a mid-copy
failure leaves a committed body-only fork — exactly the state this is meant to
prevent. So the plan must:

1. Add a **tx-threaded draft insert** path (a `createWithin(tx, …)` on
   `draft.repo`, or inline the `tx.draft.create` inside `createFork`'s
   transaction) — the current `create()` alone is insufficient.
2. Add **`chat.repo.createWithin(tx, …)`** that threads `tx` through *both* its
   ownership check and the insert — `chat.repo.create` today uses the module
   client for `ensureDraftOwned` **and** the create (`chat.repo.ts:48`), so it
   can't see rows created earlier in the same uncommitted tx. This is mandatory,
   not "if needed".
3. Reuse **`message.repo.createWithin(tx, …)`** as-is — it already takes `tx`
   and runs `ensureChatOwned(tx, …)` on the tx client (`message.repo.ts:45`),
   so a chat created earlier in the same tx is visible to the message
   ownership check. ✓ verified.

All three run inside the single `$transaction` opened by `createFork`.

**Copied-content semantics (acceptable trade-offs, noted so the reviewer isn't
surprised):**
- Copies get **fresh** `createdAt` / `lastActivityAt` (created "now", in source
  order so message ordering is preserved). Absolute timestamps are not
  preserved — a fork is a new branch, not a historical clone.
- A copied message's `updatedAt` ("edited?" marker) resets to `null`. Edits on
  the source aren't re-flagged on the copy. Acceptable for a branch.
- Both drafts now hold **independent** copies of the conversations; they diverge
  from the fork point. This is the intended "branch everything" behavior.

## 4. Error handling

- **Delete modal:** mutation error surfaces via the existing `onStatus` channel
  (same strings as the inline path). The modal stays open on failure so the user
  can retry or cancel.
- **Fork copy:** any failure inside the transaction rolls back the entire fork
  (no half-copied draft). Surfaces as the dialog's existing "Could not create
  the draft — try again." A copy of a large history is bounded by the source
  draft's message count; no pagination needed for a one-shot op.

## 5. Testing

- **shared:** the core/meta/full split holds — `draftMetaSchema` requires
  `chatCount`, `draftSchema` (full) **must not** carry it (guards against the
  egress trap; a test asserting `draftSchema.parse` rejects an object with
  `chatCount` present, or simply that its inferred type has no such key).
- **fixtures — THREE `DraftMeta` builders, plus the full-`Draft` trap:**
  - `makeDraftMeta` (`tests/fixtures/chapter.ts:42`), `metaOf`
    (`DraftList.stories.tsx:16`), **and** the second `metaOf`
    (`ChapterList.stories.tsx:115`) each default `chatCount` to `0`. (The spec's
    earlier "only two builders" was wrong — making `chatCount` required breaks
    `tsc -p tsconfig.test.json` on the third site otherwise.) With the default
    at 0, `hasAttached` is false, so **existing `DraftList` inline-confirm tests
    keep passing on the inline path** — they hold *because* of this default.
  - **`makeDraft` (full-`Draft` fixture, `tests/fixtures/chapter.ts:62`) must
    NOT carry `chatCount`.** It's built by spreading `makeDraftMeta()`, so it
    would inherit the phantom count — the fixture-level twin of the egress trap
    §1a guards against (and TS won't catch it: spread props dodge excess-property
    checks). Strip it: destructure `chatCount` out of the meta spread (or add a
    `makeDraftCore`). A test that `draftSchema.parse(makeDraft())` succeeds
    guards this.
- **backend repo (`draft.repo`):**
  - `findManyMetaForChapter` returns correct `chatCount` (0-chat draft,
    ask-only, scene-only, mixed asks+scenes — all fold into the one total) —
    exercised **through the repo layer** against the test DB, not raw Prisma.
  - `createFork({ copyChats: false })` copies body only, zero chats (status quo
    regression guard).
  - `createFork({ copyChats: true })` copies every chat (both kinds) and every
    message; decrypting a copied message yields the source plaintext; the copy's
    chat/message rows point at the new draft id; source draft is untouched.
  - Fork-copy atomicity: a forced failure mid-copy leaves neither the fork nor
    partial chats (transaction rollback).
- **leak test (E12):** must still pass — `chatCount` is a plaintext row count,
  and the copy path never emits ciphertext columns. Re-run as part of the
  backend suite.
- **backend routes (`drafts.routes`):** POST with `mode: 'fork', copyChats: true`
  threads the flag; `mode: 'blank', copyChats: true` ignores it.
- **frontend (`DraftList`):** count 0 → inline confirm (existing tests hold);
  count ≥ 1 → modal opens with correct pluralized copy; Cancel/Escape dismiss
  with no mutation; Delete fires the mutation and removes the row.
- **frontend (`NewDraftDialog`):** checkbox visible only for fork; toggling it
  sets `copyChats` on the create call.
- **Storybook:** `DraftList` sample data updated for `chatCount`; a delete-modal
  state story; `NewDraftDialog` fork-with-copy story.

## 6. Task decomposition

One spec → one plan → **one PR** (shared surface is the DraftMeta count change).
Distinct tasks:

1. **Count + fork API (shared + backend).** The `draftCoreSchema` split
   (`chatCount` on meta only, full-draft shape unchanged), `findManyMetaForChapter`
   `_count` one-liner + `serializeDraftMeta` mapping, `draftCreateSchema.copyChats`,
   `createFork` deep-copy in one `$transaction` (tx-threaded draft insert +
   **new** `chat.repo.createWithin` + existing `message.repo.createWithin`),
   route wiring, repo/route/leak tests.
2. **Delete-warning modal (frontend).** `DraftRow` `ConfirmDialog`-vs-inline
   branch (`chatCount > 0` → `ConfirmDialog` primitive; `=== 0` → existing
   inline confirm), inline-ternary copy, the `chatCount:0` fixture defaults on
   all three `DraftMeta` builders + the `makeDraft` strip (§5), tests, Storybook.
3. **Fork checkbox (frontend).** `NewDraftDialog` `CheckboxField` (fork-only),
   `copyChats` wiring, tests, Storybook.

Task 1 lands the contract both frontend tasks consume.

## 7. Review surface (not frontend-only)

Unlike story-editor-322 items 1–4, this touches the narrative-repo boundary and
the encrypted message copy path. **`repo-boundary-reviewer`** is in-lane
(repos, content-crypto symmetry, no ciphertext egress, leak test) and
**`security-reviewer`** is plausibly in-lane if the touch-set brushes the DEK
usage on the copy path. Both run at the `/bd-close-reviewed` gate.

## 8. Tracked follow-ups — both SHIPPED (this spec now consumes them)

At block time these were filed as the DS prerequisites; both have since landed
on `main` and this feature consumes them directly rather than deferring:

- **`ConfirmDialog` primitive — ✅ shipped (story-editor-8hb, #162).** Extracted
  and migrated `ResendConfirmDialog`, `StoryPicker` delete, `CharacterSheet`
  delete, and `ChatSceneTab` onto it. §2's delete-warning modal consumes this
  primitive (no new bespoke dialog).
- **`Checkbox`/`Radio` primitives — ✅ shipped (story-editor-0x2, #163).** Added
  `Checkbox`/`Radio`/`RadioGroup`/`CheckboxField` and migrated ~9 hand-rolled
  form controls, including NewDraftDialog's radios (now `RadioGroup`). §3a's
  fork checkbox consumes `CheckboxField`.

No follow-up remains open from this section. This PR adds **no** new hand-rolled
form control or bespoke confirm dialog.

## Global Constraints

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
