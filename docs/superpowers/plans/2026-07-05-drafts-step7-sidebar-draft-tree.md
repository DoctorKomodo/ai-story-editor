# Drafts Step 7 — Sidebar Draft Tree + New-Draft Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-visible drafts UI — sidebar draft tree, new-draft dialog, editor draft-label binding — plus the flush-race fix recorded on bd `story-editor-9wk.7`.

**Architecture:** Frontend-only (every backend endpoint already exists). The `selectedDraft` store becomes a chapter-scoped pair; EditorPage's version-check timestamp becomes a per-draft map so `useAutosave`'s snapshotted flush always carries its own draft's `expectedUpdatedAt`; `DraftList` + `NewDraftDialog` are new storied components composed from existing primitives plus a new generic `InlineEdit` primitive.

**Tech Stack:** React 19 + TypeScript strict, Zustand, TanStack Query, vitest + @testing-library (jsdom, fake-indexeddb), Storybook, Tailwind v4 tokens.

**Spec:** `docs/superpowers/specs/2026-07-05-drafts-step7-sidebar-draft-tree-design.md` (decisions D1–D10 — binding). Parent epic spec `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §7/§8.

## Global Constraints

- **Frontend-only.** No backend, shared-schema, or migration changes. Backend contracts consumed as-is: `POST /api/chapters/:chapterId/drafts` `{mode: 'fork'|'blank', label?}` → 201 `{draft}`; `PUT /api/chapters/:chapterId/active-draft` `{draftId}` → 204; `DELETE /api/drafts/:draftId` → 204 or 409 `cannot_delete_active_draft` / `cannot_delete_last_draft`; `PATCH /api/drafts/:draftId` `{label: string|null}` for rename.
- **`frontend/src/hooks/useAutosave.ts` is DO-NOT-TOUCH.** The flush-race fix lives entirely in `EditorPage.tsx` (+ a type-narrowing in `useUnloadFlush.ts`). Any change to useAutosave is a plan violation.
- **Missing-entry invariant (spec D2):** no automatic save path may ever PATCH a draft body without `expectedUpdatedAt`. The only unconditional body PATCH in the app is the conflict banner's explicit **Overwrite** action.
- **"Viewing ≠ activating" (parent spec §7):** setting a draft active must never change which draft the editor shows; deleting is never offered on the active draft.
- **Positional labels:** `label: null` renders `"Draft A"…"Draft Z"` for `orderIndex 0–25`, then `"Draft ${orderIndex + 1}"` (e.g. orderIndex 26 → `"Draft 27"`; `"Draft 26"` never appears — deliberate).
- **Token-only styling** in `frontend/src/` (CI `lint:design`); new components get `*.stories.tsx` alongside source (Storybook-first).
- TypeScript strict, no `any`. Commit format `[story-editor-9wk.7] <description>`; **never commit `.beads/*.jsonl`** — always `git add` explicit pathspecs and verify with `git show --stat HEAD` after each commit.
- Tests: jsdom only (no real browser); frontend vitest has no docker dependency. Full-suite command: `npm --prefix frontend run test`. Targeted: `npm --prefix frontend run test -- <path>`.

---

### Task 1: `selectedDraft` store reshape (spec D1)

**Files:**
- Modify: `frontend/src/store/selectedDraft.ts` (whole file, 24 lines)
- Modify: `frontend/src/pages/EditorPage.tsx:201-212` (selection wiring)
- Modify: `frontend/tests/store/selectedDraft.test.ts` (whole file)
- Modify: `frontend/tests/pages/editor-autosave.integration.test.tsx:422,501,510` (call-site rename)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useSelectedDraftStore` with `{ selected: { chapterId: string; draftId: string } | null, setSelectedDraft(chapterId: string, draftId: string): void, clearSelectedDraft(): void, reset(): void }`. Tasks 5–7 call `setSelectedDraft`/`clearSelectedDraft`; EditorPage derives `viewedDraftId` from `selected`.

- [ ] **Step 1: Rewrite the store test**

Replace the body of `frontend/tests/store/selectedDraft.test.ts` with:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSelectedDraftStore } from '@/store/selectedDraft';

afterEach(() => {
  act(() => {
    useSelectedDraftStore.getState().reset();
  });
});

describe('useSelectedDraftStore', () => {
  it('defaults to null (follow the active draft)', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    expect(result.current.selected).toBeNull();
  });

  it('setSelectedDraft stores the chapter-scoped pair', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    expect(result.current.selected).toEqual({ chapterId: 'ch-1', draftId: 'draft-9' });
  });

  it('clearSelectedDraft returns to follow-active', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    act(() => {
      result.current.clearSelectedDraft();
    });
    expect(result.current.selected).toBeNull();
  });

  it('a later setSelectedDraft overwrites the previous pair (one selection app-wide)', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    act(() => {
      result.current.setSelectedDraft('ch-2', 'draft-3');
    });
    expect(result.current.selected).toEqual({ chapterId: 'ch-2', draftId: 'draft-3' });
  });

  it('reset() returns data fields to initialState', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-42');
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.selected).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend run test -- tests/store/selectedDraft.test.ts`
Expected: FAIL — `setSelectedDraft is not a function` / `selected` undefined.

- [ ] **Step 3: Rewrite the store**

Replace the body of `frontend/src/store/selectedDraft.ts` with:

```ts
import { create } from 'zustand';

export interface SelectedDraft {
  chapterId: string;
  draftId: string;
}

/**
 * Which draft is being VIEWED in the editor — ephemeral UI state, distinct
 * from the persisted `Chapter.activeDraftId`. `selected === null` = follow
 * the chapter's active draft. Chapter-scoped pair (not a bare draft id) so
 * a selection made for another chapter is inert rather than racing the
 * chapter switch — EditorPage ignores a pair whose chapterId doesn't match
 * the open chapter, and clears stale pairs on chapter switch ([9wk.7] D1).
 */
export interface SelectedDraftState {
  selected: SelectedDraft | null;
  setSelectedDraft: (chapterId: string, draftId: string) => void;
  clearSelectedDraft: () => void;
  reset: () => void;
}

const initialState: { selected: SelectedDraft | null } = {
  selected: null,
};

export const useSelectedDraftStore = create<SelectedDraftState>((set) => ({
  ...initialState,
  setSelectedDraft: (chapterId, draftId) => set({ selected: { chapterId, draftId } }),
  clearSelectedDraft: () => set({ selected: null }),
  reset: () => set(initialState),
}));
```

(`frontend/src/lib/sessionReset.ts` needs no change — the store keeps its `reset()` and stays in `PER_USER_STORES`.)

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npm --prefix frontend run test -- tests/store/selectedDraft.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Rewire EditorPage**

In `frontend/src/pages/EditorPage.tsx`, replace this block (currently lines 201–212):

```ts
  // [9wk.6] Draft-native editor: which draft is being viewed. selectedDraftId
  // is null until the 9wk.7 sidebar sets it — null means "follow the active
  // draft". Reset on chapter switch.
  const selectedDraftId = useSelectedDraftStore((s) => s.selectedDraftId);
  const resetSelectedDraft = useSelectedDraftStore((s) => s.reset);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChapterId is the reset trigger.
  useEffect(() => {
    resetSelectedDraft();
  }, [activeChapterId]);

  const draftsQuery = useDraftsQuery(activeChapterId);
  const viewedDraftId = selectedDraftId ?? activeDraftIdOf(draftsQuery.data);
```

with:

```ts
  // [9wk.7] Which draft is being viewed — a chapter-scoped pair; null means
  // "follow the active draft". A pair for another chapter is inert (the
  // derivation below ignores it), which is what makes a cross-chapter draft
  // click race-free: the sidebar sets the pair and the chapter in one
  // interaction, and no effect ordering can wipe it.
  const selectedDraft = useSelectedDraftStore((s) => s.selected);
  const clearSelectedDraft = useSelectedDraftStore((s) => s.clearSelectedDraft);
  // Clear a STALE selection on chapter switch (parent-spec §8 "resets on
  // chapter switch") while keeping a selection made FOR the new chapter.
  // Reads the store imperatively so this runs only on chapter change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChapterId is the trigger; `selected` is read fresh via getState.
  useEffect(() => {
    const sel = useSelectedDraftStore.getState().selected;
    if (sel !== null && sel.chapterId !== activeChapterId) clearSelectedDraft();
  }, [activeChapterId]);

  const draftsQuery = useDraftsQuery(activeChapterId);
  const viewedDraftId =
    (selectedDraft !== null && selectedDraft.chapterId === activeChapterId
      ? selectedDraft.draftId
      : null) ?? activeDraftIdOf(draftsQuery.data);
```

- [ ] **Step 6: Update the integration-test call sites**

In `frontend/tests/pages/editor-autosave.integration.test.tsx`, replace all three occurrences of

```ts
      useSelectedDraftStore.getState().setSelectedDraftId('draft-b');
```
(and the `'draft-a'` one) with the pair form:

```ts
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
```
```ts
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-a');
```

Then confirm no other call sites remain anywhere:

Run: `grep -rn "setSelectedDraftId\|selectedDraftId" frontend/src frontend/tests`
Expected: no matches (the identifier is gone).

- [ ] **Step 7: Run the affected suites + typecheck**

Run: `npm --prefix frontend run test -- tests/store/selectedDraft.test.ts tests/lib/sessionReset.test.ts tests/pages/editor-autosave.integration.test.tsx && npm --prefix frontend run typecheck`
Expected: PASS (the integration suite takes ~15–30s; it uses real timers by design — do not convert it to fake timers).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/store/selectedDraft.ts frontend/src/pages/EditorPage.tsx frontend/tests/store/selectedDraft.test.ts frontend/tests/pages/editor-autosave.integration.test.tsx
git commit -m "[story-editor-9wk.7] selectedDraft store: chapter-scoped pair + conditional reset"
git show --stat HEAD   # verify ONLY the four files above are in the commit
```

---

### Task 2: Flush-race fix — per-draft timestamp map + view-guarded conflict banner (spec D2)

