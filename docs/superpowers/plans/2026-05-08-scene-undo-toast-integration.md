# SceneUndoToast Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `bg-ink` slab undo toast in `SceneTab` with the new `SceneUndoToast` component, repositioned to a floating overlay pinned just above the `SceneComposer` so the `SceneSessionPicker` dropdown no longer occludes it.

**Architecture:** The new `SceneUndoToast` component (`frontend/src/components/SceneUndoToast.tsx`) and its keyframes (`.scene-undo-countdown` in `frontend/src/index.css`) already exist from the design-mock pass and are linted clean. This plan wires them into `SceneTab.tsx`: the existing `lastUndoEntry` IIFE and inline JSX (lines 297–349) are replaced with a render call to `<SceneUndoToast/>`, positioned absolutely inside the SceneTab's `flex flex-col h-full` container, anchored above the composer. The component is purely presentational; the soft-delete state machine in `useSoftDelete` is unchanged.

**Tech Stack:** React 19, TypeScript, TailwindCSS (token-only via `frontend/scripts/lint-design.mjs`), Vitest + Testing Library (jsdom), Storybook 9.

---

## File Structure

- **Modify:** `frontend/src/components/SceneTab.tsx` — remove the inline toast JSX (lines 333–349) and the `lastUndoEntry` IIFE (lines 297–301); add `SceneUndoToast` import and a positioned overlay just before the closing `</div>` of the SceneTab container. The container needs `relative` positioning to anchor the overlay.
- **Modify:** `frontend/tests/components/SceneTab.test.tsx` — add a test that renders the toast on soft-delete and asserts the new component's accessible markup (`Deleted` tag + scene title + Undo button). The file already mocks the relevant stack; we only add a test case.
- **Reference (no edit):** `frontend/src/components/SceneUndoToast.tsx`, `frontend/src/components/SceneUndoToast.stories.tsx`, `frontend/src/index.css` — already in place.

The integration is a single-file refactor in `SceneTab.tsx`; it does not introduce any new abstractions. The existing `useSoftDelete` hook, its `pendingDeletes` map, and the `onUndo` callback are reused verbatim.

---

## Pre-flight

- [ ] **Step 0: Verify the design-mock pieces are present and clean**

Run:
```bash
ls frontend/src/components/SceneUndoToast.tsx frontend/src/components/SceneUndoToast.stories.tsx
grep -n "scene-undo-countdown\|inkwell-undo-countdown" frontend/src/index.css
npm --prefix frontend run lint:design
npm --prefix frontend run typecheck
```

Expected:
- Both `.tsx` files exist.
- `index.css` contains both `@keyframes inkwell-undo-countdown` and `.scene-undo-countdown`.
- `lint:design` exits 0 with `✓ No design-token drift.`
- `typecheck` exits 0 with no output (or only `> tsc -b`).

If any of these fail, stop and reconcile against `git log --oneline -- frontend/src/components/SceneUndoToast.tsx` before proceeding — the design-mock commit may not be on this branch.

---

## Task 1: Replace the inline toast with `<SceneUndoToast/>` in `SceneTab`

**Files:**
- Modify: `frontend/src/components/SceneTab.tsx` (remove lines 297–349 inline-toast block; import the new component; render it as a positioned overlay)

- [ ] **Step 1: Add the import**

Open `frontend/src/components/SceneTab.tsx`. Find the existing `SceneSessionPicker` import (it sits with the other component imports near the top — search for `from './SceneSessionPicker'`). Immediately after it, add:

```ts
import { SceneUndoToast } from './SceneUndoToast';
```

- [ ] **Step 2: Remove the `lastUndoEntry` IIFE**

In the same file, delete lines 297–301 (the `const lastUndoEntry = (() => { ... })();` block). The replacement reads `pendingDeletes` directly inside JSX; we don't need the temporary.

Before:
```tsx
  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const lastUndoEntry = (() => {
    if (pendingDeletes.size === 0) return null;
    const entries = Array.from(pendingDeletes.entries());
    return entries[entries.length - 1];
  })();

  return (
```

After:
```tsx
  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

  return (
```

