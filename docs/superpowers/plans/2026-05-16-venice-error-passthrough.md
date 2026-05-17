# Venice Error Passthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship richer Venice error UX: thread Venice's raw error text through to the GUI, render per-code affordances (rate-limit countdown, "Open Settings", "Top up credits"), unify all Venice-error logging behind a single structured `[venice.error]` tag, fix the broken `venice_key_required` headline, and consolidate the error-code docs.

**Architecture:** Backend side, `mapVeniceError` is refactored to mirror `mapVeniceErrorToSse`'s hoisted-locals shape so a single structured `[venice.error]` log call covers all branches; both mappers take a `ctx: { userId, route }` param; `details.veniceMessage` is included on every branch. Frontend side, a new `VeniceErrorBanner` wraps the existing generic `InlineErrorBanner` and switches on the error code to render per-code affordances; a small Zustand slice lets `VeniceErrorBanner` open the Settings modal without prop drilling.

**Tech Stack:** Backend: Express + openai SDK (`AuthenticationError` / `RateLimitError` / `APIError`) + vitest. Frontend: React + TypeScript + Zustand + Tailwind + vitest + Storybook.

**Reference spec:** `docs/superpowers/specs/2026-05-16-venice-error-passthrough-design.md`.

---

## File Structure

**Backend (modify):**
- `backend/src/lib/venice-errors.ts` — structural refactor + `ctx` param + always-include `veniceMessage` + log-tag rename + structured payload + 6 new log call-sites
- `backend/src/routes/ai.routes.ts` — 3 callsites pass new `ctx`
- `backend/src/routes/chat.routes.ts` — 2 callsites pass new `ctx`
- `backend/src/index.ts` — friendly `venice_key_required` message
- `backend/tests/lib/venice-errors.test.ts` — extend (signature, veniceMessage on every branch, console.error spy assertions)

**Frontend (new):**
- `frontend/src/store/settingsModal.ts` — Zustand slice
- `frontend/tests/store/settingsModal.test.ts` — slice unit tests
- `frontend/src/components/VeniceErrorBanner.tsx` — wrapper component
- `frontend/src/components/VeniceErrorBanner.stories.tsx` — Storybook stories (alongside source)
- `frontend/tests/components/VeniceErrorBanner.test.tsx` — component tests (under `frontend/tests/`)

**Frontend (modify):**
- `frontend/src/store/inlineAIResult.ts` — widen `InlineAIResultError`
- `frontend/src/pages/EditorPage.tsx` — flattener extension + Zustand slice migration (drop two `useState` decls, migrate 5 setter callsites + 1 mount)
- `frontend/src/components/InlineAIResult.tsx` — swap `<InlineErrorBanner>` → `<VeniceErrorBanner>`
- `frontend/src/components/messageRow/TranscriptView.tsx` — widen `sendError` prop type, update banner-error builder, swap only the send-error banner
- `frontend/src/components/SceneTab.tsx` + `frontend/src/components/ChatTab.tsx` — confirm mutation-hook generics (probably no change)

**Docs:**
- `docs/venice-integration.md` — full replacement of "Error Handling" section
- `docs/api-contract.md` — line 12 pointer update

---

## Task 1: Backend — friendly `venice_key_required` message

**Files:**
- Modify: `backend/src/index.ts:149`
- Test: existing route tests that assert the response body shape on the 409 path

- [ ] **Step 1: Identify any existing test asserting the broken message string**

Run: `grep -rn "venice_key_required" backend/tests | grep -v "code:"`

If any test asserts `message: 'venice_key_required'` as the response body's message field (not the code), it'll need updating in Step 4. The point of this check is to know what to expect.

- [ ] **Step 2: Apply the message fix**

Edit `backend/src/index.ts:149` — change only the `message` field; the `code` stays:

```ts
if (err instanceof NoVeniceKeyError) {
  res.status(409).json({
    error: {
      message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
      code: 'venice_key_required',
    },
  });
  return;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm -w story-editor-backend run typecheck`
Expected: PASS

- [ ] **Step 4: Update any test that asserted the old message string**

For any hits from Step 1 that asserted the literal message string, update to the new string. Tests that assert only on `code` need no change.

- [ ] **Step 5: Run the affected backend tests**