model: opus

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx:272-313,377-390` (`serverUpdatedAtRef` → map; `handleSave`; unload-flush builder)
- Modify: `frontend/src/hooks/useUnloadFlush.ts:4-10,43-48` (narrow `expectedUpdatedAt` to `string`)
- Test: `frontend/tests/pages/editor-autosave.integration.test.tsx` (extend the 9wk.6 describe block; generalize the in-memory router to two chapters)

**Interfaces:**
- Consumes: Task 1's `viewedDraftId` derivation (unchanged name).
- Produces: `updatedAtByDraftRef: MutableRefObject<Map<string, string>>` and `viewedDraftIdRef: MutableRefObject<string | null>` inside EditorPage (later tasks don't touch them); `UnloadFlushArgs.expectedUpdatedAt: string` (non-null).

Background for the implementer — read spec D2 first. `useAutosave` (DO-NOT-TOUCH) snapshots the save callback at debounce-schedule time and, when its `resetKey` (= `viewedDraftId`) changes, flushes the pending edit through that snapshot (`useAutosave.ts:156-166`). The snapshot closes over the *old* draft's id, but today reads the *current* `serverUpdatedAtRef` — wrong timestamp after a switch. The map keyed by draft id makes the callback self-contained.

- [ ] **Step 1: Generalize the test router to two chapters**

In `frontend/tests/pages/editor-autosave.integration.test.tsx`, inside `draftsBackendRouter` replace the single-chapter list route:

```ts
    if (url.endsWith('/chapters/ch1/drafts')) {
      const list = [...records.values()].sort((a, b) => a.orderIndex - b.orderIndex);
      return Promise.resolve(jsonResponse(200, { drafts: list.map(draftMetaOf) }));
    }
```

with a chapter-aware one (records already carry `chapterId`):

```ts
    const listMatch = url.match(/\/chapters\/([^/?]+)\/drafts$/);
    if (listMatch) {
      const chapterId = listMatch[1] as string;
      const list = [...records.values()]
        .filter((r) => r.chapterId === chapterId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      return Promise.resolve(jsonResponse(200, { drafts: list.map(draftMetaOf) }));
    }
```

and replace the chapters-list route so tests can serve two chapters:

```ts
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters: [makeChapterRecord()] }));
    }
```

with:

```ts
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters }));
    }
```

adding a `chapters` parameter with a backward-compatible default so the four existing tests need no edits:

```ts
function draftsBackendRouter(
  records: Map<string, DraftRecord>,
  onPatch?: (id: string, body: Record<string, unknown>, rec: DraftRecord) => PatchOutcome | null,
  chapters: Record<string, unknown>[] = [makeChapterRecord()],
): (url: string, init?: RequestInit) => Promise<Response> {
```

- [ ] **Step 2: Write the failing regression tests**

Append these tests inside the `describe('EditorPage draft-native corruption-class regressions (9wk.6 Task 3)')` block. Shared helper first (place next to `patchCallsTo`):

```ts
  /** Every body-PATCH in the run must carry the expectedUpdatedAt precondition
   * (spec D2 missing-entry invariant). `except` allows the explicit-Overwrite
   * body through. */
  function expectAllBodyPatchesPreconditioned(except: string[] = []): void {
    const bodyPatches = fetchMock.mock.calls.filter(([url, init]) => {
      if (typeof url !== 'string' || !/\/drafts\/[^/?]+$/.test(url)) return false;
      const i = init as RequestInit | undefined;
      if (i?.method !== 'PATCH') return false;
      const parsed = JSON.parse((i.body as string) ?? '{}') as Record<string, unknown>;
      return parsed.bodyJson !== undefined;
    }) as [string, RequestInit][];
    for (const [, init] of bodyPatches) {
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      if (except.some((marker) => (init.body as string).includes(marker))) continue;
      expect(parsed.expectedUpdatedAt).toBeTypeOf('string');
    }
  }
```

Test A — the headline race (cached target draft):

```ts
  it('[9wk.7] flush on a draft switch carries the DEPARTED draft own updatedAt — no spurious 409/banner', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const T_B = '2026-04-24T09:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      ['draft-a', draftRecord({ id: 'draft-a', orderIndex: 0, isActive: true, updatedAt: T_A, bodyJson: null })],
      [
        'draft-b',
        draftRecord({
          id: 'draft-b',
          orderIndex: 1,
          isActive: false,
          updatedAt: T_B,
          bodyJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft B body' }] }],
          },
        }),
      ],
    ]);
    fetchMock.mockImplementation(draftsBackendRouter(records));

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    // Warm draft-b's DETAIL cache: view B once, then come back to A. This is
    // the precondition of the bug — a cached target makes draftQuery.data
    // flip to B synchronously on the switch, before the resetKey flush runs.
    await screen.findByRole('textbox', { name: /chapter body/i });
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft B body',
      );
    });
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-a');
    });
    const boxA = screen.getByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(boxA.textContent ?? '').toBe('');
    });

    boxA.focus();
    await userEvent.type(boxA, 'typed into A', { skipClick: true });
    await waitFor(() => {
      expect(boxA.textContent ?? '').toContain('typed into A');
    });

    // Switch to the CACHED draft B → resetKey flush fires for draft-a.
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    await waitFor(() => {
      const flush = patchCallsTo('draft-a').find(([, init]) =>
        (init.body as string).includes('typed into A'),
      );
      expect(flush).toBeDefined();
    });
    const [, flushInit] = patchCallsTo('draft-a').find(([, init]) =>
      (init.body as string).includes('typed into A'),
    ) as [string, RequestInit];
    const flushBody = JSON.parse(flushInit.body as string) as Record<string, unknown>;
    // The fix: A's OWN timestamp, not B's — the backend accepts (200), so the
    // final keystrokes reached the server instead of dying on a bogus 409.
    expect(flushBody.expectedUpdatedAt).toBe(T_A);

    // And no conflict banner ever appears on the draft we switched to.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft B body',
      );
    });
    expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();

    expectAllBodyPatchesPreconditioned();
  }, 15000);
```

Test B — chapter-switch flush keeps its precondition (the pre-existing hole D2 closes):

```ts
  it('[9wk.7] flush on a CHAPTER switch still carries the departed draft updatedAt (never unconditional)', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      ['draft-a', draftRecord({ id: 'draft-a', orderIndex: 0, isActive: true, updatedAt: T_A, bodyJson: null })],
      [
        'draft-c',
        draftRecord({
          id: 'draft-c',
          chapterId: 'ch2',
          orderIndex: 0,
          isActive: true,
          updatedAt: '2026-04-24T08:00:00.000Z',
          bodyJson: null,
        }),
      ],
    ]);
    fetchMock.mockImplementation(
      draftsBackendRouter(records, undefined, [
        makeChapterRecord({ draftCount: 1 }),
        makeChapterRecord({ id: 'ch2', title: 'Second', orderIndex: 1, activeDraftId: 'draft-c', draftCount: 1 }),
      ]),
    );

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });
    box.focus();
    await userEvent.type(box, 'leaving the chapter', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('leaving the chapter');
    });

    act(() => {
      useActiveChapterStore.setState({ activeChapterId: 'ch2' });
    });

    await waitFor(() => {
      const flush = patchCallsTo('draft-a').find(([, init]) =>
        (init.body as string).includes('leaving the chapter'),
      );
      expect(flush).toBeDefined();
    });
    const [, flushInit] = patchCallsTo('draft-a').find(([, init]) =>
      (init.body as string).includes('leaving the chapter'),
    ) as [string, RequestInit];
    const flushBody = JSON.parse(flushInit.body as string) as Record<string, unknown>;
    expect(flushBody.expectedUpdatedAt).toBe(T_A);

    expectAllBodyPatchesPreconditioned();
  }, 15000);
```

Test C — a genuine 409 on a departed draft never banners the current one:

```ts
  it('[9wk.7] a real 409 for a draft the user already left shows NO banner; the IDB draft persists', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      ['draft-a', draftRecord({ id: 'draft-a', orderIndex: 0, isActive: true, updatedAt: T_A, bodyJson: null })],
      ['draft-b', draftRecord({ id: 'draft-b', orderIndex: 1, isActive: false, updatedAt: '2026-04-24T09:00:00.000Z', bodyJson: null })],
    ]);
    // Force EVERY body-PATCH to draft-a to 409 (simulates another device
    // having moved draft-a since we loaded it).
    fetchMock.mockImplementation(
      draftsBackendRouter(records, (id, body) => {
        if (id === 'draft-a' && body.bodyJson !== undefined) {
          return { status: 409, body: { error: { message: 'Draft changed elsewhere.', code: 'conflict' } } };
        }
        return null;
      }),
    );

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });
    box.focus();
    await userEvent.type(box, 'doomed edit', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('doomed edit');
    });

    // Switch away IMMEDIATELY — the flush's 409 lands while draft-b is viewed.
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    await waitFor(() => {
      expect(patchCallsTo('draft-a').length).toBeGreaterThan(0);
    });
    // Give the rejected promise a beat to (not) set state, then assert.
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();

    // The rejected body survives locally for recovery on next view of A.
    const { getDraft } = await import('@/lib/chapterDrafts');
    const local = await getDraft('u1', 'ch1', 'draft-a');
    expect(local).not.toBeNull();
    expect(JSON.stringify(local!.bodyJson)).toContain('doomed edit');
  }, 15000);
```

Also strengthen the EXISTING first corruption test (`'draft-switch never cross-flushes…'`): after the `expect(flushToA).toBeDefined();` line, add:

```ts
    // [9wk.7] The uncached-target variant used to flush WITHOUT a
    // precondition (ref nulled before the flush). Now it must carry A's own
    // timestamp.
    const flushToABody = JSON.parse(flushToA![1].body as string) as Record<string, unknown>;
    expect(flushToABody.expectedUpdatedAt).toBe('2026-04-24T10:00:00.000Z');
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm --prefix frontend run test -- tests/pages/editor-autosave.integration.test.tsx`
Expected: Test A FAILS (`expectedUpdatedAt` is `T_B`, not `T_A` — the bug); Test B FAILS (`expectedUpdatedAt` undefined); the strengthened existing test FAILS (undefined); Test C may pass or fail depending on banner timing — record its status. The four pre-existing tests still pass.

- [ ] **Step 4: Implement — EditorPage**

In `frontend/src/pages/EditorPage.tsx` replace (currently lines 272–278):

```ts
  // Last-seen server `updatedAt` — sent as the PATCH's `expectedUpdatedAt`
  // precondition. Kept fresh from the draft cache, which
  // `useUpdateDraftMutation`'s `onSuccess` also writes after every save.
  const serverUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    serverUpdatedAtRef.current = draftQuery.data?.updatedAt ?? null;
  }, [draftQuery.data?.updatedAt]);
```

with:

```ts
  // Last-seen server `updatedAt` PER DRAFT — sent as each PATCH's
  // `expectedUpdatedAt` precondition. A map (not a scalar) because
  // useAutosave's resetKey flush executes a save snapshotted for the
  // PREVIOUS draft after the view has already moved on; the snapshot closes
  // over its own draft id and must read that draft's timestamp ([9wk.7] D2).
  // Entries are retained for the mount's lifetime: a chapter-switch flush
  // still needs the departed draft's entry, deleted drafts' entries are
  // inert (ids never reused), and growth is bounded by drafts viewed.
  const updatedAtByDraftRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const d = draftQuery.data;
    if (d !== undefined) updatedAtByDraftRef.current.set(d.id, d.updatedAt);
  }, [draftQuery.data]);

  // The draft currently on screen — read by handleSave's 409 catch so a
  // conflict landing for an already-departed draft can't banner the current
  // one (the IDB recovery layer owns that path).
  const viewedDraftIdRef = useRef<string | null>(viewedDraftId);
  useEffect(() => {
    viewedDraftIdRef.current = viewedDraftId;
  }, [viewedDraftId]);
