# ChatPanel + TopBar dead-UI cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four pieces of dead UI surfaced during `story-editor-c0c` closeout — the ChatPanel History tab, the ChatPanel Settings icon, the TopBar History button, and the TopBar word-count display (plus an orphaned `lastWordCountRef` in EditorPage uncovered by the cascade).

**Architecture:** Four mechanical removals, each independent and confined to one file (with one consumer-callsite update for the two pieces that cross component boundaries). No new types, no new logic, no new tests — only narrowed-or-deleted existing tests. Reviews as four clean structural commits in a single PR.

**Tech Stack:** TypeScript + React + vitest + jsdom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-17-chatpanel-topbar-dead-ui-cleanup-design.md`.

**bd issue:** `story-editor-tv4`.

---

## File map

**Modify (source):**
- `frontend/src/components/ChatPanel.tsx` — Tasks 1, 2
- `frontend/src/components/TopBar.tsx` — Tasks 3, 4
- `frontend/src/pages/EditorPage.tsx` — Tasks 2, 4

**Modify (tests):**
- `frontend/tests/components/ChatPanel.test.tsx` — Tasks 1, 2
- `frontend/tests/components/TopBar.test.tsx` — Tasks 3, 4

No file creations. No file deletions.

---

## Task 1: ChatPanel — drop the History tab

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Test: `frontend/tests/components/ChatPanel.test.tsx`

- [ ] **Step 1: Narrow the `TabId` union and refresh the JSDoc header**

In `frontend/src/components/ChatPanel.tsx`, find the JSDoc block at lines 1-19 and the `TabId` declaration at line 33.

Replace the JSDoc block (lines 1-19) with the History-free version:

```ts
import { type JSX, type ReactNode, useState } from 'react';
/**
 * [F38] Chat panel shell — 360px wide right column.
 *
 * Owns the structural chrome of the AI chat side panel:
 *   - 40px header with `Chat / Scene` pill tabs.
 *   - Body slot for the active tab — `chatBody` ([ChatTab]) on Chat,
 *     `sceneBody` ([SceneTab]) on Scene.
 *   - ModelFooter at the very bottom: model picker button showing the active
 *     model and context-window chip (opens [F42]).
 *
 * The active tab (`chat` | `scene`) is local state — no cross-component need
 * for it yet.
 *
 * Width is set by the F25 grid (`.app-shell` column 3 = 360px). For
 * standalone testing we add `min-w-[360px]` so the panel renders at its
 * intended width without the shell.
 */
import { ModelFooter } from '@/components/ModelFooter';
```

Change `TabId` at line 33 from:

```ts
type TabId = 'chat' | 'scene' | 'history';
```

to:

```ts
type TabId = 'chat' | 'scene';
```

- [ ] **Step 2: Remove the History tab button**

In the same file, find the History `<button>` block in the `chat-tabs` `role="tablist"` group (currently at lines 107-117 — directly after the Scene tab button):

```tsx
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={tabClass(activeTab === 'history')}
            onClick={() => {
              setActiveTab('history');
            }}
          >
            History
          </button>
```

Delete this entire `<button>` block. The remaining tab list contains only Chat and Scene.

- [ ] **Step 3: Remove the History body branch**

In the same file, find the `activeTab === 'history'` body branch (currently at lines 139-141):

```tsx
        {activeTab === 'history' && (
          <div className="px-4 py-6 text-[12px] text-ink-4">History — coming in a future task</div>
        )}
