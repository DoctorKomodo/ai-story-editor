# Abort in-flight SSE streams on session transition (`story-editor-mxi`)

**Date:** 2026-06-02
**bd issue:** story-editor-mxi (sister bug to story-editor-7lo)
**Type:** bug — cross-account data leak
**Verify:** `cd frontend && npm test`

## Problem

`resetClientState` (landed by 7lo) resets the TanStack Query cache and the
per-user Zustand stores on every auth transition, but it does **not** abort
in-flight SSE streams. Both streaming surfaces own an `AbortController` that is
reachable only from inside their own closure:

- `frontend/src/hooks/useChat.ts` — `abortRef` created per send inside
  `mutationFn`; only the mutation's `stop()` can reach it.
- `frontend/src/hooks/useAICompletion.ts` — `controllerRef` created per `run`;
  only `cancel()`/`reset()` can reach it.

`resetClientState` calls `queryClient.cancelQueries()`, which cancels query
fetches but **not** these mutation-owned streams (mutations are not registered
with the QueryClient). So if a user logs out / signs out everywhere / deletes
their account / hits a terminal-401 mid-stream, the previous user's stream
keeps pushing tokens into `chatDraft` / `inlineAIResult` after the reset — the
reset wins the race against one chunk, and the next chunk repopulates the
freshly-reset store under the new session. For a narrative app where those
chunks are decrypted plaintext, that is a cross-account content leak.

## Approach

**Stream registry.** A module-level set of active stream `AbortController`s.
Each streaming hook registers its controller when a stream starts and
deregisters when it ends. `resetClientState` — the single chokepoint that
already runs on *all four* transition paths (login via `swapSession`, logout,
delete-account, terminal-401 via `resetClientStateUsingRegistered`) — aborts
every registered stream alongside `cancelQueries()`/`clear()`. Wiring the abort
into the one chokepoint means every path is covered without each hook
subscribing to session state.

This mirrors the established `registerSessionResetQueryClient` singleton
pattern but lives in its own module: it tracks *many* controllers (a Set), not
a single boot-registered value, so it is a distinct shape and a distinct
concern.

**Inherited caveat (terminal-401 path):** `resetClientStateUsingRegistered`
is a no-op if `registerSessionResetQueryClient` never ran at boot
(`sessionReset.ts:96-101`). Stream-abort inherits this exactly as cache-clear
does today — it is a pre-existing limitation, not a regression, and boot does
register the client.

Rejected alternative — *subscribe to session store from each hook*: more
idiomatic identity-scoped state, but distributes the rule across both hooks,
adds subscription lifecycle to manage, and races against the reset ordering.
The registry localizes the change to one chokepoint and two register call
sites.

## Components

### New: `frontend/src/lib/streamRegistry.ts`

Single purpose — track active stream controllers and abort them on demand. No
dependencies.

```ts
const active = new Set<AbortController>();

/** Register an active stream controller. Returns a deregister handle. */
export function registerStream(controller: AbortController): () => void {
  active.add(controller);
  return () => {
    active.delete(controller);
  };
}

/** Abort every registered stream and empty the registry. */
export function abortAllStreams(): void {
  for (const c of active) c.abort();
  active.clear();
}
```

`registerStream` returns its own deregister fn so callers never re-pass the
controller. A test-only reset of the set is unnecessary — `abortAllStreams`
already empties it, and each test creates fresh controllers.

### Modified: `frontend/src/lib/sessionReset.ts`

Abort streams **first**, before tearing down the stores those streams write
into:

```ts
export async function resetClientState(queryClient: QueryClient): Promise<void> {
  abortAllStreams();
  await queryClient.cancelQueries();
  queryClient.clear();
  for (const store of PER_USER_STORES) {
    store.getState().reset();
  }
}
```

Ordering rationale: aborting first stops any further chunk from landing in
`chatDraft` / `inlineAIResult`, both of which are reset at the end of the same
function. (`abortAllStreams` is synchronous; `cancelQueries` stays awaited as
today.)

### Modified: `frontend/src/hooks/useChat.ts`

In `mutationFn`, after `abortRef.current = controller`:

```ts
const deregister = registerStream(controller);
```

In the existing `finally`, call `deregister()` alongside the `abortRef`
cleanup.

### Modified: `frontend/src/hooks/useAICompletion.ts`

In `run`, after `controllerRef.current = controller`:

```ts
const deregister = registerStream(controller);
```

