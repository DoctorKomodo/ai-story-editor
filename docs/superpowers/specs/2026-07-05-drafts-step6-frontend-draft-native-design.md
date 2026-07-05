# Drafts Step 6 — Frontend Draft-Native Cutover (design note)

**Status:** user-approved direction (2026-07-05); step-delta spec against the epic spec
`docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` (§8).
**bd issue:** story-editor-9wk.6.
**Branch:** `feature/chapter-drafts` (backend steps 2–5 shipped; frontend currently
runtime-broken on body saves 400 / summary 404 / chat list+create 404 — the accepted
9wk.4 hard-cutover state this step repairs).

## 0. Reframe (user decision, supersedes the epic's step slicing)

The epic lands as ONE merge; no intermediate step is ever operated by a user. Every
design choice therefore targets the **final form** — no stopgap wire fields, no
"editor reads the body from the chapter for now" seams. Consequences:

- **The editor becomes draft-native in this step** (the epic's step-8 "editor body
  loads/saves the selectedDraft" is pulled forward into 9wk.6).
- **9wk.8 is retired.** Its only remainder — binding the `Paper.tsx` draft-label
  sub-row to the viewed draft's label — folds into 9wk.7 (sidebar/UI step).
- **A conversion-jank sweep is a first-class task**: code inserted only to keep
  intermediate steps compiling must not survive to the merge.

## Decisions

| # | Decision | Choice (user-approved) |
|---|---|---|
| D1 | Editor body/timestamp source | **Draft-native**: `GET /api/drafts/:id` is the editor's single source (body + `updatedAt` + label + summary in one record). No `activeDraftUpdatedAt` on the chapter payload (rejected stopgap); no editor read of the chapter GET's `bodyJson`. |
| D2 | Drafts list query | `GET /api/chapters/:id/drafts` (meta) lands now — resolves the active draft at chapter-open and is the same query 9wk.7's sidebar tree consumes. |
| D3 | IndexedDB recovery re-key migration | **None — version-bump + clear.** `resolveDraftDecision` (`frontend/src/lib/chapterDrafts.ts:100-101`) offers a restore only on exact `baseUpdatedAt === serverUpdatedAt` equality; old rows hold chapter timestamps which can never equal a draft timestamp, so any old row would be silently discarded anyway. |
| D4 | Backend single-sourcing scope-add | **Included**: derive `hasSummary`/`summaryIsStale` in draft `shape()` onto `RepoDraft`; `serializeDraft` becomes a pure pick (9wk.4 whole-branch-review follow-up). Wire shapes byte-identical. |
| D5 | Chapter detail GET (`GET /stories/:sid/chapters/:cid`) | **Unchanged — and load-bearing.** Serving the active draft's body is coherent final-form API surface. Two frontend consumers legitimately remain: the export path (`resolveExportBody`, `EditorPage.tsx:432-451` + `exportTxt.ts:153`) and the summary popover/sheet reads (§4). Only the **editor body path** stops consuming it. |
| D6 | Step slicing | 9wk.6 = all plumbing done the final way (this spec). 9wk.7 = all visible UI (sidebar tree, new-draft dialog, hover actions, **+ label binding from retired 9wk.8**). 9wk.9 = migration squash gate (unchanged). |

## 1. Editor data flow (draft-native)

### New state: `selectedDraft` store
`frontend/src/store/selectedDraft.ts`, mirroring `activeChapter.ts`'s shape:
`{ selectedDraftId: string | null, setSelectedDraftId, reset }`. Semantics:
- `null` = "follow the chapter's active draft" (the only value reachable until
  9wk.7's sidebar sets it).
- Reset on chapter switch (the editor page effect that reacts to
  `activeChapterId` changes calls `reset()`).
- The **viewed draft id** is derived, not stored:
  `selectedDraftId ?? activeDraft(draftsQuery.data)?.id` — single derivation
  helper exported from the new hook file.

### New hook file: `frontend/src/hooks/useDrafts.ts`
- `draftsQueryKey(chapterId)` = `['chapter', chapterId, 'drafts']`;
  `useDraftsQuery(chapterId)` → `GET /api/chapters/:chapterId/drafts`, parsed with
  `draftsResponseSchema` (shared). Meta list: id/label/wordCount/orderIndex/isActive/
  hasSummary/summaryIsStale/createdAt/updatedAt — everything 9wk.7's tree needs.
- `draftQueryKey(draftId)` = `['draft', draftId, 'detail']`; `useDraftQuery(draftId | null)`
  → `GET /api/drafts/:draftId`, parsed with `draftResponseSchema`. Enabled only when
  the id is non-null. This is the editor's body source. (The `'detail'` suffix
  namespaces it away from `['draft', draftId, 'chats']` — a bare 2-tuple would
  prefix-match the chat keys under TanStack's partial matching and refetch chat
  lists on every draft invalidation.)
- `useUpdateDraftMutation()` → `PATCH /api/drafts/:draftId` with
  `DraftUpdateInput` (`bodyJson`, optional `expectedUpdatedAt`; label writes are
  9wk.7's rename action, same mutation). On success: `setQueryData` the draft query
  with the response draft (fresh `updatedAt`), invalidate `draftsQueryKey(chapterId)`
  and `chaptersQueryKey(storyId)` (sidebar wordCount/summary icons follow the
  active draft).
- All shared types already exist (`draftSchema`/`draftMetaSchema`/`DraftUpdateInput`
  etc., `shared/src/schemas/draft.ts` — shipped in 9wk.4). No shared changes.

### EditorPage rewiring (`frontend/src/pages/EditorPage.tsx`)
- Body loads from `useDraftQuery(viewedDraftId)` — the `chapterQuery.data.bodyJson`
  read (`:238-251`) and the chapter-keyed seed ref (`seededForChapterIdRef`) are
  replaced by a **per-draft** seed ref keyed on `viewedDraftId`.
- `serverUpdatedAtRef` (`:256-259`) holds the **draft's** `updatedAt` — seeded from
  the draft record, refreshed from every PATCH response (same pattern as today).
- `handleSave` (`:272-296`) calls `useUpdateDraftMutation` with
  `{ bodyJson, expectedUpdatedAt }`. wordCount stays server-computed (the draft
  PATCH recomputes from `bodyJson` — `backend/src/routes/drafts.routes.ts:157-160`);
  the client-side `countWords` remains display-only.
- `useAutosave` is untouched; its `resetKey` becomes `viewedDraftId`.
- Conflict flow: `isChapterConflictError` (generic 409/`conflict` matcher,
  `useChapters.ts:302-304`) moves/renames beside the draft mutation (e.g.
  `isDraftConflictError` in `useDrafts.ts`); banner component and behavior
  unchanged — **Reload** refetches the draft query and re-seeds; **Overwrite**
  re-PATCHes without `expectedUpdatedAt`.
- The chapter detail query remains only if something still needs it (title lives
  in the chapters LIST cache; the jank sweep decides whether `useChapter` still
  has an editor consumer and prunes accordingly).
- Chapter title editing stays on `PATCH /stories/:sid/chapters/:cid` — that
  endpoint's final form (title/orderIndex only).

## 2. Local crash-recovery re-key (the data-corruption fix)

`frontend/src/lib/chapterDrafts.ts` + consumers:
- Store keyPath `['userId', 'chapterId']` → `['userId', 'chapterId', 'draftId']`
  (`chapterDrafts.ts:42`); `getDraft`/`deleteDraft`/`persistDraft` signatures gain
  `draftId`. **IndexedDB version bump; upgrade handler deletes/recreates the store
  (clears old rows)** — see D3 for why no row migration.
- `baseUpdatedAt` = the **viewed draft's** `updatedAt` at persist time
  (was: chapter's). `resolveDraftDecision` logic unchanged.
- `useChapterDraft.ts`: persists/fetches by `(userId, chapterId, draftId)`;
  the restore offer is evaluated against the draft's current `updatedAt`.
- `useUnloadFlush.ts:44-46`: keepalive flush re-points to
  `PATCH /api/drafts/:draftId` with `{ bodyJson, expectedUpdatedAt }` — adding the
  precondition is strictly safer than today's unconditional chapter flush and
  matches the "provably unsaved" contract documented in `chapterDrafts.ts`.
  **Misdirection safety** (a draft switch between buffer and flush must not
  redirect the write): delivered by the autosave reset mechanism, not by carrying
  an id in the buffer. `getPending` reads `viewedDraftId` + `serverUpdatedAtRef`
  from the EditorPage closure, and that is safe because switching the viewed
  draft changes `useAutosave`'s `resetKey`, which clears the baseline and makes
  `getPendingPayload()` return `null` until the new draft seeds
  (`useAutosave.ts:145-184, 362-364`) — a stale buffer can never be flushed at
  the new draft's id. The plan's corruption-class test #3 pins exactly this.
  `useAutosave` itself stays untouched.
- `DraftRestoreBanner` rendering unchanged.

Terminology note: this file family's "draft" (local dirty-buffer recovery) predates
the server-side Draft entity. The sweep may rename for clarity **only if cheap**
(e.g. `localRecovery` naming) — not a goal of this step; a collision-avoiding
comment is the floor.

## 3. Chat re-keying

`frontend/src/hooks/useChat.ts`:
- `chatsBaseQueryKey(draftId)` = `['draft', draftId, 'chats']`;
  `chatsQueryKey(draftId, kind)` 4-tuple with kind. Endpoints:
  `GET/POST /api/drafts/:draftId/chats` (mounted at `backend/src/index.ts:156`).
- **Message keys stay chat-scoped** (`['chat', chatId, 'messages']`) — no change
  (epic spec §8 pins this).
- `ChatSceneTab.tsx` prop `chapterId` → `draftId` (the viewed draft id, threaded
  from the editor shell); `ChatTab`/`SceneTab` wrappers pass it through.
- `chatDraft` optimistic store keys on `chatId` — confirmed unaffected
  (`frontend/src/store/chatDraft.ts`); do not churn it.
- `api.ts:262-288` chapter-mounted `listChats`/`createChat` helpers: re-point to
  the draft URLs or delete if unused after the hook rewrite (sweep decides by
  usage; `patchChat`/`deleteChat` on `/chats/:id` stay).

## 4. Summary re-point

The real summary consumers are **`ChapterSummaryPopover.tsx`** (reads state via
`useChapterQuery`, `:51,106-108`) and **`ChapterSummarySheet.tsx`** (seeded from a
chapter-detail fetch, `EditorPage.tsx:176,862`) — both opened from the sidebar
`ChapterList` for **any** chapter (not just the viewed one), keyed by `chapterId`.
There is no separate editor summary card. The sidebar summary flow always targets
a chapter's **active** draft — which is exactly what the chapter detail GET serves
under D5 — so their *reads* stay on `useChapterQuery` (correct data, no churn).

`frontend/src/hooks/useChapterSummary.ts`:
- `useSummariseChapterMutation` → `POST /api/drafts/:draftId/summarise`;
  `useUpdateChapterSummaryMutation` → `PUT /api/drafts/:draftId/summary`.
- **draftId source:** `chapterMeta.activeDraftId` (already on the chapters-list
  wire shape, `serialize.ts:162`). The hook signatures/call sites in the popover
  + sheet thread it through (both already receive the chapter meta context).
- On success both invalidate: **`chapterQueryKey(chapterId)`** (the popover/sheet
  read path — dropping it would leave them stale), `chaptersQueryKey(storyId)`
  (sidebar summary icon), `draftQueryKey(draftId)` and `draftsQueryKey(chapterId)`
  (draft record + meta booleans).
- `deriveSummaryState`/`deriveListSummaryState` (pure) unchanged.

## 5. Backend scope-add: single-source the draft summary booleans

Today TWO independent derivations exist with different inputs:
`serializeDraft` derives from the **decoded** row (`hasSummary = summary !== null
|| summaryUpdatedAt !== null`, `serialize.ts:180-181`) while
`findManyMetaForChapter` derives from **raw ciphertext presence**
(`summaryJsonCiphertext != null`, `draft.repo.ts:297-299` — deliberately, to avoid
a full decrypt). They are equivalent today because ciphertext-present ⟺
timestamp-present (written/cleared together, `draft.repo.ts:149-161`).

The fix single-sources the **logic**, not the inputs: a module-level helper in
`draft.repo.ts` — `deriveSummaryFlags(summaryPresent: boolean, summaryUpdatedAt:
Date | null, updatedAt: Date): { hasSummary, summaryIsStale }` — called by BOTH
`shape()` (which normalizes from the decoded row and puts the booleans onto
`RepoDraft`) and `findManyMetaForChapter` (which normalizes from the raw row).
`serializeDraft` becomes a pure pick. Wire shapes byte-identical (lock with
existing serializer/route tests). Each path still normalizes its own
"summary present?" input — that per-path line is irreducible without forcing the
meta path to decrypt. `repo-boundary-reviewer` in-lane at the close gate.

## 6. Conversion-jank sweep (dedicated task, late in plan order)

Hunt code that exists only to serve the intermediate steps; each hit is either
**deleted in this step** or **explicitly assigned** (9wk.7 / 9wk.9) — no silent
survivors. Seeded hunt list:

- `useChapters.ts:230-239` — the deliberately widened `UpdateChapterArgs.input`
  (+ "400s server-side until EditorPage is repointed" comment) → narrow to
  `ChapterUpdateInput`, delete the comment.
- `EditorPage.tsx` — chapter-keyed seed refs, residual `chapterQuery.data.bodyJson`
  reads **in the editor body path only** (the export path's `resolveExportBody`
  and the summary popover/sheet chapter reads are legitimate D5 consumers — do
  NOT sweep them; `useChapter` is not orphaned).
- Grep `\[9wk\.` across `frontend/src backend/src shared/src` — every tagged
  comment is re-judged: now-false → delete/rewrite; still-true → keep.
- Grep `until|temporary|dormant|repointed|step [0-9]|9wk\.[0-9]` (case-insensitive)
  in comments across the same roots — same judgment.
- Dead `api.ts` chapter-mounted chat helpers (see §3).
- `frontend/tests/fixtures/chapter.ts:18-19` placeholder `draftCount: 1 /
  activeDraftId: 'draft-1'` — fixtures become real draft records where tests now
  exercise drafts; placeholder-only fixtures get honest values.
- Tracker hygiene: retire story-editor-9wk.8 (fold label-binding into 9wk.7's
  notes + scope), update 9wk.7's scope note, note the 9wk.6 reframe on the epic.

Out of scope for the sweep: D5 (chapter GET body stays); `Paper.tsx`'s dummy
`'Draft 1'` label default (9wk.7 binds it); step-9's migration scaffolding
(9wk.9 owns it).

## 7. Testing

- **Rewritten suites** (~25 files touch this surface): fetch mocks re-pointed to
  draft endpoints; fixtures gain real draft records. Directly affected:
  `Autosave*.test.tsx`, `ChapterConflictBanner.test.tsx`, `useChapterDraft.test.ts`,
  `lib/chapterDrafts.test.ts`, `useUnloadFlush.test.ts`,
  `editor-autosave.integration.test.tsx`, `useChapters.test.ts`, `useChapter.test.tsx`,
  `useChapterSummary.test.ts`, `useChat.test.tsx`, `ChatSceneTab/ChatTab/SceneTab`,
  `editor*.integration.test.tsx`, `chat-panel.integration.test.tsx`, `Paper.test.tsx`.
- **New corruption-class coverage** (the step's reason to exist):
  1. Baseline re-seed on draft switch: buffer edits against draft A, switch viewed
     draft to B → A's buffered body is never PATCHed to B; B seeds fresh.
  2. Recovery store keyed per draft: A's persisted recovery row is not offered on B.
  3. Unload flush sends the viewed draft's `expectedUpdatedAt` (and targets its id).
  4. Draft 409 conflict → banner → Reload re-seeds from the draft record;
     Overwrite drops the precondition.
- **Live smoke (gate task):** jsdom can't prove the 404s are gone. Before close:
  `make dev` + drive the real app (Playwright or manual): type → autosave lands →
  reload persists; summarise a chapter; open/create a chat; unload-flush path.
- **Backend (D4):** serializer/route tests lock byte-identical wire shapes;
  affected backend suites run in the verify line.
- **Verify line (rewrite at gate):** frontend typecheck + FULL frontend vitest
  (cross-cutting change — per the bd memory, targeted runs under-detect) +
  backend typecheck + the D4-touched backend suites.

## 8. Out of scope

- Sidebar draft tree, new-draft dialog, hover actions, label binding — 9wk.7.
- Migration squash / consolidation gate — 9wk.9.
- Any chapter GET wire change (D5), any new backend endpoint.
- `chatDraft` store churn; message query keys; TipTap editor internals.
