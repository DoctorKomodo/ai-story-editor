# Drafts editor polish — design (story-editor-322, round 1: items 1–4)

**Status:** approved (brainstorming), pending spec review
**Scope:** frontend-only, presentational. No backend, schema, Prisma, or data-model changes.
**Parent:** story-editor-322 (bucket). This spec covers **items 1–4** only. Items 5–6
(draft delete warning + fork chat/scene behavior) are a separate later spec — they are a
coupled data-safety design decision, deliberately out of scope here.
**Discovered follow-up:** story-editor-6cf (unify server/client word-count logic) — tracked
separately, NOT implemented here.

## Context

The chapter-drafts feature (epic story-editor-9wk) shipped, and dogfooding surfaced four
presentational rough edges in the editor. All four live in two frontend components:
`frontend/src/components/Paper.tsx` (the editor surface: header + status line) and
`frontend/src/components/ChapterList.tsx` (the sidebar chapter/draft tree). Word count is
already stored per-draft server-side (`Draft.wordCount`, recomputed from body plaintext on
every write); the story context also lives in the TopBar breadcrumb
(`EditorPage.tsx:684-688`), so nothing below requires backend work.

## Item 1 — Chapter title becomes the editor header

**Today:** `Paper` renders the **story** title as the dominant `<h1 class="paper-title">`
(`Paper.tsx:304-306`, serif 28px/600), then the status line, then the **chapter** title far
below as a small italic 22px sub-heading (`chapter-heading`, `mt-12`, `Paper.tsx:299-334`).

**Change:**
- Remove the story-title `<h1>` (`Paper.tsx:304-306`) and the `storyTitle` prop from `Paper`
  (stop passing it at `EditorPage.tsx:812`). NOTE: `storyTitle` is a **required** prop
  (`Paper.tsx:36`); removing it is a typecheck-breaking change that must be reconciled in every
  test that constructs `Paper` — see Testing.
- Promote the existing editable `ChapterTitleInput` into the dominant top slot, restyled from
  the italic 22px sub-heading (`Paper.tsx:185`) to the primary heading scale (serif ~28px/600 —
  matching the retired `paper-title`; exact sizing settled during implementation). Keep it
  inline-editable and keep the right-aligned `§ NN` chapter label. Drop the
  `mt-12 chapter-heading` offset (`<header>` at `Paper.tsx:315-334`).
- **DOM / a11y shape (decision — flag for review):** wrap the editable `<input>` in an `<h1>`
  so the editor retains a real primary heading in the accessibility tree (removing the story
  `<h1>` otherwise leaves the Paper with **no** heading element). The `<input>` carries the
  primary-heading styling; the `<h1>` provides `role="heading" level=1`. Tests target the input
  by its testid (`chapter-title-input`), not `getByRole('heading')` on the input itself.
- New Paper vertical order: **[chapter title H1 + § NN] → [status line] → body**.
- Story context is unchanged in the TopBar breadcrumb.

**Edge cases:** untitled chapter → "Untitled" placeholder in the H1 (input already handles
editing); no chapter selected (`chapterId` null) → current empty-state behavior unchanged.

## Item 2 — Live per-draft word count in the status line

**Today:** the status line shows `storyWordCount={totalWordCount}` (`EditorPage.tsx:815`), the
**whole-story** sum of every chapter's `wordCount` (`EditorPage.tsx:526-528`). Paper already
computes a live per-keystroke count (`countWords`, `Paper.tsx:70-74`) but EditorPage discards
it (`EditorPage.tsx:439-444`).

**Change:**
- The status-line count reflects the **draft currently open in the editor**, updating **live
  per keystroke**. Paper displays its **own** internally-computed live count in the SubRow
  (self-contained — no round-trip through EditorPage).
- **Seed source (decision):** replace the removed `storyWordCount` prop with a new
  `initialWordCount` prop, seeded from `viewedDraftMeta?.wordCount` (already available at
  `EditorPage.tsx:238`; server-authoritative per `shared/src/schemas/draft.ts:16`). Paper
  initializes its live-count state from `initialWordCount` so the number is correct before the
  first edit, then updates it from `countWords` (`Paper.tsx:70-74`) on each editor update.
- **Draft-switch reseed is automatic — do NOT add an effect for it.** Paper is keyed on
  `viewedDraftId` (`EditorPage.tsx:806-810`), so switching drafts remounts Paper and re-seeds
  from the new draft's `initialWordCount`.
- Remove the `storyWordCount={totalWordCount}` wiring at `EditorPage.tsx:815`. The Sidebar's
  whole-story total (`EditorPage.tsx:716`) is left untouched.

**Note:** this introduces a second word-count implementation alongside the server's. That
duplication is captured as follow-up story-editor-6cf and is explicitly not addressed here.

## Item 3 — Remove genre from the status line

**Today:** the SubRow shows `genre` from `story.genre` (`Paper.tsx:95`, wired at
`EditorPage.tsx:813`).

**Change:** remove the genre `<span>` and the `genre`/`storyGenre` prop; stop passing it at
`EditorPage.tsx:813`. `Story.genre` stays in the data model and settings — it is only removed
from the editor status line.

## Item 4 — Uniform chapter row skeleton (fix select/hover jumpiness)

