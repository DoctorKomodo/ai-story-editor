# Edit-Story Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit an existing story's title/genre/synopsis/worldNotes/includePreviousChaptersInPrompt via a pencil button in the editor sidebar that opens the already-built `StoryModal` in edit mode.

**Architecture:** Mount `StoryModal mode='edit'` at the EditorPage root, opened from a new pencil `IconButton` in the `Sidebar` header, seeded with a **memoized** `initial` from the in-hand `useStoryQuery` data. Fix `useUpdateStoryMutation` to refresh the single-story cache on success so the open editor reflects the edit.

**Tech Stack:** React + TypeScript, TanStack Query, Vitest + Testing Library (jsdom), TailwindCSS design primitives.

**Spec:** `docs/superpowers/specs/2026-06-10-edit-story-surface-design.md`

---

## File Structure

- `frontend/src/hooks/useStories.ts` — **modify** `useUpdateStoryMutation.onSuccess` to also write the returned story into `storyQueryKey(id)`.
- `frontend/tests/hooks/useStories.test.tsx` — **create**; covers the cache-write contract.
- `frontend/src/components/Sidebar.tsx` — **modify**; add optional `onEditStory` prop + local `PencilIcon` + a pencil `IconButton` in the header.
- `frontend/tests/components/Sidebar.test.tsx` — **modify**; add render/click coverage for the pencil button.
- `frontend/src/pages/EditorPage.tsx` — **modify**; import `StoryModal`, add `editStoryOpen` state, a memoized `editStoryInitial`, wire `onEditStory` to `Sidebar`, mount the edit `StoryModal`.
- `frontend/tests/pages/editor.test.tsx` — **modify**; add open→seed→save (PATCH + cache refresh) coverage and the memoization regression test.

No backend, shared, or schema changes — `PATCH /api/stories/:id` and `StoryModal mode='edit'` already exist.

---

### Task 1: Refresh the single-story cache on update

