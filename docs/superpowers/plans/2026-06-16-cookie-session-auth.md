# Cookie-Session Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed via the project's `/bd-execute` loop.

**Goal:** Retire `JWT_SECRET` and `REFRESH_TOKEN_SECRET` by making the existing in-memory `sessionId` the sole credential, carried in an opaque httpOnly cookie; drop the access JWT, the refresh token, and the `RefreshToken` + `Session` DB tables.

**Architecture:** The 256-bit random `sessionId` (already the key of the in-memory `session-store` map holding `{userId, dek}`) becomes the value of an httpOnly cookie (`__Host-session` in prod, `session` in dev). `requireAuth` reads the cookie → `getSession` → attaches user + DEK, sliding a 7-day idle expiry clamped to a 30-day absolute cap. CSRF is `SameSite=Lax` + a default-deny global Origin check. No signing, no refresh flow, no DB session persistence.

**Tech Stack:** Express, Prisma (Postgres), TypeScript (strict), Vitest (backend integration tests need the docker stack up — `make dev`), React + Zustand + TanStack Query (frontend), supertest.

**Spec:** `docs/superpowers/specs/2026-06-16-cookie-session-auth-design.md` — authoritative; read it before starting.

**Branch:** `feature/cookie-session-auth` (stacked on `feature/retire-app-encryption-key` / PR #136).

---

## Ordering & coupling (read first)

Tasks 1–3 are independent and stay green on their own. Tasks 4–9 are the **backend auth cutover**: they are coupled (login stops returning a token; the suite is partially red until the test-infra rewrite in Task 9 lands). Treat Tasks 4–9 as a unit — the full backend suite returns to green at the end of Task 9. Task 10 (schema drop) must come **after** every `prisma.session` / `prisma.refreshToken` reference is gone from src **and** tests. Tasks 11–12 (frontend) and 13 (docs/scripts) are independent of the migration.

Dependency sketch: `1,2,3` → `4` → `5,6,7` → `8` → `9` → `10`; `11,12` independent; `13` last.

Per-task `verify` during the cutover is **typecheck + the task's targeted tests**; the **full** `make verify` is the close gate (Task 14).

---

## File map

**Create**
- `backend/src/lib/session-cookie.ts` — cookie name resolver + `sessionCookieOptions()` (env-divergent).
- `backend/prisma/migrations/<ts>_drop_session_and_refresh_token/migration.sql` — `DROP TABLE`.
- `backend/tests/lib/session-cookie.test.ts`, `backend/tests/middleware/origin-check.test.ts` (if absent) — new unit tests.

**Modify (backend src)**
- `backend/src/services/session-store.ts`, `backend/src/services/auth.service.ts`, `backend/src/middleware/auth.middleware.ts`, `backend/src/middleware/origin-check.middleware.ts`, `backend/src/routes/auth.routes.ts`, `backend/src/index.ts`, `backend/src/boot/env-validation.ts`, `backend/prisma/schema.prisma`, `backend/package.json`.

**Modify (frontend src)**
- `frontend/src/lib/api.ts`, `frontend/src/store/session.ts`, `frontend/src/hooks/useAuth.ts`, `frontend/src/lib/sessionReset.ts`.

**Modify (tests)**
- `backend/tests/routes/_chat-test-helpers.ts`, `backend/tests/models/_helpers.ts`, `backend/tests/setup.ts`, plus all mutating integration tests (cookie agent + `Origin` header). **Delete** `backend/tests/auth/refresh.test.ts`, `backend/tests/models/refresh-token.test.ts`. Frontend tests for the four frontend files.

**Modify (docs/scripts)**
- `SELF_HOSTING.md`, `docs/api-contract.md`, `CLAUDE.md`, `docs/agent-rules/backend.md`, `.env.example`, audit `scripts/`.

---

## Task 1: session-store — absolute cap, env-tunable cap, expired-first eviction

**Files:**
- Modify: `backend/src/services/session-store.ts`
- Test: `backend/tests/services/session-store.test.ts` (extend; create if absent)

- [ ] **Step 1: Write failing tests**

Add to the session-store test (frontend-style jsdom not needed; this is a pure module — runs under backend vitest, which still triggers globalSetup, so `make dev` must be up):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openSession, getSession, extendSessionExpiry, _resetSessionStore, _sessionCount,
} from '../../src/services/session-store';

