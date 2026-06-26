# Design: Test-log silencing + reporter consistency

Date: 2026-06-26
bd: story-editor-cgg (repurpose → Part A + reporter consistency),
story-editor-21b (close — superseded), story-editor-10m (stays open — known).
Supersedes the warnings-baseline approach in `docs/multi-agent-workflow-plan.md`
Phase 2 (see "Why not a baseline / zero-gate" below).

## Guiding principle

**Suppress intentional, by-design noise; surface genuine warnings.** Backend
error-path tests deliberately trigger dev logging — that's noise, safe to quiet.
Frontend `act()` warnings are genuine signals — keep them visible, never hide.

## Problem (corrected during investigation)

Under the **actual CI command** (`vitest --reporter=json --reporter=default`),
the suites emit a lot: **~50 React `act()` warnings** (frontend) and **~186
intentional log lines** (backend). Under **`make test`** (bare `vitest`), they are
*hidden* — vitest auto-selects a quieter non-TTY default reporter that buffers
console output on passing tests. That asymmetry is **accidental, not a deliberate
hide**: neither `vitest.config.ts` sets a reporter or any console-suppression
option (`silent` / `disableConsoleIntercept` / `onConsoleLog`) — verified, incl.
git history. The effect is that warnings are invisible locally and only bite in
CI.

Goals: (1) quiet the intentional backend noise so output is readable and
*unexpected* errors stand out; (2) make warnings visible **consistently** (local
== CI), the opposite of hiding.

## Why not a baseline / zero-gate (rejected approaches)

Two earlier drafts were killed by review + a spike:

- **Warnings baseline** (`.warnings-baseline.json` + scanner + `warnings:check`):
  `act()` warnings are reporter-dependent, so a site key fine enough to be useful
  is flaky and one coarse enough to be stable hides warnings. No setting is both.
- **Zero-tolerance gate** (burn down to zero, then gate at zero): a spike proved
  the frontend `act()` warnings are **not cheaply fixable** — so "reach zero" does
  not hold. See "Frontend act warnings" below. Without zero, the gate has nothing
  to stand on.

## Investigation results (already run — evidence, not hypotheses)

- **Reporter is the variable.** Frontend `ThemeApply.test.tsx`: bare `vitest` → 0
  `act` warnings; explicit `--reporter=default` → 5; `--reporter=dot` → 5; full
  suite bare → 0, CI command → 50. Backend full suite: bare → 0 intentional
  lines; `--reporter=default` → ~186.
- **Frontend `act` fixes that DON'T work** (so true-zero is hard): a QueryClient
  with `staleTime: Infinity` + `retry: false` → still 5 (ThemeApply); a global
  `afterEach` flush inside `act()` → still 5 / 50. Root cause is TanStack Query's
  post-mount observer notify landing just after mount, outside React's `act`
  batch. Eliminating it needs per-test `await act(async () => render(...))` or
  per-component refactors of uncertain efficacy (bd-10m already records the
  standard patterns "didn't change the count").
- **Part A + reporter-consistency validated together (backend, 3-way):**
  bare `vitest` → 0; config `reporters: ['default']` → 6 `[venice.error.dev]`;
  `reporters: ['default']` + `onConsoleLog` filter → 0. So console interception
  stays on (onConsoleLog fires), the reporter makes non-suppressed output visible,
  and the filter removes the intentional lines.

## Part A — silence intentional backend logs

Two emit paths need two mechanisms (a review caught that `onConsoleLog` only sees
in-worker `console.*`, not subprocess output).

### A1 — in-worker `console.*` → vitest `onConsoleLog`

