# Drafts Step 6 — Frontend Draft-Native Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The frontend goes draft-native: the editor loads/saves `GET|PATCH /api/drafts/:id`, autosave + crash-recovery key per draft, chat and summary flows target the draft endpoints — repairing everything the 9wk.4 backend cutover broke — plus the backend summary-boolean single-sourcing and a conversion-jank sweep.

**Architecture:** Backend single-sourcing first (isolated); then the frontend foundation (selectedDraft store + `useDrafts.ts` hooks, additive); then ONE atomic editor-cutover task (EditorPage + recovery layer + unload flush — these share the `viewedDraftId` plumbing and cannot be split typecheck-green); then chat re-key; then summary re-point; then the jank sweep; gate last.

**Tech Stack:** React 19 + TanStack Query v5 + Zustand + TipTap (frontend), Vitest + jsdom + MSW-style fetch mocks (frontend tests), Express 5 + Prisma (backend task 1 only), Zod 4 shared wire schemas.

## Global Constraints

- TypeScript strict mode — no `any`. (CLAUDE.md)
- bd issue: **story-editor-9wk.6**. Commit format: `[story-editor-9wk.6] <desc>`. (CLAUDE.md Git Rules)
- Work from `/home/asg/projects/story-editor` on branch `feature/chapter-drafts`.
- Spec: `docs/superpowers/specs/2026-07-05-drafts-step6-frontend-draft-native-design.md` (user-approved, Opus-reviewed) + epic `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §8. Decisions D1–D6 are binding.
- **D1:** editor body + concurrency timestamp come from the draft record (`GET /api/drafts/:id`); saves go to `PATCH /api/drafts/:id` with `expectedUpdatedAt`. No editor read of the chapter GET's `bodyJson`.
- **D3:** IndexedDB recovery store re-keys `[userId, chapterId, draftId]` via **version bump + store delete/recreate** — no row migration.
- **D5:** the chapter detail GET is unchanged and load-bearing for the export path (`resolveExportBody`) and the summary popover/sheet reads — do NOT re-point or prune those.
- Frontend vitest (jsdom) needs no docker stack; backend tests (Task 1, gate) need `make dev` up first. (bd memory)
- Frontend verify runs the **FULL** `npm --prefix frontend run test` — targeted runs under-detect cross-cutting changes. (bd memory)
- Query keys introduced here: draft record = `['draft', draftId, 'detail']`; drafts list = `['chapter', chapterId, 'drafts']`; chats = `['draft', draftId, 'chats', kind?]`. Message keys stay `['chat', chatId, 'messages']`. The `'detail'` suffix is deliberate — a bare `['draft', draftId]` would prefix-match the chat keys.
- Wire schemas already exist in `story-editor-shared` (`draftSchema`, `draftMetaSchema`, `draftResponseSchema`, `draftsResponseSchema`, `DraftUpdateInput`) — **no shared/ changes in this plan.**
- Typecheck and ALL test suites stay green at every commit.
- The tree carries modified `.beads/*.jsonl` files (tracker exports, auto-staged by hooks). Commit with explicit pathspecs only, and verify with `git show --stat HEAD` after every commit that no `.beads/` file slipped in; if one did, `git reset HEAD~1` and recommit clean (single clean commit — no revert-commit pairs).
- Do NOT touch: `useAutosave.ts` (its `resetKey` mechanism already delivers flush-misdirection safety), the `chatDraft` store, message query keys, TipTap internals, any backend route/schema (except Task 1's serializer/repo), the step-9 migration scaffolding.

---

### Task 1: Backend — single-source the draft summary booleans (D4)

Two equivalent-but-independent derivations exist today: `serializeDraft` derives from the decoded row (`backend/src/lib/serialize.ts:180-181`) while `findManyMetaForChapter` derives from raw ciphertext presence (`backend/src/repos/draft.repo.ts:297-299`). Single-source the **logic** into one helper; each path keeps its own decrypt-free input normalization. Wire shapes byte-identical.

**Files:**
- Modify: `backend/src/repos/draft.repo.ts` (add module-scope `deriveSummaryFlags`; call it in `shape()` and `findManyMetaForChapter`; extend the `RepoDraft` type with the two booleans)
- Modify: `backend/src/lib/serialize.ts` (`serializeDraft` becomes a pure pick)
- Test: `backend/tests/repos/draft.repo.test.ts` (extend)

**Interfaces:**
- Produces: `RepoDraft` gains `hasSummary: boolean; summaryIsStale: boolean` (derived in `shape()`); `deriveSummaryFlags(summaryPresent: boolean, summaryUpdatedAt: Date | null, updatedAt: Date): { hasSummary: boolean; summaryIsStale: boolean }` exported from `draft.repo.ts` for the meta path. No wire change — `Draft`/`DraftMeta` schemas untouched.

- [ ] **Step 1: Write the failing parity test**

Add to `backend/tests/repos/draft.repo.test.ts` (reuse the file's `makeUserContext`/`createChapterRepo`/`createDraftRepo` helpers and its existing summary-write fixtures):

```ts
  it('[9wk.6] findById carries the same hasSummary/summaryIsStale booleans as the meta list', async () => {
    // Fixture: chapter (mints active draft), write a summary onto the active
    // draft via draftRepo.update, then a bodyJson-only update to make it
    // STALE. Then:
    //   const detail = await draftRepo.findById(draftId);
    //   const meta = (await draftRepo.findManyMetaForChapter(chapterId))
    //     .find((d) => d.id === draftId)!;
    //   expect(detail.hasSummary).toBe(true);
    //   expect(detail.summaryIsStale).toBe(true);
    //   expect({ hasSummary: detail.hasSummary, summaryIsStale: detail.summaryIsStale })
    //     .toEqual({ hasSummary: meta.hasSummary, summaryIsStale: meta.summaryIsStale });
    // Also assert the fresh case (summary just written, not stale) and the
    // no-summary case (new blank draft: both false).
  });
```

Write the body out fully with the file's real helpers. RED because `RepoDraft` has no `hasSummary`/`summaryIsStale` yet — this fails at **typecheck/compile**, which is the expected RED for a type-carrying refactor.

- [ ] **Step 2: Implement the helper + shape() derivation**

In `backend/src/repos/draft.repo.ts`, add at module scope (near `shape()` at the file bottom):

```ts
// [9wk.6] Single source for the summary-state booleans. Both projections call
// this — shape() from the decoded row, findManyMetaForChapter from the raw
// row — so the LOGIC cannot desync; each path only normalizes its own
// "summary present?" input (the meta path must not decrypt to answer it).
export function deriveSummaryFlags(
  summaryPresent: boolean,
  summaryUpdatedAt: Date | null,
  updatedAt: Date,
): { hasSummary: boolean; summaryIsStale: boolean } {
  const hasSummary = summaryPresent || summaryUpdatedAt !== null;
  return {
    hasSummary,
    summaryIsStale:
      hasSummary && summaryUpdatedAt !== null && summaryUpdatedAt < updatedAt,
  };
}
```

In `shape()` (currently `projectDecrypted` → `decodeJsonField` → `decodeSummaryField` → cast), derive the booleans onto the projection before the cast. `decodeSummaryField` has already produced `projected.summary` (null on corrupt/absent) and `projected.summaryUpdatedAt` (Date | null); the row's `updatedAt` is on the projection:

```ts
function shape(row: unknown, req: Request): RepoDraft {
  const projected = projectDecrypted(
    req,
    row as Record<string, unknown>,
    DRAFT_ENCRYPTED_FIELD_KEYS,
  );

  decodeJsonField(projected, 'body', 'bodyJson');
  decodeSummaryField(projected, row as { summaryJsonUpdatedAt: Date | null }, 'draft.repo');

  // [9wk.6] Derived here (single source) — serializeDraft is a pure pick.
  // summaryPresent uses the DECODED summary OR the timestamp so a
  // corrupt-but-present blob (summary: null, summaryUpdatedAt set) still
  // reports hasSummary: true — same semantics the serializer had.
  const flags = deriveSummaryFlags(
    (projected as { summary: unknown }).summary !== null,
    (projected as { summaryUpdatedAt: Date | null }).summaryUpdatedAt,
    (projected as { updatedAt: Date }).updatedAt,
  );
  return { ...(projected as object), ...flags } as RepoDraft;
}
```

Extend the `RepoDraft` type in the same file with `hasSummary: boolean; summaryIsStale: boolean;` (read the type's current shape first and add the two fields alongside the other derived/decoded fields).

In `findManyMetaForChapter`, replace the two inline derivation lines (`draft.repo.ts:297-299`) with:

```ts
      const flags = deriveSummaryFlags(
        r.summaryJsonCiphertext != null,
        r.summaryJsonUpdatedAt,
        r.updatedAt,
      );
```

and spread `...flags` where `hasSummary,`/`summaryIsStale,` are built into the returned object (delete the old locals).

- [ ] **Step 3: serializeDraft becomes a pure pick**

In `backend/src/lib/serialize.ts`, replace the two derivation lines in `serializeDraft` with picks, and update the block comment:

```ts
// Explicit pick (not spread): RepoDraft's runtime row carries chapterId +
// summaryJsonUpdatedAt remnants; picking keeps the wire shape exact.
// [9wk.6] hasSummary / summaryIsStale are derived in draft.repo's shape()
// (single source, shared with the meta path via deriveSummaryFlags) — this
// serializer is a pure pick.
export function serializeDraft(row: RepoDraft, isActive: boolean): Draft {
  return {
    id: row.id,
    chapterId: row.chapterId,
    label: row.label,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    isActive,
    hasSummary: row.hasSummary,
    summaryIsStale: row.summaryIsStale,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bodyJson: row.bodyJson,
    summary: row.summary,
    summaryUpdatedAt: row.summaryUpdatedAt ? row.summaryUpdatedAt.toISOString() : null,
  };
}
```

- [ ] **Step 4: Run the backend suites (stack up: `docker compose ps`, `make dev` if not)**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts tests/routes/drafts.test.ts tests/routes/chapters.test.ts && npm --prefix backend run typecheck`
Expected: PASS — the existing route/serializer assertions are the byte-identical lock; the new parity test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/draft.repo.ts backend/src/lib/serialize.ts backend/tests/repos/draft.repo.test.ts
git commit -m "[story-editor-9wk.6] single-source draft summary booleans (deriveSummaryFlags; serializeDraft pure pick)"
git show --stat HEAD   # exactly 3 files, no .beads/
```

---

### Task 2: Frontend foundation — `selectedDraft` store + `useDrafts.ts` hooks

Additive only — no consumer changes; everything compiles standalone.

**Files:**
- Create: `frontend/src/store/selectedDraft.ts`
- Create: `frontend/src/hooks/useDrafts.ts`
- Test: `frontend/tests/store/selectedDraft.test.ts`, `frontend/tests/hooks/useDrafts.test.tsx`

**Interfaces:**
- Produces (consumed by Tasks 3–5):
  - `useSelectedDraftStore`: `{ selectedDraftId: string | null, setSelectedDraftId(id: string | null), reset() }` (null = follow the active draft).
  - `draftsQueryKey(chapterId: string)` = `['chapter', chapterId, 'drafts']`; `useDraftsQuery(chapterId: string | null): UseQueryResult<DraftMeta[], Error>`.
  - `draftQueryKey(draftId: string)` = `['draft', draftId, 'detail']`; `useDraftQuery(draftId: string | null): UseQueryResult<Draft, Error>` (staleTime 30_000, enabled on non-null).
  - `useUpdateDraftMutation(): UseMutationResult<Draft, Error, UpdateDraftArgs>` with `UpdateDraftArgs = { draftId: string; chapterId: string; storyId: string; input: DraftUpdateInput }`.
  - `isDraftConflictError(err: unknown): boolean` (moved semantics of `isChapterConflictError` — 409 + code `'conflict'`).
  - `activeDraftIdOf(drafts: DraftMeta[] | undefined): string | null` — `drafts?.find((d) => d.isActive)?.id ?? null`.

- [ ] **Step 1: Write the store + its test**

`frontend/src/store/selectedDraft.ts` (mirror `activeChapter.ts`'s idiom exactly):

```ts
import { create } from 'zustand';

/**
 * Which draft is being VIEWED in the editor — ephemeral UI state, distinct
 * from the persisted `Chapter.activeDraftId`. `null` = follow the chapter's
 * active draft (the only reachable value until the 9wk.7 sidebar sets it).
 * Reset on chapter switch (EditorPage effect).
 */
