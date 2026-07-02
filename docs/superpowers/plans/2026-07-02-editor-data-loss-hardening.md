# Editor Data-Loss Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the editor's three data-loss windows: (1) closing/discarding the tab inside the 4s autosave debounce silently loses typed prose (no unload flush, no draft persistence anywhere in `frontend/src/`); (2) a session expiry or backend restart mid-write (DEKs live in process memory — every deploy logs everyone out) bounces to /login and discards the failed flush; (3) the chapter PATCH is last-write-wins — two tabs clobber each other silently, and ciphertext-only storage means there is no recovery.

**Architecture:** Three workstreams in dependency order. **(A)** A local draft layer: dirty TipTap JSON is persisted to IndexedDB (keyed `userId+chapterId`, carrying the server `updatedAt` it was edited against) on every dirty change via two new optional `useAutosave` callbacks (`onDirty` / `onSaved`); the draft is deleted on confirmed save; on chapter load, a newer-than-server draft triggers a restore banner. This makes typed text survive tab close, crash, session expiry, and re-login — without touching the crypto/session model. **(B)** `pagehide` + `visibilitychange` handlers: the draft is already on disk by keystroke time (A), so unload adds a best-effort network flush via `fetch(…, { keepalive: true })` — `navigator.sendBeacon` is ruled out because it is POST-only and the endpoint is PATCH (verified via MDN; cookies would ride along fine, the method is the blocker). **(C)** An optional `expectedUpdatedAt` precondition on the chapter PATCH (shared Zod schema → repo `updateMany` where-clause → 409 `{ error: { code: 'conflict' } }`), with frontend handling that stops autosave, keeps the local draft, and surfaces a conflict banner. The field is optional, so old clients and import paths keep working. No Prisma schema change anywhere — `Chapter.updatedAt @updatedAt` already exists (`backend/prisma/schema.prisma:96`).

**Tech Stack:** React 19 + TypeScript strict + Vite + Vitest/jsdom (+ `fake-indexeddb` for the draft-store tests) + TipTap + Zustand + TanStack Query on the frontend; Express + Prisma + supertest integration tests (real test DB, through the repo layer) on the backend; `story-editor-shared` Zod schemas as the wire contract.

## Design decisions (user sign-off required)

1. **Plaintext narrative content on the user's device.** The whole point of this feature is that drafts survive the server-side session dying — so drafts CANNOT be encrypted under the DEK (the client never holds it) and live as **plaintext TipTap JSON in the browser's IndexedDB**, while the server continues to store everything AES-256-GCM encrypted at rest. This is a deliberate weakening of the at-rest story for a bounded window: drafts are transient (deleted on every confirmed save, and stale drafts are discarded on load), one per `(user, chapter)`, and scoped to the browser profile. Threat accepted: anyone with access to the unlocked device/browser profile can read unsaved draft prose. **Alternative if rejected:** `sessionStorage`-only drafts — survives reload and re-login *within the same tab*, but not tab close or browser crash (which are the headline data-loss cases this plan exists to fix). This trade must be explicitly approved at plan review.
2. **IndexedDB, not localStorage.** localStorage is a synchronous, main-thread, string-only store with a ~5 MB per-origin quota shared with everything else; chapter TipTap trees can run to hundreds of KB and we persist on every dirty keystroke — synchronous `JSON.stringify` + write would jank typing. IndexedDB is async, structured-clone (no stringify needed for storage), and has effectively unbounded quota for this use.
3. **Restore rule:** the banner is offered only when the draft's `baseUpdatedAt` **equals** the server's current `updatedAt` (server hasn't moved → the draft's edits are provably unsaved). If the server moved past the draft (our keepalive flush landed, or another device won), the stale draft is silently deleted. Residual case: another writer overwrote between our draft and our next load — that draft is discarded (last-writer semantics at load time); the live two-tab version of this race is what Task 3's 409 conflict path handles.
4. **Unload network flush is best-effort and size-capped.** `sendBeacon` cannot issue PATCH (POST-only per spec/MDN); adding a POST alias endpoint just for unload was rejected (new mutating surface on the CSRF-sensitive perimeter + a second write path into the narrative repo). `fetch` with `keepalive: true` supports PATCH and sends the session cookie (`credentials: 'include'`; same-origin PATCH always carries `Origin`, satisfying `origin-check.middleware.ts`), but the spec caps keepalive bodies at 64 KiB — larger chapters skip the network flush and rely on the local draft (which is the guaranteed layer regardless).
5. **Drafts intentionally survive logout and session expiry** (that is the feature). They are keyed by `userId`, so a second account on the same browser never sees another user's draft offered — but the bytes are readable in devtools (see decision 1).

## Global Constraints

