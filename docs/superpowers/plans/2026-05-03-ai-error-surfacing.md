# AI Error Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI failures visible in the UI (debug-rich in dev, tasteful in prod) so the underlying chat/inline-AI bug can be diagnosed.

**Architecture:** Three-layer error surface — TanStack Query Devtools for query/mutation errors, a custom `useErrorStore` Zustand slice + `<DevErrorOverlay>` for the streaming `useAICompletion` hook + SSE error frames + handler guards, and a contextual `<InlineErrorBanner>` next to the broken feature. Backend complements this by always logging the real exception at AI-route catch sites and by including stack traces in non-production responses.

**Tech Stack:** React 18, TypeScript strict, Vite, Vitest, Zustand, TanStack Query (already used), `@tanstack/react-query-devtools` (new dep). Backend: Express, vitest + supertest.

**Spec:** [docs/superpowers/specs/2026-05-03-ai-error-surfacing-design.md](../specs/2026-05-03-ai-error-surfacing-design.md)

**Branch:** `debug/ai-integration` (already cut)

---

## File Structure

**New (frontend):**
- `frontend/src/lib/debug.ts` — `isDebugMode()`, `setDebugMode(on)`, plus `window.__inkwell.debug` for console toggling.
- `frontend/src/store/errors.ts` — Zustand slice: `errors`, `push`, `dismiss`, `clear`. Cap at 50.
- `frontend/src/components/DevErrorOverlay.tsx` — root-mounted error stack. Debug mode: full stack with `detail`. Prod mode: latest single error strip.
- `frontend/src/components/DevErrorOverlay.stories.tsx` — empty / single-error / debug-mode-expanded.
- `frontend/src/components/InlineErrorBanner.tsx` — contextual banner with `error / onRetry / onDismiss` props.
- `frontend/src/components/InlineErrorBanner.stories.tsx` — compact / with-retry / debug-raw-expanded.
- `frontend/tests/lib/debug.test.ts`
- `frontend/tests/store/errors.test.ts`
- `frontend/tests/components/DevErrorOverlay.test.tsx`
- `frontend/tests/components/InlineErrorBanner.test.tsx`

**Modified (frontend):**
- `frontend/src/App.tsx` — mount `<DevErrorOverlay />` and (gated on `isDebugMode()`) `<ReactQueryDevtools />`.
- `frontend/src/hooks/useAICompletion.ts` — every error branch publishes to `useErrorStore`.
- `frontend/src/components/InlineAIResult.tsx` — replace hardcoded "Couldn't generate" with `<InlineErrorBanner>`; accept `error` prop.
- `frontend/src/components/ChatMessages.tsx` — accept `sendError` + `onRetrySend`, render trailing banner on send failures.
- `frontend/src/pages/EditorPage.tsx` — pass `sendError` to `<ChatMessages>`; publish `no_chapter`/`no_chat`/`no_model` warns from `handleChatSend` guards.
- `frontend/src/lib/sse.ts` — comment-only (document `event.type === 'error'` contract).

**Modified (backend):**
- `backend/src/index.ts` — global error handler includes `stack` in non-production responses.
- `backend/src/lib/venice-errors.ts` — audit + fix SSE variant to always emit `{ error, code, message }` triple.
- `backend/src/routes/ai.routes.ts` — `console.error('[ai.<route>]', err)` at every catch site before delegating to mapper.
- `backend/src/routes/chat.routes.ts` — same.

**Modified (root tests):**
- `backend/tests/routes/error-handler.test.ts` — new file, asserts `stack` gating by `NODE_ENV`.
- `frontend/tests/components/InlineAIResult.test.tsx` — update existing test for new error copy.

**Modified (deps):**
- `frontend/package.json` — add `@tanstack/react-query-devtools` (latest stable).

---

## Conventions to follow

- **Test files live under `frontend/tests/` and `backend/tests/`, mirroring source paths** (not colocated). Pattern confirmed from existing repo.
- **Stories live alongside source** as `.stories.tsx`.
- **Backend tests** use `vitest` + `supertest`; mock via `vi.spyOn(prismaSingleton, ...)`.
- **Frontend store tests** use `@testing-library/react`'s `renderHook` and wrap mutations in `act()`. Tests must reset store state in `afterEach` (Zustand stores persist between tests in the same file).
- **No `any`.** TypeScript strict is on.
- **Commit after every passing test step**, using the format `[debug] <short description>` (matches the `debug/ai-integration` branch context).
- **Don't run `make test` for every step.** Each task has a targeted `vitest` invocation against just the file(s) under change. Full-suite runs once per Step (1–5) at the end.

---

## Step 1 — Backend audit + logging

Establishes the diagnostic baseline on the server. Frontend has no consumers yet.

### Task 1.1: Add a regression test for the global error handler's stack gating

**Files:**
- Create: `backend/tests/routes/error-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/routes/error-handler.test.ts
//
// Asserts the global error handler's NODE_ENV gating:
//   - `stack` is included in the JSON body when NODE_ENV !== 'production'
//   - `stack` is omitted when NODE_ENV === 'production'
//
// We can't install a route on the existing app easily, so we mount the same
// `globalErrorHandler` export onto a disposable Express instance and trigger
// a deliberate throw.

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globalErrorHandler } from '../../src/index';

function buildApp(): express.Express {
  const app = express();
  app.get('/boom', (_req, _res, next) => {
    next(new Error('kaboom'));
  });
  app.use(globalErrorHandler);
  return app;
}

describe('globalErrorHandler stack gating', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('includes a stack in the JSON body when NODE_ENV !== production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(typeof res.body.error.stack).toBe('string');
    expect(res.body.error.stack).toContain('kaboom');
  });

  it('omits stack when NODE_ENV === production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.message).toBe('Internal server error');
    expect('stack' in res.body.error).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/error-handler.test.ts`
Expected: FAIL — handler does not include `stack`.

- [ ] **Step 3: Update the error handler to include stack in non-production**

Edit `backend/src/index.ts`. Replace the body of `globalErrorHandler` (after the `NoVeniceKeyError` branch, lines ~134-141) with:

```ts
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd
    ? 'Internal server error'
    : err instanceof Error
      ? err.message
      : 'Internal server error';
  const body: { error: { message: string; code: string; stack?: string } } = {
    error: { message, code: 'internal_error' },
  };
  if (!isProd && err instanceof Error && typeof err.stack === 'string') {
    body.error.stack = err.stack;
  }
  res.status(500).json(body);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/routes/error-handler.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/tests/routes/error-handler.test.ts
git commit -m "[debug] include err.stack in non-prod global error responses"
```

### Task 1.2: Audit `venice-errors.ts` SSE variant — emit `{ error, code, message }` consistently

The HTTP variant of `mapVeniceError` already emits structured `{ error: { code, message } }`. The SSE variant `mapVeniceErrorToSse` emits `{ error: <code> }` only — `error` doubles as the code, and there's no human-readable `message` for most branches. The frontend ends up rendering the code as the message. Fix it so SSE frames always carry a separate `code` and `message`.

**Files:**
- Modify: `backend/src/lib/venice-errors.ts:211-253`
- Test: `backend/tests/lib/venice-errors.test.ts` (extend existing if present, otherwise create)

- [ ] **Step 1: Locate / create the test file**

Run: `ls backend/tests/lib/venice-errors.test.ts 2>/dev/null && echo EXISTS || echo MISSING`

