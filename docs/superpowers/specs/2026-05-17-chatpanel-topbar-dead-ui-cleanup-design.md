# ChatPanel + TopBar dead-UI cleanup — design

**bd issue:** [story-editor-tv4](../../../.beads/issues.jsonl) — `[ChatPanel] Remove History tab, '+' new-chat button, and duplicate settings icon next to tabs`

**Scope evolution:** The bd issue's three original items have been re-scoped during brainstorming:

- The `'+'` new-chat button is **already gone** (absorbed by `story-editor-n4h` — the chat session dropdown task that this issue depended on).
- `story-editor-9tv` (the related "remove top-right Settings duplicate" task) was **closed as obsolete** — the duplicate we no longer want to remove.
- Two new pieces surfaced in brainstorming: a fully-orphaned `History` button in the TopBar, and a dead `wordCount` display in the TopBar that's about to be removed (cascading to an orphaned ref in EditorPage).

The final scope is four mechanical removals, all under "dead UI cleanup."

## Final scope (4 pieces)

Each piece is independent and lands as its own commit in a single PR.

### Piece A — ChatPanel: drop the History tab

**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/tests/components/ChatPanel.test.tsx`.

The History tab renders a `"History — coming in a future task"` placeholder and has no consumer. Remove:

- The History `<button>` in the chat-tabs `role="tablist"` group at [`ChatPanel.tsx:107-117`](../../../frontend/src/components/ChatPanel.tsx#L107-L117).
- The `activeTab === 'history'` body branch + placeholder text at [`ChatPanel.tsx:139-141`](../../../frontend/src/components/ChatPanel.tsx#L139-L141).
- Narrow `TabId` from `'chat' | 'scene' | 'history'` → `'chat' | 'scene'` at [`ChatPanel.tsx:33`](../../../frontend/src/components/ChatPanel.tsx#L33).
- Refresh the JSDoc block at [`ChatPanel.tsx:2-19`](../../../frontend/src/components/ChatPanel.tsx#L2-L19) — drop references to "Chat / Scene / History", "or a placeholder on History", and "active tab (`chat` | `scene` | `history`)".

Test cleanup in `frontend/tests/components/ChatPanel.test.tsx`:

- Line ~109: drop the History tab presence assertion (likely part of a tab-row enumeration test — narrow to assert Chat/Scene only).
- Lines ~122-141 ("Chat tab is active by default; clicking History flips state"): delete the test entirely.
- Lines ~194-204 ("chatBody is visible on Chat tab and hidden on History tab"): delete the test entirely.
- Lines ~235-243 ("tab order is Chat → Scene → History"): narrow the expected-length assertion from 3 → 2 and drop the History assertion.

### Piece B — ChatPanel: drop the Settings icon

**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/src/pages/EditorPage.tsx`, `frontend/tests/components/ChatPanel.test.tsx`.

The ChatPanel header has a Settings icon button that opens the same modal as the TopBar Settings button and the UserMenu Settings entry. Per `story-editor-9tv`'s closing rationale, we keep TopBar + UserMenu and drop the ChatPanel one.

In `frontend/src/components/ChatPanel.tsx`:

- Remove the entire `.chat-actions` `<div>` (containing the Settings icon button) at [lines 119-129](../../../frontend/src/components/ChatPanel.tsx#L119-L129). The `<header>`'s `justify-between` layout still works — the chat-tabs row floats left with no right-side counterpart.
- Delete the `SlidersIcon` SVG at [lines 35-59](../../../frontend/src/components/ChatPanel.tsx#L35-L59) — only the now-removed Settings button consumed it.
- Drop `onOpenSettings?: () => void;` from `ChatPanelProps` at [line 30](../../../frontend/src/components/ChatPanel.tsx#L30) and the destructure at [line 65](../../../frontend/src/components/ChatPanel.tsx#L65).
- Refresh the JSDoc block — drop "+ `Settings` icon button" from the header description.

In `frontend/src/pages/EditorPage.tsx`:

- Drop the `onOpenSettings={...}` callback passed to `<ChatPanel>` at [lines 602-606](../../../frontend/src/pages/EditorPage.tsx#L602-L606). The other `onOpenSettings` wiring for TopBar at [line 474](../../../frontend/src/pages/EditorPage.tsx#L474) stays.

In `frontend/tests/components/ChatPanel.test.tsx`:

- Delete the test at lines ~143-152 ("Settings button calls onOpenSettings").

### Piece C — TopBar: drop the History button

**Files:** `frontend/src/components/TopBar.tsx`, `frontend/tests/components/TopBar.test.tsx`.

The TopBar History button is fully orphaned: `onToggleHistory` is never passed by any page-level consumer (grep confirms), the click handler has a `// TODO: future history panel` placeholder, and only the unit test exercises the callback.

In `frontend/src/components/TopBar.tsx`:

- Remove the `<button aria-label="History">…<HistoryIcon /></button>` block at [lines 226-237](../../../frontend/src/components/TopBar.tsx#L226-L237).
- **Keep** the `|` separator `<span>` at [lines 222-224](../../../frontend/src/components/TopBar.tsx#L222-L224) — it still meaningfully separates the indicator group on the left (AutosaveIndicator; after Piece D lands, that is the only remaining indicator) from the icon group on the right (Focus + Settings + UserMenu).
- Delete the `HistoryIcon` SVG function at [lines 72-91](../../../frontend/src/components/TopBar.tsx#L72-L91) — only this file consumed it.
- Drop `onToggleHistory?: () => void;` from `TopBarProps` at [line 35](../../../frontend/src/components/TopBar.tsx#L35) and the destructure at [line 139](../../../frontend/src/components/TopBar.tsx#L139).
- Refresh any JSDoc that mentions History.

In `frontend/tests/components/TopBar.test.tsx`:

- Delete the test at lines 129-134 ("clicking History invokes onToggleHistory").

### Piece D — TopBar: drop the word count + EditorPage orphan ref cascade

**Files:** `frontend/src/components/TopBar.tsx`, `frontend/src/pages/EditorPage.tsx`, `frontend/tests/components/TopBar.test.tsx`.

The TopBar word count display duplicates information available elsewhere (ChapterList per-chapter counts, Paper's `storyWordCount` SubRow, sidebar progress footer). Remove the TopBar copy.

**Source verification:** The TopBar `wordCount` prop reads from `activeChapter?.wordCount` — the server-side `Chapter.wordCount` field from the chapters query. That field has multiple other consumers (`ChapterList.tsx:165`, `EditorPage`'s `totalWordCount` sum at line 312, Paper's `storyWordCount`). The TopBar is the *only* consumer of `TopBarProps.wordCount`, so dropping the prop and its callsite is contained. No derivation method is stranded.

**Cascade discovery:** During the sweep, `EditorPage.tsx` was found to carry an orphaned `lastWordCountRef` — declared, set on chapter load and on every Paper `onUpdate`, but **never read**. A stale comment at [line 220](../../../frontend/src/pages/EditorPage.tsx#L220) still claims it "feeds the topbar word-count display", but the actual TopBar wiring at [line 473](../../../frontend/src/pages/EditorPage.tsx#L473) reads the server-side value directly. The orphan ref is cleaned up in this piece as a direct cascade.

In `frontend/src/components/TopBar.tsx`:

- Remove the word-count `<span>` block at [lines 218-220](../../../frontend/src/components/TopBar.tsx#L218-L220).
- Drop `wordCount?: number | null;` from `TopBarProps` at [line 32](../../../frontend/src/components/TopBar.tsx#L32) and the default destructure (`wordCount = null,`) at [line 138](../../../frontend/src/components/TopBar.tsx#L138).

In `frontend/src/pages/EditorPage.tsx`:

- Drop `wordCount={activeChapter?.wordCount ?? null}` at [line 473](../../../frontend/src/pages/EditorPage.tsx#L473).
- Delete the `lastWordCountRef` declaration at [line 178](../../../frontend/src/pages/EditorPage.tsx#L178).
- Delete the `lastWordCountRef.current = 0;` reset at [line 201](../../../frontend/src/pages/EditorPage.tsx#L201).
- Delete the `lastWordCountRef.current = chapterQuery.data.wordCount ?? 0;` seed at [line 210](../../../frontend/src/pages/EditorPage.tsx#L210).
- Rewrite the `[T8.1] Don't send wordCount` rationale comment at [lines 216-220](../../../frontend/src/pages/EditorPage.tsx#L216-L220) — drop the stale "still feeds the topbar word-count display" claim; preserve the substantive `.strict()`-rejection-and-server-recompute rationale.
- Simplify `handlePaperUpdate` at [lines 241-247](../../../frontend/src/pages/EditorPage.tsx#L241-L247) to destructure only `{ bodyJson }`. Paper still passes `{ bodyJson, wordCount }` per its `onUpdate` shape; the callback simply ignores the extra arg. (Reshaping Paper's `onUpdate` is out of scope — see `story-editor-ppn`.)

In `frontend/tests/components/TopBar.test.tsx`:

- Delete the "renders word count" test at line ~64.
- Delete the "omits the word count when wordCount is null" test at lines ~68-71.

## Out of scope

- `'+'` new-chat button — already removed by `story-editor-n4h`.
- TopBar Settings button + UserMenu Settings entry — stay (`story-editor-9tv` closed as obsolete).
- Sidebar progress footer — stays as-is (handles both the no-goal text and the `targetWords` goal + progress bar cases).
- Story `targetWords` field — still in use by `StoryPicker.tsx:94` and the Sidebar footer.
- `countWords` duplication between `Paper.tsx:70` and `Editor.tsx:40` — owned by `story-editor-ppn`. Cleaning this up requires reshaping Paper's `onUpdate` signature, which would push beyond this issue's scope.
- TopBar Focus button — works correctly, stays.
- Broader header / sidebar layout refactors.

## Commit strategy

One PR, four commits, in order A → B → C → D. Each piece is mechanically independent and reviews cleanly on its own. Each touches a different concern.

Commit message format: `[tv4] frontend: <piece summary>`.

## Verify

```
cd frontend && npm run typecheck && npm run test -- tests/components/ChatPanel tests/components/TopBar tests/pages
```

- **Typecheck** catches any consumer still referencing `'history'` as a `TabId`, `onOpenSettings` on `ChatPanelProps`, `onToggleHistory` on `TopBarProps`, or `wordCount` on `TopBarProps`.
- The targeted **test run** catches the test-file edits and the EditorPage-integration cascade in Piece D.

## Notes for the implementer

- Each piece is a delete-plus-test-sweep. No new files. No type design. No new tests beyond updating existing ones.
- Keep the JSDoc updates accurate — these blocks are short and worth getting right, not because the docstring is load-bearing but because contradictory docstrings actively mislead.
- The Piece D cascade (`lastWordCountRef`, `handlePaperUpdate` destructure, stale comment) is real but small — handle in the same commit as the TopBar word-count removal so the diff reads as a single coherent change.
- Don't touch Paper's `onUpdate({ bodyJson, wordCount })` callback shape — that's owned by `story-editor-ppn`.