**Files:**
- Test: `frontend/tests/hooks/useStories.test.tsx` (create)
- Modify: `frontend/src/hooks/useStories.ts:83-95`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/hooks/useStories.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Story } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storyQueryKey, useUpdateStoryMutation } from '@/hooks/useStories';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: 'The Long Dark',
    genre: 'Sci-Fi',
    synopsis: 'A ship adrift.',
    worldNotes: null,
    targetWords: 80_000,
    includePreviousChaptersInPrompt: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('useUpdateStoryMutation', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('writes the returned story into storyQueryKey(id) on success', async () => {
    const updated = makeStory({ title: 'Renamed' });
    fetchMock.mockResolvedValue(jsonResponse(200, { story: updated }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateStoryMutation(), { wrapper });

    await result.current.mutateAsync({ id: 's1', input: { title: 'Renamed' } });

    await waitFor(() => {
      expect(client.getQueryData(storyQueryKey('s1'))).toEqual(updated);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- useStories`
Expected: FAIL — `getQueryData(storyQueryKey('s1'))` is `undefined` (current `onSuccess` only invalidates the list).

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/hooks/useStories.ts`, change the `onSuccess` of `useUpdateStoryMutation` (lines 91-93) to set the single-story cache from the returned story before invalidating the list:

```ts
    onSuccess: (story) => {
      qc.setQueryData(storyQueryKey(story.id), story);
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
```

(`useCreateStoryMutation` is intentionally unchanged — create has no single-story cache entry to refresh and navigates afterward.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test -- useStories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useStories.ts frontend/tests/hooks/useStories.test.tsx
git commit -m "[story-editor-aay] useUpdateStoryMutation: refresh single-story cache on success"
```

---

### Task 2: Add the pencil edit-story button to the sidebar header

**Files:**
- Test: `frontend/tests/components/Sidebar.test.tsx` (modify)
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/components/Sidebar.test.tsx`, add these two cases inside the top-level `describe('Sidebar', …)` block (after the existing `onOpenStoryPicker` test):

```tsx
  it('does not render the edit-story button when onEditStory is absent', () => {
    renderSidebar();
    expect(screen.queryByTestId('sidebar-story-settings')).toBeNull();
  });

  it('renders the edit-story button and fires onEditStory when clicked', () => {
    const onEditStory = vi.fn();
    renderSidebar({ onEditStory });
    const btn = screen.getByTestId('sidebar-story-settings');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Edit story');
    fireEvent.click(btn);
    expect(onEditStory).toHaveBeenCalledTimes(1);
  });
```

(`renderSidebar`, `screen`, `fireEvent`, and `vi` are already imported/defined in this file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- Sidebar`
Expected: the first new test passes (button genuinely absent); the second FAILS — `getByTestId('sidebar-story-settings')` throws (button not rendered yet).

- [ ] **Step 3: Implement the pencil button**

In `frontend/src/components/Sidebar.tsx`:

1. Add the `IconButton` import below the existing imports (line 12 area):

```tsx
import { IconButton } from '@/design/primitives';
```

2. Add a local `PencilIcon` alongside the other local icon components (next to `BookIcon` / `ChevronDownIcon`):

```tsx
function PencilIcon(): JSX.Element {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
```

3. Add `onEditStory` to `SidebarProps` (after `onOpenStoryPicker?` at line 18):

```tsx
  onEditStory?: () => void;
```

4. Destructure it in the component signature (after `onOpenStoryPicker,` at line 92):

```tsx
  onEditStory,
```

5. Render the button inside the `sidebar-header` div, immediately after the closing `</button>` of the story-picker button (line 138) and before the closing `</div>` of the header (line 139):

```tsx
        {onEditStory ? (
          <IconButton
            ariaLabel="Edit story"
            testId="sidebar-story-settings"
            className="flex-shrink-0"
            onClick={onEditStory}
          >
            <PencilIcon />
          </IconButton>
        ) : null}
```

The header div already uses `flex items-center justify-between gap-1.5`; the story-picker button keeps `flex-1`, so the pencil sits flush-right.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- Sidebar`
Expected: PASS (both new tests + all existing Sidebar tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/tests/components/Sidebar.test.tsx
git commit -m "[story-editor-aay] Sidebar: add pencil edit-story button"
```

---

### Task 3: Mount the edit StoryModal from EditorPage

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`
- Test: `frontend/tests/pages/editor.test.tsx` (modify)

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/pages/editor.test.tsx`:

1. Add `within` to the testing-library import (currently `import { act, render, screen, waitFor } from '@testing-library/react';`):

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
```

2. Add `useSettingsModalStore` to the store imports:

```tsx
import { useSettingsModalStore } from '@/store/settingsModal';
```

3. Add these tests inside the `describe('EditorPage (F51 — AppShell shell)', …)` block (after the existing tests):

```tsx
  it('edit-story button opens StoryModal seeded with the current story', async () => {
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(200, { story: makeStory({ title: 'The Long Dark' }) })),
      ),
    );
    renderEditor();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('sidebar-story-settings'));

    const modal = await screen.findByTestId('story-modal');
    expect(within(modal).getByRole('heading', { name: /edit story/i })).toBeInTheDocument();
    expect(within(modal).getByLabelText(/title/i)).toHaveValue('The Long Dark');
  });

  it('saving the edit modal PATCHes and refreshes the displayed title', async () => {
    let patchCount = 0;
    const base = mockImpl(() =>
      Promise.resolve(jsonResponse(200, { story: makeStory({ title: 'The Long Dark' }) })),
    );
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url.endsWith('/stories/abc123') &&
        (init?.method ?? 'GET').toUpperCase() === 'PATCH'
      ) {
        patchCount += 1;
        return Promise.resolve(
          jsonResponse(200, { story: makeStory({ title: 'Renamed Novel' }) }),
        );
      }
      // `base` (mockImpl's return) takes only `url`; the PATCH case is
      // already handled above, so no `init` is needed when delegating.
      return base(url);
    });
    renderEditor();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('sidebar-story-settings'));
    const modal = await screen.findByTestId('story-modal');
    const titleInput = within(modal).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed Novel');
    await user.click(within(modal).getByTestId('story-modal-submit'));

    await waitFor(() => {
      expect(patchCount).toBe(1);
    });
    // Cache-set from Task 1 propagates the new title to the topbar + sidebar.
    await waitFor(() => {
      expect(screen.getAllByText('Renamed Novel').length).toBeGreaterThan(0);
    });
  });

  it('keeps in-progress edits when EditorPage re-renders (memoized initial)', async () => {
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(200, { story: makeStory({ title: 'The Long Dark' }) })),
      ),
    );
    renderEditor();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('sidebar-story-settings'));
    const modal = await screen.findByTestId('story-modal');
    const titleInput = within(modal).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Half-typed title');
    expect(titleInput).toHaveValue('Half-typed title');

    // Force an EditorPage re-render that does NOT change the story object.
    // Without a memoized `initial`, StoryModal's reset effect would re-seed
    // and wipe the field; with it, the typed value survives.
    act(() => {
      useSettingsModalStore.getState().openWith();
    });

    expect(within(screen.getByTestId('story-modal')).getByLabelText(/title/i)).toHaveValue(
      'Half-typed title',
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test -- editor`
Expected: all three FAIL — `getByTestId('sidebar-story-settings')` is wired (Task 2) but `onEditStory` is not passed by EditorPage yet, so the button never renders.

- [ ] **Step 3: Implement the EditorPage wiring**

In `frontend/src/pages/EditorPage.tsx`:

1. Add the `StoryModal` import next to the existing `StoryBrowser` import (line 55):

```tsx
import { StoryModal } from '@/components/StoryModal';
```

2. Add edit-modal open state next to `storyPickerOpen` (line 166):

```tsx
  const [editStoryOpen, setEditStoryOpen] = useState(false);
```

3. Add a memoized `initial` next to the existing `exportStory` memo (around line 272-289). It must live with the other top-level hooks (before the loading/error early returns) and guard on `story` being defined:

```tsx
  const editStoryInitial = useMemo(
    () =>
      story
        ? {
            id: story.id,
            title: story.title,
            genre: story.genre,
            synopsis: story.synopsis,
            worldNotes: story.worldNotes,
            includePreviousChaptersInPrompt: story.includePreviousChaptersInPrompt,
          }
        : undefined,
    [story],
  );
```

4. Pass `onEditStory` to `Sidebar` (in the `<Sidebar … />` props block, next to `onOpenStoryPicker` at line 497-499):

```tsx
            onEditStory={() => {
              setEditStoryOpen(true);
            }}
```

5. Mount the edit modal at page root, immediately after the `<StoryBrowser … />` element (line 684):

```tsx
        <StoryModal
          mode="edit"
          open={editStoryOpen}
          onClose={() => {
            setEditStoryOpen(false);
          }}
          initial={editStoryInitial}
        />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- editor`
Expected: PASS (all three new tests + existing EditorPage tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/tests/pages/editor.test.tsx
git commit -m "[story-editor-aay] EditorPage: mount edit StoryModal from sidebar pencil"
```

---

### Task 4: Full verify

- [ ] **Step 1: Typecheck + targeted suites**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- StoryModal Sidebar editor useStories`
Expected: typecheck clean; all listed suites PASS.

- [ ] **Step 2: Design lint (token guard)**

Run: `node frontend/scripts/lint-design.mjs`
Expected: PASS — no new hard-coded colors/values (the pencil uses `currentColor` + existing IconButton token classes).

---

## Self-Review

**Spec coverage:**
- Entry point = pencil `IconButton` in sidebar header → Task 2. ✓
- Distinct glyph (not gear), `ariaLabel="Edit story"`, local `PencilIcon` → Task 2. ✓
- `IconButton` uses `ariaLabel`/`testId` (not HTML attrs) → Task 2 Step 3. ✓
- EditorPage adds `StoryModal` import, `editStoryOpen` state, mounts edit modal → Task 3. ✓
- Memoized `initial` keyed on `story` to prevent reset-effect data loss → Task 3 Step 3 + regression test. ✓
- `useUpdateStoryMutation` refreshes `storyQueryKey(id)` → Task 1. ✓
- Tests: Sidebar render/click, EditorPage open/seed/save, useStories cache, memoization regression, `includePreviousChaptersInPrompt` reachable (the edit modal exposes the checkbox the `v6x` step couldn't reach) → Tasks 1-3. ✓
- Out of scope (non-active edit, targetWords, alt entry points) — none implemented. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `onEditStory?: () => void` defined in Task 2 and consumed in Task 3; `editStoryInitial` shape matches `StoryModalInitial` (`id/title/genre/synopsis/worldNotes/includePreviousChaptersInPrompt`, all present on `Story`); `storyQueryKey`/`storiesQueryKey` used as exported from `useStories.ts`; `setQueryData(storyQueryKey(story.id), story)` uses the mutation's returned `Story`.