```

Delete those three lines. The remaining body renders only `chatBody` and `sceneBody`.

- [ ] **Step 4: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — the narrowed `TabId` union has no external consumers (it is file-local).

- [ ] **Step 5: Update the ChatPanel test file**

In `frontend/tests/components/ChatPanel.test.tsx`:

a) Find the History tab presence assertion (currently at line 109, inside a tab-row enumeration test):

```ts
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
```

Delete that single line. The two preceding `expect(...)` lines for Chat and Scene tabs stay.

b) Find the test starting around line 122:

```ts
  it('Chat tab is active by default; clicking History flips state', async () => {
    mockModels();
    renderWithProviders(
      <ChatPanel chatBody={<div data-testid="chat-slot">chat</div>} sceneBody={<div />} />,
    );

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    const sceneTab = screen.getByRole('tab', { name: 'Scene' });
    const historyTab = screen.getByRole('tab', { name: 'History' });

    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(sceneTab).toHaveAttribute('aria-selected', 'false');
    expect(historyTab).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(historyTab);

    expect(chatTab).toHaveAttribute('aria-selected', 'false');
    expect(sceneTab).toHaveAttribute('aria-selected', 'false');
    expect(historyTab).toHaveAttribute('aria-selected', 'true');
  });
```

Delete this entire `it(...)` block.

c) Find the test starting around line 194:

```ts
  it('chatBody is visible on Chat tab and hidden on History tab', async () => {
    mockModels();
    renderWithProviders(
      <ChatPanel chatBody={<div data-testid="chat-slot">chat</div>} sceneBody={<div />} />,
    );

    expect(screen.getByTestId('chat-slot')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.queryByTestId('chat-slot')).not.toBeInTheDocument();
    expect(screen.getByText(/history — coming in a future task/i)).toBeInTheDocument();
  });
```

Delete this entire `it(...)` block.

d) Find the test starting around line 235:

```ts
  it('tab order is Chat → Scene → History', () => {
    mockModels();
    renderWithProviders(<ChatPanel chatBody={<div />} sceneBody={<div />} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Chat');
    expect(tabs[1]).toHaveTextContent('Scene');
    expect(tabs[2]).toHaveTextContent('History');
  });
```

Replace it with:

```ts
  it('tab order is Chat → Scene', () => {
    mockModels();
    renderWithProviders(<ChatPanel chatBody={<div />} sceneBody={<div />} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('Chat');
    expect(tabs[1]).toHaveTextContent('Scene');
  });
```

- [ ] **Step 6: Run the ChatPanel test suite**

Run: `npm -w story-editor-frontend test -- tests/components/ChatPanel`
Expected: PASS — the three deleted tests are gone; the narrowed enumeration and tab-order tests assert Chat + Scene only.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/tests/components/ChatPanel.test.tsx
git commit -m "[tv4] frontend: drop ChatPanel History tab"
```

---

## Task 2: ChatPanel — drop the Settings icon

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Test: `frontend/tests/components/ChatPanel.test.tsx`

- [ ] **Step 1: Remove the `SlidersIcon` SVG**

In `frontend/src/components/ChatPanel.tsx`, find the `SlidersIcon` function (currently at lines 35-59):

```tsx
function SlidersIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}
```

Delete the entire function (including its trailing blank line). The only consumer was the Settings button removed in Step 2.

- [ ] **Step 2: Remove the `.chat-actions` div**

In the same file, find the `.chat-actions` `<div>` block (currently at lines 119-129, inside the `<header>`):

```tsx
        <div className="chat-actions flex gap-0.5">
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <SlidersIcon />
          </button>
        </div>
```

Delete the entire `<div>` block. The `<header>`'s `justify-between` layout still works — the chat-tabs row floats left with no right-side counterpart.

- [ ] **Step 3: Remove `onOpenSettings` from props**

In the same file:

a) In the `ChatPanelProps` interface (lines 22-31), delete the `onOpenSettings?` field:

```ts
  /** Click handler for the Settings icon button — opens [F43]. */
  onOpenSettings?: () => void;
```

The interface now has only `chatBody`, `sceneBody`, and `onOpenModelPicker?`.

b) In the function signature (currently lines 61-66), remove `onOpenSettings` from the destructure:

```tsx
export function ChatPanel({
  chatBody,
  sceneBody,
  onOpenModelPicker,
  onOpenSettings,  // ← delete this line
}: ChatPanelProps): JSX.Element {
```

- [ ] **Step 4: Drop the EditorPage callback that fed `onOpenSettings`**

