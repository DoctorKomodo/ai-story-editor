# Story Deletion (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**bd issue:** `story-editor-0wz` · **Origin:** surfaced by the import-safety work (PR #153) — restore-as-duplicate ("keep both") creates copies the user cannot remove.

**Goal:** Users can delete a story from the library UI. Guardrail shape (user-approved 2026-07-04): **confirm dialog + 5s soft-delete/undo toast**. Ships as its own branch/PR after #153 merges.

**Current-state facts (verified 2026-07-04):**
- Backend is complete and needs **no change**: `DELETE /api/stories/:id` (`backend/src/routes/stories.routes.ts:130`, `ownStory` middleware → `storyRepo.remove`, schema-level cascade deletes the full subtree). Hard delete — permanent.
- `frontend/src/hooks/useStories.ts`: `useStoriesQuery`, `useStoryQuery`, `useCreateStoryMutation`, `useUpdateStoryMutation` — **no delete mutation**.
- Library UI: `StoryBrowser` (route shell) → `StoryPicker` (modal, story rows, `onSelectStory`) — **no delete affordance**. `StoryPicker.stories.tsx` exists (Storybook is the design surface).
- Reusable pattern: `frontend/src/hooks/useSoftDelete.ts` (generic: hide immediately → 5s timer → real DELETE; `undo(id)` cancels; unmount cancels all). Consumer reference: `ChatSceneTab.tsx` (delete icon per row at :257, undo toast at :409).
- Shared `Modal` primitive exists (used by `StoryModal` with `labelledBy`, `size`, `testId`).
- Known adjacent issue: `story-editor-b4z` (picker rename/delete icons hidden on touch) — mirror the existing icon-visibility idiom anyway; fixing touch visibility is b4z's scope, not this plan's.

## Global Constraints

- Frontend-only. No backend, shared-schema, or migration changes.
- **The currently-open story case**: `EditorPage` mounts the picker; deleting the story the editor is showing must not dead-end on "Could not load story" (the [story-editor-f1t] failure class). When the *confirmed* delete targets the story the app is currently editing, navigate to the library (or the empty state) no later than when the real DELETE fires. An undo within the 5s window must leave the user able to reopen the story unharmed.
- Design tokens only (`lint:design` gates CI); a11y: the delete control and confirm dialog need accessible names/roles; Escape closes the dialog per the keyboard contract.
- Frontend suite (142 files / 1145 tests) stays fully green; jsdom only.
- Commit format `[story-editor-0wz] …`.
- Verify (whole plan): `npm --prefix frontend run typecheck && npx vitest run --root frontend && npm --prefix frontend run lint:design`

---

### Task 1: `useDeleteStoryMutation` (`frontend/src/hooks/useStories.ts`)

- [ ] `useDeleteStoryMutation(): UseMutationResult<void, Error, string>` — `DELETE /api/stories/${id}` via the existing api helper; on success invalidate the stories list (and remove/invalidate the per-story query for that id).
- [ ] Hook tests alongside the existing `useStories` coverage: happy path invalidates; error path surfaces (no silent catch).

**Verify:** `npx vitest run --root frontend tests/hooks/useStories.test.tsx` (adjust to actual path) + typecheck.

### Task 2: Delete affordance in the story picker — confirm dialog + soft-delete/undo

- [ ] `StoryPicker`: per-row delete icon button (accessible name `Delete "<title>"`), following the visibility idiom `ChatSceneTab` uses for its row icons.
- [ ] Clicking it opens a confirm dialog (shared `Modal` primitive): title names the story; body states it permanently removes the story **and all its chapters, characters, outline, and chats**; buttons Cancel / Delete (destructive styling per tokens). Escape cancels.
- [ ] On confirm: `useSoftDelete` (5s) — row hides immediately, undo toast appears (same shape as `ChatSceneTab`'s), timer fires the real mutation. Undo restores the row and fires nothing.
- [ ] Currently-open story: if the confirmed id is the story the editor has open, leave the editor for the library/empty state (whatever `EditorPage`'s existing no-story path is) — and an undo must restore access unharmed. Wire the picker→page interaction through the existing prop/store seams (`onSelectStory`-style callback or the relevant store), not a new global.
- [ ] Update `StoryPicker.stories.tsx` with the delete/confirm states (Storybook is the design surface — new UI states get stories).
- [ ] Component tests: confirm dialog appears with the right copy; cancel/Escape fires nothing; confirm hides row + shows undo; undo restores and no DELETE fires; timer expiry fires exactly one DELETE; deleting the open story exits to the library; a11y — controls queried by role+name.

**Verify:** `npx vitest run --root frontend tests/components/StoryPicker.test.tsx` (adjust to actual path) — plus the whole-plan verify.

---

## Explicit non-goals

- No backend changes (route, repo, cascade behavior all exist and are tested).
- No trash/archive semantics — delete is permanent after the undo window, matching the chat-session precedent; the confirm copy says so.
- No fix for touch-hidden row icons (`story-editor-b4z` owns that).
- No bulk delete / multi-select.