Run: `npm -w story-editor-backend test -- tests/routes/ai tests/routes/chat`
Expected: PASS (assuming `make dev` is up — the backend test globalSetup requires Postgres).

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts backend/tests
git commit -m "[c0c] backend: friendly venice_key_required headline message"
```

---

## Task 2: Backend — refactor `venice-errors.ts` + update route callsites

This is the biggest task. The work is interlocking — the signature change cascades through 5 callsites and ~30+ test invocations, so it has to land together for typecheck to stay green.

**Files:**
- Modify: `backend/src/lib/venice-errors.ts`
- Modify: `backend/src/routes/ai.routes.ts` (callsites at lines 59, 320, 337)
- Modify: `backend/src/routes/chat.routes.ts` (callsites at lines 619, 636)
- Modify: `backend/tests/lib/venice-errors.test.ts`

- [ ] **Step 1: Write the failing assertions in the test file**

In `backend/tests/lib/venice-errors.test.ts`, do four things:

a) Update the existing `describe('mapVeniceError — 402 INSUFFICIENT_BALANCE')` block and any other branch tests to pass the new `ctx` shape. Replace bare `userId` arguments with `{ userId: '...', route: 'ai-complete' }`.

b) Add a new `describe` block asserting `details.veniceMessage` is now present on the auth / rate-limit / insufficient-balance / unavailable branches when Venice supplied a body. Example shape for one case:

```ts
describe('mapVeniceError — details.veniceMessage on every branch', () => {
  it('AuthenticationError includes details.veniceMessage when Venice body has one', () => {
    const headers = new Headers();
    const err = new AuthenticationError(
      401,
      { error: { message: 'Bad key xyz', type: 'invalid_request_error' } },
      '401 Unauthorized',
      headers,
    );
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    mapVeniceError(err, res, { userId: 'u1', route: 'ai-complete' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'venice_key_invalid',
          details: { veniceMessage: 'Bad key xyz' },
        }),
      }),
    );
  });

  it('RateLimitError includes details.veniceMessage when present', () => {
    const headers = new Headers({ 'retry-after': '30' });
    const err = new RateLimitError(
      429,
      { error: { message: 'Slow down', type: 'rate_limit' } },
      '429',
      headers,
    );
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    mapVeniceError(err, res, { userId: 'u1', route: 'chat' });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'venice_rate_limited',
          retryAfterSeconds: 30,
          details: { veniceMessage: 'Slow down' },
        }),
      }),
    );
  });

  it('5xx unavailable branch includes details.veniceMessage when present', () => {
    const err = new APIError(
      503,
      { error: { message: 'Upstream busy' } },
      '503',
      new Headers(),
    );
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    mapVeniceError(err, res, { userId: 'u1', route: 'ai-complete' });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'venice_unavailable',
          details: { veniceMessage: 'Upstream busy' },
        }),
      }),
    );
  });

  it('omits details.veniceMessage when Venice body has no message', () => {
    const err = new RateLimitError(429, undefined, '429', new Headers());
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    mapVeniceError(err, res, { userId: 'u1', route: 'chat' });

    const call = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect((call as { error: { details?: unknown } }).error.details).toBeUndefined();
  });
});
```

c) Add a `describe` block asserting the `[venice.error]` log shape via a `console.error` spy:

```ts
describe('mapVeniceError — structured [venice.error] log', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('emits one [venice.error] line per call with structured payload', () => {
    const err = new RateLimitError(
      429,
      { error: { message: 'Slow' } },
      '429',
      new Headers({ 'retry-after': '15' }),
    );
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    mapVeniceError(err, res, { userId: 'u1', route: 'ai-complete' });

    const veniceLogCalls = errorSpy.mock.calls.filter(
      (c) => c[0] === '[venice.error]',
    );
    expect(veniceLogCalls).toHaveLength(1);
    const payload = JSON.parse(veniceLogCalls[0]?.[1] as string);
    expect(payload).toMatchObject({
      route: 'ai-complete',
      userId: 'u1',
      code: 'venice_rate_limited',
      upstreamStatus: 429,
      retryAfterSeconds: 15,
      veniceMessage: 'Slow',
      streaming: false,
    });
  });

  it('SSE variant emits streaming: true', () => {
    const err = new AuthenticationError(
      401,
      { error: { message: 'Bad key' } },
      '401',
      new Headers(),
    );
    const writes: string[] = [];

    mapVeniceErrorToSse(err, (data) => writes.push(data), {
      userId: 'u1',
      route: 'chat',
    });

    const veniceLogCalls = errorSpy.mock.calls.filter(
      (c) => c[0] === '[venice.error]',
    );
    expect(veniceLogCalls).toHaveLength(1);
    expect(JSON.parse(veniceLogCalls[0]?.[1] as string)).toMatchObject({
      streaming: true,
      code: 'venice_key_invalid',
      route: 'chat',
    });
  });

  it('regression: the legacy [V11] tag does not appear in any mapper call', () => {
    const err = new APIError(503, undefined, '503', new Headers());
    mapVeniceError(err, {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response, { userId: 'u1', route: 'ai-complete' });

    const legacyCalls = errorSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).startsWith('[V11]'),
    );
    expect(legacyCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test file — expect failures**

Run: `npm -w story-editor-backend test -- tests/lib/venice-errors`
Expected: FAIL — `mapVeniceError(err, res, userId)` signature won't accept `{ userId, route }`; the existing branches don't include `details.veniceMessage` on auth / rate-limit / insufficient-balance / unavailable; the `[venice.error]` log line doesn't exist yet.

- [ ] **Step 3: Refactor `mapVeniceError` to mirror `mapVeniceErrorToSse`**

Rewrite `backend/src/lib/venice-errors.ts`. The new shape (annotated, full body):

```ts
import type { Response } from 'express';
import { APIError, AuthenticationError, RateLimitError } from 'openai';

export { AuthenticationError, RateLimitError } from 'openai';

type SdkHeaders = Headers | Record<string, string | null | undefined>;

// ... readHeader, parseResetHeader, parseRetryAfter, sanitiseVeniceMessage,
//     extractVeniceMessage — unchanged from current implementation.

export interface VeniceErrorBody {
  error: {
    code: string;
    message: string;
    retryAfterSeconds?: number | null;
    details?: { veniceMessage?: string };
  };
}

export interface VeniceErrorContext {
  userId: string | undefined;
  route: 'ai-models' | 'ai-complete' | 'chat';
}

interface MappedError {
  httpStatus: number;
  code: string;
  message: string;
  retryAfterSeconds: number | null;  // null when N/A (not undefined — keeps JSON shape stable)
}

function classify(err: APIError): MappedError {
  if (err instanceof AuthenticationError) {
    return {
      httpStatus: 400,
      code: 'venice_key_invalid',
      message: 'Your Venice API key was rejected. Please update it in Settings.',
      retryAfterSeconds: null,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      httpStatus: 429,
      code: 'venice_rate_limited',
      message: 'Venice is rate limiting this request. Try again shortly.',
      retryAfterSeconds: parseRetryAfter(err.headers),
    };
  }
  if (err.status === 402) {
    return {
      httpStatus: 402,
      code: 'venice_insufficient_balance',
      message:
        'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.',
      retryAfterSeconds: null,
    };
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) {
    return {
      httpStatus: 502,
      code: 'venice_unavailable',
      message: 'Venice is temporarily unavailable. Try again shortly.',
      retryAfterSeconds: null,
    };
  }
  if (err.status === 400 || err.status === 404 || err.status === 422) {
    return {
      httpStatus: err.status,
      code: 'venice_error',
      message: 'Venice rejected the request.',
      retryAfterSeconds: null,
    };
  }
  return {
    httpStatus: 502,
    code: 'venice_error',
    message: 'Venice returned an unexpected error.',
    retryAfterSeconds: null,
  };
}

function logVeniceError(
  ctx: VeniceErrorContext,
  classified: MappedError,
  upstreamStatus: number,
  veniceMessage: string | undefined,
  streaming: boolean,
): void {
  console.error(
    '[venice.error]',
    JSON.stringify({
      route: ctx.route,
      userId: ctx.userId ?? null,
      code: classified.code,
      upstreamStatus,
      retryAfterSeconds: classified.retryAfterSeconds,
      veniceMessage: veniceMessage ?? null,
      streaming,
    }),
  );
}

export function mapVeniceError(
  err: unknown,
  res: Response,
  ctx: VeniceErrorContext,
): boolean {
  if (!(err instanceof APIError)) return false;

  const classified = classify(err);
  const rawMessage = extractVeniceMessage(err);
  const veniceMessage = rawMessage ? sanitiseVeniceMessage(rawMessage) : undefined;

  const includeRetryAfter =
    classified.code === 'venice_rate_limited' ||
    classified.code === 'venice_insufficient_balance';

  const body: VeniceErrorBody = {
    error: {
      code: classified.code,
      message: classified.message,
      ...(includeRetryAfter ? { retryAfterSeconds: classified.retryAfterSeconds } : {}),
      ...(veniceMessage ? { details: { veniceMessage } } : {}),
    },
  };

  logVeniceError(ctx, classified, err.status, veniceMessage, false);
  res.status(classified.httpStatus).json(body);
  return true;
}

export function mapVeniceErrorToSse(
  err: unknown,
  write: (data: string) => void,
  ctx: VeniceErrorContext,
): boolean {
  if (!(err instanceof APIError)) return false;

  const classified = classify(err);
  const rawMessage = extractVeniceMessage(err);
  const veniceMessage = rawMessage ? sanitiseVeniceMessage(rawMessage) : undefined;

  const includeRetryAfter =
    classified.code === 'venice_rate_limited' ||
    classified.code === 'venice_insufficient_balance';

  const payload: Record<string, unknown> = {
    error: classified.message,
    code: classified.code,
    message: classified.message,
  };
  if (includeRetryAfter) payload.retryAfterSeconds = classified.retryAfterSeconds;
  if (veniceMessage) payload.details = { veniceMessage };

  logVeniceError(ctx, classified, err.status, veniceMessage, true);
  write(`data: ${JSON.stringify(payload)}\n\n`);
  write('data: [DONE]\n\n');
  return true;
}
```

Note: the `retryAfterSeconds` field is included in the response body for `venice_rate_limited` (with the parsed value or `null` if unparseable) and `venice_insufficient_balance` (always `null`) to keep the field stable per the existing V24 behavior. Other branches omit it (preserves backward compat).

The 5 existing `console.error('[V11] …')` lines are removed; the single `logVeniceError` helper called per mapper invocation produces the structured `[venice.error]` line.

- [ ] **Step 4: Update the 5 route callsites**

`backend/src/routes/ai.routes.ts`:
- Line 59: `if (mapVeniceError(err, res, req.user!.id)) return;` → `if (mapVeniceError(err, res, { userId: req.user!.id, route: 'ai-models' })) return;`
- Line 320 (SSE): `const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), userId);` → `const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), { userId, route: 'ai-complete' });`
- Line 337: `if (mapVeniceError(err, res, userId)) return;` → `if (mapVeniceError(err, res, { userId, route: 'ai-complete' })) return;`

`backend/src/routes/chat.routes.ts`:
- Line 619 (SSE): `const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), userId);` → `const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), { userId, route: 'chat' });`
- Line 636: `if (mapVeniceError(err, res, userId)) return;` → `if (mapVeniceError(err, res, { userId, route: 'chat' })) return;`

- [ ] **Step 5: Run typecheck**

Run: `npm -w story-editor-backend run typecheck`
Expected: PASS — all 5 callsites + tests now pass the `ctx` shape.

- [ ] **Step 6: Run the venice-errors tests**

Run: `npm -w story-editor-backend test -- tests/lib/venice-errors`
Expected: PASS — all branches now include `details.veniceMessage` when the Venice body has one, structured `[venice.error]` log shape lines up, no `[V11]` left in mapper output.

- [ ] **Step 7: Run the route tests**

Run: `npm -w story-editor-backend test -- tests/routes/ai tests/routes/chat`
Expected: PASS (assuming `make dev` is up).

- [ ] **Step 8: Commit**

```bash
git add backend/src/lib/venice-errors.ts \
        backend/src/routes/ai.routes.ts \
        backend/src/routes/chat.routes.ts \
        backend/tests/lib/venice-errors.test.ts
git commit -m "[c0c] backend: refactor venice-errors to single classify+log path + ctx param"
```

---

## Task 3: Docs — error-handling section + api-contract pointer

**Files:**
- Modify: `docs/venice-integration.md` (lines 250-260 — full replacement)
- Modify: `docs/api-contract.md` (line 12 pointer)

- [ ] **Step 1: Replace the "Error Handling" section in `docs/venice-integration.md`**

Replace the current section at lines 250-260 with:

```markdown
## Error catalog

All Venice-related error responses share the shape `{ error: { code, message, retryAfterSeconds?, details?: { veniceMessage? } } }`. `code` is stable and machine-readable; `message` is user-facing; `retryAfterSeconds` is present when known; `details.veniceMessage` is the sanitised raw text Venice returned, when Venice supplied one.

| HTTP | `code` | When emitted | `retryAfterSeconds` | `details.veniceMessage` | User-facing rendering |
|---|---|---|---|---|---|
| 409 | `venice_key_required` | User has no BYOK key stored; emitted by `NoVeniceKeyError` branch before any Venice call | absent | absent | "Open Settings" link to the BYOK panel + friendly headline |
| 400 | `venice_key_invalid` | Venice returns 401 (stored key was rejected) | absent | passes through when present | "Open Settings" link + headline |
| 429 | `venice_rate_limited` | Venice returns 429 | parsed from `Retry-After` / `x-ratelimit-reset-*`; `null` when unparseable | passes through when present | Live countdown ("Try again in 23s") + Retry button |
| 402 | `venice_insufficient_balance` | Venice returns 402 INSUFFICIENT_BALANCE | always `null` | passes through when present | "Top up at venice.ai →" external link |
| 502 | `venice_unavailable` | Venice returns 502/503/504, or transport failure | absent | passes through when present | Retry button only |
| 400/404/422/502 | `venice_error` | Forwarded Venice 400/404/422; fallback for unexpected non-2xx | absent | passes through when present | Retry button only |

Every successful Venice call emits one `[venice.params]` log line (success-side; from the X34 work). Every Venice error path emits one `[venice.error]` log line via `mapVeniceError` / `mapVeniceErrorToSse`. Shape:

```json
{
  "route": "ai-models" | "ai-complete" | "chat",
  "userId": "...",
  "code": "venice_rate_limited",
  "upstreamStatus": 429,
  "retryAfterSeconds": 23,
  "veniceMessage": "...",
  "streaming": false
}
```

**Never** pass raw Venice error bodies, stack traces, or the user's API key to the frontend. The BYOK key must not appear in any log line, error object, or telemetry payload ([AU13]). The mapper scrubs `sk-`-prefixed token fragments from `details.veniceMessage` via `SK_KEY_RE`.

The frontend's `VeniceErrorBanner` component reads these codes and renders the per-code affordances above. See `frontend/src/components/VeniceErrorBanner.tsx`.
```

- [ ] **Step 2: Update the one-liner in `docs/api-contract.md:12`**

Find the line that currently reads:

```
- **Errors** — global error handler returns `{ error: { message, code } }`. Never exposes stack traces in `NODE_ENV=production` ([B7]). Common codes: `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `venice_key_required`, `venice_key_invalid`, `internal_error`.
```

Replace with:

```
- **Errors** — global error handler returns `{ error: { message, code } }`. Never exposes stack traces in `NODE_ENV=production` ([B7]). Common non-Venice codes: `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited` (our-own per-user throttle), `internal_error`. **Venice-specific codes are catalogued in `docs/venice-integration.md#error-catalog`.**
```

- [ ] **Step 3: Verify no broken cross-references**

Run: `grep -rn "venice_key_invalid\|venice_rate_limited\|venice_unavailable\|venice_insufficient_balance" docs/`

Spot-check that no remaining doc still has the wrong `rate_limited` (without `venice_` prefix) for the 429 case in a Venice context, and no doc references a `500 { code: "internal_error" }` server-wide path that no longer exists.

- [ ] **Step 4: Commit**

```bash
git add docs/venice-integration.md docs/api-contract.md
git commit -m "[c0c] docs: consolidate Venice error catalog in venice-integration.md"
```

---

## Task 4: Frontend — Zustand slice for SettingsModal

**Files:**
- Create: `frontend/src/store/settingsModal.ts`
- Test: `frontend/tests/store/settingsModal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/store/settingsModal.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsModalStore } from '@/store/settingsModal';

describe('useSettingsModalStore', () => {
  beforeEach(() => {
    useSettingsModalStore.getState().close();
  });

  it('starts closed with no initial tab', () => {
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(false);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith() with no tab → open=true, initialTab=undefined', () => {
    useSettingsModalStore.getState().openWith();
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(true);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith("models") → open=true, initialTab="models"', () => {
    useSettingsModalStore.getState().openWith('models');
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(true);
    expect(s.initialTab).toBe('models');
  });

  it('openWith("venice") then close() → resets both fields', () => {
    useSettingsModalStore.getState().openWith('venice');
    useSettingsModalStore.getState().close();
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(false);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith("models") then openWith("venice") → tab switches', () => {
    useSettingsModalStore.getState().openWith('models');
    useSettingsModalStore.getState().openWith('venice');
    expect(useSettingsModalStore.getState().initialTab).toBe('venice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w story-editor-frontend test -- tests/store/settingsModal`
Expected: FAIL — `@/store/settingsModal` doesn't exist.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/settingsModal.ts`:

```ts
import { create } from 'zustand';
import type { SettingsTab } from '@/components/Settings';

interface SettingsModalState {
  open: boolean;
  initialTab: SettingsTab | undefined;
  openWith: (tab?: SettingsTab) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  initialTab: undefined,
  openWith: (tab) => set({ open: true, initialTab: tab }),
  close: () => set({ open: false, initialTab: undefined }),
}));
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm -w story-editor-frontend test -- tests/store/settingsModal && npm -w story-editor-frontend run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/settingsModal.ts frontend/tests/store/settingsModal.test.ts
git commit -m "[c0c] frontend: add useSettingsModalStore Zustand slice"
```

---

## Task 5: Frontend — migrate `EditorPage` to the Zustand slice

EditorPage currently owns the modal state as `useState`. Migrate to the new slice. Behavior-preserving — no user-visible change.

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx` (lines 153-154, 460, 585-586, 589, 640-646)
- Test: existing EditorPage tests should still pass

- [ ] **Step 1: Apply the migration**

In `frontend/src/pages/EditorPage.tsx`:

a) Add the store import alongside existing imports:

```ts
import { useSettingsModalStore } from '@/store/settingsModal';
```

b) Replace lines 153-154 (the two `useState` declarations) with a hook subscription that reads `open` + `initialTab`:

```ts
const settingsOpen = useSettingsModalStore((s) => s.open);
const settingsInitialTab = useSettingsModalStore((s) => s.initialTab);
```

c) Update each setter callsite to call the store action via `getState()` (action calls don't need a subscription):

- Line 460 — `setSettingsOpen(true);` becomes `useSettingsModalStore.getState().openWith();`
- Lines 585-586 — `setSettingsInitialTab('models'); setSettingsOpen(true);` becomes `useSettingsModalStore.getState().openWith('models');`
- Line 589 — `setSettingsOpen(true);` becomes `useSettingsModalStore.getState().openWith();`

d) Replace the modal mount at lines 640-646:

```tsx
<SettingsModal
  open={settingsOpen}
  initialTab={settingsInitialTab}
  onClose={() => {
    useSettingsModalStore.getState().close();
  }}
/>
```

- [ ] **Step 2: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the EditorPage-touching test suite**

Run: `npm -w story-editor-frontend test -- tests/pages tests/components/Settings`
Expected: PASS — behavior preserved.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[c0c] frontend: migrate EditorPage settings-modal state to useSettingsModalStore"
```

---

## Task 6: Frontend — widen `InlineAIResultError` + extend EditorPage flattener

**Files:**
- Modify: `frontend/src/store/inlineAIResult.ts` (lines 6-11)
- Modify: `frontend/src/pages/EditorPage.tsx` (lines 399-406)
- Test: any existing test that exercises the flattener

- [ ] **Step 1: Write/extend a test asserting the flattener carries `retryAfterSeconds` + `veniceMessage`**

If `frontend/tests/pages/EditorPage.*.test.tsx` already exercises the flattener, extend the relevant test with assertions for the two new fields. Otherwise, add a new lightweight test in `frontend/tests/store/inlineAIResult.test.ts` (or skip the test if no entry point exists — the typecheck on Step 3 will catch shape mismatches and the VeniceErrorBanner tests in Task 7 will exercise the end-to-end value-flow).

A minimal targeted assertion (assuming a relevant EditorPage test exists):

```ts
it('flattens completion.error.body fields into stored error', () => {
  // Construct an ApiError with body.error.retryAfterSeconds + details.veniceMessage,
  // dispatch the completion.status === 'error' effect, assert the stored
  // InlineAIResultError carries both fields.
});
```

If no entry-point test exists for the flattener, skip this step and rely on Task 7's tests.

- [ ] **Step 2: Widen `InlineAIResultError`**

Edit `frontend/src/store/inlineAIResult.ts`:

```ts
export interface InlineAIResultError {
  code: string | null;
  message: string;
  httpStatus?: number;
  detail?: unknown;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
}
```

- [ ] **Step 3: Extend the EditorPage flattener at lines 399-406**

Find:

```ts
} else if (completion.status === 'error') {
  const err = completion.error;
  setInlineAIResult({
    ...prev,
    status: 'error',
    output: '',
    error: err
      ? { code: err.code ?? null, message: err.message, httpStatus: err.status }
      : { code: null, message: 'AI request failed.' },
  });
}
```

Replace with:

```ts
} else if (completion.status === 'error') {
  const err = completion.error;
  setInlineAIResult({
    ...prev,
    status: 'error',
    output: '',
    error: err
      ? {
          code: err.code ?? null,
          message: err.message,
          httpStatus: err.status,
          retryAfterSeconds: err.body?.error?.retryAfterSeconds ?? null,
          veniceMessage: typeof err.body?.error?.details?.veniceMessage === 'string'
            ? err.body.error.details.veniceMessage
            : undefined,
        }
      : { code: null, message: 'AI request failed.' },
  });
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — `InlineAIResultError` is widened additively (new fields are optional).

- [ ] **Step 5: Run frontend tests touching the store + EditorPage**

Run: `npm -w story-editor-frontend test -- tests/store/inlineAIResult tests/pages`
Expected: PASS — additive changes, existing fixtures unaffected.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/inlineAIResult.ts frontend/src/pages/EditorPage.tsx
git commit -m "[c0c] frontend: widen InlineAIResultError with retryAfterSeconds + veniceMessage"
```

---

## Task 7: Frontend — `VeniceErrorBanner` component + tests + stories

**Files:**
- Create: `frontend/src/components/VeniceErrorBanner.tsx`
- Create: `frontend/tests/components/VeniceErrorBanner.test.tsx`
- Create: `frontend/src/components/VeniceErrorBanner.stories.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/VeniceErrorBanner.test.tsx`:

```tsx
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VeniceErrorBanner } from '@/components/VeniceErrorBanner';
import { useSettingsModalStore } from '@/store/settingsModal';

describe('VeniceErrorBanner', () => {
  beforeEach(() => {
    useSettingsModalStore.getState().close();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when error is null', () => {
    const { container } = render(<VeniceErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('venice_rate_limited: renders live countdown that ticks down', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_rate_limited', message: 'Slow down', retryAfterSeconds: 5 }}
      />,
    );
    expect(screen.getByText(/Try again in 5s/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Try again in 4s/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('venice_rate_limited with retryAfterSeconds=null: omits countdown', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_rate_limited', message: 'Slow', retryAfterSeconds: null }}
      />,
    );
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('venice_key_invalid: Open Settings button calls openWith("venice")', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_key_invalid', message: 'Bad key' }} />);
    const btn = screen.getByRole('button', { name: /Open Settings/i });
    fireEvent.click(btn);
    expect(useSettingsModalStore.getState()).toMatchObject({
      open: true,
      initialTab: 'venice',
    });
  });

  it('venice_key_required: Open Settings button is present', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_key_required', message: 'No key' }} />);
    expect(screen.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
  });

  it('venice_insufficient_balance: external Top up link present with rel attrs', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_insufficient_balance', message: 'Out of credits' }}
      />,
    );
    const link = screen.getByRole('link', { name: /Top up at venice\.ai/i });
    expect(link).toHaveAttribute('href', 'https://venice.ai/settings/api');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('venice_unavailable: no special affordance — generic rendering only', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_unavailable', message: 'Down' }} />);
    expect(screen.queryByRole('button', { name: /Open Settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Top up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('renders veniceMessage line under the headline when present', () => {
    render(
      <VeniceErrorBanner
        error={{
          code: 'venice_error',
          message: 'Venice rejected the request.',
          veniceMessage: 'Invalid model id "foo".',
        }}
      />,
    );
    expect(screen.getByText(/Venice said: Invalid model id "foo"\./)).toBeInTheDocument();
  });

  it('omits the veniceMessage line when absent', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_error', message: 'Failed' }} />);
    expect(screen.queryByText(/Venice said:/)).not.toBeInTheDocument();
  });

  it('truncates veniceMessage at 280 chars with ellipsis', () => {
    const long = 'x'.repeat(400);
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_error', message: 'Failed', veniceMessage: long }}
      />,
    );
    const text = screen.getByText(/Venice said: /).textContent ?? '';
    expect(text.length).toBeLessThanOrEqual('Venice said: '.length + 281); // 280 + ellipsis
    expect(text).toMatch(/…$/);
  });

  it('calls onRetry when Retry clicked', () => {
    const onRetry = vi.fn();
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_unavailable', message: 'Down' }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `npm -w story-editor-frontend test -- tests/components/VeniceErrorBanner`
Expected: FAIL — `@/components/VeniceErrorBanner` doesn't exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/VeniceErrorBanner.tsx`:

```tsx
import { type JSX, useEffect, useState } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { useSettingsModalStore } from '@/store/settingsModal';

const VENICE_MESSAGE_MAX_LEN = 280;
const TOP_UP_URL = 'https://venice.ai/settings/api';

export interface VeniceErrorBannerError {
  code: string | null;
  message: string;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
  httpStatus?: number;
  detail?: unknown;
}

export interface VeniceErrorBannerProps {
  error: VeniceErrorBannerError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

function truncateVeniceMessage(raw: string): string {
  if (raw.length <= VENICE_MESSAGE_MAX_LEN) return raw;
  return `${raw.slice(0, VENICE_MESSAGE_MAX_LEN)}…`;
}

function useCountdown(seedSeconds: number | null | undefined): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    typeof seedSeconds === 'number' ? seedSeconds : null,
  );

  useEffect(() => {
    if (typeof seedSeconds !== 'number') {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(seedSeconds);
    if (seedSeconds <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return () => clearInterval(id);
  }, [seedSeconds]);

  return secondsLeft;
}

export function VeniceErrorBanner({
  error,
  onRetry,
  onDismiss,
  disabled,
}: VeniceErrorBannerProps): JSX.Element | null {
  const isRateLimited = error?.code === 'venice_rate_limited';
  const seed = isRateLimited ? (error?.retryAfterSeconds ?? null) : null;
  const countdown = useCountdown(seed);

  if (error === null) return null;

  const showSettingsButton =
    error.code === 'venice_key_invalid' || error.code === 'venice_key_required';
  const showTopUpLink = error.code === 'venice_insufficient_balance';
  const showCountdown = isRateLimited && countdown !== null && countdown > 0;
  const showVeniceMessage =
    typeof error.veniceMessage === 'string' && error.veniceMessage.length > 0;

  return (
    <div className="flex flex-col gap-1.5" data-testid="venice-error-banner">
      <InlineErrorBanner
        error={{
          code: error.code,
          message: error.message,
          httpStatus: error.httpStatus,
          detail: error.detail,
        }}
        onRetry={onRetry}
        onDismiss={onDismiss}
        disabled={disabled}
      />
      {showVeniceMessage ? (
        <p className="text-[11.5px] italic text-ink-3 px-1">
          Venice said: {truncateVeniceMessage(error.veniceMessage as string)}
        </p>
      ) : null}
      {showCountdown ? (
        <p className="text-[12px] text-ink-3 px-1">Try again in {countdown}s.</p>
      ) : null}
      {showSettingsButton ? (
        <div className="px-1">
          <button
            type="button"
            onClick={() => {
              useSettingsModalStore.getState().openWith('venice');
            }}
            className="text-[12px] underline text-[var(--danger)] hover:no-underline"
          >
            Open Settings
          </button>
        </div>
      ) : null}
      {showTopUpLink ? (
        <div className="px-1">
          <a
            href={TOP_UP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] underline text-[var(--danger)] hover:no-underline"
          >
            Top up at venice.ai →
          </a>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm -w story-editor-frontend test -- tests/components/VeniceErrorBanner`
Expected: PASS — all 10 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Create the stories file**

Create `frontend/src/components/VeniceErrorBanner.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { VeniceErrorBanner } from './VeniceErrorBanner';

const meta: Meta<typeof VeniceErrorBanner> = {
  title: 'Components/VeniceErrorBanner',
  component: VeniceErrorBanner,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof VeniceErrorBanner>;

export const RateLimited: Story = {
  args: {
    error: {
      code: 'venice_rate_limited',
      message: 'Venice is rate limiting this request. Try again shortly.',
      retryAfterSeconds: 23,
      veniceMessage: 'Rate limit exceeded for model llama-3.1-70b.',
    },
    onRetry: () => {},
  },
};

export const KeyInvalid: Story = {
  args: {
    error: {
      code: 'venice_key_invalid',
      message: 'Your Venice API key was rejected. Please update it in Settings.',
      veniceMessage: 'Invalid bearer token.',
    },
    onRetry: () => {},
  },
};

export const KeyRequired: Story = {
  args: {
    error: {
      code: 'venice_key_required',
      message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
    },
  },
};

export const InsufficientBalance: Story = {
  args: {
    error: {
      code: 'venice_insufficient_balance',
      message:
        'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.',
      retryAfterSeconds: null,
      veniceMessage: 'INSUFFICIENT_BALANCE: account credit exhausted.',
    },
    onRetry: () => {},
  },
};

export const Unavailable: Story = {
  args: {
    error: {
      code: 'venice_unavailable',
      message: 'Venice is temporarily unavailable. Try again shortly.',
      veniceMessage: 'Upstream gateway timeout.',
    },
    onRetry: () => {},
  },
};

export const GenericError: Story = {
  args: {
    error: {
      code: 'venice_error',
      message: 'Venice rejected the request.',
      veniceMessage: 'Invalid model id "llama-99-trillion".',
    },
    onRetry: () => {},
  },
};

export const NoVeniceMessage: Story = {
  args: {
    error: {
      code: 'venice_error',
      message: 'Venice returned an unexpected error.',
    },
    onRetry: () => {},
  },
};
```

- [ ] **Step 7: Verify Storybook builds the new stories**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — stories are type-checked as part of `tsc -b`.

(Manual Storybook browse is not part of the verify line but is recommended for visual review: `npm --prefix frontend run storybook`, navigate to `Components/VeniceErrorBanner`, eyeball each story.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/VeniceErrorBanner.tsx \
        frontend/src/components/VeniceErrorBanner.stories.tsx \
        frontend/tests/components/VeniceErrorBanner.test.tsx
git commit -m "[c0c] frontend: add VeniceErrorBanner component + stories + tests"
```

---

## Task 8: Frontend — `TranscriptView` prop widening + send-error swap

**Files:**
- Modify: `frontend/src/components/messageRow/TranscriptView.tsx` (lines 29, 182, 195)
- Modify (if needed): `frontend/src/components/SceneTab.tsx` (line 245 area)
- Modify (if needed): `frontend/src/components/ChatTab.tsx` (line 221 area)
- Test: existing TranscriptView tests if any

- [ ] **Step 1: Inspect SceneTab and ChatTab to confirm the runtime shape**

Run: `grep -n "sendError\|useSendChatMessageMutation\|onRetrySend" frontend/src/components/SceneTab.tsx frontend/src/components/ChatTab.tsx`

The mutation throws via `api.ts`'s `ApiError` class on failure (TanStack Query passes the thrown error to `mutation.error`). Confirm the inferred type at the callsites is compatible with `ApiError | null`. If TypeScript narrows differently (e.g. `Error | null` because of how the mutation is typed), the prop widening in Step 2 will reveal it — fix at the callsite by casting via `as ApiError | null` only if the generic is provably narrow.

- [ ] **Step 2: Widen `TranscriptView`'s `sendError` prop type**

Edit `frontend/src/components/messageRow/TranscriptView.tsx`:

a) Add an import at the top:

```ts
import { ApiError } from '@/lib/api';
import { VeniceErrorBanner } from '@/components/VeniceErrorBanner';
```

b) Line 29 — change:

```ts
sendError?: Error | null;
```

to:

```ts
sendError?: ApiError | null;
```

c) Lines 182 + 194-200 — replace the send-error banner block. Find:

```tsx
const bannerError = sendError != null ? { code: null, message: sendError.message } : null;

return (
  <section ...>
    <ol ...>{children(rows)}</ol>
    {bannerError ? (
      <InlineErrorBanner
        error={bannerError}
        {...(onRetrySend ? { onRetry: onRetrySend } : {})}
        {...(disableRetrySend ? { disabled: true } : {})}
      />
    ) : null}
  </section>
);
```

Replace with:

```tsx
const veniceBannerError = sendError != null
  ? {
      code: sendError.code ?? null,
      message: sendError.message,
      httpStatus: sendError.status,
      retryAfterSeconds: sendError.body?.error?.retryAfterSeconds ?? null,
      veniceMessage:
        typeof sendError.body?.error?.details?.veniceMessage === 'string'
          ? sendError.body.error.details.veniceMessage
          : undefined,
    }
  : null;

return (
  <section ...>
    <ol ...>{children(rows)}</ol>
    {veniceBannerError ? (
      <VeniceErrorBanner
        error={veniceBannerError}
        {...(onRetrySend ? { onRetry: onRetrySend } : {})}
        {...(disableRetrySend ? { disabled: true } : {})}
      />
    ) : null}
  </section>
);
```

The query-error branch at lines 146-166 (transcript-load failure) stays unchanged — it continues to render `<InlineErrorBanner>` directly. **Do not touch it.**

- [ ] **Step 3: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS, **OR** FAIL at the SceneTab/ChatTab callsite if their `sendError` type doesn't infer as `ApiError`.

If FAIL: inspect the failing callsite. TanStack Query's mutation `error` is typed as `TError` (defaults to `Error`). If the hook didn't specify `<TData, ApiError, …>`, the inferred type at the consumer is `Error`. Fix at the callsite by either (a) parameterizing the mutation generic — `useMutation<X, ApiError, …>` — at the hook definition, or (b) casting at the prop pass site — `sendError={mutation.error as ApiError | null}`. Prefer (a) when the hook is owned by this project; (b) when it's a generic helper.

- [ ] **Step 4: Run tests touching TranscriptView**

Run: `npm -w story-editor-frontend test -- tests/components/TranscriptView tests/components/SceneTab tests/components/ChatTab`
Expected: PASS. (Existing tests should still pass — the banner-error builder change is additive, and the query-error branch is untouched.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/messageRow/TranscriptView.tsx \
        frontend/src/components/SceneTab.tsx \
        frontend/src/components/ChatTab.tsx
git commit -m "[c0c] frontend: swap TranscriptView send-error banner to VeniceErrorBanner"
```

---

## Task 9: Frontend — swap `InlineAIResult` to `VeniceErrorBanner`

**Files:**
- Modify: `frontend/src/components/InlineAIResult.tsx`
- Test: existing InlineAIResult tests

- [ ] **Step 1: Inspect the current banner usage**

Run: `grep -n "InlineErrorBanner\|InlineAIResultError" frontend/src/components/InlineAIResult.tsx`

Confirm the file imports `InlineErrorBanner` and consumes `InlineAIResultError` from the store. The new shape is `InlineAIResultError` (widened in Task 6), which already matches `VeniceErrorBannerError` (same fields).

- [ ] **Step 2: Apply the swap**

In `frontend/src/components/InlineAIResult.tsx`:

a) Replace the import:

```ts
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
```

with:

```ts
import { VeniceErrorBanner } from '@/components/VeniceErrorBanner';
```

b) Replace the JSX usage. Find the `<InlineErrorBanner ... />` invocation and change the component name to `<VeniceErrorBanner ... />`. The `error` prop already carries the widened shape from the store (since Task 6 widened `InlineAIResultError`). Other props (`onRetry`, `onDismiss`) are unchanged.

- [ ] **Step 3: Run typecheck**

Run: `npm -w story-editor-frontend run typecheck`
Expected: PASS — `InlineAIResultError` is structurally compatible with `VeniceErrorBannerError`.

- [ ] **Step 4: Run InlineAIResult tests**

Run: `npm -w story-editor-frontend test -- tests/components/InlineAIResult`
Expected: PASS — existing tests should still pass; new per-code behaviors are covered in Task 7's VeniceErrorBanner tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InlineAIResult.tsx
git commit -m "[c0c] frontend: swap InlineAIResult to VeniceErrorBanner"
```

---

## Final verification

After all 9 tasks complete, run the full verify line:

```
npm -w story-editor-backend run typecheck && \
npm -w story-editor-backend test -- tests/lib/venice-errors tests/routes/ai tests/routes/chat && \
npm -w story-editor-frontend run typecheck && \
npm -w story-editor-frontend test -- tests/components/VeniceErrorBanner tests/components/InlineErrorBanner tests/components/InlineAIResult tests/components/messageRow tests/store/settingsModal
```

(The backend test step requires `make dev` up per the bd-verify-line-backend-test-needs-stack memory.)

Then run `/bd-close-reviewed story-editor-c0c` to fan the surface reviewers, complete the typecheck-affected-workspaces pass, and close the bd issue.

---

## Notes for the implementer

- **Frequent commits.** Each task's Step `n: Commit` is a real checkpoint — don't batch tasks into a single commit. `/bd-execute` dispatches each task as its own subagent.
- **Tests are not optional.** The TDD pattern (write failing test → see it fail → implement → see it pass → commit) is the project's convention. Skipping the failing-test verification means a passing implementation might be passing for the wrong reasons.
- **No drive-by refactors.** Each task lists exact files. If you notice something tangential worth cleaning up, capture it as a bd follow-up (`bd create …`) instead of expanding the diff.
- **Don't touch `InlineErrorBanner.tsx`.** The component stays the generic primitive. The whole point of `VeniceErrorBanner` is to avoid Venice-awareness in the generic banner.
- **The query-error branch in `TranscriptView` is not Venice.** It stays `InlineErrorBanner` (Task 8 Step 2 calls this out explicitly).
- **Backend tests need `make dev` up.** Per `bd-verify-line-backend-test-needs-stack` memory, the vitest globalSetup unconditionally hits Postgres on every backend test run. Run `make dev` once at the start of the implementation session.