- TypeScript strict mode — no `any`. Shared schemas are the wire contract: both sides import from `story-editor-shared`; backend egress goes through `respond()` with the Zod response schema.
- Design-lint guard (`frontend/scripts/lint-design.mjs`) enforces token-only styling in `frontend/src/` — model new banners on `InlineErrorBanner.tsx` / `UndoToast.tsx` (`--danger`, `bg-bg-elevated`, `border-line-2`, `rounded-[var(--radius)]`).
- Frontend tests live under `frontend/tests/` mirroring source, jsdom, fake timers for debounce (extend `frontend/tests/components/Autosave.test.tsx` — do not duplicate its harness). Backend tests are real integration tests: supertest against `app`, real test DB, narrative reads through the repo layer (`makeFakeReq` pattern from `backend/tests/routes/chapters.test.ts:61-67`). Run `npm -w story-editor-backend run db:test:reset` before a full backend suite; backend tests require the dev stack (`make dev`) up.
- The encryption leak test ([E12], `backend/tests/security/encryption-leak.test.ts`) must pass before merging Task 3 — no schema or narrative-column change is made, but the repo update path is touched.
- New dev dependency (Task 1 only): `fake-indexeddb` — jsdom does not implement IndexedDB. Current stable checked 2026-07-02 via `npm view fake-indexeddb version` → **6.2.5**; pin `^6.2.5`. No runtime dependency is added (`idb`@8.0.3 was considered and rejected — one object store with put/get/delete does not warrant a wrapper lib).
- Commit format `[<bd-id>] description`; one commit per passing task step-group; never commit to `main`.
- Verify: `npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix frontend run test -- chapterDrafts Autosave useChapterDraft UnloadFlush ConflictBanner DraftRestoreBanner && npm -w story-editor-backend run test -- tests/routes/chapters tests/security/encryption-leak && node frontend/scripts/lint-design.mjs`

---

### Task 1: Local chapter-draft persistence + restore banner

**Root cause:** `useAutosave` (`frontend/src/hooks/useAutosave.ts:45`) debounces 4000ms; nothing persists the dirty payload anywhere. The chapter-switch flush is fire-and-forget — `void pendingSave(pendingPayload).catch(() => {})` (`useAutosave.ts:108-123`) with a comment openly admitting "the typed text is gone either way". A terminal 401 (`frontend/src/lib/api.ts:178-186` → `handleUnauthorizedAccess`, `frontend/src/store/session.ts:69-80`) clears all client state and routes to /login, discarding whatever the failed flush carried. There are zero `beforeunload`/`pagehide`/`visibilitychange` handlers in `frontend/src/`.

**Fix:** A small IndexedDB module (`chapterDrafts.ts`) + two new optional `useAutosave` callbacks (`onDirty(payload)` on every dirty change, `onSaved(payload)` on a confirmed save with no newer pending edit) + a `useChapterDraft` hook that owns persist/delete/restore-decision, wired into EditorPage with a `DraftRestoreBanner`.

**Files:**
- Create: `frontend/src/lib/chapterDrafts.ts` (IndexedDB store + `resolveDraftDecision` pure helper)
- Modify: `frontend/src/hooks/useAutosave.ts` (add `onDirty` / `onSaved` options)
- Create: `frontend/src/hooks/useChapterDraft.ts`
- Create: `frontend/src/components/DraftRestoreBanner.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx` (wire callbacks, banner, restore-remount)
- Modify: `frontend/package.json` (devDependency `fake-indexeddb@^6.2.5`; run `make rebuild-frontend` after)
- Test: `frontend/tests/lib/chapterDrafts.test.ts` (create), `frontend/tests/hooks/useChapterDraft.test.ts` (create), `frontend/tests/components/Autosave.test.tsx` (extend), `frontend/tests/components/DraftRestoreBanner.test.tsx` (create)

**Interfaces:**
- Produces (`chapterDrafts.ts`):
  ```ts
  export interface ChapterDraft {
    userId: string;
    chapterId: string;
    storyId: string;
    bodyJson: unknown;        // TipTap JSONContent tree (structured-clone stored)
    baseUpdatedAt: string;    // server chapter.updatedAt ISO the edit was made against
    savedAt: number;          // Date.now() of the local persist
  }
  export async function putDraft(draft: ChapterDraft): Promise<void>;
  export async function getDraft(userId: string, chapterId: string): Promise<ChapterDraft | null>;
  export async function deleteDraft(userId: string, chapterId: string): Promise<void>;
  export type DraftDecision = 'offer' | 'discard';
  export function resolveDraftDecision(draft: ChapterDraft, serverUpdatedAt: string): DraftDecision;
  ```
  DB `inkwell-drafts`, version 1, object store `chapterDrafts` with `keyPath: ['userId', 'chapterId']`. All functions swallow-and-warn on IDB unavailability (private-mode Firefox) — draft persistence degrades to nothing, autosave is unaffected.
- Produces (`useAutosave.ts` additions — both optional, both routed through refs like `saveRef`):
  ```ts
  /** Fired on every payload change that differs from the last-saved baseline
   *  (i.e. whenever a debounce is (re)scheduled, a follow-up is queued, or an
   *  edit lands during a retry wait). NOT fired for the baseline seed. */
  onDirty?: (payload: T) => void;
  /** Fired after a successful save IFF no newer edit is pending (the
   *  follow-up branch in runSave suppresses it — the newer edit re-fires
   *  onDirty and onSaved comes with ITS save). */
  onSaved?: (payload: T) => void;
  ```
