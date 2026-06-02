# Abort in-flight SSE streams on session transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project note:** this plan is executed via `/bd-execute story-editor-mxi`. Spec: `docs/superpowers/specs/2026-06-02-abort-streams-on-session-transition-design.md`.

**Goal:** Abort in-flight chat and inline-AI SSE streams on every auth transition so the previous user's decrypted tokens can never land in the next user's freshly-reset client state.

**Architecture:** A module-level registry (`Set<AbortController>`) tracks active stream controllers. Each streaming hook registers its controller when a stream starts and deregisters in its `finally`. `resetClientState` — the single chokepoint that already runs on login (`swapSession`), logout, delete-account, and terminal-401 (`resetClientStateUsingRegistered`) — calls `abortAllStreams()` first, before `cancelQueries()`/`clear()`/store-reset.

**Tech Stack:** TypeScript (strict), React, Zustand, TanStack Query, Vitest + Testing Library (jsdom). Verify line: `cd frontend && npm test`.

---

## File Structure

- **Create** `frontend/src/lib/streamRegistry.ts` — tracks active stream `AbortController`s; exposes `registerStream` / `abortAllStreams`. One responsibility, no dependencies.
- **Create** `frontend/tests/lib/streamRegistry.test.ts` — unit tests for the registry.
- **Modify** `frontend/src/lib/sessionReset.ts` — call `abortAllStreams()` first in `resetClientState`.
- **Modify** `frontend/tests/lib/sessionReset.test.ts` — assert a registered controller is aborted by `resetClientState`; clear the registry in `afterEach`.
- **Modify** `frontend/src/hooks/useChat.ts` — register the send controller; deregister in `finally`.
- **Modify** `frontend/tests/hooks/useChat.test.tsx` — acceptance test: mid-stream reset aborts the stream and removes the draft; no further `appendDelta`.
- **Modify** `frontend/src/hooks/useAICompletion.ts` — register the `run` controller; deregister in `finally`.
- **Modify** `frontend/tests/hooks/useAICompletion.test.tsx` — assert the inline-completion controller is aborted by `resetClientState`.

> **Pre-flight (host gotcha):** if `cd frontend && npm test` fails immediately with EACCES / permission errors on `node_modules`, the Docker container has root-owned the tree. Fix with `sudo chown -R asg:asg frontend/node_modules` (stop and surface this to the user per the sudo memory) or run the suite inside the `story-editor-frontend` container. Frontend vitest is jsdom — no backend stack required.

---

### Task 1: Stream registry module

**Files:**
- Create: `frontend/src/lib/streamRegistry.ts`
- Test: `frontend/tests/lib/streamRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/lib/streamRegistry.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { abortAllStreams, registerStream } from '@/lib/streamRegistry';

afterEach(() => {
  // Empty the module-level registry between tests so a controller from one
  // test can never bleed into the next.
  abortAllStreams();
});

describe('streamRegistry', () => {
  it('aborts every registered controller on abortAllStreams', () => {
    const a = new AbortController();
    const b = new AbortController();
    registerStream(a);
    registerStream(b);

    abortAllStreams();

    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });

  it('does not abort a controller after its deregister handle runs', () => {
    const c = new AbortController();
    const deregister = registerStream(c);

    deregister();
    abortAllStreams();

    expect(c.signal.aborted).toBe(false);
  });

  it('empties the registry so a controller is not retained across calls', () => {
    // Register + abort clears the set. A controller deregistered after a
    // prior abortAllStreams must therefore not be re-aborted: this only holds
    // if the first abortAllStreams emptied the set rather than accumulating.
    const first = new AbortController();
    registerStream(first);
    abortAllStreams();

    const second = new AbortController();
    const deregisterSecond = registerStream(second);
    deregisterSecond();
    abortAllStreams();

    expect(second.signal.aborted).toBe(false);
  });

  it('is a no-op on an empty registry', () => {
    expect(() => abortAllStreams()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/lib/streamRegistry.test.ts`
