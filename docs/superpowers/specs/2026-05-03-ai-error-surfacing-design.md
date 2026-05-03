# AI Error Surfacing — Design

**Date:** 2026-05-03
**Branch:** `debug/ai-integration`
**Status:** Spec — pending review before plan

---

## Problem

The AI integration is failing on multiple surfaces and the failures are silent or generic:

- **Chat send.** Pressing Send in the chat panel produces no response and no error. The frontend mutation throws but no `onError` exists in `EditorPage`; the SSE stream is drained-and-discarded so even partially-successful streams render nothing until the GET refetch.
- **Selection-bubble AI actions** (`rewrite`, `describe`, `expand`). The inline-AI card displays a hardcoded `"Couldn't generate. Try again?"` regardless of the actual error. `error.code` and `error.message` from the backend are discarded by the renderer.
- **Three silent-return branches** in `EditorPage.handleChatSend`: `!activeChapterId`, `!chatId` after create, and `selectedModelId === null` all return without telling the user.

The underlying AI bug is unknown because errors are swallowed before reaching the UI. We cannot fix what we cannot see, and the project has zero general-purpose error surfacing today (no toasts, no banners outside `LoginPage`, no `import.meta.env` branching).

## Goal

Establish a simple, app-wide error-surfacing convention so any backend error — AI or otherwise — reaches the developer in dev/debug builds and reaches the user as a tasteful, actionable message in prod. Then use that surfacing to find and fix the AI bug (separate follow-up plan).

## Non-Goals

- Fixing the underlying AI bug. Enabled by this work; not part of it.
- A full toast library (sonner, react-hot-toast). Adding a dependency for this is overkill.
- Sentry / external error reporting.
- A backend structured logger (`pino`, etc.). `console.error` is fine; just make sure it is complete.
- Refactoring `mapVeniceError` itself, beyond verifying its outputs are loud enough.
- Changing the `lib/api.ts` / `apiStream` contract — `ApiError` already carries status + code + message; we just need to actually display them.

## Approach

**Diagnostics-first.** Don't guess at the bug — make the system tell us. Lean on standard tools where they exist; build only the thin pieces missing.

**Three layers of surfacing:**

1. **TanStack Query Devtools** — primary surface for every `useQuery` / `useMutation` error. Already covers chat send, chat list, models, balance, settings, story/chapter CRUD. One-line install, dev-only mount.
2. **Custom `useErrorStore` Zustand slice + `<DevErrorOverlay>`** — covers the small set of errors Query doesn't see: the streaming `useAICompletion` hook, mid-stream SSE error frames (`event.type === 'error'`), and the silent-return branches in handlers.
3. **`<InlineErrorBanner>`** — contextual placement next to the broken feature (chat row footer, inline-AI card body). Reads the relevant mutation/hook state directly; no store coupling required for this part.

**Debug-mode flag.** A single `isDebugMode()` predicate driven by `import.meta.env.DEV || localStorage['inkwell:debug'] === '1'`. Used by both the overlay (full vs. compact display) and the inline banner ("Show raw" toggle). The localStorage opt-in lets us enable debug surfacing in a prod build temporarily without a rebuild.

**Opt-in publishing.** No auto-publish from `lib/api.ts`. Each non-Query caller — every error branch in the streaming hook plus the three handler guards in `EditorPage.handleChatSend` — decides what to push and tags `source` meaningfully.

**Backend side.** Three small changes:
- Audit `mapVeniceError` / `mapVeniceErrorToSse` so every emit produces a structured `{ error: { message, code } }` body (HTTP) or `{ error, code }` JSON frame (SSE). Fix any bare-string emit.
- Always `console.error('[<route>]', err)` at AI-route catch sites *before* delegating to the mapper, so the actual exception is in server logs even when a structured response is sent.
- Global error handler includes `stack: err.stack` in non-production responses; omits it in production.

## Architecture

### Frontend additions (new files)

**`frontend/src/lib/debug.ts`** — single-source debug-mode resolver.

```ts
export function isDebugMode(): boolean;     // true if import.meta.env.DEV || localStorage['inkwell:debug']==='1'
export function setDebugMode(on: boolean): void;  // writes/clears the localStorage key
```

Pure module, no React. Read by the error store and overlay; also exposed on `window.__inkwell.debug` for one-line console toggling.

**`frontend/src/store/errors.ts`** — Zustand slice. The app's single error spine for non-Query errors.

```ts
interface AppError {
  id: string;          // crypto.randomUUID()
  at: number;          // Date.now()
  severity: 'error' | 'warn' | 'info';
  source: string;      // 'ai.complete' | 'chat.send' | 'unknown'
  code: string | null; // backend code, e.g. 'venice_key_required'
  message: string;     // user-facing one-liner
  detail?: unknown;    // raw payload (response body, stack tail) — only shown in debug mode
  httpStatus?: number;
}

interface ErrorStore {
  errors: AppError[];                              // newest first, capped at 50
  push(e: Omit<AppError, 'id' | 'at'>): string;    // returns id
  dismiss(id: string): void;
  clear(): void;
}
```