```

Replace `handleSave` (currently lines 291–313):

```ts
  const handleSave = useCallback(
    async (value: JSONContent): Promise<void> => {
      if (!story?.id || activeChapterId === null || viewedDraftId === null) return;
      // wordCount is recomputed server-side from bodyJson (drafts.routes.ts).
      const expectedUpdatedAt = updatedAtByDraftRef.current.get(viewedDraftId);
      // D2 missing-entry invariant: an automatic save must never degrade to
      // an unconditional PATCH. The entry is written before typing is
      // possible (the seed effect requires draftQuery.data); if it is somehow
      // absent, fail the save — onSaved never fires, so the IndexedDB draft
      // remains as the recovery path.
      if (expectedUpdatedAt === undefined) {
        throw new Error('autosave: unknown server updatedAt for the target draft');
      }
      try {
        await updateDraft.mutateAsync({
          draftId: viewedDraftId,
          chapterId: activeChapterId,
          storyId: story.id,
          input: { bodyJson: value, expectedUpdatedAt },
        });
      } catch (err) {
        // Banner only when the conflict concerns the draft still on screen.
        if (isDraftConflictError(err) && viewedDraftIdRef.current === viewedDraftId) {
          setConflict(true);
        }
        throw err;
      }
    },
    [story?.id, activeChapterId, viewedDraftId, updateDraft],
  );
```

Replace the `useUnloadFlush` call (currently lines 377–390):

```ts
  useUnloadFlush(
    useCallback(() => {
      const pending = autosave.getPendingPayload();
      if (pending === null || viewedDraftId === null) return null;
      const expectedUpdatedAt = updatedAtByDraftRef.current.get(viewedDraftId);
      // Same invariant as handleSave: no known precondition → no keepalive
      // PATCH (the IDB draft persisted by onDirty is the recovery path).
      if (expectedUpdatedAt === undefined) return null;
      // Closure-read ids are safe: switching the viewed draft changes
      // useAutosave's resetKey, which nulls getPendingPayload() until the new
      // draft's baseline seeds — a stale buffer can't flush at the new id.
      return { draftId: viewedDraftId, bodyJson: pending, expectedUpdatedAt };
    }, [autosave.getPendingPayload, viewedDraftId]),
  );
```

- [ ] **Step 5: Implement — narrow `UnloadFlushArgs`**

In `frontend/src/hooks/useUnloadFlush.ts`, change the interface (lines 4–10) to:

```ts
export interface UnloadFlushArgs {
  draftId: string;
  bodyJson: unknown;
  /** The target draft's last-seen updatedAt — the flush is preconditioned so
   * a stale buffer can only no-op (409 unobserved), never clobber. Non-null
   * by construction ([9wk.7] D2: no precondition → no flush). */
  expectedUpdatedAt: string;
}
```

and simplify the serializer (lines 43–48):

```ts
      const serialized = JSON.stringify({
        bodyJson: pending.bodyJson,
        expectedUpdatedAt: pending.expectedUpdatedAt,
      });
```

Update `frontend/tests/hooks/useUnloadFlush.test.ts` — it has four `expectedUpdatedAt: null` sites, and they are NOT all the same kind:
- The test `'omits expectedUpdatedAt from the PATCH body when null'` (~lines 65–79) tests behaviour that **no longer exists** (the null-omission branch is deleted). **Delete this test entirely** — do not convert it (a string fixture with an "omitted" assertion would just fail); the always-present case is covered by the remaining serializer tests and the integration suite's `expectAllBodyPatchesPreconditioned`.
- The remaining `null` fixtures (~lines 95, 108, 122) are mechanical: change each to a string timestamp (e.g. `'2026-04-24T10:00:00.000Z'`) and, where the test asserts the serialized body, expect the field present with that value.

- [ ] **Step 6: Run the integration suite to verify all pass**

Run: `npm --prefix frontend run test -- tests/pages/editor-autosave.integration.test.tsx tests/hooks/useUnloadFlush.test.ts`
Expected: PASS — 4 pre-existing + 3 new + strengthened assertions. (~30–60s, real timers.)

- [ ] **Step 7: Full frontend suite + typecheck**

Run: `npm --prefix frontend run test && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/src/hooks/useUnloadFlush.ts frontend/tests/pages/editor-autosave.integration.test.tsx frontend/tests/hooks/useUnloadFlush.test.ts
git commit -m "[story-editor-9wk.7] flush-race fix: per-draft updatedAt map + view-guarded conflict banner"
git show --stat HEAD
```

---

### Task 3: Label helpers + create/set-active/delete mutations (spec D6, D8)

**Files:**
- Modify: `frontend/src/hooks/useDrafts.ts` (append helpers + three hooks; extend imports)
- Test: `frontend/tests/hooks/useDrafts.test.tsx` (append describes)

**Interfaces:**
- Consumes: existing `draftsQueryKey`, `draftQueryKey`, `activeDraftIdOf`; `chaptersQueryKey`/`chapterQueryKey` from `@/hooks/useChapters`; `deleteDraft` from `@/lib/chapterDrafts`; `useSessionStore` from `@/store/session`.
- Produces (used by Tasks 5–8):
  - `positionalDraftLabel(orderIndex: number): string`
  - `draftDisplayLabel(meta: Pick<DraftMeta, 'label' | 'orderIndex'>): string`
  - `useCreateDraftMutation(): UseMutationResult<Draft, Error, CreateDraftArgs>` with `CreateDraftArgs = { chapterId: string; storyId: string; input: DraftCreateInput }`
  - `useSetActiveDraftMutation(): UseMutationResult<void, Error, SetActiveDraftArgs>` with `SetActiveDraftArgs = { chapterId: string; storyId: string; draftId: string; previousActiveDraftId: string | null }`
  - `useDeleteDraftMutation(): UseMutationResult<void, Error, DeleteDraftArgs>` with `DeleteDraftArgs = { chapterId: string; storyId: string; draftId: string }`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/hooks/useDrafts.test.tsx` (reuse the file's existing `jsonResponse`, `withClient`, fixtures, and the `beforeEach`/`afterEach` fetch-stub pattern — each new `describe` carries its own copy of the stub lifecycle exactly like the existing ones):

```tsx
describe('positionalDraftLabel / draftDisplayLabel', () => {
  it('letters A..Z for orderIndex 0..25, then numeric', () => {
    expect(positionalDraftLabel(0)).toBe('Draft A');
    expect(positionalDraftLabel(1)).toBe('Draft B');
    expect(positionalDraftLabel(25)).toBe('Draft Z');
    // Deliberate discontinuity: Z is the 26th; "Draft 26" never appears.
    expect(positionalDraftLabel(26)).toBe('Draft 27');
    expect(positionalDraftLabel(99)).toBe('Draft 100');
  });

  it('custom label wins; null label falls back to positional', () => {
    expect(draftDisplayLabel({ label: 'Grimdark ending', orderIndex: 3 })).toBe('Grimdark ending');
    expect(draftDisplayLabel({ label: null, orderIndex: 3 })).toBe('Draft D');
  });
});

describe('useCreateDraftMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('POSTs mode+label, seeds the record cache, invalidates drafts list + chapters list', async () => {
    const created: Draft = { ...draftFixture, id: 'd-new', orderIndex: 2, isActive: false };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: created }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCreateDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      input: { mode: 'fork', label: 'Alt ending' },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/drafts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'fork', label: 'Alt ending' });

    expect(qc.getQueryData(draftQueryKey('d-new'))).toEqual(created);
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));
  });
});

describe('useSetActiveDraftMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('PUTs the active-draft pointer and invalidates the five affected keys', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSetActiveDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      draftId: 'd-2',
      previousActiveDraftId: 'd-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/active-draft');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ draftId: 'd-2' });

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));
    // Chapter detail GET serves the ACTIVE draft's summary (step-6 D5).
    expect(keys).toContain(JSON.stringify(chapterQueryKey('ch-1')));
    // Both flipped records.
    expect(keys).toContain(JSON.stringify(draftQueryKey('d-2')));
    expect(keys).toContain(JSON.stringify(draftQueryKey('d-1')));
  });

  it('skips the previous-record invalidation when previousActiveDraftId is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSetActiveDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      draftId: 'd-2',
      previousActiveDraftId: null,
    });

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).not.toContain(JSON.stringify(draftQueryKey('null')));
    expect(keys.filter((k) => k.includes('"detail"')).length).toBe(1);
  });
});

describe('useDeleteDraftMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('DELETEs, prefix-removes the draft cache tree, invalidates lists, purges the IDB row', async () => {
    // Seed a local recovery row for the doomed draft.
    await putDraft({
      userId: 'u1',
      storyId: 'story-1',
      chapterId: 'ch-1',
      draftId: 'd-2',
      bodyJson: { type: 'doc', content: [] },
      baseUpdatedAt: '2026-06-01T00:00:00.000Z',
      savedAt: Date.now(),
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    qc.setQueryData(draftQueryKey('d-2'), draftFixture);
    qc.setQueryData(['draft', 'd-2', 'chats', 'ask'], []);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteDraftMutation(), { wrapper });
    await result.current.mutateAsync({ chapterId: 'ch-1', storyId: 'story-1', draftId: 'd-2' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drafts/d-2');
    expect(init.method).toBe('DELETE');

    // Prefix removal: record + chat lists (message caches are a different
    // prefix, deliberately left to gcTime).
    expect(qc.getQueryData(draftQueryKey('d-2'))).toBeUndefined();
    expect(qc.getQueryData(['draft', 'd-2', 'chats', 'ask'])).toBeUndefined();

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));

    await waitFor(async () => {
      expect(await getDraft('u1', 'ch-1', 'd-2')).toBeNull();
    });
  });
});
```

Add to the file's imports: `act` from `@testing-library/react`; `import 'fake-indexeddb/auto';` as the FIRST import line; `positionalDraftLabel, draftDisplayLabel, useCreateDraftMutation, useSetActiveDraftMutation, useDeleteDraftMutation` from `@/hooks/useDrafts`; `chapterQueryKey` from `@/hooks/useChapters`; `getDraft, putDraft` from `@/lib/chapterDrafts`; `useSessionStore` from `@/store/session`.

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- tests/hooks/useDrafts.test.tsx`
Expected: FAIL — the five new exports don't exist.

- [ ] **Step 3: Implement in `frontend/src/hooks/useDrafts.ts`**

Extend imports:

```ts
import type { Draft, DraftCreateInput, DraftMeta, DraftUpdateInput } from 'story-editor-shared';
// (merge into the existing story-editor-shared import — DraftCreateInput is new)
import { deleteDraft as deleteLocalDraft } from '@/lib/chapterDrafts';
import { useSessionStore } from '@/store/session';
import { chapterQueryKey, chaptersQueryKey } from './useChapters';
```

Append at the end of the file:

```ts
const DRAFT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Positional display label for `label: null` drafts, derived from the
 * gap-free orderIndex: "Draft A".."Draft Z", then numeric ("Draft 27").
 * Deliberate boundary: Z is the 26th draft; "Draft 26" never appears.
 */
export function positionalDraftLabel(orderIndex: number): string {
  if (orderIndex < DRAFT_LETTERS.length) {
    return `Draft ${DRAFT_LETTERS[orderIndex] as string}`;
  }
  return `Draft ${String(orderIndex + 1)}`;
}

export function draftDisplayLabel(meta: Pick<DraftMeta, 'label' | 'orderIndex'>): string {
  return meta.label ?? positionalDraftLabel(meta.orderIndex);
}

export interface CreateDraftArgs {
  chapterId: string;
  storyId: string;
  input: DraftCreateInput;
}

export function useCreateDraftMutation(): UseMutationResult<Draft, Error, CreateDraftArgs> {
  const qc = useQueryClient();
  return useMutation<Draft, Error, CreateDraftArgs>({
    mutationFn: async ({ chapterId, input }) => {
      const res = await api<unknown>(`/chapters/${encodeURIComponent(chapterId)}/drafts`, {
        method: 'POST',
        body: input as Record<string, unknown>,
      });
      return draftResponseSchema.parse(res).draft;
    },
    onSuccess: (draft, vars) => {
      // Seed the record cache so selecting the new draft renders instantly.
      qc.setQueryData<Draft>(draftQueryKey(draft.id), draft);
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      // draftCount changed on the chapter row.
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
    },
  });
}

export interface SetActiveDraftArgs {
  chapterId: string;
  storyId: string;
  draftId: string;
  /** `activeDraftIdOf(list)` read before mutating — that record's isActive flips too. */
  previousActiveDraftId: string | null;
}

export function useSetActiveDraftMutation(): UseMutationResult<void, Error, SetActiveDraftArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SetActiveDraftArgs>({
    mutationFn: async ({ chapterId, draftId }) => {
      await api<void>(`/chapters/${encodeURIComponent(chapterId)}/active-draft`, {
        method: 'PUT',
        body: { draftId },
      });
    },
    onSuccess: (_void, vars) => {
      // Dots in the tree; chapter-row headline (wordCount/summary flags
      // follow the active draft server-side).
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
      // Chapter detail GET serves the ACTIVE draft's summary (step-6 D5) —
      // popover/sheet/export read it.
      void qc.invalidateQueries({ queryKey: chapterQueryKey(vars.chapterId) });
      // Both records whose isActive flipped.
      void qc.invalidateQueries({ queryKey: draftQueryKey(vars.draftId) });
      if (vars.previousActiveDraftId !== null) {
        void qc.invalidateQueries({ queryKey: draftQueryKey(vars.previousActiveDraftId) });
      }
    },
  });
}

