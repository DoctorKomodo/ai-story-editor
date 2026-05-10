# Cross-Account Session Reset (story-editor-7lo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the cross-account data leak in the frontend client. After every auth transition (login, logout, sign-out-everywhere, delete-account), the TanStack Query cache must be empty AND all per-user Zustand stores must be at their initial state — no manual browser refresh needed.

**Architecture:** Centralized `resetClientState(queryClient)` helper at `frontend/src/lib/sessionReset.ts`. Imports each per-user Zustand store, calls its reset, calls `queryClient.clear()`. Every auth-transition call site invokes the helper as part of the transition. The helper is the single rule; sites that change auth state without calling it become the bug.

**Tech Stack:** React + TypeScript + TanStack Query + Zustand + Vitest. No new dependencies.

---

## File map

**Create:**
- `frontend/src/lib/sessionReset.ts` — the helper.
- `frontend/tests/lib/sessionReset.test.ts` — unit tests per store reset + cache-clear assertion.
- `frontend/tests/hooks/useAuth.session-reset.test.ts` — integration test: login as A populates state → logout/login-as-B → state empty for B.

**Modify:**
- `frontend/src/hooks/useAuth.ts` — `login()` calls `swapSession`; `logout()` calls `resetClientState` then `clearSession`.
- `frontend/src/hooks/useAccount.ts` — `useSignOutEverywhereMutation.onSuccess` and `useDeleteAccountMutation.onSuccess` invoke the helper (the latter currently calls `queryClient.clear()` directly; switch to the helper for symmetry).
- `frontend/src/store/session.ts` — `handleUnauthorizedAccess` invokes the registered-QC variant before flipping the auth slice.
- `frontend/src/main.tsx` (or whichever module owns `QueryClientProvider`) — calls `registerSessionResetQueryClient(queryClient)` at app boot.
- `docs/agent-rules/frontend.md` — adds the per-user-state-must-reset rule so future implementer/reviewer dispatches see it.

---

## Storage-surface audit

The helper covers two surfaces: the TanStack Query cache and the listed Zustand stores. No other per-user state surface is in use today:

- **`localStorage` / `sessionStorage`:** the JWT is in-memory only (Zustand `session` slice, never persisted) per `docs/agent-rules/frontend.md` "Forbidden". No other code path writes user data here. Confirmed via `grep -rEn "localStorage|sessionStorage" frontend/src` returning no application writes.
- **Zustand `persist` middleware:** none of the listed stores use it. Confirmed via `grep -rEn "persist\(" frontend/src/store` returning nothing. **Gotcha for future authors:** if you add a store that uses `persist`, `setState({...initial})` does NOT clear the mirrored localStorage entry — call `useFooStore.persist.clearStorage()` from `resetClientState` in addition. The helper's docstring repeats this so the next author sees it.
- **IndexedDB:** not used by the app, by TipTap's current configuration, or by any TanStack Query persister.
- **Service Worker caches:** none registered.
- **TipTap collaborative state:** the editor uses local-only state; no Yjs / collab providers are active.
- **Web Workers:** none.

If a future change introduces any of these surfaces, the helper grows to cover it; the agent-rules digest in Task 8 names these surfaces explicitly so an implementer touching them sees the rule at dispatch time.

---

## Why a centralized helper rather than inline `queryClient.clear()` calls

The asymmetry that produced this bug — three of four auth-transition sites missing the cache clear, one having it — is exactly the failure mode that "single source of truth" prevents. Every call site that mutates session state must invoke the helper. The helper is also the only place that knows which Zustand stores are per-user (vs UI-only like `ui.layout`); putting that list inline at four sites is a maintenance trap.

A reasonable alternative — making `resetClientState` a method on the session store and injecting QueryClient at app boot — adds plumbing without removing call sites (every login/logout/etc. still has to dispatch the action). The helper-function form keeps session.ts decoupled from QueryClient (which matters because `handleUnauthorizedAccess` is called from a non-React, non-component context).

## Per-user vs UI-only state — what the helper resets

**Per-user (must reset):**
- TanStack Query cache (server state — stories, chapters, characters, outline, chats, messages, user-settings, models, etc.)
- `attachedSelection` — plaintext chapter-selection text
- `inlineAIResult` — plaintext selection + AI output
- `composerDraft` — chat composer draft (plaintext)
- `chatDraft` — in-flight chat turns + accumulating assistant text (plaintext)
- `selection` — TipTap selection text (plaintext)
- `activeChapter` — chapter ID referencing user A
- `selectedCharacter` — character ID referencing user A
- `charRefSuggestion` — suggestions surfaced from user A's characters
- `errors` — error queue may contain plaintext from user A's error messages

**UI-only (do NOT reset):**
- `ui.layout` — pure UI preference, not user-specific
- `sidebarTab` — per-tab UI state
- `session` itself — that's the auth slice; the caller manages it (`setSession` for login, `clearSession` for logout)

If a future store is added that holds per-user state, it must be added to the helper. Tests in Task 1 enumerate the current set so a missed addition fails loudly.

---

### Task 0.5: refactor every per-user store to expose `initialState` + `reset()`

**Files:**
- Modify: each per-user store under `frontend/src/store/`:
  - `attachedSelection.ts`
  - `inlineAIResult.ts`
  - `composerDraft.ts`
  - `chatDraft.ts`
  - `selection.ts`
  - `activeChapter.ts`
  - `selectedCharacter.ts`
  - `charRefSuggestion.ts` (already half-done — has `INITIAL`; rename to `initialState`, delete the redundant `resetCharRefSuggestionStore` export)
  - `errors.ts`
- Modify or create: per-store test file under `frontend/tests/store/<storeName>.test.ts` for each.

**Why this comes first:** the helper in Task 1 wants to iterate a list of per-user stores and call `reset()` on each. Today, each store encodes its initial-state shape in its `create()` body; an earlier draft of the helper duplicated those shapes inline; per-store tests would assert against them again. Three places per store, drift hazard for every field. Doing the convention sweep first means Task 1's helper has zero shape knowledge.

