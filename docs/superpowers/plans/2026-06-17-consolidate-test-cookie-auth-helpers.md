# Plan: Consolidate the duplicated cookie-agent test login helpers

> **Status:** BACKLOG — its own bd issue + **separate PR** (NOT part of the cookie-session-auth PR).
> **Why separate:** maintainability-only. Option 1 (commit `32f97a3`) already removed the *correctness* wart
> (the dev-only hardcoded `'session='`); what remains is a ~34-file mechanical de-duplication. Bundling it into
> the already-large cookie-session-auth PR would make that PR unwieldy to review (decision recorded during the
> review walkthrough). The high-value small follow-ups (src-hardening, docs, test-name cleanup) ship in the
> cookie-session-auth PR via `2026-06-17-cookie-session-auth-review-followups.md`; this is the leftover cleanup.
> **It is OK if this never gets prioritised** — duplicated test setup helpers are a low-severity smell.

## Problem

~34 backend test files each define their own `registerAndLogin` (31), `makeFakeReq` (18), `TestSession` type,
and `TEST_ORIGIN` const — near-identical `request.agent(app)` → register (Origin) → login (Origin) → extract
the session cookie. Only `_chat-test-helpers.ts`, `auth.routes.test.ts`, `auth.middleware.test.ts` share code.
A future change to the login/cookie shape means editing ~34 files; the helpers have already drifted once (the
`'session='` literal lived in 24 of them independently before Option 1).

## Goal

One shared cookie-agent auth helper module, imported everywhere. Zero local `registerAndLogin` /
`registerAndLoginTwice` / `makeFakeReq` / `TestSession` / `TEST_ORIGIN` copies (special cases call the shared
primitives). Full backend suite green throughout — a refactor with **no behavioural or assertion changes**
(beyond two consciously-dropped `expect(reg.status).toBe(201)` asserts, below).

## The canonical helper (superset shape)

Create `backend/tests/helpers/auth.ts` (reuse the EXISTING `backend/tests/helpers/` dir — which already holds
`makeUser.ts`; do NOT create a parallel `_helpers/`):

```ts
import type { Request } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { getSession } from '../../src/services/session-store';

export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestSession {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
  userId: string;       // superset: satisfies the userId-needing callers
}

export function extractSessionId(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
  expect(cookie).toBeDefined();
  return decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
}

export async function registerAndLogin(username: string, password = 'test-pw', name = 'Test User'): Promise<TestSession> {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ name, username, password });
  const login = await agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ username, password });
  expect(login.status).toBe(200);
  return { agent, sessionId: extractSessionId(login), userId: login.body.user.id as string };
}

/** Second independent agent/cookie-jar for the SAME already-registered user (sign-out-everywhere). */
export async function loginAgain(username: string, password = 'test-pw'): Promise<TestSession> {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ username, password });
  expect(login.status).toBe(200);
  return { agent, sessionId: extractSessionId(login), userId: login.body.user.id as string };
}

export function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}
```

`routes/_chat-test-helpers.ts` keeps the Venice fixtures and **re-exports** the auth helpers so chat-suite
imports keep working unchanged.

## Caller taxonomy — TWO independent axes (do NOT assume "drop-in")

**Axis 1 — call-site argument (the big one).** The shared `registerAndLogin` requires a `username`:
- **Username-taking helpers** (call sites already pass one → genuine drop-in): `routes/{stories,story-detail,
  chapters,chapters-reorder,chapters-body-json,characters,outline}`, `auth/delete-account`.
- **Zero-arg helpers using a module-level `USERNAME`** (call sites are `registerAndLogin()` and MUST become
  `registerAndLogin(<that file's USERNAME>)` at EVERY call — some files 20+ times): all 11 `ai/*`,
  `auth/{change-password,rotate-recovery-code,session-dek,update-profile}`, agent-only
  `routes/{ai-defaults,user-settings,venice-key,venice-account}`, `security/byok-leak`. Typecheck catches a
  missing arg (not silent), but this is the high-volume work.

**Axis 2 — destructured shape** (all satisfied by the superset): `{ agent }`, `{ agent, sessionId }` (incl.
`session-dek` — it does NOT return `userId`), `{ agent, userId }` (`update-profile`),
`{ agent, sessionId, userId }` (`change-password`, `delete-account`, `rotate-recovery-code`).

**Special cases:** `sign-out-everywhere` (bespoke `registerAndLoginTwice` → `registerAndLogin(u)` + `loginAgain(u)`);
`login-username` (inline across ~4 tests — partially migrate; LEAVE tests asserting the raw login response);
`session-dek` (helper nested in a `describe` — lift to top-level import). Two `expect(reg.status).toBe(201)`
asserts (`sign-out-everywhere`, `session-dek`) are consciously dropped (shared helper asserts login-200, not
register-201).

## `makeFakeReq` (18 local copies)

Part of the same duplication. Delete each local `function makeFakeReq`, import from `helpers/auth.ts`. Reconcile
any divergent copy to the shared shape (flag if one can't be).

## How to execute a ~34-file refactor safely (management approach)

1. **Let the type-checker enumerate the work.** Requiring a `username` arg turns every un-migrated zero-arg call
   site into a COMPILE ERROR — `tsc` lists what's left, so the migration physically cannot be silently half-done.
2. **Batch + gate, one agent per batch.** Migrate per-directory (routes/, then ai/, then auth/), run
   `npm -w story-editor-backend run test` after each batch, commit each. Bounded blast radius; a bad batch reverts cleanly.
3. **Don't codemod the non-uniform parts** — the per-file `USERNAME`, destructure shapes, and 3 special cases
   defeat a clean codemod; careful batches beat a brittle script here.
4. **Preserve per-file `USERNAME` uniqueness** (see Risks).

## Tasks

1. Create `helpers/auth.ts`; re-point `_chat-test-helpers.ts` to re-export. Run chat-suite — green.
2. Migrate the **username-taking** files (drop-in). Run — green.
3. Migrate the **zero-arg** files in per-directory batches — add `(USERNAME)` at every call site + import +
   destructure fix. Run each batch — green. (Highest-volume step.)
4. Fold in `makeFakeReq` (delete locals, import). Run — green.
5. Special cases: `sign-out-everywhere`, `session-dek` (un-nest), `login-username` (partial). Run — green.
6. Import shared `TEST_ORIGIN` into residual local-`TEST_ORIGIN` declarers not in a migration group
   (`reset-password`, `register-username`) + partial `login-username`. Run — green.
7. **Completion greps — each must show ONLY `backend/tests/helpers/auth.ts`:** `function registerAndLogin` /
   `registerAndLoginTwice`; `interface TestSession` / `type TestSession`; `function makeFakeReq`; `TEST_ORIGIN =`.

## Verify

`make dev` up; `npm -w story-editor-backend run typecheck && npm -w story-editor-backend run test` — typecheck
clean, suite green at the **same count** (pure refactor, no new tests). Task-7 greps confirm zero local copies.

## Risks / notes

- **Username uniqueness is a load-bearing invariant.** No per-test DB reset (vitest non-concurrent; `setup.ts`
  only pins the DB). Files rely on register-or-ignore + a **distinct per-file `USERNAME`**. A zero-arg call site
  MUST keep passing that file's existing unique username — collapsing to a shared literal silently makes one file
  log into another file's user (cross-file contamination, NOT a loud failure). Preserve each file's `USERNAME`.
- **Volume, not cleverness, is the risk** — Task 3 is the bulk. Small per-directory batches, suite after each.
- **`login.body.user.id` shape** — the shared helper reads `userId` from the login body; valid post-cutover.