export interface DeleteDraftArgs {
  chapterId: string;
  storyId: string;
  draftId: string;
}

export function useDeleteDraftMutation(): UseMutationResult<void, Error, DeleteDraftArgs> {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.user?.id) ?? null;
  return useMutation<void, Error, DeleteDraftArgs>({
    mutationFn: async ({ draftId }) => {
      await api<void>(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
    },
    onSuccess: (_void, vars) => {
      // Prefix removal takes the record (['draft', id, 'detail']) AND its
      // chat lists (['draft', id, 'chats', kind]). Per-chat message caches
      // (['chat', chatId, 'messages']) are a different prefix — left to
      // gcTime; their lists are gone so they can never render again.
      qc.removeQueries({ queryKey: ['draft', vars.draftId] });
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
      // Best-effort device hygiene: a deleted draft's plaintext recovery row
      // must not linger in IndexedDB.
      if (userId !== null) {
        void deleteLocalDraft(userId, vars.chapterId, vars.draftId);
      }
    },
  });
}
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npm --prefix frontend run test -- tests/hooks/useDrafts.test.tsx && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDrafts.ts frontend/tests/hooks/useDrafts.test.tsx
git commit -m "[story-editor-9wk.7] draft mutations (create/set-active/delete) + positional label helpers"
git show --stat HEAD
```

---

### Task 4: Primitives — `InlineEdit` + shared hover-reveal fragment (spec D7)

**Files:**
- Modify: `frontend/src/design/primitives.tsx` (add `revealOnRowHover` const + `InlineEdit`; refactor ChapterRow's inline reveal classes happens in the consumer, next bullet)
- Modify: `frontend/src/components/ChapterList.tsx:136-140` (grip button uses the shared const)
- Create: `frontend/src/design/InlineEdit.stories.tsx`
- Test: `frontend/tests/components/InlineEdit.test.tsx`

**Interfaces:**
- Produces:
  - `export const revealOnRowHover: string` — the `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100` class fragment (Tasks 5–6 consume it).
  - `export function InlineEdit(props: InlineEditProps): JSX.Element` with `InlineEditProps = { initialValue: string; placeholder?: string; ariaLabel: string; onCommit: (value: string) => void; onCancel: () => void; testId?: string }`. Commit passes the **trimmed** value (may be `''` — the caller maps empty to its own "cleared" semantics). Enter and blur commit; Escape cancels (and suppresses the following blur-commit).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/InlineEdit.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineEdit } from '@/design/primitives';

function setup(initialValue = 'Old name'): {
  onCommit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <InlineEdit
      initialValue={initialValue}
      placeholder="Draft B"
      ariaLabel="Rename draft"
      onCommit={onCommit}
      onCancel={onCancel}
      testId="inline-edit"
    />,
  );
  return { onCommit, onCancel };
}

describe('InlineEdit', () => {
  it('autofocuses with the initial value selected', () => {
    setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.value).toBe('Old name');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Old name'.length);
  });

  it('Enter commits the trimmed value', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, '  New name  {Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New name');
  });

  it('clearing to empty commits the empty string (caller decides semantics)', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('');
  });

  it('Escape cancels without committing — including via the following blur', async () => {
    const { onCommit, onCancel } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.type(input, ' changed');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    // A blur after Escape (e.g. parent unmount ordering) must not commit.
    (input as HTMLInputElement).blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur commits the trimmed value', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Blurred name');
    (input as HTMLInputElement).blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Blurred name');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- tests/components/InlineEdit.test.tsx`
Expected: FAIL — `InlineEdit` is not exported.

- [ ] **Step 3: Implement in `frontend/src/design/primitives.tsx`**

Add directly below the `InlineConfirm` component (after its closing brace, ~line 684):

```tsx
/* ============================================================================
 * revealOnRowHover — shared class fragment for row-level action clusters:
 * invisible until the row (a `group` container) is hovered or focus moves
 * inside. One source of truth so ChapterList / DraftList reveals can't drift.
 * ========================================================================== */

export const revealOnRowHover =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';

/* ============================================================================
 * <InlineEdit/> — row content swaps for a text input (sibling interaction to
 * InlineConfirm). Enter/blur commit the TRIMMED value (empty string is a
 * valid commit — the caller owns "cleared" semantics); Escape cancels and
 * suppresses the blur-commit that follows.
 * ========================================================================== */

export interface InlineEditProps {
  initialValue: string;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  testId?: string;
}

export function InlineEdit({
  initialValue,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
  testId,
}: InlineEditProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape → cancel must also swallow the blur that refocusing/unmounting
  // fires right after; committing must be once-only (Enter then unmount-blur).
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value.trim());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      settledRef.current = true;
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
      className="flex-1 min-w-0 h-6 px-1.5 font-sans text-[12.5px] text-ink bg-bg-elevated border border-line-2 rounded-[var(--radius)] outline-none focus:border-ink-3"
    />
  );
}
```

(`useState` is already imported in primitives.tsx; `ReactKeyboardEvent` is the file's existing alias for `KeyboardEvent` from react — check the import block at the top and reuse whatever alias `InlineConfirm`'s `onKeyDown` uses, extending the type union from `HTMLFieldSetElement` usage if the alias is element-generic.)

- [ ] **Step 4: Point ChapterRow's grip at the shared fragment**

In `frontend/src/components/ChapterList.tsx`, import `revealOnRowHover` from `@/design/primitives` and replace the grip button's reveal line (currently line 138):

```ts
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
```

with:

```ts
          revealOnRowHover,
```

- [ ] **Step 5: Story**

Create `frontend/src/design/InlineEdit.stories.tsx` (mirror the meta/args shape of `frontend/src/design/InlineConfirm.stories.tsx` — same title namespace `Primitives/...`):

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { InlineEdit } from '@/design/primitives';

const meta: Meta<typeof InlineEdit> = {
  title: 'Primitives/InlineEdit',
  component: InlineEdit,
  args: {
    initialValue: 'Grimdark ending',
    placeholder: 'Draft B',
    ariaLabel: 'Rename draft',
  },
  argTypes: {
    onCommit: { action: 'commit' },
    onCancel: { action: 'cancel' },
  },
};
export default meta;

type Story = StoryObj<typeof InlineEdit>;

export const EditingExistingLabel: Story = {};

