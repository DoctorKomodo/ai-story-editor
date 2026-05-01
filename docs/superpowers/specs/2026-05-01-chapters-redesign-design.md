# Chapters Redesign — Design Spec

**Date:** 2026-05-01
**Branch (suggested):** `feat/chapters-ui`
**Scope:** Chapters sidebar panel + sidebar tab strip + Sidebar storybook. One round.

---

## Goal

Reskin the chapters sidebar to the flat, single-line, number/serif/k-format layout shown in the user-supplied screenshots; bundle in the parked PR's inline-confirm delete and drag-handle a11y; surface tab counts in the sidebar tab strip (`CHAPTERS \n N`, `CAST \n N`, `OUTLINE` label-only); add a Sidebar storybook now while we are touching the file.

The visual deltas are the defining trait of this PR — implementing the parked PR's behaviors on the v1 skin would not match the design.

---

## Out of scope

- Cast / Outline panel redesign and their `+` affordances. Follow-up work will realign them with the chapters pattern (in-panel section header with `+`).
- Any new chapter-row metadata (status pill, draft flag, last-modified timestamp).
- Real `TrashIcon` (we reuse the existing private `CloseIcon` from primitives, promoted to an export).
- Vitest snapshot tests (no existing usage in repo; introducing them is out of scope).
- Visual companion tooling / new design tokens.

---

## Locked decisions

| Area | Decision |
|---|---|
| Delete affordance | `×` on active row only (not hover-revealed on inactive rows). Inactive rows have no delete element rendered at all. |
| Inline confirm | Replaces the right-side region (word-count + `×`) on the active row when `×` is clicked. Title slot stays visible and truncates harder via `min-w-0`. |
| Add chapter | `MANUSCRIPT +` button in the in-panel section header. The sidebar-shell-level `+` button is removed entirely (it only worked for Cast as-is). |
| Word-count format | `< 1000` → raw integer (e.g. `987`); `≥ 1000` → one-decimal `k` (`2000 → "2.0k"`, `2100 → "2.1k"`); `0 → "—"`; negative defensively `"—"`. |
| Row number | `orderIndex + 1` zero-padded to two digits (`01`, `02`, …). |
| Backend `chapter.remove()` | Single `$transaction`: delete, then reassign sequential `orderIndex` 0..N-1 on remaining chapters using the existing D16 two-phase swap. |
| Tab counts | Mono 11px caption under each tab label. `CHAPTERS` and `CAST` get counts; `OUTLINE` shows label only (no count source wired). Counts are `null` while the underlying query is loading. |
| Drop indicator | 1px ink ring on the over-row (`useSortable().isOver`). Source row: existing `opacity-60`. |
| Grip visibility | Inactive idle: hidden. Active row: always visible. Drop-target during drag: visible. Coarse pointer: always visible (`@media (pointer: coarse)`). |
| `×` visibility | Active row only, always shown. Coarse pointer: same — only active row, but at `min-w-[32px] min-h-[32px]`. |
| New shared primitives | `InlineConfirm`, `useInlineConfirm`, `GripIcon` added to `design/primitives.tsx`. The existing private `CloseIcon` is promoted to an export. |

---

## Architecture

### Components

- **`<ChapterListSectionHeader/>`** — new file. Stateless. Renders `MANUSCRIPT` mono caption + `+` `IconButton`. Props: `onAdd`, `disabled`. Lives in its own file so Cast/Outline can copy its shape later without coupling.
- **`<ChapterList/>`** — full row redesign. Owns `reorderStatus`, `deleteStatus`, `pendingDeleteId`, sensors, mutations. Renders header + ordered rows.
- **`<ChapterRow/>`** (internal to `ChapterList.tsx`) — single flat row. Owns its own `useInlineConfirm(rowRef)`, `useSortable({id})`, `data-active`, `data-over` attributes for CSS overrides.
- **`<Sidebar/>`** — modify: drop header `+`, accept `chaptersCount?: number | null` and `castCount?: number | null`, render count line under tab labels.
- **`<InlineConfirm/>`** + **`useInlineConfirm()`** — new primitives in `design/primitives.tsx`. Reused later by Cast/Outline; ungated for any destructive row action.

### Server state (TanStack Query)

