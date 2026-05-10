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
- `frontend/src/hooks/useAuth.ts` — `login()` and `logout()` invoke the helper.
- `frontend/src/hooks/useAccount.ts` — `useSignOutEverywhereMutation.onSuccess` and `useDeleteAccountMutation.onSuccess` invoke the helper (the latter currently calls `queryClient.clear()` directly; switch to the helper for symmetry).

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

### Task 1: write the `resetClientState` helper (TDD)

**Files:**
- Create: `frontend/src/lib/sessionReset.ts`
- Create: `frontend/tests/lib/sessionReset.test.ts`

The helper takes a `QueryClient`, calls `clear()` on it, and resets each per-user Zustand store to its initial state. Stores that already export a `clear()` method use it; stores that don't get a `setState` to the initial-state object.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/lib/sessionReset.test.ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { resetClientState } from '@/lib/sessionReset';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';
import { useChatDraftStore } from '@/store/chatDraft';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useErrorStore } from '@/store/errors';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSelectionStore } from '@/store/selection';

describe('resetClientState', () => {
  it('calls queryClient.clear()', () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 's1' }]);
    expect(qc.getQueryData(['stories', 'list'])).toEqual([{ id: 's1' }]);

    resetClientState(qc);

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
  });

  it('clears attachedSelection', () => {
    useAttachedSelectionStore.setState({
      attachedSelection: {
        text: 'leak',
        chapter: { id: 'c1', number: 1, title: 'Ch 1' },
      },
    });
    resetClientState(new QueryClient());
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
  });

  it('clears inlineAIResult', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: { action: 'rewrite', text: 'leak', status: 'done', output: 'leak-out' },
    });
    resetClientState(new QueryClient());
    expect(useInlineAIResultStore.getState().inlineAIResult).toBeNull();
  });

  it('clears composerDraft (draft + focusToken)', () => {
    useComposerDraftStore.setState({ draft: 'leak draft', focusToken: 7 });
    resetClientState(new QueryClient());
    const state = useComposerDraftStore.getState();
    expect(state.draft).toBeNull();
    expect(state.focusToken).toBe(0);
  });

  it('clears chatDraft.drafts', () => {
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
    resetClientState(new QueryClient());
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });

  it('clears selection', () => {
    useSelectionStore.setState({
      selection: { text: 'leak', range: null, rect: null },
    });
    resetClientState(new QueryClient());
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('clears activeChapterId', () => {
    useActiveChapterStore.setState({ activeChapterId: 'ch-from-A' });
    resetClientState(new QueryClient());
    expect(useActiveChapterStore.getState().activeChapterId).toBeNull();
  });

  it('clears selectedCharacterId', () => {
    useSelectedCharacterStore.setState({ selectedCharacterId: 'char-from-A' });
    resetClientState(new QueryClient());
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });

  it('clears charRefSuggestion (open=false, items=[], activeIndex=0, query="", clientRect=null, onSelect=null)', () => {
    useCharRefSuggestionStore.setState({
      open: true,
      items: [{ id: 'char-A', name: 'Alice' }],
      activeIndex: 0,
      query: 'a',
      clientRect: null,
      onSelect: () => {},
    });
    resetClientState(new QueryClient());
    const after = useCharRefSuggestionStore.getState();
    expect(after.open).toBe(false);
    expect(after.items).toEqual([]);
    expect(after.activeIndex).toBe(0);
    expect(after.query).toBe('');
    expect(after.clientRect).toBeNull();
    expect(after.onSelect).toBeNull();
  });

  it('clears errors queue', () => {
    useErrorStore.getState().push({
      severity: 'error',
      source: 'test',
      code: null,
      message: 'leak',
    });
    expect(useErrorStore.getState().errors.length).toBeGreaterThan(0);
    resetClientState(new QueryClient());
    expect(useErrorStore.getState().errors).toEqual([]);
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

/**
 * Reset all per-user client state on auth transition.
 *
 * Invoked from every auth-transition site (login, logout, sign-out-everywhere,
 * delete-account). Resets:
 *   - the entire TanStack Query cache (server state)
 *   - every per-user Zustand store to its initial-state shape
 *
 * UI-only stores (`ui.layout`, `sidebarTab`) are intentionally NOT reset —
 * they are per-tab preferences, not per-user data.
 *
 * The session store itself is NOT reset here — `setSession` / `clearSession`
 * is the caller's responsibility. This helper handles the OTHER state that
 * a session change must invalidate.
 *
 * If you add a new store that holds per-user data (plaintext content, ids
 * referencing user-owned rows, anything that should not survive a session
 * swap), add it here. The test file enumerates the current set so a
 * missed addition fails loudly.
 */
export function resetClientState(queryClient: QueryClient): void {
  queryClient.clear();

  useAttachedSelectionStore.setState({ attachedSelection: null });
  useInlineAIResultStore.setState({ inlineAIResult: null });
  useComposerDraftStore.setState({ draft: null, focusToken: 0 });
  useChatDraftStore.setState({ drafts: {} });
  useSelectionStore.setState({ selection: null });
  useActiveChapterStore.setState({ activeChapterId: null });
  useSelectedCharacterStore.setState({ selectedCharacterId: null });
  useCharRefSuggestionStore.setState({
    open: false,
    items: [],
    activeIndex: 0,
    query: '',
    clientRect: null,
    onSelect: null,
  });
  useErrorStore.getState().clear();
}
```

Note: `useErrorStore` exposes a `clear()` method on the slice (sets `errors: []`). Calling it via `getState().clear()` is the established pattern for this store — equivalent to `setState({ errors: [] })` but consistent with the store's own API. `useCharRefSuggestionStore` also exports a `resetCharRefSuggestionStore` helper at the bottom of the file (the same shape as the inline `setState` above); either form is fine but the inline form keeps the helper file's "what does it touch" fully explicit on the page.

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

### Task 2: wire the helper into `useAuth.login()`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts` (the `login` callback around lines 95–105)

The current `login` swaps the user via `setSession()` but leaves the previous user's cache and Zustand state intact. Reset BEFORE setSession so the brief render between "auth swap" and "first refetch" doesn't show A's data.

- [ ] **Step 1: Edit `login`**

In `frontend/src/hooks/useAuth.ts`, add the imports:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { resetClientState } from '@/lib/sessionReset';
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
    // Reset before setSession so the new session never renders against the
    // previous user's cache or per-user stores.
    resetClientState(queryClient);
    setSession(res.user, res.accessToken);
    return res.user;
  },
  [queryClient, setSession],
);
```

- [ ] **Step 2: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAuth.ts
git commit -m "[7lo] useAuth.login: resetClientState before setSession"
```

---

### Task 3: wire the helper into `useAuth.logout()`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts` (the `logout` callback around lines 121–129)

- [ ] **Step 1: Edit `logout`**

```ts
const logout = useCallback(async (): Promise<void> => {
  try {
    await api<void>('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore errors on logout — we clear local state regardless.
  } finally {
    resetClientState(queryClient);
    clearSession();
  }
}, [clearSession, queryClient]);
```

The order — `resetClientState` first, then `clearSession` — matches login: the cache/stores go before the session slice, so any subscriber that re-renders during the auth-state transition sees a consistent "logged-out, no data" state rather than "logged-out, old data".

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
    onSuccess: () => {
      resetClientState(queryClient);
      clearSession();
      navigate('/login', { replace: true, state: { signedOutEverywhere: true } });
    },
  });
}
```

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
onSuccess: () => {
  resetClientState(queryClient);
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

## Optional Task 7 (deferred unless trivial): wire `handleUnauthorizedAccess` to the helper

**File:**
- `frontend/src/store/session.ts:68-75` — `handleUnauthorizedAccess`

The terminal-401 handler currently sets state directly (`setAccessToken(null)` + `useSessionStore.setState(...)`). It does NOT clear the cache or per-user stores. In practice:
- The user lands on `/login` post-401 — they're not seeing data.
- If they re-login as the SAME user, login() now clears the cache (Task 2) — so this path is already safe.
- If they re-login as a DIFFERENT user, login() clears the cache.

So this path is theoretically already safe. BUT: clearing on the unauth handler would be a defense-in-depth measure if a future bug let stale-cache data render between the 401 and the /login redirect.

The wiring is non-trivial: `handleUnauthorizedAccess` is called from a non-React, non-component context (the api client's terminal-401 handler). It can't `useQueryClient()`. It would need a module-level QueryClient registration, similar to the `setUnauthorizedHandler` pattern.

**Decision:** skip in this PR. If a future bug surfaces a leak through this path, file a follow-up. The four wired sites cover every observable path the user can hit.

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

- [ ] Every per-user Zustand store reads in the codebase has a corresponding reset in `resetClientState`. Run `ls frontend/src/store/*.ts` and confirm each non-UI-only store is in the helper.
- [ ] All four auth-transition sites call the helper: `login`, `logout`, `useSignOutEverywhereMutation`, `useDeleteAccountMutation`.
- [ ] The helper's tests enumerate every store it touches — adding a new store but forgetting to test it should fail loudly (the integration test in Task 6 doesn't catch this; the unit tests in Task 1 do).
- [ ] No new dependencies.
- [ ] Auth-touching change → `security-reviewer` will fire automatically at close. Make sure no decrypted narrative content lands in any new log sink, error toast, or state field; the helper only deletes state, doesn't add any.