export const EmptyWithPositionalPlaceholder: Story = {
  args: { initialValue: '' },
};
```

(If the existing primitive stories use a different `Meta` import source or title convention, match the sibling file exactly — consistency with `InlineConfirm.stories.tsx` wins over this snippet.)

- [ ] **Step 6: Run tests + typecheck + design lint**

Run: `npm --prefix frontend run test -- tests/components/InlineEdit.test.tsx tests/components/ChapterList.test.tsx && npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives.tsx frontend/src/design/InlineEdit.stories.tsx frontend/src/components/ChapterList.tsx frontend/tests/components/InlineEdit.test.tsx
git commit -m "[story-editor-9wk.7] InlineEdit primitive + shared revealOnRowHover fragment"
git show --stat HEAD
```

---

### Task 5: `DraftList` component (spec D3, D9)

**Files:**
- Create: `frontend/src/components/DraftList.tsx`
- Create: `frontend/src/components/DraftList.stories.tsx`
- Test: `frontend/tests/components/DraftList.test.tsx`

**Interfaces:**
- Consumes: Task 3's mutations + `draftDisplayLabel`/`activeDraftIdOf`/`draftsQueryKey`/`useDraftsQuery`; Task 4's `InlineEdit` + `revealOnRowHover`; Task 1's `useSelectedDraftStore.setSelectedDraft`/`clearSelectedDraft`; existing `InlineConfirm`/`useInlineConfirm`/`IconButton`/`CloseIcon`; `formatWordCountCompact`; `ApiError`.
- Produces: `DraftList` with props `{ chapterId: string; storyId: string; viewedDraftId: string | null; onSelectDraft: (chapterId: string, draftId: string) => void; onRequestNewDraft: (chapterId: string) => void; onStatus: (message: string) => void }` (Task 6 renders it).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/DraftList.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import type { DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftList } from '@/components/DraftList';
import { draftsQueryKey } from '@/hooks/useDrafts';
import { resetApiClientForTests } from '@/lib/api';
import { useSelectedDraftStore } from '@/store/selectedDraft';
import { useSessionStore } from '@/store/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function meta(overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>): DraftMeta {
  return {
    chapterId: 'ch-1',
    label: null,
    wordCount: 1200,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

const DRAFTS: DraftMeta[] = [
  meta({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2100 }),
  meta({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending' }),
  meta({ id: 'd-c', orderIndex: 2 }),
];

interface Handlers {
  onSelectDraft: ReturnType<typeof vi.fn>;
  onRequestNewDraft: ReturnType<typeof vi.fn>;
  onStatus: ReturnType<typeof vi.fn>;
}

function renderList(
  overrides: { viewedDraftId?: string | null; drafts?: DraftMeta[] } = {},
): Handlers & { qc: QueryClient } {
  // staleTime: Infinity — the component's useDraftsQuery must serve the
  // seeded data WITHOUT a mount refetch (a refetch would consume each test's
  // single mockResolvedValueOnce and break the mutation assertions).
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(draftsQueryKey('ch-1'), overrides.drafts ?? DRAFTS);
  const handlers: Handlers = {
    onSelectDraft: vi.fn(),
    onRequestNewDraft: vi.fn(),
    onStatus: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <DraftList
      chapterId="ch-1"
      storyId="story-1"
      viewedDraftId={overrides.viewedDraftId ?? null}
      onSelectDraft={handlers.onSelectDraft}
      onRequestNewDraft={handlers.onRequestNewDraft}
      onStatus={handlers.onStatus}
    />,
    { wrapper },
  );
  return { ...handlers, qc };
}

describe('DraftList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    useSelectedDraftStore.getState().reset();
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    useSelectedDraftStore.getState().reset();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders one row per draft: positional/custom label, compact word count, active dot on the active row', () => {
    renderList();
    expect(screen.getByText('Draft A')).toBeInTheDocument();
    expect(screen.getByText('Grimdark ending')).toBeInTheDocument();
    expect(screen.getByText('Draft C')).toBeInTheDocument();
    expect(screen.getByLabelText('Active draft')).toBeInTheDocument();
    expect(screen.getByTestId('draft-row-d-a')).toContainElement(
      screen.getByLabelText('Active draft'),
    );
    expect(screen.getByText('2.1k')).toBeInTheDocument();
  });

  it('marks the viewed row with aria-current', () => {
    renderList({ viewedDraftId: 'd-b' });
    expect(screen.getByTestId('draft-row-d-b')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('draft-row-d-a')).not.toHaveAttribute('aria-current');
  });

  it('clicking a row body selects the draft', async () => {
    const { onSelectDraft } = renderList();
    await userEvent.click(screen.getByText('Grimdark ending'));
    expect(onSelectDraft).toHaveBeenCalledWith('ch-1', 'd-b');
  });

  it('★ is hidden on the active row, shown on others; activating pins the view first (D9)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // The viewed draft belongs to this list AND selection is following-active
    // → the pin must write the pair before the mutation resolves.
    renderList({ viewedDraftId: 'd-a' });

    expect(
      screen.queryByRole('button', { name: 'Set Draft A as active draft' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set Grimdark ending as active draft' }));

    expect(useSelectedDraftStore.getState().selected).toEqual({
      chapterId: 'ch-1',
      draftId: 'd-a',
    });
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(put).toBeDefined();
    });
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PUT',
    ) as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/active-draft');
    expect(JSON.parse(init.body as string)).toEqual({ draftId: 'd-b' });
  });

  it('does NOT pin when the viewed draft is not in this chapter list', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderList({ viewedDraftId: 'other-chapter-draft' });
    await userEvent.click(screen.getByRole('button', { name: 'Set Grimdark ending as active draft' }));
    expect(useSelectedDraftStore.getState().selected).toBeNull();
  });

  it('✎ swaps the row to InlineEdit; committing a new name PATCHes {label}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        draft: {
          ...meta({ id: 'd-c', orderIndex: 2 }),
          label: 'Third way',
          bodyJson: null,
          summary: null,
          summaryUpdatedAt: null,
        },
      }),
    );
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Draft C' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Third way{Enter}');

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit];
    expect(url).toContain('/drafts/d-c');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Third way' });
  });

  it('committing an empty rename clears back to positional (PATCH {label: null})', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        draft: {
          ...meta({ id: 'd-b', orderIndex: 1 }),
          label: null,
          bodyJson: null,
          summary: null,
          summaryUpdatedAt: null,
        },
      }),
    );
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Grimdark ending' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ label: null });
  });

  it('committing an unchanged label fires no PATCH', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Grimdark ending' }));
    await userEvent.keyboard('{Enter}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🗑 is hidden on the active row; confirming deletes and clears a matching selection', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    useSelectedDraftStore.getState().setSelectedDraft('ch-1', 'd-c');
    renderList({ viewedDraftId: 'd-c' });

    expect(screen.queryByRole('button', { name: 'Delete Draft A' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Draft C' }));
    await userEvent.click(screen.getByTestId('draft-row-d-c-confirm-delete'));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
    await waitFor(() => {
      expect(useSelectedDraftStore.getState().selected).toBeNull();
    });
  });

  it('delete failure reports via onStatus and keeps the confirm open', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: { message: 'Cannot delete the active draft', code: 'cannot_delete_active_draft' },
      }),
    );
    const { onStatus } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Draft C' }));
    await userEvent.click(screen.getByTestId('draft-row-d-c-confirm-delete'));

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith('Draft is now active elsewhere — refreshed');
    });
    expect(screen.getByTestId('draft-row-d-c-confirm')).toBeInTheDocument();
  });

  it('renders the "+ New draft…" row and fires onRequestNewDraft', async () => {
    const { onRequestNewDraft } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'New draft…' }));
    expect(onRequestNewDraft).toHaveBeenCalledWith('ch-1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- tests/components/DraftList.test.tsx`
Expected: FAIL — module `@/components/DraftList` not found.

- [ ] **Step 3: Implement `frontend/src/components/DraftList.tsx`**

