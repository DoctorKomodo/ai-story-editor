# [X32] Unified Venice account-info endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GET /api/ai/balance` and `POST /api/users/me/venice-key/verify` with a single `GET /api/users/me/venice-account` returning `{ verified, balanceUsd, diem, endpoint, lastSix }`. Fix the BalanceDisplay header pill (same `/v1/models`-headers bug) along the way and subsume X31's `credits → balanceUsd` rename.

**Architecture:** New backend route `GET /api/users/me/venice-account` mounted as a sibling of `/venice-key`, backed by a new service method `veniceKeyService.getAccount(userId)` that hits `GET ${endpoint}/api_keys/rate_limits` and parses `data.balances.{USD,DIEM}` from the JSON body. Frontend collapses `useBalanceQuery` and `useVerifyVeniceKeyMutation` into a single TanStack Query (`useVeniceAccountQuery`); Settings' "Verify" button becomes a `queryClient.invalidateQueries` call rather than a separate POST. Errors carry an `upstreamStatus` field that flows into `useErrorStore` for the DevErrorOverlay.

**Tech Stack:** Express + Prisma (backend), React + TanStack Query + Zustand (frontend), Vitest (tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-04-x32-venice-account-endpoint-design.md`

---

## File structure (locked in before tasks)

### Backend — new files
- `backend/src/routes/venice-account.routes.ts` — `createVeniceAccountRouter(options?)` returning a mini-router with one `GET /` handler + per-user 30/min rate limiter
- `backend/tests/routes/venice-account.test.ts` — 14 integration tests (transplanted from `venice-key-verify.test.ts` plus 3 new)

### Backend — modified
- `backend/src/services/venice-key.service.ts` — add `VeniceAccountResult` interface, `VeniceAccountRateLimitedError`, `VeniceAccountUnavailableError`, internal `getStatusAndKey()`, public `getAccount()`. Refactor `getStatus()` to delegate. Delete `verify()`, `VeniceKeyVerifyResult`, `VeniceVerifyRateLimitedError`, `VeniceVerifyUnavailableError`, local `parseRetryAfterSeconds`. Import `parseRetryAfter` from `lib/venice-errors`.
- `backend/src/routes/venice-key.routes.ts` — delete `POST /verify` route, `createVerifyRateLimiter`, `verifyRateLimitWindowMs` option, openai SDK / `mapVeniceError` imports.
- `backend/src/routes/ai.routes.ts` — delete `GET /balance` route (lines 110-127 area).
- `backend/src/index.ts` — mount `createVeniceAccountRouter()` at `/api/users/me/venice-account`.

### Backend — deleted
- `backend/tests/routes/venice-key-verify.test.ts`
- `backend/tests/ai/balance.test.ts`

### Backend — modified tests
- `backend/tests/ai/error-handling.test.ts` — drop the `describe('GET /api/ai/balance', ...)` block (around line 308–365).
- `backend/tests/routes/venice-key.test.ts` — drop any verify references (peek before editing).

### Frontend — new files
- `frontend/src/hooks/useVeniceAccount.ts` — `VeniceAccount` type, `veniceAccountQueryKey`, `useVeniceAccountQuery`
- `frontend/tests/hooks/useVeniceAccount.test.tsx` — 4 tests for the query hook

### Frontend — modified
- `frontend/src/lib/api.ts` — extend `ApiError` to carry the parsed body (so callers can read `err.body?.error?.upstreamStatus`)
- `frontend/src/components/BalanceDisplay.tsx` — type `Balance → VeniceAccount`, field `credits → balanceUsd`
- `frontend/src/components/Settings.tsx` — replace `useVerifyVeniceKeyMutation` + verify-pill mutation flow with `useVeniceAccountQuery` + `queryClient.invalidateQueries` in `handleSave` / `handleVerify`
- `frontend/src/hooks/useVeniceKey.ts` — delete `useVerifyVeniceKeyMutation`, `VeniceKeyVerify` interface
- `frontend/src/pages/EditorPage.tsx` — `useBalanceQuery → useVeniceAccountQuery`; `Balance → VeniceAccount`
- `frontend/src/components/UserMenu.tsx` — `Balance → VeniceAccount`
- `frontend/src/components/TopBar.tsx` — `Balance → VeniceAccount`
- Integration mocks in `frontend/tests/pages/*.integration.test.tsx` (7 files: `editor`, `editor-shell`, `editor-paper`, `character-popover`, `editor-autosave`, `chat-panel`, `editor-ai`) — change `endsWith('/ai/balance')` → `endsWith('/users/me/venice-account')` and update mock body shape from `{ balance: { dollars, vcu } }` to `{ verified: true, balanceUsd: 1.23, diem: 100, endpoint: null, lastSix: null }`.

### Frontend — modified tests
- `frontend/tests/components/BalanceDisplay.test.tsx` — field rename (3 places)
- `frontend/tests/components/Settings.shell-venice.test.tsx` — rewrite verify tests (lines 348+ area) to assert query invalidation rather than POST

### Frontend — deleted
- `frontend/src/hooks/useBalance.ts`

### Docs — modified
- `docs/api-contract.md` — delete `/api/users/me/venice-key/verify` + `/api/ai/balance` sections; add `/api/users/me/venice-account` section
- `docs/venice-integration.md` — update lines around 171 + 291
- `TASKS.md` — tick X31 (subsumed); add X32 entry with verify command

---

## Pre-flight

### Task A: Branch sync (X26 absorption check)

**Files:**
- Read: `git log origin/main --oneline -5`

- [ ] **Step 1: Check whether PR #59 (X26) has merged into `origin/main`**

```bash
git fetch origin
gh pr view 59 --json state,mergedAt
```

Expected: JSON with either `"state":"MERGED"` (preferred) or `"state":"OPEN","mergedAt":null`.

- [ ] **Step 2: Branch from current main**

If currently on `feature/x32-venice-account-endpoint` (the branch this plan was committed on), continue. Otherwise:

```bash
git checkout main && git pull --ff-only
git checkout -b feature/x32-venice-account-endpoint
```

If the branch already exists with the spec commit but is behind main, rebase:

```bash
git checkout feature/x32-venice-account-endpoint
git rebase origin/main
```

- [ ] **Step 3: If X26 has NOT merged, absorb its renames before proceeding**

The spec assumes X26 lands first. If it hasn't, fold these renames into Task B-K rather than relying on X26 to do them:

- `lastFour` → `lastSix` everywhere (backend service / routes / tests / frontend hooks / UI / tests / docs)
- `credits` → `balanceUsd` in the `/verify` response and `useBalance` shape
- `/v1/models`-headers → `/api_keys/rate_limits`-body in `verify()` (this is moot — Task B replaces `verify()` entirely with `getAccount()`)

The X26 PR diff is at `gh pr diff 59`. Don't merge it manually; just keep its rename targets in mind as you write Tasks B-J. The plan code blocks below already use the post-X26 names (`lastSix`, `balanceUsd`).

If X26 HAS merged, no extra work — the rename is already in `main` and the plan applies as written.

- [ ] **Step 4: Confirm clean working tree, run full test baseline**

```bash
cd backend && npm test 2>&1 | tail -3
cd ../frontend && npm test 2>&1 | tail -3
```

Expected: backend "Tests <N> passed", frontend "Tests <N> passed". Note the counts so regression in later phases is obvious.

- [ ] **Step 5: Commit (no code yet — branch setup only)**

No commit; the spec commit (`docs(spec): X32 unified Venice account-info endpoint`) is already on the branch. Move to Task B.

---

## Phase B — Backend service: errors + helpers + getAccount

### Task B: Service-level types, helpers, and `getAccount`

**Files:**
- Modify: `backend/src/services/venice-key.service.ts`

The goal of this task is to land all the service-level changes — new error classes, new `VeniceAccountResult` interface, `getStatusAndKey` helper, `getStatus` refactor to delegate, new `getAccount` method, deletion of `verify()` and the local `parseRetryAfterSeconds`. We import `parseRetryAfter` from `lib/venice-errors` instead.

The route + tests are the next two tasks. After this task the backend doesn't yet have a `/venice-account` URL — it's just service-level wiring.

- [ ] **Step 1: Open `backend/src/services/venice-key.service.ts` and replace the imports + add new error classes**

At the top of the file, replace the `VeniceKeyCheckError` block (around line 31-36 post-X26) with this expanded set. Keep `VeniceKeyInvalidError` and `VeniceKeyCheckError` exactly as they are; add the new account errors:

```ts
export class VeniceAccountRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds: number | null,
    public readonly upstreamStatus: number,
  ) {
    super('Venice rate-limited the account-info probe');
    this.name = 'VeniceAccountRateLimitedError';
  }
}

export class VeniceAccountUnavailableError extends Error {
  constructor(public readonly upstreamStatus: number | null) {
    super('Venice account-info probe failed');
    this.name = 'VeniceAccountUnavailableError';
  }
}
```

If `VeniceVerifyRateLimitedError` / `VeniceVerifyUnavailableError` exist (post-X26 only), DELETE them in the same edit — they're being replaced.

- [ ] **Step 2: Replace local `parseRetryAfterSeconds` with an import**

If post-X26 (the local helper exists in this file), delete the entire `function parseRetryAfterSeconds(headers: Headers)` block. Then add at the top of the imports:

```ts
import { parseRetryAfter } from '../lib/venice-errors';
```

The lib version accepts native `Headers` and a record shape, and additionally honours `x-ratelimit-reset-*` fallback that Venice sometimes returns instead of `retry-after`.

If pre-X26 (the local helper doesn't exist yet), just add the import. The `getAccount` step below will use `parseRetryAfter` directly.

- [ ] **Step 3: Add the `VeniceAccountResult` interface**

Above `VeniceKeyVerifyResult` (or replacing it if post-X26 — the field shape is identical), add:

```ts
export interface VeniceAccountResult {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
}
```

If `VeniceKeyVerifyResult` exists, DELETE it in the same edit — it's being replaced.

- [ ] **Step 4: Add the internal `getStatusAndKey` helper inside `createVeniceKeyService`**

This goes between `validateAgainstVenice` and the public `getStatus` (or replaces them if you're refactoring `getStatus` to delegate). Add:

```ts
interface StatusAndKey {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
  apiKey: string | null;  // plaintext, request-scoped
}

async function getStatusAndKey(userId: string): Promise<StatusAndKey> {
  const row = await client.user.findUnique({
    where: { id: userId },
    select: {
      veniceApiKeyEnc: true,
      veniceApiKeyIv: true,
      veniceApiKeyAuthTag: true,
      veniceEndpoint: true,
    },
  });

  if (!row?.veniceApiKeyEnc || !row.veniceApiKeyIv || !row.veniceApiKeyAuthTag) {
    return { hasKey: false, lastSix: null, endpoint: null, apiKey: null };
  }

  const apiKey = decrypt({
    ciphertext: row.veniceApiKeyEnc,
    iv: row.veniceApiKeyIv,
    authTag: row.veniceApiKeyAuthTag,
  });

  return {
    hasKey: true,
    lastSix: lastSixOf(apiKey),
    endpoint: row.veniceEndpoint ?? DEFAULT_VENICE_ENDPOINT,
    apiKey,
  };
}
```

(`lastSixOf` already exists post-X26. If pre-X26 you have `lastFourOf` — rename it to `lastSixOf` and change `apiKey.slice(-4)` to `apiKey.slice(-6)` per the X26 absorb step.)

- [ ] **Step 5: Refactor `getStatus` to delegate to `getStatusAndKey`**

Replace the existing `getStatus` body with:

```ts
async function getStatus(userId: string): Promise<VeniceKeyStatus> {
  const { hasKey, lastSix, endpoint } = await getStatusAndKey(userId);
  return { hasKey, lastSix, endpoint };
}
```

This is the "halve the DB+decrypt" step — `getStatus` now reads the same data `getStatusAndKey` does, just stripped of `apiKey`. (`VeniceKeyStatus` interface is unchanged: `{ hasKey, lastSix, endpoint }`.)

- [ ] **Step 6: Add `readBalances` helper**

This goes near the top of the file with the other small helpers (after `resolveEndpoint`):

```ts
// Extract the USD / DIEM balances from the rate_limits response body. The
// body shape is `{ data: { balances: { USD: number, DIEM: number, ... } } }`.
// Returns nulls when the body doesn't match — verified:true is still useful
// to display even without numeric balances.
function readBalances(body: unknown): { usd: number | null; diem: number | null } {
  if (typeof body !== 'object' || body === null) return { usd: null, diem: null };
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return { usd: null, diem: null };
  const balances = (data as { balances?: unknown }).balances;
  if (typeof balances !== 'object' || balances === null) return { usd: null, diem: null };
  const usdRaw = (balances as Record<string, unknown>).USD;
  const diemRaw = (balances as Record<string, unknown>).DIEM;
  return {
    usd: typeof usdRaw === 'number' && Number.isFinite(usdRaw) ? usdRaw : null,
    diem: typeof diemRaw === 'number' && Number.isFinite(diemRaw) ? diemRaw : null,
  };
}
```

If post-X26 this helper already exists in the file — leave it as is. Verify by grepping for `function readBalances`.

- [ ] **Step 7: Replace `verify()` with `getAccount()`**

Delete the entire existing `verify()` method body. Add `getAccount` in its place:

```ts
// [X32] Unified Venice account-info probe. Calls GET /api_keys/rate_limits
// (Venice's account-info endpoint) and reads `data.balances.{USD,DIEM}` from
// the JSON body. Replaces the old `verify()` (V18) which read non-existent
// `x-venice-balance-*` headers off /v1/models.
//
// On 401/403, returns verified:false rather than throwing — the Settings UI
// must show "Not verified" without treating it as a crash. 429 / 5xx surface
// as typed errors with `upstreamStatus` carried through to the route's error
// body so the frontend's DevErrorOverlay can render it for triage.
async function getAccount(userId: string): Promise<VeniceAccountResult> {
  const { hasKey, lastSix, endpoint, apiKey } = await getStatusAndKey(userId);

  if (!hasKey || apiKey === null) {
    return { verified: false, balanceUsd: null, diem: null, endpoint: null, lastSix: null };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const baseEndpoint = endpoint ?? DEFAULT_VENICE_ENDPOINT;
  const url = `${baseEndpoint.replace(/\/$/, '')}/api_keys/rate_limits`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    console.error('[X32] Venice rate_limits probe failed (transport) for user', userId);
    throw new VeniceAccountUnavailableError(null);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      verified: false,
      balanceUsd: null,
      diem: null,
      endpoint,
      lastSix,
    };
  }

  if (response.status === 429) {
    console.error('[X32] Venice rate_limits probe returned', response.status, 'for user', userId);
    throw new VeniceAccountRateLimitedError(parseRetryAfter(response.headers), 429);
  }

  if (!response.ok) {
    console.error('[X32] Venice rate_limits probe returned', response.status, 'for user', userId);
    throw new VeniceAccountUnavailableError(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error('[X32] Venice rate_limits probe failed (json parse) for user', userId);
    throw new VeniceAccountUnavailableError(response.status);
  }

  const balances = readBalances(body);
  return {
    verified: true,
    balanceUsd: balances.usd,
    diem: balances.diem,
    endpoint,
    lastSix,
  };
}
```

- [ ] **Step 8: Update the service's return statement to expose `getAccount` and drop `verify`**

Replace:

```ts
return { getStatus, store, remove, validateAgainstVenice, verify };
```

with:

```ts
return { getStatus, store, remove, validateAgainstVenice, getAccount };
```

- [ ] **Step 9: Drop the now-unused `getVeniceClient` import + the `getVeniceClientFn` deps field**

If the file still has `import { getVeniceClient } from '../lib/venice'` (post-X26 it doesn't; pre-X26 it does), delete it. Same for `import type OpenAI from 'openai'`. The `VeniceKeyServiceDeps` interface should no longer have `getVeniceClientFn`. Final shape:

```ts
export interface VeniceKeyServiceDeps {
  client?: PrismaClient;
  fetchFn?: typeof fetch;
}
```

- [ ] **Step 10: Run typecheck — expect failures from existing route file**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -10
```

Expected: errors in `src/routes/venice-key.routes.ts` (`Cannot find name 'verify'`, `Cannot find name 'AuthenticationError'` etc.) and possibly `tests/routes/venice-key-verify.test.ts`. The `venice-key.service.ts` file itself should typecheck. If `venice-key.service.ts` has errors, fix them before moving on.

- [ ] **Step 11: Commit just the service changes**

```bash
git add backend/src/services/venice-key.service.ts
git commit -m "[X32] add VeniceAccountResult + getAccount; refactor getStatus to delegate to getStatusAndKey"
```

The route + tests come in Task C-D. The branch is intentionally not green at this commit (route file references the deleted `verify`). That's resolved one commit later.

---

## Phase C — Backend route + index mount

### Task C: Create `venice-account.routes.ts` and mount it

**Files:**
- Create: `backend/src/routes/venice-account.routes.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create the new router file**

Path: `backend/src/routes/venice-account.routes.ts`. Full contents:

```ts
// [X32] GET /api/users/me/venice-account — unified Venice account-info probe.
//
// Replaces the old GET /api/ai/balance (V10) and POST /api/users/me/venice-key/
// verify (V18). Returns { verified, balanceUsd, diem, endpoint, lastSix } from
// Venice's GET /api_keys/rate_limits body.
//
// Mounted as a sibling of /venice-key — semantically this is about the *account*
// (balance + verification), not the key (CRUD).

import { type Request, type Response, Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware';
import {
  VeniceAccountRateLimitedError,
  VeniceAccountUnavailableError,
  veniceKeyService,
} from '../services/venice-key.service';

// Per-user rate limiter for the account-info endpoint. 30 req/min/user is
// generous enough that no real user (header pill mount + Settings clicks)
// trips it, tight enough that a runaway client gets cut off before Venice
// notices. windowMs is injectable so tests can compress the window.
export function createAccountRateLimiter(windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'anon'),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'account_rate_limited',
          message: 'Too many account-info requests. Try again in a moment.',
        },
      });
    },
  });
}

export interface VeniceAccountRouterOptions {
  // Allows tests to inject a short windowMs without stubbing timers.
  // Production always uses the default 60 s.
  accountRateLimitWindowMs?: number;
}

export function createVeniceAccountRouter(options: VeniceAccountRouterOptions = {}) {
  const router = Router();

  router.use(requireAuth);

  router.get(
    '/',
    createAccountRateLimiter(options.accountRateLimitWindowMs),
    async (req: Request, res: Response, next) => {
      const userId = req.user!.id;
      try {
        const result = await veniceKeyService.getAccount(userId);
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof VeniceAccountRateLimitedError) {
          res.status(429).json({
            error: {
              code: 'venice_rate_limited',
              message: 'Venice is rate limiting this request. Try again shortly.',
              retryAfterSeconds: err.retryAfterSeconds,
              upstreamStatus: err.upstreamStatus,
            },
          });
          return;
        }
        if (err instanceof VeniceAccountUnavailableError) {
          res.status(502).json({
            error: {
              code: 'venice_unavailable',
              message: 'Venice is temporarily unavailable. Try again shortly.',
              upstreamStatus: err.upstreamStatus,
            },
          });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
```

- [ ] **Step 2: Mount the new router in `backend/src/index.ts`**

Find the existing mount line:

```ts
app.use('/api/users/me/venice-key', createVeniceKeyRouter());
```

Add directly below it:

```ts
app.use('/api/users/me/venice-account', createVeniceAccountRouter());
```

And add the import at the top of the file alongside `createVeniceKeyRouter`:

```ts
import { createVeniceAccountRouter } from './routes/venice-account.routes';
```

- [ ] **Step 3: Run typecheck — venice-account.routes.ts should be green now**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -E "venice-account" | head
```

Expected: no errors for `venice-account.routes.ts` or `index.ts`. The `venice-key.routes.ts` and `tests/routes/venice-key-verify.test.ts` errors from Task B are still present — that's fine; Task D resolves them.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/venice-account.routes.ts backend/src/index.ts
git commit -m "[X32] mount GET /api/users/me/venice-account router with 30/min limit"
```

---

## Phase D — Backend deletes (and old-test removal)

### Task D: Strip the obsolete verify + balance routes and their tests

**Files:**
- Modify: `backend/src/routes/venice-key.routes.ts`
- Modify: `backend/src/routes/ai.routes.ts`
- Delete: `backend/tests/routes/venice-key-verify.test.ts`
- Delete: `backend/tests/ai/balance.test.ts`
- Modify: `backend/tests/ai/error-handling.test.ts`
- Modify: `backend/tests/routes/venice-key.test.ts` (peek first)

- [ ] **Step 1: Strip verify-related code from `venice-key.routes.ts`**

Open `backend/src/routes/venice-key.routes.ts`. Apply these deletions:

1. Remove `createVerifyRateLimiter` function (the entire block after the imports through its closing `}`)
2. Remove `verifyRateLimitWindowMs?: number` from `VeniceKeyRouterOptions`
3. Remove the entire `router.post('/verify', ...)` block at the end of the file
4. Remove the now-unused imports: `import rateLimit, { ipKeyGenerator } from 'express-rate-limit';` and `import { AuthenticationError, mapVeniceError } from '../lib/venice-errors';`

The final file should be ~100 lines and have only GET / PUT / DELETE handlers plus `badRequestFromZod`. Run a sanity grep:

```bash
grep -E "verify|VerifyRate|AuthenticationError|mapVeniceError" backend/src/routes/venice-key.routes.ts
```

Expected: no output.

- [ ] **Step 2: Strip the `/balance` route from `ai.routes.ts`**

Open `backend/src/routes/ai.routes.ts`. Find the block around line 110-127:

```ts
// [V10] GET /api/ai/balance — reads x-venice-balance-usd and x-venice-balance-diem
// from Venice response headers via a lightweight models.list() call.
// Does NOT use the models service cache (balance must be fresh).
// Returns { credits: number | null, diem: number | null }.
router.get('/balance', async (req: Request, res: Response, next: NextFunction) => {
  // ... full handler ...
});
```

Delete the entire block including the comment. After deletion, verify:

```bash
grep -E "/balance|x-venice-balance" backend/src/routes/ai.routes.ts
```

Expected: no output.

- [ ] **Step 3: Delete the old test files**

```bash
rm backend/tests/routes/venice-key-verify.test.ts
rm backend/tests/ai/balance.test.ts
```

- [ ] **Step 4: Strip `/balance` references from `tests/ai/error-handling.test.ts`**

Open that file, find the `describe('GET /api/ai/balance', ...)` block (around line 308–365 per the spec map), and delete the entire block. After deletion:

```bash
grep -E "/balance|GET /api/ai/balance" backend/tests/ai/error-handling.test.ts
```

Expected: no output.

- [ ] **Step 5: Peek `tests/routes/venice-key.test.ts` for any `verify` refs**

```bash
grep -nE "verify|/verify|VerifyVeniceKey" backend/tests/routes/venice-key.test.ts
```

If any matches, delete the matching test cases (or the entire `describe` block they're in). The file's GET / PUT / DELETE tests for `/venice-key` itself should remain.

- [ ] **Step 6: Run typecheck — should be clean now**

```bash
cd backend && npx tsc --noEmit 2>&1 | head
```

Expected: no output (clean).

- [ ] **Step 7: Run full backend test suite — expect green except missing venice-account.test.ts coverage**

```bash
cd backend && npm test 2>&1 | tail -5
```

Expected: all currently-existing tests pass; total count drops by ~25 (verify file ~14 + balance file ~10 + error-handling /balance describe ~5). New `venice-account.test.ts` is added in Task E.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/venice-key.routes.ts \
        backend/src/routes/ai.routes.ts \
        backend/tests/ai/error-handling.test.ts \
        backend/tests/routes/venice-key.test.ts
git rm backend/tests/routes/venice-key-verify.test.ts \
       backend/tests/ai/balance.test.ts
git commit -m "[X32] delete POST /verify, GET /api/ai/balance, and their tests"
```

---

## Phase E — Backend tests for `/venice-account`

### Task E: Write `tests/routes/venice-account.test.ts` (TDD-style: tests alongside implementation already done)

**Files:**
- Create: `backend/tests/routes/venice-account.test.ts`

The implementation exists; this task adds the 14-test suite from the spec table. The tests cover the full surface: auth, no-key, balance combos, Venice errors, leak hygiene, URL pin, single-decrypt assertion, rate limit.

- [ ] **Step 1: Create the file with imports and helpers**

Path: `backend/tests/routes/venice-account.test.ts`. Initial scaffold (we'll fill the test bodies in subsequent steps):

```ts
// [X32] GET /api/users/me/venice-account — integration tests.
//
// Tests the unified account-info endpoint that replaces the old POST /verify
// and GET /api/ai/balance. Calls Venice GET /api_keys/rate_limits and reads
// `data.balances.{USD,DIEM}` from the JSON body. Per-user rate-limited at
// 30 req/min.

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, globalErrorHandler } from '../../src/index';
import { createAuthRouter } from '../../src/routes/auth.routes';
import { createVeniceAccountRouter } from '../../src/routes/venice-account.routes';
import { createVeniceKeyRouter } from '../../src/routes/venice-key.routes';
import * as cryptoService from '../../src/services/crypto.service';
import { DEFAULT_VENICE_ENDPOINT } from '../../src/services/venice-key.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Account Test User';
const USERNAME = 'venice-account-user';
const PASSWORD = 'venice-account-password';
// Sentinel — must never appear in response bodies, headers, or logs.
const VALID_KEY = 'sk-venice-account-SENTINEL-KEY-LAST6';

const NAME_B = 'Account Test User B';
const USERNAME_B = 'venice-account-user-b';
const PASSWORD_B = 'venice-account-password-b';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelsResponse(status: number): Response {
  return new Response(JSON.stringify({ object: 'list', data: [] }), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

function rateLimitsResponse(opts: { usd?: number | null; diem?: number | null } = {}): Response {
  const balances: Record<string, number> = {};
  if (opts.usd !== undefined && opts.usd !== null) balances.USD = opts.usd;
  if (opts.diem !== undefined && opts.diem !== null) balances.DIEM = opts.diem;
  return new Response(
    JSON.stringify({
      data: { balances, accessPermitted: true, apiTier: { id: 'paid', isCharged: true }, rateLimits: [] },
    }),
    { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(
  status: number,
  message = 'error',
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function registerAndLogin(
  appUnderTest: Express.Application,
  name: string,
  username: string,
  password: string,
): Promise<string> {
  await request(appUnderTest).post('/api/auth/register').send({ name, username, password });
  const login = await request(appUnderTest).post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function storeKey(
  appUnderTest: Express.Application,
  accessToken: string,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(modelsResponse(200));
  const res = await request(appUnderTest)
    .put('/api/users/me/venice-key')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ apiKey: VALID_KEY });
  expect(res.status).toBe(200);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('GET /api/users/me/venice-account [X32]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  // Tests will be filled in below.
});
```

- [ ] **Step 2: Add tests 1-2 (auth guard, no key stored)**

Inside the `describe` block:

```ts
  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  it('returns 401 without a Bearer token', async () => {
    const res = await request(app).get('/api/users/me/venice-account');
    expect(res.status).toBe(401);
  });

  // ── 2. No stored key ───────────────────────────────────────────────────────
  it('returns verified:false when no key is stored', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      balanceUsd: null,
      diem: null,
      endpoint: null,
      lastSix: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Add tests 3-6 (balance combos)**

```ts
  // ── 3. Both balances present ──────────────────────────────────────────────
  it('returns verified:true with balanceUsd and diem when both present', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 2.25, diem: 1800 }));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: true,
      balanceUsd: 2.25,
      diem: 1800,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastSix: 'LAST6',
    });
  });

  // ── 4. USD missing ─────────────────────────────────────────────────────────
  it('returns balanceUsd:null when data.balances.USD is missing', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ diem: 500 }));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBeNull();
    expect(res.body.diem).toBe(500);
  });

  // ── 5. DIEM missing ────────────────────────────────────────────────────────
  it('returns diem:null when data.balances.DIEM is missing', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1.5 }));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBe(1.5);
    expect(res.body.diem).toBeNull();
  });

  // ── 6. Empty balances ──────────────────────────────────────────────────────
  it('returns balanceUsd:null and diem:null when data.balances is empty', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({}));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBeNull();
    expect(res.body.diem).toBeNull();
  });
```

- [ ] **Step 4: Add test 7 (Venice 401 → app 200 verified:false)**

```ts
  // ── 7. Venice 401 → app 200 verified:false (key was revoked upstream) ──────
  it('returns verified:false with endpoint/lastSix echoed when Venice returns 401', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      balanceUsd: null,
      diem: null,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastSix: 'LAST6',
    });

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).not.toContain(VALID_KEY);
    errSpy.mockRestore();
  });
```

- [ ] **Step 5: Add tests 8-10 (Venice 429, 503, fetch reject — all carry `upstreamStatus`)**

```ts
  // ── 8. Venice 429 → app 429 venice_rate_limited (with upstreamStatus) ──────
  it('returns 429 venice_rate_limited with upstreamStatus when Venice rate-limits', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited', { 'retry-after': '30' }));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('venice_rate_limited');
    expect(res.body.error.upstreamStatus).toBe(429);
    expect(res.body.error.retryAfterSeconds).toBe(30);

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    errSpy.mockRestore();
  });

  // ── 9. Venice 503 → app 502 venice_unavailable (with upstreamStatus) ──────
  it('returns 502 venice_unavailable with upstreamStatus:503 when Venice returns 503', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('venice_unavailable');
    expect(res.body.error.upstreamStatus).toBe(503);

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    errSpy.mockRestore();
  });

  // ── 10. Fetch reject (transport failure) → 502 with upstreamStatus:null ───
  it('returns 502 venice_unavailable with upstreamStatus:null on transport failure', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('venice_unavailable');
    expect(res.body.error.upstreamStatus).toBeNull();

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    expect(allLogged).toContain('transport');
    errSpy.mockRestore();
  });
```

- [ ] **Step 6: Add test 11 (no plaintext key leak — sentinel sweep)**

```ts
  // ── 11. Plaintext key never in response body / headers / logs ─────────────
  it('never exposes the plaintext Venice key in the response or logs', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 5, diem: 2000 }));

    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    const logSpy = vi.spyOn(console, 'log');
    const infoSpy = vi.spyOn(console, 'info');

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(VALID_KEY);

    const headersStr = JSON.stringify(res.headers);
    expect(headersStr).not.toContain(VALID_KEY);

    const allLogged = [
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]
      .flat()
      .map(String)
      .join(' ');
    expect(allLogged).not.toContain(VALID_KEY);
  });
```

- [ ] **Step 7: Add test 12 (URL pin — locks endpoint choice)**

```ts
  // ── 12. URL pin: hits /api_keys/rate_limits ────────────────────────────────
  it('hits Venice GET /api_keys/rate_limits (not /v1/models)', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));

    await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    // The first fetch call (index 0) was the storeKey validate against /models.
    // The verify call (index 1) is what we're asserting.
    const probeCall = fetchSpy.mock.calls[1];
    expect(probeCall).toBeDefined();
    const probeUrl = String(probeCall![0]);
    expect(probeUrl).toContain('/api_keys/rate_limits');
    expect(probeUrl).not.toContain('/models');
  });
```

- [ ] **Step 8: Add test 13 (single decrypt — proves `getStatusAndKey` is the only decrypt site)**

```ts
  // ── 13. Single decrypt per request (no double-read) ────────────────────────
  it('decrypts the stored key exactly once per request', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));

    const decryptSpy = vi.spyOn(cryptoService, 'decrypt');
    const beforeCount = decryptSpy.mock.calls.length;

    await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    const decryptsForThisRequest = decryptSpy.mock.calls.length - beforeCount;
    expect(decryptsForThisRequest).toBe(1);
    decryptSpy.mockRestore();
  });
```

- [ ] **Step 9: Add test 14 (per-user 30/min rate limit, distinct from venice_rate_limited)**

```ts
  // ── 14. Per-user 30/min rate limit (account_rate_limited, not venice_*) ───
  it('rate-limits at 30/min per user; user B unaffected; emits account_rate_limited code', async () => {
    const testApp = express();
    testApp.use(helmet());
    testApp.use(cors({ origin: true, credentials: true }));
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use('/api/auth', createAuthRouter());
    testApp.use('/api/users/me/venice-key', createVeniceKeyRouter());
    testApp.use(
      '/api/users/me/venice-account',
      createVeniceAccountRouter({ accountRateLimitWindowMs: 200 }),
    );
    testApp.use(globalErrorHandler);

    const tokenA = await registerAndLogin(testApp, NAME, USERNAME, PASSWORD);
    const tokenB = await registerAndLogin(testApp, NAME_B, USERNAME_B, PASSWORD_B);
    await storeKey(testApp, tokenA, fetchSpy);
    await storeKey(testApp, tokenB, fetchSpy);

    // 30 successes for user A + 1 for user B = 31 fetch slots needed.
    for (let i = 0; i < 31; i++) {
      fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));
    }

    for (let i = 0; i < 30; i++) {
      const r = await request(testApp)
        .get('/api/users/me/venice-account')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(r.status).toBe(200);
    }

    // 31st request from user A should be rate-limited with the router's own code.
    const blocked = await request(testApp)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('account_rate_limited');
    // CRITICAL: this is OUR limit (chatty client), distinct from `venice_rate_limited` (Venice's limit).
    expect(blocked.body.error.code).not.toBe('venice_rate_limited');

    // User B not blocked.
    const userBRes = await request(testApp)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(userBRes.status).toBe(200);
  }, 15_000);
```

- [ ] **Step 10: Run the new file alone**

```bash
cd backend && npx vitest run tests/routes/venice-account.test.ts 2>&1 | tail -10
```

Expected: 14 tests passed.

If any fail, debug the implementation in venice-key.service.ts / venice-account.routes.ts (likely candidates: error log message text mismatch in test 8/9/10, the `lib/venice-errors` `parseRetryAfter` not seeing the header, the decrypt spy not finding the right module path).

- [ ] **Step 11: Run the whole backend suite — must be green**

```bash
cd backend && npm test 2>&1 | tail -3
```

Expected: all tests pass. The total count should be (Task A baseline) − ~25 (deleted verify + balance + error-handling block) + 14 (new venice-account tests) = roughly Task A baseline − 11.

- [ ] **Step 12: Commit**

```bash
git add backend/tests/routes/venice-account.test.ts
git commit -m "[X32] add 14-test integration suite for /api/users/me/venice-account"
```

---

## Phase F — Frontend: ApiError carries body

### Task F: Extend `ApiError` so callers can read `upstreamStatus`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/tests/lib/api.test.ts` (peek for existing tests; add one if the file exists, else inline-test the change in the next task)

The Settings tab needs `err.body?.error?.upstreamStatus` to feed into `useErrorStore`. Today `ApiError` exposes only `status`, `message`, and `code`. Add an optional `body` field carrying the parsed JSON.

- [ ] **Step 1: Open `frontend/src/lib/api.ts` and extend `ApiErrorBody` + `ApiError`**

Replace the existing `ApiErrorBody` interface (around line 59-64) with:

```ts
export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: string;
    upstreamStatus?: number | null;
    retryAfterSeconds?: number | null;
    // Allow further fields without breaking existing callers.
    [key: string]: unknown;
  };
}
```

Replace the existing `ApiError` class (around line 66-76) with:

```ts
export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly body?: ApiErrorBody;

  constructor(status: number, message: string, code?: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
```

- [ ] **Step 2: Update `parseErrorBody` to return the full body**

Replace the existing `parseErrorBody` function (around line 144-163) with:

```ts
async function parseErrorBody(
  res: Response,
): Promise<{ message: string; code?: string; body?: ApiErrorBody }> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const data = (await res.json()) as ApiErrorBody;
      const message = data.error?.message ?? res.statusText ?? `HTTP ${res.status}`;
      const code = data.error?.code;
      return { message, code, body: data };
    } catch {
      // fall through
    }
  }
  try {
    const text = await res.text();
    if (text) return { message: text };
  } catch {
    // ignore
  }
  return { message: res.statusText || `HTTP ${res.status}` };
}
```

- [ ] **Step 3: Update the three call sites that throw `ApiError` to pass `body`**

In `doRequest`, three throw-sites use `parseErrorBody`. Update each to pass `body`:

```ts
// First: non-2xx non-401 path (around line 232-235)
if (!firstRes.ok) {
  const { message, code, body } = await parseErrorBody(firstRes);
  throw new ApiError(firstRes.status, message, code, body);
}

// Second: refresh-failed 401 path (around line 244-246)
const { message, code, body } = await parseErrorBody(firstRes);
throw new ApiError(401, message, code, body);

// Third: retry-failed path (around line 252-258)
if (!retryRes.ok) {
  const { message, code, body } = await parseErrorBody(retryRes);
  if (retryRes.status === 401) {
    setAccessToken(null);
    if (onUnauthorized) onUnauthorized();
  }
  throw new ApiError(retryRes.status, message, code, body);
}
```

- [ ] **Step 4: Run frontend typecheck — should be clean**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head
```

Expected: no output. The change is additive (`body` is optional); existing callers don't need updates.

- [ ] **Step 5: Run any existing api tests**

```bash
cd frontend && npx vitest run tests/lib/api.test.ts 2>&1 | tail -5
```

If the file exists, expected: pass. If it doesn't, skip — Task I's Settings tests will exercise the body-carrying behaviour end-to-end.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "[X32] ApiError carries parsed body so callers can read upstreamStatus etc"
```

---

## Phase G — Frontend: useVeniceAccount hook

### Task G: New `useVeniceAccount` hook + tests

**Files:**
- Create: `frontend/src/hooks/useVeniceAccount.ts`
- Create: `frontend/tests/hooks/useVeniceAccount.test.tsx`

- [ ] **Step 1: Write the hook test first**

Path: `frontend/tests/hooks/useVeniceAccount.test.tsx`. Full contents:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { useVeniceAccountQuery, veniceAccountQueryKey } from '@/hooks/useVeniceAccount';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(): { wrapper: ({ children }: { children: ReactNode }) => JSX.Element; client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  function wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper, client };
}

describe('useVeniceAccountQuery [X32]', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('hits GET /api/users/me/venice-account', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        verified: true,
        balanceUsd: 1.23,
        diem: 4567,
        endpoint: 'https://api.venice.ai/api/v1',
        lastSix: 'ABCDEF',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVeniceAccountQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('/api/users/me/venice-account');
  });

  it('returns the VeniceAccount shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          verified: true,
          balanceUsd: 9.99,
          diem: 100,
          endpoint: null,
          lastSix: 'ZZZZZZ',
        }),
      ),
    );

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVeniceAccountQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      verified: true,
      balanceUsd: 9.99,
      diem: 100,
      endpoint: null,
      lastSix: 'ZZZZZZ',
    });
  });

  it('exposes veniceAccountQueryKey for invalidation', () => {
    expect(veniceAccountQueryKey).toEqual(['venice-account']);
  });

  it('respects the enabled flag', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchSpy);

    const { wrapper } = makeWrapper();
    renderHook(() => useVeniceAccountQuery(false), { wrapper });

    // Disabled query doesn't fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test — expect failure (hook doesn't exist)**

```bash
cd frontend && npx vitest run tests/hooks/useVeniceAccount.test.tsx 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module '@/hooks/useVeniceAccount'".

- [ ] **Step 3: Create the hook**

Path: `frontend/src/hooks/useVeniceAccount.ts`. Full contents:

```ts
/**
 * [X32] TanStack Query hook for the unified Venice account-info endpoint.
 *
 * Replaces the old `useBalanceQuery` (F17) AND the per-click verify mutation
 * in Settings. One query, one cache key, one refetch path. The Settings
 * "Verify" button invalidates this query rather than POSTing separately.
 *
 * Backend contract (X32): `GET /api/users/me/venice-account` returns
 * `{ verified, balanceUsd, diem, endpoint, lastSix }`. Either of `balanceUsd`
 * / `diem` may be null when Venice's account-info payload omits them.
 * 409 `venice_key_required` is raised when the user has no BYOK key stored.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface VeniceAccount {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
}

export const veniceAccountQueryKey = ['venice-account'] as const;

export function useVeniceAccountQuery(enabled = true): UseQueryResult<VeniceAccount, Error> {
  return useQuery<VeniceAccount, Error>({
    queryKey: veniceAccountQueryKey,
    queryFn: async (): Promise<VeniceAccount> => {
      return api<VeniceAccount>('/users/me/venice-account');
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
```

- [ ] **Step 4: Re-run the test — expect pass**

```bash
cd frontend && npx vitest run tests/hooks/useVeniceAccount.test.tsx 2>&1 | tail -5
```

Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useVeniceAccount.ts frontend/tests/hooks/useVeniceAccount.test.tsx
git commit -m "[X32] add useVeniceAccountQuery hook + tests"
```

---

## Phase H — Frontend: BalanceDisplay rename + integration mocks

### Task H: Update BalanceDisplay, callers, and integration test mocks

**Files:**
- Modify: `frontend/src/components/BalanceDisplay.tsx`
- Modify: `frontend/tests/components/BalanceDisplay.test.tsx`
- Modify: `frontend/src/components/UserMenu.tsx`
- Modify: `frontend/src/components/TopBar.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify (7 files): `frontend/tests/pages/{editor,editor-shell,editor-paper,character-popover,editor-autosave,chat-panel,editor-ai}.integration.test.tsx`
- Delete: `frontend/src/hooks/useBalance.ts`

- [ ] **Step 1: Update `BalanceDisplay.test.tsx` field names — write the failing tests first**

Open `frontend/tests/components/BalanceDisplay.test.tsx`. Three places use `credits`. Replace each occurrence:

- Line 25: `<BalanceDisplay balance={{ credits: 2415.3, diem: 482193 }} />` → `<BalanceDisplay balance={{ verified: true, balanceUsd: 2415.3, diem: 482193, endpoint: null, lastSix: null }} />`
- Line 31: `<BalanceDisplay balance={{ credits: null, diem: 482193 }} />` → `<BalanceDisplay balance={{ verified: true, balanceUsd: null, diem: 482193, endpoint: null, lastSix: null }} />`
- Line 37: `<BalanceDisplay balance={{ credits: 0, diem: 0 }} />` → `<BalanceDisplay balance={{ verified: true, balanceUsd: 0, diem: 0, endpoint: null, lastSix: null }} />`
- Line 51-52: `const partial = { credits: 2.5 } as unknown as { credits: number | null; diem: number | null };` → `const partial = { verified: true, balanceUsd: 2.5, endpoint: null, lastSix: null } as unknown as VeniceAccount;`
- Line 74: `<BalanceDisplay balance={{ credits: 2415.3, diem: 482193 }} />` → `<BalanceDisplay balance={{ verified: true, balanceUsd: 2415.3, diem: 482193, endpoint: null, lastSix: null }} />`

Also add the import at the top: `import type { VeniceAccount } from '@/hooks/useVeniceAccount';`

- [ ] **Step 2: Run the tests — expect failure (component still consumes `credits`)**

```bash
cd frontend && npx vitest run tests/components/BalanceDisplay.test.tsx 2>&1 | tail -10
```

Expected: TypeScript compile errors and test failures pointing at `credits`.

- [ ] **Step 3: Update `BalanceDisplay.tsx`**

Open `frontend/src/components/BalanceDisplay.tsx`. Replace:

```ts
import type { Balance } from '@/hooks/useBalance';

export interface BalanceDisplayProps {
  balance: Balance | null;
```

with:

```ts
import type { VeniceAccount } from '@/hooks/useVeniceAccount';

export interface BalanceDisplayProps {
  balance: VeniceAccount | null;
```

And the render line:

```ts
const usd = balance.credits == null ? 'USD: —' : `USD: ${formatUsd(balance.credits)}`;
```

becomes:

```ts
const usd = balance.balanceUsd == null ? 'USD: —' : `USD: ${formatUsd(balance.balanceUsd)}`;
```

- [ ] **Step 4: Re-run BalanceDisplay tests**

```bash
cd frontend && npx vitest run tests/components/BalanceDisplay.test.tsx 2>&1 | tail -5
```

Expected: pass.

- [ ] **Step 5: Update `EditorPage.tsx` to use `useVeniceAccountQuery`**

Open `frontend/src/pages/EditorPage.tsx`. Replace:

```ts
import { useBalanceQuery } from '@/hooks/useBalance';
```

with:

```ts
import { useVeniceAccountQuery } from '@/hooks/useVeniceAccount';
```

And:

```ts
const balanceQuery = useBalanceQuery();
```

with:

```ts
const balanceQuery = useVeniceAccountQuery();
```

The variable name `balanceQuery` is preserved — no need to update downstream prop names. The shape change (`credits → balanceUsd`) is contained inside `BalanceDisplay`, which already gets the full query data.

Update the comment at line 9:

```ts
//   - useBalanceQuery()                   → UserMenu balance
```

becomes:

```ts
//   - useVeniceAccountQuery()             → UserMenu balance
```

- [ ] **Step 6: Update `UserMenu.tsx` and `TopBar.tsx` type imports**

In both files, replace:

```ts
import type { Balance } from '@/hooks/useBalance';
```

with:

```ts
import type { VeniceAccount } from '@/hooks/useVeniceAccount';
```

And replace every `Balance` type reference with `VeniceAccount`. Likely just the prop type lines (`balance?: Balance | null` → `balance?: VeniceAccount | null`).

- [ ] **Step 7: Update integration test mocks (7 files)**

For each of these files, find the `endsWith('/ai/balance')` line and update both the URL match and the mock body:

```bash
grep -rln "/ai/balance" frontend/tests/pages
```

For each file matched, change:

```ts
if (url.endsWith('/ai/balance')) {
  return Promise.resolve(jsonResponse(200, { balance: { dollars: 1.23, vcu: 100 } }));
}
```

to:

```ts
if (url.endsWith('/users/me/venice-account')) {
  return Promise.resolve(
    jsonResponse(200, {
      verified: true,
      balanceUsd: 1.23,
      diem: 100,
      endpoint: null,
      lastSix: null,
    }),
  );
}
```

(Preserve any per-file numeric values — e.g. `editor-paper.integration.test.tsx` uses `dollars: 1` in some places. Translate `dollars → balanceUsd`, `vcu → diem`.)

- [ ] **Step 8: Delete the old hook file**

```bash
rm frontend/src/hooks/useBalance.ts
```

- [ ] **Step 9: Run the frontend typecheck — must be clean**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head
```

Expected: no output. If there are stragglers (`Cannot find module '@/hooks/useBalance'`), grep and fix them:

```bash
grep -rln "useBalance\b\|from '@/hooks/useBalance'" frontend/src frontend/tests
```

Should be empty.

- [ ] **Step 10: Run the full frontend test suite**

```bash
cd frontend && npm test 2>&1 | tail -3
```

Expected: all tests pass. The Settings.shell-venice tests will still pass at this point because Settings.tsx still references `useVerifyVeniceKeyMutation` — that's torn out in Task I.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/BalanceDisplay.tsx \
        frontend/tests/components/BalanceDisplay.test.tsx \
        frontend/src/components/UserMenu.tsx \
        frontend/src/components/TopBar.tsx \
        frontend/src/pages/EditorPage.tsx \
        frontend/tests/pages/editor.integration.test.tsx \
        frontend/tests/pages/editor-shell.integration.test.tsx \
        frontend/tests/pages/editor-paper.integration.test.tsx \
        frontend/tests/pages/character-popover.integration.test.tsx \
        frontend/tests/pages/editor-autosave.integration.test.tsx \
        frontend/tests/pages/chat-panel.integration.test.tsx \
        frontend/tests/pages/editor-ai.integration.test.tsx
git rm frontend/src/hooks/useBalance.ts
git commit -m "[X32] swap useBalanceQuery → useVeniceAccountQuery; rename Balance type"
```

---

## Phase I — Frontend: Settings tab switchover

### Task I: Replace `useVerifyVeniceKeyMutation` with `useVeniceAccountQuery` in Settings

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/src/hooks/useVeniceKey.ts`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx`

This is the largest task. The Settings tab today uses a verifyMutation that POSTs `/verify`. After this task, it derives all "Verify" / "Save+Verify" pill state from the same `useVeniceAccountQuery` that feeds the BalanceDisplay header pill. A click on "Verify" invalidates the query.

- [ ] **Step 1: Rewrite the Settings.shell-venice tests for verify flow first (TDD)**

Open `frontend/tests/components/Settings.shell-venice.test.tsx`. Find the verify-related tests (the two blocks that mock `'/api/users/me/venice-key/verify'`, around lines 348+ per the spec map).

Replace each with assertions that:
1. Mock `GET /api/users/me/venice-account` instead of POST `/verify`
2. After clicking Verify, assert the GET happens (or query refetch happens)
3. Assert the pill renders the verified state

Concrete rewrite of the first verify test (the "Verify success" case — adapt the second with `verified: false` shape similarly):

```ts
it('Verify button refetches /venice-account and shows balance pill on success', async () => {
  const accountResponse = {
    verified: true,
    balanceUsd: 22.5,
    diem: 1000,
    endpoint: 'https://api.venice.ai/api/v1',
    lastSix: 'ABCDEF',
  };
  let accountCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (typeof url === 'string') {
        if (url.endsWith('/api/users/me/venice-key') && method === 'GET') {
          return Promise.resolve(
            jsonResponse(200, { hasKey: true, lastSix: 'ABCDEF', endpoint: null }),
          );
        }
        if (url.endsWith('/api/users/me/venice-account') && method === 'GET') {
          accountCalls++;
          return Promise.resolve(jsonResponse(200, accountResponse));
        }
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );

  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={vi.fn()} />);

  // Wait for initial query.
  await waitFor(() => expect(accountCalls).toBeGreaterThanOrEqual(1));

  await waitFor(() =>
    expect(screen.getByTestId('venice-key-verify')).not.toBeDisabled(),
  );

  const beforeClick = accountCalls;
  await user.click(screen.getByTestId('venice-key-verify'));

  await waitFor(() => expect(accountCalls).toBeGreaterThan(beforeClick));

  await waitFor(() => {
    const pill = screen.getByTestId('venice-key-pill');
    expect(pill.textContent ?? '').toMatch(/Verified.*\$22\.50/i);
  });
});

it('Verify button shows "Not verified" pill when account responds verified:false', async () => {
  let returnVerified = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (typeof url === 'string') {
        if (url.endsWith('/api/users/me/venice-key') && method === 'GET') {
          return Promise.resolve(
            jsonResponse(200, { hasKey: true, lastSix: 'ABCDEF', endpoint: null }),
          );
        }
        if (url.endsWith('/api/users/me/venice-account') && method === 'GET') {
          return Promise.resolve(
            jsonResponse(200, {
              verified: returnVerified,
              balanceUsd: null,
              diem: null,
              endpoint: null,
              lastSix: 'ABCDEF',
            }),
          );
        }
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );

  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={vi.fn()} />);

  await waitFor(() =>
    expect(screen.getByTestId('venice-key-verify')).not.toBeDisabled(),
  );

  await user.click(screen.getByTestId('venice-key-verify'));

  await waitFor(() => {
    const pill = screen.getByTestId('venice-key-pill');
    expect(pill.textContent ?? '').toMatch(/Not verified.*ABCDEF/i);
  });
});
```

If the test file already has a Save-then-verify chained test, update it similarly: instead of asserting that a POST `/verify` follows the PUT `/venice-key`, assert the PUT happens followed by a GET `/venice-account` invalidation refetch.

- [ ] **Step 2: Run the rewritten tests — expect failure**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx 2>&1 | tail -10
```

Expected: failures because `Settings.tsx` still uses the verify mutation. Move on to fix the implementation.

- [ ] **Step 3: Update `Settings.tsx` — replace verifyMutation with useVeniceAccountQuery + invalidate**

Open `frontend/src/components/Settings.tsx`. At the top imports, swap:

```ts
import {
  useDeleteVeniceKeyMutation,
  useStoreVeniceKeyMutation,
  useVeniceKeyStatusQuery,
  useVerifyVeniceKeyMutation,
  type VeniceKeyVerify,
} from '@/hooks/useVeniceKey';
```

with:

```ts
import {
  useDeleteVeniceKeyMutation,
  useStoreVeniceKeyMutation,
  useVeniceKeyStatusQuery,
} from '@/hooks/useVeniceKey';
import { useVeniceAccountQuery, veniceAccountQueryKey } from '@/hooks/useVeniceAccount';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { useErrorStore } from '@/store/errors';
import { formatUsd } from '@/components/BalanceDisplay';
```

(Note: post-X26 the `formatUsd` import already exists; leave it unchanged. Pre-X26 add it.)

In the `VeniceTab` function, replace:

```ts
const verifyMutation = useVerifyVeniceKeyMutation();
```

with:

```ts
const accountQuery = useVeniceAccountQuery(status?.hasKey ?? false);
const queryClient = useQueryClient();
```

(`status` comes from `useVeniceKeyStatusQuery` already in scope. Disable the account query when there's no key — avoids a 409 venice_key_required cycle.)

- [ ] **Step 4: Replace `handleVerify` with a query-invalidating handler**

Replace the existing `handleVerify` function with:

```ts
const handleVerify = (): void => {
  void queryClient.invalidateQueries({ queryKey: veniceAccountQueryKey });
};
```

- [ ] **Step 5: Replace the Save flow's mutation-chain with invalidation**

In `handleSave` (the X26 version chains `verifyMutation.mutateAsync` after `storeMutation.mutateAsync`; the pre-X26 version doesn't but we want it to). Replace the post-X26 chain:

```ts
try {
  const res = await verifyMutation.mutateAsync();
  applyVerifyResult(res);
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Verification failed';
  setVerifyPill({ kind: 'err', message: msg });
}
```

with:

```ts
void queryClient.invalidateQueries({ queryKey: veniceAccountQueryKey });
```

The pill state is derived from `accountQuery` directly (next step), so we don't need to keep `verifyPill` as React state for these cases.

- [ ] **Step 6: Replace the `verifyPill` state with derived state**

Delete:

```ts
const [verifyPill, setVerifyPill] = useState<VerifyPillState>({ kind: 'idle', message: '' });
```

and the `applyVerifyResult` function (post-X26 only).

Add a derived `verifyPill` computed from `accountQuery`:

```ts
const lastSix = status?.lastSix ?? null;
const accountErr = accountQuery.error;

let verifyPill: VerifyPillState = { kind: 'idle', message: '' };
if (status?.hasKey) {
  if (accountQuery.isFetching) {
    verifyPill = { kind: 'idle', message: 'Verifying…' };
  } else if (accountErr instanceof Error) {
    const six = lastSix ?? '??????';
    verifyPill = { kind: 'err', message: `Not verified · last six ${six}` };
  } else if (accountQuery.data) {
    if (accountQuery.data.verified) {
      const usd =
        accountQuery.data.balanceUsd != null ? formatUsd(accountQuery.data.balanceUsd) : 'USD —';
      verifyPill = { kind: 'ok', message: `Verified · ${usd}` };
    } else {
      const six = accountQuery.data.lastSix ?? lastSix ?? '??????';
      verifyPill = { kind: 'err', message: `Not verified · last six ${six}` };
    }
  }
}
```

(The `kind: 'idle', message: 'Verifying…'` slot uses idle so the existing JSX `verifyPill.kind !== 'idle' ? ...` check needs adjusting — easier to use a new `'pending'` kind or render the verifying state separately. Quick fix: add `'pending'` to the `VerifyPillState` union and render with neutral styling, then use `verifyPill.kind !== 'idle'` in the JSX.)

Update the type:

```ts
interface VerifyPillState {
  kind: 'idle' | 'pending' | 'ok' | 'err';
  message: string;
}
```

And the JSX rendering branch — extend the className conditional:

```tsx
{verifyPill.kind !== 'idle' ? (
  <span
    role="status"
    data-testid="venice-key-pill"
    data-pill={verifyPill.kind}
    className={[
      'mt-1 inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono',
      verifyPill.kind === 'ok'
        ? 'bg-success-soft text-[color:var(--success)]'
        : verifyPill.kind === 'err'
          ? 'bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[color:var(--danger)]'
          : 'bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-ink-3',
    ].join(' ')}
  >
    {verifyPill.message}
  </span>
) : null}
```

Set `kind: 'pending'` (not `'idle'`) in the verifying-now branch above:

```ts
if (accountQuery.isFetching) {
  verifyPill = { kind: 'pending', message: 'Verifying…' };
}
```

- [ ] **Step 7: Add an effect that pushes errors to `useErrorStore`**

In `VeniceTab`, just below the `accountQuery` declaration, add:

```ts
useEffect(() => {
  if (!accountQuery.error) return;
  const err = accountQuery.error;
  const body = err instanceof ApiError ? err.body : undefined;
  const upstream = body?.error?.upstreamStatus ?? null;
  useErrorStore.getState().push({
    severity: 'error',
    source: 'venice-account',
    code: body?.error?.code ?? null,
    message: err.message,
    httpStatus: err instanceof ApiError ? err.status : undefined,
    detail: { upstreamStatus: upstream },
  });
}, [accountQuery.error]);
```

(`useEffect` needs to be in the imports if not already.)

- [ ] **Step 8: Update Verify button's disabled state**

The Verify button currently checks `verifyMutation.isPending`. Switch to:

```tsx
<button
  type="button"
  data-testid="venice-key-verify"
  disabled={!status?.hasKey || accountQuery.isFetching}
  onClick={() => {
    handleVerify();
  }}
  ...
>
  {accountQuery.isFetching ? 'Verifying…' : 'Verify'}
</button>
```

- [ ] **Step 9: Strip `useVerifyVeniceKeyMutation` and `VeniceKeyVerify` from `useVeniceKey.ts`**

Open `frontend/src/hooks/useVeniceKey.ts`. Delete:

1. The entire `useVerifyVeniceKeyMutation` function (last 7 lines of the file)
2. The `VeniceKeyVerify` interface
3. From the JSDoc, remove the bullet `- POST /api/users/me/venice-key/verify → check against Venice`

- [ ] **Step 10: Run typecheck**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head
```

Expected: clean. If there are stragglers (`Cannot find name 'verifyMutation'`, `Cannot find name 'VeniceKeyVerify'`), grep:

```bash
grep -rn "verifyMutation\|VeniceKeyVerify\|useVerifyVeniceKeyMutation" frontend/src frontend/tests
```

Anything left points to a missed update site.

- [ ] **Step 11: Run the Settings tests and the full frontend suite**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx 2>&1 | tail -5
cd frontend && npm test 2>&1 | tail -3
```

Expected: both pass. If the Settings tests fail, the most likely culprit is the pill text — the new derivation uses `formatUsd` (e.g. `$22.50`) where the test asserted `22.50 credits`. Match the test's regex to the actual rendered string.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/Settings.tsx \
        frontend/src/hooks/useVeniceKey.ts \
        frontend/tests/components/Settings.shell-venice.test.tsx
git commit -m "[X32] Settings: derive verify pill from useVeniceAccountQuery; click invalidates"
```

---

## Phase J — Docs

### Task J: Update API contract, Venice integration, TASKS

**Files:**
- Modify: `docs/api-contract.md`
- Modify: `docs/venice-integration.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Update `docs/api-contract.md`**

Find and DELETE these two sections in full (including their `###` heading line and any blank line below):

1. The `### POST /api/users/me/venice-key/verify ([V18])` block (around lines 71-72)
2. The `### GET /api/ai/balance` section (look in the AI endpoints area)

Add a new section in the user-settings/venice area:

```markdown
### `GET /api/users/me/venice-account` ([X32])
Per-user rate-limited 30 req/min. Probes Venice's `GET /api_keys/rate_limits` endpoint and reads `data.balances.{USD,DIEM}` from the body.
Response `200`: `{ "verified": true, "balanceUsd": 22.5, "diem": 15.0, "endpoint": "https://api.venice.ai/api/v1", "lastSix": "abx9ab" }`. Either of `balanceUsd` / `diem` may be `null` when the corresponding currency isn't on the user's account. `verified: false` is returned (still HTTP 200) when no key is stored OR the stored key was rejected by Venice (401/403).
Errors:
- `429 { code: "venice_rate_limited", upstreamStatus: 429, retryAfterSeconds }` — Venice itself rate-limited our probe.
- `429 { code: "account_rate_limited" }` — our own per-user limit (chatty client). Distinct from `venice_rate_limited` so the frontend can tell which side is the bottleneck.
- `502 { code: "venice_unavailable", upstreamStatus: number | null }` — non-401/429 from Venice (5xx, 4xx other than auth) or transport failure (`upstreamStatus: null` in the latter case).

Replaces the deleted `GET /api/ai/balance` (V10) and `POST /api/users/me/venice-key/verify` (V18).
```

Update the "Secrets" bullet at the top of the file:

```markdown
- **Secrets** — `passwordHash` is never returned. The decrypted Venice API key is never returned; the "hasKey / lastSix / endpoint" shape is the only read surface ([AU12]). Balance is exposed via `GET /api/users/me/venice-account` ([X32]) only.
```

- [ ] **Step 2: Update `docs/venice-integration.md`**

Open the file and find the line that starts:

```
`GET /api/ai/balance` makes a lightweight Venice call and returns `x-venice-balance-usd` + `x-venice-balance-diem`. The frontend shows these in the user menu / settings → Venice tab ([F43]).
```

Replace with:

```
`GET /api/users/me/venice-account` ([X32]) makes a lightweight Venice call to `GET /api_keys/rate_limits` and reads `data.balances.{USD,DIEM}` from the JSON body. Returns `{ verified, balanceUsd, diem, endpoint, lastSix }`. The frontend shows these in the user menu (header pill via `useVeniceAccountQuery`) and settings → Venice tab. Per-user rate-limited at 30 req/min. **Note:** the legacy `/api/ai/balance` endpoint was removed; it read non-existent `x-venice-balance-*` headers off `/v1/models` and always returned null balances.
```

Find the line that mentions `x-venice-balance-usd + x-venice-balance-diem for /balance` in the rate-limit forwarding section (around line 291). Replace with:

```
- Our side: we forward `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` (`backend/src/routes/ai.routes.ts:241–248`, `backend/src/routes/chat.routes.ts:364–371`), and read `data.balances.{USD,DIEM}` from `/api_keys/rate_limits` for `/api/users/me/venice-account` (`backend/src/services/venice-key.service.ts:getAccount`).
```

- [ ] **Step 3: Update `TASKS.md`**

Find the `[X31]` line. Tick it as `[x]` and append:

```
[x] X31: rename /api/ai/balance credits → balanceUsd
    superseded-by: X32 (the rename happened as part of consolidating the endpoint)
```

Add an `[x] X32` entry directly below (or in the live X-section):

```
[ ] X32: Unified Venice account-info endpoint
    plan: docs/superpowers/plans/2026-05-04-x32-venice-account-endpoint.md
    spec: docs/superpowers/specs/2026-05-04-x32-venice-account-endpoint-design.md
    verify: cd backend && npx vitest run tests/routes/venice-account.test.ts && cd ../frontend && npx vitest run tests/hooks/useVeniceAccount.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/BalanceDisplay.test.tsx
```

(Match the formatting style of nearby tasks — peek at adjacent X-series entries for the convention.)

- [ ] **Step 4: Commit**

```bash
git add docs/api-contract.md docs/venice-integration.md TASKS.md
git commit -m "[X32] docs: api-contract + venice-integration; tick X31 + add X32"
```

---

## Phase K — Final smoke + lint

### Task K: Full-stack verify + lint pass

**Files:** none (verification only)

- [ ] **Step 1: Backend full suite**

```bash
cd backend && npm test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 2: Frontend full suite**

```bash
cd frontend && npm test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Root lint**

```bash
cd .. && npm run lint 2>&1 | tail -5
```

Expected: clean (or pre-existing warnings only — no new errors from this PR).

- [ ] **Step 4: Run `task-verify X32`**

```bash
/task-verify X32
```

Expected: exit 0. (This will run the verify command from `TASKS.md` — the combined backend + frontend test commands.)

- [ ] **Step 5: Manual smoke-test note (skip if running in CI-only environment)**

If a dev environment is available, manually verify:
1. Open http://localhost:3000, log in.
2. Confirm the header pill shows a real USD figure (e.g. "USD: $0.99") rather than "USD: —" or "Balance unavailable".
3. Open Settings → Venice tab. Click "Verify". Confirm the pill renders "Verifying…" briefly, then "Verified · $X.XX".
4. Open browser devtools Network tab; confirm clicking Verify triggers `GET /api/users/me/venice-account` (no `POST /verify`).
5. (Optional) Trigger an error case by storing an invalid key, then Verify; confirm the pill shows "Not verified · last six XXXXXX" and an error appears in DevErrorOverlay (if dev mode).

If no dev environment available: note as untested and rely on the integration tests.

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "[X32] Unified Venice account-info endpoint" \
  --body "$(cat <<'EOF'
## Summary
Closes [X32] (and supersedes [X31]).

- Replaces `GET /api/ai/balance` and `POST /api/users/me/venice-key/verify` with one `GET /api/users/me/venice-account`.
- Fixes the BalanceDisplay header pill (was reading non-existent `x-venice-balance-*` headers off `/v1/models`).
- Per-user 30/min rate limit (distinct `account_rate_limited` code, not shared with other endpoints).
- `upstreamStatus` carried through to the frontend's `useErrorStore` for DevErrorOverlay triage.
- Internal `getStatusAndKey()` halves DB reads + decrypts on the hot path.
- `parseRetryAfter` deduped against `lib/venice-errors.ts`.

## Notes
- Pre-deployment rule: `/verify` and `/balance` deleted outright (no backward-compat alias).
- If PR #59 (X26) merges first, X32 just rebases. If not, the X26 renames (`lastFour → lastSix`, `credits → balanceUsd`) are absorbed in this PR — see the plan's Task A absorb path.

## Test plan
- [x] Backend: `tests/routes/venice-account.test.ts` (14 tests) all pass
- [x] Frontend: `tests/hooks/useVeniceAccount.test.tsx` (4 tests) all pass
- [x] Frontend: `tests/components/Settings.shell-venice.test.tsx` rewritten for query-invalidation flow
- [x] Frontend: `tests/components/BalanceDisplay.test.tsx` field-renamed
- [x] Full backend + frontend suites green
- [x] Lint clean
- [ ] Manual smoke: header pill shows USD; Settings → Verify works; Network shows GET /venice-account

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

- **Spec coverage check** (each spec section → tasks):
  - Backend new route + service method → Tasks B, C ✓
  - Backend deletes (verify route, /balance route, error classes, parseRetryAfter local) → Tasks B, D ✓
  - Backend rate limiter (30/min, account_rate_limited) → Task C step 1; tested in Task E step 9 ✓
  - Backend errors carry upstreamStatus → Task B step 1 (errors), Task C step 1 (route maps); tested in Task E steps 5 ✓
  - Backend logging (`[X32]` console.error) → Task B step 7; tested in Task E steps 4-5 ✓
  - Backend tests (14 from spec table) → Task E steps 2-9 ✓
  - Backend test deletions → Task D ✓
  - Frontend useVeniceAccountQuery → Task G ✓
  - Frontend ApiError carries body → Task F ✓
  - Frontend BalanceDisplay rename + callers → Task H ✓
  - Frontend Settings switchover (verifyMutation → query invalidation) → Task I ✓
  - Frontend pill state derivation (5 rows in spec table) → Task I steps 6-7 ✓
  - Frontend useErrorStore push on error → Task I step 7 ✓
  - Frontend tests (rename + Settings rewrites + new hook tests + integration mocks) → Tasks G, H, I ✓
  - Docs updates (api-contract, venice-integration, TASKS) → Task J ✓
  - Final smoke + lint → Task K ✓
  - Branch sync / X26 absorb fallback → Task A ✓

- **Placeholder scan:** No "TBD", no "implement later", no "similar to". The integration-mock step (H7) lists 7 specific files by name; the verify-test rewrite (I1) gives concrete code blocks; the docs updates (J1-J3) cite exact line locations or surrounding text to match.

- **Type-consistency check:**
  - `VeniceAccountResult` (backend) vs `VeniceAccount` (frontend) — both use `{ verified, balanceUsd, diem, endpoint, lastSix }`. ✓
  - `getStatusAndKey` returns `{ hasKey, lastSix, endpoint, apiKey }` and is consumed by `getStatus` (drops `apiKey`) and `getAccount` (uses all four). ✓
  - `VeniceAccountRateLimitedError(retryAfterSeconds, upstreamStatus)` two-arg constructor in Task B step 1 matches the route handler's destructure in Task C step 1. ✓
  - `VeniceAccountUnavailableError(upstreamStatus | null)` one-arg constructor matches both throw sites in Task B step 7 and the route mapping in Task C step 1. ✓
  - `veniceAccountQueryKey = ['venice-account']` in Task G matches the invalidation calls in Task I steps 4-5. ✓
  - `accountRateLimitWindowMs` option name in Task C step 1 matches the test's usage in Task E step 9. ✓
  - The `VerifyPillState` `kind` union widens to include `'pending'` in Task I step 6 — the JSX in step 6 handles all four cases. ✓

Spec coverage is complete; no requirement is unimplemented; no naming drift across tasks.
