# Drafts Step 7 — Sidebar Draft Tree + New-Draft Dialog (Design)

**bd issue:** `story-editor-9wk.7` (parent epic `story-editor-9wk`; absorbs retired `story-editor-9wk.8`)
**Parent spec:** `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §7 (behavior), §8 (frontend) — binding except where a decision below refines it.
**Predecessor:** step 6 (`story-editor-9wk.6`, closed) made the editor draft-native: `useDraftsQuery`/`useDraftQuery`/`useUpdateDraftMutation`, the `selectedDraft` store, draft-keyed IndexedDB recovery, draft-scoped chats/summaries.

## 1. Scope

Frontend-only. This step ships the first user-visible drafts UI:

1. **Sidebar draft tree** — chapters with `draftCount > 1` expand in `ChapterList` to show draft child rows (active dot, label, word count) with hover actions: ★ set active, ✎ rename (inline), 🗑 delete (never on the active draft). Clicking a draft row views it in the editor.
2. **New-draft creation** — a "＋ new draft" hover affordance on single-draft chapters and a "＋ New draft…" child row on expanded multi-draft chapters, both opening a dialog: **fork current draft** (default) vs **start blank**, optional name.
3. **Editor sub-row label** (absorbed 9wk.8) — `Paper.tsx`'s `draftLabel` slot binds to the viewed draft's display label; the hardcoded `'Draft 1'` fallback dies.
4. **Flush-race fix** (Task-3 forward note recorded on the bd issue) — on a draft→draft switch with a cached target, `useAutosave`'s resetKey flush for the *previous* draft currently reads the *new* draft's `updatedAt` from the shared `serverUpdatedAtRef`, guaranteeing a 409 and a spurious conflict banner. Reachable for the first time once this task ships draft switching, so it is fixed here.

**Non-goals:** no backend or schema changes (every endpoint already exists); no draft compare/merge; no touch-hover redesign (tracked as `story-editor-b4z`'s family); no `useAutosave` changes (D2 fixes the caller); no drag-to-reorder of drafts.

## 2. Existing surface this builds on (verified against code)

- **Endpoints (all shipped):** `GET/POST /api/chapters/:chapterId/drafts` (list, create `{mode: 'fork'|'blank', label?}` → 201 `{draft}` with P2002 orderIndex retry), `PUT /api/chapters/:chapterId/active-draft` `{draftId}` → 204, `GET/PATCH/DELETE /api/drafts/:draftId`. PATCH takes `{label?: string|null, bodyJson?, expectedUpdatedAt?}` — `label: null` clears back to positional. DELETE returns 409 `cannot_delete_active_draft` / `cannot_delete_last_draft` (`error-handler.ts:93,98`).
- **Wire shapes:** `DraftMeta = {id, chapterId, label, wordCount, orderIndex, isActive, hasSummary, summaryIsStale, createdAt, updatedAt}`; `ChapterMeta.draftCount` exists. Draft `orderIndex` is **gap-free** (two-phase reindex on delete, `draft.repo.ts`) — positional labels can derive from `orderIndex` directly.
- **Hooks:** `useDraftsQuery(chapterId)` (`['chapter', id, 'drafts']`), `useDraftQuery(draftId)` (`['draft', id, 'detail']`), `useUpdateDraftMutation` (rename rides this — it already invalidates drafts list + chapters list and `setQueryData`s the record), `isDraftConflictError`, `activeDraftIdOf`.
- **Primitives (design/primitives.tsx):** `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter`, `Button`, `Field`, `Input`, `IconButton`, `InlineConfirm` + `useInlineConfirm`, `useAutofocus`. `formatWordCountCompact` in lib.
- **EditorPage wiring:** `viewedDraftId = selectedDraftId ?? activeDraftIdOf(draftsQuery.data)`; `useAutosave({resetKey: viewedDraftId, …})`; `serverUpdatedAtRef` (the race's subject); `useChapterDraft`/`useUnloadFlush` already draft-keyed.

## 3. Decisions

### D1. `selectedDraft` store becomes a chapter-scoped pair

Current shape (`store/selectedDraft.ts`): bare `selectedDraftId: string | null`, reset by an EditorPage effect on every `activeChapterId` change. That effect **races** the new cross-chapter draft click: clicking a draft row under a *different* chapter must set both the active chapter and the selection, and the reset effect (running after the render for the new chapter) would wipe the just-set selection.

New shape:

```ts
interface SelectedDraftState {
  /** null = follow the active draft of whatever chapter is open. */
  selected: { chapterId: string; draftId: string } | null;
  setSelectedDraft: (chapterId: string, draftId: string) => void;
  clearSelectedDraft: () => void;   // back to follow-active
  reset: () => void;                // session reset (PER_USER_STORES)
}
```

- `EditorPage`: `viewedDraftId = (selected?.chapterId === activeChapterId ? selected.draftId : null) ?? activeDraftIdOf(draftsQuery.data)`. A selection for another chapter is simply inert — no effect-ordering dependency.
- The reset effect becomes conditional: on `activeChapterId` change, clear the selection **only if** `selected.chapterId !== activeChapterId`. Cross-chapter draft clicks (which set the pair for the *new* chapter before/with the chapter switch) survive; every other chapter-switch path (chapter row click, create, delete-fallback, story switch) still lands on the active draft, preserving parent-spec §8 "resets on chapter switch".
- Store stays registered in `sessionReset.ts` `PER_USER_STORES`; `reset()` clears the pair.

### D2. Flush-race fix — contained in EditorPage, `useAutosave` untouched

Root cause: `useAutosave` correctly snapshots the **save callback** at debounce-schedule time (the flush lands on the old draft's URL), but the callback is not self-contained — it reads `serverUpdatedAtRef.current` (a single ref tracking the *currently viewed* draft) at execution time. On an A→B switch with B already cached, EditorPage's ref-update effect (declared before the `useAutosave` call) runs before the hook's internal resetKey effect, so the flush for A executes with B's `updatedAt` → server 409s → `handleSave`'s catch raises the conflict banner about A while B is on screen.

Fix, two parts:

1. **Per-draft timestamp map.** Replace the scalar ref with `updatedAtByDraftRef: React.MutableRefObject<Map<string, string>>`. The effect that today writes the scalar instead writes `map.set(draftQuery.data.id, draftQuery.data.updatedAt)` (the mutation's `onSuccess` `setQueryData` keeps feeding it through the same effect). `handleSave` and the `useUnloadFlush` payload builder — both of which already close over their own `viewedDraftId` — read `map.get(thatId)`. A flush for draft A now always carries A's own `expectedUpdatedAt`, regardless of when it executes.
   - **The map is never cleared on chapter switch.** The resetKey flush *is* a cross-chapter flush when the switch is chapter→chapter (`useAutosave.ts` flushes the previous draft's pending debounce on every resetKey change), and it must still find the departed draft's timestamp. Entries are pruned only when a draft is deleted (D8). Growth is bounded by drafts-viewed-per-session — trivial. This also **closes a pre-existing hole**: today a chapter switch nulls the scalar ref before the flush, so the flushed PATCH goes out with *no* `expectedUpdatedAt` at all (unconditional overwrite of a possibly-concurrently-edited draft); with the map, that flush carries the right precondition too.
   - **Missing-entry invariant: no auto-path save may ever fall back to an unconditional PATCH.** If `map.get(id)` is `undefined` at save time (unexpected — the seed effect guarantees an entry before typing is possible), `handleSave` throws instead of PATCHing without a precondition, leaving the IndexedDB draft as the recovery path (`onSaved` never fires, so the local row is not cleared); the `useUnloadFlush` builder returns `null` (no keepalive PATCH). The only unconditional PATCH in the system remains the user's explicit conflict-banner **Overwrite**.
2. **View-guarded conflict banner.** `handleSave`'s 409 catch calls `setConflict(true)` only when the failing save's draft id (its closure) equals the draft still on screen (read via a `viewedDraftIdRef` kept fresh by an effect). A genuine conflict on a draft the user has already left is *not* bannered — the IndexedDB recovery layer (draft-keyed since step 6) owns that path: the rejected body was persisted by `onDirty`, and re-opening that draft offers restore. (The existing `setConflict(false)`-on-switch effect is insufficient alone: the async 409 lands *after* it and would re-raise the banner.)

With part 1, the spurious 409 disappears entirely; part 2 is defense for *real* cross-tab conflicts that land mid-switch.

### D3. `DraftList` — new storied component (draft child rows)

`frontend/src/components/DraftList.tsx` + `DraftList.stories.tsx`. Rendered by `ChapterList` under an expanded multi-draft chapter's row.

- **Props:** `{ chapterId, storyId, viewedDraftId: string | null, onSelectDraft(chapterId, draftId), onRequestNewDraft(chapterId) }`. It calls `useDraftsQuery(chapterId)` itself (the query is cheap, cached, and already invalidated by every draft mutation).
- **Row anatomy** (indented under the chapter row, h-7, token-only styling): active dot (`●`, `--accent`-family token, `aria-label="Active draft"`) on the `isActive` row and a blank spacer on others; display label (D6); `formatWordCountCompact(wordCount)` in the mono slot; hover/focus-within action cluster ★ ✎ 🗑 using the shared reveal fragment (D7). The **viewed** row (`draftId === viewedDraftId`) gets the same `data-active`/`aria-current` treatment chapter rows use — "which draft am I in" stays visible even when viewing ≠ active.
- **Click** on the row body → `onSelectDraft(chapterId, draftId)`. In `EditorPage`'s handler: `setSelectedDraft(chapterId, draftId)`, plus `setActiveChapter(chapterId)` when the chapter isn't the open one (D1 makes this order-safe).
- **★ set active** → `useSetActiveDraftMutation` (D8). Hidden on the already-active row.
- **✎ rename** → the row content swaps to the new `InlineEdit` primitive (D7): pre-filled with the custom label (empty when positional), Enter/blur commits, Escape cancels; commit PATCHes `{label}` via the existing `useUpdateDraftMutation`; committing an **empty** value PATCHes `{label: null}` (back to positional, matching the schema contract).
- **🗑 delete** → `InlineConfirm` (same pattern as chapter delete), hidden on the active row (parent spec §7). On success (D8's delete mutation): if the deleted draft was the viewed one, clear the selection (view falls back to the active draft). Failures (the 409 race codes or network) surface in ChapterList's `aria-live` status region — which gains a third state string for drafts: `ChapterList` owns a new `draftStatus` state and passes its setter down to `DraftList` (the region currently concatenates `{reorderStatus}{deleteStatus}`; the three strings get joined with spaces so screen readers don't run them together). `cannot_delete_active_draft` → "Draft is now active elsewhere — refreshed"; anything else → "Delete failed — try again"; both paths invalidate the drafts list to resync.
- **"＋ New draft…"** trailing child row → `onRequestNewDraft(chapterId)`.

### D4. Expansion model (user-decided)

- Chapters with `draftCount > 1` get a caret toggle rendered between the orderIndex number and the title (chevron, rotates 90° when expanded, `aria-expanded` on the button); the grip handle and number are untouched. Single-draft chapters render nothing there — row layout identical to today.
- **Default state: expanded iff the chapter is the one open in the editor**; all others start collapsed. Manual toggles are remembered in `ChapterList` component state (`Map<chapterId, boolean>` of overrides; effective = override ?? (chapterId === activeChapterId)), cleared when `storyId` changes. Ephemeral by design — no persistence.
- Chapters with `draftCount === 1`: no caret, no child rows; a subtle "＋ new draft" affordance appears in the hover action cluster and opens the dialog (parent spec §8).

### D5. `NewDraftDialog` — new storied component

`frontend/src/components/NewDraftDialog.tsx` + stories. Pure composition of `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter`/`Field`/`Input`/`Button`.

- **Props:** `{ chapterId, storyId, draftCount, open, onClose, onCreated(draft) }`.
- Radio: **Fork current draft** (default; copies prose only — server behavior, chats/summary start empty) vs **Start blank**. Optional name `Input` with placeholder = next positional label (`positionalDraftLabel(draftCount)`, e.g. "Draft D" when 3 exist); empty ⇒ omit `label` (positional).
- Confirm → `useCreateDraftMutation` (D8) → on success `onClose()` + `onCreated(draft)`; EditorPage's `onCreated` selects the new draft (`setSelectedDraft`) and, for a non-open chapter, switches to it. Submit-in-flight disables the confirm button (`Button` pending affordance); errors render inline in the dialog body, dialog stays open for retry.
- **Fork source is the active draft — the copy must say so when it matters.** The parent spec's radio reads "fork current draft", but `POST /drafts` has no source parameter: the server always forks the chapter's **active** draft (`draft.repo.ts:createFork`, verified). Viewed and active coincide everywhere except when the open chapter is viewing a non-active draft — in exactly that case the dialog's radio label switches to "Fork active draft" so the UI never promises a copy the API can't make. (Fork-of-arbitrary-draft would be one optional `sourceDraftId` on the POST if ever wanted; out of scope for a frontend-only step.)

### D6. Positional display labels

`draftDisplayLabel(meta: Pick<DraftMeta, 'label' | 'orderIndex'>): string` in `useDrafts.ts`:
`meta.label ?? positionalDraftLabel(meta.orderIndex)`, where `positionalDraftLabel(i)` = `"Draft A"…"Draft Z"` for `i ≤ 25`, then `"Draft 27"`-style numerics (`Draft ${i + 1}`) beyond — the letter alphabet is a display nicety, not a cap. **Deliberate boundary discontinuity:** the sequence runs `…Draft Y, Draft Z, Draft 27` — "Draft 26" never appears (Z *is* the 26th); a unit test pins `positionalDraftLabel(25) === 'Draft Z'` and `(26) === 'Draft 27'` so the jump reads as intended, not as a bug. Gap-free `orderIndex` (verified, §2) makes position ≡ orderIndex; renumber-on-delete falls out of list invalidation with no extra code.

### D7. Shared primitives extracted (anti-drift, user-directed)

- **`InlineEdit`** — new primitive in `design/primitives.tsx` + story, sibling of `InlineConfirm` (same interaction family: row content swaps for a control; Escape cancels; outside-click/blur behavior mirrors `useInlineConfirm`'s conventions). API: `{ initialValue, placeholder?, onCommit(value: string), onCancel, pending?, testId? }` — commit passes the trimmed value; the *caller* decides empty ⇒ `label: null`. Built generic (no draft vocabulary) so chapter/session rename can adopt it later.
- **`RowActions` reveal fragment** — the `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100` cluster currently inlined in `ChapterRow`'s grip button becomes a tiny shared piece (a `revealOnRowHover` class constant or micro-component in `primitives.tsx`) used by ChapterRow (grip + its new caret/＋ affordances) and DraftList rows — one source of truth for the reveal behavior, keyboard-focus reveal included.
- `Modal*`, `InlineConfirm`, `IconButton`, `Field`, `Input`, `formatWordCountCompact`: reused as-is. `DraftList` and `NewDraftDialog` stay specific — they're thin assemblies of shared parts, not new patterns.

### D8. New mutation hooks (in `useDrafts.ts`, alongside the existing ones)

All follow `useUpdateDraftMutation`'s conventions (typed args carrying `chapterId`/`storyId` for invalidation, zod-parsed responses).

- **`useCreateDraftMutation()`** — args `{chapterId, storyId, input: DraftCreateInput}` → POST. onSuccess: `setQueryData(draftQueryKey(draft.id), draft)` (instant editor load on select), invalidate `draftsQueryKey(chapterId)` + `chaptersQueryKey(storyId)` (`draftCount` changed).
- **`useSetActiveDraftMutation()`** — args `{chapterId, storyId, draftId, previousActiveDraftId: string | null}` → PUT active-draft (204). onSuccess invalidates: `draftsQueryKey(chapterId)` (dots), `chaptersQueryKey(storyId)` (chapter headline wordCount/summary flags follow the active draft), `chapterQueryKey(chapterId)` (chapter detail GET serves the active draft's summary — step-6 D5 read path), and `draftQueryKey(draftId)` + `draftQueryKey(previousActiveDraftId)` (both records' `isActive` flipped; caller passes the previous id from `activeDraftIdOf` of the list cache).
- **`useDeleteDraftMutation()`** — args `{chapterId, storyId, draftId}` → DELETE (204). onSuccess: `removeQueries({queryKey: ['draft', draftId]})` — prefix removal takes the draft record and its chat *lists*; the per-chat `['chat', chatId, 'messages']` caches are a different prefix and are deliberately left to TanStack's `gcTime` (never rendered again — their lists are gone; memory hygiene only). Invalidate `draftsQueryKey(chapterId)` + `chaptersQueryKey(storyId)`; prune the draft's entry from D2's timestamp map (EditorPage-side, via the selection-clear path); and best-effort purge the IndexedDB recovery row (`deleteDraft(userId, chapterId, draftId)` from `lib/chapterDrafts`, with `userId` read inside the hook from `useSessionStore((s) => s.user?.id)` — same source EditorPage uses).
- Rename reuses **`useUpdateDraftMutation`** unchanged.

### D9. Set-active pins the view ("viewing ≠ activating" preserved)

`selected === null` means "follow the active draft" — so activating another draft while following would silently *jump the editor* to the newly-activated draft mid-edit, violating parent-spec §7's core principle. Therefore the ★ handler first pins the current view and then fires the mutation: only the green dot moves. Mechanism, explicitly:

- **Membership test decides whether a pin is needed.** `DraftList` receives `viewedDraftId` but not `activeChapterId`; draft ids are chapter-unique, so `viewedDraftId ∈ this list's drafts` ⇔ "this is the open chapter's list". Non-member (non-open chapter, or `viewedDraftId === null`) ⇒ no view is affected ⇒ no pin.
- **The pin is a direct store write** — `useSelectedDraftStore.setSelectedDraft(chapterId, viewedDraftId)` called inside `DraftList`'s ★ handler, making `DraftList` the store's second consumer (it's a global UI-state store; a callback indirection through ChapterList→EditorPage would add two prop hops for the same write). Pinning to the id it already views is a no-op render-wise even when `selected` was already set.

### D10. Paper sub-row binding (absorbed 9wk.8)

`EditorPage` passes `draftLabel={viewedMeta ? draftDisplayLabel(viewedMeta) : null}` (viewedMeta = the viewed draft's entry in `draftsQuery.data`). `Paper`'s `SubRow` drops the `?? 'Draft 1'` dummy: `null`/absent now **omits** the draft segment (consistent with how `genre` already behaves) instead of showing a fabricated label while the list loads. Single-draft chapters show "Draft A" (their real positional label) — a deliberate, small visible change that makes the sub-row honest.

## 4. Edge cases

- **Deleting the viewed (non-active) draft** → selection cleared → view falls back to the active draft; resetKey change nulls any pending flush for the dead draft (no orphan PATCH).
- **draftCount drops to 1** → caret and children disappear (list invalidation); expansion override entry is harmless stale state.
- **Concurrent creates** → server-side P2002 retry already handles orderIndex collisions; the loser's client still gets a 201.
- **Set-active/delete races across tabs** → 409 codes surfaced via the aria-live status; drafts list invalidated to resync. The view-guarded banner (D2.2) keeps stale-tab conflicts from mislabeling the current draft.
- **Draft switch mid-conflict-banner** → existing behavior preserved: `setConflict(false)` on `viewedDraftId` change; the local IDB draft for the conflicted draft survives for restore.
- **Rename to whitespace-only** → `InlineEdit` trims; empty-after-trim commits `label: null` (positional), never a whitespace label (schema requires `min(1)`).

## 5. Testing

- **Hooks** (`frontend/tests/hooks/useDrafts...`): create/set-active/delete mutations — endpoint, payload, exact invalidation sets (including the two per-record `draftQueryKey` invalidations on set-active and the prefix `removeQueries` on delete); `draftDisplayLabel`/`positionalDraftLabel` (custom label, A/Z boundary, ≥26 numeric).
- **Store**: pair semantics — selection for another chapter is inert; conditional reset preserves a cross-chapter selection but clears a stale one.
- **DraftList** (component, jsdom): renders dot/label/wordCount; viewed-row aria-current; hover actions render (reveal is CSS — assert presence + accessible names, not opacity); ★ hidden on active row; ✎ swaps to InlineEdit and commit/cancel/empty→`label: null` paths; 🗑 hidden on active row, InlineConfirm flow, delete-failure status message; "＋ New draft…" row fires callback.
- **NewDraftDialog**: fork default; blank selectable; name placeholder = next positional; empty name omits `label`; pending disable; error keeps dialog open; "Fork active draft" copy variant when viewed ≠ active.
- **ChapterList**: caret only when `draftCount > 1`; auto-expand for the open chapter; manual toggle overrides; single-draft "＋ new draft" affordance.
- **EditorPage integration (the race regression)** — extend `editor-autosave.integration.test.tsx` (real TipTap + fake-indexeddb + in-memory 409-capable backend): (1) type in draft A, switch to cached draft B → assert the flush PATCH for A carries **A's** `updatedAt` and succeeds, no conflict banner; (2) type in draft A, switch **chapter** → the flush PATCH still carries A's `updatedAt` (the pre-existing no-precondition hole D2 closes); (3) force a genuine 409 on a save whose draft is no longer viewed → no banner, IDB row persists; (4) assert no PATCH in the test run ever omits `expectedUpdatedAt` except the explicit Overwrite action (the missing-entry invariant); (5) Paper sub-row shows the viewed draft's label after a switch.
- **Stories**: `DraftList.stories.tsx`, `NewDraftDialog.stories.tsx`, `InlineEdit` story in the primitives set, plus a multi-draft chapter story in `ChapterList.stories.tsx`. `lint:design` token guard applies to all new UI.

## 6. Build order (hint for the plan)

1. Store reshape (D1) + EditorPage conditional reset — keeps everything compiling with `viewedDraftId` semantics unchanged.
2. Flush-race fix (D2) + integration regression tests — the highest-risk change lands before any UI can trigger it.
3. Hooks: mutations + label helpers (D6, D8).
4. Primitives: `InlineEdit` + reveal fragment (D7).
5. `DraftList` (D3) + expansion wiring in ChapterList (D4).
6. `NewDraftDialog` (D5) + both entry affordances.
7. Paper binding (D10) + final integration pass.

## 7. Verify

`npm --prefix frontend run typecheck && npm --prefix frontend run test` (frontend-only; matches the bd issue's existing verify line — no stack dependency).