If MISSING, create `backend/tests/lib/venice-errors.test.ts` with the imports skeleton:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AuthenticationError, RateLimitError } from 'openai';
import { mapVeniceErrorToSse } from '../../src/lib/venice-errors';
```

If EXISTS, just open it and add the new tests in the next step.

- [ ] **Step 2: Write the failing test for SSE shape**

Append to `backend/tests/lib/venice-errors.test.ts`:

```ts
describe('mapVeniceErrorToSse — uniform { error, code, message } shape', () => {
  function captureFrames(): { writes: string[]; write: (s: string) => void } {
    const writes: string[] = [];
    return { writes, write: (s) => { writes.push(s); } };
  }

  function parseFirstFrame(writes: string[]): unknown {
    const dataLine = writes[0]?.replace(/^data:\s*/, '').replace(/\n\n$/, '');
    return JSON.parse(dataLine ?? '{}');
  }

  it('AuthenticationError → { error, code, message } all populated', () => {
    const sink = captureFrames();
    const err = new AuthenticationError(401, { error: { message: 'bad key' } }, 'bad key', new Headers());
    const handled = mapVeniceErrorToSse(err, sink.write);
    expect(handled).toBe(true);
    const frame = parseFirstFrame(sink.writes) as Record<string, unknown>;
    expect(frame.code).toBe('venice_key_invalid');
    expect(typeof frame.error).toBe('string');
    expect(typeof frame.message).toBe('string');
    expect(String(frame.message).length).toBeGreaterThan(0);
  });

  it('RateLimitError → carries retryAfterSeconds + message', () => {
    const sink = captureFrames();
    const err = new RateLimitError(429, { error: { message: 'rl' } }, 'rl', new Headers({ 'retry-after': '30' }));
    const handled = mapVeniceErrorToSse(err, sink.write);
    expect(handled).toBe(true);
    const frame = parseFirstFrame(sink.writes) as Record<string, unknown>;
    expect(frame.code).toBe('venice_rate_limited');
    expect(typeof frame.message).toBe('string');
    expect(frame.retryAfterSeconds).toBe(30);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/lib/venice-errors.test.ts -t "uniform"`
Expected: FAIL — `frame.code` is undefined (current shape uses `error: <code>` only) and `frame.message` is undefined for the auth case.

- [ ] **Step 4: Update `mapVeniceErrorToSse` to emit `{ error, code, message }`**

Replace the body of `mapVeniceErrorToSse` in `backend/src/lib/venice-errors.ts` (lines ~211-253). Use the existing HTTP-variant messages as the source of truth so HTTP and SSE error bodies are consistent:

```ts
export function mapVeniceErrorToSse(
  err: unknown,
  write: (data: string) => void,
  userId?: string,
): boolean {
  if (!(err instanceof APIError)) return false;

  let code: string;
  let message: string;
  let retryAfterSeconds: number | null | undefined;

  if (err instanceof AuthenticationError) {
    console.error('[V11] Venice rejected key for user (SSE)', userId ?? '(unknown)');
    code = 'venice_key_invalid';
    message = 'Your Venice API key was rejected. Please update it in Settings.';
  } else if (err instanceof RateLimitError) {
    code = 'venice_rate_limited';
    message = 'Venice is rate limiting this request. Try again shortly.';
    retryAfterSeconds = parseRetryAfter(err.headers);
  } else if (err.status === 402) {
    code = 'venice_insufficient_balance';
    retryAfterSeconds = null;
    message =
      'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.';
  } else if (err.status === 502 || err.status === 503 || err.status === 504) {
    code = 'venice_unavailable';
    message = 'Venice is temporarily unavailable. Try again shortly.';
  } else {
    console.error(
      '[V11] Venice unexpected status (SSE)',
      err.status,
      'for user',
      userId ?? '(unknown)',
    );
    code = 'venice_error';
    message = 'Venice returned an unexpected error.';
  }

  const payload: Record<string, unknown> = { error: message, code, message };
  if (retryAfterSeconds !== undefined) payload.retryAfterSeconds = retryAfterSeconds;
  write(`data: ${JSON.stringify(payload)}\n\n`);
  write('data: [DONE]\n\n');
  return true;
}
```

Note: `error` is set to the human-readable `message` so the existing `useAICompletion` consumer (which reads `event.error.error` as the message) continues to render a useful string. The new structured `code` and `message` fields are additive.

- [ ] **Step 5: Run all venice-errors tests**

Run: `cd backend && npx vitest run tests/lib/venice-errors.test.ts`
Expected: PASS for the new tests AND any pre-existing tests in this file. If a pre-existing test asserted `frame.error === 'venice_key_invalid'`, update it to assert `frame.code === 'venice_key_invalid'` and `frame.error === <human message>`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/venice-errors.ts backend/tests/lib/venice-errors.test.ts
git commit -m "[debug] SSE error frames carry { error, code, message } triple"
```

### Task 1.3: Always `console.error(err)` at AI-route catch sites

Even with the structured response, the actual exception (TypeError, repo-decrypt failure, unknown-model) needs to be in server logs with a full stack — `mapVeniceError` only logs Venice errors, and only their status. Non-Venice exceptions currently get next(err)'d straight to the global handler which… now logs nothing (it returns the message in dev but doesn't `console.error`). Add the log at the catch site so all exceptions appear in `make logs`.

**Files:**
- Modify: `backend/src/routes/ai.routes.ts:87-89, 108-110, 341-345`
- Modify: `backend/src/routes/chat.routes.ts` (locate catch sites)

- [ ] **Step 1: Find every AI/chat catch site that calls `mapVeniceError` or `next(err)`**

Run: `grep -nE "next\(err\)|mapVeniceError" backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts`

Expected output identifies each site. There should be ~3 in `ai.routes.ts` (`/models`, `/balance`, `/complete`) and 1–2 in `chat.routes.ts` (the message-send route).

- [ ] **Step 2: Add `console.error` before `mapVeniceError` in `ai.routes.ts`**

For each catch block of the form:
```ts
} catch (err) {
  if (mapVeniceError(err, res, req.user!.id)) return;
  next(err);
}
```

Change to:
```ts
} catch (err) {
  console.error('[ai.<routeName>]', err);
  if (mapVeniceError(err, res, req.user!.id)) return;
  next(err);
}
```

Apply to all three handlers in `backend/src/routes/ai.routes.ts`:
- `/models` catch (currently around line 87): tag `'[ai.models]'`
- `/balance` catch (currently around line 108): tag `'[ai.balance]'`
- `/complete` outer catch (currently around line 341): tag `'[ai.complete]'`

For `/complete`'s inner `catch (streamErr)` (currently around line 323), prepend:
```ts
console.error('[ai.complete:stream]', streamErr);
```

- [ ] **Step 3: Same treatment for `chat.routes.ts`**

Identify each `catch (err)` that delegates to `mapVeniceError` / `next(err)` in `backend/src/routes/chat.routes.ts` and prepend the equivalent `console.error('[chat.<routeName>]', err);`. The mid-stream catch (if present) gets the `:stream` suffix.

- [ ] **Step 4: Verify backend builds and existing tests still pass**

Run: `cd backend && npm run typecheck && npm test -- tests/routes/ai tests/routes/chat`
Expected: PASS. (Test output may now include `console.error` lines from negative-path tests — that's fine; suppress only if tests explicitly assert log-quietness.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts
git commit -m "[debug] log full exception at AI/chat route catch sites"
```

### Task 1.4: Step-1 verification gate

- [ ] **Run the full backend test suite**

Run: `cd backend && npm run db:test:reset && npm test`
Expected: PASS, no new failures introduced.

---

## Step 2 — Frontend foundations: debug flag + error store + Devtools install

### Task 2.1: `lib/debug.ts` and unit test

**Files:**
- Create: `frontend/src/lib/debug.ts`
- Create: `frontend/tests/lib/debug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/lib/debug.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDebugMode, setDebugMode } from '@/lib/debug';

const STORAGE_KEY = 'inkwell:debug';

describe('isDebugMode / setDebugMode', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns true when import.meta.env.DEV is true', () => {
    vi.stubEnv('DEV', true);
    // Re-import not needed — debug.ts reads the env on call, not at import.
    expect(isDebugMode()).toBe(true);
  });

  it('returns true when localStorage opt-in is set, even if DEV is false', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(true);
    expect(isDebugMode()).toBe(true);
  });

  it('returns false when DEV is false and no opt-in', () => {
    vi.stubEnv('DEV', false);
    expect(isDebugMode()).toBe(false);
  });

  it('setDebugMode(false) clears the localStorage opt-in', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(true);
    setDebugMode(false);
    expect(isDebugMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/lib/debug.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/debug.ts`**

Create `frontend/src/lib/debug.ts`:

```ts
/**
 * Single-source debug-mode resolver.
 *
 * `isDebugMode()` returns true when either:
 *  - `import.meta.env.DEV` is true (Vite dev server / `vite build --mode development`)
 *  - `localStorage['inkwell:debug'] === '1'` (manual opt-in for inspecting a prod build)
 *
 * Read on every call — no module-level caching — so toggling via the
 * `setDebugMode` helper or directly from DevTools is reflected immediately.
 *
 * `window.__inkwell.debug` exposes `setDebugMode` for one-line console toggling.
 */

const STORAGE_KEY = 'inkwell:debug';

export function isDebugMode(): boolean {
  if (import.meta.env.DEV === true) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugMode(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Swallow — Safari private mode etc.
  }
}

// Expose a tiny console-driven toggle. Idempotent: re-import is safe.
declare global {
  interface Window {
    __inkwell?: { debug?: { set: (on: boolean) => void; get: () => boolean } };
  }
}

if (typeof window !== 'undefined') {
  window.__inkwell ??= {};
  window.__inkwell.debug = {
    set: setDebugMode,
    get: isDebugMode,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/lib/debug.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/debug.ts frontend/tests/lib/debug.test.ts
git commit -m "[debug] add lib/debug isDebugMode + setDebugMode"
```

### Task 2.2: `store/errors.ts` and unit test

**Files:**
- Create: `frontend/src/store/errors.ts`
- Create: `frontend/tests/store/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/store/errors.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useErrorStore } from '@/store/errors';

afterEach(() => {
  act(() => {
    useErrorStore.getState().clear();
  });
});

describe('useErrorStore', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useErrorStore());
    expect(result.current.errors).toEqual([]);
  });

  it('push adds an error with a generated id and timestamp; newest first', () => {
    const { result } = renderHook(() => useErrorStore());
    let id1 = '';
    let id2 = '';
    act(() => {
      id1 = result.current.push({
        severity: 'error',
        source: 'ai.complete',
        code: 'venice_key_invalid',
        message: 'first',
      });
      id2 = result.current.push({
        severity: 'warn',
        source: 'chat.send',
        code: 'no_model',
        message: 'second',
      });
    });
    expect(result.current.errors).toHaveLength(2);
    expect(result.current.errors[0].id).toBe(id2);
    expect(result.current.errors[0].message).toBe('second');
    expect(result.current.errors[1].id).toBe(id1);
    expect(typeof result.current.errors[0].at).toBe('number');
    expect(id1).not.toBe(id2);
  });

  it('dismiss removes the entry by id', () => {
    const { result } = renderHook(() => useErrorStore());
    let id = '';
    act(() => {
      id = result.current.push({
        severity: 'error',
        source: 'ai.complete',
        code: null,
        message: 'gone',
      });
    });
    act(() => {
      result.current.dismiss(id);
    });
    expect(result.current.errors).toEqual([]);
  });

  it('clear empties the store', () => {
    const { result } = renderHook(() => useErrorStore());
    act(() => {
      result.current.push({ severity: 'error', source: 'a', code: null, message: 'x' });
      result.current.push({ severity: 'error', source: 'b', code: null, message: 'y' });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.errors).toEqual([]);
  });

  it('caps at 50 entries; oldest dropped on overflow', () => {
    const { result } = renderHook(() => useErrorStore());
    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.push({
          severity: 'error',
          source: 'test',
          code: null,
          message: String(i),
        });
      }
    });
    expect(result.current.errors).toHaveLength(50);
    // Newest first: most recent push (54) at index 0.
    expect(result.current.errors[0].message).toBe('54');
    // Oldest survivor is push #5 (0..4 dropped).
    expect(result.current.errors[49].message).toBe('5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/store/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `store/errors.ts`**

Create `frontend/src/store/errors.ts`:

```ts
import { create } from 'zustand';

export type AppErrorSeverity = 'error' | 'warn' | 'info';

export interface AppError {
  id: string;
  at: number;
  severity: AppErrorSeverity;
  source: string;
  code: string | null;
  message: string;
  detail?: unknown;
  httpStatus?: number;
}

export interface ErrorStore {
  errors: AppError[];
  push(e: Omit<AppError, 'id' | 'at'>): string;
  dismiss(id: string): void;
  clear(): void;
}

const MAX_ENTRIES = 50;

function generateId(): string {
  // Prefer crypto.randomUUID when present (modern browsers + jsdom 22+).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — only matters in very old jsdom configs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  errors: [],
  push: (entry) => {
    const id = generateId();
    const next: AppError = { ...entry, id, at: Date.now() };
    set((state) => {
      const combined = [next, ...state.errors];
      const trimmed = combined.length > MAX_ENTRIES ? combined.slice(0, MAX_ENTRIES) : combined;
      return { errors: trimmed };
    });
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ errors: state.errors.filter((e) => e.id !== id) }));
  },
  clear: () => {
    set({ errors: [] });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/store/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/errors.ts frontend/tests/store/errors.test.ts
git commit -m "[debug] add useErrorStore zustand slice (cap 50)"
```

### Task 2.3: Install `@tanstack/react-query-devtools`

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`

- [ ] **Step 1: Confirm the latest stable version**

Run: `npm view @tanstack/react-query-devtools version`
Expected: prints a version string (e.g. `5.x.y`). Note it.

Cross-check that the major matches the project's existing `@tanstack/react-query`:
Run: `grep '"@tanstack/react-query"' frontend/package.json`
Expected: same major version.

If the majors don't match, **stop and ask** — Devtools must match Query's major (per CLAUDE.md "Stop and Ask" rule when adding a dep that introduces a major-version mismatch).

- [ ] **Step 2: Install (dev dependency)**

Run: `cd frontend && npm install --save-dev @tanstack/react-query-devtools`
Expected: clean install, lockfile updated.

- [ ] **Step 3: Verify build still passes**

Run: `cd frontend && npm run build`
Expected: clean build. (No code change yet — just confirming the install didn't break anything.)

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "[debug] install @tanstack/react-query-devtools"
```

### Task 2.4: Step-2 verification gate

- [ ] **Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS, no new failures.

---

## Step 3 — Surface components + root mount

### Task 3.1: `<InlineErrorBanner>` component, story, and unit test

**Files:**
- Create: `frontend/src/components/InlineErrorBanner.tsx`
- Create: `frontend/src/components/InlineErrorBanner.stories.tsx`
- Create: `frontend/tests/components/InlineErrorBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/InlineErrorBanner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { setDebugMode } from '@/lib/debug';

afterEach(() => {
  setDebugMode(false);
});

describe('<InlineErrorBanner>', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<InlineErrorBanner error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders code · message when error is set', () => {
    render(
      <InlineErrorBanner
        error={{ code: 'venice_key_invalid', message: 'Venice rejected the key.' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('venice_key_invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Venice rejected the key.');
  });

  it('omits code prefix when code is null', () => {
    render(<InlineErrorBanner error={{ code: null, message: 'Plain message.' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Plain message.');
    expect(alert).not.toHaveTextContent('null');
  });

  it('fires onRetry when Retry is clicked', async () => {
    const onRetry = vi.fn();
    render(
      <InlineErrorBanner
        error={{ code: 'x', message: 'y' }}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a Show raw toggle in debug mode that reveals detail', async () => {
    setDebugMode(true);
    render(
      <InlineErrorBanner
        error={{ code: 'x', message: 'y', detail: { foo: 1 }, httpStatus: 500 }}
      />,
    );
    const toggle = screen.getByRole('button', { name: /show raw/i });
    expect(screen.queryByTestId('inline-error-raw')).toBeNull();
    await userEvent.click(toggle);
    const raw = screen.getByTestId('inline-error-raw');
    expect(raw).toHaveTextContent('"foo": 1');
    expect(raw).toHaveTextContent('500');
  });

  it('omits Show raw toggle when not in debug mode', () => {
    setDebugMode(false);
    render(
      <InlineErrorBanner error={{ code: 'x', message: 'y', detail: { foo: 1 } }} />,
    );
    expect(screen.queryByRole('button', { name: /show raw/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/InlineErrorBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<InlineErrorBanner>`**

Create `frontend/src/components/InlineErrorBanner.tsx`:

```tsx
import { type JSX, useState } from 'react';
import { isDebugMode } from '@/lib/debug';

export interface InlineErrorBannerError {
  code: string | null;
  message: string;
  detail?: unknown;
  httpStatus?: number;
}

export interface InlineErrorBannerProps {
  error: InlineErrorBannerError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function InlineErrorBanner({
  error,
  onRetry,
  onDismiss,
}: InlineErrorBannerProps): JSX.Element | null {
  const [showRaw, setShowRaw] = useState(false);
  if (error === null) return null;

  const debug = isDebugMode();
  const headline =
    error.code !== null && error.code.length > 0
      ? `${error.code} · ${error.message}`
      : error.message;

  return (
    <div
      role="alert"
      data-testid="inline-error-banner"
      className="border border-[var(--danger)] bg-[var(--bg-sunken)] text-[var(--danger)] rounded-[var(--radius)] p-3 text-[12.5px] font-sans flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 leading-snug">{headline}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="px-2 py-0.5 rounded-[var(--radius)] border border-[var(--danger)] hover:bg-[var(--danger)] hover:text-bg text-[12px]"
          >
            Retry
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="px-2 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-[12px]"
          >
            ×
          </button>
        ) : null}
      </div>
      {debug ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setShowRaw((v) => !v);
            }}
            className="text-[11px] underline text-ink-3 hover:text-ink-2"
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </button>
          {showRaw ? (
            <pre
              data-testid="inline-error-raw"
              className="mt-1 p-2 bg-bg border border-line rounded-[var(--radius)] font-mono text-[11px] text-ink-2 whitespace-pre-wrap overflow-auto max-h-[240px]"
            >
              {JSON.stringify(
                {
                  code: error.code,
                  httpStatus: error.httpStatus,
                  detail: error.detail,
                },
                null,
                2,
              )}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/InlineErrorBanner.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the story**

Create `frontend/src/components/InlineErrorBanner.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { InlineErrorBanner } from './InlineErrorBanner';
import { setDebugMode } from '@/lib/debug';

const meta: Meta<typeof InlineErrorBanner> = {
  title: 'Errors/InlineErrorBanner',
  component: InlineErrorBanner,
};
export default meta;

type Story = StoryObj<typeof InlineErrorBanner>;

export const WithCodeAndMessage: Story = {
  args: {
    error: { code: 'venice_key_invalid', message: 'Your Venice API key was rejected.' },
  },
};

export const PlainMessage: Story = {
  args: {
    error: { code: null, message: 'Pick a model first.' },
  },
};

export const WithRetry: Story = {
  args: {
    error: { code: 'venice_unavailable', message: 'Venice is temporarily unavailable.' },
    onRetry: () => {
      // story-only
    },
  },
};

const DebugDecorator = (): React.ReactElement => {
  useEffect(() => {
    setDebugMode(true);
    return () => {
      setDebugMode(false);
    };
  }, []);
  return (
    <InlineErrorBanner
      error={{
        code: 'stream_error',
        message: 'The model stream errored mid-response.',
        httpStatus: 502,
        detail: { upstream: 'venice', frame: 'data: { ... }' },
      }}
      onRetry={() => {
        // story-only
      }}
    />
  );
};

export const DebugModeRawExpanded: Story = {
  render: () => <DebugDecorator />,
};
```

- [ ] **Step 6: Confirm Storybook builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/InlineErrorBanner.tsx \
        frontend/src/components/InlineErrorBanner.stories.tsx \
        frontend/tests/components/InlineErrorBanner.test.tsx
git commit -m "[debug] add InlineErrorBanner with debug-mode raw toggle"
```

### Task 3.2: `<DevErrorOverlay>` component, story, and unit test

**Files:**
- Create: `frontend/src/components/DevErrorOverlay.tsx`
- Create: `frontend/src/components/DevErrorOverlay.stories.tsx`
- Create: `frontend/tests/components/DevErrorOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/DevErrorOverlay.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DevErrorOverlay } from '@/components/DevErrorOverlay';
import { setDebugMode } from '@/lib/debug';
import { useErrorStore } from '@/store/errors';

afterEach(() => {
  act(() => {
    useErrorStore.getState().clear();
  });
  setDebugMode(false);
});

describe('<DevErrorOverlay>', () => {
  it('renders nothing when there are no errors', () => {
    setDebugMode(true);
    const { container } = render(<DevErrorOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a stack of all errors in debug mode', () => {
    setDebugMode(true);
    act(() => {
      useErrorStore.getState().push({
        severity: 'error',
        source: 'ai.complete',
        code: 'venice_key_invalid',
        message: 'first',
      });
      useErrorStore.getState().push({
        severity: 'warn',
        source: 'chat.send',
        code: 'no_model',
        message: 'second',
      });
    });
    render(<DevErrorOverlay />);
    expect(screen.getAllByTestId('dev-error-row')).toHaveLength(2);
    expect(screen.getByText(/first/)).toBeInTheDocument();
    expect(screen.getByText(/second/)).toBeInTheDocument();
  });

  it('renders only the latest severity:error as a strip in prod mode', () => {
    setDebugMode(false);
    act(() => {
      useErrorStore.getState().push({
        severity: 'warn',
        source: 'x',
        code: null,
        message: 'old warn',
      });
      useErrorStore.getState().push({
        severity: 'error',
        source: 'x',
        code: null,
        message: 'fresh error',
      });
      useErrorStore.getState().push({
        severity: 'info',
        source: 'x',
        code: null,
        message: 'newer info',
      });
    });
    render(<DevErrorOverlay />);
    const rows = screen.queryAllByTestId('dev-error-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('fresh error');
  });

  it('Dismiss removes a single entry', async () => {
    setDebugMode(true);
    let id = '';
    act(() => {
      id = useErrorStore.getState().push({
        severity: 'error',
        source: 'x',
        code: null,
        message: 'gone',
      });
    });
    render(<DevErrorOverlay />);
    await userEvent.click(screen.getByTestId(`dismiss-${id}`));
    expect(screen.queryAllByTestId('dev-error-row')).toHaveLength(0);
  });

  it('Clear all empties the store', async () => {
    setDebugMode(true);
    act(() => {
      useErrorStore.getState().push({ severity: 'error', source: 'x', code: null, message: 'a' });
      useErrorStore.getState().push({ severity: 'error', source: 'x', code: null, message: 'b' });
    });
    render(<DevErrorOverlay />);
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(useErrorStore.getState().errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/DevErrorOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<DevErrorOverlay>`**

Create `frontend/src/components/DevErrorOverlay.tsx`:

```tsx
import { type JSX, useState } from 'react';
import { isDebugMode } from '@/lib/debug';
import { type AppError, useErrorStore } from '@/store/errors';

/**
 * Root-mounted error stack.
 *
 * Debug mode (`isDebugMode() === true`):
 *   - Bottom-right collapsible stack of all current errors.
 *   - Each row shows source · code · message + a Dismiss control.
 *   - "Show raw" reveals the JSON detail / httpStatus.
 *   - "Clear all" empties the store.
 *
 * Prod mode:
 *   - Renders only the latest severity:'error' as a small dismissable strip.
 *   - No raw detail.
 */

function severityBadge(severity: AppError['severity']): { label: string; cls: string } {
  switch (severity) {
    case 'error':
      return { label: 'ERR', cls: 'text-[var(--danger)] border-[var(--danger)]' };
    case 'warn':
      return { label: 'WRN', cls: 'text-amber-500 border-amber-500' };
    default:
      return { label: 'INF', cls: 'text-ink-3 border-line' };
  }
}

interface RowProps {
  entry: AppError;
  debug: boolean;
  onDismiss: (id: string) => void;
}

function Row({ entry, debug, onDismiss }: RowProps): JSX.Element {
  const [showRaw, setShowRaw] = useState(false);
  const badge = severityBadge(entry.severity);
  const headline =
    entry.code !== null && entry.code.length > 0
      ? `${entry.code} · ${entry.message}`
      : entry.message;
  return (
    <div
      data-testid="dev-error-row"
      className="border border-line bg-bg rounded-[var(--radius)] p-2.5 text-[12px] font-sans flex flex-col gap-1.5 shadow"
    >
      <div className="flex items-start gap-2">
        <span
          className={`px-1 py-0 rounded text-[10px] font-mono uppercase border ${badge.cls}`}
        >
          {badge.label}
        </span>
        <span className="text-ink-4 text-[11px] font-mono">{entry.source}</span>
        {entry.httpStatus !== undefined ? (
          <span className="text-ink-4 text-[11px] font-mono">{entry.httpStatus}</span>
        ) : null}
        <span className="flex-1 leading-snug text-ink">{headline}</span>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid={`dismiss-${entry.id}`}
          onClick={() => {
            onDismiss(entry.id);
          }}
          className="px-1.5 py-0 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-ink-3"
        >
          ×
        </button>
      </div>
      {debug && entry.detail !== undefined ? (
        <div>
          <button
            type="button"
            className="text-[11px] underline text-ink-3 hover:text-ink-2"
            onClick={() => {
              setShowRaw((v) => !v);
            }}
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </button>
          {showRaw ? (
            <pre className="mt-1 p-2 bg-[var(--bg-sunken)] border border-line rounded-[var(--radius)] font-mono text-[11px] text-ink-2 whitespace-pre-wrap overflow-auto max-h-[240px]">
              {JSON.stringify(entry.detail, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DevErrorOverlay(): JSX.Element | null {
  const errors = useErrorStore((s) => s.errors);
  const dismiss = useErrorStore((s) => s.dismiss);
  const clear = useErrorStore((s) => s.clear);
  const [collapsed, setCollapsed] = useState(false);
  const debug = isDebugMode();

  if (errors.length === 0) return null;

  const visible: AppError[] = debug
    ? errors
    : (() => {
        const latestError = errors.find((e) => e.severity === 'error');
        return latestError ? [latestError] : [];
      })();

  if (visible.length === 0) return null;

  return (
    <aside
      aria-label="Error overlay"
      className="fixed bottom-3 right-3 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] flex flex-col gap-2"
    >
      {debug ? (
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-ink-3">
          <span>{`${String(visible.length)} error${visible.length === 1 ? '' : 's'}`}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setCollapsed((v) => !v);
              }}
              className="px-1.5 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              type="button"
              onClick={clear}
              className="px-1.5 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}
      {!collapsed
        ? visible.map((e) => <Row key={e.id} entry={e} debug={debug} onDismiss={dismiss} />)
        : null}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/DevErrorOverlay.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the story**

Create `frontend/src/components/DevErrorOverlay.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { DevErrorOverlay } from './DevErrorOverlay';
import { setDebugMode } from '@/lib/debug';
import { useErrorStore } from '@/store/errors';

const meta: Meta<typeof DevErrorOverlay> = {
  title: 'Errors/DevErrorOverlay',
  component: DevErrorOverlay,
};
export default meta;

type Story = StoryObj<typeof DevErrorOverlay>;

function Seeder({
  debug,
  seed,
}: {
  debug: boolean;
  seed: () => void;
}): React.ReactElement {
  useEffect(() => {
    setDebugMode(debug);
    useErrorStore.getState().clear();
    seed();
    return () => {
      useErrorStore.getState().clear();
      setDebugMode(false);
    };
  }, [debug, seed]);
  return <DevErrorOverlay />;
}

export const Empty: Story = {
  render: () => <Seeder debug={true} seed={() => undefined} />,
};

export const SingleError: Story = {
  render: () => (
    <Seeder
      debug={false}
      seed={() => {
        useErrorStore.getState().push({
          severity: 'error',
          source: 'ai.complete',
          code: 'venice_key_invalid',
          message: 'Your Venice API key was rejected.',
        });
      }}
    />
  ),
};

export const DebugStackWithRaw: Story = {
  render: () => (
    <Seeder
      debug={true}
      seed={() => {
        useErrorStore.getState().push({
          severity: 'error',
          source: 'ai.complete',
          code: 'stream_error',
          message: 'The model stream errored.',
          detail: { upstream: 'venice', status: 502 },
          httpStatus: 502,
        });
        useErrorStore.getState().push({
          severity: 'warn',
          source: 'chat.send',
          code: 'no_model',
          message: 'Pick a model first.',
        });
      }}
    />
  ),
};
```

- [ ] **Step 6: Confirm Storybook builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/DevErrorOverlay.tsx \
        frontend/src/components/DevErrorOverlay.stories.tsx \
        frontend/tests/components/DevErrorOverlay.test.tsx
git commit -m "[debug] add DevErrorOverlay (debug stack / prod strip)"
```

### Task 3.3: Mount overlay + Devtools in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update `App.tsx`**

Replace `frontend/src/App.tsx` with:

```tsx
import type { JSX } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { DevErrorOverlay } from '@/components/DevErrorOverlay';
import { isDebugMode } from '@/lib/debug';
import { AppRouter } from '@/router';

export function App(): JSX.Element {
  const debug = isDebugMode();
  return (
    <BrowserRouter>
      <AppRouter />
      <DevErrorOverlay />
      {debug ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: clean build. Spot-check `frontend/dist/assets/index-*.js` does NOT contain Devtools strings (the `isDebugMode()` runtime check means Vite can't tree-shake them in dev builds, but `npm run build` is a prod build by default — `import.meta.env.DEV` is false, so the gate is constant-folded only when the build's `mode` is `production`. The component still gets bundled because it's a runtime gate; this is acceptable. Bundle size delta should be ≤ ~30KB gzipped.)

Run a bundle-size sanity check:
`du -sh frontend/dist/assets/`
Compare against a recent main build (run `git stash; npm run build; du -sh frontend/dist/assets/; git stash pop` if uncertain). Acceptable if delta is ≤ ~50KB.

- [ ] **Step 3: Verify the existing app tests still pass**

Run: `cd frontend && npm test`
Expected: PASS, no regressions. (App-level tests like `routing.test.tsx` should still pass — the new mount is additive.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "[debug] mount DevErrorOverlay + ReactQueryDevtools at app root"
```

### Task 3.4: Step-3 verification gate

- [ ] **Run frontend test suite + Storybook build**

Run: `cd frontend && npm test && npm run build-storybook -- --quiet`
Expected: PASS, clean build.

---

## Step 4 — Wire AI streaming hook + inline AI surface

This is the step that makes the diagnostics useful for the underlying AI bug.

### Task 4.1: `useAICompletion` publishes errors to `useErrorStore`

**Files:**
- Modify: `frontend/src/hooks/useAICompletion.ts`
- Test: extend `frontend/tests/components/AIStream.test.tsx` (the existing test for this hook) — locate first.

- [ ] **Step 1: Confirm the existing test path**

The existing test for this hook is at `frontend/tests/components/AIStream.test.tsx`. Confirm:
`ls frontend/tests/components/AIStream.test.tsx`
Expected: file present.

- [ ] **Step 2: Add a failing test that asserts errors land in the store**

The existing file uses `vi.stubGlobal('fetch', fetchMock)` and a `jsonResponse(status, body)` helper. Append to `frontend/tests/components/AIStream.test.tsx`, inside the existing `describe('F15 · useAICompletion hook', ...)` block:

```tsx
  describe('publishes errors to useErrorStore', () => {
    beforeEach(() => {
      act(() => {
        useErrorStore.getState().clear();
      });
    });

    afterEach(() => {
      act(() => {
        useErrorStore.getState().clear();
      });
    });

    it('publishes a single entry on a 500 from /api/ai/complete', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, { error: { message: 'boom', code: 'internal_error' } }),
      );

      const { result } = renderHook(() => useAICompletion());

      await act(async () => {
        await result.current.run({
          action: 'continue',
          selectedText: 'sel',
          chapterId: 'ch1',
          storyId: 's1',
          modelId: 'm1',
        });
      });

      expect(result.current.status).toBe('error');
      const entries = useErrorStore.getState().errors;
      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe('ai.complete');
      expect(entries[0].code).toBe('internal_error');
      expect(entries[0].httpStatus).toBe(500);
      expect(entries[0].severity).toBe('error');
    });

    it('publishes on a mid-stream SSE error frame', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse([
          'data: {"error":"venice_key_invalid","code":"venice_key_invalid"}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const { result } = renderHook(() => useAICompletion());

      await act(async () => {
        await result.current.run({
          action: 'continue',
          selectedText: 'sel',
          chapterId: 'ch1',
          storyId: 's1',
          modelId: 'm1',
        });
      });

      expect(result.current.status).toBe('error');
      const entries = useErrorStore.getState().errors;
      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe('ai.complete');
      expect(entries[0].code).toBe('venice_key_invalid');
    });
  });
```

Add the import at the top of the file if missing:

```tsx
import { useErrorStore } from '@/store/errors';
```

The `act`, `renderHook` imports already exist at the top of the file. `jsonResponse` and `streamResponse` are already defined as helpers in the file.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run <located-test-file>`
Expected: FAIL — `errors.length` is 0; the hook doesn't push.

- [ ] **Step 4: Update `useAICompletion.ts` to publish on every error branch**

Edit `frontend/src/hooks/useAICompletion.ts`. Add the import at the top:

```ts
import { useErrorStore } from '@/store/errors';
```

Then, at the top of `run`, define a small helper:

```ts
const publish = (err: ApiError): void => {
  useErrorStore.getState().push({
    severity: 'error',
    source: 'ai.complete',
    code: err.code ?? null,
    message: err.message,
    httpStatus: err.status,
    detail: err,
  });
};
```

Call `publish(apiErr)` in **all four** error-state branches:
1. The pre-flight `apiStream` catch (currently `setState({status:'error', error:apiErr, ...})` around line 154-160).
2. The missing-body branch (around line 175-183), constructing a synthetic `ApiError`: `const apiErr = new ApiError(502, 'Empty response body'); publish(apiErr); ...`.
3. The mid-stream `event.type === 'error'` branch (around line 193-201): `const apiErr = new ApiError(502, event.error.error, code); publish(apiErr); ...`.
4. The outer for-await catch (around line 215-226): `publish(apiErr);`.

Each `publish` call goes immediately *after* the `safeSetState({status:'error', ...})` call (so the local UI updates synchronously, then the global store sees the same data).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run <located-test-file>`
Expected: PASS, including the new error-store assertion + all pre-existing tests for this hook.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useAICompletion.ts <located-test-file>
git commit -m "[debug] useAICompletion publishes errors to useErrorStore"
```

### Task 4.2: `<InlineAIResult>` renders `<InlineErrorBanner>` instead of generic copy

**Files:**
- Modify: `frontend/src/components/InlineAIResult.tsx`
- Test: `frontend/tests/components/InlineAIResult.test.tsx` (existing — update)

- [ ] **Step 1: Update the existing test for the new error UI**

Open `frontend/tests/components/InlineAIResult.test.tsx`. The existing tests likely assert the literal string `"Couldn't generate. Try again?"`. Update each such test to instead assert the InlineErrorBanner shape — e.g.:

```tsx
// Before:
// expect(screen.getByText("Couldn't generate. Try again?")).toBeInTheDocument();
// After:
expect(screen.getByTestId('inline-error-banner')).toBeInTheDocument();
expect(screen.getByRole('alert')).toHaveTextContent(/venice_key_invalid|Couldn't reach Venice/);
```

If the existing tests construct an `inlineAIResult` with `status: 'error'` but no `error` payload, extend the seed to include an `error: ApiError` object so the banner has something to render. The `inlineAIResult` store may need an `error` field added — check before assuming.

- [ ] **Step 2: Inspect the inline-AI store shape**

Run: `cat frontend/src/store/inlineAIResult.ts`
Note whether the store includes an `error` field. If not, add one — `error: { code: string | null; message: string; httpStatus?: number; detail?: unknown } | null` — and update its `setInlineAIResult` setter to accept the new field.

If the store needs extending, update `EditorPage.tsx`'s call sites (`setInlineAIResult({ action, text, status: 'error', output: '...' })`) to pass the error from `completion.error`. The error already exists on `completion.error` (an `ApiError`); the page just needs to pipe it through.

- [ ] **Step 3: Run the existing test — confirm it now fails on the new assertions**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx`
Expected: FAIL on the new assertions (banner not yet rendered).

- [ ] **Step 4: Update `<InlineAIResult>` to render the banner**

Replace the `status === 'error'` block in `frontend/src/components/InlineAIResult.tsx` (lines 108-112):

```tsx
      {status === 'error' && (
        <div className="mt-3">
          <InlineErrorBanner
            error={inlineAIResult.error ?? { code: null, message: "Couldn't generate." }}
            onRetry={onRetry}
          />
        </div>
      )}
```

Add the import at the top:

```ts
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
```

Remove the now-redundant Retry button from the action row when `status === 'error'` (the banner has its own Retry). Keep Discard. Adjust the `showActions` condition or split the row into "done shows full actions" / "error shows only Discard, banner has Retry".

Concretely, update the action-row section (lines 114-141) to:

```tsx
      {status === 'done' && (
        <div className="flex items-center gap-2 mt-4 text-[12px]">
          <button
            type="button"
            onClick={handleReplace}
            disabled={!canMutate}
            className={buttonClass}
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleInsertAfter}
            disabled={!canMutate}
            className={buttonClass}
          >
            Insert after
          </button>
          <button type="button" onClick={handleRetry} className={buttonClass}>
            Retry
          </button>
          <span className="flex-1" aria-hidden="true" />
          <button type="button" onClick={handleDiscard} className={discardClass}>
            Discard
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 mt-4 text-[12px]">
          <span className="flex-1" aria-hidden="true" />
          <button type="button" onClick={handleDiscard} className={discardClass}>
            Discard
          </button>
        </div>
      )}
```

Also drop the now-unused `showActions` variable.

- [ ] **Step 5: Run InlineAIResult tests**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx`
Expected: PASS (all updated assertions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InlineAIResult.tsx \
        frontend/src/store/inlineAIResult.ts \
        frontend/src/pages/EditorPage.tsx \
        frontend/tests/components/InlineAIResult.test.tsx
git commit -m "[debug] InlineAIResult shows InlineErrorBanner with real code+message"
```

(Include `EditorPage.tsx` and `inlineAIResult.ts` only if Step 2 required changes there.)

### Task 4.3: Step-4 verification gate

- [ ] **Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Manual smoke test (optional but recommended)**

Run `make dev`. Open the app, log in, trigger a selection-bubble AI action with a known-bad model id (or no Venice key). Confirm the inline-AI card shows a real `code · message` and the dev overlay shows the same in the bottom-right. Take a screenshot for the PR description.

---

## Step 5 — Wire chat surface

### Task 5.1: `<ChatMessages>` accepts `sendError` + `onRetrySend` and renders trailing banner

**Files:**
- Modify: `frontend/src/components/ChatMessages.tsx`
- Test: `frontend/tests/components/ChatMessages.test.tsx` (existing — extend)

- [ ] **Step 1: Add a failing test**

The existing file uses `mockMessages([...])`, `renderWithProviders(...)`, and a `makeMessage(over)` factory. Append, inside the existing `describe('ChatMessages (F39)', ...)` block:

```tsx
  describe('sendError', () => {
    it('renders InlineErrorBanner at the end when sendError is set; Retry fires onRetrySend', async () => {
      mockMessages([
        makeMessage({ id: 'm1', role: 'user', contentJson: 'hello' }),
        makeMessage({ id: 'm2', role: 'assistant', contentJson: 'hi' }),
      ]);
      const onRetry = vi.fn();
      renderWithProviders(
        <ChatMessages
          chatId="c1"
          sendError={new Error('venice_key_invalid · bad key')}
          onRetrySend={onRetry}
        />,
      );

      // Wait for the messages query to resolve so the banner sits at the
      // bottom of a real list rather than during the loading state.
      await screen.findByTestId('assistant-m2');

      const banner = screen.getByTestId('inline-error-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/venice_key_invalid · bad key/);

      await userEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render the banner when sendError is null', async () => {
      mockMessages([makeMessage({ id: 'm1', role: 'user', contentJson: 'hi' })]);
      renderWithProviders(<ChatMessages chatId="c1" sendError={null} />);
      await screen.findByText('hi');
      expect(screen.queryByTestId('inline-error-banner')).toBeNull();
    });
  });
```

The `within`, `userEvent`, `vi` imports already exist at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/ChatMessages.test.tsx -t "sendError"`
Expected: FAIL — props not yet supported, banner not rendered.

- [ ] **Step 3: Update `ChatMessages.tsx`**

Edit `frontend/src/components/ChatMessages.tsx`. Extend `ChatMessagesProps`:

```ts
export interface ChatMessagesProps {
  chatId: string | null;
  chapterTitle?: string | null;
  attachedCharacterCount?: number;
  attachedTokenCount?: number;
  onCopyMessage?: (id: string) => void;
  onRegenerateMessage?: (id: string) => void;
  onPickSuggestion?: (kind: SuggestionKind) => void;
  /** When set, renders an InlineErrorBanner at the end of the message list. */
  sendError?: Error | null;
  /** Wired to the banner's Retry button. */
  onRetrySend?: () => void;
}
```

Add the import at the top:

```ts
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
```

In the function body, after the `messages = query.data ?? []; const visible = ...` block and before the `return`, add a derived `bannerError`:

```ts
const bannerError =
  sendError != null
    ? { code: null, message: sendError.message }
    : null;
```

Then in the returned JSX, after the existing `<ContextChip ... />` and before the closing `</div>`, append:

```tsx
{bannerError ? (
  <div className="px-3 pb-3">
    <InlineErrorBanner
      error={bannerError}
      onRetry={onRetrySend}
    />
  </div>
) : null}
```

Update the function signature to destructure the two new props:

```tsx
export function ChatMessages({
  chatId,
  chapterTitle,
  attachedCharacterCount,
  attachedTokenCount,
  onCopyMessage,
  onRegenerateMessage,
  onPickSuggestion,
  sendError,
  onRetrySend,
}: ChatMessagesProps): JSX.Element {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/ChatMessages.test.tsx`
Expected: PASS (new tests + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatMessages.tsx \
        frontend/tests/components/ChatMessages.test.tsx
git commit -m "[debug] ChatMessages renders InlineErrorBanner on sendError"
```

### Task 5.2: `EditorPage.handleChatSend` publishes guard branches + passes `sendError` through

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`
- Test: extend an existing chat-related EditorPage test if one exists; otherwise add a focused one.

- [ ] **Step 1: Extract the guard logic into a small testable helper**

EditorPage has many integration dependencies (router, queries, providers); writing a full integration test for each guard is high-cost. Extract a pure helper instead so each guard branch can be tested in isolation.

Create `frontend/src/lib/chatSendGuards.ts`:

```ts
import type { Omit } from 'utility-types';
import type { AppError } from '@/store/errors';

/**
 * Pure guard for the chat-send flow. Returns null when the send may
 * proceed; otherwise returns the AppError shape that EditorPage should
 * publish to useErrorStore. Extracted from EditorPage.handleChatSend so
 * each guard branch is unit-testable without mounting the full page.
 */
export function checkChatSendGuards(input: {
  activeChapterId: string | null;
  selectedModelId: string | null;
}): Omit<AppError, 'id' | 'at'> | null {
  if (!input.activeChapterId) {
    return {
      severity: 'warn',
      source: 'chat.send',
      code: 'no_chapter',
      message: 'Open a chapter before sending a message.',
    };
  }
  if (input.selectedModelId === null) {
    return {
      severity: 'warn',
      source: 'chat.send',
      code: 'no_model',
      message: 'Pick a model in the chat panel first.',
    };
  }
  return null;
}
```

(`utility-types` is *not* a dependency — replace `import type { Omit }` with the built-in `Omit` from TypeScript by deleting the import line; built-in `Omit` works fine.)

- [ ] **Step 2: Write the failing test for the helper**

Create `frontend/tests/lib/chatSendGuards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkChatSendGuards } from '@/lib/chatSendGuards';

describe('checkChatSendGuards', () => {
  it('returns no_chapter when activeChapterId is null', () => {
    const result = checkChatSendGuards({ activeChapterId: null, selectedModelId: 'm1' });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('no_chapter');
    expect(result?.severity).toBe('warn');
    expect(result?.source).toBe('chat.send');
  });

  it('returns no_model when activeChapterId set but selectedModelId is null', () => {
    const result = checkChatSendGuards({ activeChapterId: 'ch1', selectedModelId: null });
    expect(result?.code).toBe('no_model');
    expect(result?.severity).toBe('warn');
  });

  it('returns null when both inputs are present (send may proceed)', () => {
    expect(checkChatSendGuards({ activeChapterId: 'ch1', selectedModelId: 'm1' })).toBeNull();
  });

  it('prioritises chapter check over model check', () => {
    const result = checkChatSendGuards({ activeChapterId: null, selectedModelId: null });
    expect(result?.code).toBe('no_chapter');
  });
});
```

- [ ] **Step 3: Run test to verify it passes (helper already implemented in Step 1)**

Run: `cd frontend && npx vitest run tests/lib/chatSendGuards.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run <chosen-test-file> -t "no_model"`
Expected: FAIL — no entry pushed.

- [ ] **Step 4: Update `EditorPage.handleChatSend` to publish on each guard via the helper**

Edit `frontend/src/pages/EditorPage.tsx`. Add the imports at the top:

```ts
import { checkChatSendGuards } from '@/lib/chatSendGuards';
import { useErrorStore } from '@/store/errors';
```

Replace the body of `handleChatSend` (currently lines 176-211) with:

```tsx
  const handleChatSend = useCallback(
    async (args: ChatSendArgs): Promise<void> => {
      const guard = checkChatSendGuards({ activeChapterId, selectedModelId });
      if (guard) {
        useErrorStore.getState().push(guard);
        return;
      }
      // After the guard, both fields are non-null. Narrow for TS.
      const chapterId = activeChapterId as string;
      const modelId = selectedModelId as string;

      let chatId = activeChatId;
      if (!chatId) {
        const created = await createChat.mutateAsync({ chapterId });
        chatId = created.id;
      }
      if (!chatId) {
        useErrorStore.getState().push({
          severity: 'warn',
          source: 'chat.send',
          code: 'no_chat',
          message: 'Could not create a chat — try again.',
        });
        return;
      }
      const attachment = args.attachment
        ? {
            selectionText: args.attachment.text,
            chapterId: args.attachment.chapter.id,
          }
        : undefined;
      lastChatSendArgsRef.current = args;
      const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
        chatId,
        content: args.content,
        modelId,
        enableWebSearch: args.enableWebSearch,
      };
      if (attachment) sendArgs.attachment = attachment;
      await sendChatMessage.mutateAsync(sendArgs);
      clearAttachedSelection();
    },
    [
      activeChapterId,
      activeChatId,
      createChat,
      selectedModelId,
      sendChatMessage,
      clearAttachedSelection,
    ],
  );
```

Note the reordered guards: model check now comes *before* chat creation, so we don't create an empty chat when the user has no model selected.

Also wire a retry handler — add right after `handleChatSend`. Declare `lastChatSendArgsRef` *above* `handleChatSend` so the callback can reach it:

```tsx
  const lastChatSendArgsRef = useRef<ChatSendArgs | null>(null);
  // ... existing handleChatSend block ...
  const handleRetryChatSend = useCallback((): void => {
    const last = lastChatSendArgsRef.current;
    if (!last) return;
    void handleChatSend(last);
  }, [handleChatSend]);
```

The `lastChatSendArgsRef.current = args;` line is recorded *only after* the guards pass and *only after* a chat exists — so users get a retryable record only for sends that actually attempted. (Pre-guard recording would let Retry blindly re-fire a guard-blocked send.)

Then at the `<ChatPanel>` mount (around line 630-639), update the `messagesBody` slot — wherever `<ChatMessages ... />` is currently rendered — to pass the new props:

```tsx
messagesBody={
  <ChatMessages
    /* ...existing props... */
    sendError={sendChatMessage.error}
    onRetrySend={handleRetryChatSend}
  />
}
```

(If `<ChatMessages>` is rendered elsewhere — e.g. inside an extracted sub-component — pipe the props there instead.)

- [ ] **Step 5: Run all affected tests**

Run: `cd frontend && npx vitest run tests/lib/chatSendGuards.test.ts && npx vitest run tests/components/ChatMessages.test.tsx && npx vitest run tests/components/ChatPanel.test.tsx`
Expected: PASS, no regressions.

If any pre-existing EditorPage test fails because of the reordered guards (e.g. it asserted that `createChat.mutateAsync` was called when `selectedModelId === null`), update the assertion — the new behaviour is correct.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/chatSendGuards.ts \
        frontend/src/pages/EditorPage.tsx \
        frontend/src/components/ChatMessages.tsx \
        frontend/tests/lib/chatSendGuards.test.ts \
        frontend/tests/components/ChatMessages.test.tsx
git commit -m "[debug] chat-send guards extracted + EditorPage publishes + sendError piped"
```

### Task 5.3: `lib/sse.ts` doc-comment

**Files:**
- Modify: `frontend/src/lib/sse.ts:14-19`

- [ ] **Step 1: Update the parser doc comment**

Find the existing block comment at the top of `frontend/src/lib/sse.ts` describing the `error` event and append a sentence:

```
 *   - `error`     — a mid-stream error frame
 *                   (`data: {"error":"...","code":"..."}`). The caller should
 *                   flip to an error state; no further chunks will be
 *                   emitted. **Consumers must publish to `useErrorStore`
 *                   so the error appears in the dev overlay** —
 *                   `useAICompletion` does this for `/api/ai/complete`;
 *                   the chat mutation relies on TanStack Query Devtools.
```

(Pure doc change. No tests, no behaviour change.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/sse.ts
git commit -m "[debug] document sse.ts error-frame publish contract"
```

### Task 5.4: Step-5 verification gate

- [ ] **Run the full frontend + backend test suites + Storybook build**

Run:
```bash
cd backend && npm test
cd ../frontend && npm test && npm run build-storybook -- --quiet && npm run build
```
Expected: PASS, clean.

- [ ] **Manual smoke test**

Run `make dev`. With model unset (clear `localStorage['inkwell:selectedModelId']` if needed), click Send in the chat composer. Confirm:
- A warn entry appears in the bottom-right overlay (`chat.send · no_model`).
- An InlineErrorBanner appears at the end of the chat message list with Retry.
- Set a model, click Send with a real prompt. Now the actual underlying error (whatever it is) appears in the overlay with the real `code · message` and (in debug mode) the full detail. **This is the diagnostic data Step 6 will use.**

---

## Step 6 — Diagnose & fix the underlying AI bug (out of scope; separate plan)

Once Steps 1–5 land, repro the chat-send and inline-AI failures in `make dev`. The dev overlay + TanStack Query Devtools + backend `console.error` stack will name the cause. Open a new branch off `main` (or off the merged `debug/ai-integration`), file a focused plan against whatever the diagnostics surface, fix it. **No design needed in advance.**

---

## Self-review

Spec coverage check (each spec section → task):

| Spec section | Implementing task |
|---|---|
| `lib/debug.ts` (`isDebugMode`, `setDebugMode`, `window.__inkwell.debug`) | Task 2.1 |
| `store/errors.ts` (push/dismiss/clear, cap-at-50) | Task 2.2 |
| `@tanstack/react-query-devtools` install + dev-only mount | Tasks 2.3 + 3.3 |
| `<DevErrorOverlay>` (debug stack / prod strip / collapse / clear all) | Task 3.2 |
| `<InlineErrorBanner>` (code · message + Retry + Show raw in debug) | Task 3.1 |
| `App.tsx` mount | Task 3.3 |
| `useAICompletion` publishes to store on every error branch | Task 4.1 |
| `<InlineAIResult>` swaps generic copy for `<InlineErrorBanner>` | Task 4.2 |
| `<ChatMessages>` accepts `sendError` + `onRetrySend` | Task 5.1 |
| `EditorPage.handleChatSend` guards publish + retry wiring | Task 5.2 (incl. extracted `lib/chatSendGuards.ts`) |
| `lib/sse.ts` doc-comment for SSE error contract | Task 5.3 |
| `index.ts` global handler `stack` gating | Task 1.1 |
| `venice-errors.ts` SSE `{ error, code, message }` audit | Task 1.2 |
| `ai.routes.ts` + `chat.routes.ts` `console.error` at catch sites | Task 1.3 |
| Step-by-step verify gates (Steps 1–5) | Tasks 1.4, 2.4, 3.4, 4.3, 5.4 |

No spec sections without a task. No tasks without a spec line.

Type / signature consistency:
- `AppError` shape defined in Task 2.2; consumed unchanged in Tasks 3.1 (`InlineErrorBanner` infers a structural subset), 3.2 (`DevErrorOverlay` Row), 4.1 (`useAICompletion.publish`), 5.2 (`EditorPage` guards).
- `InlineErrorBannerError` is a structural subset of `AppError` — both have `code`, `message`, optional `detail` and `httpStatus`. Compatible.
- `useErrorStore.push` returns `string` (id) per Task 2.2; Task 3.2 test asserts that contract.
- Backend `mapVeniceErrorToSse` post-Task-1.2 emits `{ error, code, message, retryAfterSeconds? }`; `useAICompletion`'s SSE `error` consumer (line 193-201, untouched) reads `event.error.error` and `event.error.code` — both still populated. (Task 4.1 only adds the `publish` call; doesn't change the existing `setState` shape.)

No placeholder / TBD / "implement later" lines remain.