We rename to `lastPending` to make the destructuring intent explicit at the JSX use site (it's a `[id, { title }]` tuple, not an "undo entry").

- [ ] **Step 3: Add `relative` to the SceneTab container**

The container is the `<div>` returned at line 304 (currently `className="flex flex-col h-full" data-testid="scene-tab"`). It needs `relative` so the absolutely-positioned toast anchors to the SceneTab pane, not to the page or the chat-panel root.

Before:
```tsx
    <div className="flex flex-col h-full" data-testid="scene-tab">
```

After:
```tsx
    <div className="flex flex-col h-full relative" data-testid="scene-tab">
```

- [ ] **Step 4: Remove the inline toast JSX**

Delete the existing toast block at lines 333–349 (the `{lastUndoEntry !== null && (...)}` JSX). Make sure to delete the entire conditional including the wrapping `{` and `)}`.

The deleted block:
```tsx
      {lastUndoEntry !== null && (
        <div
          className="mx-3 my-2 bg-ink text-bg rounded-[var(--radius)] px-3 py-2 flex items-center gap-3 text-[12px] shadow-pop"
          role="status"
        >
          <span className="flex-1">Deleted &ldquo;{lastUndoEntry[1].title}&rdquo;</span>
          <button
            type="button"
            onClick={() => {
              onUndo(lastUndoEntry[0]);
            }}
            className="font-mono text-[11px] underline"
          >
            Undo
          </button>
        </div>
      )}
```

- [ ] **Step 5: Render the new toast as a positioned overlay**

The toast belongs above `<SceneComposer …/>` (currently the last child of the SceneTab container, around line 418). Add the overlay as a sibling immediately *before* `<SceneComposer …/>` so it reads top-to-bottom in DOM order: picker → transcript → toast → composer.

Before:
```tsx
      </section>

      <SceneComposer
        state={transcript.streamState === 'streaming' ? 'streaming' : 'idle'}
        onGenerate={onGenerate}
        onStop={transcript.stop}
      />
    </div>
```

After:
```tsx
      </section>

      {lastPending !== null && (
        <div className="absolute left-3 right-3 bottom-[calc(var(--scene-composer-height,56px)+8px)] z-20">
          <SceneUndoToast
            key={lastPending[0]}
            title={lastPending[1].title}
            onUndo={() => {
              onUndo(lastPending[0]);
            }}
            timeoutMs={5000}
          />
        </div>
      )}

      <SceneComposer
        state={transcript.streamState === 'streaming' ? 'streaming' : 'idle'}
        onGenerate={onGenerate}
        onStop={transcript.stop}
      />
    </div>
```

Notes on the positioning classes:
- `absolute left-3 right-3` mirrors the picker's horizontal inset so the toast sits between the same vertical rules.
- `bottom-[calc(var(--scene-composer-height,56px)+8px)]` puts it 8px above the composer. The CSS variable defaults to `56px` (matches the current composer's intrinsic height) and gives us a single-knob escape hatch if the composer height ever changes — no per-toast hard-coding to chase.
- `z-20` sits above the picker dropdown's `z-10`. The two never overlap geometrically (the dropdown projects downward from the picker; the toast sits at the foot of the pane), but a higher z-index defends against any future repositioning.
- `key={lastPending[0]}` forces React to remount `SceneUndoToast` when a *different* session is the most-recent pending delete. Without this, deleting B while A's countdown is still running would visually re-use A's animated hairline at whatever phase it had reached, instead of starting B's countdown fresh.

- [ ] **Step 6: Typecheck**

Run:
```bash
npm --prefix frontend run typecheck
```

Expected: exits 0 with no errors. If TS complains about `lastPending[1].title` possibly being undefined, the existing `pendingDeletes` map shape from `useSoftDelete` already types `title: string`, so a fresh check should pass — re-read `frontend/src/hooks/useSoftDelete.ts` for the `Pending` type if needed.

- [ ] **Step 7: Design lint**

Run:
```bash
npm --prefix frontend run lint:design
```

Expected: exits 0 with `✓ No design-token drift.` Arbitrary values like `bottom-[calc(var(--scene-composer-height,56px)+8px)]` reference a CSS variable, not a hex/rgb/hsl color, so they pass pattern 4 in `frontend/scripts/lint-design.mjs`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/SceneTab.tsx
git commit -m "[scene-tab] replace inline undo slab with SceneUndoToast overlay

Removes the high-contrast bg-ink toast that the SceneSessionPicker
dropdown was occluding. The new component lives at the foot of the
SceneTab pane (above the composer), out of the dropdown's downward
projection."
```

---

## Task 2: Test that the new toast renders on soft-delete

**Files:**
- Modify: `frontend/tests/components/SceneTab.test.tsx` — add one test in the existing `describe('SceneTab — smoke', () => { … })` block.

Why: the file's header comment already says it covers "the undo toast when a session is soft-deleted", but no such assertion exists. The new component changes the toast's accessible markup (a `font-serif italic` title plus a separate `Undo` button), so a small smoke test fixes both gaps at once.

- [ ] **Step 1: Locate the right spot in the test file**

Open `frontend/tests/components/SceneTab.test.tsx`. Skim to the end of the existing `describe('SceneTab — smoke', () => { … })` block. Add the new test as the last `it(...)` inside that `describe`. The existing tests use `renderWithProviders`, `makeClient`, `useSceneTranscriptStore`, and a `fetchMock`; the new test uses the same scaffolding.

- [ ] **Step 2: Write the failing test**

Add this test inside the `describe` block (replace `<<EXISTING TESTS ABOVE>>` with whatever's already there — do not delete existing tests):

```tsx
  it('shows the SceneUndoToast when a session is soft-deleted', async () => {
    // Mock the sessions endpoint to return one deletable session.
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              title: 'Veranda confrontation',
              chapterId: 'ch1',
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (url.endsWith('/api/chats/c1') && (input as Request).method === 'DELETE') {
        return jsonResponse(204, null);
      }
      if (url.includes('/api/chats/c1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, makeClient());

    // Open the picker, hover the session, click its delete button.
    const picker = await screen.findByRole('button', { name: /Scene session: Veranda/ });
    await user.click(picker);
    const deleteBtn = await screen.findByRole('button', { name: /Delete Veranda/ });
    await user.click(deleteBtn);

    // The new toast should appear with role=status, the session title in
    // serif italic, and an Undo button.
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/Deleted/i);
    expect(toast).toHaveTextContent(/Veranda confrontation/);
    const undo = await screen.findByRole('button', { name: /Undo/i });
    expect(undo).toBeInTheDocument();

    // Clicking Undo cancels the pending delete and dismisses the toast.
    await user.click(undo);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
```

- [ ] **Step 3: Run the test to verify it passes against Task 1's implementation**

Run:
```bash
npm --prefix frontend test -- tests/components/SceneTab.test.tsx
```

Expected: the new test passes. The other tests in the file should still pass (no changes to their setup).

If the test fails because the picker's accessible name doesn't match `/Scene session: Veranda/`, re-read `frontend/src/components/SceneSessionPicker.tsx:209` — the `aria-label` is `Scene session: ${active.title}`. Adjust the regex if the seeded session title differs.

If the test fails because `userEvent.click(deleteBtn)` doesn't fire (the Trash button has `opacity-0 group-hover:opacity-100` at `SceneSessionPicker.tsx:306`), the click still dispatches in jsdom because opacity is purely visual — userEvent does not check computed visibility. If a regression surfaces, add `await user.hover(row)` first.

- [ ] **Step 4: Run the full frontend test suite to catch regressions**

Run:
```bash
npm --prefix frontend test
```

Expected: all tests pass. The race test (`SceneTab.race.test.tsx`) does not assert on the toast, so it should be unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/components/SceneTab.test.tsx
git commit -m "[scene-tab] test: SceneUndoToast renders on soft-delete and undoes on click"
```

---

## Task 3: Manual verification in Storybook + dev stack

**Files:** none (verification only).

- [ ] **Step 1: Storybook spot-check**

Run:
```bash
npm --prefix frontend run storybook
```

Open `http://localhost:6006` and visit:
- `Chat → SceneUndoToast → InContext` — confirm the toast sits just above the composer, with the picker visible above.
- `Chat → SceneUndoToast → InContextWithPickerOpen` — confirm the open dropdown does **not** cover the toast (the toast lives below the dropdown's downward projection).
- `Chat → SceneUndoToast → Sepia` and `→ Dark` — confirm tokens flow through correctly: warm card on cream, ink card on charcoal.
- `Chat → SceneUndoToast → Comparison` — eyeball the before/after.

Stop Storybook when satisfied (`Ctrl+C`).

- [ ] **Step 2: Live stack spot-check**

Run:
```bash
make dev
```

In a browser at `http://localhost:3000`:
1. Sign in (or create an account) and open a story with at least one chapter.
2. Open the **Scene** tab on the chat panel.
3. Create two scene sessions (use the picker's `+ New scene`).
4. Open the picker, hover a session, click the trash icon.
5. Confirm:
   - The toast appears at the foot of the SceneTab pane, above the composer.
   - The 1px hairline at the bottom of the toast drains from full-width to zero over ~5s.
   - Re-opening the picker mid-countdown does **not** cover the toast.
   - Clicking **Undo** restores the session in the picker and dismisses the toast.
6. Repeat across themes via `Settings → Appearance` (paper / sepia / dark) and confirm legibility in each.

If any of the above misbehaves, capture the symptom in a `bd create` note and stop — do not patch in `make dev`. Diagnose, then return to Task 1 or 2 to fix the root cause.

- [ ] **Step 3: Stop the dev stack**

```bash
make stop
```

- [ ] **Step 4: Final guardrails**

Run all of:
```bash
npm --prefix frontend run lint:design
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected: each exits 0.

- [ ] **Step 5: Push**

Per `CLAUDE.md` § "Session Completion":
```bash
git pull --rebase
git push
git status   # must show "up to date with origin"
```

---

## Self-Review

- **Spec coverage.** The user's request covered (a) repositioning the toast so the picker dropdown stops occluding it, and (b) reskinning to match the app's editorial / paper theme. Reskin lives in the existing `SceneUndoToast.tsx` (already merged design mock); repositioning is fully covered by Task 1. The smoke test in Task 2 protects the wiring. Manual verification in Task 3 covers the cross-theme visual check the user asked for.
- **Placeholder scan.** No `TBD`, no `add validation`, no `similar to Task N`. Each code step is complete and self-contained.
- **Type consistency.** `lastPending` is `[string, { title: string; … }]` from `useSoftDelete`'s `pendingDeletes` map. The new toast prop names (`title`, `onUndo`, `timeoutMs`) match the existing `SceneUndoToastProps` interface in `frontend/src/components/SceneUndoToast.tsx`. The `key={lastPending[0]}` use matches the toast's "fresh countdown per delete" expectation.
- **Tests fix the file's standing claim.** The header comment at `frontend/tests/components/SceneTab.test.tsx:5` claims toast coverage that the file did not actually have. Task 2 closes that gap.