export interface SelectedDraftState {
  selectedDraftId: string | null;
  setSelectedDraftId: (id: string | null) => void;
  reset: () => void;
}

const initialState: { selectedDraftId: string | null } = {
  selectedDraftId: null,
};

export const useSelectedDraftStore = create<SelectedDraftState>((set) => ({
  ...initialState,
  setSelectedDraftId: (selectedDraftId) => set({ selectedDraftId }),
  reset: () => set(initialState),
}));
```

`frontend/tests/store/selectedDraft.test.ts`: mirror `frontend/tests/store/sidebarTab.test.ts`'s style — set → read → reset → read null. Run: `npm --prefix frontend run test -- tests/store/selectedDraft.test.ts` → PASS.

- [ ] **Step 2: Write the failing hooks test**

`frontend/tests/hooks/useDrafts.test.tsx` — mirror `frontend/tests/hooks/useChat.test.tsx`'s fetch-mock + QueryClient wrapper idiom (read it first — `useChapters.test.ts` is a pure-function test with no query harness; the QueryClient/invalidation idiom lives in `useChat.test.tsx` / similar hook tests). Cases:

1. `useDraftsQuery` GETs `/api/chapters/ch-1/drafts`, parses `{ drafts: [...] }`, returns `DraftMeta[]`; disabled when `chapterId` is null (fetch not called).
2. `useDraftQuery` GETs `/api/drafts/d-1`, returns the parsed `Draft`; disabled on null.
3. `useUpdateDraftMutation` PATCHes `/api/drafts/d-1` with the given input; on success the `['draft', 'd-1', 'detail']` cache holds the response draft, and `['chapter', 'ch-1', 'drafts']` + `['chapters', 's-1']` (the real `chaptersQueryKey` shape — `useChapters.ts:22`) are invalidated (assert via `queryClient.getQueryState(...).isInvalidated`).
4. `isDraftConflictError`: true for `new ApiError(409, 'Draft was modified elsewhere', 'conflict')` (code is the THIRD ctor arg — mirror `useChapters.test.ts:8`); false for a 409 with another code and for non-ApiError.
5. `activeDraftIdOf`: picks the `isActive` entry; null on undefined/empty.

Build fixture `DraftMeta`/`Draft` objects satisfying the shared schemas (all fields — copy the field list from `shared/src/schemas/draft.ts`).

Run: `npm --prefix frontend run test -- tests/hooks/useDrafts.test.tsx`
Expected: FAIL — module `@/hooks/useDrafts` does not exist.

- [ ] **Step 3: Implement `frontend/src/hooks/useDrafts.ts`**

```ts
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Draft,
  type DraftMeta,
  type DraftUpdateInput,
  draftResponseSchema,
  draftsResponseSchema,
} from 'story-editor-shared';
import { ApiError, api } from '@/lib/api';
import { chaptersQueryKey } from './useChapters';

