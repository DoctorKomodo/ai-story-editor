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
- Remove the story-title `<h1>` and the `storyTitle` prop from `Paper` (stop passing it at
  `EditorPage.tsx:812`).
- Promote the existing editable `ChapterTitleInput` into the dominant top slot, restyled from
  the italic sub-heading to the primary heading scale (serif ~28px/600 — matching the retired
  `paper-title`; exact sizing settled during implementation). Keep it inline-editable and keep
  the right-aligned `§ NN` chapter label. Drop the `mt-12 chapter-heading` offset.
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
  (self-contained — no round-trip through EditorPage), seeded from the viewed draft's saved
  `wordCount` on mount / draft-switch so the number is correct before the first edit.
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

**Today:** in `ChapterList.tsx` ChapterRow (`141-248`) the delete `×` `IconButton` is
*conditionally mounted only when the row is active* (`236-245`), so selecting a chapter injects
a ~36px element into the flex row and reflows the `flex-1` title. Additional width variance:
the expand caret is mounted only when `draftCount > 1` (`172-188`), and `＋` (new-draft) vs `×`
appear in mutually-exclusive states. `DraftRow` (`DraftList.tsx:133-159`) already does this
right — actions are always mounted and only opacity-toggled via `revealOnRowHover`.

**Change:** adopt DraftRow's always-mounted + opacity pattern so every chapter row is identical
width in every state:
- **Caret slot** always reserved: render a fixed-width invisible spacer when `draftCount <= 1`
  instead of omitting the caret (mirrors DraftRow's invisible dot spacer).
- **Action slot** always reserved and always mounted on the right, holding `＋` and `×`,
  revealed via `revealOnRowHover` opacity. Remove the `active`-gated conditional mount of `×` —
  it stays in layout; only opacity changes on hover/select. Individual icon visibility (`＋`
  when `draftCount === 1`, `×` when deletable) toggles *within* the fixed-width slot.
- Resulting skeleton: `[grip][index w-5][caret slot][title flex-1][wordcount w-14][action slot]`
  — no reflow on hover or select. The selected-row background tint (`bg-[var(--accent-soft)]`)
  stays; it has no layout impact.

## Testing

- **Vitest (jsdom, no stack):**
  - `ChapterList.test.tsx` / `ChapterList.drafts.test.tsx` — the delete button is now always
    present (opacity-gated), so update selection/visibility assertions to the new skeleton;
    assert no conditional mount keyed on `active`.
  - `editor-paper.integration.test.tsx` — assert chapter title is the primary heading, story
    title is absent from the Paper, and genre is not rendered in the status line.
  - Add a test that the status-line word count reflects the open draft and updates on edit and
    on draft-switch (not the whole-story total).
- **Storybook (required deliverable):**
  - Add a `Paper.stories.tsx` covering the new header + status-line states (titled/untitled
    chapter, live word count, no genre).
  - Update `ChapterList.stories.tsx` to show uniform rows across states (active/hover, single-
    vs multi-draft) demonstrating no width shift.
- **Design lint:** all new styles token-only (`frontend/scripts/lint-design.mjs` via
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