- `chaptersQueryKey(storyId)` — drives the chapter list, the `CHAPTERS` tab count, and the optimistic delete update.
- `chapterQueryKey(chapterId)` — evicted on delete success so a stale cache hit cannot resurrect deleted body content.
- `charactersQueryKey(storyId)` — drives the `CAST` tab count. **No new fetch** — the data is already loaded for the Cast tab; `useCharactersQuery(storyId).data?.length ?? null` reads from the existing cache.

### Client state (Zustand)

- `useActiveChapterStore` — unchanged. The new `onChapterDeleted` callback in `ChapterList` calls `setActiveChapterId(null)` from `EditorPage` when the deleted id matches the active id.
- `useSidebarTabStore` — unchanged.

### Delete flow (end-to-end)

1. User clicks `×` on the active row → `useInlineConfirm.ask()` flips the row to confirm state. Word-count + `×` slot is replaced by `<InlineConfirm/>` (Delete autofocus, Cancel, both `size="sm"`).
2. User presses Enter (or clicks Delete) → `onConfirmDelete` → `onRequestDelete(chapterId)`.
3. `handleRequestDelete` in `ChapterList`: sets `pendingDeleteId`, calls `deleteChapter.mutateAsync({chapterId})`.
4. `useDeleteChapterMutation.onMutate` snapshots `previous`, computes `computeChaptersAfterDelete(previous, chapterId)`, writes optimistic cache.
5. Backend `DELETE /api/stories/:storyId/chapters/:chapterId` runs the `$transaction`: delete row → fetch remaining ordered ids → two-phase swap to reassign `orderIndex` 0..N-1.
6. On success: `removeQueries({queryKey: chapterQueryKey(chapterId)})`; `confirm.dismiss()`; `onChapterDeleted(chapterId)` callback fires → `EditorPage` clears `activeChapterId` if it matched.
7. On error: rollback cache to `previous`; `deleteStatus = 'Delete failed — try again'` is announced via the existing aria-live region; confirm stays open for retry.
8. `onSettled`: `invalidateQueries(chaptersQueryKey)` so the server's truth eventually wins.

### Reorder flow

Unchanged from the current `useReorderChaptersMutation`. Sensors expand from `PointerSensor` only → `PointerSensor + KeyboardSensor + TouchSensor`. The pure handler `computeReorderedChapters` is reused as-is.

### Tab count flow

`EditorPage` already calls `useChaptersQuery(story?.id)` and `useCharactersQuery(story?.id ?? null)`. It now additionally passes `chaptersCount={chaptersQuery.data?.length ?? null}` and `castCount={charactersQuery.data?.length ?? null}` to `<Sidebar/>`. The Sidebar renders the count under the label only when `count !== null`.

---

## Visual spec

All token names are existing CSS custom properties in `frontend/src/index.css`. No new tokens.

### Section header (`MANUSCRIPT +`)

- Container: `flex items-center justify-between px-3 pt-3 pb-1.5`
- Label: `font-mono text-[11px] tracking-[.08em] uppercase text-ink-4`
- `+` button: 20×20 hit target, glyph 14px. `text-ink-3 hover:text-ink hover:bg-[var(--surface-hover)] rounded-[var(--radius)]`. Loading uses `<Spinner/>` (12px) inline. Disabled while `createChapter.isPending`. `aria-label="Add chapter"`. `data-testid="chapter-list-add"`.

### Row container

- `group flex items-center gap-2 pl-3 pr-2 h-8 rounded-[var(--radius)] transition-colors cursor-pointer`
- Idle inactive: no background, no border. `hover:bg-[var(--surface-hover)]`.
- Active: `bg-[var(--accent-soft)]`. No border.
- Drop target during drag: `ring-1 ring-ink` (no fill change).
- Source row during drag: `opacity-60`.
- Flat — no `bg-bg-elevated`, no `border`. The screenshot's defining trait.

### Grip column