/**
 * Draft query hooks — the editor's data layer post-[9wk.6].
 *
 * Key design: the draft-record key carries a 'detail' suffix so it can never
 * prefix-match the chat keys (['draft', draftId, 'chats', kind]) under
 * TanStack's partial matching — invalidating a draft record must not refetch
 * its chat lists.
 */

export const draftsQueryKey = (chapterId: string): readonly [string, string, string] =>
  ['chapter', chapterId, 'drafts'] as const;

export const draftQueryKey = (draftId: string): readonly [string, string, string] =>
  ['draft', draftId, 'detail'] as const;

export function useDraftsQuery(chapterId: string | null): UseQueryResult<DraftMeta[], Error> {
  return useQuery({
    queryKey: draftsQueryKey(chapterId ?? ''),
    enabled: chapterId !== null,
    queryFn: async (): Promise<DraftMeta[]> => {
      const res = await api<unknown>(`/chapters/${encodeURIComponent(chapterId ?? '')}/drafts`);
      return draftsResponseSchema.parse(res).drafts;
    },
  });
}

export function useDraftQuery(draftId: string | null): UseQueryResult<Draft, Error> {
  return useQuery({
    queryKey: draftQueryKey(draftId ?? ''),
    enabled: draftId !== null,
    queryFn: async (): Promise<Draft> => {
      const res = await api<unknown>(`/drafts/${encodeURIComponent(draftId ?? '')}`);
      return draftResponseSchema.parse(res).draft;
    },
    staleTime: 30_000,
  });
}

export interface UpdateDraftArgs {
  draftId: string;
  chapterId: string;
  storyId: string;
  input: DraftUpdateInput;
}