```tsx
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useRef, useState } from 'react';
import type { DraftMeta } from 'story-editor-shared';
import {
  CloseIcon,
  IconButton,
  InlineConfirm,
  InlineEdit,
  revealOnRowHover,
  useInlineConfirm,
} from '@/design/primitives';
import {
  activeDraftIdOf,
  draftDisplayLabel,
  draftsQueryKey,
  useDeleteDraftMutation,
  useDraftsQuery,
  useSetActiveDraftMutation,
  useUpdateDraftMutation,
} from '@/hooks/useDrafts';
import { ApiError } from '@/lib/api';
import { formatWordCountCompact } from '@/lib/formatWordCount';
import { useSelectedDraftStore } from '@/store/selectedDraft';

export interface DraftListProps {
  chapterId: string;
  storyId: string;
  /** The draft open in the editor (EditorPage's viewedDraftId), or null. */
  viewedDraftId: string | null;
  onSelectDraft: (chapterId: string, draftId: string) => void;
  onRequestNewDraft: (chapterId: string) => void;
  /** Sink into ChapterList's aria-live status region. */
  onStatus: (message: string) => void;
}

interface DraftRowProps {
  draft: DraftMeta;
  displayLabel: string;
  viewed: boolean;
  editing: boolean;
  onSelect: () => void;
  onSetActive: () => void;
  onStartRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onRequestDelete: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * One draft child row. Anatomy mirrors ChapterRow at three-quarter scale:
 * active dot · label · word count · hover actions (★ set active, ✎ rename,
 * delete — never on the active row, parent spec §7).
 */
function DraftRow({
  draft,
  displayLabel,
  viewed,
  editing,
  onSelect,
  onSetActive,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  isDeleting,
}: DraftRowProps): JSX.Element {
  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);

  const onConfirmDelete = async (): Promise<void> => {
    try {
      await onRequestDelete();
      confirm.dismiss();
    } catch {
      // Failure surfaced via ChapterList's aria-live region (onStatus); keep
      // the confirm open so the user can retry or cancel.
    }
  };

  return (
    <li
      ref={liRef}
      data-testid={`draft-row-${draft.id}`}
      aria-current={viewed ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-10 pr-2 h-7 rounded-[var(--radius)]',
        'transition-colors cursor-pointer',
        viewed ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
      ].join(' ')}
    >
      {draft.isActive ? (
        <span
          aria-label="Active draft"
          className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0"
        />
      ) : (
        <span aria-hidden="true" className="w-1.5 h-1.5 flex-shrink-0" />
      )}
      {editing ? (
        <InlineEdit
          initialValue={draft.label ?? ''}
          placeholder={displayLabel}
          ariaLabel="Rename draft"
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          testId={`draft-row-${draft.id}-rename`}
        />
      ) : confirm.open ? (
        <InlineConfirm
          {...confirm.props}
          label={`Delete ${displayLabel}`}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          pending={isDeleting}
          testId={`draft-row-${draft.id}-confirm`}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            className="flex-1 min-w-0 text-left font-sans text-[12.5px] text-ink-2 leading-tight truncate"
          >
            {displayLabel}
          </button>
          <span className="font-mono text-[11px] text-ink-4 tabular-nums flex-shrink-0">
            {formatWordCountCompact(draft.wordCount)}
          </span>
          <span className={['flex items-center gap-0.5 flex-shrink-0', revealOnRowHover].join(' ')}>
            {draft.isActive ? null : (
              <IconButton
                ariaLabel={`Set ${displayLabel} as active draft`}
                onClick={onSetActive}
                testId={`draft-row-${draft.id}-set-active`}
              >
                <span aria-hidden="true">★</span>
              </IconButton>
            )}
            <IconButton
              ariaLabel={`Rename ${displayLabel}`}
              onClick={onStartRename}
              testId={`draft-row-${draft.id}-rename-button`}
            >
              <span aria-hidden="true">✎</span>
            </IconButton>
            {draft.isActive ? null : (
              <IconButton
                ariaLabel={`Delete ${displayLabel}`}
                onClick={confirm.ask}
                testId={`draft-row-${draft.id}-delete`}
              >
                <CloseIcon />
              </IconButton>
            )}
          </span>
        </>
      )}
    </li>
  );
}

export function DraftList({
  chapterId,
  storyId,
  viewedDraftId,
  onSelectDraft,
  onRequestNewDraft,
  onStatus,
}: DraftListProps): JSX.Element {
  const { data } = useDraftsQuery(chapterId);
  const drafts = data ?? [];
  const activeId = activeDraftIdOf(data);
  const qc = useQueryClient();

  const setActiveDraft = useSetActiveDraftMutation();
  const deleteDraft = useDeleteDraftMutation();
  const updateDraft = useUpdateDraftMutation();

  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // D9 membership test: draft ids are chapter-unique, so "the viewed draft is
  // in THIS list" ⇔ "this chapter is open in the editor".
  const viewedHere = viewedDraftId !== null && drafts.some((d) => d.id === viewedDraftId);

  const handleSetActive = (draftId: string): void => {
    onStatus('');
    // D9: activating while the editor follows the active draft would jump
    // the view to the new active mid-edit. Pin the current view first — only
    // the dot moves. (No-op when this chapter isn't the open one.)
    if (viewedHere && viewedDraftId !== null) {
      useSelectedDraftStore.getState().setSelectedDraft(chapterId, viewedDraftId);
    }
    setActiveDraft.mutate(
      { chapterId, storyId, draftId, previousActiveDraftId: activeId },
      {
        onError: () => {
          onStatus('Could not set the active draft — try again');
          void qc.invalidateQueries({ queryKey: draftsQueryKey(chapterId) });
        },
      },
    );
  };

  const handleCommitRename = (draft: DraftMeta, value: string): void => {
    setEditingDraftId(null);
    const label = value.length === 0 ? null : value;
    if (label === draft.label) return;
    onStatus('');
    updateDraft.mutate(
      { draftId: draft.id, chapterId, storyId, input: { label } },
      {
        onError: () => {
          onStatus('Rename failed — try again');
        },
      },
    );
  };

  const handleRequestDelete = async (draftId: string): Promise<void> => {
    onStatus('');
    setPendingDeleteId(draftId);
    try {
      await deleteDraft.mutateAsync({ chapterId, storyId, draftId });
      if (useSelectedDraftStore.getState().selected?.draftId === draftId) {
        useSelectedDraftStore.getState().clearSelectedDraft();
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'cannot_delete_active_draft'
          ? 'Draft is now active elsewhere — refreshed'
          : 'Delete failed — try again';
      onStatus(message);
      // Resync: the 409 race codes mean our list is stale.
      void qc.invalidateQueries({ queryKey: draftsQueryKey(chapterId) });
      throw err;
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <ul className="flex flex-col gap-0.5 py-0.5" data-testid={`draft-list-${chapterId}`}>
      {drafts.map((d) => (
        <DraftRow
          key={d.id}
          draft={d}
          displayLabel={draftDisplayLabel(d)}
          viewed={d.id === viewedDraftId}
          editing={editingDraftId === d.id}
          onSelect={() => {
            onSelectDraft(chapterId, d.id);
          }}
          onSetActive={() => {
            handleSetActive(d.id);
          }}
          onStartRename={() => {
            setEditingDraftId(d.id);
          }}
          onCommitRename={(value) => {
            handleCommitRename(d, value);
          }}
          onCancelRename={() => {
            setEditingDraftId(null);
          }}
          onRequestDelete={() => handleRequestDelete(d.id)}
          isDeleting={pendingDeleteId === d.id}
        />
      ))}
      <li className="pl-10 pr-2">
        <button
          type="button"
          aria-label="New draft…"
          onClick={() => {
            onRequestNewDraft(chapterId);
          }}
          data-testid={`draft-list-${chapterId}-new`}
          className="w-full text-left font-sans text-[12px] text-ink-4 hover:text-ink-2 h-6 transition-colors"
        >
          ＋ New draft…
        </button>
      </li>
    </ul>
  );
}
```

Note on the InlineConfirm testId: `InlineConfirm` renders its Delete button as `${testId}-delete` — with `testId={\`draft-row-${draft.id}-confirm\`}` the button is `draft-row-d-c-confirm-delete`, which is what the test clicks.

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix frontend run test -- tests/components/DraftList.test.tsx`
Expected: PASS (12 tests).

- [ ] **Step 5: Stories**

Create `frontend/src/components/DraftList.stories.tsx` (query data seeded directly — no network; match the decorator conventions of `ChapterList.stories.tsx` if they differ):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DraftMeta } from 'story-editor-shared';
import { DraftList } from '@/components/DraftList';
import { draftsQueryKey } from '@/hooks/useDrafts';

function seeded(drafts: DraftMeta[]): QueryClient {
  // staleTime: Infinity — no network in Storybook; the seed is the data.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(draftsQueryKey('ch-1'), drafts);
  return qc;
}

function metaOf(overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>): DraftMeta {
  return {
    chapterId: 'ch-1',
    label: null,
    wordCount: 1200,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

const THREE_DRAFTS = [
  metaOf({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2143 }),
  metaOf({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending', wordCount: 1890 }),
  metaOf({ id: 'd-c', orderIndex: 2, wordCount: 260 }),
];

const meta: Meta<typeof DraftList> = {
  title: 'Components/DraftList',
  component: DraftList,
  args: {
    chapterId: 'ch-1',
    storyId: 'story-1',
    viewedDraftId: 'd-b',
  },
  argTypes: {
    onSelectDraft: { action: 'selectDraft' },
    onRequestNewDraft: { action: 'requestNewDraft' },
    onStatus: { action: 'status' },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={seeded(THREE_DRAFTS)}>
        <div className="w-64 p-2 bg-bg">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof DraftList>;

export const ViewingNonActiveDraft: Story = {};

export const FollowingActiveDraft: Story = {
  args: { viewedDraftId: 'd-a' },
};
```

- [ ] **Step 6: Typecheck + design lint**

Run: `npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/DraftList.tsx frontend/src/components/DraftList.stories.tsx frontend/tests/components/DraftList.test.tsx
git commit -m "[story-editor-9wk.7] DraftList: draft child rows with set-active/rename/delete + view pinning"
git show --stat HEAD
```

---

