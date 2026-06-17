# Plan: cookie-session-auth review follow-ups (this PR)

> **Status:** DRAFT — awaiting plan-review approval. Not yet linked to a bd issue.
> **Origin:** Human review walkthrough of the cookie-session-auth PR (`feature/cookie-session-auth`) +
> an independent Opus plan review (2026-06-17). Lands **in this PR**, on the same branch.
> **Scope (deliberately small + reviewable):** `src` hardening [findings c, g, f], a test-name/precision
> cleanup [finding b], and the documentation that still describes the retired JWT/refresh/Session-table
> model [doc audit, D1–D4].
> **Explicitly OUT of scope / split out:** the 34-file test-helper *consolidation* (finding a / Option 2) —
> it is maintainability-only (Option 1, commit `32f97a3`, already fixed the correctness wart), it is the bulk
> of the risk/churn, and bundling it would make this PR unwieldy. Tracked separately in
> `docs/superpowers/plans/2026-06-17-consolidate-test-cookie-auth-helpers.md` as its own bd issue + PR.

Each task is independently reviewable. Ground every doc rewrite in the actual implemented code
(`auth.middleware.ts`, `auth.service.ts`, `session-store.ts`, `index.ts`, `origin-check.middleware.ts`,
`session-cookie.ts`) + the design spec `docs/superpowers/specs/2026-06-16-cookie-session-auth-design.md` —
not from memory.

## Src-hardening tasks (findings c, f, g)