**The convention:**

```ts
const initialState = { /* data fields only, no actions */ };

export const useFooStore = create<FooState>((set) => ({
  ...initialState,
  someAction: ...,
  reset: () => set(initialState),
}));
```

Each store ends up with one source of truth for its initial state.

**Operational methods stay.** Keep `chatDraft.clear(chatId)` (per-id, real API), `errors.dismiss(id)` / `errors.push(entry)` / `errors.clear()`, `composerDraft.setDraft` / `requestFocus` / `clearDraft` (note: `clearDraft` only clears `draft`, NOT `focusToken` — that's its established narrow scope, see footgun note below). The new `reset()` is the full-reset action; the operational methods are the narrower mutations.

**Footgun note: `composerDraft.clearDraft` is misleadingly named** — it only clears the `draft` field, not `focusToken`. The helper from Task 1 calls `reset()`, so future logout paths are safe. But a code path that calls `clearDraft()` thinking it's a full reset would leak `focusToken`. Add a one-line JSDoc on `clearDraft` flagging the narrow scope. (Renaming `clearDraft` to `consumeDraft` matches the docstring's "the composer prepends the draft to its internal value and calls clearDraft()" pattern and would close the footgun, but is out of scope for this PR — file as a follow-up.)

**Concrete recipe (worked example — `composerDraft.ts`):**

Before:

```ts
export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  draft: null,
  focusToken: 0,
  setDraft: (draft) => set({ draft }),
  requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
  clearDraft: () => set({ draft: null }),
}));
```

After:

```ts
const initialState: { draft: string | null; focusToken: number } = {
  draft: null,
  focusToken: 0,
};

export interface ComposerDraftState {
  draft: string | null;
  focusToken: number;
  setDraft: (draft: string) => void;
  requestFocus: () => void;
  /** Clears `draft` only — does NOT reset `focusToken`. Use `reset()` for full reset. */
  clearDraft: () => void;
  reset: () => void;
}

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  ...initialState,
  setDraft: (draft) => set({ draft }),
  requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
  clearDraft: () => set({ draft: null }),
  reset: () => set(initialState),
}));
```

Apply the same shape to each store. Per-store specifics:

- **`attachedSelection.ts`:** `initialState = { attachedSelection: null }`. Existing `clear` action stays (it's already a full reset for this single-field store) but consider it an alias for `reset` — both are fine.
- **`inlineAIResult.ts`:** `initialState = { inlineAIResult: null }`. Same — `clear` stays, `reset` added.
- **`chatDraft.ts`:** `initialState = { drafts: {} as Record<string, ChatDraft> }`. The existing per-id `clear(chatId)` stays.
- **`selection.ts`:** `initialState = { selection: null }`. Same as attachedSelection.
- **`activeChapter.ts`:** `initialState = { activeChapterId: null as string | null }`. Add a `reset` method.
- **`selectedCharacter.ts`:** `initialState = { selectedCharacterId: null as string | null }`. Add a `reset` method.
- **`charRefSuggestion.ts`:** Rename `INITIAL` → `initialState`. Add `reset: () => set(initialState)` to the `CharRefSuggestionState` interface and `create()` body. Delete the standalone `export function resetCharRefSuggestionStore()` at the bottom of the file (callers can use `useCharRefSuggestionStore.getState().reset()`). Run `grep -rEn "resetCharRefSuggestionStore" frontend/src` first to find any callers and update them.
- **`errors.ts`:** `initialState = { errors: [] as AppError[] }`. The existing `clear()` stays — it does the same thing as `reset` does for this store. Either keep both or alias `reset = clear`.

**Steps:**

- [ ] **Step 1: refactor each store**

For each of the 9 stores, apply the recipe. Edit the `create()` body to spread `initialState`, declare the `initialState` const above it, add `reset: () => void` to the state interface and `reset: () => set(initialState)` to the `create()` body.

- [ ] **Step 2: find and update callers of removed exports**

Run: `grep -rEn "resetCharRefSuggestionStore" frontend/src`
If any callers exist, replace with `useCharRefSuggestionStore.getState().reset()`.

- [ ] **Step 3: add per-store reset tests**

For each store, append to its existing test file (or create `frontend/tests/store/<storeName>.test.ts`) a test asserting `reset()` returns the data fields to `initialState`. Example for `composerDraft`:

```ts
import { describe, expect, it } from 'vitest';
import { useComposerDraftStore } from '@/store/composerDraft';

describe('useComposerDraftStore.reset', () => {
  it('returns data fields to initialState', () => {
    useComposerDraftStore.setState({ draft: 'leak', focusToken: 5 });
    useComposerDraftStore.getState().reset();
    const state = useComposerDraftStore.getState();
    expect(state.draft).toBeNull();
    expect(state.focusToken).toBe(0);
  });
});
```

Each store gets one analogous test.

- [ ] **Step 4: typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean. If a callsite was reading `resetCharRefSuggestionStore` and the grep in Step 2 didn't catch it (e.g. dynamic import), tsc will surface it.

- [ ] **Step 5: commit**

```bash
git add frontend/src/store/ frontend/tests/store/
git commit -m "[7lo] stores: extract initialState + reset() (convention sweep)"
```

---

### Task 1: write the `sessionReset` helpers (TDD)

**Files:**
- Create: `frontend/src/lib/sessionReset.ts`
- Create: `frontend/tests/lib/sessionReset.test.ts`

The module exports four things:

1. `resetClientState(qc)` — async; calls `await qc.cancelQueries()` (aborts in-flight fetches so a late-resolving promise from the previous user can't write back into the empty cache), then `qc.clear()`, then resets every per-user Zustand store.
2. `swapSession(qc, user, accessToken)` — async; combines `resetClientState` + `setSession` atomically. Login uses this so the ordering invariant ("reset must precede setSession") is unreachable from call sites.
3. `registerSessionResetQueryClient(qc)` — module-level QueryClient registration. App boot calls this once.
4. `resetClientStateUsingRegistered()` — async; calls `resetClientState` against the registered QueryClient. Used by `handleUnauthorizedAccess` (non-React, non-component context). No-op if registration hasn't run yet.

Plus a test-only `_unsafeResetSessionResetRegistryForTests()` so the registry doesn't leak between tests.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/lib/sessionReset.test.ts
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _unsafeResetSessionResetRegistryForTests,
  PER_USER_STORES,
  registerSessionResetQueryClient,
  resetClientState,
  resetClientStateUsingRegistered,
  swapSession,
} from '@/lib/sessionReset';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useChatDraftStore } from '@/store/chatDraft';
import { useSessionStore } from '@/store/session';

