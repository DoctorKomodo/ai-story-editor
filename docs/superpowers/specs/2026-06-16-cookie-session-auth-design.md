# Design: Opaque httpOnly session-cookie auth (retire `JWT_SECRET` + `REFRESH_TOKEN_SECRET`)

- **Date:** 2026-06-16
- **Status:** Design approved (brainstorming) + hardened per two independent Opus
  security reviews (2026-06-16); pending final spec review → writing-plans
- **Surface:** auth / session / middleware (security-reviewer in-lane)

## Problem & motivation

The app runs **stateful, single-process, look-up-every-request** auth: every
authenticated request fetches the per-user content DEK from the in-memory
session store (`session-store.ts`), and the refresh path validates a DB row.
On top of that lookup the app also runs two JWT signing secrets:

- **`JWT_SECRET`** signs a 15-minute access JWT carrying `sessionId`. The
  middleware verifies the signature **and then** calls `getSession(sessionId)` —
  a hard 401 on a miss. The signature proves something the lookup already
  proves.
- **`REFRESH_TOKEN_SECRET`** signs a 7-day refresh JWT that is **also** stored
  verbatim in the `RefreshToken` table and validated by `findUnique({ token })`.
  Rotation is the DB row, not the signature. The raw JWT sits in the table, so a
  DB dump exposes replayable refresh tokens (bounded by process uptime, because
  the refresh path also requires the live in-memory session).