- Produces (`useChapterDraft.ts`):
  ```ts
  export interface UseChapterDraftArgs {
    userId: string | null;
    storyId: string | null;
    chapterId: string | null;
    serverUpdatedAt: string | null;   // chapterQuery.data?.updatedAt ?? null
    serverLoaded: boolean;            // chapterQuery.data !== undefined
  }
  export interface UseChapterDraftResult {
    pendingDraft: ChapterDraft | null;              // non-null → render restore banner
    persistDraft: (bodyJson: unknown) => void;      // wire to useAutosave onDirty
    clearDraft: () => void;                         // wire to useAutosave onSaved
    acceptDraft: () => ChapterDraft | null;         // returns + clears banner state
    discardDraft: () => void;                       // deletes record + clears banner
  }
  ```
- Consumes: `useSessionStore((s) => s.user)` for `userId` (`frontend/src/store/session.ts:5-9`); `chapterQuery.data.updatedAt` (kept fresh by `useUpdateChapterMutation`'s `onSuccess` cache write, `frontend/src/hooks/useChapters.ts:302-313` — so `persistDraft` always reads the base version the edit was made against); Paper remount contract `key={activeChapterId}` / `initialBodyJson` (`frontend/src/pages/EditorPage.tsx:582,590`).

- [ ] **Step 1: Write failing tests for `chapterDrafts.ts`**

Add `fake-indexeddb@^6.2.5` to frontend devDependencies (`npm --prefix frontend install -D fake-indexeddb@^6.2.5`, then `make rebuild-frontend`). Create `frontend/tests/lib/chapterDrafts.test.ts` with `import 'fake-indexeddb/auto';` as the FIRST import (per-file, not global setup — other tests must not grow an IDB global). Cases:

```ts
it('round-trips a draft through put/get', async () => { /* putDraft → getDraft returns deep-equal record */ });
it('returns null for a missing draft and isolates by userId', async () => {
  // putDraft for user-a/ch-1; getDraft('user-b','ch-1') === null
});
it('deleteDraft removes the record', async () => { /* put → delete → get === null */ });

describe('resolveDraftDecision', () => {
  it("offers when the server hasn't moved since the draft", () => {
    expect(resolveDraftDecision(draft({ baseUpdatedAt: T1 }), T1)).toBe('offer');
  });
  it('discards when the server moved past the draft (flush landed / other writer)', () => {
    expect(resolveDraftDecision(draft({ baseUpdatedAt: T1 }), T2_LATER)).toBe('discard');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix frontend run test -- chapterDrafts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `chapterDrafts.ts`**

Hand-rolled minimal promise wrapper (open DB once, memoize the promise; `onupgradeneeded` creates the store). `resolveDraftDecision` is pure:

```ts
export function resolveDraftDecision(draft: ChapterDraft, serverUpdatedAt: string): DraftDecision {
  return draft.baseUpdatedAt === serverUpdatedAt ? 'offer' : 'discard';
}
```

Run: `npm --prefix frontend run test -- chapterDrafts` — expected PASS.

- [ ] **Step 4: Write failing tests for the `useAutosave` `onDirty` / `onSaved` contract**

Extend `frontend/tests/components/Autosave.test.tsx` — reuse the existing `Harness`/`advance`/`clickButton` helpers (add `onDirty`/`onSaved` props to `Harness`, threaded into the hook options). Cases:

```ts
it('does not fire onDirty for the initial baseline payload', ...);
it('fires onDirty with the payload on each dirty change', ...);      // EditA → onDirty('fixed-A') before the debounce elapses
it('fires onSaved with the saved payload after a successful save', ...);
it('suppresses onSaved when an edit arrived during the in-flight save, then fires it after the follow-up save', ...);
// reuse the deferred-promise pattern from the existing 'queues a follow-up save' test (lines 180-219)
```

Run: `npm --prefix frontend run test -- Autosave` — expected FAIL (unknown options ignored / callbacks never fire).

- [ ] **Step 5: Implement the `useAutosave` additions**

In `frontend/src/hooks/useAutosave.ts`: add `onDirty`/`onSaved` to `UseAutosaveOptions`, mirror the `saveRef` ref pattern (`useAutosave.ts:52-54,74-82`). Call `onDirtyRef.current?.(payload)` in the payload effect after the baseline/no-change guards (`useAutosave.ts:255-283`) — i.e. once per change that reaches the `savingRef` / retry / `scheduleDebouncedSave` branches. Call `onSavedRef.current?.(payloadToSave)` in `runSave`'s success path (`useAutosave.ts:175-203`) **only** in the `else` branch where no follow-up is scheduled. Do not touch the failure path — a failed save keeps the draft, which is the point.

Run: `npm --prefix frontend run test -- Autosave` — expected PASS (all existing cases still green).

- [ ] **Step 6: Write failing tests for `useChapterDraft`, implement, pass**

Create `frontend/tests/hooks/useChapterDraft.test.ts` (`import 'fake-indexeddb/auto';` first, `renderHook` from Testing Library). Cases: (1) `persistDraft` writes a record carrying the current `serverUpdatedAt` as `baseUpdatedAt`; (2) `clearDraft` deletes it; (3) on mount with `serverLoaded` and a draft whose `baseUpdatedAt === serverUpdatedAt`, `pendingDraft` becomes non-null; (4) with a stale draft, `pendingDraft` stays null AND the record is deleted; (5) `acceptDraft`/`discardDraft` clear the banner state (and discard deletes). Implement `frontend/src/hooks/useChapterDraft.ts`: the load-decision effect keys on `(userId, chapterId, serverLoaded)` and must ignore a late IDB resolve after the chapter switched (compare against a ref of the current chapterId — same guard style as EditorPage's `seededForChapterIdRef`, `EditorPage.tsx:208-221`). No-op everything when `userId`/`chapterId` is null.

Run: `npm --prefix frontend run test -- useChapterDraft` — expected PASS.

- [ ] **Step 7: `DraftRestoreBanner` — failing test, implement, pass**

Create `frontend/tests/components/DraftRestoreBanner.test.tsx`: renders draft age text, fires `onRestore` / `onDiscard`. Implement `frontend/src/components/DraftRestoreBanner.tsx` modeled on `InlineErrorBanner.tsx` (role="status" — informational, not an error; `data-testid="draft-restore-banner"`; token-only classes; two buttons "Restore draft" / "Discard"). Copy: `Unsaved draft from <time> found on this device.` Include the shortcut-contract note: no new global key handling (Escape stays owned by the existing listener).

Run: `npm --prefix frontend run test -- DraftRestoreBanner && node frontend/scripts/lint-design.mjs` — expected PASS.

- [ ] **Step 8: Wire into EditorPage**

In `frontend/src/pages/EditorPage.tsx`:

```tsx
const user = useSessionStore((s) => s.user);
const draft = useChapterDraft({
  userId: user?.id ?? null,
  storyId: story?.id ?? null,
  chapterId: activeChapterId,
  serverUpdatedAt: chapterQuery.data?.updatedAt ?? null,
  serverLoaded: chapterQuery.data !== undefined,
});

const autosave = useAutosave<JSONContent>({
  payload: draftBodyJson,
  save: handleSave,
  resetKey: activeChapterId,          // existing (line 247)
  onDirty: draft.persistDraft,        // NEW — persists plaintext draft locally (see plan §Design decisions 1)
  onSaved: draft.clearDraft,          // NEW — confirmed save deletes the draft
});
```

Restore-remount: add `const [restoreSeed, setRestoreSeed] = useState<{ nonce: number; bodyJson: JSONContent } | null>(null);`, cleared by an effect on `activeChapterId` change. Change the Paper mount (lines 582, 590):

```tsx
key={restoreSeed !== null ? `${activeChapterId}:r${restoreSeed.nonce}` : activeChapterId}
initialBodyJson={restoreSeed?.bodyJson ?? ((chapterQuery.data?.bodyJson as JSONContent | null) ?? null)}
```

Render the banner above Paper (inside the `activeChapterId ?` branch at line 574) when `draft.pendingDraft !== null`. Restore handler: `const d = draft.acceptDraft(); if (d) { setRestoreSeed({ nonce: Date.now(), bodyJson: d.bodyJson as JSONContent }); setDraftBodyJson(d.bodyJson as JSONContent); }` — the `setDraftBodyJson` makes autosave see a dirty change vs the server baseline and schedule the PATCH that re-saves the restored text (and, on success, `onSaved` deletes the draft). Discard handler: `draft.discardDraft()`.

> Note for implementer: keep EditorPage glue thin — behavior is pinned by the `chapterDrafts` / `useChapterDraft` / `Autosave` unit tests; do not add an EditorPage-level integration test (the page is heavy in jsdom — same call as the 2026-06-25 plan, Task 1 Step 5 note).

- [ ] **Step 9: Full frontend verify**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- chapterDrafts Autosave useChapterDraft DraftRestoreBanner && node frontend/scripts/lint-design.mjs`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
  frontend/src/lib/chapterDrafts.ts frontend/src/hooks/useAutosave.ts \
  frontend/src/hooks/useChapterDraft.ts frontend/src/components/DraftRestoreBanner.tsx \
  frontend/src/pages/EditorPage.tsx \
  frontend/tests/lib/chapterDrafts.test.ts frontend/tests/hooks/useChapterDraft.test.ts \
  frontend/tests/components/Autosave.test.tsx frontend/tests/components/DraftRestoreBanner.test.tsx
git commit -m "[<bd-id>] editor: persist dirty chapter drafts to IndexedDB + restore banner"
```

---

### Task 2: Unload / visibility flush

**Root cause:** Zero `pagehide`/`visibilitychange`/`beforeunload` handlers exist in `frontend/src/` (verified by grep). Closing the tab, navigating away, or a mobile tab discard inside the 4s debounce window (`useAutosave.ts:45`) drops the pending payload entirely — nothing even attempts a send.

**Fix:** Because Task 1 persists the draft on every dirty change, the local layer is already covered by keystroke time — no racy async IDB write inside the unload handler is needed. Task 2 adds the *network* half: on `pagehide` and on `visibilitychange → 'hidden'`, fire a best-effort `fetch(PATCH, { keepalive: true, credentials: 'include' })` with the pending payload when its UTF-8 size fits the keepalive quota. **Capability facts (looked up, MDN `/mdn/content` — Beacon API + RequestInit):** `sendBeacon` queues a **POST** only and cannot use another method; `fetch` with `keepalive: true` supports arbitrary methods incl. PATCH, keeps running after unload, and caps the body at **64 KiB**. Our endpoint is `PATCH /api/stories/:storyId/chapters/:chapterId` behind cookie auth + the default-deny Origin check (`backend/src/middleware/origin-check.middleware.ts:28-55`) — a same-origin PATCH carries both the cookie and `Origin`, so keepalive-fetch works with zero backend change; sendBeacon would require a new POST alias route (rejected — see Design decisions 4).

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `apiKeepalivePatch` — the only sanctioned raw-`fetch` writer besides `doRequest`/`fetchExportBlob`)
- Create: `frontend/src/hooks/useUnloadFlush.ts`
- Modify: `frontend/src/hooks/useAutosave.ts` (expose `getPendingPayload`)
- Modify: `frontend/src/pages/EditorPage.tsx` (wire the hook)
- Test: `frontend/tests/hooks/useUnloadFlush.test.ts` (create), `frontend/tests/components/Autosave.test.tsx` (extend)

**Interfaces:**
- Produces (`api.ts`):
  ```ts
  export const KEEPALIVE_MAX_BYTES = 60_000; // headroom under the 64 KiB keepalive quota
  /** Fire-and-forget PATCH that outlives the page (fetch keepalive). Returns
   *  false without sending when the JSON body exceeds KEEPALIVE_MAX_BYTES
   *  (spec quota) — callers fall back to the local draft. Never throws. */
  export function apiKeepalivePatch(path: string, body: object): boolean;
  ```
  Implementation: `JSON.stringify`, measure real bytes via `new TextEncoder().encode(json).length`, then `void fetch(buildUrl(path), { method: 'PATCH', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => {});`. Deliberately bypasses `doRequest` — there is no response handling and no 401 flow at unload time.
- Produces (`useAutosave.ts` addition to `UseAutosaveResult`):
  ```ts
  /** Latest payload if it differs from the last successfully-saved one (or a
   *  save is in flight for it), else null. Stable identity (reads refs). */
  getPendingPayload: () => T | null;
  ```
- Produces (`useUnloadFlush.ts`):
  ```ts
  export interface UnloadFlushArgs { storyId: string; chapterId: string; bodyJson: unknown }
  /** Attaches pagehide + visibilitychange('hidden') listeners; calls getPending
   *  and fires apiKeepalivePatch. Dedupes: the same serialized body is flushed
   *  at most once per hidden-transition (visibilitychange then pagehide both fire). */
  export function useUnloadFlush(getPending: () => UnloadFlushArgs | null): void;
  ```
- Consumes: `autosave.getPendingPayload`, `story.id`, `activeChapterId` in EditorPage. Uses `pagehide` + `visibilitychange`, NOT `beforeunload` (unreliable on mobile, breaks bfcache).

- [ ] **Step 1: Failing test for `getPendingPayload`**

Extend `frontend/tests/components/Autosave.test.tsx` (expose the function from the harness via a ref or render-prop):

```ts
it('getPendingPayload returns the dirty payload during the debounce window and null after a confirmed save', async () => {
  // baseline → null; EditA → 'fixed-A'; advance(DEBOUNCE_MS) + settle → null
});
```

Run: `npm --prefix frontend run test -- Autosave` — expected FAIL.

- [ ] **Step 2: Implement `getPendingPayload`**

In `useAutosave.ts`, a `useCallback` over the existing refs: return `latestPayloadRef.current` when it is non-null AND (`lastSavedPayloadRef.current === null` after a dirty edit, or `!equalsRef.current(latest, lastSaved)`, or `savingRef.current`); else `null`. Baseline-only state returns null. Run the test — expected PASS.

- [ ] **Step 3: Failing tests for `useUnloadFlush` + `apiKeepalivePatch`**

Create `frontend/tests/hooks/useUnloadFlush.test.ts`. Stub fetch with `vi.stubGlobal('fetch', fetchMock)`. Drive visibility via `Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })` + `document.dispatchEvent(new Event('visibilitychange'))`, and `window.dispatchEvent(new Event('pagehide'))` (plain `Event` — jsdom has no `PageTransitionEvent`). Cases:

```ts
it('fires a keepalive PATCH with credentials on pagehide when a payload is pending', ...);
// assert fetchMock called once with url containing /stories/s1/chapters/c1,
// init.method === 'PATCH', init.keepalive === true, init.credentials === 'include'
it('does nothing when getPending returns null', ...);
it('skips the network flush when the body exceeds KEEPALIVE_MAX_BYTES', ...);
// bodyJson containing a > 60k-char string → fetch not called, apiKeepalivePatch returns false
it('dedupes visibilitychange-hidden followed by pagehide (single fetch)', ...);
it('removes listeners on unmount', ...);
```

Run: `npm --prefix frontend run test -- UnloadFlush` — expected FAIL.

- [ ] **Step 4: Implement `apiKeepalivePatch` + `useUnloadFlush`**

As specified in Interfaces. The hook keeps the latest `getPending` in a ref (listener registered once); dedupe via a `lastFlushedBodyRef: string | null` reset whenever `getPending()` yields a different serialization. Run the tests — expected PASS.

- [ ] **Step 5: Wire into EditorPage**

```tsx
useUnloadFlush(
  useCallback(() => {
    const pending = autosave.getPendingPayload();
    if (pending === null || !story?.id || activeChapterId === null) return null;
    return { storyId: story.id, chapterId: activeChapterId, bodyJson: pending };
  }, [autosave.getPendingPayload, story?.id, activeChapterId]),
);
```

> Note for implementer: do not mark the payload saved after a keepalive flush — the response is never observed. If the page survives (tab re-shown), the normal debounce/retry re-PATCHes the same body; the PATCH is idempotent, and after Task 3 it carries `expectedUpdatedAt` — a keepalive flush that landed will make the follow-up 409, which the Task 3 banner handles as a genuine (self-)conflict; acceptable and rare (hidden→shown with the flush having raced ahead). Call this out in the code comment.

- [ ] **Step 6: Verify + commit**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- Autosave UnloadFlush && node frontend/scripts/lint-design.mjs`
Expected: all PASS.

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useUnloadFlush.ts \
  frontend/src/hooks/useAutosave.ts frontend/src/pages/EditorPage.tsx \
  frontend/tests/hooks/useUnloadFlush.test.ts frontend/tests/components/Autosave.test.tsx