export function useUpdateDraftMutation(): UseMutationResult<Draft, Error, UpdateDraftArgs> {
  const qc = useQueryClient();
  return useMutation<Draft, Error, UpdateDraftArgs>({
    mutationFn: async ({ draftId, input }) => {
      const res = await api<unknown>(`/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        body: input as Record<string, unknown>,
      });
      return draftResponseSchema.parse(res).draft;
    },
    onSuccess: (draft, vars) => {
      // The draft record cache feeds the editor's baseline + concurrency
      // timestamp — write it synchronously so the next render sees the fresh
      // updatedAt (same pattern as useUpdateChapterMutation's setQueryData).
      qc.setQueryData<Draft>(draftQueryKey(draft.id), draft);
      // Sidebar surfaces (draft meta wordCount/booleans; chapter-list
      // wordCount/summary icon follow the active draft server-side).
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
    },
  });
}

/**
 * True for the 409 `conflict` the draft PATCH returns when
 * `expectedUpdatedAt` no longer matches Draft.updatedAt.
 */
export function isDraftConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'conflict';
}

/** The active entry's id, or null while the list hasn't loaded. */
export function activeDraftIdOf(drafts: DraftMeta[] | undefined): string | null {
  return drafts?.find((d) => d.isActive)?.id ?? null;
}
```

(Confirm the exact `chaptersQueryKey` signature in `useChapters.ts` before importing — use it verbatim.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix frontend run test -- tests/hooks/useDrafts.test.tsx tests/store/selectedDraft.test.ts && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/selectedDraft.ts frontend/src/hooks/useDrafts.ts frontend/tests/store/selectedDraft.test.ts frontend/tests/hooks/useDrafts.test.tsx
git commit -m "[story-editor-9wk.6] selectedDraft store + useDrafts hooks (drafts list, draft record, draft PATCH, conflict matcher)"
git show --stat HEAD   # exactly 4 files, no .beads/
```

---

### Task 3: The editor cutover — draft-native EditorPage + recovery re-key + unload flush (ATOMIC)

Everything here shares the `viewedDraftId` plumbing; splitting would break typecheck between commits. One commit. This is the highest-risk task of the epic (the corruption-class fixes) — its tests are the point.

**Files:**
- Modify: `frontend/src/lib/chapterDrafts.ts` (key + DB version + `draftId`)
- Modify: `frontend/src/hooks/useChapterDraft.ts` (args + key threading)
- Modify: `frontend/src/hooks/useUnloadFlush.ts` (draft-scoped flush args + URL)
- Modify: `frontend/src/pages/EditorPage.tsx` (draft-native rewiring)
- Test: `frontend/tests/lib/chapterDrafts.test.ts`, `frontend/tests/hooks/useChapterDraft.test.ts`, `frontend/tests/hooks/useUnloadFlush.test.ts`, `frontend/tests/components/Autosave.test.tsx`, `frontend/tests/components/ChapterConflictBanner.test.tsx`, `frontend/tests/pages/editor-autosave.integration.test.tsx` (+ any editor integration test that mocks the old PATCH — discover via Step 6's grep)

**Interfaces:**
- Consumes: Task 2's `useSelectedDraftStore`, `useDraftsQuery`, `useDraftQuery`, `useUpdateDraftMutation`, `isDraftConflictError`, `activeDraftIdOf`, `draftQueryKey`.
- Produces: `viewedDraftId: string | null` derivation inside EditorPage (`selectedDraftId ?? activeDraftIdOf(draftsQuery.data)`) — Tasks 4–5 thread the same value; `ChapterDraft` record type gains `draftId: string`; `UnloadFlushArgs` becomes `{ draftId: string; bodyJson: unknown; expectedUpdatedAt: string | null }`.

- [ ] **Step 1: Re-key `chapterDrafts.ts`**

Apply exactly:

- `ChapterDraft` interface: add `draftId: string;` after `chapterId`; change the `baseUpdatedAt` doc line to `/** Server draft.updatedAt (ISO) the edit was made against. */`.
- `DB_VERSION = 2`.
- `openDb()`'s `onupgradeneeded`: delete-and-recreate (the keyPath is immutable; v1 rows are unreadable under the new key and provably un-offerable — see spec D3):

```ts
    req.onupgradeneeded = () => {
      const db = req.result;
      // [9wk.6] v1→v2: keyPath gained draftId. keyPath is immutable, so the
      // store is dropped and recreated — v1 rows' baseUpdatedAt held the
      // CHAPTER's updatedAt, which can never equal a draft's updatedAt, so
      // every old row would fail resolveDraftDecision anyway. Nothing of
      // value is lost.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: ['userId', 'chapterId', 'draftId'] });
    };
```

- `getDraft(userId, chapterId, draftId)` / `deleteDraft(userId, chapterId, draftId)`: add the third param and extend both `.get(...)`/`.delete(...)` key arrays to `[userId, chapterId, draftId]`.
- File header comment: `(userId, chapterId)` → `(userId, chapterId, draftId)`.

- [ ] **Step 2: Update `chapterDrafts.test.ts` and watch it pass**

Read the existing test file; extend/adjust: put/get/delete round-trip now uses the 3-part key; add one test that two drafts of the same chapter store independent records (put A, put B, get A → A's body). Run: `npm --prefix frontend run test -- tests/lib/chapterDrafts.test.ts` → PASS.

- [ ] **Step 3: Re-key `useChapterDraft.ts`**

- `UseChapterDraftArgs`: add `draftId: string | null;` after `chapterId`; the `serverUpdatedAt` doc comment becomes `/** draftQuery.data?.updatedAt ?? null. */`, `serverLoaded` becomes `/** draftQuery.data !== undefined. */`.
- `persistDraft`: destructure `draftId` too; bail when null; include it in the `putDraft({...})` record.
- `clearDraft`/`discardDraft`: destructure `draftId`; bail when null; pass to `deleteDraft(userId, chapterId, draftId)`.
- The load effect: deps become `[userId, chapterId, draftId, serverLoaded]`; the guard key becomes `` `${userId}:${chapterId}:${draftId}` ``; `getDraft(userId, chapterId, draftId)`; the stale-discard branch passes `draftId` as well. Rename `currentChapterKeyRef` → `currentDraftKeyRef` (and the comment's `seededForChapterIdRef` reference → `seededForDraftIdRef`, matching Step 5).

- [ ] **Step 4: Re-point `useUnloadFlush.ts`**

```ts
export interface UnloadFlushArgs {
  draftId: string;
  bodyJson: unknown;
  /** The viewed draft's last-seen updatedAt — the flush is preconditioned so a
   * stale buffer can only no-op (409 unobserved), never clobber. */
  expectedUpdatedAt: string | null;
}
```

In `flush()`:

```ts
      const serialized = JSON.stringify({
        bodyJson: pending.bodyJson,
        ...(pending.expectedUpdatedAt !== null
          ? { expectedUpdatedAt: pending.expectedUpdatedAt }
          : {}),
      });
      if (lastFlushedBodyRef.current === serialized) return;

      const path = `/drafts/${encodeURIComponent(pending.draftId)}`;
      const sent = apiKeepalivePatch(path, serialized);
```

Update the JSDoc's Task-3 sentence to state the flush now carries `expectedUpdatedAt` against the DRAFT's updatedAt.

- [ ] **Step 5: Rewire `EditorPage.tsx` draft-native**

The mechanical map (apply each; line anchors are pre-task):

1. Imports: add `useSelectedDraftStore`, `useDraftsQuery`, `useDraftQuery`, `useUpdateDraftMutation`, `isDraftConflictError`, `activeDraftIdOf` (+ drop imports that die: `isChapterConflictError`, and `useUpdateChapterMutation` stays — title changes still use it).
2. After `chapterQuery` (`:194`), add the draft layer:

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
  const draftQuery = useDraftQuery(viewedDraftId);
  const updateDraft = useUpdateDraftMutation();
```

3. `useChapterDraft` args (`:201-207`): add `draftId: viewedDraftId`; `serverUpdatedAt: draftQuery.data?.updatedAt ?? null`; `serverLoaded: draftQuery.data !== undefined`.
4. `restoreSeed` reset effect (`:218-220`) and `conflict` reset effect (`:268-270`): trigger on `viewedDraftId` instead of `activeChapterId` (a draft switch must also clear both; chapter switch changes `viewedDraftId` transitively — update the biome-ignore comments to say "viewedDraftId is the reset trigger").
5. Seed effect (`:238-251`) → per-draft:

```ts
  const seededForDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewedDraftId === null) {
      seededForDraftIdRef.current = null;
      setDraftBodyJson(null);
      return;
    }
    if (seededForDraftIdRef.current === viewedDraftId) return;
    if (draftQuery.data === undefined) return;
    seededForDraftIdRef.current = viewedDraftId;
    const serverBody = draftQuery.data.bodyJson as JSONContent | null;
    const seed: JSONContent = serverBody ?? { type: 'doc', content: [{ type: 'paragraph' }] };
    setDraftBodyJson(seed);
  }, [viewedDraftId, draftQuery.data]);
```

(Keep the `[T8.1]` explanatory comment, reworded chapter→draft.)
6. `serverUpdatedAtRef` effect (`:256-259`): source `draftQuery.data?.updatedAt ?? null`, dep `[draftQuery.data?.updatedAt]`; update the comment (the draft cache is written by `useUpdateDraftMutation.onSuccess`).
7. `handleSave` (`:272-296`):

```ts
  const handleSave = useCallback(
    async (value: JSONContent): Promise<void> => {
      if (!story?.id || activeChapterId === null || viewedDraftId === null) return;
      // wordCount is recomputed server-side from bodyJson (drafts.routes.ts).
      try {
        await updateDraft.mutateAsync({
          draftId: viewedDraftId,
          chapterId: activeChapterId,
          storyId: story.id,
          input: {
            bodyJson: value,
            ...(serverUpdatedAtRef.current !== null
              ? { expectedUpdatedAt: serverUpdatedAtRef.current }
              : {}),
          },
        });
      } catch (err) {
        if (isDraftConflictError(err)) setConflict(true);
        throw err;
      }
    },
    [story?.id, activeChapterId, viewedDraftId, updateDraft],
  );
```

8. `useAutosave` (`:298-323`): `resetKey: viewedDraftId` (comment: "Treat each DRAFT as its own document…"). Everything else unchanged.
9. `handleConflictReload` (`:325-339`): `const res = await draftQuery.refetch();` (rest identical).
10. `handleConflictOverwrite` (`:341-356`): guard `viewedDraftId !== null`; `updateDraft.mutateAsync({ draftId: viewedDraftId, chapterId: activeChapterId, storyId: story.id, input: { bodyJson: draftBodyJson } })` (no precondition — comment stays).
11. `useUnloadFlush` (`:358-364`):

```ts
  useUnloadFlush(
    useCallback(() => {
      const pending = autosave.getPendingPayload();
      if (pending === null || viewedDraftId === null) return null;
      // Closure-read ids are safe: switching the viewed draft changes
      // useAutosave's resetKey, which nulls getPendingPayload() until the new
      // draft's baseline seeds — a stale buffer can't flush at the new id.
      return {
        draftId: viewedDraftId,
        bodyJson: pending,
        expectedUpdatedAt: serverUpdatedAtRef.current,
      };
    }, [autosave.getPendingPayload, viewedDraftId]),
  );
```

12. Paper (`:722-750` region): `key` becomes `` restoreSeed !== null ? `${viewedDraftId}:r${restoreSeed.nonce}` : (viewedDraftId ?? activeChapterId) `` (a draft switch must remount Paper); `initialBodyJson` becomes `restoreSeed?.bodyJson ?? (draftQuery.data?.bodyJson as JSONContent | null) ?? null`. All other Paper props unchanged (chapter number/title still chapter-sourced).
13. `handleChapterTitleChange` (`:373-388`): UNCHANGED — title stays on the chapter PATCH.
14. **Delete the editor-path chapter query in THIS task:** after points 3/5/6/9/12 land, `const chapterQuery = useChapterQuery(activeChapterId ?? null, story?.id)` (`:194`) has zero remaining references — and `tsconfig.app.json` has `noUnusedLocals: true`, so leaving it makes this task's own typecheck fail. Delete the declaration + its `[F52]` comment block. (`detailForSheet` at `:176` and `resolveExportBody` are separate D5 consumers — do NOT touch them.) Verify: `grep -n "chapterQuery" frontend/src/pages/EditorPage.tsx` → no hits.

- [ ] **Step 6: Discover + rewrite the affected tests**

```bash
grep -rln "chapters/ch\|/chapters/\${\|bodyJson" frontend/tests/components/Autosave.test.tsx frontend/tests/components/Autosave-mockup.test.tsx frontend/tests/components/ChapterConflictBanner.test.tsx frontend/tests/pages/editor-autosave.integration.test.tsx frontend/tests/pages/editor.test.tsx frontend/tests/pages/editor-paper.integration.test.tsx frontend/tests/pages/editor-shell.integration.test.tsx frontend/tests/hooks/useChapterDraft.test.ts frontend/tests/hooks/useUnloadFlush.test.ts
```

Read each hit; the mechanical transform: fetch mocks gain `GET /api/chapters/:id/drafts` (one active `DraftMeta`) + `GET /api/drafts/:id` (the `Draft` record) responses; body-PATCH expectations re-target `PATCH /api/drafts/:id`; `useChapterDraft`/`useUnloadFlush` unit tests pass/assert the new `draftId`/`expectedUpdatedAt` args. Reuse `frontend/tests/fixtures/chapter.ts` and add a `makeDraftMeta`/`makeDraft` fixture pair there (all schema fields, honest values).

- [ ] **Step 7: Write the corruption-class tests (the reason this step exists)**

In `frontend/tests/pages/editor-autosave.integration.test.tsx` (mirror its existing arrange/act style):

1. **Draft-switch never cross-flushes:** load chapter with drafts A (active) + B; type (dirty buffer against A); flip the selectedDraft store to B; assert NO `PATCH /api/drafts/A` fired with the buffered body after the switch, and the editor re-seeds from B's body (autosave `resetKey` mechanism, pinned end-to-end).
2. **Recovery isolation:** persist a recovery record for draft A; view draft B of the same chapter → no restore banner; view A with matching `baseUpdatedAt` → banner offers.
3. **Unload flush shape:** with a dirty buffer on A, fire `pagehide` → keepalive PATCH hits `/drafts/A` with `{ bodyJson, expectedUpdatedAt: <A's updatedAt> }` (extend `useUnloadFlush.test.ts` for the arg-shape unit case).
4. **Conflict round-trip:** draft PATCH mock returns 409 `conflict` → banner appears; Reload refetches `GET /api/drafts/A` and re-seeds; Overwrite re-PATCHes without `expectedUpdatedAt`.

- [ ] **Step 8: Full frontend suite + typecheck**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test`
Expected: ALL PASS, output pristine. (Any remaining failure in an editor-adjacent suite = a missed mock re-point; fix within this task.)

- [ ] **Step 9: Commit (ONE commit)**

```bash
git add frontend/src/lib/chapterDrafts.ts frontend/src/hooks/useChapterDraft.ts frontend/src/hooks/useUnloadFlush.ts frontend/src/pages/EditorPage.tsx frontend/tests
git commit -m "[story-editor-9wk.6] EDITOR CUTOVER: draft-native load/save + per-draft autosave baseline + draft-keyed recovery + preconditioned unload flush"
git show --stat HEAD   # no .beads/
```

---

### Task 4: Chat re-key — chapter → draft

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (keys + list/create endpoints + arg names, incl. `SendChatMessageArgs`/`EditMessageArgs`)
- Modify: `frontend/src/hooks/useMessageActions.ts` (its `chapterId` arg is REALLY the chats-list invalidation id — rename to `draftId`; see Step 2)
- Modify: `frontend/src/hooks/useBannerRetry.ts` (same — its `chapterId` prop flows into the send mutation's invalidation id)
- Modify: `frontend/src/components/ChatSceneTab.tsx` (prop `draftId` added)
- Modify: `frontend/src/components/ChatTab.tsx`, `frontend/src/components/SceneTab.tsx` (pass-through)
- Modify: `frontend/src/pages/EditorPage.tsx` (thread `viewedDraftId` to the chat panel — find the `<ChatTab`/`<SceneTab` render sites via `grep -n "ChatTab\|SceneTab" frontend/src/pages/EditorPage.tsx`)
- Delete: `frontend/src/hooks/useScenes.ts` + `frontend/tests/hooks/useScenes.test.tsx` (no `src` consumer — SceneTab goes through ChatSceneTab/useChat; confirm with `grep -rn "useScenes" frontend/src` and report if that contradicts)
- Modify: `frontend/src/lib/api.ts` (`listChats`/`createChat` — after the `useScenes` deletion re-run `grep -rn "listChats\|createChat(" frontend/src`; expected zero callers → DELETE both helpers + their imports; if a caller remains, re-point to `/drafts/:draftId/chats` instead and report)
- Test: `frontend/tests/hooks/useChat.test.tsx`, `frontend/tests/hooks/useMessageActions.test.*`/`useBannerRetry.test.*` (discover exact names via `ls frontend/tests/hooks/`), `frontend/tests/components/ChatSceneTab.test.tsx`, `frontend/tests/components/ChatTab.test.tsx`, `frontend/tests/components/SceneTab.test.tsx`, `frontend/tests/pages/chat-panel.integration.test.tsx`

**Interfaces:**
- Consumes: Task 3's `viewedDraftId` (EditorPage) — threaded as the new `draftId` prop.
- Produces: `chatsBaseQueryKey(draftId)` = `['draft', draftId, 'chats']`; `chatsQueryKey(draftId, kind?)` 4-tuple; `useChatsQuery(draftId, opts)`; `CreateChatArgs.draftId`; `SendChatMessageArgs.draftId` / `EditMessageArgs.draftId`; `useRenameChatMutation(draftId, kind)` / `useRemoveChatMutation(draftId, kind)`; `useMessageActions({ draftId, … })`, `useBannerRetry({ draftId, … })`. Message hooks/keys (`['chat', chatId, 'messages']`, `/chats/:id/...` URLs) UNCHANGED.

- [ ] **Step 1: Rewrite `useChat.ts` keys + endpoints**

Mechanical rename `chapterId` → `draftId` in: `chatsBaseQueryKey`, `chatsQueryKey`, `useChatsQuery` (URL becomes `` `/drafts/${encodeURIComponent(draftId ?? '')}/chats${params}` ``), `CreateChatArgs`, `useCreateChatMutation` (URL `` `/drafts/${encodeURIComponent(draftId)}/chats` ``), `useRenameChatMutation`/`useRemoveChatMutation` params, **and `SendChatMessageArgs`/`EditMessageArgs`** — their `chapterId` field exists solely to feed `chatsBaseQueryKey(vars.chapterId)` in the mutations' `onSuccess` (`useChat.ts:279,320`), so it MUST become the draft id or those invalidations silently miss forever (`['draft', <chapterId>, 'chats']` never matches). `grep -n chapterId frontend/src/hooks/useChat.ts` afterward — expected zero hits. Key literal `'chapter'` → `'draft'` in both key builders. Update the `chatsBaseQueryKey` doc comment ("for a given chapter" → "for a given draft").

- [ ] **Step 2: Thread the id through hooks + components**

- `useMessageActions.ts`: rename its `chapterId` arg to `draftId` — verified: it only forwards into the send/edit mutations' invalidation id (`useMessageActions.ts:54,69-74`) and a non-null send guard; it does NOT build attachment metadata (that comes separately from `args.attachment.chapter.id` in `ChatSceneTab.tsx:191`).
- `useBannerRetry.ts`: same rename — its `chapterId` flows into the send mutation (`useBannerRetry.ts:64-69`).
- `ChatSceneTab.tsx`: `ChatSceneTabProps` gains `draftId: string | null`; `useChatsQuery(draftId, { kind })`, `useRenameChatMutation(draftId, kind)`, `useRemoveChatMutation(draftId, kind)`, create passes `draftId`, and `useMessageActions({ draftId, … })`. Then `grep -n chapterId frontend/src/components/ChatSceneTab.tsx`: if the prop has no remaining consumer, REMOVE `chapterId` from the props (final form — update wrappers + EditorPage); if a real consumer remains (e.g. attachment chapter context construction), keep it and name the consumer in the report.
- `ChatTab.tsx`/`SceneTab.tsx`: pass-through of whatever prop set survives. EditorPage render sites: add `draftId={viewedDraftId}`.

- [ ] **Step 3: Delete `useScenes` + the api.ts helpers**

`grep -rn "useScenes" frontend/src` — expected: no `src` consumer. Delete `frontend/src/hooks/useScenes.ts` + `frontend/tests/hooks/useScenes.test.tsx`. Then `grep -rn "listChats\|createChat(" frontend/src --include=*.ts --include=*.tsx` — expected zero callers → delete both helpers from `api.ts` (+ now-unused imports). If either grep contradicts, stop, report the caller, and re-point instead of deleting.

- [ ] **Step 4: Rewrite the chat tests**

Same mechanical transform across the listed test files (+ the `useMessageActions`/`useBannerRetry` tests): mock URLs → `/api/drafts/:id/chats`, hook args/props gain-or-rename to `draftId`, cache-key assertions use the `['draft', …]` literals. Message-hook tests' keys/URLs didn't move — verify no accidental churn in the diff.

- [ ] **Step 5: Run + commit**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test`
Expected: PASS.

```bash
git add -A frontend/src frontend/tests
git commit -m "[story-editor-9wk.6] chat re-key: chats scoped to the viewed draft (incl. send/edit invalidation ids); delete dead useScenes + api chat helpers"
git show --stat HEAD   # no .beads/ (the -A is scoped to frontend/ so deletions register)
```

---

### Task 5: Summary re-point — mutations target the active draft

The consumers are `ChapterSummaryPopover` (sidebar popover, reads via `useChapterQuery` — reads STAY per D5) and `ChapterSummarySheet` (seeded from `detailForSheet`). Only the two mutations move; `draftId` comes from `chapterMeta.activeDraftId`.

**Files:**
- Modify: `frontend/src/hooks/useChapterSummary.ts` (both mutations)
- Modify: `frontend/src/components/ChapterSummaryPopover.tsx` (thread `activeDraftId`)
- Modify: `frontend/src/components/ChapterSummarySheet.tsx` (thread `activeDraftId`)
- Modify: `frontend/src/pages/EditorPage.tsx` (sheet call site, if it must pass the id — check how the sheet resolves it; `detailForSheet.data?.activeDraftId` is available since `chapterSchema` extends the meta)
- Test: `frontend/tests/hooks/useChapterSummary.test.ts` + the popover/sheet component tests (`grep -rln "SummaryPopover\|SummarySheet" frontend/tests`)

**Interfaces:**
- Consumes: `chapterMeta.activeDraftId` (already on the wire, `serialize.ts:162`); Task 2's `draftQueryKey`/`draftsQueryKey`.
- Produces: `useSummariseChapterMutation(draftId: string, chapterId: string, storyId: string)`, `useUpdateChapterSummaryMutation(draftId: string, chapterId: string, storyId: string)` — same response type (`chapterSummaryResponseSchema`, unchanged by the 9wk.4 port).

- [ ] **Step 1: Rewrite the two mutations**

```ts
/** POST /drafts/:draftId/summarise — generate OR regenerate; same endpoint either way. */
export function useSummariseChapterMutation(
  draftId: string,
  chapterId: string,
  storyId: string,
): UseMutationResult<ChapterSummaryResponse, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string): Promise<ChapterSummaryResponse> => {
      const res = await api<unknown>(`/drafts/${encodeURIComponent(draftId)}/summarise`, {
        method: 'POST',
        body: { modelId },
      });
      return chapterSummaryResponseSchema.parse(res);
    },
    onSuccess: () => {
      // chapterQueryKey is the popover/sheet READ path (chapter GET serves the
      // active draft's summary, spec D5) — dropping it would leave them stale.
      void qc.invalidateQueries({ queryKey: chapterQueryKey(chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
      void qc.invalidateQueries({ queryKey: draftQueryKey(draftId) });
      void qc.invalidateQueries({ queryKey: draftsQueryKey(chapterId) });
    },
  });
}
```

`useUpdateChapterSummaryMutation(draftId, chapterId, storyId)`: same transform (URL `` `/drafts/${encodeURIComponent(draftId)}/summary` ``, method PUT, same 4-key invalidation set). Import `draftQueryKey`, `draftsQueryKey` from `./useDrafts`. Delete the stale `/stories/:storyId/...` JSDoc URLs.

- [ ] **Step 2: Thread `draftId` through the two components**

`ChapterSummaryPopover.tsx`: it receives the chapter meta (`chapter?.id` at `:49`) — pass `chapter?.activeDraftId ?? ''` as the mutation's first arg (`useSummariseChapterMutation(chapter?.activeDraftId ?? '', chapterId ?? '', storyId)`); read the component first — if its `chapter` prop is a narrowed pick without `activeDraftId`, widen the prop type to include it and update the `ChapterList`/EditorPage call sites that construct it.
`ChapterSummarySheet.tsx`: signature gains `activeDraftId: string`; `useUpdateChapterSummaryMutation(activeDraftId, chapterId, storyId)`; EditorPage's sheet render passes `detailForSheet.data?.activeDraftId ?? ''` (render-guard: the sheet already waits for `detailForSheet` data via `initialSummary` — mirror that guard for the id).

- [ ] **Step 3: Rewrite the tests + run**

`useChapterSummary.test.ts`: mock URLs → `/api/drafts/d-1/summarise` / `/summary`; assert the 4-key invalidation set (including `chapterQueryKey` — that's the regression the Opus spec review caught). Component tests: pass the new arg/prop.

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useChapterSummary.ts frontend/src/components/ChapterSummaryPopover.tsx frontend/src/components/ChapterSummarySheet.tsx frontend/src/pages/EditorPage.tsx frontend/tests
git commit -m "[story-editor-9wk.6] summary re-point: summarise/save target the active draft; chapter-read invalidation preserved"
git show --stat HEAD   # no .beads/
```

---

### Task 6: Conversion-jank sweep + tracker hygiene

Hunt code that exists only to serve the intermediate steps. Every hit is deleted here or explicitly assigned (9wk.7 / 9wk.9) in the report — no silent survivors.

**Files:**
- Modify: `frontend/src/hooks/useChapters.ts` (narrow `UpdateChapterArgs`)
- Modify: `frontend/src/pages/EditorPage.tsx` (prune the orphaned editor-path chapter query IF orphaned — see Step 2)
- Modify: `frontend/tests/fixtures/chapter.ts` (+ whatever the greps surface)
- Tracker: bd updates (no code)

**Interfaces:** consumes Tasks 3–5 being complete (nothing sends `bodyJson` through the chapter PATCH anymore).

- [ ] **Step 1: Narrow `UpdateChapterArgs`**

`frontend/src/hooks/useChapters.ts:230-239` — delete the widening + its `[9wk.4]` comment:

```ts
export interface UpdateChapterArgs {
  storyId: string;
  chapterId: string;
  input: ChapterUpdateInput;
}
```

Also delete `isChapterConflictError` (`:297-304`) IF `grep -rn "isChapterConflictError" frontend/src frontend/tests` shows no remaining src consumer after Task 3 (its semantics moved to `isDraftConflictError`); migrate any lingering test import.

- [ ] **Step 2: Verify the editor-path chapter query is gone (deleted in Task 3)**

Task 3 point 14 already deleted EditorPage's `chapterQuery` (it would have failed `noUnusedLocals` otherwise). Verification-only here: `grep -n "chapterQuery" frontend/src/pages/EditorPage.tsx` → expected no hits. **Do NOT touch** `detailForSheet`, `resolveExportBody`, or `useChapterQuery` itself (D5 consumers).

- [ ] **Step 3: Tagged-comment + stopgap greps**

```bash
grep -rn "\[9wk\." frontend/src backend/src shared/src
grep -rniE "until (step|the)|temporar|dormant|repointed|pending the step" frontend/src backend/src shared/src
```

Judge every hit: now-false → delete/rewrite; still-true (e.g. step-9 squash notes, 9wk.7 pointers) → keep and list in the report. Known expected hits to fix: any surviving `[9wk.4]`-era "pending the step-6 cutover" comments. Known keeps: `[9wk.5]` contract-migration comments in backend (historical fact), `[D16]`/`[E5]`-style tags.

- [ ] **Step 4: Fixture honesty**

`frontend/tests/fixtures/chapter.ts:18-19` — the placeholder `draftCount: 1 / activeDraftId: 'draft-1'` must now agree with the `makeDraftMeta`/`makeDraft` fixtures Task 3 added (same ids); reconcile so a chapter fixture's `activeDraftId` matches a real draft fixture id used by the tests.

- [ ] **Step 5: Tracker hygiene (bd, no code)**

```bash
bd supersede story-editor-9wk.8 --with=story-editor-9wk.7
bd update story-editor-9wk.7 --notes "$(bd show story-editor-9wk.7 --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['notes'])")
scope-add (2026-07-05, step-6 reframe): absorbs retired 9wk.8 — bind Paper.tsx draftLabel sub-row to the viewed draft's label (viewedDraftId + useDraftQuery/useDraftsQuery from 9wk.6 provide it; the dummy 'Draft 1' default dies here). Editor load/save for selectedDraft ALREADY landed in 9wk.6 (draft-native cutover)."
```

(Adjust mechanically if `bd supersede` syntax differs — `bd supersede --help` first; fall back to `bd update story-editor-9wk.8` notes + close via the coordinator convention ONLY if supersede is unavailable, and say so in the report.)

- [ ] **Step 6: Run + commit**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix backend run typecheck`
Expected: PASS.

```bash
git add frontend/src frontend/tests backend/src shared/src
git commit -m "[story-editor-9wk.6] conversion-jank sweep: narrow UpdateChapterArgs, prune stopgap comments/queries, honest fixtures"
git show --stat HEAD   # no .beads/
```

---

### Task 7: Gate — full verify + live smoke + verify-line + close

**Interfaces:** none — final gate.

- [ ] **Step 1: Full local verify**

```bash
make lint && make typecheck
make dev && make test
```
Expected: PASS across shared + backend + frontend (3 pre-existing biome warnings accepted).

- [ ] **Step 2: Live smoke — jsdom can't prove the 404s are gone**

With the stack up (`make dev`; backend restarted since the last migration), drive the real app at `http://localhost:3000` via Playwright MCP (or report exact manual steps): register/login → create story + chapter → **type in the editor and observe the draft PATCH succeed** (network tab / server log: `PATCH /api/drafts/:id` 200) → reload the page and confirm the text persisted → Summarise the chapter (**after typing prose** — an empty draft 400s `empty_chapter` before the key check, `drafts.routes.ts:211-214`; with a body but no Venice key, confirm the request reaches `POST /api/drafts/:id/summarise` and fails with the key-missing error, NOT 404) → open the chat tab, create a chat (`POST /api/drafts/:id/chats` 200) → close the tab mid-edit and confirm the keepalive `PATCH /api/drafts/:id` fires (server log). Record each observed request+status in the report. Any 404/400 on these paths = a missed re-point; fix before proceeding.

- [ ] **Step 3: Rewrite the issue's verify line, then close through the gate**

```bash
bd update story-editor-9wk.6 --notes "plan: docs/superpowers/plans/2026-07-05-drafts-step6-frontend-draft-native.md
spec: docs/superpowers/specs/2026-07-05-drafts-step6-frontend-draft-native-design.md + docs/superpowers/specs/2026-06-25-chapter-drafts-design.md (§8)
verify: make dev && npm --prefix frontend run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run test && npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts tests/routes/drafts.test.ts tests/routes/chapters.test.ts
scope-note (2026-07-05, user-approved reframe): FINAL-FORM cutover — editor draft-native (GET/PATCH /api/drafts/:id, pulled forward from retired 9wk.8), selectedDraft store + useDrafts hooks, IndexedDB recovery re-keyed [userId,chapterId,draftId] (v2 clear, no row migration), chat re-keyed to draft, summary mutations → active draft (reads stay on chapter GET per D5), backend deriveSummaryFlags single-sourcing, conversion-jank sweep. 9wk.8 superseded into 9wk.7 (label binding)."
```

Then: do NOT `bd close` — run `/bd-close-reviewed story-editor-9wk.6`. Expected in-lane reviewers: `repo-boundary-reviewer` (Task 1 touches draft.repo + serialize). The frontend surface has no path-matched reviewer; the whole-branch review (run by `/bd-execute` before this) is the frontend gate.

---

## Self-Review

- **Spec coverage:** D1 editor draft-native (T3 Steps 5, 7); D2 drafts-meta query (T2); D3 v2 clear (T3 Steps 1–2); D4 deriveSummaryFlags (T1); D5 protected consumers (T5 reads stay, T6 Step 2 do-not-touch list); D6/reframe + 9wk.8 supersede (T6 Step 5); §1 keys incl. 'detail' suffix (T2 Step 3); §2 recovery re-key + flush precondition + misdirection-safety-via-resetKey (T3 Steps 1–4, 11); §3 chat re-key + message keys unchanged + chatDraft untouched (T4); §4 popover/sheet threading + 4-key invalidation incl. chapterQueryKey (T5); §6 sweep hunt list (T6); §7 corruption-class tests (T3 Step 7), live smoke (T7 Step 2), full-suite verify line (T7 Step 3). ✓
- **Placeholder scan:** discovery greps in T3 Step 6 / T4 Steps 2–3 / T6 delegate to files the implementer must read first, per this repo's established plan style; every production-code step shows exact code. No TBDs. ✓
- **Type consistency:** `viewedDraftId: string | null` (T3) feeds `draftId` props/args in T4–T5; `UpdateDraftArgs {draftId, chapterId, storyId, input}` consistent between T2 definition and T3 Step 5.7 / T5 usage; `UnloadFlushArgs {draftId, bodyJson, expectedUpdatedAt}` consistent T3 Steps 4/11; `deriveSummaryFlags(boolean, Date|null, Date)` consistent T1 Steps 2 (both call sites). `isChapterConflictError` deleted only in T6 after T3 replaced its one consumer. ✓
- **Green-at-each-commit:** T1 backend-only; T2 additive; T3 atomic (lib+hooks+page+tests, one commit — incl. the `chapterQuery` deletion that `noUnusedLocals` forces into this task); T4 atomic (hooks + props + call sites + deletions together); T5 atomic; T6 cleanup compiles standalone; T7 gate-only. ✓
- **Adversarial review (Opus, 2026-07-05) folded:** BLOCKER — Task 4 gains `useMessageActions.ts` + `useBannerRetry.ts` (their `chapterId` is the chats-list invalidation id, NOT attachment metadata — renamed `draftId`; the false "keep chapterId for metadata" rationale removed, ChatSceneTab's `chapterId` prop now removed-if-unconsumed). SHOULD-FIXes — EditorPage `chapterQuery` deletion moved into Task 3 (point 14; `noUnusedLocals` would fail Task 3's own typecheck otherwise), Task 6 Step 2 verification-only; dead `useScenes.ts` + its test named for deletion in Task 4 (was an unlisted `listChats`/`createChat` caller that broke the delete-vs-repoint decision). NITs — Task 2 template repointed to `useChat.test.tsx` (real QueryClient idiom), key/ctor literals corrected (`['chapters', storyId]`; `ApiError(status, message, code)`), smoke-test empty-draft `empty_chapter` ordering note. Reviewer verified clean: T1 shape()/serializer compile + wire-lock tests, all EditorPage anchors, T3-vs-T6 ordering on the widened type, no-shared-changes claim, T5 prop availability + response schemas, `bd supersede` exists, fake-indexeddb present, corruption-test-1 harness pattern (`useActiveChapterStore.setState` in `editor-autosave.integration.test.tsx:107`). ✓