afterEach(() => {
  _unsafeResetSessionResetRegistryForTests();
});

describe('resetClientState', () => {
  it('calls queryClient.cancelQueries() before clear (in-flight fetch race)', async () => {
    const qc = new QueryClient();
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');
    const clearSpy = vi.spyOn(qc, 'clear');

    await resetClientState(qc);

    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    // Order: cancelQueries must run before clear; otherwise a late-resolving
    // promise from the prior session writes back into the empty cache.
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(
      clearSpy.mock.invocationCallOrder[0],
    );
  });

  it('empties the cache', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 's1' }]);

    await resetClientState(qc);

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
  });

  it('calls reset() on every per-user store in PER_USER_STORES', async () => {
    // Spy on each store's reset method. Per-store unit tests (Task 0.5)
    // already cover that reset() returns the store to its initialState
    // shape; this test asserts the helper hits all of them.
    const spies = PER_USER_STORES.map((store) =>
      vi.spyOn(store.getState(), 'reset'),
    );

    await resetClientState(new QueryClient());

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('end-to-end smoke: dirty state → clean state', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 's1' }]);
    useAttachedSelectionStore.setState({
      attachedSelection: { text: 'leak', chapter: { id: 'c', number: 1, title: '' } },
    });
    useChatDraftStore.setState({
      drafts: {
        chat1: {
          chatId: 'chat1',
          userContent: 'leak',
          attachment: null,
          assistantText: 'leak-stream',
          status: 'streaming',
          error: null,
        },
      },
    });

    await resetClientState(qc);

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });
});

describe('swapSession', () => {
  it('resets state BEFORE setSession (ordering invariant)', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 'A1' }]);
    useSessionStore.setState({
      user: { id: 'A', username: 'a', name: 'A' },
      status: 'authenticated',
      sessionExpired: false,
    });

    // Subscribe and capture the user value at every state change. If reset
    // ran AFTER setSession, there would be a moment where user === 'B' and
    // the cache still held A's data.
    const userAtChange: Array<string | null> = [];
    const dataAtChange: Array<unknown> = [];
    const unsub = useSessionStore.subscribe((s) => {
      userAtChange.push(s.user?.username ?? null);
      dataAtChange.push(qc.getQueryData(['stories', 'list']));
    });

    await swapSession(qc, { id: 'B', username: 'b', name: 'B' }, 'B-token');
    unsub();

    // The transition to user='b' must happen with the cache already empty.
    const bIdx = userAtChange.indexOf('b');
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(dataAtChange[bIdx]).toBeUndefined();
  });

  it('sets the new user/token via the session store', async () => {
    const qc = new QueryClient();
    await swapSession(qc, { id: 'B', username: 'b', name: 'User B' }, 'B-token');
    expect(useSessionStore.getState().user?.username).toBe('b');
    expect(useSessionStore.getState().status).toBe('authenticated');
  });
});

describe('registered-QC variant', () => {
  it('resetClientStateUsingRegistered is a no-op when nothing is registered', async () => {
    _unsafeResetSessionResetRegistryForTests();
    // No registration → no throw, just no effect.
    await expect(resetClientStateUsingRegistered()).resolves.toBeUndefined();
  });

  it('resetClientStateUsingRegistered clears the registered QueryClient', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 'A1' }]);
    registerSessionResetQueryClient(qc);

    await resetClientStateUsingRegistered();

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
  });
});

// ─── Enumeration guard: every store file must be classified ──────────────────
// Catches the next "I added a store and forgot to add it to resetClientState"
// regression at PR time. Vite's import.meta.glob enumerates the files at
// test-eval time; if a new file under @/store/ isn't in either allowlist
// below, the test fails until the author makes a decision.