git commit -m "[<bd-id>] editor: best-effort keepalive PATCH flush on pagehide/visibility-hidden"
```

---

### Task 3: Optimistic-concurrency precondition on chapter PATCH

**Root cause:** `PATCH /api/stories/:storyId/chapters/:chapterId` (`backend/src/routes/chapters.routes.ts:188-218`) does existence-check → `createChapterRepo(req).update(chapterId, input)`; the repo update (`backend/src/repos/chapter.repo.ts:210-250`) runs `client.chapter.updateMany({ where: { id, story: { userId } }, data })` (lines 239-243) with **no version/updatedAt precondition**. Two tabs autosaving the same chapter silently clobber each other, and because bodies are stored as AES-GCM ciphertext there is no server-side recovery of the losing write.

**Fix:** Optional `expectedUpdatedAt` (ISO datetime) on the shared `chapterUpdateSchema`; when present, the repo's `updateMany` where-clause gains `updatedAt: expectedUpdatedAt` — `count === 0` is then disambiguated (row exists → version conflict; row gone → 404) and the conflict surfaces as 409 `{ error: { code: 'conflict' } }`. Frontend autosave sends the last-seen server `updatedAt`, and on 409 stops autosaving (payload → null), keeps the local draft (Task 1 already persisted it), and shows a conflict banner with Reload / Overwrite. Timestamp echo is exact: Prisma `DateTime` is `timestamp(3)` (ms), `serializeChapter` emits `.toISOString()` (ms), so `new Date(expectedUpdatedAt)` round-trips to the stored value bit-for-bit — no epsilon comparison needed. `expectedUpdatedAt` stays optional so old clients, the import path, and the summary/title write paths keep working unchanged.

**Files:**
- Modify: `shared/src/schemas/chapter.ts` (`chapterUpdateSchema`, lines 90-95)
- Modify: `backend/src/repos/chapter.repo.ts` (`update` opts + `ChapterVersionConflictError`)
- Modify: `backend/src/routes/chapters.routes.ts` (PATCH handler, lines 188-218)
- Modify: `frontend/src/hooks/useChapters.ts` (add `isChapterConflictError`)
- Create: `frontend/src/components/ChapterConflictBanner.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx` (send precondition, 409 handling)
- Test: `backend/tests/routes/chapters.concurrency.test.ts` (create), `frontend/tests/hooks/useChapters.test.ts` (create or extend), `frontend/tests/components/ChapterConflictBanner.test.tsx` (create)

**Interfaces:**
- Produces (shared — the wire contract; both sides re-import):
  ```ts
  export const chapterUpdateSchema = z.strictObject({
    title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX).optional(),
    bodyJson: z.unknown().optional(),
    status: chapterStatusSchema.optional(),
    orderIndex: z.number().int().nonnegative().optional(),
    // Optimistic-concurrency precondition: the chapter's updatedAt the client
    // last saw. When present and stale, the PATCH is rejected 409 'conflict'.
    // Optional — absent keeps legacy last-write-wins (old clients, import).
    expectedUpdatedAt: z.string().datetime().optional(),
  });
  ```
  (`z.string().datetime()` matches this file's existing convention, lines 28/64-65.)
- Produces (repo): `update(id: string, input: RepoChapterUpdateInput, opts?: { expectedUpdatedAt?: Date })`; new `export class ChapterVersionConflictError extends Error` (mirrors `ChapterNotOwnedError`, `chapter.repo.ts:92-97`). `expectedUpdatedAt` is NOT a member of `RepoChapterUpdateInput` — it must never be spread into `data`.
- Produces (route): 409 body `{ error: { message: 'Chapter was modified elsewhere', code: 'conflict' } }` — first use of the bare `conflict` code (409s exist today only for `venice_key_required` / username collision, `auth.routes.ts:157`).
- Produces (frontend): `export function isChapterConflictError(err: unknown): boolean` (`err instanceof ApiError && err.status === 409 && err.code === 'conflict'`); `ChapterConflictBanner({ onReload, onOverwrite, busy? })`.
- Consumes: `ApiError` (`frontend/src/lib/api.ts:60-72`); `useUpdateChapterMutation` input type widens automatically via the shared `ChapterUpdateInput`.

- [ ] **Step 1: Shared schema change + typecheck**

Apply the schema edit above. Run: `npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck` — expected PASS (field is optional; nothing consumes it yet).

- [ ] **Step 2: Write failing backend integration tests**

Create `backend/tests/routes/chapters.concurrency.test.ts` following `chapters.test.ts` conventions exactly (`registerAndLogin`, `TEST_ORIGIN`, `makeFakeReq`, `resetAll`, `paragraphDoc`, repo-layer reads — never raw Prisma against narrative columns). Requires the dev stack up. Cases:

```ts
it('PATCH with matching expectedUpdatedAt succeeds and returns the new updatedAt', async () => {
  // create via POST; PATCH { bodyJson, expectedUpdatedAt: created.updatedAt } → 200;
  // res.body.chapter.updatedAt !== created.updatedAt; repo findById shows new body
});
it('PATCH with stale expectedUpdatedAt returns 409 conflict and does not write', async () => {
  // create; PATCH#1 (no precondition) bumps updatedAt; PATCH#2 with the ORIGINAL
  // updatedAt → 409, body.error.code === 'conflict';
  // createChapterRepo(makeFakeReq(sessionId)).findById(...) still shows PATCH#1's body
});
it('PATCH without expectedUpdatedAt keeps last-write-wins (back-compat)', async () => {
  // two sequential precondition-less PATCHes both 200
});
it('PATCH with expectedUpdatedAt on a chapter deleted mid-flight returns 404, not 409', async () => {
  // delete via repo/route after reading updatedAt; PATCH → 404 not_found
  // (route's ownChapter middleware may 403/404 first — pin whichever the stack
  //  actually produces for a deleted-own-chapter; the invariant under test is "not 409")
});
it('response never contains ciphertext keys on the 409 path', async () => {
  assertNoCiphertextKeys(res.body);   // reuse helper pattern from chapters.test.ts:94-100
});
```

Run: `npm -w story-editor-backend run test -- tests/routes/chapters.concurrency` — expected FAIL (precondition ignored → the stale PATCH succeeds).

- [ ] **Step 3: Implement repo + route**

`chapter.repo.ts` `update` (around lines 239-243):

```ts
const updated = await client.chapter.updateMany({
  where: {
    id,
    story: { userId },
    ...(opts?.expectedUpdatedAt !== undefined ? { updatedAt: opts.expectedUpdatedAt } : {}),
  },
  data,
});
if (updated.count === 0) {
  if (opts?.expectedUpdatedAt !== undefined) {
    const exists = await client.chapter.findFirst({ where: { id, story: { userId } }, select: { id: true } });
    if (exists) throw new ChapterVersionConflictError();
  }
  return null;   // not-found / not-owned — routes keep mapping this to 404
}
```

`chapters.routes.ts` PATCH (lines 188-218): keep the existing input building; do not copy `expectedUpdatedAt` into `input`; wrap the update:

```ts
let chapter: Awaited<ReturnType<ReturnType<typeof createChapterRepo>['update']>>;
try {
  chapter = await createChapterRepo(req).update(chapterId, input,
    body.expectedUpdatedAt !== undefined
      ? { expectedUpdatedAt: new Date(body.expectedUpdatedAt) }
      : undefined);
} catch (err) {
  if (err instanceof ChapterVersionConflictError) {
    res.status(409).json({ error: { message: 'Chapter was modified elsewhere', code: 'conflict' } });
    return;
  }
  throw err;
}
```

The summary PUT (`chapters.routes.ts:245-262`) and summarise POST keep calling `update` without opts — untouched behavior.

Run: `npm -w story-editor-backend run test -- tests/routes/chapters` (all chapter suites) and `npm -w story-editor-backend run test -- tests/security/encryption-leak` — expected PASS.

- [ ] **Step 4: Frontend — failing tests for `isChapterConflictError` + `ChapterConflictBanner`, implement, pass**

`isChapterConflictError` unit cases: ApiError(409,'conflict') → true; ApiError(409,'venice_key_required') → false; ApiError(400) → false; plain Error → false. Banner test: renders the message, fires `onReload`/`onOverwrite`, disables both while `busy`. Implement banner modeled on `InlineErrorBanner.tsx` (role="alert", danger tokens, `data-testid="chapter-conflict-banner"`), copy: `This chapter changed elsewhere. Reload it, or overwrite with your version.`

Run: `npm --prefix frontend run test -- useChapters ConflictBanner && node frontend/scripts/lint-design.mjs` — expected PASS.

- [ ] **Step 5: Wire the precondition + 409 handling into EditorPage**

- Track the last-seen server version: `const serverUpdatedAtRef = useRef<string | null>(null);` + effect syncing from `chapterQuery.data?.updatedAt` (the mutation's `onSuccess` cache write at `useChapters.ts:311` keeps this fresh after every save).
- `handleSave` (`EditorPage.tsx:223-237`): include `...(serverUpdatedAtRef.current !== null ? { expectedUpdatedAt: serverUpdatedAtRef.current } : {})` in `input`; wrap `mutateAsync` in try/catch — on `isChapterConflictError(err)`: `setConflict(true)` then rethrow (the rethrow lets `useAutosave` settle into `error` status; the draft was already persisted by `onDirty`).
- `const [conflict, setConflict] = useState(false);` — while `conflict`, pass `payload: null` to `useAutosave` (null payload makes the hook inert: `runSave` early-returns and no new debounce schedules, `useAutosave.ts:169-170,255`), stopping the one-shot retry from re-409ing. Reset `conflict` on `activeChapterId` change.
- Render `<ChapterConflictBanner/>` above Paper when `conflict`. **Reload:** `setConflict(false)`; `await chapterQuery.refetch()`; seed the fresh server body through the Task 1 `restoreSeed` remount path and `setDraftBodyJson(serverBody)`. The local draft record is intentionally left in IndexedDB (Task 1's stale rule discards it on the next load — the user chose the server version). **Overwrite:** `await updateChapter.mutateAsync({ storyId, chapterId, input: { bodyJson: draftBodyJson } })` — deliberately WITHOUT `expectedUpdatedAt` (explicit user-sanctioned last-write-wins); on success `setConflict(false)` (refs/caches refresh via `onSuccess`), on failure keep the banner.

> Note for implementer: behavior is pinned by the backend integration tests + the two frontend unit suites; EditorPage remains thin glue — no page-level jsdom test (same call as Tasks 1-2).

- [ ] **Step 6: Full verify (both sides)**

Run the Global Constraints `Verify:` line (dev stack up, `npm -w story-editor-backend run db:test:reset` first for the backend portion).
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/schemas/chapter.ts backend/src/repos/chapter.repo.ts \
  backend/src/routes/chapters.routes.ts backend/tests/routes/chapters.concurrency.test.ts \
  frontend/src/hooks/useChapters.ts frontend/src/components/ChapterConflictBanner.tsx \
  frontend/src/pages/EditorPage.tsx frontend/tests/hooks/useChapters.test.ts \
  frontend/tests/components/ChapterConflictBanner.test.tsx
git commit -m "[<bd-id>] chapters: optional expectedUpdatedAt precondition on PATCH → 409 conflict + client conflict banner"
```

