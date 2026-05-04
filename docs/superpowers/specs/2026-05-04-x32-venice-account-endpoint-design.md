# [X32] Unified Venice account-info endpoint — Design

**Goal:** Replace `GET /api/ai/balance` and `POST /api/users/me/venice-key/verify` with one `GET /api/users/me/venice-account` that returns balance, key metadata, and a verified flag in a single shot. Fix the `/v1/models`-doesn't-set-balance-headers bug for the BalanceDisplay header pill in the same change. Subsumes [X31] (`/balance` rename of `credits → balanceUsd`) — X31 ticks closed when X32 ships.

## Why

Two endpoints currently solve the same problem (probe Venice, get balance) and one of them is broken in production:

1. `GET /api/ai/balance` (V10) — used by the BalanceDisplay header pill in UserMenu. Calls `/v1/models` via the `openai` SDK, reads `x-venice-balance-usd` / `x-venice-balance-diem` from the response headers. Verified empirically against a live Venice key (paid tier): `/v1/models` returns no `x-venice-balance-*` headers at all — only CDN/security headers. So the pill always shows the loading-or-empty state and never a real number.
2. `POST /api/users/me/venice-key/verify` (V18) — used by Settings → Venice "Verify" button. Same bug originally; PR #59 fixed it by switching to `GET /api_keys/rate_limits` and parsing `data.balances.{USD,DIEM}` from the body. Returns the same balance information plus `verified` / `endpoint` / `lastSix`.

Maintaining two routes that probe Venice for the same data, with two test surfaces, two error-mapping paths, and two rate-limit configurations, is cost without payoff. The "verify" semantic ("did the key prove out?") is fully implied by "we got a 2xx from an authenticated probe with a valid balances payload" — there is no behaviour worth preserving as a separate route.

X32 collapses them into one and makes the BalanceDisplay pill correct as a side-effect.

## Non-goals

- **Backward-compat aliases.** Per CLAUDE.md "no data-migration branches" rule (pre-deployment, no live clients exist), `/verify` and `/balance` are deleted outright in the same PR. No deprecation warning, no shim.
- **Telemetry / Sentry sink.** `console.error` plus `upstreamStatus` in the error body is sufficient. Structured event sink is out of scope; track separately if needed.
- **Schema migration.** No DB columns added or removed. The four BYOK Venice columns on `User` are unchanged.
- **Changes to `PUT /api/users/me/venice-key` or `validateAgainstVenice`.** Those still hit `/v1/models` (which is the right call for "does this key authenticate at all"); X32 only consolidates the *balance* surface.

## Pre-deployment-rule check

CLAUDE.md "Don't write data-migration branches": confirmed. Pre-deployment, the rename of `credits → balanceUsd` (the X31 piece) is just a field rename, not a migration. The `/verify` and `/balance` route deletes are total deletions of unused-in-production endpoints, not soft retirements.

## Branch coordination with PR #59 (X26)

PR #59 is open and contains: `lastFour → lastSix` rename, `credits → balanceUsd` rename in the `/verify` response, and the `/v1/models`-headers → `/api_keys/rate_limits`-body fix in the verify path. X32 cuts off `main` *before* X26 lands.

**Two scenarios:**