- **New module `backend/tests/intentional-logs.ts`** — single source of truth:
  `INTENTIONAL_LOG_PATTERNS: RegExp[]` and `isIntentionalLog(line: string): boolean`.
  Census of patterns that actually fire (full backend run, counts for scale):
  - `/^\[venice\.params\]/` (105) — `logVeniceParams`, chat/chapters routes
  - `/^\[venice\.models\]/` (23) — `venice.models.service`
  - `/^\[venice\.error\]/` (20) — `venice-errors.ts:225`
  - `/^\[venice\.error\.dev\]/` (10) — `logVeniceErrorDev`
  - `/^\[chapter\.repo\]/` (incl. `summary_parse_failed`, ~6)
  - `/^\[V15\] Failed to persist assistant message/` (1)
  - `/^\[error-handler\.dev\]/` — added by the prod tweak below (was the raw
    `Error: boom|dev|something|kaboom` stacks from the global handler, ~8)

  **Proving completeness (methodology):** confirming the *listed* patterns fire
  does not prove no *unlisted* noise exists. The implementer runs the full backend
  suite under `reporters: ['default']`, captures **all** emitted lines, applies the
  filter, and inspects the **residual** (non-suppressed) set — it must contain
  only genuine/unexpected output. Build the census from the residual, not by
  transcribing this doc.
  **Known-and-deliberately-left-unsuppressed** (do not add — a future reader
  shouldn't "discover" them and assume the census is buggy): `[X32]`
  (`venice-key.service.ts`), `[boot]` (`env-validation.ts`), `[session-store]`
  (`session-store.ts`). The first two only fire under tests that install their own
  `vi.spyOn(console,…)` (so `onConsoleLog` never sees them, like E12); the third
  only logs on a rare non-expired eviction no test provokes. All print as genuine
  output if they ever leak — consistent with the guiding principle.
- **Param naming / flags:** the `onConsoleLog` arg is a full (possibly multi-line)
  block, so name it `log`, not `line`. `onConsoleLog` is called once per
  `console.*` call; the multi-line `[venice.error.dev] { … }` / `[venice.params]`
  payloads arrive as one string starting with the prefix, so an anchored
  `/^\[…\]/` (no `m`/`g` flag) drops the **whole block**. Keep patterns free of
  `m`/`g`.
- **`backend/vitest.config.ts`** — add inside `test:`:
  ```ts
  onConsoleLog(log: string): boolean | void {
    if (isIntentionalLog(log)) return false; // false ⇒ suppress
  }
  ```
  Unmatched lines still print, so unexpected errors stay visible.
- **One-line production tweak** `src/index.ts:194`:
  `console.error(err)` → `console.error('[error-handler.dev]', err)`. The handler
  otherwise emits `Error: <message>` whose message varies per test (fragile to
  match); a stable prefix makes it matchable and makes real dev logs more legible.
  `security-reviewer` surface → reviewed at close. Verified no test asserts on the
  handler's console format (only `res.body` and no-leak substring checks exist).

### A2 — subprocess banners → buffer the migrate output

`Applying migration …` (×17) + `Loaded Prisma config` / `Prisma schema loaded`
(×4) come from `execSync(syncCmd, { stdio: 'inherit' })` in
`backend/tests/globalSetup.ts:33`, which writes straight to the terminal fd —
`onConsoleLog` cannot see them. Capture and reprint **only on failure**:
```ts
try {
  execSync(syncCmd, { stdio: 'pipe', encoding: 'utf8' });
} catch (e) {
  const x = e as { stdout?: string; stderr?: string };
  process.stderr.write(x.stdout ?? ''); process.stderr.write(x.stderr ?? '');
  throw e;
}
```
(`migrate deploy` is fast; losing live progress is acceptable, failures reprint.
`execSync` pipe defaults to a 1 MB `maxBuffer` — migrate output is tiny, fine.)

**Sibling reset call (decided, not deferred):** `globalSetup.ts:21` runs
`execSync('bash <db-test-reset.sh>', { stdio:'inherit' })` behind a `!inCI` guard
(local-only). Since `make test` is exactly the local path we're cleaning, give it
the **same pipe + reprint-on-failure** treatment. This call legitimately fails
when the docker stack is down, so the reprint-on-failure branch is **required** —
the developer must still see the docker error, not a bare non-zero exit.

### E12 / AU13 safety (verified, unchanged)

`backend/tests/security/byok-leak.test.ts` installs its own per-test
`vi.spyOn(console, …).mockImplementation(capture)`, so vitest's interceptor — and
thus `onConsoleLog` — never sees those lines, and the test reads its own
`logCalls`. The logger still fires (`venice-errors.ts:357` only early-returns
under production). `onConsoleLog` governs display only, never the spy. No change.

## Reporter consistency

- **Add `reporters: ['default']` to BOTH `frontend/vitest.config.ts` and
  `backend/vitest.config.ts`.** This forces the full default reporter (which
  prints console output) for every invocation, so `make test` surfaces the same
  warnings CI does. CI's explicit `--reporter` CLI flags still override the config
  value, so CI behavior is unchanged.
- **Intended consequence:** `make test` will now show the ~50 frontend `act`
  warnings that were previously hidden locally. That is the point — visibility
  over hiding; we accept those warnings as known (below).

## Frontend `act()` warnings — accepted as known (story-editor-10m stays open)

Not cheaply fixable (see Investigation). They are genuine but low-severity
(post-mount async settle in tests; all 1099 tests pass). We **do not hide them**.
bd-10m remains open as the eventual real fix (per-test `render-in-act` helper +
SelectionBubble refactor); its notes get updated with the spike findings.

## Testing

- **`isIntentionalLog()` unit test** — each census pattern matches; a normal
  unexpected error line does not (guards against over-broad regexes).
- **A2** — existing globalSetup behavior covers it (migration still runs; the
  failure path reprints captured output).
- **No new gate, scanner, or baseline file.**

## bd mapping

- **story-editor-cgg** — repurpose to **Part A (A1+A2+prod tweak) + reporter
  consistency**. Original baseline/scanner/scripts scope is dropped; rewrite the
  description.
- **story-editor-21b** — **close as superseded** (the zero-gate it would wire is
  off the table). Requires the close path / user ack since there's no code to
  verify.
- **story-editor-10m** — stays open; update notes with the spike result
  (staleTime + afterEach-flush ineffective; reporter-artifact context; visible in
  CI under json+default).

## Decisions made (not asked)

1. Suppress the full intentional census incl. `[venice.params]` (the largest at
   105) — pure dev-debug logging, safe to quiet in tests.
2. `reporters: ['default']` lives in config (not a per-command flag) so all
   invocations — `make test`, bare `npx`, CI — are consistent.
3. Frontend `act` warnings are surfaced, not suppressed — the guiding principle
   distinguishes by-design noise (quiet) from genuine warnings (show).