describe('store enumeration guard', () => {
  // KEEP IN SYNC with frontend/src/lib/sessionReset.ts.
  const PER_USER_STORES = [
    'activeChapter',
    'attachedSelection',
    'charRefSuggestion',
    'chatDraft',
    'composerDraft',
    'errors',
    'inlineAIResult',
    'selectedCharacter',
    'selection',
  ];
  // UI-only stores intentionally excluded from per-user reset. Adding to
  // this list is a deliberate decision — see the sessionReset.ts docstring.
  const UI_ONLY_STORES = ['session', 'sidebarTab', 'ui'];

  it('every store file is explicitly classified as per-user-reset or UI-only', () => {
    const all = Object.keys(import.meta.glob('@/store/*.ts'))
      .map((p) => {
        const m = p.match(/store\/(.+)\.ts$/);
        return m === null ? '' : m[1];
      })
      .filter((s) => s.length > 0)
      .sort();

    const classified = new Set([...PER_USER_STORES, ...UI_ONLY_STORES]);
    const unclassified = all.filter((s) => !classified.has(s));

    expect(unclassified).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend test -- sessionReset`
Expected: FAIL — module not found.

- [ ] **Step 3: Read every per-user store file**

Before implementing, read each of these files in full so the implementation matches the real initial-state shape:
- `frontend/src/store/attachedSelection.ts`
- `frontend/src/store/inlineAIResult.ts`
- `frontend/src/store/composerDraft.ts`
- `frontend/src/store/chatDraft.ts`
- `frontend/src/store/selection.ts`
- `frontend/src/store/activeChapter.ts`
- `frontend/src/store/selectedCharacter.ts`
- `frontend/src/store/charRefSuggestion.ts`
- `frontend/src/store/errors.ts`

For each, identify the data fields (NOT the action methods — those stay) and write the initial-state object the helper will set.

- [ ] **Step 4: Implement the helper**

```ts
// frontend/src/lib/sessionReset.ts
import type { QueryClient } from '@tanstack/react-query';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';
import { useChatDraftStore } from '@/store/chatDraft';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useErrorStore } from '@/store/errors';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSelectionStore } from '@/store/selection';
import { type SessionUser, useSessionStore } from '@/store/session';

/**
 * Per-user store registry. Every entry exposes a `reset()` action that
 * returns the store to its `initialState` shape (Task 0.5 convention).
 *
 * **Adding a store?** Add it here AND to the `PER_USER_STORES` allowlist
 * in the enumeration test (`frontend/tests/lib/sessionReset.test.ts`).
 * The test fails on unclassified stores. The helper has zero shape
 * knowledge — it just iterates this list.
 */
interface ResettableStore {
  getState: () => { reset: () => void };
}

export const PER_USER_STORES: readonly ResettableStore[] = [
  useAttachedSelectionStore,
  useInlineAIResultStore,
  useComposerDraftStore,
  useChatDraftStore,
  useSelectionStore,
  useActiveChapterStore,
  useSelectedCharacterStore,
  useCharRefSuggestionStore,
  useErrorStore,
];

/**
 * Reset all per-user client state on auth transition.
 *
 * **Ordering invariant:** on the LOGIN path, `resetClientState` MUST run
 * before `setSession`. Between them, any subscriber reading `user.id`
 * triggers a refetch under the WRONG identity and repopulates the cache.
 * Use `swapSession` (below) for login so the order is unreachable from
 * call sites.
 *
 * **In-flight fetch race:** `cancelQueries` aborts the AbortSignal on any
 * pending queryFn AND removes those queries from active tracking, so a
 * late-resolving fetch from the previous user's session cannot write back
 * into the empty cache. Calling `clear()` alone is not sufficient —
 * pending promises will resolve into the vacated keys.
 *
 * **Storage gotcha:** if you add a Zustand store using the `persist`
 * middleware, `getState().reset()` does NOT clear the mirrored
 * localStorage entry — call `useFooStore.persist.clearStorage()` from
 * this helper too. None of the current stores use persist; the helper
 * has no `clearStorage()` calls today.
 */
export async function resetClientState(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
  for (const store of PER_USER_STORES) {
    store.getState().reset();
  }
}

/**
 * Atomically swap from the previous session to a new one.
 *
 * Used on the login path. Does cancelQueries → clear → reset stores →
 * setSession in order, so call sites can't reorder them. The fused helper
 * makes the ordering foot-gun unreachable.
 */
export async function swapSession(
  queryClient: QueryClient,
  user: SessionUser,
  accessToken: string,
): Promise<void> {
  await resetClientState(queryClient);
  useSessionStore.getState().setSession(user, accessToken);
}

// ─── Non-React-context registration ──────────────────────────────────────────
//
// `handleUnauthorizedAccess` in `store/session.ts` runs from the api-client's
// terminal-401 handler — non-React, non-component. It can't call
// `useQueryClient()`. App boot calls `registerSessionResetQueryClient(qc)`
// once; the unauth handler calls `resetClientStateUsingRegistered()`.
//
// Mirrors the established `setUnauthorizedHandler` pattern in
// `store/session.ts` — same module-level singleton shape, same lifetime.
// If a third such registry lands, that's the moment to extract a shared
// `createBootRegistry<T>()` utility.
//
// If registration hasn't run yet (or tests reset it), the function is a
// no-op — the foreground tab still redirects to /login via the session
// slice flip; the cache stays stale until the next login() clears it.
// This registration just hardens that path against background-tab leaks
// and concurrent-render slop.

let registeredQueryClient: QueryClient | null = null;

export function registerSessionResetQueryClient(queryClient: QueryClient): void {
  registeredQueryClient = queryClient;
}

export async function resetClientStateUsingRegistered(): Promise<void> {
  if (registeredQueryClient !== null) {
    await resetClientState(registeredQueryClient);
  }
}

/** Test-only. Do not call from app code. */
export function _unsafeResetSessionResetRegistryForTests(): void {
  registeredQueryClient = null;
}
```

Note: the helper has no per-store shape knowledge — every store's `initialState` lives in its own file, and its `reset()` method is the contract. Per-store unit tests (Task 0.5) cover the shape assertions; the helper's job is just to iterate the list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend test -- sessionReset`
Expected: PASS — every store assertion green; cache-clear assertion green.

- [ ] **Step 6: Run full frontend suite**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/sessionReset.ts frontend/tests/lib/sessionReset.test.ts
git commit -m "[7lo] add resetClientState helper (cache + per-user Zustand)"
```

---

### Task 2: wire `swapSession` into `useAuth.login()`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts` (the `login` callback around lines 95–105)

The current `login` swaps the user via `setSession()` but leaves the previous user's cache and Zustand state intact. Use `swapSession` so the cancel/clear/reset/setSession sequence is atomic.

Note: `useAuth` no longer needs to destructure `setSession` from the session store for the login path — `swapSession` handles it. `setSession` may still be needed elsewhere (e.g. inside `initAuth`), so don't remove the import unconditionally; remove it only if no caller in this file references it.

- [ ] **Step 1: Edit `login`**

In `frontend/src/hooks/useAuth.ts`, add the imports:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { swapSession } from '@/lib/sessionReset';
```

In the `useAuth` hook body, grab the QueryClient:

```ts
const queryClient = useQueryClient();
```

Update `login`:

```ts
const login = useCallback(
  async ({ username, password }: LoginCredentials): Promise<SessionUser> => {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    // swapSession does cancelQueries → clear → reset stores → setSession
    // atomically. The ordering invariant (reset before setSession) is
    // unreachable from this call site.
    await swapSession(queryClient, res.user, res.accessToken);
    return res.user;
  },
  [queryClient],
);
```

If the body of `useAuth()` no longer references `setSession` for any other path after this edit (it shouldn't — only `login` uses it today), drop the `const setSession = useSessionStore(...)` line. If `initAuth` (the standalone export at the top of `useAuth.ts`) still uses `setSession` via `useSessionStore.getState()`, leave that path alone — `initAuth` is the cold-boot path, not an auth transition; the cache is empty there by definition.

- [ ] **Step 2: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAuth.ts
git commit -m "[7lo] useAuth.login: swapSession (atomic cancel/clear/reset/setSession)"
```

---

### Task 3: wire `resetClientState` into `useAuth.logout()`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts` (the `logout` callback around lines 121–129)

Add `resetClientState` to the existing import (or, if Task 2 already imported `swapSession` from the same module, extend that import to include `resetClientState`).

- [ ] **Step 1: Edit `logout`**

```ts
const logout = useCallback(async (): Promise<void> => {
  try {
    await api<void>('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore errors on logout — we clear local state regardless.
  } finally {
    // resetClientState awaits cancelQueries first, so any in-flight fetch
    // from this session is aborted before clear() runs and before the
    // session slice flips to unauthenticated.
    await resetClientState(queryClient);
    clearSession();
  }
}, [clearSession, queryClient]);
```

The order — `resetClientState` first, then `clearSession` — matches login: cache/stores go before the session slice. Any subscriber that re-renders during the auth-state transition sees a consistent "logged-out, no data" state rather than "logged-out, old data".

- [ ] **Step 2: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAuth.ts
git commit -m "[7lo] useAuth.logout: resetClientState in finally"
```

---

### Task 4: wire the helper into `useSignOutEverywhereMutation`

**Files:**
- Modify: `frontend/src/hooks/useAccount.ts` (around lines 67–80)

- [ ] **Step 1: Edit `useSignOutEverywhereMutation`**

Add the imports if not already present:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { resetClientState } from '@/lib/sessionReset';
```

(Note: `useQueryClient` may already be imported — `useDeleteAccountMutation` already uses it. Don't double-import.)

Update the mutation:

```ts
export function useSignOutEverywhereMutation(): UseMutationResult<void, Error, void> {
  const navigate = useNavigate();
  const clearSession = useSessionStore((s) => s.clearSession);
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async (): Promise<void> => {
      await api<void>('/auth/sign-out-everywhere', { method: 'POST' });
    },
    onSuccess: async () => {
      await resetClientState(queryClient);
      clearSession();
      navigate('/login', { replace: true, state: { signedOutEverywhere: true } });
    },
  });
}
```

(`onSuccess` is allowed to be async per TanStack Query's mutation contract; the mutation's `isSuccess` state remains true and downstream `await mutation.mutateAsync()` callers wait for the async onSuccess to settle.)

- [ ] **Step 2: Run typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAccount.ts
git commit -m "[7lo] useSignOutEverywhereMutation: resetClientState on success"
```

---

### Task 5: migrate `useDeleteAccountMutation` onto the helper

**Files:**
- Modify: `frontend/src/hooks/useAccount.ts` (`useDeleteAccountMutation`, around lines 92–110)

The mutation already calls `queryClient.clear()` directly — switch to the helper so it also resets Zustand. Important: a deleted account is the most sensitive auth transition; per-user stores must be empty.

- [ ] **Step 1: Edit `useDeleteAccountMutation.onSuccess`**

Replace:

```ts
onSuccess: () => {
  queryClient.clear();
  clearSession();
  navigate('/login', { replace: true, state: { accountDeleted: true } });
},
```

with:

```ts
onSuccess: async () => {
  await resetClientState(queryClient);
  clearSession();
  navigate('/login', { replace: true, state: { accountDeleted: true } });
},
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAccount.ts
git commit -m "[7lo] useDeleteAccountMutation: switch to resetClientState helper"
```

---

### Task 5.5: extract `goLoggedOut` helper

**Files:**
- Modify: `frontend/src/hooks/useAccount.ts` — extract a shared helper that captures the `await reset → clearSession → navigate('/login', {kind})` shape.

After Tasks 4 and 5 land, `useSignOutEverywhereMutation.onSuccess` and `useDeleteAccountMutation.onSuccess` are character-for-character identical except for the banner kind (`signedOutEverywhere` vs `accountDeleted`). Extract one helper.

- [ ] **Step 1: Add the helper**

Near the top of `frontend/src/hooks/useAccount.ts` (after the imports, before the first mutation), add:

```ts
import type { NavigateFunction } from 'react-router-dom';

type LoggedOutBannerKind = 'signedOutEverywhere' | 'accountDeleted';

async function goLoggedOut(
  queryClient: QueryClient,
  navigate: NavigateFunction,
  kind: LoggedOutBannerKind,
): Promise<void> {
  await resetClientState(queryClient);
  useSessionStore.getState().clearSession();
  navigate('/login', { replace: true, state: { [kind]: true } });
}
```

The `state: { [kind]: true }` shape matches what `LoginPage` already reads (`location.state.signedOutEverywhere`, `location.state.accountDeleted`). See "Follow-ups / out of scope" at the bottom of this plan for the broader unification of banner-passing — out of scope for 7lo.

- [ ] **Step 2: Use it from both mutations**

`useSignOutEverywhereMutation.onSuccess` becomes:

```ts
onSuccess: () => goLoggedOut(queryClient, navigate, 'signedOutEverywhere'),
```

`useDeleteAccountMutation.onSuccess` becomes:

```ts
onSuccess: () => goLoggedOut(queryClient, navigate, 'accountDeleted'),
```

(Returning the promise from `goLoggedOut` keeps `mutation.mutateAsync()` awaitable in callers.)

**Why `useAuth.logout()` is NOT migrated:** logout's contract is different. The hook does `try/finally → resetClientState; clearSession;` and intentionally does NOT navigate — the call site (`EditorPage.tsx:106-109`) owns the redirect via `void logout().finally(() => navigate('/login'))`. Folding navigate into `logout()` would change the hook's contract more than the duplication-removal justifies. The two mutation paths share a shape because they fire from the AccountPrivacyModal context where there's a "redirect-with-banner" pattern; logout fires from anywhere in the editor and the call sites already navigate. Documented as accepted asymmetry in the follow-ups section.

- [ ] **Step 3: Run typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useAccount.ts
git commit -m "[7lo] useAccount: extract goLoggedOut helper (collapse two onSuccess copies)"
```

---

### Task 6: integration test — login-as-A → switch-to-B leaves no A data

**Files:**
- Create: `frontend/tests/hooks/useAuth.session-reset.test.ts`

This test asserts the wiring contract: after the helper-equipped `login()` and `logout()` resolve, the QueryClient is empty and the per-user Zustand stores are at initial state. It does NOT mount the full editor (that's beyond the scope of this fix); it sets up a QueryClient + populates it as if user A's session had primed it, then calls `login` and `logout` and asserts state.

- [ ] **Step 1: Inspect existing useAuth test patterns**

Run: `ls frontend/tests/hooks/useAuth*.test.* 2>/dev/null && cat frontend/tests/hooks/useAuth*.test.* 2>/dev/null | head -80` to see the existing harness shape (api mocking, QueryClient provider). Reuse the pattern.

If no useAuth test exists, the harness shape is roughly:

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/hooks/useAuth';
import * as apiModule from '@/lib/api';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useChatDraftStore } from '@/store/chatDraft';
import { useSessionStore } from '@/store/session';

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}
```

- [ ] **Step 2: Write the integration test**

```ts
describe('useAuth — session reset on auth transition (story-editor-7lo)', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
    // Reset stores between tests so cross-test pollution doesn't mask bugs.
    useSessionStore.setState({ user: null, status: 'unauthenticated', sessionExpired: false });
    useAttachedSelectionStore.setState({ attachedSelection: null });
    useChatDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('login() clears the previous user\'s cache and Zustand stores before setSession', async () => {
    // Prime the client as if user A was logged in: cached query + plaintext-bearing store.
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1', title: "A's story" }]);
    useAttachedSelectionStore.setState({
      attachedSelection: {
        text: "A's selected text",
        chapter: { id: 'cha1', number: 1, title: 'A Ch1' },
      },
    });
    useChatDraftStore.setState({
      drafts: {
        chatA: {
          chatId: 'chatA',
          userContent: 'A draft',
          attachment: null,
          assistantText: 'A reply',
          status: 'streaming',
          error: null,
        },
      },
    });

    const apiSpy = vi.spyOn(apiModule, 'api').mockResolvedValue({
      user: { id: 'B', username: 'b', name: 'User B' },
      accessToken: 'B-token',
    } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await result.current.login({ username: 'b', password: 'pw' });

    await waitFor(() => {
      expect(useSessionStore.getState().user?.username).toBe('b');
    });

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useChatDraftStore.getState().drafts).toEqual({});
    expect(apiSpy).toHaveBeenCalledWith('/auth/login', expect.any(Object));
  });

  it('logout() clears cache and stores after the request resolves', async () => {
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1' }]);
    useAttachedSelectionStore.setState({
      attachedSelection: {
        text: 'leak',
        chapter: { id: 'c1', number: 1, title: '' },
      },
    });
    useSessionStore.setState({
      user: { id: 'A', username: 'a', name: 'User A' },
      status: 'authenticated',
      sessionExpired: false,
    });

    vi.spyOn(apiModule, 'api').mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await result.current.logout();

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });

  it('logout() still clears cache and stores even if the API call fails', async () => {
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1' }]);
    useSessionStore.setState({
      user: { id: 'A', username: 'a', name: 'User A' },
      status: 'authenticated',
      sessionExpired: false,
    });

    vi.spyOn(apiModule, 'api').mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await result.current.logout();

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useSessionStore.getState().user).toBeNull();
  });
});
```

If `apiModule.api`'s actual export shape differs from a default function (it's the named `api` per `frontend/src/lib/api.ts`), match what the existing tests do. Existing test files mock the api differently — match the established pattern rather than inventing one.

- [ ] **Step 3: Run the new tests**

Run: `npm --prefix frontend test -- useAuth.session-reset 2>&1 | tail -20`
Expected: PASS — all three cases.

- [ ] **Step 4: Run full frontend suite**

Run: `npm --prefix frontend test --run`
Expected: full suite green (no regressions in other useAuth tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/hooks/useAuth.session-reset.test.ts
git commit -m "[7lo] tests: cross-account leak regression for login/logout"
```

