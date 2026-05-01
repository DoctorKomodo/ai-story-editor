# Cast Redesign — Design Spec

**Date:** 2026-05-01
**Branch (suggested):** `feat/cast-ui`
**Scope:** Cast sidebar panel + character backend `orderIndex` + Cast storybook.

---

## Goal

Realign the cast sidebar tab with the chapters pattern (shipped in PR #47). Drop the implicit Principal/Supporting split, render a single user-ordered list under a `DRAMATIS PERSONAE +` section header, restore the missing add affordance, add row-level inline-confirm delete (gated by a transient "selected" state), add drag-to-reorder with full keyboard/touch a11y, and persist the order via a new `Character.orderIndex` column on the backend.

Card sizing (avatar + 2-line name + role/age line) is preserved per the user's brief — the v1 visual density is the right one for cast members; only the affordances and ordering model change.

---

## Out of scope

- Outline tab redesign and its `+` realignment (separate task).
- Avatar visual redesign / palette changes.
- Numbered cards (`01..0N`) — explicitly dropped per user brief.
- Exposing `orderIndex` to the frontend as a user-visible field — it drives ordering only.

---

## Locked decisions

| Area | Decision |
|---|---|
| Section header text | `DRAMATIS PERSONAE` (caption, mono 11px uppercase, `text-ink-4`); `+` `IconButton` on the right. |
| Section grouping | Principal / Supporting split removed. Flat user-ordered list. |
| Card sizing | Unchanged (avatar 28×28 + sans-13/500 name + dim 11px role/age line). Per user: "don't change the sizing of that component." |
| Visible numbering | None — cards do not show `01..0N`. |
| Delete trigger | `×` on the **selected** card only. Selection driven by a new `useSelectedCharacterStore` Zustand slice; clicking a card both selects AND opens the popover/sheet (existing behavior preserved). |
| Inline confirm | Replaces the `×` slot; `Delete` autofocused, `Cancel` ghost. Reuses `<InlineConfirm/>` from PR #47 unchanged. |
| Drag handle | `<GripIcon/>` (PR #47), hover-revealed on the left edge in a separate column; pinned visible when the row is selected or is the drop target. Coarse pointer always visible. |
| Sensors | `PointerSensor` (4px), `KeyboardSensor` (`sortableKeyboardCoordinates`), `TouchSensor` (200ms long-press, 5px tolerance). Identical to chapters. |
| Drop indicator | `ring-1 ring-ink` on the over-row; `opacity-60` on the source row. |
| Backend `orderIndex` | New column on `Character`, `Int NOT NULL`, with `@@unique([storyId, orderIndex])`. New rows get `maxOrderIndex + 1`. No data-migration branch (pre-deployment, per CLAUDE.md). |
| Backend `remove()` | Single `$transaction` with the `[D16]` two-phase swap to repack `0..N-1` on the remainder. Mirrors `chapter.repo.remove()`. |
| Backend `reorder()` | New repo method; new route `PATCH /api/stories/:storyId/characters/reorder`. Same shape and validation as the chapter reorder route. |
| Empty state copy | `"No characters yet"` (drop the broken "Use the + button" copy). The `+` is in the section header right above. |
| Card click contract | Sets `selectedCharacterId` AND calls `onOpenCharacter(id, anchorEl)` (existing behavior). Both happen on the same click. |
| Selection lifecycle | Cleared on chapter switch, story switch, successful delete, and when another card is clicked (replacement). |

---

## Architecture

### Components

- **`<CastSectionHeader/>`** — new file. Stateless. Renders `DRAMATIS PERSONAE` caption + `+` `IconButton`. Props: `onAdd: () => void`, `pending?: boolean`. Lives in its own file so Outline can copy its shape later.
- **`<CastTab/>`** — full rewrite. Owns `reorderStatus`, `deleteStatus`, `pendingDeleteId`, sensors, mutations. Renders header + ordered rows.
- **`<CharRow/>`** (internal to `CastTab.tsx` — replaces v1's `<CharCard>`) — single row. Owns `useInlineConfirm(rowRef)` for delete-confirm state, `useSortable({id})` for drag transform, `data-active`, `data-over` attributes for CSS overrides. The setRefs-merge pattern used by `ChapterRow` is reused.
- **`useSelectedCharacterStore`** — new Zustand slice: `{ selectedCharacterId: string | null, setSelectedCharacterId: (id: string | null) => void }`. Mirrors `useActiveChapterStore` exactly.

### Server state (TanStack Query)

- `charactersQueryKey(storyId)` — drives the cast list, the sidebar `CAST` tab count (already wired in PR #47), and the optimistic delete + reorder updates. Server response shape now includes `orderIndex`.
- `characterQueryKey(storyId, characterId)` — evicted on delete success so a stale hit cannot resurrect deleted body content.
- **No new fetches.**

### Client state (Zustand)

- `useSelectedCharacterStore` — described above. EditorPage clears it on (a) chapter switch, (b) story switch, (c) successful delete callback for the selected id.
- `useSidebarTabStore` — unchanged.

### Selection flow (single user action)

1. User clicks a character card → `onSelect(character.id)`.
2. `EditorPage` sets `selectedCharacterId` AND `openCharacterId` (the latter mounts the popover/sheet).
3. The card re-renders with `data-active="true"`, exposing the `×` and pinning the grip visible.
4. Clicking another card replaces the selection. Outside-click on the row dismisses any open inline-confirm via `useInlineConfirm`'s capture-phase listener; the selection itself only clears on chapter/story switch or successful delete.

### Delete flow (end-to-end)

1. User clicks `×` on the selected card → `useInlineConfirm.ask()` opens. `<InlineConfirm/>` replaces the `×` slot.
2. User clicks Delete (or hits Enter — Delete autofocused) → `onConfirmDelete()` → `onRequestDelete(characterId)`.
3. `handleRequestDelete` in `CastTab`: sets `pendingDeleteId`, calls `deleteCharacter.mutateAsync({ id })`.
4. `useDeleteCharacterMutation.onMutate`: snapshots the list, computes `computeCharactersAfterDelete(prev, id)` (filter + reassign 0..N-1), writes optimistic cache.
5. Backend `DELETE /api/stories/:storyId/characters/:characterId` runs the `$transaction`: delete → load remaining ordered ids → two-phase swap to repack `orderIndex` 0..N-1.
6. On success: `removeQueries({ queryKey: characterQueryKey(storyId, characterId) })`; `confirm.dismiss()`; `setSelectedCharacterId(null)` if the deleted id matched.
7. On error: rollback cache from snapshot; `deleteStatus = 'Delete failed — try again'` via aria-live; confirm stays open for retry.
8. `onSettled`: `invalidateQueries(charactersQueryKey)`.

### Reorder flow

Mirrors the chapter reorder. `DndContext.onDragEnd` reads the cache, pipes through `computeReorderedCharacters(current, activeId, overId)`, and dispatches `useReorderCharactersMutation` with the rewritten list. Optimistic write to cache; backend `PATCH /api/stories/:storyId/characters/reorder` runs the `[D16]` two-phase swap; rollback on error; invalidate on settled.

### Tab count

PR #47 already routes `castCount={charactersQuery.data?.length ?? null}` into `<Sidebar>`. The count updates automatically when the optimistic delete shrinks the cache. **No changes here.**

---

## Visual spec

All token names are existing CSS custom properties in `frontend/src/index.css`. No new tokens.

### Section header (`DRAMATIS PERSONAE +`)

- Container: `flex items-center justify-between px-3 pt-3 pb-1.5`.
- Label: `font-mono text-[11px] tracking-[.08em] uppercase text-ink-4`. Text: `DRAMATIS PERSONAE`. testId `cast-list-section-label`.
- `+` button: `IconButton` 20×20 hit, glyph 14px (existing inline `+` SVG, copy from `ChapterListSectionHeader`). Loading uses `<Spinner size={12}/>` while the create-mutation is pending; disabled in that state. `aria-label="Add character"`. testId `cast-list-add`.
- Always rendered — loading, empty, populated, error.

### Card row container

- Outer is now an `<li>` with `useSortable` wiring (was a `<button>` in v1). Click-to-select moves to a child button.
- Classes: `group relative flex items-center gap-2 px-2 py-2.5 mx-1 mb-1 rounded-[var(--radius)] transition-colors`.
- Idle inactive: `hover:bg-[var(--surface-hover)]`.
- Selected (`data-active="true"`): `bg-[var(--accent-soft)]`. No border.
- Drop target during drag (`data-over="true"`): `ring-1 ring-ink`.
- Source row during drag (`isDragging`): `opacity-60`.
- Width: `w-[calc(100%-8px)]` (preserves v1 visual gutter).
- Height: driven by content (~50px). Per user brief: "don't change the sizing of that component."
- `data-testid={`character-row-${character.id}`}`. `aria-current={active ? 'true' : undefined}` for SR cue.

### Grip column (left edge)

- Slot: `flex-shrink-0`, glyph `<GripIcon/>` 12×14, `text-ink-4 hover:text-ink-2`.
- Visibility: `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`. Pinned visible when `[data-active='true']` or `[data-over='true']` (via the existing index.css rule, extended).
- `cursor-grab touch-none aria-label="Reorder"`. testId `character-row-${id}-grip`.
- The grip is its own column to the LEFT of the avatar — the avatar's circle is not displaced. Card height is preserved.

### Avatar column

- Unchanged from v1. 28×28 (`w-7 h-7`) circular `<span>`, `font-serif italic text-[13px] text-ink`, deterministic `avatarBg(seed)` palette, `border border-[var(--line-2)]`. `aria-hidden`.

### Name + role/age column

- Unchanged from v1. `flex-1 min-w-0`, name line `block text-[13px] font-medium text-ink truncate`, secondary line `block text-[11px] text-ink-4 truncate tracking-[.02em]` (only when `characterSecondary(c).length > 0`).
- Wrapped in a `<button type="button">` so click-to-select fires only on the text/avatar area and doesn't collide with the grip's drag listeners or the trash's click.

### Delete `×` (selected card only)

- `IconButton` reused; glyph is the existing `CloseIcon` from `@/design/primitives` (PR #47 export).
- 20×20 hit, glyph 12×12, `text-ink-3 hover:text-ink hover:bg-[var(--surface-hover)] rounded-[var(--radius)]`.
- Rendered only when `selected === true` AND `confirm.open === false`. Inactive cards omit the element entirely.
- Position: trailing slot (`flex-shrink-0`).
- testId `character-row-${id}-delete`. `aria-label={`Delete ${displayName(character)}`}`.

### Inline confirm (delete state)

- Right-side region (`×`) replaced by `<InlineConfirm/>`.
- Name/role column keeps `min-w-0` and truncates harder; avatar stays put.
- Delete button: `Button variant="danger" size="sm"`, autofocused.
- Cancel button: `Button variant="ghost" size="sm"`.
- Group `role="group" aria-label={`Delete ${displayName(character)}`}`, testId `character-row-${id}-confirm`.

### Empty / loading / error

- Empty: `<p className="font-sans text-[12.5px] text-ink-3 px-3">No characters yet</p>`.
- Loading: existing `role="status" aria-live="polite"` "Loading cast…" caption with `px-3`.
- Error: existing `role="alert"` "Failed to load characters" caption with `px-3`.
- `<CastSectionHeader/>` is rendered above all three states so the `+` is always available.

### `index.css` extension (single targeted edit)

The existing chapter-row rules in `index.css` are extended to also cover character rows. Two selector lists, no new rules:

```css
[data-testid^="chapter-row-"][data-active="true"] [data-testid$="-grip"],
[data-testid^="chapter-row-"][data-over="true"] [data-testid$="-grip"],
[data-testid^="character-row-"][data-active="true"] [data-testid$="-grip"],
[data-testid^="character-row-"][data-over="true"] [data-testid$="-grip"] {
  opacity: 1;
}

@media (pointer: coarse) {
  [data-testid^="chapter-row-"][data-testid$="-grip"],
  [data-testid^="chapter-row-"][data-testid$="-delete"],
  [data-testid^="character-row-"][data-testid$="-grip"],
  [data-testid^="character-row-"][data-testid$="-delete"] {
    opacity: 1;
    min-width: 32px;
    min-height: 32px;
  }
}
```

---

## File plan

### Create

- `docs/superpowers/specs/2026-05-01-cast-redesign-design.md` (this file)
- `backend/prisma/migrations/<timestamp>_add_character_order_index/migration.sql`
- `backend/tests/repos/character.repo.reorder.test.ts`
- `frontend/src/components/CastSectionHeader.tsx`
- `frontend/src/store/selectedCharacter.ts`
- `frontend/tests/store/selectedCharacter.test.ts`
- `frontend/tests/components/CastTab.delete.test.tsx`
- `frontend/tests/components/CastTab.dragA11y.test.tsx`

### Modify

- `backend/prisma/schema.prisma` — `Character` model gains `orderIndex Int` and `@@unique([storyId, orderIndex])`.
- `backend/src/repos/character.repo.ts` — `create` assigns `maxOrderIndex + 1`; new `reorder()`, `maxOrderIndex()`; `remove()` becomes a `$transaction` with two-phase repack; `findManyForStory` orders by `(orderIndex asc, createdAt asc)`.
- `backend/src/routes/characters.routes.ts` — new `PATCH /reorder` endpoint with Zod validation.
- `backend/prisma/seed.ts` — pass `orderIndex` to character creates.
- `backend/tests/routes/characters.test.ts` — extend with reorder + delete-reassignment cases.
- `frontend/src/hooks/useCharacters.ts` — add `useReorderCharactersMutation`, `computeReorderedCharacters`, `computeCharactersAfterDelete`. Extend `useDeleteCharacterMutation` to mirror chapter delete (optimistic reassign + per-character cache eviction + rollback).
- `frontend/src/components/CastTab.tsx` — full rewrite per Section 3.
- `frontend/src/components/CastTab.stories.tsx` — refit to seven variants.
- `frontend/src/pages/EditorPage.tsx` — set `selectedCharacterId` on card click; clear on chapter / story switch; clear on successful delete; pass `onAdd` to `CastSectionHeader` (POST a new character with default name "Untitled" and select it).
- `frontend/src/index.css` — extend the chapter-row coarse-pointer + active-grip selectors to also cover character rows.
- `frontend/tests/components/CastTab.test.tsx` — drop Principal/Supporting assertions, add flat-list + section-header + selection assertions.
- `frontend/tests/hooks/useCharacters.test.tsx` (extend or create) — `computeReorderedCharacters`, `computeCharactersAfterDelete`, `useReorderCharactersMutation`, extended `useDeleteCharacterMutation`.

---

## Testing plan

### Backend

1. **Migration runs cleanly on a fresh test DB.**
   - `cd backend && npm run db:test:reset` exits 0.

2. **`backend/tests/repos/character.repo.reorder.test.ts`** (new)
   - `create assigns sequential orderIndex starting at 0`.
   - `create starts at maxOrderIndex + 1 in stories with existing characters`.
   - `findManyForStory returns characters ordered by (orderIndex asc, createdAt asc)`.
   - `reorder enforces user ownership` — foreign id throws.
   - `reorder runs the two-phase swap correctly under the unique constraint`.
   - `remove deletes the row and reassigns sequential orderIndex 0..N-1`.
   - `remove returns false on a missing id and does not mutate other rows`.
   - `remove refuses to remove another user's character`.
   - Verify: `cd backend && npm run db:test:reset && npm run test -- repos/character.repo.reorder`.

3. **`backend/tests/routes/characters.test.ts`** (extend)
   - `PATCH /reorder returns 204 and the next GET reflects the new order`.
   - `PATCH /reorder returns 400 on duplicate orderIndex values`.
   - `PATCH /reorder returns 403 when one of the ids belongs to another user`.
   - `DELETE /:characterId reassigns sequential orderIndex on the remaining list`.
   - Verify: `cd backend && npm run db:test:reset && npm run test -- routes/characters`.

### Frontend — pure helpers + hook

4. **`frontend/tests/hooks/useCharacters.test.tsx`** (new or extend)
   - `computeReorderedCharacters returns null when overId is null OR active === over`.
   - `computeReorderedCharacters reorders and reassigns 0..N-1`.
   - `computeCharactersAfterDelete returns null when the id is not present`.
   - `computeCharactersAfterDelete removes and reassigns 0..N-1`.
   - `useReorderCharactersMutation PATCHes /reorder and writes optimistic cache; rolls back on 500`.
   - `useDeleteCharacterMutation removes the character optimistically with sequential reassign and evicts the per-character cache on success`.
   - Verify: `cd frontend && npx vitest run tests/hooks/useCharacters`.

### Frontend — Zustand store

5. **`frontend/tests/store/selectedCharacter.test.ts`** (new)
   - Initial state is `null`.
   - `setSelectedCharacterId('abc')` updates.
   - `setSelectedCharacterId(null)` clears.
   - Verify: `cd frontend && npx vitest run tests/store/selectedCharacter`.

### Frontend — components

6. **`frontend/tests/components/CastTab.delete.test.tsx`** (new)
   - `× is only rendered for the selected card`.
   - `clicking × opens InlineConfirm and replaces the × slot`.
   - `Escape dismisses the confirm`.
   - `clicking outside the row dismisses`.
   - `clicking Delete fires DELETE, removes the row optimistically, and clears the selection`.
   - `on 500 the row is restored and aria-live announces failure`.
   - Verify: `cd frontend && npx vitest run tests/components/CastTab.delete`.

7. **`frontend/tests/components/CastTab.test.tsx`** (extend)
   - Drop Principal/Supporting heading assertions.
   - Add: `clicking a card sets selectedCharacterId AND calls onOpenCharacter`.
   - Add: `card renders flat ordered list (no Principal / Supporting headings)`.
   - Add: `DRAMATIS PERSONAE section header is always rendered (loading, empty, populated, error)`.
   - Add: `clicking the + button on the section header POSTs to /characters and selects the new id`.
   - Verify: `cd frontend && npx vitest run tests/components/CastTab`.

8. **`frontend/tests/components/CastTab.dragA11y.test.tsx`** (new)
   - `computeReorderedCharacters` cases (down/up/null/same).
   - Smoke that `KeyboardSensor`, `TouchSensor`, `sortableKeyboardCoordinates` are importable.
   - Verify: `cd frontend && npx vitest run tests/components/CastTab.dragA11y`.

### Frontend — Storybook (refit)

9. **`frontend/src/components/CastTab.stories.tsx`** — 7 variants:
   - `Default` (5 chars, none selected, no Principal/Supporting headers, drag-grips hidden).
   - `WithSelected` (1 selected, `×` visible, grip pinned).
   - `DeleteConfirm` (1 selected, inline `Delete | Cancel` open).
   - `Dragging` (best-effort drop-target ring + dimmed source).
   - `Empty`.
   - `Loading`.
   - `ErrorState`.

### Aggregate verify

- `cd backend && npm run db:test:reset && npm run test`
- `cd frontend && npm run test`
- `cd backend && npx tsc --noEmit`
- `cd frontend && npx tsc --noEmit`
- `npx biome check frontend backend`
- `cd frontend && npm run build-storybook`
- `cd frontend && npx vite build`

### Manual / Playwright (X24 sweep, not CI-gated)

- Mouse: hover any card → grip + (if selected) `×` appear.
- Click: selects + opens popover; `×` appears; Esc/outside dismiss.
- Delete optimistic + rollback paths.
- Keyboard: tab to grip → Space → arrows → Space; Esc cancels.
- Touch: 200ms long-press lifts; small jitter < 200ms still scrolls.
- Add: section-header `+` POSTs and selects the new card.

---

## Risks and rollbacks

- **Risk:** introducing `orderIndex` on `Character` is a schema change. **Mitigation:** pre-deployment per CLAUDE.md, no backfill needed; the `@@unique([storyId, orderIndex])` matches `Chapter`'s pattern exactly; the migration is reviewed by `repo-boundary-reviewer` per project rules.
- **Risk:** dnd-kit `KeyboardSensor` flakiness under jsdom. **Mitigation:** unit-test the pure handler; rely on the X24 Playwright sweep for the real-DOM keyboard reorder path. Same approach as PR #47.
- **Risk:** the new `selectedCharacterId` state could leak between chapters or stories if not cleared. **Mitigation:** EditorPage clears on chapter switch, story switch, and successful delete (three explicit hooks), all covered by component tests.
- **Risk:** `computeCharactersAfterDelete` reassigns optimistically; if the server's reassignment differs (it shouldn't — same algorithm), the next invalidate corrects it.
- **Risk:** click-to-select-AND-open dual contract could feel sticky. **Mitigation:** the popover is the primary interaction the user expects; the selection is the gate for `×` and is intentionally subtle (the row's soft-fill is the only visible cue).

---

## Acceptance criteria

A reviewer should be able to confirm:

1. Cast tab renders a single ordered list — no `Principal` / `Supporting` section headers.
2. `DRAMATIS PERSONAE +` section header is always present; clicking `+` adds a character at the end and selects it (popover opens).
3. Card sizing is unchanged (avatar 28px circle, sans-13 name, dim 11px role/age line).
4. Clicking a card both selects it (soft fill, `×` appears) AND opens the popover/sheet.
5. Clicking the `×` opens an inline `Delete | Cancel`; Delete removes the row optimistically and clears the selection if the deleted character was selected.
6. After deleting a middle character, the remaining `orderIndex` values repack to `0..N-1` (verified by GET).
7. Drag-to-reorder works via mouse, keyboard (Space/arrows/Esc), and touch (200ms long-press).
8. After reorder, the new order persists across reloads (backend stored).
9. The sidebar `CAST` tab count updates with delete and add operations.
10. `CastTab.stories.tsx` renders all seven variants without errors.
11. All aggregate verify commands pass.