In the existing `finally`, call `deregister()` alongside the `controllerRef`
cleanup.

## Post-abort async tail (safety)

`runStreamingAI` / `parseAiSseStream` **return normally** on abort once the
stream is open — they do not throw. `sse.ts` short-circuits on
`signal.aborted` and treats an aborted `reader.read()` rejection as a clean
exit (`sse.ts:141`, `:143-148`); the `for await` in `streamingAI.ts` simply
ends and `runStreamingAI` resolves. An `AbortError` is thrown only if `fetch()`
itself is aborted *before* the stream opens (pre-stream / during-connect, via
`api.ts`).

When `abortAllStreams` fires:

- **`useChat` (mid-stream abort):** `runStreamingAI` returns normally, so the
  code proceeds to `useChatDraftStore.getState().markDone(chatId)`
  (`useChat.ts:221`) — it does **not** enter the `catch`. This runs *after*
  `resetClientState` already called `chatDraft.reset()`, and `markDone` is
  guarded to no-op on an absent draft (`chatDraft.ts`, `if (!cur) return s`).
- **`useChat` (pre-stream abort):** `runStreamingAI` throws `AbortError`, the
  `catch` calls `chatDraft.clear(chatId)` and returns; `clear` is likewise a
  no-op on an absent draft. Either tail is safe.
- **`useAICompletion`:** `run` checks `controller.signal.aborted` after
  `runStreamingAI` returns and bails without `setState` (`useAICompletion.ts:173`).
  `safeSetState` is independently gated by `mountedRef` as a second guard.
  Note the inline-AI surface writes its store **indirectly**: `useAICompletion`
  holds local `useState`, and `EditorPage` mirrors `completion.status`/`.text`
  into `inlineAIResultStore` via a `useEffect`. Freezing `completion.text` (by
  aborting) stops the mirror effect from firing, and `inlineAIResult.reset()`
  in the chokepoint wins.
- Each hook's `finally` then calls `deregister()`. The controller was already
  removed by `abortAllStreams`'s `active.clear()`, so `delete` is a harmless
  no-op.

Both hooks already handle abort correctly today — this change only makes the
controller reachable from the chokepoint. No new abort-handling code is needed
in the hooks.

## Testing

Verify line: `cd frontend && npm test` (jsdom; no backend stack required).

1. **`frontend/tests/lib/streamRegistry.test.ts` (new) — unit**
   - `registerStream` adds the controller; the returned handle removes it.
   - `abortAllStreams` calls `.abort()` on every registered controller and
     empties the set.
   - A deregistered controller is not aborted by a later `abortAllStreams`.
   - `abortAllStreams` on an empty set is a no-op (no throw).

2. **`frontend/tests/lib/sessionReset.test.ts` (extend) — chokepoint integration**
   - A controller registered via `registerStream` has `signal.aborted === true`
     after `resetClientState(qc)` resolves.

3. **Hook-level acceptance (matches the issue's acceptance criteria)**
   - Extend the existing `apiStream`-mock pattern, not a `runStreamingAI` mock:
     these suites mock `@/lib/api`'s `apiStream` and drive real bytes through
     the real `parseAiSseStream` (see the `stop()` test at
     `frontend/tests/hooks/useChat.test.tsx:196-237`, which already captures the
     `signal` and feeds a `ReadableStream`). Mocking `runStreamingAI` would
     bypass the real abort wiring (`sse.ts` reader-cancel) the test must prove.
   - Clone that harness: render `useSendChatMessageMutation`, enqueue one
     `data:` frame, `waitFor` the draft to be streaming → assert `appendDelta`
     fired once.
   - Call `resetClientState(qc)` mid-stream → assert the captured
     `signal.aborted === true` and that no further `appendDelta` lands.

Existing `useChat` / `useAICompletion` / `sessionReset` suites must stay green.

## Out of scope (YAGNI)

- No stream-count telemetry or active-stream introspection.
- No per-surface selective abort — every transition aborts **all** streams;
  there is no path where a stream should survive a session swap.
- No BroadcastChannel multi-tab coordination (that is a separate 7lo follow-up
  on the backlog).

## Acceptance

- After logout / sign-out-everywhere / delete-account / terminal-401
  mid-stream, no further chunks land in `chatDraft.drafts[*]` or
  `inlineAIResult` after the reset runs.
- Test drives the chat send mutation, simulates a logout while the stream is
  open, and asserts the `AbortController` was aborted and no further
  `appendDelta` calls occur after reset.