Both secrets are belt-and-suspenders over lookups the app performs anyway. The
classic JWT benefits do not apply: statelessness is already forfeited (DEK
lookup per request), multi-replica is already impossible (DEK lives in one
process's memory), and there is no second service to verify claims for. A
backend restart **already** forces every user to re-enter their password,
because the DEK-bearing session is in-memory only — so the 7-day refresh token
only ever provides seamless renewal *within a single process lifetime*.

This design removes both secrets by making the existing `sessionId` the **sole
credential**, carried in an opaque httpOnly cookie. The app already *is*
session-based underneath the JWT costume; this drops the costume. The pattern —
an opaque, high-entropy, server-side session ID in an httpOnly cookie — is the
OWASP-recommended session pattern (Session Management Cheat Sheet).

## Goals

1. **Zero auth secrets.** Remove `JWT_SECRET` and `REFRESH_TOKEN_SECRET`
   entirely. No signing anywhere — not even an ephemeral in-memory secret —
   because there are no tokens to sign.
2. **Remove the redundant refresh flow.** The access/refresh two-token dance and
   the `POST /api/auth/refresh` endpoint go away.
3. **Improve at-rest posture.** No session secret is persisted, and the session
   handle is httpOnly (not reachable by XSS) instead of a JS-held `Bearer`
   token. The DB-dump refresh-token exposure disappears structurally — sessions
   are never persisted.
4. **Preserve current UX and the restart-forces-relogin property.** No
   behavioural change a user notices, except the (already-expected) one-time
   logout on the deploy that ships this.

## Non-goals

- Multi-replica / shared session store (Redis). Single-process is a standing
  constraint (the DEK lives in one process's memory). The day horizontal scale
  is needed, a shared session store is required regardless of this change.
- An active-sessions-list / per-device-revoke UI (we are dropping the `Session`
  table; nothing reads it today).
- A double-submit / synchronizer CSRF token (we use `SameSite=Lax` +
  **default-deny** Origin check; see Decisions and Security considerations).
- Any change to the DEK envelope, content crypto, or narrative repo layer —
  untouched.
- A plain-HTTP production mode. Production requires TLS at the edge (see
  Deployment).
- Persistent (cross-restart) session revocation or audit. All session authority
  is process-memory and is wiped on restart, by design (see Security
  considerations).
- A first-class non-browser API client / API-token path. Default-deny CSRF
  means programmatic POST clients must send an `Origin` header (see Deployment);
  a dedicated machine-auth path is a possible future, not this change.

## Decisions (resolved during brainstorming + security review)

1. **Session lifetime — 7-day sliding idle timeout with a 30-day absolute cap.**
   The in-memory session expires 7 days after the *last authenticated request*;
   each request bumps the idle expiry, **clamped** so a session never lives past
   30 days from login regardless of activity (OWASP requires both an idle *and*
   an absolute timeout). After the absolute cap, even an active user re-enters
   their password (re-deriving the DEK). Still additionally capped by process
   uptime (restart = re-login).
2. **CSRF — `SameSite=Lax` + the existing Origin-check middleware, made
   default-deny and applied globally.** `requireAllowedOrigin` is mounted across
   all mutating routes, and its current **fail-open** branch (allow when *both*
   `Origin` and `Referer` are absent) is changed to **block** for state-changing
   methods (OWASP CSRF Cheat Sheet: "If neither of these headers are present…
   We recommend blocking"). A browser always sends `Origin` on
   POST/PUT/PATCH/DELETE, so default-deny does not break the same-origin SPA.
   Rejected the double-submit token as redundant under `SameSite=Lax` + a
   default-deny Origin check + JSON-only bodies + no state-changing GETs — see
   the **CSRF invariant** in Security considerations.
3. **Drop both `RefreshToken` and `Session` tables.** The in-memory session
   store becomes the sole authority. `RefreshToken` is obsolete; `Session` is
   already written-but-never-read (only `create`/`update`/`delete`, never read
   for validation). "Sign out everywhere" already operates on the in-memory map.
4. **HTTPS hard-required in production, no escape hatch.** The session cookie is
   `Secure` in prod. No `COOKIE_SECURE`/insecure knob — a self-hoster on plain
   HTTP in prod gets a loud, obvious unauthenticated loop that pushes them to set
   up TLS, rather than a silent downgrade to a sniffable session cookie.
   Documented in `SELF_HOSTING.md`.
5. **Cookie hardening — environment-divergent (`__Host-` in prod).** Production
   uses `__Host-session` (`Path=/`, `Secure`, no `Domain`); development uses a
   plain `session` cookie (`Path=/`, no `Secure`). Rationale: the `__Host-`
   prefix defends against sibling-subdomain cookie injection — a threat that
   only exists with real domains, so dev gains nothing from it. We use a plain
   name in dev for robustness: while `__Host-`/`Secure` *do* work over
   `http://localhost` (a secure context — MDN: the HTTPS requirement is ignored
   on localhost), a dev who browses via a LAN IP or custom hostname is **not** in
   a secure context and `__Host-`/`Secure` would silently fail there. The plain
   dev cookie sidesteps that entirely. A `NODE_ENV=production` test asserts the
   `__Host-` shape so the hardened path stays covered.
6. **Re-mint the caller's session on password change (strict order).**
   `changePassword` evicts all *other* sessions but opens a fresh session for the
   caller and re-sets their cookie — the user who just changed their password
   stays logged in. **Order is load-bearing:** rewrap DEK + DB commit →
   `closeSessionsForUser(userId)` → **then** `openSession(freshSessionId)` →
   return the fresh id for the route to re-`Set-Cookie`. Opening before evicting
   would let `closeSessionsForUser` (which matches by `userId`) nuke the
   just-minted session and log the caller out. A test must assert the caller's
   new session is the only live one for that user.

## Architecture

The `sessionId` (already `crypto.randomBytes(32).toString('hex')`, 256 bits —
well above OWASP's 128-bit recommendation) is the credential. It is the key of
the in-memory session map (`{ userId, dek, createdAt, expiresAt,
lastAccessedAt }`) and the value of an opaque httpOnly cookie. There is no
signing, no DB persistence of sessions, and no separate access vs refresh token.

```
Browser ── Cookie: __Host-session=<sessionId> ──▶ requireAuth
                                                     │ getSession(sessionId)
                                                     ▼
                                     in-memory session store ──▶ { userId, dek }
                                     (sole source of truth; wiped on restart)
```

### Cookie definition (environment-divergent)

| Attribute | Production | Development |
|---|---|---|
| Name | `__Host-session` | `session` |
| `Secure` | yes | no |
| `Path` | `/` | `/` |
| `Domain` | (unset) | (unset) |
| `HttpOnly` | yes | yes |
| `SameSite` | `Lax` | `Lax` |
| `Max-Age` | session expiry (≤30d) | session expiry (≤30d) |

- **Value:** the raw `sessionId` (opaque, 256-bit). Not signed, not hashed —
  there is nothing at rest to hash; the in-memory map holds it as a key, exactly
  as any in-memory session store does.
- A single `sessionCookieOptions()` helper + a cookie-name resolver branch
  name + `secure` on `NODE_ENV`. **Read, set, clear, and re-set must all go
  through the resolver** so prod never sets `__Host-session` but clears
  `session`. `Path=/` (not `/api`) so the `__Host-` prefix is satisfiable; the
  cookie is httpOnly and small, so riding on static-asset requests is a
  non-issue. `cookie-parser` exposes `__Host-`-prefixed names verbatim as
  `req.cookies['__Host-session']` (the prefix is part of the name).

## Components & changes

### Backend

**`backend/src/services/session-store.ts`**
- `SessionEntry` gains `createdAt: number`. `openSession` records it.
- Add `IDLE_TTL` (7d) and `ABSOLUTE_TTL` (30d) constants. Make the store cap
  env-tunable (`SESSION_STORE_MAX`, default 10_000).
- `extendSessionExpiry(sessionId, desired)` **clamps**:
  `expiresAt = min(desired, createdAt + ABSOLUTE_TTL)`. Once the absolute cap is
  reached, the entry can no longer slide and lapses at the cap. `getSession`
  stays the read (its existing `expiresAt <= now` guard then expires it); the
  slide lives in `extendSessionExpiry` so the clamp can't be bypassed.
- Cap handling: when at the cap, `sweep()` expired entries first; only if still
  at the cap evict the oldest *live* entry and `console.warn` (so the operator
  sees session-store pressure rather than silent forced-logouts). The new
  `/login` rate limiter is the primary defense against eviction pressure.

**`backend/src/middleware/auth.middleware.ts` — `requireAuth`**
- Read the session cookie via the shared cookie-name resolver
  (`req.cookies['__Host-session']` in prod / `req.cookies.session` in dev)
  instead of the `Authorization: Bearer` header.
- `getSession(sessionId)`:
  - cookie absent → `401 { code: 'unauthorized' }`
  - cookie present but no live session → `401 { code: 'session_expired' }`
  - hit → attach `req.user = { id: userId, sessionId }`,
    `attachDekToRequest(req, dek)`.
- **Slide (server-side) every request:** call `extendSessionExpiry(sessionId,
  now + IDLE_TTL)` (clamped). Do not re-implement the slide inline — call the
  store function so the clamp is enforced.
- **Re-`Set-Cookie` only when throttled:** re-set the cookie (refreshing its
  `Max-Age` to the **clamped** expiry) only when the cookie's remaining lifetime
  has dropped below a threshold (~24h, comfortably < the 7d idle TTL so an active
  user never lapses). Avoids a `Set-Cookie` on every response. The cookie is set
  **before** `next()` (so it precedes any streamed response body — critical for
  SSE).
- Remove all `jsonwebtoken` use and the `JWT_SECRET` read/`server_error`
  branch. `AuthenticatedUser.email` is dropped (cosmetic; `/me` re-fetches from
  the DB — confirmed no route reads `req.user.email`; keep the `makeFakeReq` test
  helper in sync).

**`backend/src/middleware/origin-check.middleware.ts`**
- **Default-deny:** for state-changing methods, when *both* `Origin` and
  `Referer` are absent (or neither matches an allowed origin), respond
  `403 csrf_block`. (Remove the fail-open `next()` at the both-absent branch.)
- Update the file docstring — it currently claims "the only cookie-authed
  endpoints are refresh and logout… all other routes use Bearer," which becomes
  false; this middleware is now the primary CSRF defense.

**`backend/src/services/auth.service.ts`**
- `login()`: generate `sessionId`, unwrap the DEK, `openSession({ sessionId,
  userId, dek, createdAt: now, expiresAt: now + IDLE_TTL })`. Return `{ user }`.
  **No** `Session` / `RefreshToken` DB writes, no token signing.
- **Delete** `refresh()`, `signAccessToken()`, `signRefreshToken()`,
  `AccessTokenPayload`, `RefreshTokenPayload`, `InvalidRefreshTokenError`,
  `getRequiredEnv` (if unused after), and `ACCESS_TOKEN_TTL_SECONDS`.
  Replace the TTL constants with `IDLE_TTL`/`ABSOLUTE_TTL` (sourced from
  session-store).
- `logout(sessionId)`: `closeSession(sessionId)`.
- `changePassword`: rewrap DEK under the new password (unchanged) + DB commit,
  **then** `closeSessionsForUser(userId)` to evict all sessions, **then**
  `openSession` a fresh session for the caller, and return its new `sessionId`
  so the route re-sets the caller's cookie (Decision 6 — strict order). Drop
  `session.deleteMany` / `refreshToken.deleteMany`.
- `resetPassword` / `signOutEverywhere` / `logoutAllSessionsForUser` /
  `deleteAccount`: remove `session.deleteMany` / `refreshToken.deleteMany`; rely
  on `closeSessionsForUser` (in-memory). `deleteAccount`'s `user.delete` no
  longer needs Session/RefreshToken cascade.
- `LoginResult` collapses to `{ user }` (no tokens/expiries).

**`backend/src/routes/auth.routes.ts`**
- `/login`: on success `res.cookie(<session>, sessionId, sessionCookieOptions())`
  then `200 { user }`. Add a **per-IP rate limiter** on `/login` (none exists
  today — also blunts the session-store-eviction pressure vector).
- `/logout`: `closeSession`, `res.clearCookie(...)` via the same resolver/attrs,
  `204`.
- `/change-password`: after `changePassword` returns the new `sessionId`,
  re-`Set-Cookie` it (Decision 6) and return `204`.
- **Remove `POST /refresh`** entirely, along with its `InvalidRefreshTokenError`
  import and catch branch (the error class is deleted in `auth.service`).
- `/me`, `/register`, `/reset-password`, `/rotate-recovery-code`,
  `/sign-out-everywhere`, `/delete-account`, `/update-profile`: unchanged in
  contract; `/register` still does **not** set a cookie. Routes that currently
  `clearCookie` the refresh cookie now clear the `session` cookie.
- Define `sessionCookieOptions()` + cookie-name resolver (env-divergent, per the
  Cookie table). The old `REFRESH_COOKIE_NAME` / `refreshCookieOptions` are
  removed.

**`backend/src/index.ts`**
- Mount `cookieParser()` **globally** (before the routers), not only on
  `/api/auth`.
- Apply `requireAllowedOrigin(allowedOrigins)` **globally** to mutating requests
  — a single `app.use('/api', requireAllowedOrigin(...))` before the router
  mounts and (preferably) before the per-route rate limiters, so a forged
  cross-origin request is rejected **before** it consumes rate-limit budget. The
  middleware exempts GET/HEAD/OPTIONS.
- Set **`Cache-Control: no-store`** on authenticated `/api` responses (a small
  middleware) so a misconfigured proxy/CDN can't cache a response that carries a
  `Set-Cookie`. Must run before handlers and **not clobber** routes that set
  their own caching headers — the SSE `/complete` route already sets
  `Cache-Control: no-cache, no-transform`; exempt streaming or make the header
  overrideable. Do not apply to SPA static assets (they should cache).
- `app.set('trust proxy', <n>)` — a **specific** hop count (default `1`; never
  `true`/trust-all, which would let clients spoof `X-Forwarded-For` and defeat
  the rate limiters). **Note this changes existing behavior:** there is no
  `trust proxy` set today, so the current per-IP limiters bucket by the *proxy's*
  IP behind a reverse proxy (a latent per-proxy-bucketing bug); `trust proxy: 1`
  makes them true per-client. Configurable + documented in `SELF_HOSTING.md`.

**`backend/src/boot/env-validation.ts`**
- Add warn-on-stale entries for `JWT_SECRET` and `REFRESH_TOKEN_SECRET`
  (same pattern as `APP_ENCRYPTION_KEY`): "set but no longer used, remove from
  `.env`".

**`backend/package.json`**
- Remove `jsonwebtoken` (and `@types/jsonwebtoken`) — used only by the two auth
  files being de-JWT'd.

**`backend/prisma/schema.prisma` + migration**
- Drop the `Session` and `RefreshToken` models and their `User` relations.
- Migration `DROP TABLE "RefreshToken"; DROP TABLE "Session";`. Existing rows
  discarded (one-time logout; see Rollout). No narrative columns touched.

### Frontend

**`frontend/src/lib/api.ts` (net simplification)**
- Delete the `accessToken` module var, `setAccessToken` / `getAccessToken`, the
  `Authorization` header injection, `refreshAccessToken`, `refreshInFlight`, and
  the **401 → refresh → retry-once** loop. Keep `credentials: 'include'`.
- A 401 is now **terminal**: parse the error, fire `onUnauthorized`, throw
  `ApiError`. `apiStream` keeps working (cookie rides along on SSE).

**`frontend/src/store/session.ts`**
- `setSession(user)` drops the `accessToken` parameter; remove `setAccessToken`
  wiring. `handleUnauthorizedAccess` and the `sessionExpired` banner logic stay
  (a terminal 401 still flips the store to expired).

**`frontend/src/hooks/useAuth.ts` + `frontend/src/lib/sessionReset.ts`**
- `login()`: `POST /auth/login` → `swapSession(user)` (no token).
- `initAuth()`: drop `refreshAccessToken`; just `GET /auth/me` (cookie rides
  along) → `setSession(user)` / `clearSession()` on 401.
- `logout()`: unchanged shape (`POST /auth/logout` clears the cookie
  server-side, then `clearSession`).
- `swapSession` / `LoginResponse` lose the `accessToken` field.
- `register` / `resetPassword`: unchanged. Password change keeps the user logged
  in (Decision 6) — no client-side re-login needed.

## Data flow

- **Login:** `POST /auth/login {username,password}` → verify password → unwrap
  DEK → `openSession` → `Set-Cookie <session>=<id>` → `200 { user }`.
- **Authed request:** cookie → `requireAuth` → `getSession` → attach `user`+DEK
  → slide idle expiry (clamped to absolute cap) → re-`Set-Cookie` if within ~24h
  of expiry → handler.
- **App boot:** `GET /auth/me` (cookie) → `200 { user }` (authenticated) or
  `401` (unauthenticated).
- **Logout:** `POST /auth/logout` → `closeSession` + clear cookie → `204`.
- **Password change:** rewrap DEK → evict all sessions → open fresh session for
  caller → re-`Set-Cookie` → `204` (caller stays logged in; other devices out).
- **Reset / sign-out-everywhere / delete-account:** `closeSessionsForUser`
  evicts every in-memory session for the user; the caller's cookie is cleared
  where applicable.
- **Restart:** in-memory store wiped → next request `401 session_expired` →
  frontend routes to `/login`. (Unchanged from today.)

## Error handling

Preserve the two-code 401 distinction that drives the F65 "session expired"
banner:

- **No session cookie → `401 { code: 'unauthorized' }`** (never logged in /
  cookie cleared).
- **Cookie present but no live session → `401 { code: 'session_expired' }`**
  (was logged in; session evicted/expired/restarted/absolute-cap-hit).

The frontend treats any 401 as terminal (no retry) and routes to `/login`;
`session_expired` shows the banner, `unauthorized` does not. CSRF rejections are
`403 { code: 'csrf_block' }`.

## Deployment behind a TLS-terminating reverse proxy

The project ships no built-in proxy; the operator provides TLS. This design
assumes that topology and pins these requirements (documented in
`SELF_HOSTING.md`):

1. **TLS at the edge is mandatory in production.** The session cookie is
   `Secure`/`__Host-` in prod, so the browser only returns it over HTTPS. The
   proxy↔backend hop may stay plain HTTP (loopback/LAN); only the browser↔edge
   leg needs TLS. No HTTPS → unauthenticated loop (by design — no insecure
   fallback).
2. **Serve the SPA and `/api` under one public origin** (the default nginx
   setup). Same-origin makes `SameSite`, CORS, and the Origin-check trivially
   correct.
3. **`FRONTEND_URL` / allowed origins must be the public `https://` origin**,
   not `http://localhost`. The browser's real `Origin` header is forwarded by
   the proxy and is what the CSRF Origin-check and CORS compare against. Wrong
   value → 403s.
4. **Set `trust proxy` to the exact hop count** (default `1`), never trust-all,
   so per-IP rate limits see the real client via `X-Forwarded-For` without
   allowing spoofing. This also fixes the pre-existing per-proxy bucketing of the
   current limiters; a wrong count (e.g. `2` with one proxy) makes `req.ip`
   spoofable.
5. **Non-browser/automation clients must send an `Origin` header** matching the
   allowed origin on any mutating (`POST`/`PUT`/`PATCH`/`DELETE`) request, or
   they get `403 csrf_block` under default-deny. Audit `scripts/` (the proxy
   smoke / backup-restore-drill) for header-less POSTs and fix them.

**Caveat that would change the design:** splitting the SPA and API across
**different registrable domains** (e.g. `app.com` + `api.io`) breaks
`SameSite=Lax` (cookie not sent on those cross-site calls) and would require
`SameSite=None; Secure` + a stronger CSRF story. Same-origin or same-site
subdomain (`api.example.com`) deployments are fine; under a shared parent domain
the `__Host-` prefix is what blocks a sibling subdomain from injecting the
session cookie. Local dev is unaffected: `secure` is `false` and the plain
`session` name is used in non-production, so `http://localhost` works as now.

## Security considerations

- **XSS:** the session handle is httpOnly → not readable by injected JS, so it
  cannot be exfiltrated (an improvement over today's JS-held `Bearer` access
  token, per OWASP "don't store session IDs where JS can read them"). An XSS can
  still ride the cookie in-page to make requests while the page is open, but
  cannot steal a portable, reusable credential.
- **Credential lifetime is the honest cost.** Today the XSS-reachable Bearer
  token is DEK-adjacent for only ~15 min. A stolen *session cookie* is directly
  DEK-bearing for up to the idle/absolute window (≤30d, or until restart).
  httpOnly removes the JS-exfiltration vector, but a cookie stolen another way
  (malware, a `Secure`-bypass on a misconfigured plain-HTTP prod — which this
  design forbids) grants a longer-lived credential. Net: better against XSS,
  longer-lived credential overall; the absolute cap + httpOnly + HTTPS-only are
  the mitigations.
- **CSRF:** newly relevant because every route is now cookie-authed. Defense in
  depth: `SameSite=Lax` + the **default-deny** global Origin/Referer check +
  JSON-only request bodies + no state-changing GET routes + no method-override
  middleware. OWASP positions header-based Origin checks as defense-in-depth
  (normally paired with a token); this token-less posture is acceptable **only**
  while the invariant below holds.
- **CSRF invariant (record in `CLAUDE.md` / `docs/agent-rules/backend.md`):**
  the token-less CSRF posture depends on all of — (a) **no state-changing GET
  routes**, (b) **JSON bodies only** (only `express.json()` is mounted; no
  `urlencoded`/`multipart` parser on mutating routes), (c) **no method-override
  middleware**. If any future route violates these, SameSite=Lax is the only
  remaining defense (and it has the documented ~2-minute post-set cross-site-POST
  hole), so such a route must add a CSRF token.
- **Cookie hardening:** `__Host-` prefix in prod blocks sibling-subdomain cookie
  injection/overwrite; `HttpOnly` + `Secure` mandatory there.
- **Session fixation:** a fresh `sessionId` is minted at login and at
  password-change; the server never accepts a client-supplied id. No fixation
  vector. The id is not rotated mid-session (no privilege-elevation step exists).
- **At rest:** no session secret and no session token are persisted anywhere.
  The previous DB-dump refresh-token exposure is gone structurally.
- **No persistent revocation/audit (accepted trade):** all session authority is
  process-memory and wiped on restart. No cross-restart audit trail and no
  persistent revoke beyond a restart. Acceptable for a single-process
  self-hosted app; stated so it is a deliberate choice. `signOutEverywhere`
  evicts in-memory sessions immediately (effective in-process).
- **Availability:** `evictOldest` can force-logout the oldest live user under
  cap pressure (a burst of logins). Mitigated by the `/login` rate limiter and
  the env-tunable cap; called out so an operator on a busy instance can raise
  `SESSION_STORE_MAX`.
- **Enumeration / timing:** unchanged — `login` / `reset-password` keep their
  existing timing-equalisation; this change does not touch those paths.

## Testing

The test migration is **substantial** — it is a first-class part of the work,
not an afterthought.

- **Shared helper rewrites (do first — most files depend on these):**
  - `backend/tests/routes/_chat-test-helpers.ts`: `registerAndLogin` returns
    `accessToken` today → return/forward the session cookie instead;
    `makeFakeReq` does `jwt.decode(accessToken)` to recover `sessionId` →
    recover the `sessionId` from the login response's `Set-Cookie` header (and
    look it up in the in-memory store); `resetAll` calls
    `prisma.session.deleteMany()` / `prisma.refreshToken.deleteMany()` → remove
    (tables gone; reset the in-memory store instead).
  - `backend/tests/models/_helpers.ts`: same `prisma.session/refreshToken`
    cleanup removal.
  - `backend/tests/setup.ts`: remove the now-dead `JWT_SECRET` /
    `REFRESH_TOKEN_SECRET` env (otherwise the new `env-validation` stale-warning
    tests would fire on the test env's own values).
  - Integration tests authenticate via a cookie-persisting agent
    (`request.agent(app)` + login), not `Authorization: Bearer`.
  - **Every mutating integration test must send an `Origin` header** matching
    the allowed origin, or default-deny CSRF returns `403`. Prefer setting the
    header in the shared helper (so the CSRF path is actually exercised) over
    exempting `NODE_ENV==='test'`.
- **Delete obsolete files:** `backend/tests/auth/refresh.test.ts`,
  `backend/tests/models/refresh-token.test.ts`.
- **Backend behavior tests:**
  - `auth.middleware`: cookie absent → `unauthorized`; present-but-dead →
    `session_expired`; hit → attaches user+DEK; throttled re-`Set-Cookie` (set
    near expiry, not every request); slide clamped to absolute cap.
  - `auth.service` `login` / `logout` against the in-memory store.
  - `changePassword` re-mint: caller's old session evicted, a new session opened
    and is the **only** live session for that user, new cookie set (Decision 6).
  - **CSRF default-deny** tests: mutating request with no `Origin`/`Referer` →
    `403`; non-matching `Origin` → `403`; same-origin → passes; GET exempt.
  - Absolute-cap test: a session past `createdAt + 30d` is rejected even if
    recently active. Sliding-idle test. Restart→401 retained.
  - Prod cookie shape under `NODE_ENV=production`: `__Host-session`, `Secure`,
    `Path=/`, no `Domain`.
  - `/login` rate-limit test. `env-validation` stale-warning tests for
    `JWT_SECRET` / `REFRESH_TOKEN_SECRET`.
  - SSE: a streaming endpoint emits the slide `Set-Cookie` before the body (no
    "headers already sent") and the `no-store` middleware doesn't clobber its
    `Cache-Control`.
- **Frontend:**
  - `api` client: no `Authorization` header; 401 terminal (no `/auth/refresh`);
    `onUnauthorized` fires.
  - `initAuth`: boots via `GET /auth/me` (no refresh call); 401 → unauthenticated.
  - `session` store: `setSession(user)` with no token; banner wiring intact.
- **E2E (Playwright):** login → use app → reload still authenticated (cookie) →
  logout clears it. (Idle/absolute expiry not E2E'd.)
- **Encryption leak test `[E12]`:** unaffected (no narrative change) but run per
  protocol.

## Rollout

Shipping this **logs every user out once**: existing access JWTs and refresh
cookies become invalid and the tables drop — identical to any backend restart.
The frontend already routes 401 → `/login`. Notes:

- **Sequence the migration last.** Remove every `prisma.session` /
  `prisma.refreshToken` reference from **src and tests** before the Prisma client
  is regenerated, then run the `DROP TABLE` migration; otherwise typecheck and
  runtime both break on the dropped relations. Per the CLAUDE.md dev-container
  drift gotcha, **regenerate the client + restart the backend after migrating**
  (`make migrate` restarts it; in dev, restart manually).
- Stale `refreshToken` cookies in browsers (path `/api/auth`) are harmless — the
  endpoint is gone and they expire on their own. The new logout uses `Path=/`, so
  it won't clear the old path-scoped cookie; cosmetic, self-heals on expiry.
- No data migration beyond the two `DROP TABLE`s; no narrative data touched.

## Reviewers

- **security-reviewer** — in-lane (auth.service, auth.middleware,
  origin-check.middleware, auth.routes, session-store, index.ts
  cookie/CORS/CSRF/trust-proxy bootstrap, env bootstrap). Primary gate.
- **repo-boundary-reviewer** — out of lane (no narrative repos/routes/columns
  touched; the migration drops only non-narrative tables, so the close-gate
  matcher correctly will not fire it).

## Affected files (touch-set)

**Backend src**
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/origin-check.middleware.ts`
- `backend/src/services/session-store.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/routes/auth.routes.ts`
- `backend/src/index.ts`
- `backend/src/boot/env-validation.ts`
- `backend/prisma/schema.prisma` + new migration under
  `backend/prisma/migrations/`
- `backend/package.json` (drop `jsonwebtoken` / `@types/jsonwebtoken`)

**Frontend src**
- `frontend/src/lib/api.ts`
- `frontend/src/store/session.ts`
- `frontend/src/hooks/useAuth.ts`
- `frontend/src/lib/sessionReset.ts`

**Tests**
- Rewrite shared helpers: `backend/tests/routes/_chat-test-helpers.ts`,
  `backend/tests/models/_helpers.ts`, `backend/tests/setup.ts`
- Delete: `backend/tests/auth/refresh.test.ts`,
  `backend/tests/models/refresh-token.test.ts`
- Update all mutating integration tests (cookie agent + `Origin` header) and the
  per-component tests listed in Testing
- Frontend tests mirroring the four frontend files

**Scripts / docs**
- Audit `scripts/` for header-less POSTs (proxy smoke, backup-restore-drill)
- `SELF_HOSTING.md` (TLS-required, trust-proxy hop count, automation `Origin`
  requirement, `SESSION_STORE_MAX`)
- `docs/api-contract.md` (drop `/auth/refresh`, document cookie auth)
- `CLAUDE.md` / `docs/agent-rules/backend.md` (secret inventory: `JWT_SECRET` /
  `REFRESH_TOKEN_SECRET` retired; **CSRF invariant**)
- `.env.example` (remove the two secrets if present; document `SESSION_STORE_MAX`
  + `trust proxy` if surfaced as env)