---

## Self-Review notes

- **Audit coverage:** finding 1 (debounce-window loss, fire-and-forget switch flush `useAutosave.ts:108-123`, no unload handlers) → Tasks 1+2; finding 2 (terminal 401 discards the failed flush, `api.ts:178-186`) → Task 1 (drafts survive re-login; the crypto/session model is deliberately untouched); finding 3 (last-write-wins PATCH, `chapters.routes.ts:188-218` + `chapter.repo.ts:239-243`) → Task 3. Covered.
- **Capability claims verified, not remembered:** sendBeacon = POST-only / fetch keepalive = any method + 64 KiB body cap confirmed against MDN (`/mdn/content` via Context7 — direct MDN WebFetch was proxy-blocked); dependency versions checked 2026-07-02 via `npm view` (`fake-indexeddb` 6.2.5; `idb` 8.0.3, rejected as unnecessary).
- **Reviewer surface:** Task 3 touches `backend/src/repos/chapter.repo.ts` + `chapters.routes.ts` → `repo-boundary-reviewer` is in-lane and will be auto-dispatched by `/bd-close-reviewed`; the 409 body carries no narrative plaintext and no ciphertext triple (pinned by test). No auth/session/key surface is modified (Task 2's keepalive fetch is client-only), so `security-reviewer` dispatch is path-driven as usual.
- **Invariant checks:** `expectedUpdatedAt` is never spread into repo `data` (kept out of `RepoChapterUpdateInput`); `wordCount` continues to be computed route-side from plaintext before encryption (`chapters.routes.ts:206-209`, unchanged); [E12] leak test runs in the Task 3 verify; no Prisma schema change, no migration, no `.env` change.
- **Type consistency:** `ChapterDraft.baseUpdatedAt` (ISO string) ↔ `chapterMetaBase.updatedAt` (`z.string().datetime()`, `shared/src/schemas/chapter.ts:64-65`) ↔ repo `opts.expectedUpdatedAt: Date` (converted once, in the route). `onDirty`/`onSaved`/`getPendingPayload` signatures match across hook, tests, and EditorPage wiring.
- **Known residual gaps (accepted, documented):** (a) a stale draft whose server moved ahead is discarded at load (Design decisions 3) — the live version of that race is handled by Task 3's banner; (b) a keepalive flush that lands and then the tab is re-shown can produce a one-off self-conflict 409 (Task 2 Step 5 note); (c) IDB-unavailable environments degrade silently to today's behavior.
- **Open items for implementer:** pin the exact status code (403 vs 404) the middleware stack yields for the deleted-chapter precondition test (Task 3 Step 2) by reading `ownership.middleware.ts` at implementation time; reuse the existing `Autosave.test.tsx` harness rather than adding a second one.
- **User gates:** the plaintext-drafts-on-device trade (Design decisions 1) and the drafts-survive-logout stance (Design decisions 5) require explicit sign-off at plan review before `/bd-execute`.