In `frontend/src/pages/EditorPage.tsx`, find the `<ChatPanel>` JSX (currently at lines 596-605):

```tsx
          <ChatPanel
            chatBody={<ChatTab chapterId={activeChapterId} editor={editor} />}
            sceneBody={<SceneTab chapterId={activeChapterId} editor={editor} />}
            onOpenModelPicker={() => {
              useSettingsModalStore.getState().openWith('models');
            }}
            onOpenSettings={() => {
              useSettingsModalStore.getState().openWith();
            }}
          />
```

Delete only the `onOpenSettings={...}` prop (currently lines 602-604). The `chatBody`, `sceneBody`, and `onOpenModelPicker` props stay.

Final shape:

```tsx
          <ChatPanel
            chatBody={<ChatTab chapterId={activeChapterId} editor={editor} />}
            sceneBody={<SceneTab chapterId={activeChapterId} editor={editor} />}
            onOpenModelPicker={() => {
              useSettingsModalStore.getState().openWith('models');
            }}
          />
```

Do NOT touch the other `onOpenSettings={...}` callback at `EditorPage.tsx` line 474 — that one wires the TopBar, which stays.

- [ ] **Step 5: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — the prop was removed from both the interface and every consumer.

- [ ] **Step 6: Delete the Settings-button test**

In `frontend/tests/components/ChatPanel.test.tsx`, find the test starting around line 143:

```ts
  it('Settings button calls onOpenSettings', async () => {
    mockModels();
    const onOpenSettings = vi.fn();
    renderWithProviders(
      <ChatPanel chatBody={<div />} sceneBody={<div />} onOpenSettings={onOpenSettings} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
```

Delete this entire `it(...)` block.

- [ ] **Step 7: Run the ChatPanel test suite**

Run: `npm -w story-editor-frontend test -- tests/components/ChatPanel`
Expected: PASS — the Settings-button test is gone, no other test depended on the icon.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/ChatPanel.test.tsx
git commit -m "[tv4] frontend: drop ChatPanel Settings icon"
```

---

## Task 3: TopBar — drop the History button

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`
- Test: `frontend/tests/components/TopBar.test.tsx`

- [ ] **Step 1: Remove the `HistoryIcon` SVG**

In `frontend/src/components/TopBar.tsx`, find the `HistoryIcon` function (currently at lines 72-91):

```tsx
function HistoryIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
```

Delete the entire function (and the trailing blank line). The only consumer was the History button removed in Step 3.

- [ ] **Step 2: Remove `onToggleHistory` from props**

In the same file:

a) In the `TopBarProps` interface, find and delete the `onToggleHistory?` field (currently at line 35):

```ts
  onToggleHistory?: () => void;
```

b) In the function signature (currently around line 139), remove `onToggleHistory` from the destructure:

```tsx
  onToggleHistory,  // ← delete this line
```

- [ ] **Step 3: Remove the History button (keep the separator)**

In the same file, find the History button block (currently at lines 226-237):

```tsx
        <button
          type="button"
          className="icon-btn"
          aria-label="History"
          title="History"
          onClick={() => {
            // TODO: future history panel
            onToggleHistory?.();
          }}
        >
          <HistoryIcon />
        </button>
```

Delete this entire `<button>` block. **Do NOT delete** the `<span>` separator immediately above it (lines 222-224):

```tsx
        <span className="text-ink-5" aria-hidden="true">
          |
        </span>
```

The separator stays — it still meaningfully separates the indicator group on the left (AutosaveIndicator + word count, until Task 4 lands; AutosaveIndicator only after Task 4) from the icon group on the right (Focus + Settings + UserMenu).

- [ ] **Step 4: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — `onToggleHistory` is never passed by any page-level consumer (verified by grep during brainstorming; the prop is leaf-level).

- [ ] **Step 5: Update the TopBar test file**

In `frontend/tests/components/TopBar.test.tsx`:

a) Find the enumeration test starting at line 73:

```ts
  it('renders the History, Focus, and Settings icon buttons with aria-labels', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
```

Replace it with:

```ts
  it('renders the Focus and Settings icon buttons with aria-labels', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
```

b) Find the test starting at line 129:

```ts
  it('clicking History invokes onToggleHistory', async () => {
    const onToggleHistory = vi.fn();
    render(<TopBar {...baseProps} onToggleHistory={onToggleHistory} />);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
  });
```

Delete this entire `it(...)` block.

- [ ] **Step 6: Run the TopBar test suite**

Run: `npm -w story-editor-frontend test -- tests/components/TopBar`
Expected: PASS — the History test is gone; the narrowed enumeration test asserts Focus + Settings only.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/tests/components/TopBar.test.tsx
git commit -m "[tv4] frontend: drop TopBar History button"
```

---

## Task 4: TopBar — drop the word count + EditorPage orphan ref cascade

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Test: `frontend/tests/components/TopBar.test.tsx`

- [ ] **Step 1: Refresh the TopBar file-header line comment**

In `frontend/src/components/TopBar.tsx`, the very first line currently reads:

```ts
// [F26] Top bar — brand · breadcrumbs · save indicator · word count · icon buttons · user menu.
```

Change it to:

```ts
// [F26] Top bar — brand · breadcrumbs · save indicator · icon buttons · user menu.
```

(This is a `//` line comment, not a `/** */` JSDoc block, so it would otherwise be missed in a JSDoc-only sweep.)

- [ ] **Step 2: Remove `wordCount` from `TopBarProps`**

In the same file:

a) In the `TopBarProps` interface, find and delete the `wordCount?` field (currently at line 32):

```ts
  wordCount?: number | null;
```

b) In the function signature (currently around line 138), remove the `wordCount = null,` default from the destructure:

```tsx
  wordCount = null,  // ← delete this line
```

- [ ] **Step 3: Remove the word-count `<span>` from the render**

In the same file, find the word-count block in the `.meta` group (currently at lines 218-220):

```tsx
        {wordCount != null ? (
          <span className="font-mono text-[12px]">{wordCount.toLocaleString()} words</span>
        ) : null}
```

Delete the entire conditional block. The remaining `.meta` group keeps the AutosaveIndicator, the separator `|`, and the icon buttons.

- [ ] **Step 4: Drop the EditorPage callsite**

In `frontend/src/pages/EditorPage.tsx`, find the `<TopBar>` JSX. Currently around line 473 you will see:

```tsx
            wordCount={activeChapter?.wordCount ?? null}
```

Delete this single prop line. The other `<TopBar>` props stay.

- [ ] **Step 5: Cascade — delete the orphaned `lastWordCountRef`**

In the same file (`frontend/src/pages/EditorPage.tsx`):

a) Find the `lastWordCountRef` declaration (currently at line 178):

```tsx
  const lastWordCountRef = useRef<number>(0);
```

Delete this line.

b) Find the reset (currently at line 201, inside a chapter-switch effect):

```tsx
      lastWordCountRef.current = 0;
```

Delete this line.

c) Find the seed (currently at line 210, inside a chapter-load effect):

```tsx
    lastWordCountRef.current = chapterQuery.data.wordCount ?? 0;
```

Delete this line.

d) Find the `handleSave` rationale comment block (currently around lines 216-220):

```tsx
      // [T8.1] Don't send `wordCount` — the backend's `UpdateChapterBody`
      // schema is `.strict()` and rejects the extra key with 400, and the
      // chapter route already recomputes wordCount server-side from
      // `bodyJson` (see `chapters.routes.ts:242`). The local
      // `lastWordCountRef` still feeds the topbar word-count display.
```

Replace with the substantive-rationale-only version (drop the stale topbar claim):

```tsx
      // [T8.1] Don't send `wordCount` — the backend's `UpdateChapterBody`
      // schema is `.strict()` and rejects the extra key with 400, and the
      // chapter route already recomputes wordCount server-side from
      // `bodyJson` (see `chapters.routes.ts:242`).
```