const dek = Buffer.alloc(32, 7);

describe('session-store absolute cap + sliding', () => {
  beforeEach(() => _resetSessionStore());

  it('slides idle expiry up to the absolute cap, then refuses to extend past it', () => {
    const now = Date.now();
    openSession({ sessionId: 's1', userId: 'u1', dek, createdAt: new Date(now), expiresAt: new Date(now + 1000) });
    // Ask to slide far beyond the 30-day cap:
    extendSessionExpiry('s1', new Date(now + 40 * 24 * 3600_000));
    // It must be clamped to createdAt + 30d, not 40d:
    // (assert via a getter or by probing expiry just after the cap — see Step 3 for the API)
    expect(getSession('s1')).not.toBeNull();
  });

  it('expires a session once now passes createdAt + ABSOLUTE_TTL even if recently extended', () => {
    const past = Date.now() - 31 * 24 * 3600_000; // created 31 days ago
    openSession({ sessionId: 's2', userId: 'u1', dek, createdAt: new Date(past), expiresAt: new Date(Date.now() + 1000) });
    extendSessionExpiry('s2', new Date(Date.now() + 7 * 24 * 3600_000)); // try to slide 7d out
    expect(getSession('s2')).toBeNull(); // clamp pinned expiry to past+30d (< now) → expired
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`openSession` has no `createdAt` param yet; clamp not implemented).

Run: `npm -w story-editor-backend run test -- tests/services/session-store.test.ts`
Expected: FAIL (type error on `createdAt` / assertion on `s2`).

- [ ] **Step 3: Implement**

In `session-store.ts`:
- Add constants: `export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;` and `export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;`.
- Make the cap env-tunable: `const MAX_SESSIONS = Number(process.env.SESSION_STORE_MAX) || 10_000;`.
- Add `createdAt: number` to `SessionEntry`. Add `createdAt: Date` to `OpenSessionInput`; store `createdAt.getTime()` in `openSession`.
- Clamp in `extendSessionExpiry`:

```ts
export function extendSessionExpiry(sessionId: string, expiresAt: Date): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  const cap = entry.createdAt + ABSOLUTE_TTL_MS;
  entry.expiresAt = Math.min(expiresAt.getTime(), cap);
  entry.lastAccessedAt = Date.now();
}
```

- Eviction: in `openSession`, when at cap, call `sweep()` first, then only `evictOldest()` if still full, and `console.warn('[session-store] evicting a live session under cap pressure; consider raising SESSION_STORE_MAX')` inside `evictOldest` when it removes a non-expired entry.
- Add a test-only getter so the clamp is assertable: `export function _peekExpiry(sessionId: string): number | null { return sessions.get(sessionId)?.expiresAt ?? null; }`. Use it in Step 1's first test to assert `_peekExpiry('s1') === <created>+ABSOLUTE_TTL_MS`.

- [ ] **Step 4: Run, expect PASS.** Run the same command.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/session-store.ts backend/tests/services/session-store.test.ts
git commit -m "[<bd-id>] session-store: 30d absolute cap, env-tunable max, expired-first eviction"
```

---

## Task 2: session-cookie lib — env-divergent name + options

**Files:**
- Create: `backend/src/lib/session-cookie.ts`
- Test: `backend/tests/lib/session-cookie.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { sessionCookieName, sessionCookieOptions } from '../../src/lib/session-cookie';

const orig = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = orig; });

describe('session-cookie', () => {
  it('uses __Host- + Secure + Path=/ in production', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieName()).toBe('__Host-session');
    const o = sessionCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect('domain' in o).toBe(false);
  });

  it('uses a plain name and no Secure outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(sessionCookieName()).toBe('session');
    expect(sessionCookieOptions().secure).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing). `npm -w story-editor-backend run test -- tests/lib/session-cookie.test.ts`

- [ ] **Step 3: Implement**

```ts
// backend/src/lib/session-cookie.ts
import type { CookieOptions } from 'express';
import { ABSOLUTE_TTL_MS } from '../services/session-store';

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// __Host- requires Secure + Path=/ + no Domain, which only holds over HTTPS (or
// localhost). In dev a LAN-IP / custom-host setup is not a secure context, so
// we use a plain, non-Secure cookie there. See spec Decision 5.
export function sessionCookieName(): string {
  return isProd() ? '__Host-session' : 'session';
}

export function sessionCookieOptions(maxAgeMs: number = ABSOLUTE_TTL_MS): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/session-cookie.ts backend/tests/lib/session-cookie.test.ts
git commit -m "[<bd-id>] add env-divergent session-cookie helper (__Host- in prod)"
```

---

## Task 3: origin-check middleware — default-deny

**Files:**
- Modify: `backend/src/middleware/origin-check.middleware.ts`
- Test: `backend/tests/middleware/origin-check.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireAllowedOrigin } from '../../src/middleware/origin-check.middleware';

const ALLOWED = ['https://app.example.com'];
function run(method: string, headers: Record<string, string>) {
  const mw = requireAllowedOrigin(ALLOWED);
  const req = { method, headers } as unknown as Request;
  const json = vi.fn();
  const res = { status: vi.fn(() => res), json } as unknown as Response;
  const next = vi.fn();
  mw(req, res, next);
  return { next, json };
}

describe('requireAllowedOrigin default-deny', () => {
  it('blocks a mutating request with no Origin and no Referer', () => {
    const { next, json } = run('POST', {});
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ error: { message: 'Origin not allowed', code: 'csrf_block' } });
  });
  it('allows a matching Origin', () => {
    const { next } = run('POST', { origin: 'https://app.example.com' });
    expect(next).toHaveBeenCalled();
  });
  it('exempts GET', () => {
    const { next } = run('GET', {});
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** on the both-absent case (currently fail-open). `npm -w story-editor-backend run test -- tests/middleware/origin-check.test.ts`

- [ ] **Step 3: Implement** — delete the both-absent `next()` branch (lines ~37–45). After the GET/HEAD/OPTIONS exemption, the logic becomes: allow only if a present `Origin` matches an allowed origin, or a present `Referer` `startsWith(`${o}/`)`; otherwise `403 csrf_block`. Update the file docstring: this middleware is now the **primary** CSRF defense on all mutating `/api` routes (no longer "all other routes use Bearer"); a missing `Origin`+`Referer` is blocked per OWASP. Note non-browser automation must send `Origin`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/origin-check.middleware.ts backend/tests/middleware/origin-check.test.ts
git commit -m "[<bd-id>] origin-check: default-deny when Origin+Referer absent (CSRF)"
```

---

## Task 4: auth.service — drop JWT/refresh, cookie-session login/logout, re-mint on password change

**Files:**
- Modify: `backend/src/services/auth.service.ts`
- Test: `backend/tests/services/auth.service.test.ts` (or wherever login/logout/changePassword are tested) — updated alongside.

- [ ] **Step 1: Write/adjust failing tests** for the new contracts:

```ts
// login returns only { user } and opens an in-memory session; no tokens.
it('login opens an in-memory session and returns only the user', async () => {
  // register a user first (helper), then:
  const result = await authService.login({ username, password });
  expect(result).toEqual({ user: expect.objectContaining({ username }) });
  // a session now exists with the right DEK (probe via session-store):
  // grab the only session for this user via a test seam or by counting _sessionCount()
});

// changePassword re-mint: caller's old session gone, exactly one new live session.
it('changePassword evicts all sessions then opens exactly one fresh session for the caller', async () => {
  const { sessionId: oldId } = await loginHelper();
  const newId = await authService.changePassword({ userId, oldPassword, newPassword });
  expect(getSession(oldId)).toBeNull();
  expect(getSession(newId)).not.toBeNull();
  // and it is the only live session for that user
});
```

- [ ] **Step 2: Run, expect FAIL.** `npm -w story-editor-backend run test -- tests/services/auth.service.test.ts`

- [ ] **Step 3: Implement**

In `auth.service.ts`:
- Remove `import jwt` and all JWT usage. Delete `signAccessToken`, `signRefreshToken`, `AccessTokenPayload`, `RefreshTokenPayload`, `InvalidRefreshTokenError`, `refresh()`, `ACCESS_TOKEN_TTL_SECONDS`, and `getRequiredEnv` if unused. Import `IDLE_TTL_MS` from session-store.
- `LoginResult` → `{ user: PublicUser }`.
- `login()`: after `unwrapDekWithPassword`, do **not** write Session/RefreshToken rows. Generate `const sessionId = crypto.randomBytes(32).toString('hex');`, then:

```ts
const now = Date.now();
openSession({
  sessionId, userId: user.id, dek,
  createdAt: new Date(now),
  expiresAt: new Date(now + IDLE_TTL_MS),
});
return { user: toPublicUser(user) };
```

The route is responsible for setting the cookie; expose the `sessionId` to the route by returning it: make `login()` return `{ user, sessionId }` (internal field the route consumes; not part of the wire body). Define `LoginResult = { user: PublicUser; sessionId: string }`.
- `logout(sessionId: string)`: `closeSession(sessionId)` (drop the refresh-token DB delete).
- `changePassword({ userId, oldPassword, newPassword })`: keep the verify + rewrap + DB `user.update` (drop the `refreshToken.deleteMany` / `session.deleteMany` from its transaction). **After** the DB commit, in strict order:

```ts
closeSessionsForUser(user.id);            // evict ALL sessions first
const sessionId = crypto.randomBytes(32).toString('hex');
const now = Date.now();
openSession({ sessionId, userId: user.id, dek, createdAt: new Date(now), expiresAt: new Date(now + IDLE_TTL_MS) });
return sessionId;                          // route re-sets the caller's cookie
```

(The DEK here is the same plaintext DEK already unwrapped with the old password — rewrap does not change it.)
- `resetPassword`, `signOutEverywhere`, `logoutAllSessionsForUser`, `deleteAccount`: remove `session.deleteMany` / `refreshToken.deleteMany` from their transactions; keep `closeSessionsForUser`. `deleteAccount` keeps `user.delete` (cascade no longer needs the dropped tables).

- [ ] **Step 4: Run, expect PASS** (service-level). Full suite still red until Task 9.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/auth.service.ts backend/tests/services/auth.service.test.ts
git commit -m "[<bd-id>] auth.service: cookie sessions, drop JWT/refresh, re-mint on pw change"
```

---

## Task 5: auth.middleware — cookie-based requireAuth with slide + throttled re-set

**Files:**
- Modify: `backend/src/middleware/auth.middleware.ts`

- [ ] **Step 1: Write failing tests** (middleware-level, with a fake req carrying `cookies`):

```ts
it('401 unauthorized when no session cookie', () => { /* req.cookies = {} → 401 code:'unauthorized' */ });
it('401 session_expired when cookie present but no live session', () => { /* req.cookies[name]='dead' → code:'session_expired' */ });
it('attaches user + DEK and slides expiry on a live session', () => { /* open a session, call mw, assert next() + req.user + extendSessionExpiry effect */ });
it('re-sets the cookie only when within ~24h of expiry', () => { /* near-expiry → res.cookie called; fresh → not called */ });
```

- [ ] **Step 2: Run, expect FAIL.** `npm -w story-editor-backend run test -- tests/middleware/auth.middleware.test.ts`

- [ ] **Step 3: Implement** — rewrite `requireAuth`:

```ts
import type { NextFunction, Request, Response } from 'express';
import { attachDekToRequest } from '../services/content-crypto.service';
import { getSession, extendSessionExpiry, IDLE_TTL_MS, _peekExpiry } from '../services/session-store';
import { sessionCookieName, sessionCookieOptions } from '../lib/session-cookie';

const COOKIE_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface AuthenticatedUser { id: string; sessionId: string; }
// (drop `email`)

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const name = sessionCookieName();
  const sessionId = (req.cookies?.[name] as string | undefined) ?? null;
  if (!sessionId) {
    res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
    return;
  }
  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: { message: 'Session expired', code: 'session_expired' } });
    return;
  }
  req.user = { id: session.userId, sessionId };
  attachDekToRequest(req, session.dek);

  // Slide (clamped to the absolute cap inside extendSessionExpiry).
  const now = Date.now();
  extendSessionExpiry(sessionId, new Date(now + IDLE_TTL_MS));
  // Throttled cookie re-set: only when the cookie is within ~24h of expiring.
  const expiry = _peekExpiry(sessionId);
  if (expiry !== null && expiry - now < COOKIE_REFRESH_THRESHOLD_MS) {
    res.cookie(name, sessionId, sessionCookieOptions(Math.max(0, expiry - now)));
  }
  next();
}
```

Notes: set the cookie **before** `next()` so it precedes any streamed body (SSE). Drop all `jsonwebtoken` imports and the `JWT_SECRET`/`server_error` branch. `AuthenticatedUser` no longer has `email` — update the `declare global` Express.Request augmentation accordingly. (Rename `_peekExpiry` to a non-underscore exported reader if you prefer it not look test-only; it's used in prod here — call it `peekSessionExpiry`.)

- [ ] **Step 4: Run, expect PASS** (middleware-level).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/auth.middleware.ts backend/src/services/session-store.ts backend/tests/middleware/auth.middleware.test.ts
git commit -m "[<bd-id>] requireAuth: cookie session, slide + throttled re-set, drop JWT"
```

