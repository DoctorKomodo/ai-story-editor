# StoryBrowser consolidation — fix "New story" in editor + hide unwired footer buttons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "New story" work inside the editor's Your-Stories picker (currently a no-op), navigate to the freshly-created story on create from both the editor and the dashboard, and stop the unwired "Import .docx" button from rendering as a dead no-op — by consolidating the picker + create-modal + navigation wiring into a single `StoryBrowser` component used by both surfaces.

**Architecture:** Today both `DashboardPage` and `EditorPage` render `<StoryPicker>`; the dashboard also mounts a create `<StoryModal>` and wires `onCreateStory`, while the editor wires neither — so the editor's "New story"/"Import .docx" buttons are inert. Rather than copy the create flow into `EditorPage` (the duplication that caused the drift), extract a `StoryBrowser` that owns: the `StoryModal` mount, the `createOpen` state, and the select→navigate / create→navigate wiring. Both pages render `<StoryBrowser>` with only their surface-specific props (`embedded`, `open`, `onClose`, `activeStoryId`). Two supporting component tweaks: `StoryPicker` renders each footer button only when its handler is wired (so an unwired "Import .docx" never shows), and `StoryModal` gains an `onCreated(story)` callback.

**Tech Stack:** React + TypeScript, TanStack Query, React Router (`useNavigate`), vitest + jsdom + Testing Library. bd issue: `story-editor-b6w`.

---

## File Structure

- `frontend/src/components/StoryPicker.tsx` — render the two footer buttons only when their handler is provided (footer block only).
- `frontend/src/components/StoryPicker.stories.tsx` — pass noop `onCreateStory` / `onImportDocx` in the `Demo` wrapper so Storybook still shows both footer buttons.
- `frontend/src/components/StoryModal.tsx` — add `onCreated?: (story: Story) => void`; call it after a successful create.
- `frontend/src/components/StoryBrowser.tsx` — **new.** Wraps `StoryPicker` + create `StoryModal`; owns `createOpen` state and all navigation. Props: `{ open, onClose, activeStoryId, embedded? }`.
- `frontend/src/components/StoryBrowser.stories.tsx` — **new.** Composed integration story (Router + Query decorators): Embedded + Modal surfaces, both opening the create modal on "New story".
- `frontend/src/pages/DashboardPage.tsx` — replace inline `StoryPicker` + `StoryModal` with `<StoryBrowser embedded open … />`; becomes a trivial layout wrapper.
- `frontend/src/pages/EditorPage.tsx` — replace inline `<StoryPicker>` with `<StoryBrowser>`; drop the now-redundant `handleStoryPickerSelect`.
- Tests:
  - `frontend/tests/components/StoryPicker.test.tsx` — hidden-when-unwired coverage.
  - `frontend/tests/components/StoryModal.test.tsx` — `onCreated` fires with the created story.
  - `frontend/tests/components/StoryBrowser.test.tsx` — **new.** select→navigate, New story opens modal, create→navigate, no Import button.
  - `frontend/tests/pages/editor.test.tsx` — clicking "New story" in the editor opens the create modal (integration through `EditorPage`→`StoryBrowser`).
  - `frontend/tests/pages/dashboard.test.tsx` — existing tests must stay green after the refactor (no new test needed; `StoryBrowser.test` owns navigation).