- 12×16 hit slot, glyph `<GripIcon/>` (6 dots, 12×14, `text-ink-4`).
- `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`.
- Active row override: `[data-active='true'] .grip { opacity: 1 }` (one rule appended to `index.css`).
- Drop-target override during drag: `[data-over='true'] .grip { opacity: 1 }`.
- Coarse pointer: opacity 1 always (`is-coarse-pointer-visible` rule from the parked PR's CSS).
- `cursor-grab touch-none`, `aria-label="Reorder"`, testId `chapter-row-${id}-grip`.

### Number column

- `font-mono text-[11px] text-ink-4 tabular-nums w-5 flex-shrink-0`
- Content: `String(orderIndex + 1).padStart(2, '0')`.

### Title

- `flex-1 min-w-0 font-serif text-[14px] text-ink leading-tight truncate`
- Active: same color (the row fill is the active cue).
- Source row during drag: inherits `opacity-60` from the row.
- Empty title fallback: `Chapter ${orderIndex + 1}` via existing `chapterDisplayTitle`.

### Right-side region (word-count slot)

- Fixed-width grid slot: `w-14 flex-shrink-0 text-right`. Keeps the title's truncation point stable across rows.
- Word count: `font-mono text-[11px] text-ink-4 tabular-nums`.
- Format: `formatWordCountCompact(n)` per the locked rule.
- Inline confirm replaces this slot AND the `×` slot.

### Delete `×` (active row only)

- `IconButton` reused; glyph is the existing `CloseIcon` from primitives (promoted to export).
- 20×20 hit, glyph 12×12, `text-ink-3 hover:text-ink hover:bg-[var(--surface-hover)] rounded-[var(--radius)]`.
- Rendered only when `active === true` — inactive rows omit the element entirely.
- `aria-label={\`Delete \${displayTitle}\`}`, testId `chapter-row-${id}-delete`.

### Inline confirm (delete state)

- Right-side region (word-count + `×`) replaced by `<InlineConfirm/>` rendered in-flex.
- Delete: `Button variant="danger" size="sm"`, autofocused on mount.
- Cancel: `Button variant="ghost" size="sm"`.
- Group: `role="group" aria-label={\`Delete \${displayTitle}\`}`, testId `chapter-row-${id}-confirm`.
- Title slot keeps `min-w-0` so on narrow widths the title truncates harder rather than the buttons wrapping.

### Tab strip (Sidebar)

- Tab button gains a vertical stack: `flex flex-col items-center gap-0`, padding unchanged.
- Label: `font-mono text-[11px] uppercase tracking-[.08em] ${active ? 'text-ink' : 'text-ink-3'}`.
- Count: `font-mono text-[11px] tabular-nums ${active ? 'text-ink-3' : 'text-ink-4'}`. Hidden when `count === null`.
- Active underline rule: existing `border-b-2 border-ink -mb-px` retained.
- Tab `aria-label` includes the count for screen readers (e.g. `"Chapters (9)"`).

### Sidebar header

- Drop the `+` button + its 28×28 slot. Story picker grows to fill (it already had `flex-1`).

### Empty / loading

- `MANUSCRIPT +` always rendered.
- Below: existing `aria-live="polite"` container; `Loading chapters…` or `No chapters yet` in `font-sans text-[12.5px] text-ink-3 px-3`.

### Rules to append to `index.css`

```css
/* Active or drop-target chapter rows always show their grip + (active) ×. */
[data-testid^='chapter-row-'][data-active='true'] [data-testid$='-grip'],
[data-testid^='chapter-row-'][data-over='true'] [data-testid$='-grip'] {
  opacity: 1;
}

@media (pointer: coarse) {
  .is-coarse-pointer-visible { opacity: 1 !important; }
  [data-testid^='chapter-row-'][data-testid$='-grip'],
  [data-testid^='chapter-row-'][data-testid$='-delete'] {
    min-width: 32px;
    min-height: 32px;
  }
}
```

(Selectors scoped to `chapter-row-` to avoid collisions with unrelated `*-delete` testIds elsewhere in the app. The row sets `data-active="true"` when active and `data-over="true"` when `useSortable().isOver` is true.)

---

## File plan

### Create

- `docs/superpowers/specs/2026-05-01-chapters-redesign-design.md` (this file)
- `frontend/src/components/ChapterListSectionHeader.tsx`
- `frontend/src/components/Sidebar.stories.tsx`
- `frontend/src/design/InlineConfirm.stories.tsx`
- `frontend/src/lib/formatWordCount.ts`
- `frontend/tests/lib/formatWordCount.test.ts`
- `frontend/tests/components/ChapterList.delete.test.tsx`
- `frontend/tests/components/ChapterList.dragA11y.test.tsx`
- `backend/tests/repos/chapter.repo.remove.test.ts`

### Modify

- `frontend/src/design/primitives.tsx` — add `InlineConfirm`, `useInlineConfirm`, `GripIcon`; export `CloseIcon`.
- `frontend/src/components/ChapterList.tsx` — full row redesign + delete + sensors + section header wiring.
- `frontend/src/components/ChapterList.stories.tsx` — refit to new visual; add `DeleteConfirm`; drop the v1 `Default`.
- `frontend/src/components/Sidebar.tsx` — drop header `+`; add `chaptersCount`/`castCount` props; render count under tab labels.
- `frontend/src/hooks/useChapters.ts` — add `useDeleteChapterMutation` + `computeChaptersAfterDelete`.
- `frontend/src/pages/EditorPage.tsx` — pass `chaptersCount`/`castCount` to Sidebar; pass `onChapterDeleted` to ChapterList.
- `frontend/src/index.css` — append coarse-pointer rules + active-row grip override.
- `frontend/tests/components/Sidebar.test.tsx` — extend for tab-count rendering and removed `+`.
- `frontend/tests/components/ChapterList.test.tsx` — extend for new visual + section header `+`.
- `frontend/tests/hooks/useChapters.test.ts` — add `computeChaptersAfterDelete` cases.
- `backend/src/repos/chapter.repo.ts` — `remove()` becomes a `$transaction` with two-phase orderIndex reassignment.
- `backend/tests/routes/chapters.routes.test.ts` — extend DELETE assertions to verify reassignment.

---

## Testing plan

### Backend

1. **`backend/tests/repos/chapter.repo.remove.test.ts`** (new)
   - `removes the chapter and reassigns sequential orderIndex 0..N-1` — seed 4 chapters, remove the middle, assert remaining have `[0,1,2]` in original creation order.
   - `is a no-op when the id does not exist` — returns `false`, no mutation on others.
   - `runs in a single transaction` — mock prisma to throw on the second update, assert row not deleted.
   - `enforces user ownership` — second user's chapter is not deletable; returns `false`.
   - Verify: `cd backend && npm run test -- repos/chapter.repo.remove`.

2. **`backend/tests/routes/chapters.routes.test.ts`** (extend)
   - DELETE returns 204; subsequent GET returns sequential indexes.
   - DELETE returns 404 for another user's chapter (existing pattern).
   - Verify: `cd backend && npm run test -- routes/chapters.routes`.

### Frontend — pure helpers

3. **`frontend/tests/lib/formatWordCount.test.ts`** (new)
   - Cases: `0 → "—"`, `1 → "1"`, `999 → "999"`, `1000 → "1.0k"`, `2100 → "2.1k"`, `2150 → "2.2k"`, `12345 → "12.3k"`, `negative → "—"`.
   - Verify: `cd frontend && npx vitest run tests/lib/formatWordCount`.

4. **`frontend/tests/hooks/useChapters.test.ts`** (extend)
   - `computeChaptersAfterDelete returns null when the id is not present`.
   - `computeChaptersAfterDelete removes the chapter and reassigns orderIndex 0..N-1`.
   - Verify: `cd frontend && npx vitest run tests/hooks/useChapters`.

### Frontend — components

5. **`frontend/tests/components/ChapterList.delete.test.tsx`** (new)
   - `× button is only rendered for the active row`.
   - `clicking × opens InlineConfirm and replaces the word-count slot`.
   - `pressing Escape dismisses the confirm`.
   - `clicking outside the row dismisses`.
   - `clicking Delete fires the API call and removes the row optimistically`.
   - `if the API rejects, the row is restored and aria-live announces "Delete failed — try again"`.
   - `onChapterDeleted is called when the active chapter is deleted`.
   - Verify: `cd frontend && npx vitest run tests/components/ChapterList.delete`.

6. **`frontend/tests/components/ChapterList.test.tsx`** (extend)
   - Row renders zero-padded number from `orderIndex + 1`.
   - Row renders compact word count via `formatWordCountCompact`.
   - `MANUSCRIPT` header renders an Add Chapter `+` button that calls `createChapter`.
   - Verify: `cd frontend && npx vitest run tests/components/ChapterList`.

7. **`frontend/tests/components/ChapterList.dragA11y.test.tsx`** (new)
   - Keyboard sensor: focus a grip, Space to lift, Arrow keys reorder, Space to drop.
   - **Note:** dnd-kit's `KeyboardSensor` under jsdom is finicky. If integration is flaky, fall back to asserting `sortableKeyboardCoordinates` is wired and `computeReorderedChapters` produces the expected output for arrow-direction → index-shift mapping. Real DOM behaviour is covered by the X24 Playwright sweep.
   - Verify: `cd frontend && npx vitest run tests/components/ChapterList.dragA11y`.

8. **`frontend/tests/components/Sidebar.test.tsx`** (extend)
   - Tab labels render a count line under `CHAPTERS` and `CAST` when counts provided.
   - Tab `aria-label` includes count for screen readers.
   - `OUTLINE` renders without a count.
   - Count line is omitted when count is `null`.
   - Sidebar header no longer renders the global `+` button (regression: testId `sidebar-add-button` is absent).
   - Verify: `cd frontend && npx vitest run tests/components/Sidebar`.

### Storybook

9. **`Sidebar.stories.tsx`** (new) — six variants:
   - `Default` — story selected, populated chapter list active, goal progress shown.
   - `NoStory` — `storyTitle = null`, all bodies show empty states.
   - `NoGoal` — totalWordCount present, goalWordCount unset.
   - `CastTabActive` — sidebar tab seeded to `cast`, exercises `CAST` count rendering.
   - `OutlineTabActive` — verifies `OUTLINE` renders without a count.
   - `LongStoryTitle` — overflow / ellipsis sanity check on the story-picker.

10. **`ChapterList.stories.tsx`** (refit) — `Default`, `ActiveRowHover`, `DeleteConfirm`, `Empty`, `Loading`. Drop the v1 boxed-row `Default`.

11. **`InlineConfirm.stories.tsx`** (new) — harness from the parked PR, retargeted to the new chapter-row layout.

### Aggregate verify

Run before marking the task group complete:

- `cd backend && npm run test`
- `cd frontend && npm run test`
- `cd backend && npx tsc --noEmit`
- `cd frontend && npx tsc --noEmit`
- `npx biome check frontend backend`
- `cd frontend && npm run storybook -- --no-open` (smoke-build)

### Manual / Playwright (X24 sweep, not CI-gated)

Mouse / keyboard / touch matrix from the parked PR's PR.md, plus tab-count rendering across stories with 0, 1, 99 chapters.

---

## Risks and rollbacks

- **Risk:** dnd-kit `KeyboardSensor` under jsdom is unreliable. **Mitigation:** unit-test the pure handler; rely on the X24 Playwright sweep for the real-DOM keyboard reorder path.
- **Risk:** Sidebar header `+` removal regresses Cast/Outline add UX until follow-up work lands. **Mitigation:** documented as accepted regression; users can still create characters/outline items via the in-page flows that exist (CharacterSheet open-via-empty-state, etc.). Confirmed with the user.
- **Risk:** the `chapter.remove()` transaction's two-phase swap is more complex than `deleteMany`. **Mitigation:** mirrors the existing D16 reorder path; covered by a dedicated repo test plus the routes integration test.
- **Risk:** broad-suffix CSS selector `[data-testid$='-delete']` from the parked PR could hit unrelated buttons. **Mitigation:** scoped to `[data-testid^='chapter-row-']` in the appended CSS.
- **Risk:** `computeChaptersAfterDelete` reassigns `orderIndex` client-side optimistically; if the server's reassignment differs (it shouldn't), the next invalidate corrects it. **Mitigation:** tested both paths.

---

## Acceptance criteria

A reviewer should be able to confirm:

1. The chapter list visually matches the screenshots: flat single-line rows, mono row numbers, serif titles, compact `k`-format word counts, soft-fill active row, `MANUSCRIPT +` section header above.
2. Clicking `×` on the active row opens an inline `Delete | Cancel` confirm; clicking Delete removes the row optimistically; the active id clears if the deleted chapter was active.
3. After deleting a middle chapter, the remaining rows renumber to `01, 02, 03, …` (no gaps) — backend reassignment confirmed by `GET /chapters` returning sequential indexes.
4. Keyboard reorder works: tab to a grip, Space to lift, Arrow keys to move, Space to drop, Escape to cancel.
5. Sidebar tab strip shows counts under `CHAPTERS` and `CAST`; `OUTLINE` shows label only.
6. The sidebar-shell `+` button is gone; the `MANUSCRIPT +` button is the sole add-chapter affordance.
7. `Sidebar.stories.tsx` renders six variants without errors.
8. All aggregate verify commands pass.
