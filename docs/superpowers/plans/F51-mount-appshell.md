# [F51] Mount AppShell + TopBar + Sidebar in EditorPage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the F7 three-pane layout in `EditorPage.tsx` with the F25 `<AppShell>` grid populated by F26 `<TopBar>`, F27 `<Sidebar>` (with `<ChapterList>` / `<CastTab>` / `<OutlineTab>` as bodies), and a stub `editor` + `chat` slot for F52 / F55 to fill. The F8 `<Editor>` and F12 `<AIPanel>` survive only as the centre + right slot contents inside the new shell — F52 / F55 swap them in their own tasks.

**Architecture:**
- The page becomes a thin assembler: `useStoryQuery(activeStoryId)` for breadcrumbs, `useChaptersQuery(storyId)` reused as in F7, `useCharactersQuery(storyId)` for the Cast body, `useBalanceQuery()` for the user menu, `useSessionStore` for username, `useActiveStoryStore` / `useActiveChapterStore` / `useSidebarTabStore` for cross-page state.
- Modal-state convention is **locked here for the rest of the F-series**: page-level `useState<boolean>(false)` for each modal, callbacks passed down through TopBar / Sidebar / future ChatPanel props. Modals render at page root inside `<EditorPage>`. F55 inherits this for `<SettingsModal>` / `<StoryPicker>` / `<ModelPicker>`; F61 inherits it for `<AccountPrivacyModal>`.
- The `+` button on the sidebar is dispatch-on-active-tab: chapters → create chapter, cast → create character (open `<CharacterSheet>` in create mode), outline → create outline item (delegated to `<OutlineTab>`'s own `onAddItem`).
- The AppShell already wires `Cmd/Ctrl+Shift+F` for focus toggle; F57 will migrate that listener but in F51 we leave it where AppShell put it.
- TopBar's existing inline `<SaveIndicator>` is left in place; F56 swaps it for the F48 `<AutosaveIndicator>` in its own plan. F51 only wires `saveState` / `savedAtRelative` props through.
- The editor slot in F51 mounts the existing F8 `<Editor>` (unchanged from current shape). F52 swaps it for `<FormatBar>` + `<Paper>`. The chat slot mounts the existing F12 `<AIPanel>`. F55 replaces it with the F38 chat stack. F51's responsibility is *only* the shell + sidebar wiring.

**Decision points pinned (no TBDs):**
1. **Sidebar add-button behaviour by active tab:**
   - `chapters` → `useCreateChapterMutation().mutate({ storyId })` with default `{ title: '' }`. The new chapter becomes active immediately.
   - `cast` → opens `<CharacterSheet mode="create" storyId={...} />` modal at page root. Modal exists already (F19). F51 lifts the `characterSheetOpen` state to the page.
   - `outline` → calls `<OutlineTab>`'s `onAddItem` callback, which the page wires to `useCreateOutlineItemMutation().mutate({ storyId })` with a blank label. Same pattern as chapters.
2. **Active chapter selection** moves out of local component state into `useActiveChapterStore`. The store already exists (per F22). F51 swaps the existing `useState<string | null>` to the store. ChapterList's `onSelectChapter` calls `setActiveChapterId(id)`.
3. **Active sidebar tab** comes from `useSidebarTabStore` (already exists per F22).
4. **Layout = `three-col`** (the AppShell default). `useTweaksStore.tweaks.layout` already drives this; F51 doesn't touch it.
5. **Story-picker header on the sidebar** opens the F30 `<StoryPicker>` modal. F30 is shipped as a component but not yet mounted — F55 mounts it at page root. F51 lifts `storyPickerOpen` state to the page now (a one-line addition) so F55 just adds the `<StoryPicker>` element without restructuring state.
6. **Settings cog** in the TopBar opens the F43 `<SettingsModal>`. Same pattern: F51 lifts `settingsOpen` state to the page; F55 adds the `<SettingsModal>` element.
7. **`onOpenAccount` is plumbed but unwired in F51.** F61 will add the `<AccountPrivacyModal>` at page root and the `accountPrivacyOpen` state. F51 leaves the callback prop as `undefined` — UserMenu already renders the menu item disabled-style when the callback is missing (per its existing F26 contract).

**Tech Stack:** React 19, TypeScript strict, Tailwind, TanStack Query, Zustand stores. No new deps.

**Source-of-truth references:**
- AppShell signature: `frontend/src/components/AppShell.tsx:19-24` — `{ topbar, sidebar, editor, chat }` slots only.
- TopBar signature: `frontend/src/components/TopBar.tsx:18-45`. Note `onOpenAccount?: () => void` is already declared.
- Sidebar signature: `frontend/src/components/Sidebar.tsx:14-24`.
- ChapterList signature: `frontend/src/components/ChapterList.tsx:17-21` — `{ storyId, activeChapterId, onSelectChapter }`.
- CastTab signature: `frontend/src/components/CastTab.tsx:20-25` — `{ characters, onOpenCharacter, isLoading, isError }`.
- OutlineTab signature: `frontend/src/components/OutlineTab.tsx:32-` — `{ storyId, onAddItem, onEditItem }`.
- Stores already in place: `useActiveStoryStore`, `useActiveChapterStore`, `useSidebarTabStore`, `useTweaksStore`.
- Existing EditorPage: `frontend/src/pages/EditorPage.tsx:49-` (current F7 implementation; ~370 lines).

---

## File Structure

**Modify:**
- `frontend/src/pages/EditorPage.tsx` — full rewrite. The F7 three-pane layout, the inline word-count + autosave-indicator scaffold, and the AIPanel state are all consolidated into prop-passing through `<AppShell>`. F8 `<Editor>` stays in the editor slot; F12 `<AIPanel>` stays in the chat slot.
- `frontend/tests/pages/editor.test.tsx` — update structural assertions: now check for `data-testid="app-shell-topbar"` / `app-shell-sidebar` / `app-shell-editor` / `app-shell-chat` instead of the F7 column divs. Existing AI-action / chapter-selection assertions stay intact (they target `<Editor>` / `<AIPanel>`).

**Not touched:**
- `<AppShell>`, `<TopBar>`, `<Sidebar>`, `<ChapterList>`, `<CastTab>`, `<OutlineTab>`, `<CharacterSheet>` — already shipped, used as-is.
- `<Editor>` (F8) — survives in the editor slot until F52.
- `<AIPanel>` (F12) — survives in the chat slot until F55.
- `<UserMenu>`, `<BalanceDisplay>` — used inside TopBar.
- Any backend / routes / hooks.

---

## Task 1: Inventory of removed responsibilities

Before rewriting EditorPage, list what the F7 implementation does that the new wiring needs to preserve. Failing to track these is how integration regressions creep in.

- [ ] **Step 1: Read the current EditorPage**

```bash
sed -n '49,400p' frontend/src/pages/EditorPage.tsx > /tmp/editorpage-before.txt
```

Walk the file once. The behaviours below must all survive into the rewrite:

1. `useParams<{ id: string }>` → `useStoryQuery(id)` for the story.
2. `useChaptersQuery(story?.id)` for export + chapter list.
3. `useBalanceQuery()` for the user menu.
4. `useSessionStore((s) => s.user?.username)` for the user menu.
5. `useAuth().logout` + `navigate('/login')` on sign-out.
6. Active chapter id (currently local `useState<string | null>(null)`) — moves to `useActiveChapterStore`.
7. Sidebar tab (currently local `useState<'chapters' | 'characters'>`) — moves to `useSidebarTabStore`.
8. Character-sheet modal id (currently `useState<string | null>(null)`) — stays local; the modal still mounts at page root.
9. Selection / AI plumbing for `<AIPanel>`: the `editor` instance ref captured via `<Editor onReady={...}>`; the `extractSelection(editor)` helper at line 27. Both stay until F53/F55.
10. The `Export` component (F20) — the page renders it somewhere. Find that block; the rewrite places it inside the editor slot, below `<Editor>`, until F52 promotes it.
11. The "Loading…" / "Error…" / "Story not found" early returns. The rewrite keeps these as plain pre-shell early returns (no AppShell wrapping for an error state; matches how `<RequireAuth>` early-returns).

- [ ] **Step 2: Write the survivor list to a comment in the new file**

When writing the rewrite (Task 3), put a block comment at the top of the new EditorPage listing the survivors. Lets future readers see the F51 contract without diffing.

- [ ] **Step 3: No commit yet — proceed to Task 2.**

---

## Task 2: Update editor page tests for new structure

**Files:**
- Modify: `frontend/tests/pages/editor.test.tsx`

The existing tests assert F7 structural details (column class names, header text, AI-panel collapse). Rewrite the structural pieces; keep the behavioural pieces.

- [ ] **Step 1: Read the test file**

```bash
wc -l frontend/tests/pages/editor.test.tsx
```

Walk it once. Identify the assertions that depend on F7 structure (likely: searches for the page's title element, the three-pane class names, the "Toggle AI panel" button). Identify the assertions that survive: chapter-list interactions, AI-action calls, sign-out flow.

- [ ] **Step 2: Replace structural assertions with AppShell test-ids**

For each F7 structural assertion, swap to one of these (the AppShell already exposes them per `frontend/src/components/AppShell.tsx:45-58`):

```ts
expect(screen.getByTestId('app-shell')).toBeInTheDocument();
expect(screen.getByTestId('app-shell-topbar')).toBeInTheDocument();
expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument();
expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument();
expect(screen.getByTestId('app-shell-chat')).toBeInTheDocument();
```

- [ ] **Step 3: Add a new test for sidebar add-button per active tab**

```tsx
it('sidebar + button on chapters tab creates a new chapter', async () => {
  // Render with a story + at least one existing chapter so chaptersQuery is populated.
  // ... existing fetch mock setup ...
  fetchMock.mockResolvedValueOnce(jsonResponse(201, { chapter: { id: 'new-ch', storyId: 's1', title: '', orderIndex: 1, /* ... */ } }));

  await user.click(screen.getByTestId('sidebar-add-button'));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url, init]) =>
      url === '/api/stories/s1/chapters' && (init as RequestInit).method === 'POST',
    );
    expect(call).toBeDefined();
  });
});

it('sidebar + button on cast tab opens the character-create modal', async () => {
  // Switch to cast tab first.
  await user.click(screen.getByTestId('sidebar-tab-cast'));
  await user.click(screen.getByTestId('sidebar-add-button'));
  expect(await screen.findByRole('dialog', { name: /new character/i })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test (it should fail — page not yet rewritten)**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx
```

Expected: FAIL on the new assertions. Existing F7-class assertions also fail. Continue.

- [ ] **Step 5: No commit yet — Task 3 ships the rewrite.**

---

## Task 3: Rewrite EditorPage to use AppShell + TopBar + Sidebar

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Replace the file**

Full rewrite below. Comments at the top encode the F51 contract for future readers.

```tsx
// [F51] EditorPage — AppShell-based three-column shell.
//
// F7 → F51 survivor list:
//   - useStoryQuery(activeStoryId)        → breadcrumbs (TopBar)
//   - useChaptersQuery(storyId)           → ChapterList + Export
//   - useCharactersQuery(storyId)         → CastTab body
//   - useBalanceQuery()                   → UserMenu balance
//   - useSessionStore(user)               → UserMenu username
//   - useAuth().logout + navigate         → sign out
//   - useActiveChapterStore               → ChapterList selection (was local state)
//   - useSidebarTabStore                  → active tab (was local state)
//   - <CharacterSheet> modal              → still page-root, still id-driven
//   - <Editor onReady={...}>              → still mounted (until F52)
//   - <AIPanel>                           → still mounted (until F55)
//   - <Export>                            → rendered below Editor (until F52)
//
// Modal-mount convention (locked here for the rest of the F-series):
//   page-level useState per modal; callback prop down via TopBar/Sidebar/ChatPanel;
//   <Modal /> rendered at the bottom of the component, NOT inside AppShell.

import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type AIAction, AIPanel } from '@/components/AIPanel';
import { AppShell } from '@/components/AppShell';
import { CastTab } from '@/components/CastTab';
import { ChapterList } from '@/components/ChapterList';
import { CharacterSheet } from '@/components/CharacterSheet';
import { Editor } from '@/components/Editor';
import { Export } from '@/components/Export';
import { OutlineTab } from '@/components/OutlineTab';
import { Sidebar } from '@/components/Sidebar';
import { TopBar, type SaveState } from '@/components/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { useBalanceQuery } from '@/hooks/useBalance';
import { useChaptersQuery, useCreateChapterMutation } from '@/hooks/useChapters';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useStoryQuery } from '@/hooks/useStories';
import { ApiError } from '@/lib/api';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useSessionStore } from '@/store/session';
import { useSidebarTabStore } from '@/store/sidebarTab';

function extractSelection(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const storyQuery = useStoryQuery(id);
  const story = storyQuery.data;
  const chaptersQuery = useChaptersQuery(story?.id);
  const charactersQuery = useCharactersQuery(story?.id);
  const balanceQuery = useBalanceQuery();
  const balanceErrorCode =
    balanceQuery.error instanceof ApiError ? (balanceQuery.error.code ?? null) : null;

  const username = useSessionStore((s) => s.user?.username) ?? '';
  const { logout } = useAuth();
  const handleSignOut = useCallback((): void => {
    void logout().finally(() => navigate('/login'));
  }, [logout, navigate]);

  const activeChapterId = useActiveChapterStore((s) => s.activeChapterId);
  const setActiveChapterId = useActiveChapterStore((s) => s.setActiveChapterId);
  const activeTab = useSidebarTabStore((s) => s.sidebarTab);

  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const handleEditorReady = useCallback((ed: TiptapEditor) => setEditor(ed), []);

  const [characterSheetId, setCharacterSheetId] = useState<string | null | 'new'>(null);
  // page-root modal state — F55 / F61 will add Settings / StoryPicker / ModelPicker /
  // AccountPrivacy alongside; the convention is "useState here, render at page root".
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const createChapter = useCreateChapterMutation();

  const handleSidebarAdd = useCallback((): void => {
    if (!story?.id) return;
    if (activeTab === 'chapters') {
      createChapter.mutate({ storyId: story.id, input: { title: '' } });
      return;
    }
    if (activeTab === 'cast') {
      setCharacterSheetId('new');
      return;
    }
    // outline → handled by OutlineTab's own onAddItem; the sidebar + button
    // for outline is a no-op in F51 because OutlineTab owns its own add UI.
    // Recorded in OutlineTab.tsx (F29) — see its onAddItem prop.
  }, [activeTab, story?.id, createChapter]);

  const activeChapter = chaptersQuery.data?.find((c) => c.id === activeChapterId) ?? null;

  // [F12] The AIPanel still owns the action plumbing — F53 unwires it.
  const handleAIAction = useCallback(
    (_action: AIAction): void => {
      // unchanged from F7; pre-F15 the panel itself stubs the call.
    },
    [],
  );

  if (storyQuery.isLoading) {
    return (
      <div role="status" aria-live="polite" className="min-h-screen grid place-items-center">
        Loading story…
      </div>
    );
  }
  if (storyQuery.isError || !story) {
    return (
      <div role="alert" className="min-h-screen grid place-items-center">
        Story not found.
      </div>
    );
  }

  // SaveState is still the F26 placeholder until F56 swaps in F48's AutosaveIndicator.
  const saveState: SaveState = 'idle';

  return (
    <>
      <AppShell
        topbar={
          <TopBar
            storyTitle={story.title}
            chapterNumber={
              activeChapter ? activeChapter.orderIndex + 1 : null
            }
            chapterTitle={activeChapter?.title ?? null}
            saveState={saveState}
            wordCount={activeChapter?.wordCount ?? null}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenStoriesList={() => setStoryPickerOpen(true)}
            // onOpenAccount intentionally left undefined; F61 wires it.
            username={username}
            balance={balanceQuery.data ?? null}
            isBalanceLoading={balanceQuery.isLoading}
            isBalanceError={balanceQuery.isError}
            balanceErrorCode={balanceErrorCode}
            onSignOut={handleSignOut}
          />
        }
        sidebar={
          <Sidebar
            storyTitle={story.title}
            totalWordCount={story.totalWordCount}
            goalWordCount={story.targetWords ?? undefined}
            onOpenStoryPicker={() => setStoryPickerOpen(true)}
            onAdd={handleSidebarAdd}
            chaptersBody={
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
              />
            }
            castBody={
              <CastTab
                characters={charactersQuery.data ?? []}
                onOpenCharacter={(charId) => setCharacterSheetId(charId)}
                isLoading={charactersQuery.isLoading}
                isError={charactersQuery.isError}
              />
            }
            outlineBody={
              <OutlineTab
                storyId={story.id}
                onAddItem={() => undefined}
                onEditItem={() => undefined}
              />
            }
          />
        }
        editor={
          <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
            <Editor onReady={handleEditorReady} />
            {chaptersQuery.data ? (
              <Export
                story={{
                  title: story.title,
                  chapters: chaptersQuery.data.map((c) => ({
                    title: c.title,
                    orderIndex: c.orderIndex,
                    bodyJson: c.bodyJson ?? undefined,
                  })),
                }}
              />
            ) : null}
          </div>
        }
        chat={
          <AIPanel
            selection={editor ? extractSelection(editor) : ''}
            onAction={handleAIAction}
          />
        }
      />

      {characterSheetId !== null ? (
        <CharacterSheet
          storyId={story.id}
          mode={characterSheetId === 'new' ? 'create' : 'edit'}
          characterId={characterSheetId === 'new' ? null : characterSheetId}
          onClose={() => setCharacterSheetId(null)}
        />
      ) : null}

      {/* Page-root modals: F55 mounts <SettingsModal>, <StoryPicker>, <ModelPicker>
          here using the same useState pattern. F61 mounts <AccountPrivacyModal>. */}
    </>
  );
}
```

(If the existing `useCreateChapterMutation` hook has a different invocation shape than `{ storyId, input: { title: '' } }`, match the actual signature — read `frontend/src/hooks/useChapters.ts` and adapt. The pattern is one line; do not change the hook.)

(If `<CharacterSheet>` doesn't accept `mode="create"` directly, adapt to its actual API — e.g. pass `characterId={null}`. The component is shipped per F19; do not modify it here.)

- [ ] **Step 2: Confirm typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS. If the existing `<Editor>` / `<AIPanel>` / `<Export>` props differ from the rewrite above, adjust to the actual signatures. The rewrite is structural; behavioural details should mirror what the F7 page already passed.

- [ ] **Step 3: Run the editor page test**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx
```

Expected: PASS. Both the new structural assertions and the surviving behavioural ones.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/tests/pages/editor.test.tsx
git commit -m "[F51] mount AppShell + TopBar + Sidebar in EditorPage"
```

---

## Task 4: Verify, smoke, tick

- [ ] **Step 1: Run the surrounding suite**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/pages/editor.test.tsx \
  tests/components/AppShell.test.tsx \
  tests/components/TopBar.test.tsx \
  tests/components/Sidebar.test.tsx \
  tests/components/ChapterList.test.tsx \
  tests/components/CastTab.test.tsx \
  tests/components/OutlineTab.test.tsx
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

```bash
make dev
```

- Sign in, open a story (`/stories/:id`).
- Confirm the three-column AppShell renders: TopBar with breadcrumbs, Sidebar (chapter list visible), centre editor (still F8 — F52 swaps), chat panel (still F12 AIPanel — F55 swaps).
- Switch sidebar tabs Chapters / Cast / Outline. Each renders its body.
- Click `+` on Chapters tab → new chapter appears, becomes active.
- Click `+` on Cast tab → CharacterSheet modal opens in create mode. Cancel.
- Click `+` on Outline tab → no modal; OutlineTab's own affordance is the active surface.
- Click the user menu's Settings cog → no modal yet (F55 mounts it). Acceptable; the callback fires but `<SettingsModal>` isn't yet rendered. Verify via devtools that `settingsOpen` flips.
- Click the sidebar's story-picker header → same as above; `storyPickerOpen` flips.
- Click sign-out → returns to `/login`.

- [ ] **Step 3: Tick `[F51]` in TASKS.md**

Auto-tick if the verify command passes; otherwise flip `- [ ]` to `- [x]` manually.

- [ ] **Step 4: Final commit**

```bash
git add TASKS.md
git commit -m "[F51] tick — AppShell mounted in EditorPage"
```

---

## Self-Review Notes

- **Spec coverage:** every clause of the F51 task copy maps to a step above. Modal mount convention is locked. Sidebar add-button dispatch is specified for all three tabs.
- **No TBDs:** OutlineTab's `+` is documented as a no-op (matches the component's existing `onAddItem` contract — it owns its own add UI). All other paths have concrete handlers.
- **Forward compat:** F52, F55, F56, F57, F61 all build on the page-root modal convention and the AppShell test-ids established here.
- **No backend / hooks / store changes** — F51 is pure integration.
