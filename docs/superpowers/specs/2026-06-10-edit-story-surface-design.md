# Edit-story surface — design (`story-editor-aay`)

**Date:** 2026-06-10
**Issue:** story-editor-aay — Design + add edit-story surface (no UI mount for existing-story settings)

## Problem

`StoryModal` already supports `mode='edit'` (`frontend/src/components/StoryModal.tsx`), its
`diffForPatch` builds a `StoryUpdateInput`, and the backend `PATCH /api/stories/:id` accepts all
five editable fields. But the running app only ever mounts `StoryModal` in `mode='create'` (via
`StoryBrowser`). A user has no way to change an existing story's `title` / `genre` / `synopsis` /
`worldNotes` / `includePreviousChaptersInPrompt` short of hitting the API through devtools.

Surfaced in PR #118 review: the `v6x` manual-test step "toggle `includePreviousChaptersInPrompt`
off via StoryModal" is unreachable for an existing story.

## Decision

Add an **edit-story `IconButton` in the editor sidebar header**, right of the story-switcher button.
It is visible whenever a story is open and opens `StoryModal mode='edit'` seeded with the active
story. This mirrors the contextual Character-edit precedent (`handleEditCharacter` → `CharacterSheet`
mode='edit', page-root mount in `EditorPage`) — the precedent is the *mount pattern*, not a specific
glyph.

**Glyph — pencil, not a gear.** `TopBar.tsx` already renders a gear labelled "Settings" (app/user
settings: models/account) on the same screen. A second gear with a different scope would be
ambiguous, so this affordance uses a pencil/edit glyph (`aria-label`/`ariaLabel` = "Edit story").
A `PencilIcon` already exists locally in `SessionPicker.tsx`; following the codebase's per-file
local-icon convention (`Sidebar` already defines local `BookIcon`/`ChevronDownIcon`), define a local
`PencilIcon` in `Sidebar.tsx` rather than extracting a shared icon — icon centralization is out of
scope here.

Rejected alternatives:
- **Row-hover pencil in the picker** — hover affordances are touch-hostile (cf. open bug
  story-editor-b4z) and add per-row complexity; editing non-active stories is not a requirement.
- **Dedicated "Story" settings tab** in the sidebar — a persistent tab for a rarely-used action is
  overkill (YAGNI).

## Components & state

### `Sidebar` (`frontend/src/components/Sidebar.tsx`)
- Add optional prop `onEditStory?: () => void`.
- When provided, render a pencil `IconButton` in the existing `sidebar-header` flex row, to the
  right of the switcher button. Use the primitive's prop names: `ariaLabel="Edit story"`,
  `testId="sidebar-story-settings"` (the `IconButton` primitive takes `ariaLabel` /`testId`, **not**
  the raw `aria-label`/`data-testid` HTML attributes — passing the HTML form would leave the
  required `ariaLabel` prop unset). Child is the local `PencilIcon`.
- Header layout changes from one full-width button to `[switcher (flex-1)] [pencil]`. The switcher
  keeps `min-w-0 flex-1`; the pencil button is `flex-shrink-0`.
- When `onEditStory` is absent, the pencil button is not rendered (keeps existing callers and stories
  unaffected).

### `EditorPage` (`frontend/src/pages/EditorPage.tsx`)
- Add `StoryModal` to the imports (the file currently imports only `StoryBrowser`). Add `useMemo`
  to the React import if not already present.
- Add `const [editStoryOpen, setEditStoryOpen] = useState(false)`.
- Pass `onEditStory={() => setEditStoryOpen(true)}` to `Sidebar`.
- **Memoize the seeded `initial` (required — prevents data loss).** `StoryModal`'s reset effect
  depends on `[open, initial]` (`StoryModal.tsx:124–133`) and re-seeds every field whenever the
  `initial` reference changes. Create-mode passes no `initial` (stable `undefined`), so it never
  re-fires — but the edit mount must pass an object, and a fresh object literal on every render
  would re-fire the reset effect on each EditorPage re-render (autosave ticks, balance polling,
  completion streaming all re-render while the modal is open), discarding whatever the user has
  typed. Memoize at the call site:

  ```ts
  const editStoryInitial = useMemo(
    () => ({
      id: story.id,
      title: story.title,
      genre: story.genre,
      synopsis: story.synopsis,
      worldNotes: story.worldNotes,
      includePreviousChaptersInPrompt: story.includePreviousChaptersInPrompt,
    }),
    [story],
  );
  ```

  Keying on `story` is safe: `story` is the TanStack Query cache reference (stable across re-renders
  until the data changes), and the post-save `setQueryData` reseed lands after `onClose` has set
  `open=false`, so the reset effect early-returns.
- Mount a second `StoryModal` at page root (alongside the existing `StoryBrowser` mount),
  `mode='edit'`, `open={editStoryOpen}`, `onClose={() => setEditStoryOpen(false)}`,
  `initial={editStoryInitial}`. No `onCreated`.
- Kept out of `StoryBrowser` deliberately: editing the active story is not part of the
  pick/create/navigate flow — no navigation, acts on the already-open story. `StoryBrowser` stays
  the "Your Stories" picker + create surface.

## Data flow & cache fix

- On submit, `StoryModal`'s existing edit path builds the diff and calls
  `useUpdateStoryMutation`. No change to `StoryModal` itself.
- **Cache fix (required):** `useUpdateStoryMutation.onSuccess` currently invalidates only
  `storiesQueryKey` (the list). The edit button edits the *active* story, whose body is served from
  `storyQueryKey(id)` via `useStoryQuery` — that cache would go stale (TopBar/Sidebar title wouldn't
  refresh; re-opening the modal would seed old values). Fix: in `onSuccess`, additionally write the
  returned full `Story` into the single-story cache:
  `qc.setQueryData(storyQueryKey(story.id), story)`. The mutation already returns the complete
  updated story, so this refreshes the open editor with no refetch flicker. Uses the existing
  `storyQueryKey` export.

## Error handling

Unchanged. `StoryModal` already surfaces mutation errors inline via `formError` / `role="alert"`,
and a no-op save (empty diff) closes without issuing a request.

## Testing

- `Sidebar.test.tsx`: pencil renders only when `onEditStory` is passed; clicking it fires the handler.
- `editor.test.tsx` (or a focused EditorPage test): pencil click opens the modal seeded with the
  current story's values; saving issues the PATCH and the cache-set refreshes the displayed title.
  Exercises the `includePreviousChaptersInPrompt` toggle-off path that `v6x` could not reach.
- **Regression for the memoization fix:** with the edit modal open, type into a field, then force an
  EditorPage re-render that does *not* change `story` (e.g. an unrelated state/prop tick), and
  assert the typed value survives. This is the data-loss bug note 1 guards against; without the
  `useMemo` the reset effect would wipe the field.
- `useStories.test.tsx`: `useUpdateStoryMutation` writes `storyQueryKey(id)` data on success (in
  addition to invalidating the list).

## Out of scope (YAGNI)

- Editing non-active stories from the picker.
- A `targetWords` field (not present in `StoryModal`).
- The row-hover-pencil and settings-tab entry-point alternatives.

## Verify

`npm --prefix frontend run typecheck && npm --prefix frontend run test -- StoryModal Sidebar editor useStories`