### Task 6: ChapterList wiring — caret expansion, DraftList mount, ＋ affordance (spec D4)

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx` (props, expansion state, row restructure, status region)
- Modify: `frontend/src/pages/EditorPage.tsx:680-691` (new ChapterList props + `handleSelectDraft` + dialog-request state)
- Modify: `frontend/src/components/ChapterList.stories.tsx` (multi-draft story)
- Test: `frontend/tests/components/ChapterList.drafts.test.tsx` (new file)

**Interfaces:**
- Consumes: Task 5's `DraftList`; Task 1's `setSelectedDraft` (via EditorPage handler); `ChapterMeta.draftCount`.
- Produces: `ChapterListProps` gains `{ viewedDraftId: string | null; onSelectDraft: (chapterId: string, draftId: string) => void; onRequestNewDraft: (chapterId: string) => void }`. EditorPage gains `const [newDraftChapterId, setNewDraftChapterId] = useState<string | null>(null)` (Task 7 renders the dialog from it) and `handleSelectDraft`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/ChapterList.drafts.test.tsx` (harness mirrors `ChapterList.test.tsx`'s fetch-stub style; `makeChapterMeta` comes from `../fixtures/chapter`):

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterList } from '@/components/ChapterList';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';
import { makeChapterMeta } from '../fixtures/chapter';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function draftMeta(
  overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>,
): DraftMeta {
  return {
    chapterId: 'ch-1',
    label: null,
    wordCount: 500,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

const CH1_DRAFTS: DraftMeta[] = [
  draftMeta({ id: 'd-a', orderIndex: 0, isActive: true }),
  draftMeta({ id: 'd-b', orderIndex: 1 }),
  draftMeta({ id: 'd-c', orderIndex: 2 }),
];

interface Handlers {
  onSelectChapter: ReturnType<typeof vi.fn>;
  onSelectDraft: ReturnType<typeof vi.fn>;
  onRequestNewDraft: ReturnType<typeof vi.fn>;
}

function renderList(activeChapterId: string | null): Handlers {
  const handlers: Handlers = {
    onSelectChapter: vi.fn(),
    onSelectDraft: vi.fn(),
    onRequestNewDraft: vi.fn(),
  };
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ChapterList
        storyId="story-1"
        activeChapterId={activeChapterId}
        onSelectChapter={handlers.onSelectChapter}
        onOpenSummary={vi.fn()}
        openPopoverChapterId={null}
        viewedDraftId={null}
        onSelectDraft={handlers.onSelectDraft}
        onRequestNewDraft={handlers.onRequestNewDraft}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

describe('ChapterList draft tree (9wk.7)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({ id: 'ch-1', orderIndex: 0, title: 'Many', draftCount: 3 }),
              makeChapterMeta({ id: 'ch-2', orderIndex: 1, title: 'One', draftCount: 1 }),
            ],
          }),
        );
      }
      if (url.endsWith('/chapters/ch-1/drafts')) {
        return Promise.resolve(jsonResponse(200, { drafts: CH1_DRAFTS }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('multi-draft chapter shows a caret; single-draft chapter shows none', async () => {
    renderList(null);
    const rowMany = await screen.findByTestId('chapter-row-ch-1');
    const rowOne = screen.getByTestId('chapter-row-ch-2');
    expect(within(rowMany).getByRole('button', { name: 'Show drafts' })).toBeInTheDocument();
    expect(within(rowOne).queryByRole('button', { name: 'Show drafts' })).toBeNull();
  });

  it('the open chapter auto-expands its drafts (caret reports expanded)', async () => {
    renderList('ch-1');
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();
    expect(screen.getByText('Draft B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show drafts' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('a non-open multi-draft chapter starts collapsed and toggles via the caret', async () => {
    renderList('ch-2');
    await screen.findByTestId('chapter-row-ch-1');
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();
  });

  it('the open chapter can be manually collapsed (override beats the default)', async () => {
    renderList('ch-1');
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();
  });

  it('single-draft chapter shows the ＋ affordance which fires onRequestNewDraft', async () => {
    const { onRequestNewDraft } = renderList(null);
    const rowOne = await screen.findByTestId('chapter-row-ch-2');
    await userEvent.click(within(rowOne).getByRole('button', { name: 'New draft' }));
    expect(onRequestNewDraft).toHaveBeenCalledWith('ch-2');
  });

  it('clicking a draft row propagates onSelectDraft up through ChapterList', async () => {
    const { onSelectDraft } = renderList('ch-1');
    await screen.findByTestId('draft-list-ch-1');
    await userEvent.click(screen.getByText('Draft B'));
    expect(onSelectDraft).toHaveBeenCalledWith('ch-1', 'd-b');
  });
});
```

Binding accessible names: caret = `Show drafts` (with `aria-expanded`); single-draft affordance = `New draft`. (If `makeChapterMeta` doesn't yet accept a `draftCount` override, extend the fixture in `frontend/tests/fixtures/chapter.ts` — `ChapterMeta` carries the field, so the fixture must already default it; just pass the override through.)

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- tests/components/ChapterList.drafts.test.tsx`
Expected: FAIL — new props/roles don't exist.

- [ ] **Step 3: Implement ChapterList changes**

In `frontend/src/components/ChapterList.tsx`:

a. Extend the props:

```ts
export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  onChapterDeleted?: (chapterId: string) => void;
  onOpenSummary: (chapterId: string, anchorEl: HTMLElement) => void;
  openPopoverChapterId?: string | null;
  /** [9wk.7] The draft open in the editor — highlights its row in the tree. */
  viewedDraftId: string | null;
  /** [9wk.7] Draft row clicked (chapter + draft pair, set atomically upstream). */
  onSelectDraft: (chapterId: string, draftId: string) => void;
  /** [9wk.7] ＋ affordances — opens the new-draft dialog for the chapter. */
  onRequestNewDraft: (chapterId: string) => void;
}
```

b. Expansion state in `ChapterList` (component body, next to the other state):

```ts
  // [9wk.7] D4 — caret expansion. Manual toggles override the default
  // (default: expanded iff the chapter is open in the editor). Ephemeral;
  // cleared when the story changes.
  const [expandOverrides, setExpandOverrides] = useState<Map<string, boolean>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: storyId change invalidates the overrides.
  useEffect(() => {
    setExpandOverrides(new Map());
  }, [storyId]);

  const isExpanded = useCallback(
    (chapter: ChapterMeta): boolean => {
      if (chapter.draftCount <= 1) return false;
      return expandOverrides.get(chapter.id) ?? chapter.id === activeChapterId;
    },
    [expandOverrides, activeChapterId],
  );

  const toggleExpanded = useCallback(
    (chapter: ChapterMeta): void => {
      setExpandOverrides((prev) => {
        const next = new Map(prev);
        const current = prev.get(chapter.id) ?? chapter.id === activeChapterId;
        next.set(chapter.id, !current);
        return next;
      });
    },
    [activeChapterId],
  );
```

(add `useEffect` to the react import; `useState`/`useCallback` are already imported.)

c. Restructure `ChapterRow` to host children: the `<li>` keeps all current row content wrapped in a `div` with the current flex classes, and renders `{children}` (the DraftList) below it. Concretely: change the `<li … className={[...]}>` so the *interactive row* classes (`flex items-center gap-2 pl-3 pr-2 h-8 …`) — **including `group`, which drives every `revealOnRowHover`/`group-hover` reveal in the row (grip, ＋ affordance) and must sit on the row `<div>`, not the `<li>`** — move onto an inner `<div>`, while the `<li>` keeps `setRefs`, `style`, the data/aria attributes, and gains only layout-neutral classes. (jsdom tests cannot catch a dropped `group`; treat this as a binding instruction.) New `ChapterRowProps` additions:

```ts
  expanded: boolean;
  onToggleExpanded: () => void;
  showNewDraftAffordance: boolean;   // draftCount === 1
  onRequestNewDraft: (chapterId: string) => void;
  children?: ReactNode;              // the DraftList when expanded
```

(extend the react type import: `import type { JSX, ReactNode } from 'react';`)

d. Caret between the number and the title (renders only when `chapter.draftCount > 1`):

```tsx
      {chapter.draftCount > 1 ? (
        <button
          type="button"
          aria-label="Show drafts"
          aria-expanded={expanded}
          data-testid={`chapter-row-${chapter.id}-caret`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
          className="flex-shrink-0 text-ink-4 hover:text-ink-2 transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        >
          <span aria-hidden="true">▸</span>
        </button>
      ) : null}
```

e. Single-draft ＋ affordance in the row's action cluster (next to the delete IconButton, wrapped in the shared reveal fragment):

```tsx
          {showNewDraftAffordance ? (
            <IconButton
              ariaLabel="New draft"
              onClick={() => {
                onRequestNewDraft(chapter.id);
              }}
              testId={`chapter-row-${chapter.id}-new-draft`}
              className={['flex-shrink-0', revealOnRowHover].join(' ')}
            >
              <span aria-hidden="true">＋</span>
            </IconButton>
          ) : null}
```

f. In `ChapterList`'s render, pass the new pieces and mount `DraftList`:

```tsx
              {list.map((c) => (
                <ChapterRow
                  key={c.id}
                  chapter={c}
                  active={c.id === activeChapterId}
                  onSelect={onSelectChapter}
                  onRequestDelete={handleRequestDelete}
                  isDeleting={pendingDeleteId === c.id}
                  onOpenSummary={onOpenSummary}
                  popoverOpen={openPopoverChapterId === c.id}
                  expanded={isExpanded(c)}
                  onToggleExpanded={() => {
                    toggleExpanded(c);
                  }}
                  showNewDraftAffordance={c.draftCount === 1}
                  onRequestNewDraft={onRequestNewDraft}
                >
                  {isExpanded(c) ? (
                    <DraftList
                      chapterId={c.id}
                      storyId={storyId}
                      viewedDraftId={viewedDraftId}
                      onSelectDraft={onSelectDraft}
                      onRequestNewDraft={onRequestNewDraft}
                      onStatus={setDraftStatus}
                    />
                  ) : null}
                </ChapterRow>
              ))}
```

g. Status region: add `const [draftStatus, setDraftStatus] = useState<string>('');` and change the live region to space-join the three strings:

```tsx
      <div role="status" aria-live="polite" className="sr-only">
        {[reorderStatus, deleteStatus, draftStatus].filter(Boolean).join(' ')}
      </div>
```

- [ ] **Step 4: Wire EditorPage**

In `frontend/src/pages/EditorPage.tsx`:

a. Add next to the other selection wiring (Task 1's block):

```ts
  const setSelectedDraft = useSelectedDraftStore((s) => s.setSelectedDraft);
  // [9wk.7] Dialog-request state — which chapter the new-draft dialog is
  // open for (null = closed). Rendered in Task 7.
  const [newDraftChapterId, setNewDraftChapterId] = useState<string | null>(null);

  const handleSelectDraft = useCallback(
    (chapterId: string, draftId: string): void => {
      // Pair first, then the chapter switch — the pair's chapterId matches
      // the incoming chapter, so the conditional reset effect keeps it (D1).
      setSelectedDraft(chapterId, draftId);
      if (chapterId !== activeChapterId) setActiveChapterId(chapterId);
    },
    [setSelectedDraft, activeChapterId, setActiveChapterId],
  );
```

b. Extend the `<ChapterList …>` invocation (currently lines 680–691):

```tsx
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
                onChapterDeleted={(deletedId) => {
                  if (deletedId === activeChapterId) setActiveChapterId(null);
                }}
                onOpenSummary={(chapterId, anchorEl) => {
                  setSummaryPopoverState({ chapterId, anchorEl });
                }}
                openPopoverChapterId={summaryPopoverState?.chapterId ?? null}
                viewedDraftId={viewedDraftId}
                onSelectDraft={handleSelectDraft}
                onRequestNewDraft={setNewDraftChapterId}
              />
```

(`setNewDraftChapterId` is referenced by the props now and consumed by Task 7's dialog render — an `// eslint`-style unused warning cannot occur since it's used here.)

- [ ] **Step 5: Update ChapterList stories + fix existing ChapterList tests**

- `frontend/src/components/ChapterList.stories.tsx`: add the three new args to every story's props (e.g. `viewedDraftId: null`, actions for `onSelectDraft`/`onRequestNewDraft`), plus one new story `WithDraftTree` whose chapters fixture includes a `draftCount: 3` chapter and whose decorator seeds `draftsQueryKey(<that chapter id>)` with three `DraftMeta` fixtures (reuse Task 5's `metaOf` shape inline).
- Existing test files that RENDER `<ChapterList …>` fail to compile against the widened required props — add `viewedDraftId={null} onSelectDraft={vi.fn()} onRequestNewDraft={vi.fn()}` to each render site. Exactly two files render it: `ChapterList.test.tsx` (the `renderList` helper) and `ChapterList.delete.test.tsx`. (`ChapterList.dragA11y.test.tsx` and `ChapterReorder.test.tsx` test pure helpers/hooks, not the component — no changes there.)

- [ ] **Step 6: Run the ChapterList suites + typecheck + design lint**

Run: `npm --prefix frontend run test -- tests/components/ChapterList.drafts.test.tsx tests/components/ChapterList.test.tsx tests/components/ChapterList.delete.test.tsx && npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChapterList.tsx frontend/src/components/ChapterList.stories.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/ChapterList.drafts.test.tsx frontend/tests/components/ChapterList.test.tsx frontend/tests/components/ChapterList.delete.test.tsx
git commit -m "[story-editor-9wk.7] ChapterList draft tree: caret expansion + DraftList mount + new-draft affordance"
git show --stat HEAD
```

---

### Task 7: `NewDraftDialog` (spec D5)

**Files:**
- Create: `frontend/src/components/NewDraftDialog.tsx`
- Create: `frontend/src/components/NewDraftDialog.stories.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx` (render the dialog from `newDraftChapterId`)
- Test: `frontend/tests/components/NewDraftDialog.test.tsx`

**Interfaces:**
- Consumes: Task 3's `useCreateDraftMutation` + `positionalDraftLabel`; Task 6's `newDraftChapterId` state + `handleSelectDraft`; `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter`/`Field`/`Input`/`Button`/`useId` from `@/design/primitives`.
- Produces: `NewDraftDialog` with props `{ chapterId: string; storyId: string; draftCount: number; viewedIsActive: boolean; onClose: () => void; onCreated: (draft: Draft) => void }` (always rendered open — the parent mounts it conditionally).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/NewDraftDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import type { Draft } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewDraftDialog } from '@/components/NewDraftDialog';
import { resetApiClientForTests } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const createdDraft: Draft = {
  id: 'd-new',
  chapterId: 'ch-1',
  label: null,
  wordCount: 0,
  orderIndex: 3,
  isActive: false,
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  bodyJson: null,
  summary: null,
  summaryUpdatedAt: null,
};

function renderDialog(
  overrides: Partial<{ viewedIsActive: boolean; draftCount: number }> = {},
): { onClose: ReturnType<typeof vi.fn>; onCreated: ReturnType<typeof vi.fn> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <NewDraftDialog
      chapterId="ch-1"
      storyId="story-1"
      draftCount={overrides.draftCount ?? 3}
      viewedIsActive={overrides.viewedIsActive ?? true}
      onClose={onClose}
      onCreated={onCreated}
    />,
    { wrapper },
  );
  return { onClose, onCreated };
}

describe('NewDraftDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('fork is the default mode; the name placeholder is the next positional label', () => {
    renderDialog({ draftCount: 3 });
    expect(screen.getByRole('radio', { name: 'Fork current draft' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Start blank' })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveAttribute(
      'placeholder',
      'Draft D',
    );
  });

  it('says "Fork active draft" when the viewed draft is not the active one (D5)', () => {
    renderDialog({ viewedIsActive: false });
    expect(screen.getByRole('radio', { name: 'Fork active draft' })).toBeChecked();
  });

  it('creating with an empty name POSTs {mode} only, then onCreated + onClose', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: createdDraft }));
    const { onClose, onCreated } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdDraft);
    });
    expect(onClose).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/drafts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'fork' });
  });

  it('blank mode + custom name POSTs {mode: blank, label}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: createdDraft }));
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: 'Start blank' }));
    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), '  Clean rewrite  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'blank', label: 'Clean rewrite' });
  });

  it('a failed create keeps the dialog open and shows an inline error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { message: 'boom', code: 'internal' } }),
    );
    const { onClose, onCreated } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not create/i);
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without POSTing', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- tests/components/NewDraftDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frontend/src/components/NewDraftDialog.tsx`**