e) Find `handlePaperUpdate` (currently around lines 241-247):

```tsx
  const handlePaperUpdate = useCallback(
    ({ bodyJson, wordCount }: { bodyJson: JSONContent; wordCount: number }): void => {
      lastWordCountRef.current = wordCount;
      setDraftBodyJson(bodyJson);
    },
    [],
  );
```

Replace with the simplified version (destructure only `bodyJson`; Paper still passes both args but the callback ignores `wordCount`):

```tsx
  const handlePaperUpdate = useCallback(
    ({ bodyJson }: { bodyJson: JSONContent; wordCount: number }): void => {
      setDraftBodyJson(bodyJson);
    },
    [],
  );
```

(The parameter type keeps the full `{ bodyJson; wordCount }` shape because Paper's `onUpdate` callback still passes both fields — only the destructure narrows. This avoids reshaping Paper's `onUpdate` signature, which is owned by `story-editor-ppn`.)

- [ ] **Step 6: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — `lastWordCountRef` had no readers (verified during brainstorming), so deleting it does not strand any reference. `handlePaperUpdate`'s parameter type still matches Paper's callback shape.

- [ ] **Step 7: Update the TopBar test file**

In `frontend/tests/components/TopBar.test.tsx`:

a) Find the test starting at line 63:

```ts
  it('renders the word count formatted with a thousands separator', () => {
    render(<TopBar {...baseProps} wordCount={12345} />);
    expect(screen.getByText('12,345 words')).toBeInTheDocument();
  });
```

Delete this entire `it(...)` block.

b) Find the test starting at line 68:

```ts
  it('omits the word count when wordCount is null', () => {
    render(<TopBar {...baseProps} wordCount={null} />);
    expect(screen.queryByText(/words$/)).not.toBeInTheDocument();
  });
```

Delete this entire `it(...)` block.

- [ ] **Step 8: Run the TopBar test suite**

Run: `npm -w story-editor-frontend test -- tests/components/TopBar`
Expected: PASS — both word-count tests are gone, no other TopBar test asserts on word-count.

- [ ] **Step 9: Run the pages integration test suite (catches the EditorPage cascade)**

Run: `npm -w story-editor-frontend test -- tests/pages`
Expected: PASS — `lastWordCountRef` was never read, so deleting it and narrowing `handlePaperUpdate`'s destructure does not change any observable behavior.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/TopBar.test.tsx
git commit -m "[tv4] frontend: drop TopBar word count + EditorPage orphan ref"
```

---

## Final verification

After all four tasks complete, run the spec's full verify line:

```
cd frontend && npm run typecheck && npm run test -- tests/components/ChatPanel tests/components/TopBar tests/pages
```

Expected: PASS — typecheck clean; all targeted test suites green.

Then run `/bd-close-reviewed story-editor-tv4` to fan the surface reviewers, run the typecheck-affected-workspaces pass, and close the bd issue.

---

## Notes for the implementer

- Each task is a delete-plus-test-sweep with no new files and no new behavior. The "TDD" pattern of "write a failing test first" inverts here — you remove the source, observe that existing tests now reference dead UI, and update them. Typecheck is the leading signal at each step.
- The line numbers cited above are from the spec snapshot. As earlier tasks edit the file, line numbers shift — use the surrounding code context (interface name, function name, JSX text) to relocate the right spot rather than the line number alone.
- Don't touch the other `onOpenSettings={...}` callback in `EditorPage.tsx` (for TopBar, around line 474). That one stays.
- Don't touch Paper's `onUpdate({ bodyJson, wordCount })` callback signature — that dedup is owned by `story-editor-ppn`.
- The Piece D cascade (`lastWordCountRef`, `handlePaperUpdate` destructure, stale comment) belongs in the same commit as the TopBar word-count removal so the diff reads as a single coherent change.
- Commit messages: `[tv4] frontend: <piece summary>`.