---

## Task 6: auth.routes — set/clear cookie, /login rate limit, change-password re-set, remove /refresh

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`

- [ ] **Step 1: Adjust tests** in the auth-routes integration test: `/login` returns `200 { user }` and a `Set-Cookie` for the session cookie; `/logout` clears it; `/change-password` returns `204` with a fresh `Set-Cookie`; `POST /refresh` is gone (`404`). Use a `request.agent(app)` and set `Origin: http://localhost:3000` on every POST.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**
- Remove `REFRESH_COOKIE_NAME` / `refreshCookieOptions` and the `InvalidRefreshTokenError` import. Import `sessionCookieName`, `sessionCookieOptions`.
- `/login`: `const { user, sessionId } = await authService.login(req.body); res.cookie(sessionCookieName(), sessionId, sessionCookieOptions()); res.status(200).json({ user });`
- Add a per-IP limiter for `/login` (mirror `resetPasswordIpLimiter`, `limit: IS_TEST_ENV ? 10_000 : 20`).
- **Remove the `POST /refresh` handler entirely.**
- `/logout`: read the cookie via `req.cookies[sessionCookieName()]`; `await authService.logout(sessionId)` if present; `res.clearCookie(sessionCookieName(), { ...sessionCookieOptions(), maxAge: 0 }); res.status(204).send();`
- `/change-password`: after `const sessionId = await authService.changePassword(...)`, `res.cookie(sessionCookieName(), sessionId, sessionCookieOptions()); res.status(204).send();`
- `/sign-out-everywhere`, `/delete-account`: replace the refresh-cookie clear with the session-cookie clear (same `clearCookie` call).
- `/register`, `/reset-password`, `/me`, `/rotate-recovery-code`, `/update-profile`: unchanged except they no longer touch refresh cookies.