**Design notes (decided with user):**
- **Consolidate over duplicate.** A single `StoryBrowser` owns the create + navigation wiring; the bug-class (one surface wired, the other not) becomes structurally impossible.
- **Navigate on create from both surfaces.** `useCreateStoryMutation` returns the created `Story` (with `id`); `StoryModal.onCreated` hands it to `StoryBrowser`, which navigates. The dashboard does NOT navigate on create today — this changes that, per user direction.
- **Import .docx:** there is no backend import endpoint and no caller wires `onImportDocx`. `StoryBrowser` deliberately does not wire it, and `StoryPicker` hides any footer button whose handler is absent — so the button is absent everywhere until an import handler exists (hide, not disable: a disabled button with no explanation reads as broken).
- **Redundancy removed.** `StoryPicker.handleSelect` already calls `onClose()` after `onSelectStory` ([StoryPicker.tsx:54-57](frontend/src/components/StoryPicker.tsx#L54-L57)), so the editor's old `handleStoryPickerSelect` (which manually set the picker closed) is redundant. In `StoryBrowser`, `onSelectStory` is just `navigate(id)`.
- **Storybook: keep granular, add composed.** After this refactor both `StoryPicker` and `StoryModal` are internal to `StoryBrowser` (nothing else mounts them — `StoryModal`'s `edit` mode is currently unused in-app). Their stories stay anyway as the per-state visual source of truth: `StoryPicker` (Open / Empty / Embedded) and `StoryModal` (create / edit / validation-error) carry states the container cannot enumerate. Add one `StoryBrowser` composed story (Router + Query decorators) showing the real wired surface — clicking "New story" opens the create modal in place — as the integration reference. It complements, not replaces, the granular stories.

---

### Task 1: StoryPicker — render footer buttons only when their handler is wired

**Files:**
- Modify: `frontend/src/components/StoryPicker.tsx:144-157` (the `<ModalFooter>` block) + the stale top-of-file comment (lines 1-4) + the `onImportDocx` prop JSDoc (line 26)
- Modify: `frontend/src/components/StoryPicker.stories.tsx:80-88` (the `Demo` wrapper's `<StoryPicker>`)
- Test: `frontend/tests/components/StoryPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe('StoryPicker (F30)', ...)` block in `frontend/tests/components/StoryPicker.test.tsx` (e.g. right after the existing `'clicking Import .docx fires onImportDocx'` test at line 247):

```tsx
it('hides the New story button when onCreateStory is not provided', async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
  renderPicker(
    <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
  );
  await waitFor(() => {
    expect(screen.getByTestId('story-picker-count')).toBeInTheDocument();
  });
  expect(screen.queryByTestId('story-picker-new')).toBeNull();
});

it('hides the Import .docx button when onImportDocx is not provided', async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
  renderPicker(
    <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
  );
  await waitFor(() => {
    expect(screen.getByTestId('story-picker-count')).toBeInTheDocument();
  });
  expect(screen.queryByTestId('story-picker-import')).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/StoryPicker.test.tsx`
Expected: the two new tests FAIL — `story-picker-new` / `story-picker-import` are currently always rendered, so `queryByTestId(...)` returns the element instead of `null`.

- [ ] **Step 3: Make the footer buttons conditional**

In `frontend/src/components/StoryPicker.tsx`, replace the `<ModalFooter>` block (currently lines 144-157):

```tsx
      <ModalFooter
        leading={
          <span data-testid="story-picker-count">
            {count} {count === 1 ? 'story' : 'stories'} in vault
          </span>
        }
      >
        <Button variant="ghost" onClick={onImportDocx} data-testid="story-picker-import">
          Import .docx
        </Button>
        <Button variant="primary" onClick={onCreateStory} data-testid="story-picker-new">
          New story
        </Button>
      </ModalFooter>
```

with:

```tsx
      <ModalFooter
        leading={
          <span data-testid="story-picker-count">
            {count} {count === 1 ? 'story' : 'stories'} in vault
          </span>
        }
      >
        {onImportDocx ? (
          <Button variant="ghost" onClick={onImportDocx} data-testid="story-picker-import">
            Import .docx
          </Button>
        ) : null}
        {onCreateStory ? (
          <Button variant="primary" onClick={onCreateStory} data-testid="story-picker-new">
            New story
          </Button>
        ) : null}
      </ModalFooter>
```

Also update two now-stale comments in the same file (do not reference this task/issue in either):
- Top-of-file comment (lines 1-4): change "Footer shows "N stories in vault" + Import .docx button + primary New story button." to "Footer shows the vault count plus the New story / Import .docx buttons when their handlers are wired."
- The `onImportDocx` prop JSDoc (line 26): change "TODO(future): no backend import endpoint yet. Render the button anyway." to "TODO(future): no backend import endpoint yet; the button stays hidden until an onImportDocx handler is wired." (it currently contradicts the new hide-when-unwired behavior).

- [ ] **Step 4: Keep both buttons visible in Storybook**

In `frontend/src/components/StoryPicker.stories.tsx`, the `Demo` wrapper passes no create/import handlers, so both buttons would now vanish in every story. Add noop handlers to the `<StoryPicker>` inside `Demo` (lines 80-88):

```tsx
      <StoryPicker
        open={embedded ? true : open}
        onClose={() => setOpen(false)}
        activeStoryId={activeStoryId}
        onSelectStory={() => {
          // demo no-op
        }}
        onCreateStory={() => {
          // demo no-op
        }}
        onImportDocx={() => {
          // demo no-op
        }}
        embedded={embedded}
      />
```

- [ ] **Step 5: Run the StoryPicker tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/StoryPicker.test.tsx`
Expected: PASS — all tests, including the two new hidden-when-unwired tests and the existing `'clicking New story fires onCreateStory'` / `'clicking Import .docx fires onImportDocx'` tests (which pass the handlers, so the buttons still render).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StoryPicker.tsx frontend/src/components/StoryPicker.stories.tsx frontend/tests/components/StoryPicker.test.tsx
git commit -m "[story-editor-b6w] StoryPicker: render footer buttons only when wired

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: StoryModal — `onCreated(story)` callback after successful create

**Files:**
- Modify: `frontend/src/components/StoryModal.tsx:3-10` (shared import — add `Story`), `:35-40` (props), `:90` (signature), `:150-181` (submit handler + catch)
- Test: `frontend/tests/components/StoryModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('StoryModal (F6)', ...)` block in `frontend/tests/components/StoryModal.test.tsx` (e.g. after the existing `'successful submit closes the modal'` test). It mirrors the existing create test's POST mock shape:

```tsx
it('create: fires onCreated with the created story', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(201, {
      story: {
        id: 'new-1',
        title: 'Dune',
        genre: null,
        synopsis: null,
        worldNotes: null,
        targetWords: null,
        includePreviousChaptersInPrompt: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  const onCreated = vi.fn();
  const user = userEvent.setup();
  renderModal(<StoryModal mode="create" open onClose={onClose} onCreated={onCreated} />);

  await user.type(screen.getByLabelText(/title/i), 'Dune');
  await user.click(screen.getByRole('button', { name: /create story/i }));

  await waitFor(() => {
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-1' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/StoryModal.test.tsx -t "fires onCreated"`
Expected: FAIL — `onCreated` is not a prop yet (TS also flags it); it is never called.

- [ ] **Step 3: Add the `Story` import**

In `frontend/src/components/StoryModal.tsx`, add `type Story` to the existing `story-editor-shared` import (lines 3-10):

```tsx
import {
  STORY_GENRE_MAX,
  STORY_SYNOPSIS_MAX,
  STORY_TITLE_MAX,
  STORY_WORLD_NOTES_MAX,
  type Story,
  type StoryCreateInput,
  type StoryUpdateInput,
} from 'story-editor-shared';
```

- [ ] **Step 4: Add the `onCreated` prop**

In the `StoryModalProps` interface (lines 35-40):

```tsx
export interface StoryModalProps {
  mode: StoryModalMode;
  open: boolean;
  onClose: () => void;
  initial?: StoryModalInitial;
  /** Create mode only: fired with the new story after a successful create, before onClose. */
  onCreated?: (story: Story) => void;
}
```

And destructure it in the component signature (line 90):

```tsx
export function StoryModal({ mode, open, onClose, initial, onCreated }: StoryModalProps): JSX.Element | null {
```

- [ ] **Step 5: Call `onCreated` in the create branch**

In `handleSubmit`, replace the create branch + shared close (current lines 150-178):

```tsx
    try {
      if (mode === 'create') {
        const payload: StoryCreateInput = {
          title: trimmedTitle,
          genre: nullable(genre),
          synopsis: nullable(synopsis),
          worldNotes: nullable(worldNotes),
          includePreviousChaptersInPrompt,
        };
        await createMutation.mutateAsync(payload);
      } else {
        if (!initial?.id) {
          setFormError('Cannot save: missing story id.');
          return;
        }
        const diff = diffForPatch(initial, {
          title,
          genre,
          synopsis,
          worldNotes,
          includePreviousChaptersInPrompt,
        });
        if (Object.keys(diff).length === 0) {
          onClose();
          return;
        }
        await updateMutation.mutateAsync({ id: initial.id, input: diff });
      }
      onClose();
    } catch (err) {
      setFormError(mapError(err));
    }
```

with (create branch captures the result, closes, then notifies):

```tsx
    try {
      if (mode === 'create') {
        const payload: StoryCreateInput = {
          title: trimmedTitle,
          genre: nullable(genre),
          synopsis: nullable(synopsis),
          worldNotes: nullable(worldNotes),
          includePreviousChaptersInPrompt,
        };
        const created = await createMutation.mutateAsync(payload);
        onClose();
        onCreated?.(created);
        return;
      }
      if (!initial?.id) {
        setFormError('Cannot save: missing story id.');
        return;
      }
      const diff = diffForPatch(initial, {
        title,
        genre,
        synopsis,
        worldNotes,
        includePreviousChaptersInPrompt,
      });
      if (Object.keys(diff).length === 0) {
        onClose();
        return;
      }
      await updateMutation.mutateAsync({ id: initial.id, input: diff });
      onClose();
    } catch (err) {
      setFormError(mapError(err));
    }
```

- [ ] **Step 6: Run the StoryModal tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/StoryModal.test.tsx`
Expected: PASS — the new `onCreated` test plus all existing create/edit/error/close tests (`onClose` is still called; `onCreated` is simply `undefined` when not provided).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StoryModal.tsx frontend/tests/components/StoryModal.test.tsx
git commit -m "[story-editor-b6w] StoryModal: add onCreated callback for create flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: New `StoryBrowser` component (picker + create modal + navigation)

**Files:**
- Create: `frontend/src/components/StoryBrowser.tsx`
- Create: `frontend/src/components/StoryBrowser.stories.tsx`
- Test: `frontend/tests/components/StoryBrowser.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/StoryBrowser.test.tsx`:

```tsx
// StoryBrowser — picker + create modal + navigation wiring shared by the
// dashboard landing surface and the in-editor Your-Stories modal.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryBrowser } from '@/components/StoryBrowser';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function LocationProbe(): null {
  const loc = useLocation();
  (window as unknown as { __probeLocation: string }).__probeLocation = loc.pathname;
  return null;
}

function probeLocation(): string {
  return (window as unknown as { __probeLocation: string }).__probeLocation;
}

function makeStory(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    genre: 'Fantasy',
    synopsis: null,
    worldNotes: null,
    targetWords: 80_000,
    chapterCount: 1,
    totalWordCount: 100,
    includePreviousChaptersInPrompt: true,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
  };
}

function renderBrowser(opts: { embedded?: boolean; activeStoryId?: string | null } = {}): void {
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route
            path="/start"
            element={
              <>
                <StoryBrowser
                  open
                  onClose={() => undefined}
                  activeStoryId={opts.activeStoryId ?? null}
                  embedded={opts.embedded}
                />
                <LocationProbe />
              </>
            }
          />
          <Route path="/stories/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StoryBrowser', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('navigates to /stories/:id when a story row is selected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [makeStory('abc', 'Dune')] }));
    renderBrowser();

    await userEvent.setup().click(await screen.findByTestId('story-picker-row-abc'));
    await waitFor(() => {
      expect(probeLocation()).toBe('/stories/abc');
    });
  });

  it('opens the create StoryModal when New story is clicked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderBrowser();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByTestId('story-picker-new'));
    expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
  });

  it('navigates to the new story after a successful create', async () => {
    // Route by URL+method: useCreateStoryMutation.onSuccess invalidates the
    // stories query, and the picker is still mounted (modal open over it), so a
    // 3rd GET /stories fires after the POST. A positional mockResolvedValueOnce
    // chain would leave that refetch resolving undefined (schema.parse throws).
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/stories') && method === 'POST') {
        return jsonResponse(201, {
          story: {
            id: 'created-9',
            title: 'New Tale',
            genre: null,
            synopsis: null,
            worldNotes: null,
            targetWords: null,
            includePreviousChaptersInPrompt: true,
            createdAt: '2026-04-24T00:00:00.000Z',
            updatedAt: '2026-04-24T00:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/api/stories')) {
        return jsonResponse(200, { stories: [] });
      }
      return jsonResponse(200, {});
    });
    renderBrowser();

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('story-picker-new'));
    await user.type(screen.getByLabelText(/title/i), 'New Tale');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    await waitFor(() => {
      expect(probeLocation()).toBe('/stories/created-9');
    });
  });

  it('does not render an Import .docx button (no import handler wired)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderBrowser();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-picker-import')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/StoryBrowser.test.tsx`
Expected: FAIL — `@/components/StoryBrowser` does not exist yet (import/resolve error).

- [ ] **Step 3: Create the StoryBrowser component**

Create `frontend/src/components/StoryBrowser.tsx`:

```tsx
// Shared Your-Stories surface: the StoryPicker plus the create StoryModal and
// the select/create → navigate wiring. Rendered embedded on the dashboard
// landing surface and as a dismissible modal in the editor. Keeping the create
// flow here (not per-page) is why both surfaces stay in sync.
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoryModal } from '@/components/StoryModal';
import { StoryPicker } from '@/components/StoryPicker';

export interface StoryBrowserProps {
  open: boolean;
  onClose: () => void;
  activeStoryId: string | null;
  embedded?: boolean;
}

export function StoryBrowser({
  open,
  onClose,
  activeStoryId,
  embedded = false,
}: StoryBrowserProps): JSX.Element {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <StoryPicker
        open={open}
        onClose={onClose}
        activeStoryId={activeStoryId}
        embedded={embedded}
        onSelectStory={(id) => {
          navigate(`/stories/${id}`);
        }}
        onCreateStory={() => {
          onClose();
          setCreateOpen(true);
        }}
      />
      <StoryModal
        mode="create"
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={(created) => {
          navigate(`/stories/${created.id}`);
        }}
      />
    </>
  );
}
```

(`StoryPicker.handleSelect` already calls `onClose()` after `onSelectStory`, so `onSelectStory` only navigates. `onImportDocx` is intentionally not wired → Task 1 hides the Import button.)

- [ ] **Step 4: Run the StoryBrowser tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/StoryBrowser.test.tsx`
Expected: PASS — all four tests.

- [ ] **Step 5: Add the composed Storybook story**

Create `frontend/src/components/StoryBrowser.stories.tsx` (mirrors `StoryPicker.stories.tsx`'s `Demo`, wrapped in `MemoryRouter` and seeding the stories query cache):

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { StoryListItem } from 'story-editor-shared';
import { storiesQueryKey } from '@/hooks/useStories';
import { StoryBrowser } from './StoryBrowser';

const SAMPLE_STORIES: StoryListItem[] = [
  {
    id: 's1',
    title: 'The Cartographer',
    genre: 'Literary fantasy',
    synopsis: null,
    worldNotes: null,
    targetWords: 90_000,
    includePreviousChaptersInPrompt: true,
    chapterCount: 12,
    totalWordCount: 38_412,
    createdAt: '2026-02-12T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    id: 's2',
    title: 'Foundry',
    genre: 'Hard sci-fi',
    synopsis: null,
    worldNotes: null,
    targetWords: 120_000,
    includePreviousChaptersInPrompt: true,
    chapterCount: 4,
    totalWordCount: 11_220,
    createdAt: '2026-03-04T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
  },
];

function makeClient(stories: StoryListItem[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(storiesQueryKey, stories);
  return client;
}

interface DemoProps {
  stories: StoryListItem[];
  embedded?: boolean;
  activeStoryId?: string | null;
}

function Demo({ stories, embedded = false, activeStoryId = null }: DemoProps) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={makeClient(stories)}>
        <StoryBrowser
          open
          onClose={() => {
            // demo no-op
          }}
          activeStoryId={activeStoryId}
          embedded={embedded}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const meta = {
  title: 'Components/StoryBrowser',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Dashboard landing surface — embedded (no backdrop / Close). Click "New story"
 * to open the create modal in place.
 */
export const Embedded: Story = {
  args: { stories: SAMPLE_STORIES, embedded: true, activeStoryId: 's2' },
};

/**
 * In-editor modal — dismissible picker. Click "New story" to open the create
 * modal over it.
 */
export const Modal: Story = {
  args: { stories: SAMPLE_STORIES, activeStoryId: 's1' },
};
```

Run: `cd frontend && npm run typecheck`
Expected: clean — the `.stories.tsx` is under `src/` and is typechecked by `tsc -b`; a malformed story fails here.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StoryBrowser.tsx frontend/src/components/StoryBrowser.stories.tsx frontend/tests/components/StoryBrowser.test.tsx
git commit -m "[story-editor-b6w] add StoryBrowser: picker + create modal + navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: DashboardPage — use StoryBrowser

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx` (whole body)
- Test: `frontend/tests/pages/dashboard.test.tsx` (no change expected — verify still green)

- [ ] **Step 1: Replace the page body with StoryBrowser**

Replace the entire contents of `frontend/src/pages/DashboardPage.tsx` with:

```tsx
// Dashboard landing surface: the Your-Stories browser rendered embedded (no
// backdrop, no Close — a permanent landing surface). All picker/create/navigate
// behavior lives in StoryBrowser.
import type { JSX } from 'react';
import { StoryBrowser } from '@/components/StoryBrowser';

export function DashboardPage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-8">
      <StoryBrowser embedded open onClose={() => undefined} activeStoryId={null} />
    </main>
  );
}
```

(This removes the page's `useState` / `useNavigate` / `StoryModal` / `StoryPicker` imports — they now live in `StoryBrowser`.)

- [ ] **Step 2: Run the dashboard tests to verify they still pass**

Run: `cd frontend && npx vitest run tests/pages/dashboard.test.tsx`
Expected: PASS — every existing test (renders embedded picker, rows, empty state, row→navigate, "New story" opens the modal, Escape inert). The DOM/testids are unchanged because `StoryBrowser` renders the same `StoryPicker` (embedded) + `StoryModal`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "[story-editor-b6w] DashboardPage: render via StoryBrowser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: EditorPage — use StoryBrowser (fixes the bug)

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx` — swap `StoryPicker` import → `StoryBrowser`; replace the `<StoryPicker>` element; remove the now-redundant `handleStoryPickerSelect`
- Test: `frontend/tests/pages/editor.test.tsx`

- [ ] **Step 1: Add the `/stories` list handler to the shared mock, then write the failing test**

First fix the shared `mockImpl` helper in `frontend/tests/pages/editor.test.tsx`: it currently handles `/stories/abc123` and its sub-resources but has no bare-list handler, so opening the picker's `useStoriesQuery` (GET `/stories`) falls through to `Promise.reject(new Error('Unexpected fetch: …/stories'))` — which `createQueryClient` retries once (~1s backoff), firing a state update after the test ends (act() noise / flakiness). Add this branch inside `mockImpl` (anywhere among the existing `if` checks — it is mutually exclusive with `/stories/abc123`, which does not end with `/stories`):

```tsx
    if (url.endsWith('/stories')) {
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    }
```

Then add this test inside the `describe('EditorPage (F51 — AppShell shell)', ...)` block, mirroring the existing tests' mock setup (`fetchMock.mockImplementation(mockImpl(...))` + `renderEditor()`):

```tsx
it('clicking "New story" in the editor picker opens the create StoryModal', async () => {
  fetchMock.mockImplementation(
    mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() }))),
  );
  const user = userEvent.setup();
  renderEditor();

  await waitFor(() => {
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  // open Your Stories from the sidebar header (button data-testid="sidebar-story-picker")
  await user.click(screen.getByTestId('sidebar-story-picker'));
  await user.click(await screen.findByTestId('story-picker-new'));

  expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
});
```

(`sidebar-story-picker` is the confirmed `data-testid` of the Sidebar trigger that calls `onOpenStoryPicker` — `Sidebar.tsx:127`.) Navigation-on-create is already covered by `StoryBrowser.test` (Task 3); this test only proves the editor mounts `StoryBrowser` and "New story" opens the create modal.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/pages/editor.test.tsx -t "New story"`
Expected: FAIL — the editor still renders the bare `<StoryPicker>` (no create wiring), and after Task 1 the New story button is hidden there, so the click finds nothing / the modal never opens.

- [ ] **Step 3: Swap the import**

In `frontend/src/pages/EditorPage.tsx`, change the `StoryPicker` import (line 55) to:

```tsx
import { StoryBrowser } from '@/components/StoryBrowser';
```

- [ ] **Step 4: Replace the `<StoryPicker>` element with `<StoryBrowser>`**

Replace the `<StoryPicker>` element (current lines 686-693):

```tsx
      <StoryPicker
        open={storyPickerOpen}
        onClose={() => {
          setStoryPickerOpen(false);
        }}
        activeStoryId={story.id}
        onSelectStory={handleStoryPickerSelect}
      />
```

with:

```tsx
      <StoryBrowser
        open={storyPickerOpen}
        onClose={() => {
          setStoryPickerOpen(false);
        }}
        activeStoryId={story.id}
      />
```

- [ ] **Step 5: Remove the redundant `handleStoryPickerSelect`**

Delete the `handleStoryPickerSelect` callback (current lines 175-181):

```tsx
  const handleStoryPickerSelect = useCallback(
    (id: string): void => {
      setStoryPickerOpen(false);
      navigate(`/stories/${id}`);
    },
    [navigate],
  );
```

Navigation on select now lives in `StoryBrowser`. Keep `storyPickerOpen` / `setStoryPickerOpen` (still used by the topbar `onOpenStoriesList` at line 483 and the sidebar `onOpenStoryPicker` at line 505) and keep `navigate` (still used elsewhere, e.g. the login redirect at line 111). If removing `handleStoryPickerSelect` leaves `useCallback` unused, remove it from the React import (biome/tsc will flag it — verify in Step 6).

- [ ] **Step 6: Run the editor tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/editor.test.tsx`
Expected: PASS — the new "New story opens the create StoryModal" test plus all existing editor-shell tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/tests/pages/editor.test.tsx
git commit -m "[story-editor-b6w] EditorPage: render Your Stories via StoryBrowser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full-suite verify

- [ ] **Step 1: Run the issue's verify line**

Run: `cd frontend && npm run typecheck && npm test && npm run lint:design`
Expected: typecheck clean, full vitest suite green, "No design-token drift". This is `story-editor-b6w`'s `verify:` line; `/bd-close-reviewed` runs it again at close.

---

## Self-Review

**Spec coverage:**
- "New story dead in editor" → Tasks 3 + 5 (`StoryBrowser` wires create; `EditorPage` renders it).
- "Navigate to new story on create, both surfaces" → Task 2 (`onCreated`) + Task 3 (`StoryBrowser` navigates) + Tasks 4/5 (both pages render `StoryBrowser`).
- "Import .docx looks broken everywhere" → Task 1 (hide footer button when handler absent) + Task 3 (`StoryBrowser` never wires it).
- "Consolidate the duplication" → Task 3 (single `StoryBrowser`) + Tasks 4/5 (both pages delegate to it); redundant `handleStoryPickerSelect` removed in Task 5.
- Storybook still demonstrates the footer → Task 1 Step 4. Granular `StoryPicker` / `StoryModal` stories kept; composed `StoryBrowser` story added → Task 3 Step 5 (rationale in Design notes).

**Type consistency:** `onCreated?: (story: Story) => void` uses `Story` from `story-editor-shared`; `useCreateStoryMutation` returns `Story`, so `createMutation.mutateAsync(...)` resolves to `Story`. `StoryBrowser` passes `onCreated={(created) => navigate(\`/stories/${created.id}\`)}` — `created.id` is `string`. `StoryBrowserProps.activeStoryId` is `string | null`, matching `StoryPickerProps.activeStoryId` and `story.id` (string) / dashboard `null`.

**Placeholder scan:** Task 5 Step 1 defers the exact render-helper name / sidebar testid to the implementer (a real lookup in the test file + `Sidebar.tsx`), not a code placeholder; the surrounding test code is complete. All other code steps show full code.

**Behavior-change callout:** Task 4 changes existing dashboard behavior (create now navigates to the new story). The existing dashboard `'clicking "New story" opens the StoryModal'` test does not submit, so it is unaffected; the navigate-on-create behavior is proven in `StoryBrowser.test` (Task 3). **Conscious acceptance:** there is intentionally no dashboard-specific navigate-on-create test — both surfaces render the identical `StoryBrowser`, so duplicating the navigation assertion per-page would test the same code twice. If a regression later wants per-surface proof, add it to `dashboard.test.tsx` then.