Pure store — no DOM, no React. Tested in isolation.

**`frontend/src/components/DevErrorOverlay.tsx`** — root-mounted overlay.

- Hidden when not in debug mode *and* `errors.length === 0`.
- In **debug mode**: bottom-right collapsible stack of all current errors with full `detail` (pretty-printed JSON / stack), copy-to-clipboard button, dismiss / clear-all controls. Always visible while errors exist; can be force-collapsed to a small badge.
- In **prod mode**: only renders the most recent `severity: 'error'` as a small dismissable strip with `code · message` (no `detail`).
- Mounted once in `App.tsx` outside the routed tree so it survives navigation.

**`frontend/src/components/InlineErrorBanner.tsx`** — contextual inline banner.

```ts
interface InlineErrorBannerProps {
  error: { code: string | null; message: string; detail?: unknown; httpStatus?: number } | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}
```

Renders nothing if `error` is `null`. Always shows `code · message` and the optional Retry / Dismiss controls. In debug mode, exposes a "Show raw" toggle that expands `detail` and `httpStatus` for inspection.

### Frontend modifications

**`App.tsx`**
- Mount `<DevErrorOverlay />` at root.
- Conditionally mount `<ReactQueryDevtools initialIsOpen={false} />` when `isDebugMode()`. The import sits behind the gate so Vite tree-shakes it out of prod builds when the flag is dev-only.

**`hooks/useAICompletion.ts`**
- Every `setState({ status: 'error', ... })` branch additionally calls `useErrorStore.getState().push({ source: 'ai.complete', code, message, httpStatus, detail })`.
- Three branches: pre-flight `apiStream` throw, missing response body, mid-stream parse / SSE error frame.

**`hooks/useChat.ts`**
- *No error-store wiring.* TanStack Query Devtools covers the mutation. The mutation already throws on `event.type === 'error'`; that throw lands on `mutation.error`, which the inline banner reads, and on the Devtools panel.

**`components/InlineAIResult.tsx`**
- Replace the hardcoded `"Couldn't generate. Try again?"` string with `<InlineErrorBanner error={completion.error ? { ... } : null} onRetry={handleRetry} />`.
- Adapt `completion.error` (an `ApiError`) into the banner's `error` shape inline; no store push from this component (the hook already published).

**`components/ChatMessages.tsx`**
- Accept `sendError: Error | null` prop and `onRetrySend?: () => void`.
- Render `<InlineErrorBanner>` as a trailing pseudo-row when `sendError` is non-null.

**`pages/EditorPage.tsx`**
- Pass `sendError={sendChatMessage.error}` and `onRetrySend={...}` to `<ChatMessages>`.
- In `handleChatSend`'s three guard branches, publish a `severity: 'warn'` entry to the store with codes `no_chapter` / `no_chat` / `no_model` and a one-line user message ("Pick a model first." etc.). These are the only opt-in publishes outside the streaming hook.

**`lib/sse.ts`**
- No code change. Add a comment documenting that `event.type === 'error'` is the SSE in-band error frame and consumers must publish it.

### Backend modifications

**`backend/src/lib/venice-errors.ts`**
- Audit pass: every emit produces `{ error: { message, code } }` (HTTP) or `{ error: <string>, code: <string> }` (SSE). Fix any branch that emits a bare string. Likely a five-line change.

**`backend/src/index.ts` (global error handler)**
- When `process.env.NODE_ENV !== 'production'`, include `stack: err.stack` in the JSON body. Status code unchanged.

**`backend/src/routes/ai.routes.ts` + `backend/src/routes/chat.routes.ts`**
- At every catch site that delegates to `mapVeniceError` / `mapVeniceErrorToSse`, prepend `console.error('[<route-tag>]', err)` (full object, not just message) so the actual exception is in server logs even when a structured response is sent to the client.

### Data flow on a failed AI call

```
User clicks Send / triggers selection action
  → hook calls apiStream
  → backend route: catch (err) → console.error(err) → mapVeniceError → JSON body { error: { message, code } } (+ stack in dev)
  → frontend hook: catch → ApiError parsed → setState({status:'error', error})
                                            → useErrorStore.push({source, code, message, detail})
  → contextual UI: <InlineErrorBanner error={...} /> renders code · message
  → root: <DevErrorOverlay /> shows full detail (debug mode only)
  → TanStack Query Devtools: shows the mutation entry + its thrown error (mutation paths only)
```

### Files net