S1. **(c) — `openSession` self-enforces the 30-day absolute cap.** The cap is a security control (bounds a
    stolen-cookie's lifetime). Today it holds only because every caller passes `createdAt=now` +
    `expiresAt=now+IDLE_TTL`; `openSession` stores `expiresAt` verbatim, `getSession` only checks `<= now`, and
    the clamp lives solely in `extendSessionExpiry`. Make the store self-enforcing at its write boundary.
    - **Change** (`backend/src/services/session-store.ts`, `openSession`'s `sessions.set`):
      `expiresAt: Math.min(expiresAt.getTime(), createdAt.getTime() + ABSOLUTE_TTL_MS)`.
    - **TDD**: first add a FAILING test in `tests/services/session-store.test.ts` — `openSession` with
      `createdAt` 31 days ago + `expiresAt = now + 1000`, then `getSession` returns `null` **without** any
      `extendSessionExpiry` call (proves the cap holds at open time, not just on slide). Then implement.

S2. **(f) — replace dead login-result assertions.** In `tests/auth/auth.service.test.ts` (login test, ~l.136–137)
    `expect(result).not.toHaveProperty('accessToken'|'refreshToken')` can never fail (`LoginResult` is typed
    `{ user, sessionId }`). Replace BOTH with `expect(Object.keys(result).sort()).toEqual(['sessionId', 'user'])`
    (matches the `Object.keys(...).sort()` idiom already at l.51) — a live guard against an accidentally
    reintroduced top-level token field.

S3. **(g) — narrow the `no-store` exemption to the SSE route.** The no-store middleware exists to stop a
    misconfigured cache from storing a response carrying a `Set-Cookie`; `requireAuth`'s throttled slide re-set can
    attach one to any authed request, including `GET /api/ai/models`. The exemption `req.path.startsWith('/ai/')`
    leaves `/ai/models` + `/ai/default-prompts` uncovered. Exactly one route streams (`POST /ai/complete`, which
    sets its own `Cache-Control` at `ai.routes.ts:229`).
    - **Change** (`backend/src/index.ts`): `if (req.path === '/ai/complete') return next();` + update the comment.
    - **Test** (`tests/ai/models.test.ts`, already has auth + Venice mocks): assert an authed `GET /api/ai/models`
      response carries `Cache-Control: no-store`.

> S1 + S3 touch `session-store.ts` / `index.ts` → the `/bd-close-reviewed` **security-reviewer** re-fires on them. Good.

## Test-name cleanup (finding b)

B1. Rename the 20 `it('… returns 401 without Bearer', …)` + 1 "without a bearer token" names across 7 files
    (`characters` ×5, `chapters` ×5, `outline` ×6, `user-settings` ×2, `chapters-reorder` ×1,
    `chat-messages-list` ×1, `change-password` ×1) → "when unauthenticated". Bodies are already correct (bare
    `request(app)`, no cookie → 401) — names only. **Precision (lean yes):** these assert only `status === 401`;
    add `expect(res.body.error.code).toBe('unauthorized')` to pin the no-cookie path to the right code (vs
    `session_expired`). Pure test edits — independent of the consolidation.

## Documentation tasks (doc audit, D1–D4)

D1. **`.claude/agents/security-reviewer.md`** — `model: opus`. **Audit the WHOLE file** for any
    JWT / Bearer / refresh / `RefreshToken` / `Session` / `JWT_SECRET` / `REFRESH_TOKEN_SECRET` / `/auth/refresh`
    reference and rewrite ALL of them to the cookie-session model — these are KNOWN instances, not exhaustive:
    front-matter `description` (l.3), stack/intro (l.12), threat-model bullet (l.15), schema scope (l.33),
    §C "JWT issuance and validation" (l.56–68), public-routes list still naming `refresh` (l.71), the
    `jsonwebtoken` dep-pin check (l.103), §L "Cookie and session details" (l.105–106). Replacement covers: cookie
    read via `sessionCookieName()`; the two distinct 401 codes (`unauthorized` vs `session_expired`); in-memory
    session store as sole authority (no DB rows, no token signing, no signing secrets); 7-day-sliding /
    30-day-absolute cap + clamp; default-deny global Origin/Referer CSRF + the CSRF invariant; `__Host-`/`Secure`
    cookie attrs in prod; the `/login` limiter; re-mint-on-password-change. KEEP the argon2id / Venice-key /
    DEK-egress sections. This checklist drives the close-gate security review — accuracy is load-bearing.

D2. **`docs/encryption.md`** — `model: opus`. Full pass on the session-transport + threat-model sections ONLY;
    LEAVE the DEK-envelope content (wraps, argon2id, recovery code, content-crypto) intact. Rewrite: "Session
    lifecycle" / "Option B" (now opaque cookie + in-memory store, NO `Session` table — sessions never persisted);
    JWT-verify/`HS256`-pin → cookie lookup; the refresh-rotation section (removed); logout (no DB delete; drop the
    in-memory entry + clear the cookie); the JWT-payload description (gone — the cookie value IS the opaque
    sessionId); change-password/reset "delete refresh tokens and sessions" → "evict in-memory sessions
    (`closeSessionsForUser`)"; and the threat-model rows citing `JWT_SECRET`/forging-JWTs/capturing-a-JWT (→
    stealing the session cookie; httpOnly + Secure + the cap are the mitigations).

D3. **`docs/data-model.md`** — Sonnet. Remove BOTH the `Session` and `RefreshToken` models: ERD (l.14), table
    defs (l.117…), relations table (l.135), indexes table (l.157), timestamps note (l.164). **Note:** lines like
    l.126 ("the row exists so a restart can detect session expired") and l.163 (`Session.id` minted at login) are
    now **actively false**, not merely stale — ensure those go too. Add a one-line "sessions are in-memory only
    (see encryption.md)" note if there's a natural place. Touch no narrative/User content.

D4. **Trivial reference fixes** — Sonnet (one small commit):
    - `CLAUDE.md:161` — drop "`Session` and `RefreshToken` are `createdAt`-only by design." (tables gone).
    - `docs/agent-rules/backend.md:115` + `docs/agent-rules/repo-boundary.md:27` — "Non-narrative entities
      (`User`, `RefreshToken`)" → just `User`.
    - `docs/agent-rules/index.md:72` — drop `RefreshToken` from the non-narrative-migration examples.
    - `docs/multi-agent-workflow-plan.md:112` — "JWT in memory" → "session cookie (httpOnly)".

Doc-only changes don't trip the path-matched close-gate surface reviewers (except D1, which IS the security
reviewer's own definition); accuracy is gated by the implementer-loop spec/quality reviewers + a controller
read-through against the live code.

## Verify

`make dev` up, then `make verify` (lint + typecheck + design-lint + builds + shared/backend/frontend suites).
Backend suite total rises (S1 + S3 add tests) — expect **≥ current count**, all green; typecheck clean. Then
`/bd-close-reviewed` re-runs the **security-reviewer** (in-lane for the `session-store.ts` + `index.ts` changes).

## Considered, NOT folded in (review ledger)

- **(d) `Number(SESSION_STORE_MAX) || 10_000` swallows `=0`** — DECLINED. A 0/negative session cap is operator
  nonsense that fails immediately (nobody stays logged in — `evictOldest` fires every open); the default fallback is
  more correct than honoring a self-DoS value. Distinct from `TRUST_PROXY_HOPS=0` (a *meaningful* config, fixed).
- **(e) `logout`/`logoutAllSessionsForUser`/`signOutEverywhere` are `async` with no `await`** — DECLINED. Pure
  style; no functional difference (callers all `await`). Keeping them async preserves a uniform Promise-returning
  service interface; Biome doesn't enable `require-await`.
- **(h) boot-log the effective `trust proxy` value** — DECLINED. Pure observability, not validation — can't detect
  a wrong value (any positive int is plausible per topology). Documented in `.env.example` + `SELF_HOSTING.md`.
  Closes no gap.
- **(a) test-helper consolidation** — SPLIT OUT to its own plan/PR (see header). Not declined — deferred to keep
  this PR reviewable.