- [ ] **Step 4: Run, expect PASS** (auth-routes file). `npm -w story-editor-backend run test -- tests/routes/auth.routes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.routes.ts backend/tests/routes/auth.routes.test.ts
git commit -m "[<bd-id>] auth.routes: session cookie set/clear, /login limit, drop /refresh"
```

---

## Task 7: index.ts — global cookieParser + default-deny CSRF, no-store, trust proxy

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add an integration test** asserting: a cross-origin POST to a mutating route (e.g. `POST /api/stories`) with a bad `Origin` → `403 csrf_block`; an authed GET response carries `Cache-Control: no-store`. (Put in a small `backend/tests/routes/csrf-global.test.ts`.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `index.ts`:
- `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);` near app creation (document: must equal the real proxy hop count; never `true`).
- After `express.json(...)`, mount globally (before routers): `app.use(cookieParser());` and `app.use('/api', requireAllowedOrigin(allowedOrigins));`. Place the `/api` origin-check **before** the `/api/ai` rate limiter so forged requests are rejected before consuming budget.
- Add a `no-store` middleware for authed API responses (exempt the SSE route, which sets its own `Cache-Control`):

```ts
app.use('/api', (req, res, next) => {
  // Streaming completion sets its own Cache-Control; don't clobber it.
  if (req.path.startsWith('/ai/')) return next();
  res.setHeader('Cache-Control', 'no-store');
  next();
});
```

- Remove the per-mount `cookieParser()` and `requireAllowedOrigin(allowedOrigins)` from the `/api/auth` line (now global): `app.use('/api/auth', createAuthRouter());`.
- Update the stale comment block (lines ~78–82) that says cookieParser is auth-only.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/tests/routes/csrf-global.test.ts
git commit -m "[<bd-id>] index: global cookieParser + default-deny CSRF, no-store, trust proxy"
```

---

## Task 8: env-validation — warn on stale JWT_SECRET / REFRESH_TOKEN_SECRET

**Files:**
- Modify: `backend/src/boot/env-validation.ts`
- Test: `backend/tests/boot/encryption-keys.test.ts` (extend)

- [ ] **Step 1: Failing tests** — `validateEncryptionEnv({ env: { JWT_SECRET: 'x' }, warn })` calls `warn` once mentioning `JWT_SECRET`; same for `REFRESH_TOKEN_SECRET`.
- [ ] **Step 2: Run, expect FAIL.** `npm -w story-editor-backend run test -- tests/boot/encryption-keys.test.ts`
- [ ] **Step 3: Implement** — add two `if (env.JWT_SECRET) warn('[boot] JWT_SECRET is set but no longer used … remove it from your .env.')` blocks (and the `REFRESH_TOKEN_SECRET` analog), mirroring the `APP_ENCRYPTION_KEY` block.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "[<bd-id>] env-validation: warn on stale JWT_SECRET / REFRESH_TOKEN_SECRET"`

---

## Task 9: test infra rewrite — cookie agent, makeFakeReq, helper cleanup, delete dead tests, bulk Origin headers

**Files:**
- Modify: `backend/tests/routes/_chat-test-helpers.ts`, `backend/tests/models/_helpers.ts`, `backend/tests/setup.ts`
- Delete: `backend/tests/auth/refresh.test.ts`, `backend/tests/models/refresh-token.test.ts`
- Modify: all mutating integration tests across `backend/tests/**`

- [ ] **Step 1: Rewrite shared helpers**

`_chat-test-helpers.ts`:
```ts
import request from 'supertest';
import { app } from '../../src/index';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { getSession, sessionCookieName } from '../../src/services/session-store'; // name via session-cookie lib
import { sessionCookieName as cookieName } from '../../src/lib/session-cookie';

export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestSession { agent: ReturnType<typeof request.agent>; sessionId: string; }

function extractSessionId(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const name = cookieName();
  const cookie = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
}

export async function registerAndLogin(username: string, password = 'chat-route-pw', name = 'Chat Route User'): Promise<TestSession> {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ name, username, password });
  const login = await agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ username, password });
  expect(login.status).toBe(200);
  return { agent, sessionId: extractSessionId(login) };
}

export function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}
```
- `resetAll`: delete the `prisma.session.deleteMany()` and `prisma.refreshToken.deleteMany()` lines; add `_resetSessionStore()` (import from session-store) so in-memory sessions don't leak between tests.

`models/_helpers.ts`: remove the `prisma.session` / `prisma.refreshToken` `deleteMany` lines (same).

`setup.ts`: remove the `JWT_SECRET` / `REFRESH_TOKEN_SECRET` env assignments (lines ~6–7) — otherwise Task 8's stale-warning would fire on the test env.

- [ ] **Step 2: Delete dead tests**
```bash
git rm backend/tests/auth/refresh.test.ts backend/tests/models/refresh-token.test.ts
```

- [ ] **Step 3: Bulk-update mutating tests** — every test that authenticated via `Authorization: Bearer <accessToken>` switches to the `TestSession.agent`; every `request(app).post|put|patch|delete(...)` adds `.set('Origin', TEST_ORIGIN)`; every `makeFakeReq(accessToken)` call passes `session.sessionId`. Search drivers:
```bash
grep -rln "accessToken\|Bearer\|makeFakeReq\|\.session\.\|refreshToken" backend/tests
```
Work file-by-file until the grep is clean (except legitimate non-auth uses).

- [ ] **Step 4: Run the FULL backend suite, expect PASS** (stack must be up):
```bash
make dev   # ensure Postgres is healthy first
npm -w story-editor-backend run test
```
Expected: green. Fix code (not tests) for any real failures.

- [ ] **Step 5: Commit**
```bash
git add backend/tests
git commit -m "[<bd-id>] tests: cookie-agent auth, Origin headers, drop refresh/session-table tests"
```

---

## Task 10: Prisma — drop Session + RefreshToken (migration LAST)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<ts>_drop_session_and_refresh_token/migration.sql`

- [ ] **Step 1: Confirm no references remain**
```bash
grep -rn "prisma.session\|prisma.refreshToken\|model Session\|model RefreshToken\|sessions \|refreshTokens " backend/src backend/tests
```
Expected: only the `schema.prisma` model defs + `User` relation fields remain.

- [ ] **Step 2: Edit schema** — delete the `Session` and `RefreshToken` models and the `sessions Session[]` / `refreshTokens RefreshToken[]` relation fields on `User`.

- [ ] **Step 3: Generate the migration**
```bash
npm -w story-editor-backend exec prisma migrate dev --name drop_session_and_refresh_token --create-only
```
Confirm the generated SQL is `DROP TABLE "RefreshToken"; DROP TABLE "Session";` (order: drop both; they only FK to User). Add a top comment: data-only loss of session/refresh rows = one-time logout, no narrative data touched.

- [ ] **Step 4: Apply + regenerate client + restart backend**
```bash
make migrate          # prisma migrate deploy + restarts backend (refreshes generated client)
npm -w story-editor-backend run typecheck
npm -w story-editor-backend run test
```
Expected: typecheck clean (no `prisma.session`/`prisma.refreshToken` types), suite green.

- [ ] **Step 5: Commit**
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "[<bd-id>] drop Session + RefreshToken tables (cookie-session auth)"
```

---

## Task 11: frontend api.ts — remove Bearer + refresh-retry loop

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/tests/lib/api.test.ts` (jsdom; no stack needed)

- [ ] **Step 1: Adjust tests** — assert no `Authorization` header is ever set; a 401 throws `ApiError(401)` and fires `onUnauthorized` **without** any `/auth/refresh` call; `credentials: 'include'` is still set.
- [ ] **Step 2: Run, expect FAIL.** `npm --prefix frontend run test -- tests/lib/api.test.ts`
- [ ] **Step 3: Implement** — delete `accessToken`, `setAccessToken`, `getAccessToken`, `refreshAccessToken`, `refreshInFlight`, the `Authorization` injection in `buildRequestInit`, and the 401→refresh→retry block in `doRequest`. New `doRequest`:
```ts
async function doRequest(path: string, init?: ApiRequestInit): Promise<Response> {
  const res = await fetch(buildUrl(path), buildRequestInit(init));
  if (!res.ok) {
    const { message, code, body } = await parseErrorBody(res);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, message, code, body);
  }
  return res;
}
```
Keep `setUnauthorizedHandler`, `resetApiClientForTests` (drop the `accessToken` line), `ApiError`, `apiStream` (now just `doRequest`). Remove the now-unused `refreshAccessToken` export and fix importers in Task 12.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "[<bd-id>] frontend api: cookie auth, terminal 401, drop refresh-retry"`

---

## Task 12: frontend session/useAuth/sessionReset — drop access token, boot via /me

**Files:**
- Modify: `frontend/src/store/session.ts`, `frontend/src/hooks/useAuth.ts`, `frontend/src/lib/sessionReset.ts`
- Tests: matching `frontend/tests/**`

- [ ] **Step 1: Adjust tests** — `setSession(user)` takes one arg; `initAuth()` calls `GET /auth/me` (no `refreshAccessToken`) and sets the session on 200 / clears on 401; `swapSession(qc, user)` takes no token.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**
- `session.ts`: `setSession: (user) => set({ user, status: 'authenticated', sessionExpired: false })` (remove `setAccessToken` import + call). Keep `clearSession`, `handleUnauthorizedAccess`, `setUnauthorizedHandler` wiring.
- `sessionReset.ts`: `swapSession(queryClient, user)` → `await resetClientState(queryClient); useSessionStore.getState().setSession(user);` (drop the `accessToken` param).
- `useAuth.ts`: `login` calls `swapSession(queryClient, res.user)`; `LoginResponse` drops `accessToken`. `initAuth`:
```ts
export async function initAuth(signal?: AbortSignal): Promise<void> {
  const { setStatus, setSession, clearSession } = useSessionStore.getState();
  if (signal?.aborted) return;
  setStatus('loading');
  try {
    const me = await api<MeResponse>('/auth/me'); // cookie rides along
    if (signal?.aborted) return;
    setSession(me.user);
  } catch {
    if (signal?.aborted) return;
    clearSession();
  }
}
```
Remove the `refreshAccessToken` / `setAccessToken` imports.
- [ ] **Step 4: Run the FULL frontend suite** (cross-cutting session change — per project memory, run the whole suite, not just touched files): `npm --prefix frontend run test`. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "[<bd-id>] frontend: cookie session, boot via /auth/me, drop access token"`

---

## Task 13: package.json, docs, scripts audit

**Files:**
- Modify: `backend/package.json`, `SELF_HOSTING.md`, `docs/api-contract.md`, `CLAUDE.md`, `docs/agent-rules/backend.md`, `.env.example`; audit `scripts/`.

- [ ] **Step 1: Remove `jsonwebtoken` + `@types/jsonwebtoken`** from `backend/package.json`; `npm install` to update the lockfile; confirm `grep -rn "jsonwebtoken" backend/src backend/tests` is empty.
- [ ] **Step 2: Docs**
  - `SELF_HOSTING.md`: TLS-at-edge mandatory in prod; `trust proxy` hop count (default 1, never trust-all, fixes prior per-proxy bucketing); automation clients must send `Origin`; `SESSION_STORE_MAX`; `JWT_SECRET`/`REFRESH_TOKEN_SECRET` removed.
  - `docs/api-contract.md`: remove `POST /auth/refresh`; document cookie-based auth (login sets `__Host-session`; 401 codes `unauthorized` / `session_expired`; CSRF `403 csrf_block`).
  - `CLAUDE.md` + `docs/agent-rules/backend.md`: secret inventory (`JWT_SECRET`/`REFRESH_TOKEN_SECRET` retired) and the **CSRF invariant** (no state-changing GET; JSON-only bodies; no urlencoded/multipart on mutating routes; else add a CSRF token).
  - `.env.example`: remove the two secrets if present; document `SESSION_STORE_MAX` / `TRUST_PROXY_HOPS` if surfaced.
- [ ] **Step 3: Audit `scripts/`** for header-less POSTs to `/api` (proxy smoke, backup-restore-drill). Add `-H "Origin: $FRONTEND_URL"` (or equivalent) to any mutating curl, else they 403 under default-deny.
- [ ] **Step 4: Verify** `npm -w story-editor-backend run typecheck` and `make lint`.
- [ ] **Step 5: Commit** `git commit -m "[<bd-id>] drop jsonwebtoken dep; docs + scripts for cookie-session auth"`

---

## Task 14: Full verification (close gate)

- [ ] **Step 1: Stack up** — `make dev` and wait for the backend health check.
- [ ] **Step 2: Full verify** — `make verify` (lint + typecheck + design-lint + builds + shared/backend/frontend tests). The encryption leak test `[E12]` runs within the backend suite.
- [ ] **Step 3: E2E (optional, against a running stack)** — `make test-e2e` for the login → use → reload-still-authed → logout flow.
- [ ] **Step 4:** Confirm `grep -rn "JWT_SECRET\|REFRESH_TOKEN_SECRET\|jsonwebtoken\|prisma.session\|prisma.refreshToken\|accessToken" backend/src frontend/src` returns only intended/benign hits (e.g. `Cache-Control` unrelated). 
- [ ] **Step 5:** Hand off to `/bd-close-reviewed` (runs typecheck + `security-reviewer` + the verify line).

**Verify line for the bd issue notes:**
`verify: make dev && timeout 120 bash -c 'until curl -sf http://localhost:4000/api/health >/dev/null 2>&1; do sleep 2; done' && make verify`

---

## Self-review notes

- **Spec coverage:** every spec component maps to a task — session-store cap (T1), cookie lib (T2), CSRF default-deny (T3, T7), auth.service incl. re-mint (T4), requireAuth slide/throttle (T5), routes incl. /login limit + drop /refresh (T6), index wiring + no-store + trust proxy (T7), env warnings (T8), test migration incl. deletions + Origin headers (T9), table drop migration (T10), frontend simplification (T11, T12), jsonwebtoken removal + docs + scripts + CSRF invariant (T13), full verify (T14).
- **Type consistency:** `login()` returns `{ user, sessionId }`; `changePassword()` returns `string` (sessionId); `AuthenticatedUser = { id, sessionId }` (no `email`); cookie helpers `sessionCookieName()` / `sessionCookieOptions(maxAgeMs?)`; session-store exports `IDLE_TTL_MS`, `ABSOLUTE_TTL_MS`, `peekSessionExpiry`. These names are used consistently across T1–T9.
- **Ordering risk:** migration (T10) is gated on the grep in its Step 1; the cutover suite is green by end of T9.