---

### Task 7: wire `handleUnauthorizedAccess` to the registered-QC variant

**Files:**
- Modify: `frontend/src/store/session.ts:68-75` — `handleUnauthorizedAccess`
- Modify: the module that owns the QueryClient (likely `frontend/src/main.tsx`) — call `registerSessionResetQueryClient(queryClient)` once at boot.

The terminal-401 handler runs from the api-client's non-React context. Without registration it can't reach the QueryClient — but with the registry from Task 1 it can. Two call sites to wire.

**Why this matters even though the foreground tab redirects:** a background tab whose refresh fails server-side keeps user A's full cache + Zustand state until the user touches it. The /login redirect only happens in the active tab. With React's concurrent rendering, even the active tab can render against stale state for a non-trivial number of frames between the 401 and the route change. Closing this gap costs five lines.

- [ ] **Step 1: Find where the QueryClient is constructed**

```bash
grep -rEn "new QueryClient\(|QueryClientProvider" frontend/src
```

The match should be in `frontend/src/main.tsx` (or wherever `<QueryClientProvider>` is mounted). Read that file to confirm the QueryClient is constructed at module scope (so it's available before React mounts).

- [ ] **Step 2: Register the QueryClient at app boot**

Edit the file from Step 1. After the QueryClient is constructed and before it's passed to the provider, register it:

```ts
import { registerSessionResetQueryClient } from '@/lib/sessionReset';

const queryClient = new QueryClient(/* existing config */);
registerSessionResetQueryClient(queryClient);
```

Module-scope registration is fine — `sessionReset.ts` imports session.ts, but session.ts doesn't import sessionReset.ts (it only fires `handleUnauthorizedAccess` via the `setUnauthorizedHandler` callback registered at module init), so there's no circular import. Verify with the typecheck in Step 5.

- [ ] **Step 3: Add an `expired` flag to `clearSession`**

`clearSession` and `handleUnauthorizedAccess` differ only in `sessionExpired: false` vs `true`. Collapse the duplication by giving `clearSession` an optional `expired` parameter; `handleUnauthorizedAccess` then becomes a thin wrapper.

In `frontend/src/store/session.ts`:

Update the `SessionState` interface:

```ts
export interface SessionState {
  user: SessionUser | null;
  status: SessionStatus;
  sessionExpired: boolean;
  setSession: (user: SessionUser, accessToken: string) => void;
  setUser: (user: SessionUser) => void;
  clearSession: (opts?: { expired?: boolean }) => void;
  setStatus: (status: SessionStatus) => void;
}
```

Update the implementation:

```ts
clearSession: (opts) => {
  setAccessToken(null);
  set({
    user: null,
    status: 'unauthenticated',
    sessionExpired: opts?.expired ?? false,
  });
},
```

Existing callers (`useAuth.logout`, `useSignOutEverywhereMutation.onSuccess` via `goLoggedOut`, `useDeleteAccountMutation.onSuccess` via `goLoggedOut`) all want `sessionExpired: false`, which is the default — they can keep calling `clearSession()` with no argument and stay correct. No call-site changes needed for those three.

- [ ] **Step 4: Update `handleUnauthorizedAccess`**

Add the import in `frontend/src/store/session.ts`:

```ts
import { resetClientStateUsingRegistered } from '@/lib/sessionReset';
```

Update `handleUnauthorizedAccess`:

```ts
export function handleUnauthorizedAccess(): void {
  // Fire-and-forget: the registry call is async (cancelQueries), but
  // clearSession below must remain synchronous so the existing single-
  // setState contract is preserved (avoids a render where the user is
  // unauthenticated but sessionExpired is still false). Awaiting here
  // would split the state change across a microtask. Promise rejection
  // here is unreachable in practice — cancelQueries / clear are infallible.
  void resetClientStateUsingRegistered();
  useSessionStore.getState().clearSession({ expired: true });
}
```

The function now does the same two things as the other auth-transition sites — reset client state, flip the session slice — with the `expired: true` flag being the only thing that distinguishes a terminal-401 from a deliberate logout.

- [ ] **Step 5: Add tests**

Append to `frontend/tests/lib/sessionReset.test.ts` (the file already imports the registry helpers from Task 1):

```ts
describe('handleUnauthorizedAccess (registered-QC integration)', () => {
  it('clears the registered QueryClient + per-user stores when registered', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 'A1' }]);
    useAttachedSelectionStore.setState({
      attachedSelection: { text: 'leak', chapter: { id: 'c', number: 1, title: '' } },
    });
    registerSessionResetQueryClient(qc);

    await resetClientStateUsingRegistered();

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
  });
});
```

Add a small assertion for the `clearSession({ expired })` parameter to a session-store test (or a new test file under `frontend/tests/store/session.test.ts`):

```ts
it('clearSession({ expired: true }) sets sessionExpired flag', () => {
  useSessionStore.setState({ user: { id: 'a', username: 'a', name: 'A' }, status: 'authenticated', sessionExpired: false });
  useSessionStore.getState().clearSession({ expired: true });
  expect(useSessionStore.getState().sessionExpired).toBe(true);
  expect(useSessionStore.getState().user).toBeNull();
});

it('clearSession() defaults sessionExpired to false', () => {
  useSessionStore.setState({ user: { id: 'a', username: 'a', name: 'A' }, status: 'authenticated', sessionExpired: true });
  useSessionStore.getState().clearSession();
  expect(useSessionStore.getState().sessionExpired).toBe(false);
});
```

(The "no-op when nothing registered" case is already covered in the registered-QC describe block from Task 1.)

- [ ] **Step 6: Run typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean. Watch for circular-import warnings — if tsc complains, the registration may need to move into a small bootstrap file that imports both sides.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/session.ts frontend/src/main.tsx frontend/tests/lib/sessionReset.test.ts frontend/tests/store/session.test.ts
git commit -m "[7lo] handleUnauthorizedAccess: clear cache + stores via registered QC; clearSession({expired})"
```

---

### Task 8: document the per-user-state-must-reset rule in `docs/agent-rules/frontend.md`

**Files:**
- Modify: `docs/agent-rules/frontend.md`

The agent-rules digest is loaded into every implementer / code-quality-reviewer dispatch via `/bd-execute` (per `docs/agent-rules/index.md`). Adding the rule there means every future change to a frontend store sees it at dispatch time — belt-and-suspenders with the enumeration test from Task 1.

- [ ] **Step 1: Add the section**

Insert a new section in `docs/agent-rules/frontend.md` immediately after "State management" (so it sits next to the rule about what stores exist). The section text:

```markdown
## Per-user state must reset on auth transition

Any new Zustand store under `frontend/src/store/*.ts` that holds plaintext content, IDs referencing user-owned rows, or any state that should not survive a session swap must be added to `resetClientState` in `frontend/src/lib/sessionReset.ts` AND to the `PER_USER_STORES` allowlist in `frontend/tests/lib/sessionReset.test.ts`.

UI-only stores (theme, layout, sidebar tab) go on the `UI_ONLY_STORES` allowlist instead. The enumeration test fails on unclassified stores — pick one explicitly.

Every auth-transition site must reset before flipping the session slice:
- `useAuth.login` → `swapSession(qc, user, token)` (atomic).
- `useAuth.logout` → `await resetClientState(qc); clearSession();`
- `useSignOutEverywhereMutation.onSuccess` → `await resetClientState(qc); clearSession(); navigate(...);`
- `useDeleteAccountMutation.onSuccess` → same shape.
- `handleUnauthorizedAccess` (terminal-401, non-React) → `void resetClientStateUsingRegistered();` then the existing setState.

If you add a store that uses Zustand's `persist` middleware, `setState({ ...initial })` does NOT clear the mirrored `localStorage` entry — call `useFooStore.persist.clearStorage()` from `resetClientState` in addition.
```

- [ ] **Step 2: Verify the index still routes frontend changes to this digest**

Read `docs/agent-rules/index.md` and confirm `frontend/src/store/**` matches the `frontend/src/**` glob (it does, per the existing index). No index change needed.

- [ ] **Step 3: Run typecheck (no code changes, but cheap to verify nothing slipped)**

Run: `npm --prefix frontend run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-rules/frontend.md
git commit -m "[7lo] agent-rules/frontend: per-user state must reset on auth transition"
```

---

## Manual verification (run after merge to convergence)

The user's reproduction steps. Document the result in the PR body:

1. `make dev`. Open `http://localhost:3000`.
2. Log in as the demo user (or fixture user). Navigate to a story; let the editor populate (sidebar shows stories, chapters list populates, click into a chat).
3. Click "Sign out". Should land on `/login`.
4. Log in as a **different** user (register one if needed).
5. Verify: editor shows ONLY this user's data. No demo stories, no demo chapters, no demo chats. **No browser refresh needed.**
6. Repeat the matrix:
   - logout → login (covered by Task 3 + Task 2)
   - sign-out-everywhere → login (covered by Task 4 + Task 2)
   - delete-account → register-different (covered by Task 5; register doesn't auto-login but the delete itself must clear)

If any path still shows stale data, that's a regression — file a follow-up bd issue with the path.

---

## Self-review checklist (before opening PR)

- [ ] Every per-user Zustand store has a corresponding reset in `resetClientState` AND an entry in `PER_USER_STORES` (Task 1 enumeration test). Adding a store without classifying it fails the test.
- [ ] All five auth-transition sites call the helper: `login` (via `swapSession`), `logout`, `useSignOutEverywhereMutation`, `useDeleteAccountMutation`, `handleUnauthorizedAccess` (via the registered-QC variant).
- [ ] `cancelQueries` runs before `clear` in `resetClientState` (Task 1 ordering test).
- [ ] `swapSession` resets state BEFORE `setSession` (Task 1 ordering test on the subscriber-capture pattern).
- [ ] No new dependencies.
- [ ] Auth-touching change → `security-reviewer` will fire automatically at close. Make sure no decrypted narrative content lands in any new log sink, error toast, or state field; the helper only deletes state, doesn't add any.
- [ ] `docs/agent-rules/frontend.md` updated (Task 8) so the next implementer touching `frontend/src/store/**` sees the rule at dispatch time.

---

## Follow-ups / out of scope

These duplications were noted during plan review but are pre-existing and intentionally not addressed in this PR. Worth bd issues so the next contributor sees them:

- **Banner-passing mechanisms.** `LoginPage` reads from two sources to render banners: `useSessionStore.sessionExpired` (state flag) AND `location.state.{signedOutEverywhere|accountDeleted|resetSuccess}` (router state). New banner kinds get a new boolean key in `location.state`. Worth collapsing into a single `LoginBannerKind` discriminator. Pre-7lo. Don't expand 7lo's scope.

- **Logout-navigate asymmetry.** `useAuth.logout()` doesn't navigate from the hook; `useSignOutEverywhereMutation.onSuccess` and `useDeleteAccountMutation.onSuccess` do (now via `goLoggedOut`). Same outcome (back to /login), two mechanisms. Defensible — logout fires from any authenticated route while the others fire from the AccountPrivacyModal — but worth a follow-up to pick one convention.

- **`composerDraft.clearDraft` footgun.** Name suggests full reset; only clears `draft`, not `focusToken`. Task 0.5 adds a JSDoc note flagging the narrow scope. Renaming to `consumeDraft` (matching the docstring's existing wording about the composer "consuming" the draft into its internal value) closes the footgun but ripples through call sites. Out of scope for 7lo; file as a small follow-up.

- **Two singleton-registry shapes.** `setUnauthorizedHandler` (in `store/session.ts`) and `registerSessionResetQueryClient` (in `lib/sessionReset.ts`) are structurally identical. Two singletons isn't a refactor target on its own; if a third lands, extract `createBootRegistry<T>()`.

- **In-flight SSE streams not aborted on session transition.** `resetClientState` cancels TanStack Query fetches via `cancelQueries`, but the chat send (`useChat.ts:231`) and inline AI completion (`useAICompletion.ts:72`) own per-mutation AbortControllers that nothing at the auth-transition level reaches. Logout mid-stream can briefly render A's tokens under B's session before the next reset wins. Filed as **story-editor-mxi** (blocked by this PR).

- **2026-shape redesign of the session boundary.** The retrofit this PR ships (imperative registry + reset) is not the structural answer. Filed as **story-editor-ajk** (umbrella) covering: userId-prefixed queryKeys, `<UserScope key={user.id}>` per-user store subtree, and `BroadcastChannel('auth')` for multi-tab coordination. Don't block 7lo on it.

The first four bullets above can be filed as bd issues if they become priorities; the SSE and 2026-shape items are already filed.