- **New:** `lib/debug.ts`, `store/errors.ts`, `components/DevErrorOverlay.tsx`, `components/InlineErrorBanner.tsx` (+ stories + tests).
- **Modified frontend:** `App.tsx`, `hooks/useAICompletion.ts`, `components/InlineAIResult.tsx`, `components/ChatMessages.tsx`, `pages/EditorPage.tsx`, `lib/sse.ts` (comment-only).
- **Modified backend:** `lib/venice-errors.ts` (audit), `routes/ai.routes.ts` + `routes/chat.routes.ts` (logging), `index.ts` (handler).
- **New deps:** `@tanstack/react-query-devtools` (frontend, install latest stable per CLAUDE.md deps rule). No backend deps.

## Build sequence

Sequencing principle: land foundations before consumers; each step has an independent verify so we can ship the diagnostics incrementally and start using them on the AI bug as soon as Step 4 is in.

### Step 1 — Backend audit + logging

- Audit `backend/src/lib/venice-errors.ts` for bare-string emits.
- Add `console.error('[<route-tag>]', err)` at AI-route catch sites.
- Update global error handler in `index.ts` to include `stack` in non-production responses.

**Verify:** `npm --prefix backend test` passes; new unit test asserts the error handler omits `stack` when `NODE_ENV=production` and includes it otherwise. Manual `curl` against a deliberately-broken request body confirms the JSON shape.

### Step 2 — Frontend foundations

- Add `lib/debug.ts` + unit tests.
- Add `store/errors.ts` + unit tests (push, cap-at-50, dismiss, clear).
- Install `@tanstack/react-query-devtools` (after `npm view @tanstack/react-query-devtools version` per the deps rule).

**Verify:** `npm --prefix frontend test` green; `npm --prefix frontend run build` clean (proves Devtools tree-shakes when not mounted in the prod path).

### Step 3 — Surface components + root mount

- Add `components/DevErrorOverlay.tsx` + story.
- Add `components/InlineErrorBanner.tsx` + story.
- Mount `<DevErrorOverlay />` and conditionally `<ReactQueryDevtools initialIsOpen={false} />` in `App.tsx` (gated on `isDebugMode()`).

**Verify:** `npm --prefix frontend run storybook` shows both stories rendering at all states; `npm --prefix frontend run build-storybook -- --quiet` clean; `npm --prefix frontend test` green.

### Step 4 — Wire AI streaming hook + inline AI surface

(This is when the diagnostics become useful for the underlying bug.)

- `hooks/useAICompletion.ts` publishes to the store on every error branch.
- `components/InlineAIResult.tsx` swaps the hardcoded string for `<InlineErrorBanner>`.

**Verify:** unit test asserts a failed `apiStream` call lands one entry in the store; existing inline-AI tests updated for the new copy.

### Step 5 — Wire chat surface

- `components/ChatMessages.tsx` accepts `sendError` + `onRetrySend`.
- `pages/EditorPage.tsx` passes `sendChatMessage.error` and a retry handler; publishes the three guard branches to the store.

**Verify:** `npm --prefix frontend test`; manual: send chat with no model → warn entry appears in overlay + inline banner appears in chat.

### Step 6 — Diagnose & fix the actual AI bug (separate plan, separate branch)

- With Steps 1–5 landed, repro the chat-send failure in dev. Devtools panel + DevErrorOverlay + backend stack trace will name the cause.
- Patch the named cause. Verify both surfaces work end-to-end.
- This step intentionally has no design — its work is determined entirely by what Step 4/5 surface tells us.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Devtools bundle leaks into prod build | Gate the import + mount on `isDebugMode()`; verify with a `build` step that bundle size doesn't regress. |
| Error-store unbounded memory growth | Cap at 50 entries; oldest dropped on push. |
| Backend stack leakage to prod responses | Strictly gated on `NODE_ENV !== 'production'`; covered by a new unit test on the error handler. |
| Concurrent mutations producing dueling banners | Inline banner reads only the latest mutation error; older errors only live in the overlay. |
| `<DevErrorOverlay>` covering UI in prod mode | In prod, only the latest `severity: 'error'` renders as a small dismissable strip; bottom-right placement avoids the chat panel and modals. Easy to relocate if it bites. |

## PR shape

One PR on `debug/ai-integration` (already cut). Per F-series memory ("bundle F-series PRs"), Steps 1–5 land in the same PR. Step 6 ships separately on a follow-up branch once we know the cause from Step 4/5 diagnostics.

## Testing

- **Unit:** `lib/debug.test.ts`, `store/errors.test.ts`, error-handler `stack` gating test (backend).
- **Component / story:** `DevErrorOverlay.stories.tsx` (empty / single error / debug-mode raw expanded), `InlineErrorBanner.stories.tsx` (compact / with retry / debug-mode raw expanded).
- **Integration:** extend the existing `useAICompletion` test to assert error → store push.
- **No live Venice tests.** This work doesn't touch the L-series probe path.