**Today:** in `ChapterList.tsx` ChapterRow (function `92-252`; inner row `<div>` from `141`)
the delete `×` `IconButton` is *conditionally mounted only when the row is active* (`236-245`)
**and is persistently visible on that active row** (plain `flex-shrink-0`, not
`revealOnRowHover`). So selecting a chapter injects a ~36px element into the flex row and
reflows the `flex-1` title. Additional width variance: the expand caret is mounted only when
`draftCount > 1` (`172-188`); the new-draft `＋` shows when `draftCount === 1` (`227`) and `×`
shows when `active`, so an active single-draft chapter renders **both** today. `DraftRow`
(`DraftList.tsx:133-159`) is the model — its action cluster is always mounted and only
opacity-toggled via `revealOnRowHover` (opacity, `primitives.tsx:692`), which is why it does
not jump on select (its actions key off `isActive`, not the viewed/selected state).

**Change:** adopt DraftRow's always-mounted + opacity pattern so every chapter row is identical
width in every state:
- **Caret slot** always reserved: render a fixed-width invisible spacer when `draftCount <= 1`
  instead of omitting the caret (mirrors DraftRow's invisible dot spacer).
- **Action slot** always reserved and always mounted on the right, holding `＋` and `×`. Remove
  the `active`-gated conditional mount of `×` — it stays in layout; only its **opacity**
  changes. Individual icon visibility (`＋` when `draftCount === 1`, `×` when deletable) toggles
  *within* the fixed-width slot.
- **Reveal rule (decision — flag for review):** reveal the action slot on **hover OR when the
  row is active** — i.e. `revealOnRowHover` PLUS an explicit `data-[active]`/`aria-current`
  opacity rule. This (a) fixes the jump, and (b) **preserves today's reachability**: the delete
  `×` stays visible on the selected chapter. It also *adds* a hover affordance so `×`/`＋` now
  reveal on hover of any row — a deliberate, minor enhancement (previously delete was reachable
  only via selection). If we want to match DraftRow exactly (hover-only, no reveal-on-active),
  drop the `data-[active]` rule — but that would make the active row's delete hover-only, a
  reachability regression. **Default: hover OR active.**
- Resulting skeleton: `[grip][index w-5][caret slot][title flex-1][wordcount w-14][action slot]`
  — no reflow on hover or select. The selected-row background tint (`bg-[var(--accent-soft)]`)
  stays; it has no layout impact.

## Testing

**Typecheck-breaking prop removals (must fix or the verify command fails at step 1).** Removing
`storyTitle` / `storyGenre` / `storyWordCount` from `PaperProps` breaks every test that
constructs `Paper`. All of these pass the removed props and must be updated:
- `frontend/tests/components/Paper.test.tsx` — **rewrite**, not supplement: it asserts the
  removed behavior directly — "renders the story title" as the level-1 heading (`:41`), the
  Untitled story fallback (`:51`), genre `Fantasy` + whole-story `12,345 words` in the sub-row
  (`:59, :87, :106`), and the chapter heading as italic/`text-[22px]`/`mt-12` (`:117, :129,
  :133, :135`). Rewrite to the new hierarchy: chapter title is the primary heading, story title
  absent, genre absent, word count = open draft's live count.
- `frontend/tests/components/Paper.empty-hints.test.tsx` (`:13`) — update prop usage.
- `frontend/tests/components/CharRefSuggestion.test.tsx` (`:48, :79`) — update prop usage.

**Vitest (jsdom, no stack):**
- `frontend/tests/components/ChapterList.delete.test.tsx` — `it('renders × only on the active
  row')` (`:61`) asserts the non-active row's delete button is absent (`:73`). Rewrite to "× is
  always mounted, opacity-gated (revealed on hover/active)". `ChapterList.test.tsx:396` (clicks
  delete on the active row) still passes but confirm under the new skeleton.
- `frontend/tests/components/ChapterList.drafts.test.tsx` — update for the uniform caret/action
  slot (always-reserved caret spacer, always-mounted action cluster).
- `frontend/tests/pages/editor-paper.integration.test.tsx` — assert the chapter title is the
  editor's primary heading (via the `<h1>` wrapper / `chapter-title-input` testid), the story
  title is absent from the Paper, and genre is not rendered in the status line.
- Add a test that the status-line word count reflects the open draft and updates on edit, and
  that switching drafts re-seeds it from `initialWordCount` (not the whole-story total).

**Storybook (required deliverable):**
- Add `Paper.stories.tsx` (none exists today) covering the new header + status-line states
  (titled/untitled chapter, live word count, no genre).
- Update `ChapterList.stories.tsx` to show uniform rows across states (active/hover, single- vs
  multi-draft) demonstrating no width shift.

**Design lint:** all new styles token-only (`frontend/scripts/lint-design.mjs` via
`npm --prefix frontend run lint:design`).

## Verify command

```
npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design
```

All changes are frontend; no docker stack required.

## YAGNI / boundaries

- No backend changes — word count is already per-draft server-side; only the *displayed* value
  and its liveness change.
- TopBar breadcrumb untouched.
- `Story.genre` remains in the data model / settings; only removed from the editor status line.
- Items 5–6 (draft delete/fork data-safety) and the word-count unification (6cf) are separate.