- **X26 lands first** (likely, since #59 already passes CI). X32 rebases onto post-X26 `main`. The `/verify` deletion in X32 removes a route that already speaks the right body shape; the `/balance` rename + body-source fix are X32's own work. Smaller diff.
- **X26 doesn't land first.** X32 absorbs the X26 changes (`lastFour → lastSix`, `credits → balanceUsd`, body-source fix) into its own scope. PR #59 closes as superseded. Bigger diff but still landable.

The spec is written assuming X26 lands first. If it doesn't, the implementation plan adds an "absorb X26" task at the front; nothing else changes.

## Architecture

### Backend

**New route:** `GET /api/users/me/venice-account`, mounted on `createVeniceKeyRouter` under the existing `/api/users/me/venice-key` path? — No. Mount it as a sibling: `/api/users/me/venice-account`. Reasoning: the URL space carries semantics; the new endpoint is *about the account* (balance + verification status), the existing `/venice-key` router is *about the key* (CRUD + storage). Co-location at the same `/users/me/venice-key/*` prefix would be misleading (verify isn't really a key operation, it's a probe of the upstream). A new sibling router file is clearer.

```
backend/src/routes/venice-account.routes.ts   (new)
  GET /                                        → returns VeniceAccountResult
  (mounted at /api/users/me/venice-account)
```

The existing `backend/src/routes/venice-key.routes.ts` shrinks: the `POST /verify` route + the `createVerifyRateLimiter` helper + the `verifyRateLimitWindowMs` option are deleted.

**New service method:** `veniceKeyService.getAccount(userId)`. Replaces `verify()`. Returns:

```ts
interface VeniceAccountResult {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
}
```

(Identical shape to the post-X26 `VeniceKeyVerifyResult`. Type renamed for clarity but unchanged in fields.)

Implementation:
1. Call `getStatusAndKey(userId)` (new internal helper — see below). If `hasKey === false`, return `{ verified: false, balanceUsd: null, diem: null, endpoint: null, lastSix: null }` without making any HTTP call.
2. `fetch('GET ${endpoint}/api_keys/rate_limits', { Authorization: 'Bearer ${apiKey}' })` via `globalThis.fetch` (re-resolved per call so tests can `vi.stubGlobal`).
3. Status mapping:
   - `200` → parse body via existing `readBalances()` helper → return `{ verified: true, balanceUsd, diem, endpoint, lastSix }`
   - `401 / 403` → return `{ verified: false, balanceUsd: null, diem: null, endpoint, lastSix }` (no throw; the key is stored but Venice rejected it — UI shows "Not verified")
   - `429` → `throw new VeniceAccountRateLimitedError(retryAfterSeconds, upstreamStatus: 429)`
   - any other non-2xx, fetch reject, malformed JSON → `throw new VeniceAccountUnavailableError(upstreamStatus: number | null)` (null on fetch reject / JSON parse failure)
4. Before each non-success throw: `console.error('[X32] Venice rate_limits probe returned', response.status, 'for user', userId)`.

**Internal helper:** `getStatusAndKey(userId)` — new, private to the service module.

```ts
interface StatusAndKey {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
  apiKey: string | null;  // plaintext, request-scoped only
}

async function getStatusAndKey(userId: string): Promise<StatusAndKey>;
```

One DB read, one `decrypt()` call, returns both the public status fields and the plaintext key. The public `getStatus()` becomes a one-line wrapper that calls `getStatusAndKey()` and discards `apiKey`. `getAccount()` calls `getStatusAndKey()` directly. Net effect: one DB+decrypt per `/venice-account` request instead of two.

The `apiKey` field is used inline (handed to the `Authorization` header) and never logged, never put on an error object, never returned from a public function. Same hygiene as the existing `verify()` decrypt.

**Errors:**

```ts
export class VeniceAccountRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds: number | null,
    public readonly upstreamStatus: number,  // always 429
  ) { ... }
}

export class VeniceAccountUnavailableError extends Error {
  constructor(public readonly upstreamStatus: number | null) { ... }
}
```

The route handler:
- `VeniceAccountRateLimitedError` → `res.status(429).json({ error: { code: 'venice_rate_limited', message: '...', retryAfterSeconds: err.retryAfterSeconds, upstreamStatus: err.upstreamStatus } })`
- `VeniceAccountUnavailableError` → `res.status(502).json({ error: { code: 'venice_unavailable', message: '...', upstreamStatus: err.upstreamStatus } })`

Successful 401/403 returns from the service do not throw, so the route just passes them through as 200.

**Rate limit:** 30 requests/minute/user, keyed by `req.user.id`. Same `express-rate-limit` pattern as the deleted `createVerifyRateLimiter`, with a window injection seam (`accountRateLimitWindowMs?: number` on `createVeniceAccountRouter`'s options) so tests can compress it. Limiter handler returns:

```json
{ "error": { "code": "account_rate_limited", "message": "Too many account-info requests. Try again in a moment." } }
```

This is the *router's own* limit (us protecting Venice from chatty clients), distinct from the `venice_rate_limited` code we emit when *Venice* returns 429. Distinct codes so the frontend can tell "your client is hammering us" from "Venice is slowing us down".

The limit is solely for `/api/users/me/venice-account` — its bucket is not shared with `/api/ai/complete`, `/api/ai/models`, `/api/users/me/venice-key/*`, or any auth route. Each `express-rate-limit` instance carries its own in-memory store keyed by `req.user.id`.

**Deletes (in this PR):**
- `POST /api/users/me/venice-key/verify` route in `venice-key.routes.ts` (V18)
- `createVerifyRateLimiter` helper + `verifyRateLimitWindowMs` option
- `veniceKeyService.verify()` method
- `VeniceKeyVerifyResult` interface (replaced by `VeniceAccountResult`)
- `VeniceVerifyRateLimitedError` / `VeniceVerifyUnavailableError` (renamed to `VeniceAccount*Error`; these exist post-X26 but won't exist pre-X26 — the absorb-X26 fallback handles either case)
- `GET /api/ai/balance` route in `ai.routes.ts` (V10)
- Local `parseRetryAfterSeconds` in `venice-key.service.ts` (post-X26 only) — replaced by `import { parseRetryAfter } from '../lib/venice-errors'`. The lib version accepts native `Headers` and additionally parses `x-ratelimit-reset-*` fallback that Venice sometimes returns instead of `retry-after`.
- `tests/routes/venice-key-verify.test.ts` (transplanted to `tests/routes/venice-account.test.ts`)
- Any standalone `tests/routes/ai-balance.test.ts` (if present)

### Frontend

**Hook rename + repointing:** `frontend/src/hooks/useBalance.ts` → `useVeniceAccount.ts`.

```ts
// useVeniceAccount.ts
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
    queryFn: () => api<VeniceAccount>('/users/me/venice-account'),
    staleTime: 2 * 60 * 1000,         // unchanged from useBalanceQuery
    refetchOnWindowFocus: false,
    enabled,
  });
}
```

`Balance` type and `balanceQueryKey` deleted. All callers re-imported.

**`useVeniceKey.ts` shrinks:** the `verifyMutation` and the `VeniceKeyVerify` type are deleted. The "Verify" button in Settings becomes a query invalidation, not a mutation:

```ts
// in Settings.tsx
const accountQuery = useVeniceAccountQuery();
const queryClient = useQueryClient();

const handleVerify = (): void => {
  void queryClient.invalidateQueries({ queryKey: veniceAccountQueryKey });
};
```

The Save flow also changes: after `storeMutation.mutateAsync(...)`, instead of chaining `verifyMutation.mutateAsync()`, we `queryClient.invalidateQueries(veniceAccountQueryKey)`. The next render sees `accountQuery.isFetching === true`, then either `data.verified === true` (pill shows "Verified · $X.XX") or `verified === false` (pill shows "Not verified · last six XXXXXX") or `error != null` (pill shows error state + record to error store).

**`BalanceDisplay.tsx`:** field rename `credits → balanceUsd`, type rename `Balance → VeniceAccount`. The component already only reads the USD field; no behavioural change beyond using the renamed property.

**`Settings.tsx` verify pill** derives entirely from `accountQuery`:

| Query state | Pill text | Pill kind |
|-------------|-----------|-----------|
| `isFetching` | "Verifying…" | neutral |
| `error` (any non-null Error) | "Not verified · last six XXXXXX" | err — and push to `useErrorStore` with `detail: { upstreamStatus }` |
| `data?.verified === true` | `"Verified · ${formatUsd(data.balanceUsd)}"` (or `"Verified · USD —"` if `balanceUsd == null`) | ok |
| `data?.verified === false` | `"Not verified · last six XXXXXX"` | err |
| `!data && !isFetching && !error` | (idle, pill hidden) | idle |

**Error surface:** When the query errors (e.g. backend returned 502 `venice_unavailable`), the Settings tab pushes to `useErrorStore`:

```ts
useErrorStore.getState().push({
  severity: 'error',
  source: 'venice-account',
  code: errorBody?.error?.code ?? null,         // 'venice_unavailable' | 'venice_rate_limited' | 'account_rate_limited'
  message: errorBody?.error?.message ?? 'Venice account info failed',
  httpStatus: response.status,                  // 502 / 429
  detail: { upstreamStatus: errorBody?.error?.upstreamStatus ?? null },
});
```

The `lib/api.ts` fetch wrapper already throws an `Error` carrying the response body on non-2xx; the Settings pill's error effect reads `err.body?.error` to extract `code` / `upstreamStatus`. (If `lib/api.ts` doesn't currently expose the parsed body on the thrown error, the implementation plan adds a small touch-up to do so — it's a one-line change and the diagnostics surface depends on it.)

### Data flow

```
Settings "Verify" click ────────┐
BalanceDisplay mount     ───────┤
EditorPage load          ───────┘
        ↓
useVeniceAccountQuery (TanStack Query, key ['venice-account'], 2-min staleTime)
        ↓  (cache miss / explicit invalidate)
GET /api/users/me/venice-account
        ↓
[express-rate-limit  30/min/user]  ── exhausted? → 429 { code: 'account_rate_limited' }
        ↓
veniceKeyService.getAccount(userId)
        ↓
getStatusAndKey(userId)            ── single SELECT + single decrypt
        │
        ├─ no key                  ── return { verified: false, balanceUsd: null, ... }
        │
        └─ has key
              ↓
        fetch GET ${endpoint}/api_keys/rate_limits  (Bearer apiKey)
              ↓
   ┌──────────┴────────────┬─────────────────────┬──────────────────────────┐
   ▼                       ▼                     ▼                          ▼
  200                    401 / 403              429                  fetch reject / 5xx / bad JSON
   │                       │                     │                          │
   readBalances(body)      return verified:false  console.error [X32]       console.error [X32]
   return verified:true                          throw RateLimitedError    throw UnavailableError
                                                 (retryAfter, status:429)  (upstreamStatus | null)
                                                          │                          │
                                                          ▼                          ▼
                                              429 { code: 'venice_rate_limited',   502 { code: 'venice_unavailable',
                                                    retryAfterSeconds, upstreamStatus }   upstreamStatus }
                                                          │                          │
                                                          └────────────┬─────────────┘
                                                                       ▼
                                                          frontend: useErrorStore.push({ httpStatus, detail: { upstreamStatus }, ... })
                                                                       ▼
                                                          DevErrorOverlay "Show raw" displays upstreamStatus for triage
```

### Logging contract

Server-side (always-on, dev + prod):

- `console.error('[X32] Venice rate_limits probe returned', status, 'for user', userId)` before each non-2xx throw in `getAccount`
- `console.error('[X32] Venice rate_limits probe failed (transport)', 'for user', userId)` on `fetch` reject / JSON parse failure (no upstream status to log)

Plaintext API key MUST NOT appear in any of these. `userId` is a CUID; safe to log. `endpoint` is user-supplied — also safe to log (we already log it elsewhere in the venice-key service path).

Frontend (post-PR-#54 diagnostics):

- `useErrorStore.push({ source: 'venice-account', code, message, httpStatus, detail: { upstreamStatus } })` when the query errors. The `DevErrorOverlay` "Show raw" view already renders `detail` JSON-stringified, so `upstreamStatus` shows up automatically.
- The `InlineErrorBanner` surface (PR #54) is not used here — that component is for inline-AI / chat-send failures, not for Settings UI. The Settings pill renders its own error state directly.

## Test surface

### Backend — new file `tests/routes/venice-account.test.ts`

Transplanted from `tests/routes/venice-key-verify.test.ts` (post-X26). Same pattern: minimal Express app + supertest + `vi.stubGlobal('fetch', ...)`. The `rateLimitsResponse({ usd, diem })` helper carries over verbatim.

| # | Test | Asserts |
|---|------|---------|
| 1 | 401 without Bearer | route 401 |
| 2 | No key stored | 200, `verified: false`, `balanceUsd: null`, no fetch made |
| 3 | Both balances present | 200, full result, exact endpoint + lastSix echoed |
| 4 | `data.balances.USD` missing | 200, `verified:true`, `balanceUsd: null`, `diem` populated |
| 5 | `data.balances.DIEM` missing | 200, `verified:true`, `balanceUsd` populated, `diem: null` |
| 6 | Empty `data.balances` | 200, `verified:true`, both null |
| 7 | Venice 401 → app 200 verified:false | 200, key metadata echoed, no plaintext key in log |
| 8 | Venice 429 → app 429 venice_rate_limited | 429 body has `code`, `retryAfterSeconds`, `upstreamStatus: 429`; `console.error('[X32]'...)` fired |
| 9 | Venice 503 → app 502 venice_unavailable | 502 body has `code`, `upstreamStatus: 503`; `console.error` fired |
| 10 | Fetch reject (network) | 502 body has `code`, `upstreamStatus: null`; `console.error('[X32]'...)` for transport failure |
| 11 | Plaintext key never in body / headers / logs | sentinel string absent from response and all 4 console channels |
| 12 | URL pin: hits `/api_keys/rate_limits` | `fetchSpy` called with URL containing that path (locks endpoint choice against future regression) |
| 13 | Single decrypt per request | `decrypt` spy called exactly once (proves `getStatusAndKey` is the only decrypt site) |
| 14 | Per-user 30/min rate limit | 30 successes, 31st returns 429 `account_rate_limited` (distinct from `venice_rate_limited`); user B unaffected in same window |

The 30/min test uses `accountRateLimitWindowMs: 200` to avoid long-running tests, same trick as the deleted verify-rate-limit test.

### Backend — file deletions
- `tests/routes/venice-key-verify.test.ts` deleted entirely
- Any tests in `tests/routes/venice-key.test.ts` referencing `verify` deleted (the file's other tests for GET/PUT/DELETE on `/venice-key` stay)
- Any standalone test for `GET /api/ai/balance` deleted

### Backend — encryption leak test
`tests/security/encryption-leak.test.ts` is unchanged — it asserts narrative-content sentinels never appear in raw rows; the Venice-key surface is out of its scope.

### Frontend — new + renamed

- `tests/hooks/useBalance.test.tsx` (if present) → `tests/hooks/useVeniceAccount.test.tsx`. Asserts: query hits `/api/users/me/venice-account`, returns the `VeniceAccount` shape, respects `staleTime`.
- `tests/components/BalanceDisplay.test.tsx` — field rename `credits → balanceUsd`. Behaviour unchanged.
- `tests/components/Settings.shell-venice.test.tsx` — major rewrites:
  - "Save then verify" test: assert that after Save resolves, `useVeniceAccountQuery` is invalidated (not that a separate POST is made)
  - "Verify button click" test: assert query invalidation, not a POST request
  - "Pill state derivation" tests: cover all five rows of the state-to-pill table above
- `tests/components/Settings.models.test.tsx` and other Settings tests — no changes (different surfaces).

### Frontend — file deletions
- `frontend/src/hooks/useBalance.ts` (renamed/replaced — git tracks this as rename)
- `verifyMutation` block in `frontend/src/hooks/useVeniceKey.ts`
- `VeniceKeyVerify` type export

## Docs updates

- `docs/api-contract.md`:
  - **Delete** the `POST /api/users/me/venice-key/verify` section (lines 71-72 area)
  - **Delete** the `GET /api/ai/balance` section (in the AI endpoints area)
  - **Add** a `GET /api/users/me/venice-account` section with the response shape, the rate limit (30/min/user), and the error codes (`venice_rate_limited`, `venice_unavailable`, `account_rate_limited`) including the new `upstreamStatus` field
  - Update the "Secrets" bullet to mention the new endpoint as the only balance read surface
- `docs/venice-integration.md`:
  - Line 171 (`/balance` description) — replace with `/api/users/me/venice-account` explanation, body-source (not headers)
  - Line 291 (rate-limit forwarding section) — replace `x-venice-balance-usd + x-venice-balance-diem for /balance` with `data.balances.{USD,DIEM} from /api_keys/rate_limits, exposed via /api/users/me/venice-account`
- `TASKS.md`:
  - Tick `[X31]` (subsumed by X32 — note the supersession in the close line)
  - Add `[X32]` entry with plan link (when the plan is written) and verify command

## Open questions / risks

- **Risk:** the `lib/api.ts` fetch wrapper. The frontend error-surface plumbing depends on the wrapper exposing the parsed JSON body on the thrown `Error` (so the pill effect can read `err.body.error.upstreamStatus`). If the wrapper currently throws a bare `Error(message)`, the implementation plan needs a small task to attach `body` to the error. Will confirm against the current `lib/api.ts` during planning; if it's already there, that task drops out.
- **Risk:** TanStack Query's invalidation semantics. `invalidateQueries({ queryKey: veniceAccountQueryKey })` marks stale + triggers a refetch only if the query is currently mounted (or `refetchType: 'all'` is passed). Since BalanceDisplay is mounted on EditorPage, and Settings only opens *over* EditorPage, the query is always mounted at the time Settings clicks Verify — invalidation always triggers a refetch. The Save → invalidate path works for the same reason. No need for `refetchType: 'all'`.
- **Risk:** the OpenAI SDK is no longer touched on the verify path post-X26. X32 doesn't change that. `getVeniceClient(userId)` (used by `/api/ai/complete`, `/api/ai/models`, etc.) still exists and works as before.

## Out of scope (deliberate)

- Telemetry beyond `console.error`. If we want a real metric for "how often does Venice return 5xx on rate_limits probes", that's a separate task with its own design.
- Server-side caching of the account info. TanStack Query's 2-min `staleTime` on the client side is the only cache. Adding a server-side cache (Redis, in-memory) would couple multiple users' request flows and complicate invalidation; not justified at current scale.
- Changing the `validateAgainstVenice` probe (PUT /venice-key) to use `/api_keys/rate_limits`. That endpoint's purpose is "does this key authenticate at all?" and `/v1/models` is the right call for that — it requires the same credential and returns 401 for bad keys. No reason to switch it.