Expected: FAIL — cannot resolve `@/lib/streamRegistry` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/streamRegistry.ts`:

```ts
/**
 * Registry of in-flight streaming `AbortController`s (chat assistant + inline
 * AI completions). Streaming surfaces own their controller inside a closure,
 * so the session-reset chokepoint cannot reach them directly; this registry
 * makes them reachable. `resetClientState` (frontend/src/lib/sessionReset.ts)
 * calls `abortAllStreams()` on every auth transition so a previous user's
 * stream can't push tokens into the next user's freshly-reset state
 * (story-editor-mxi, sister to story-editor-7lo).
 *
 * Distinct from the single-value `registerSessionResetQueryClient` registry in
 * sessionReset.ts: this tracks *many* controllers (a Set), so it lives in its
 * own module.
 */
const active = new Set<AbortController>();

/**
 * Register an active stream controller. Returns a deregister handle the caller
 * MUST invoke when the stream ends (success, error, or abort) — typically from
 * the streaming surface's `finally` block.
 */
export function registerStream(controller: AbortController): () => void {
  active.add(controller);
  return () => {
    active.delete(controller);
  };
}

/** Abort every registered stream and empty the registry. */
export function abortAllStreams(): void {
  for (const controller of active) {
    controller.abort();
  }
  active.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/lib/streamRegistry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/streamRegistry.ts frontend/tests/lib/streamRegistry.test.ts
git commit -m "[story-editor-mxi] add stream-controller registry"
```

---

### Task 2: Wire abortAllStreams into the reset chokepoint

**Files:**
- Modify: `frontend/src/lib/sessionReset.ts` (import + `resetClientState`)
- Test: `frontend/tests/lib/sessionReset.test.ts`

- [ ] **Step 1: Write the failing test**

In `frontend/tests/lib/sessionReset.test.ts`, add `registerStream` to the import from a new line and extend the `afterEach` to clear the registry, then add a test inside the existing `describe('resetClientState', …)` block.

Add this import near the top (after the existing `@/lib/sessionReset` import block):

```ts
import { abortAllStreams, registerStream } from '@/lib/streamRegistry';
```

Replace the existing top-level `afterEach` with one that also empties the stream registry:

```ts
afterEach(() => {
  abortAllStreams();
  _unsafeResetSessionResetRegistryForTests();
  useSessionStore.getState().clearSession();
});
```

Add this test as the last `it` inside `describe('resetClientState', () => { … })`:

```ts
  it('aborts in-flight streams registered via the stream registry', async () => {
    const controller = new AbortController();
    registerStream(controller);

    await resetClientState(new QueryClient());

    expect(controller.signal.aborted).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/lib/sessionReset.test.ts -t "aborts in-flight streams"`
Expected: FAIL — `controller.signal.aborted` is `false` (`resetClientState` does not yet abort streams).

- [ ] **Step 3: Implement the wiring**

In `frontend/src/lib/sessionReset.ts`, add the import alongside the other `@/lib` / `@/store` imports at the top of the file:

```ts
import { abortAllStreams } from '@/lib/streamRegistry';
```

Then change `resetClientState` (currently lines 61-67) so `abortAllStreams()` runs first:

```ts
export async function resetClientState(queryClient: QueryClient): Promise<void> {
  // Abort in-flight SSE streams BEFORE tearing down the stores they write into
  // (chatDraft / inlineAIResult are reset below). Aborting first stops any
  // further chunk from repopulating a freshly-reset store under the next
  // session (story-editor-mxi).
  abortAllStreams();
  await queryClient.cancelQueries();
  queryClient.clear();
  for (const store of PER_USER_STORES) {
    store.getState().reset();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/lib/sessionReset.test.ts`
Expected: PASS (all existing tests in the file plus the new one).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/sessionReset.ts frontend/tests/lib/sessionReset.test.ts
git commit -m "[story-editor-mxi] abort in-flight streams in resetClientState"
```

---

### Task 3: Register the chat send controller

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (import + `mutationFn` + `finally`)
- Test: `frontend/tests/hooks/useChat.test.tsx`

- [ ] **Step 1: Write the failing acceptance test**

In `frontend/tests/hooks/useChat.test.tsx`, add two imports at the top (after the existing `@/store/chatDraft` import):

```ts
import { resetClientState } from '@/lib/sessionReset';
import { abortAllStreams } from '@/lib/streamRegistry';
```

Extend the existing top-level `afterEach` (currently just resets `useChatDraftStore`) to also clear the registry:

```ts
afterEach(() => {
  abortAllStreams();
  useChatDraftStore.setState({ drafts: {} });
});
```

Add this test as the last `it` inside `describe('useSendChatMessageMutation', () => { … })` (i.e. right after the `stop() aborts the in-flight stream` test):

```ts
  it('aborts the stream and drops the draft when resetClientState runs mid-stream', async () => {
    // Controllable stream + captured signal: emit one content chunk, then run
    // a session reset mid-stream and assert the stream is aborted, the draft is
    // gone, and no further chunk can repopulate it (story-editor-mxi).
    let abortedSignal: AbortSignal | null = null;
    let enqueue!: (s: string) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        enqueue = (s) => controller.enqueue(encoder.encode(s));
      },
    });
    vi.mocked(apiStream).mockImplementation(async (_path, init) => {
      abortedSignal = (init as { signal?: AbortSignal } | undefined)?.signal ?? null;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const { wrapper, qc } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    act(() => {
      void result.current.mutateAsync({
        chatId: 'c1',
        chapterId: 'ch1',
        content: 'q',
        modelId: 'm1',
      });
    });

    // One content chunk lands in the draft.
    enqueue('data: {"choices":[{"delta":{"content":"A"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().drafts['c1']?.assistantText).toBe('A');
    });

    const appendSpy = vi.spyOn(useChatDraftStore.getState(), 'appendDelta');

    // Session transition mid-stream.
    await act(async () => {
      await resetClientState(qc);
    });

    expect(abortedSignal).not.toBeNull();
    expect(abortedSignal?.aborted).toBe(true);
    expect(useChatDraftStore.getState().drafts['c1']).toBeUndefined();

    // A late chunk from the previous stream must not resurrect the draft. The
    // reader was cancelled by the abort, so enqueue may throw — swallow it.
    try {
      enqueue('data: {"choices":[{"delta":{"content":"B"}}]}\n\n');
    } catch {
      // expected: stream cancelled
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(appendSpy).not.toHaveBeenCalled();
    expect(useChatDraftStore.getState().drafts['c1']).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useChat.test.tsx -t "drops the draft when resetClientState"`
Expected: FAIL — `abortedSignal.aborted` is `false` (the send controller isn't registered, so `resetClientState` can't reach it).

- [ ] **Step 3: Register the controller in the hook**

In `frontend/src/hooks/useChat.ts`, add the import near the other `@/lib` imports at the top:

```ts
import { registerStream } from '@/lib/streamRegistry';
```

In `mutationFn`, immediately after `abortRef.current = controller;` (currently line 198), add:

```ts
      const deregister = registerStream(controller);
```

Then change the existing `finally` block (currently lines 231-233) to call `deregister()`:

```ts
      } finally {
        deregister();
        if (abortRef.current === controller) abortRef.current = null;
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useChat.test.tsx`
Expected: PASS (all existing `useChat` tests plus the new one).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/tests/hooks/useChat.test.tsx
git commit -m "[story-editor-mxi] register chat send stream for session-reset abort"
```

---

### Task 4: Register the inline-AI completion controller

**Files:**
- Modify: `frontend/src/hooks/useAICompletion.ts` (import + `run` + `finally`)
- Test: `frontend/tests/hooks/useAICompletion.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/tests/hooks/useAICompletion.test.tsx`, add two imports after the existing `@/store/errors` import:

```ts
import { resetClientState } from '@/lib/sessionReset';
import { abortAllStreams } from '@/lib/streamRegistry';
import { QueryClient } from '@tanstack/react-query';
```

Extend the existing `afterEach` (currently clears mocks + error store) to also clear the registry — add this line inside the `afterEach` callback, before the `vi.clearAllMocks()` is fine, but place it first so a leaked controller is dropped even if a later line throws:

```ts
    abortAllStreams();
```

Add this test as a new `it` at the end of the `describe('useAICompletion', () => { … })` block:

```ts
  it('aborts the in-flight completion when resetClientState runs', async () => {
    // Controllable stream + captured signal — start a run, then run a session
    // reset and assert the completion controller was aborted (story-editor-mxi).
    let abortedSignal: AbortSignal | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(_controller) {
        // Never enqueue — hold the stream open until the reset aborts it.
      },
    });
    vi.mocked(apiStream).mockImplementation(async (_path, init) => {
      abortedSignal = (init as { signal?: AbortSignal } | undefined)?.signal ?? null;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const { result } = renderHook(() => useAICompletion());

    act(() => {
      void result.current.run(BASE_ARGS);
    });

    // Wait until apiStream has been called and the controller is stashed.
    await vi.waitFor(() => expect(abortedSignal).not.toBeNull());

    await act(async () => {
      await resetClientState(new QueryClient());
    });

    expect(abortedSignal?.aborted).toBe(true);
  });
```

> Note: `vi.waitFor` is available without extra import (it is on the imported `vi`). `renderHook` and `act` are already imported in this file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useAICompletion.test.tsx -t "aborts the in-flight completion"`
Expected: FAIL — `abortedSignal.aborted` is `false` (the `run` controller isn't registered).

- [ ] **Step 3: Register the controller in the hook**

In `frontend/src/hooks/useAICompletion.ts`, add the import near the other `@/lib` imports at the top:

```ts
import { registerStream } from '@/lib/streamRegistry';
```

In `run`, immediately after `controllerRef.current = controller;` (currently line 113), add:

```ts
      const deregister = registerStream(controller);
```

Then change the existing `finally` block (currently lines 191-195) to call `deregister()`:

```ts
      } finally {
        deregister();
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useAICompletion.test.tsx`
Expected: PASS (all existing `useAICompletion` tests plus the new one).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useAICompletion.ts frontend/tests/hooks/useAICompletion.test.tsx
git commit -m "[story-editor-mxi] register inline-AI stream for session-reset abort"
```

---

### Task 5: Full-suite verify

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — all suites green, including the new `streamRegistry`, the extended `sessionReset`, and the two hook acceptance tests. (jsdom; no backend stack needed.)

- [ ] **Step 2: Typecheck the workspace**

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `make lint`
Expected: biome reports no errors on the changed files.

> Close-out is handled by `/bd-close-reviewed story-editor-mxi` (typecheck + path-matched surface reviewers + the `verify: cd frontend && npm test` line). Do not `bd close` directly.

---

## Self-Review

**Spec coverage:**
- New `streamRegistry.ts` module (spec §Components → New) — Task 1. ✓
- `abortAllStreams()` wired first into `resetClientState` (spec §Components → Modified sessionReset, ordering rationale) — Task 2. ✓
- Register/deregister in `useChat` (spec §Modified useChat) — Task 3. ✓
- Register/deregister in `useAICompletion` (spec §Modified useAICompletion) — Task 4. ✓
- Test slice 1 (streamRegistry unit) — Task 1 Step 1. ✓
- Test slice 2 (chokepoint integration) — Task 2 Step 1. ✓
- Test slice 3 (hook-level acceptance via `apiStream` mock + `ReadableStream`, per the corrected spec) — Task 3 Step 1. ✓
- Inline path acceptance (separate leak surface in the acceptance criteria) — Task 4 Step 1. ✓
- Post-abort tail safety: no new hook code required (spec §Post-abort async tail); the chat acceptance test asserts the no-resurrection property directly. ✓
- Out-of-scope items (telemetry, selective abort, BroadcastChannel) — not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command and expected outcome.

**Type consistency:** `registerStream(controller: AbortController): () => void` and `abortAllStreams(): void` are used identically in Tasks 1–4 and in all tests. Store action names (`appendDelta`, `reset`) match `chatDraft.ts`. `withClient()` returns `{ wrapper, qc }` as used in Task 3.