```tsx
import type { JSX } from 'react';
import { useState } from 'react';
import type { Draft } from 'story-editor-shared';
import {
  Button,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  useId,
} from '@/design/primitives';
import { positionalDraftLabel, useCreateDraftMutation } from '@/hooks/useDrafts';

export interface NewDraftDialogProps {
  chapterId: string;
  storyId: string;
  /** Current number of drafts — the name placeholder is the NEXT positional label. */
  draftCount: number;
  /**
   * True when the fork source (always the chapter's ACTIVE draft — the API
   * has no source parameter) is also the draft being viewed. When false the
   * radio says "Fork active draft" so the UI never promises a copy the API
   * can't make (spec D5).
   */
  viewedIsActive: boolean;
  onClose: () => void;
  onCreated: (draft: Draft) => void;
}

export function NewDraftDialog({
  chapterId,
  storyId,
  draftCount,
  viewedIsActive,
  onClose,
  onCreated,
}: NewDraftDialogProps): JSX.Element {
  const titleId = useId();
  const nameId = useId();
  const [mode, setMode] = useState<'fork' | 'blank'>('fork');
  const [name, setName] = useState('');
  const createDraft = useCreateDraftMutation();

  const forkLabel = viewedIsActive ? 'Fork current draft' : 'Fork active draft';
  const placeholder = positionalDraftLabel(draftCount);

  const handleCreate = (): void => {
    const trimmed = name.trim();
    createDraft.mutate(
      {
        chapterId,
        storyId,
        input: { mode, ...(trimmed.length > 0 ? { label: trimmed } : {}) },
      },
      {
        onSuccess: (draft) => {
          onClose();
          onCreated(draft);
        },
      },
    );
  };

  return (
    <Modal open onClose={onClose} labelledBy={titleId} size="sm" testId="new-draft-dialog">
      <ModalHeader titleId={titleId} title="New draft" onClose={onClose} />
      <ModalBody className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5 border-0 p-0 m-0">
          <legend className="sr-only">Starting point</legend>
          <label className="flex items-center gap-2 font-sans text-[13px] text-ink cursor-pointer">
            <input
              type="radio"
              name="new-draft-mode"
              checked={mode === 'fork'}
              onChange={() => {
                setMode('fork');
              }}
            />
            {forkLabel}
          </label>
          <label className="flex items-center gap-2 font-sans text-[13px] text-ink cursor-pointer">
            <input
              type="radio"
              name="new-draft-mode"
              checked={mode === 'blank'}
              onChange={() => {
                setMode('blank');
              }}
            />
            Start blank
          </label>
        </fieldset>
        <Field label="Name (optional)" htmlFor={nameId}>
          <Input
            id={nameId}
            value={name}
            placeholder={placeholder}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        {createDraft.isError ? (
          <p role="alert" className="font-sans text-[12.5px] text-danger m-0">
            Could not create the draft — try again.
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={createDraft.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate} loading={createDraft.isPending}>
          Create draft
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

(Check `Field`'s actual prop names in `primitives.tsx:357-367` — it takes `{ label, hint, error, htmlFor, children }`; and `Button`'s pending prop is `loading` per `InlineConfirm`'s usage. If `Input` doesn't accept `id` directly it extends `InputHTMLAttributes` — it does.)

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix frontend run test -- tests/components/NewDraftDialog.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Render it from EditorPage**

In `frontend/src/pages/EditorPage.tsx`, next to the other modal renders near the end of the JSX (e.g. adjacent to the summary popover render), add:

```tsx
      {newDraftChapterId !== null && story ? (
        <NewDraftDialog
          chapterId={newDraftChapterId}
          storyId={story.id}
          draftCount={
            chaptersQuery.data?.find((c) => c.id === newDraftChapterId)?.draftCount ?? 1
          }
          viewedIsActive={
            newDraftChapterId !== activeChapterId ||
            viewedDraftId === activeDraftIdOf(draftsQuery.data)
          }
          onClose={() => {
            setNewDraftChapterId(null);
          }}
          onCreated={(draft) => {
            // Select the fresh draft (cache already seeded by the mutation).
            handleSelectDraft(draft.chapterId, draft.id);
          }}
        />
      ) : null}
```

Add the import: `import { NewDraftDialog } from '@/components/NewDraftDialog';`.

- [ ] **Step 6: Stories**

Create `frontend/src/components/NewDraftDialog.stories.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NewDraftDialog } from '@/components/NewDraftDialog';

const meta: Meta<typeof NewDraftDialog> = {
  title: 'Components/NewDraftDialog',
  component: NewDraftDialog,
  args: {
    chapterId: 'ch-1',
    storyId: 'story-1',
    draftCount: 3,
    viewedIsActive: true,
  },
  argTypes: {
    onClose: { action: 'close' },
    onCreated: { action: 'created' },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof NewDraftDialog>;

export const ForkCurrentDraft: Story = {};

export const ViewingNonActiveDraft: Story = {
  args: { viewedIsActive: false },
};
```

- [ ] **Step 7: Full test pass on the touched surfaces + typecheck + design lint**

Run: `npm --prefix frontend run test -- tests/components/NewDraftDialog.test.tsx tests/pages/editor-autosave.integration.test.tsx && npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/NewDraftDialog.tsx frontend/src/components/NewDraftDialog.stories.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/NewDraftDialog.test.tsx
git commit -m "[story-editor-9wk.7] NewDraftDialog: fork/blank + optional name, selects the created draft"
git show --stat HEAD
```

---

### Task 8: Paper draft-label binding + final sweep (spec D10)

**Files:**
- Modify: `frontend/src/components/Paper.tsx:97` (drop the `'Draft 1'` dummy)
- Modify: `frontend/src/pages/EditorPage.tsx` (pass `draftLabel` to `<Paper …>`)
- Modify: any test/story asserting the dummy (`grep -rn "Draft 1" frontend/src frontend/tests` and fix each)
- Test: extend `frontend/tests/pages/editor-autosave.integration.test.tsx` (label-after-switch assertion)

**Interfaces:**
- Consumes: Task 3's `draftDisplayLabel`; EditorPage's `draftsQuery` + `viewedDraftId`.

- [ ] **Step 1: Write the failing integration assertion**

In the `[9wk.7]` cached-switch test added in Task 2 (Test A), after the final banner assertion, append:

```ts
    // D10: the Paper sub-row shows the VIEWED draft's display label — B has
    // no custom label, so its positional label renders.
    expect(screen.getByTestId('paper-sub')).toHaveTextContent('Draft B');
```

And in the existing 9wk.6 test `'draft-switch never cross-flushes…'`, after the first `await waitFor(...'Draft B body'...)`, nothing — leave it; one assertion site is enough.

Run: `npm --prefix frontend run test -- tests/pages/editor-autosave.integration.test.tsx`
Expected: the extended Test A FAILS — sub-row still shows the dummy `Draft 1`.

- [ ] **Step 2: Implement**

a. `frontend/src/pages/EditorPage.tsx` — compute the viewed meta near the `viewedDraftId` derivation:

```ts
  const viewedDraftMeta = draftsQuery.data?.find((d) => d.id === viewedDraftId) ?? null;
```

and add to the `<Paper …>` props (Paper already accepts `draftLabel?: string | null`):

```tsx
                    draftLabel={viewedDraftMeta ? draftDisplayLabel(viewedDraftMeta) : null}
```

(import `draftDisplayLabel` from `@/hooks/useDrafts` — merge into the existing import.)

b. `frontend/src/components/Paper.tsx` — in `SubRow`, replace:

```ts
  const draft = draftLabel ?? 'Draft 1';
  if (draft) parts.push({ key: 'draft', node: <span>{draft}</span> });
```

with (null now omits the segment, same as `genre`):

```ts
  if (draftLabel) parts.push({ key: 'draft', node: <span>{draftLabel}</span> });
```

- [ ] **Step 3: Sweep the dummy out of tests/stories**

Run: `grep -rn "'Draft 1'\|Draft 1" frontend/src frontend/tests | grep -v "Draft 1[0-9]"`
Expected hits: `Paper.tsx:97` (removed in Step 2) and `frontend/tests/components/Paper.test.tsx:91/97/106/112`. In particular the test `'defaults the draft label to "Draft 1" when not provided'` (~lines 106–112) inverts in intent: rewrite it as `'omits the draft segment when draftLabel is not provided'` asserting the `paper-sub` testid does NOT contain a `Draft` segment. Tests that pass an explicit `draftLabel` keep working; stories should pass an explicit `draftLabel: 'Draft A'` arg if they want the segment visible.

- [ ] **Step 4: Full frontend suite + typecheck + design lint**

Run: `npm --prefix frontend run test && npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS — the whole suite, not just the touched files (this is the task-level gate for the cross-cutting change).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Paper.tsx frontend/src/pages/EditorPage.tsx frontend/tests/
git commit -m "[story-editor-9wk.7] Paper sub-row: bind draftLabel to the viewed draft; retire the 'Draft 1' dummy"
git show --stat HEAD   # MUST NOT contain .beads/ — if it does: git reset HEAD~1 and recommit with explicit pathspecs
```

---

## Verify (bd close gate)

The issue's existing verify line stands: `npm --prefix frontend run typecheck && npm --prefix frontend run test` (frontend-only — no docker stack needed).
