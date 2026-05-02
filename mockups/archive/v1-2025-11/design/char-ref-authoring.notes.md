# CharRef @-trigger menu (addendum)

Closes the [F62] gap: F36 ships the `charRef` mark + F37 hover popover, but
nothing in the editor authors the mark. This menu is the missing affordance.

## Trigger
- `@` in any contenteditable region of the chapter editor opens the menu.
- The menu stays open while the user types alpha-numeric / `_` / `-` /
  `'` characters — these can appear in character names. Space, Enter,
  Escape, or any non-name char closes it. Backspacing through the `@`
  closes it.
- The menu is **never** opened by a programmatic `editor.insertText('@')`
  outside a user keystroke — the suggestion plugin is keystroke-driven by
  default; we don't override that.

## Layout
- Surface: `paper-card` style — `var(--bg-elevated)`, 1px `var(--line-2)`,
  6px radius, 0 4px 16px rgba(0,0,0,.08) shadow. Width 240px (clamps to
  90vw on narrow viewports).
- Each row: 28px tall, 8px horizontal padding, name + optional muted role
  (e.g. "Protagonist", "Antagonist"). Active row gets `var(--surface-hover)`.
- Position: rendered into `document.body` at `position: fixed`, anchored
  to the caret's `clientRect` returned by the suggestion plugin. Default
  placement: 4px below the caret's bottom edge. If the menu would overflow
  the viewport bottom, flip above the caret instead.

## Keyboard
- ↓ / ↑ — move active row (wraps).
- Enter — insert the active item; close the menu.
- Tab — same as Enter (matches Slack / Discord).
- Escape — close without inserting; the typed `@query` stays as plain text.
- Mouse: click on a row inserts that item. The row's `onMouseDown` calls
  `preventDefault()` so the editor selection doesn't collapse before the
  command fires.

## Insertion
The insertion runs in a single editor chain (one undo step):
1. Delete the trigger range `@<query>`.
2. Insert the character's full `name` as a marked text run.
3. Append a single trailing space (unmarked).

The `inclusive: false` flag on the mark + the trailing space ensure the
next typed character is plain text, not part of the mark.

## Empty state
If `useCharactersQuery(activeStoryId)` returns `[]` (or is still loading
and has no cached items), the menu opens with a single muted row reading
"No characters in this story yet." — not selectable; the user can dismiss
with Escape or by typing more characters. Does not block the editor.

## What we deliberately do NOT do (in F62)
- A "Mention character…" entry in the F33 selection bubble — alternative
  was punted; can be added later.
- A keyboard shortcut to open the menu manually with no `@` typed.
- An "add new character" affordance from the menu when no match exists.
- Suggestions on the *first* keystroke before any letter — i.e. `@`
  alone shows the full list of up to 8 characters, not zero.
- Persistence of the typed query across blur/focus.
