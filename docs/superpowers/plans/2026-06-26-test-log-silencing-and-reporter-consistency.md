# Test-Log Silencing + Reporter Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence the ~186 lines of intentional backend test-log noise and make the test reporter consistent between `make test` and CI, without hiding genuine warnings.

**Architecture:** A test-only `onConsoleLog` filter (backend `vitest.config.ts`) drops by-design dev logs by prefix, sourced from one `intentional-logs.ts` module; the two migrate/reset subprocesses in `globalSetup.ts` are switched from `stdio:'inherit'` to captured-and-reprint-on-failure (`onConsoleLog` can't see subprocess output); `reporters: ['default']` is added to both `vitest.config.ts` files so every invocation prints console output the way CI does. Frontend React `act()` warnings are deliberately left visible.

**Tech Stack:** Vitest 4.x (`onConsoleLog`, `reporters`), Node `child_process.execSync`, Express global error handler, TypeScript strict.

## Global Constraints

- **Guiding principle:** suppress intentional/by-design noise; surface genuine warnings. Never hide React `act()` warnings.
- **E12/AU13 leak test stays meaningful** — do NOT gate the logging off (`logVeniceErrorDev` must keep firing under `NODE_ENV=test`). Suppression is display-only via `onConsoleLog`. `tests/security/byok-leak.test.ts` uses its own `console` spies and is unaffected.
- **`onConsoleLog` patterns:** anchored `/^\[…\]/`, **no `m` or `g` flag**; the callback arg is a full (possibly multi-line) block — name it `log`.
- **Leave unsuppressed (do NOT add to the census):** `[X32]` (`venice-key.service.ts`), `[boot]` (`env-validation.ts`), `[session-store]` (`session-store.ts`). They are spied-over or rare; if they ever leak they should print as genuine output.
- **CI is unaffected:** CI passes `--reporter=json --reporter=default` on the CLI, which overrides the config `reporters` field. Do not remove the CLI flags from `.github/workflows/ci.yml`.
- **TypeScript strict, no `any`.**
- **Backend tests require the docker-compose stack UP** (`make dev`) — `backend/tests/globalSetup.ts` resets/migrates the test DB against the compose Postgres on every vitest invocation. Bring the stack up before any backend verify step.
- **Commit message format:** `[story-editor-cgg] <description>`.

---

### Task 1: Reporter consistency (both vitest configs)

**Files:**
- Modify: `frontend/vitest.config.ts` (the `test:` block, after `passWithNoTests: false,`)
- Modify: `backend/vitest.config.ts` (the `test:` block, after `passWithNoTests: false,`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable; behavioral change only — bare `vitest` now prints console output (matching CI).

- [ ] **Step 1: Observe the current local hiding (baseline)**

Run: `cd frontend && npx vitest run tests/components/ThemeApply.test.tsx 2>&1 | grep -c "not wrapped in act"`
Expected: `0` (bare vitest auto-selects a quiet non-TTY reporter that buffers console-on-success).

- [ ] **Step 2: Add `reporters: ['default']` to the frontend config**

In `frontend/vitest.config.ts`, inside `test: { … }`, add the line immediately after `passWithNoTests: false,`:

```ts
    passWithNoTests: false,
    // Force the full default reporter so console output (incl. React act
    // warnings) prints on every invocation — `make test` then shows what CI
    // shows. CI's CLI `--reporter` flags still override this.
    reporters: ['default'],
```

- [ ] **Step 3: Verify the frontend warnings are now visible**

Run: `cd frontend && npx vitest run tests/components/ThemeApply.test.tsx 2>&1 | grep -c "not wrapped in act"`
Expected: a **nonzero** count (e.g. `5`) — the previously hidden act warnings now print. The exact number is reporter/React/TanStack-version-dependent; the requirement is "0 → nonzero", not a specific value.

- [ ] **Step 4: Add `reporters: ['default']` to the backend config**

In `backend/vitest.config.ts`, inside `test: { … }`, add the same line immediately after `passWithNoTests: false,`:

```ts
    passWithNoTests: false,
    // Force the full default reporter so console output prints on every
    // invocation — `make test` then shows what CI shows. CI's CLI `--reporter`
    // flags still override this.
    reporters: ['default'],
```

- [ ] **Step 5: Verify the backend noise is now visible (stack must be up)**

Run: `npm -w story-editor-backend run test -- tests/ai/error-handling.test.ts 2>&1 | grep -c "venice.error.dev"`
Expected: a number `> 0` (e.g. `6`). This is the intermediate, still-noisy state — Task 3 filters it.

- [ ] **Step 6: Commit**

```bash
git add frontend/vitest.config.ts backend/vitest.config.ts
git commit -m "[story-editor-cgg] force reporters:['default'] so make test surfaces console like CI"
```

---

### Task 2: Stable prefix on the global error handler's dev log

**Files:**
- Modify: `backend/src/index.ts:194` (inside `globalErrorHandler`, the `if (!isProd)` block)
- Modify: `backend/tests/middleware/error-handler.test.ts` (add a console-contract test)

**Interfaces:**
- Consumes: nothing.
- Produces: the global handler's dev log now emits `console.error('[error-handler.dev]', err)` — Task 3's census relies on the `[error-handler.dev]` prefix existing.

> **Note:** This is `security-reviewer` surface. The handler currently logs the raw `err`, producing `Error: <message>` lines whose message varies per test (`boom`, `dev-visible-message`, `kaboom`, …) — unmatchable by a stable prefix. Tagging makes it suppressible and makes real dev logs legible. It is the ONLY raw `console.error(err)` in backend src (all other sites carry string prefixes), so it is the single funnel for unhandled route errors.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/middleware/error-handler.test.ts`, inside the `describe('globalErrorHandler [B7]', …)` block (the file already imports `vi` is NOT present — add it to the vitest import on line 3: change to `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`). Then add:

```ts
  it("dev mode tags the handler's console log with a stable [error-handler.dev] prefix", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(makeApp(new Error('boom-message'))).get('/boom');
    } finally {
      spy.mockRestore();
    }
    expect(spy).toHaveBeenCalledWith('[error-handler.dev]', expect.any(Error));
  });

  it('production mode does not log the error to the console at all', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(makeApp(new Error('boom-message'))).get('/boom');
    } finally {
      spy.mockRestore();
      process.env.NODE_ENV = original;
    }
    expect(spy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails** (stack up)

Run: `npm -w story-editor-backend run test -- tests/middleware/error-handler.test.ts -t "stable \[error-handler.dev\] prefix"`
Expected: FAIL — `console.error` was called with `(Error)` not `('[error-handler.dev]', Error)`.

- [ ] **Step 3: Apply the one-line production tweak**

In `backend/src/index.ts`, change line 194 from:

```ts
  if (!isProd) {
    console.error(err);
  }
```

to:

```ts
  if (!isProd) {
    console.error('[error-handler.dev]', err);
  }
```

- [ ] **Step 4: Run the new tests to verify they pass** (stack up)

Run: `npm -w story-editor-backend run test -- tests/middleware/error-handler.test.ts`
Expected: PASS (all cases, including the two new ones).

- [ ] **Step 5: Run the sibling handler suite for regressions** (stack up)

Run: `npm -w story-editor-backend run test -- tests/routes/error-handler.test.ts tests/middleware/error-handler.venice.test.ts`
Expected: PASS (these assert only on `res.body`, never console format).

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts backend/tests/middleware/error-handler.test.ts
git commit -m "[story-editor-cgg] tag global error-handler dev log with [error-handler.dev] prefix"
```

---

### Task 3: `intentional-logs` module + `onConsoleLog` filter

**Files:**
- Create: `backend/tests/intentional-logs.ts`
- Create: `backend/tests/intentional-logs.test.ts`
- Modify: `backend/vitest.config.ts` (add `onConsoleLog` inside `test:`)

**Interfaces:**
- Consumes: the `[error-handler.dev]` prefix from Task 2; `reporters: ['default']` from Task 1 (so the noise is visible to census).
- Produces: `INTENTIONAL_LOG_PATTERNS: RegExp[]` and `isIntentionalLog(log: string): boolean` from `backend/tests/intentional-logs.ts`.

- [ ] **Step 1: Regenerate the census from a real residual run (do not transcribe)**

Run (stack up): `npm -w story-editor-backend run test 2>&1 | grep -aoE "^\[[a-zA-Z0-9._-]+\]|^Error: [a-zA-Z]+" | sort | uniq -c | sort -rn`
Read the output. The intentional prefixes that fire are expected to be: `[venice.params]`, `[venice.models]`, `[venice.error]`, `[venice.error.dev]`, `[chapter.repo]`, `[V15]`, `[error-handler.dev]`. Emit sites for reference: `venice-call.service.ts:158`, `venice.models.service.ts:99`, `venice-errors.ts` (`[venice.error]` and `[venice.error.dev]`), `chapter.repo.ts:198,426`, `chat.routes.ts:629`, `index.ts:194`. If a NEW prefix appears that is genuinely by-design, add it; if `[X32]`/`[boot]`/`[session-store]` appear, do NOT add them (they should print).

- [ ] **Step 2: Write the failing unit test**

Create `backend/tests/intentional-logs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isIntentionalLog } from './intentional-logs';

describe('isIntentionalLog', () => {
  it.each([
    '[venice.params] {"model":"x"}',
    '[venice.models] model "x" exposes no positive maxCompletionTokens; defaulting',
    '[venice.error] something',
    '[venice.error.dev] {\n  route: "chat"\n}', // multi-line block: matches on first line
    '[chapter.repo] summary_parse_failed for chapter abc',
    '[V15] Failed to persist assistant message',
    '[error-handler.dev] Error: boom\n    at fake (/tmp/x.ts:1:1)',
  ])('suppresses intentional log: %s', (line) => {
    expect(isIntentionalLog(line)).toBe(true);
  });

  it.each([
    '[X32] Venice rate_limits probe failed',
    '[boot] stale APP_ENCRYPTION_KEY detected; ignoring',
    '[session-store] evicted a live session under cap pressure',
    'Error: a genuinely unexpected failure',
    'some other unexpected output',
  ])('does NOT suppress: %s', (line) => {
    expect(isIntentionalLog(line)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the unit test to verify it fails**

Run: `npm -w story-editor-backend run test -- tests/intentional-logs.test.ts`
Expected: FAIL — cannot resolve `./intentional-logs`.

- [ ] **Step 4: Implement the module**

Create `backend/tests/intentional-logs.ts`:

```ts
/**
 * Single source of truth for the by-design dev logs that backend error-path
 * tests deliberately trigger. Used by `onConsoleLog` in vitest.config.ts to
 * keep test output readable WITHOUT disabling the logging itself (the
 * [AU13]/[E12] leak test depends on `logVeniceErrorDev` firing under
 * NODE_ENV=test). Each pattern is anchored at the start of the full console
 * block; vitest passes the entire (possibly multi-line) formatted string to
 * onConsoleLog, so an anchored match suppresses the whole block.
 *
 * Deliberately NOT included (these should print as genuine output if they
 * ever fire): [X32], [boot], [session-store].
 */
export const INTENTIONAL_LOG_PATTERNS: RegExp[] = [
  /^\[venice\.params\]/,
  /^\[venice\.models\]/,
  /^\[venice\.error\]/,
  /^\[venice\.error\.dev\]/,
  /^\[chapter\.repo\]/,
  /^\[V15\] Failed to persist assistant message/,
  /^\[error-handler\.dev\]/,
];

export function isIntentionalLog(log: string): boolean {
  return INTENTIONAL_LOG_PATTERNS.some((re) => re.test(log));
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npm -w story-editor-backend run test -- tests/intentional-logs.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire `onConsoleLog` into the backend config**

In `backend/vitest.config.ts`, add the import at the top (after the existing imports):

```ts
import { isIntentionalLog } from './tests/intentional-logs';
```

Then inside `test: { … }` (e.g. after the `reporters` line from Task 1) add:

```ts
    // Suppress by-design dev logs from error-path tests so output is readable.
    // Returns false ⇒ vitest drops the whole console block. Unmatched lines
    // still print, so unexpected errors stay visible. The logging still RUNS
    // (E12 leak test relies on it); this governs display only.
    onConsoleLog(log: string): boolean | void {
      if (isIntentionalLog(log)) return false;
    },
```

- [ ] **Step 7: Verify the residual is clean**

Run (stack up): `npm -w story-editor-backend run test 2>&1 | grep -cE "\[venice\.params\]|\[venice\.models\]|\[venice\.error\]|\[venice\.error\.dev\]|\[chapter\.repo\]|\[V15\]|\[error-handler\.dev\]"`
Expected: `0`.

Then inspect the residual for anything unexpected:
Run: `npm -w story-editor-backend run test 2>&1 | grep -aoE "^\[[a-zA-Z0-9._-]+\]|^Error: [a-zA-Z]+" | sort -u`
Expected: only `Applying migration`-class / Prisma subprocess lines remain (handled in Task 4) and the deliberately-unsuppressed `[X32]`/`[boot]`/`[session-store]` if they happened to fire. No `venice.*`/`chapter.repo`/`V15`/`error-handler.dev`.

- [ ] **Step 8: Confirm E12 leak test still passes (logging still fires)**

Run: `npm -w story-editor-backend run test -- tests/security/byok-leak.test.ts`
Expected: PASS — its own spies bypass `onConsoleLog`; the logger still runs.

- [ ] **Step 9: Commit**

```bash
git add backend/tests/intentional-logs.ts backend/tests/intentional-logs.test.ts backend/vitest.config.ts
git commit -m "[story-editor-cgg] add intentional-logs filter via onConsoleLog to silence by-design backend test noise"
```

---

### Task 4: Buffer the migrate/reset subprocesses in globalSetup

**Files:**
- Modify: `backend/tests/globalSetup.ts` (the two `execSync` calls at lines 21 and 33)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable; the Prisma/migration subprocess banners no longer stream to the terminal on success, but reprint on failure.

> **Note:** These banners (`Applying migration …` ×17, `Loaded Prisma config`, `Prisma schema loaded`) come from `execSync(..., {stdio:'inherit'})`, which writes straight to the terminal fd — `onConsoleLog` cannot see them. The reset call at line 21 is local-only (`!inCI`) but `make test` is exactly the local path we are cleaning, so it gets the same treatment. Reprint-on-failure is REQUIRED for both: the reset legitimately fails when the docker stack is down, and the developer must still see that error.

- [ ] **Step 1: Observe the banners (baseline, stack up)**

Run: `npm -w story-editor-backend run test 2>&1 | grep -cE "Applying migration|Loaded Prisma config|Prisma schema loaded"`
Expected: a number `> 0` (e.g. `21`).

- [ ] **Step 2: Add a quiet-exec helper and switch both calls**

In `backend/tests/globalSetup.ts`, add this helper after the imports (below line 3):

```ts
/**
 * Run a subprocess quietly: capture stdout+stderr and only surface them if the
 * command fails — so successful test-DB setup doesn't spam the terminal, but a
 * real failure (e.g. docker stack down) is still fully visible.
 */
function runQuiet(cmd: string, opts: Parameters<typeof execSync>[1] = {}): void {
  try {
    execSync(cmd, { ...opts, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    const x = e as { stdout?: string | Buffer; stderr?: string | Buffer };
    if (x.stdout) process.stderr.write(x.stdout.toString());
    if (x.stderr) process.stderr.write(x.stderr.toString());
    throw e;
  }
}
```

Change the reset call (line 21) from:

```ts
    execSync(`bash ${resetScript}`, { stdio: 'inherit' });
```

to:

```ts
    runQuiet(`bash ${resetScript}`);
```

Change the migrate call (lines 33–37) from:

```ts
  execSync(syncCmd, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
```

to:

```ts
  runQuiet(syncCmd, {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
```

- [ ] **Step 3: Verify the banners are gone on success**

Run: `npm -w story-editor-backend run test 2>&1 | grep -cE "Applying migration|Loaded Prisma config|Prisma schema loaded"`
Expected: `0`.

- [ ] **Step 4: Verify failures still reprint**

Run: `TEST_DATABASE_URL='postgresql://bad:bad@localhost:5432/nope' npm -w story-editor-backend run test -- tests/intentional-logs.test.ts 2>&1 | grep -ciE "error|cannot|refused|FATAL"`
Expected: a number `> 0` — the captured subprocess failure is reprinted (not swallowed into a bare non-zero exit). The run will fail overall; that's expected for this check.

- [ ] **Step 5: Confirm a normal run still passes end-to-end**

Run: `npm -w story-editor-backend run test`
Expected: all tests PASS; terminal is now free of the Prisma banners and the intentional dev logs.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/globalSetup.ts
git commit -m "[story-editor-cgg] buffer test-DB reset/migrate subprocess output; reprint only on failure"
```

---

## Final verification (whole branch)

- [ ] **Backend output clean (stack up):**
  Run: `npm -w story-editor-backend run test 2>&1 | grep -cE "\[venice\.|\[chapter\.repo\]|\[V15\]|\[error-handler\.dev\]|Applying migration|Loaded Prisma config"`
  Expected: `0`, all tests pass.
- [ ] **Frontend warnings now visible locally (consistency):**
  Run: `cd frontend && npx vitest run tests/components/ThemeApply.test.tsx 2>&1 | grep -c "not wrapped in act"` → **nonzero** (e.g. `5`) — surfaced, not hidden (exact count is version-dependent).
- [ ] **Typecheck:** `npm --prefix backend run typecheck` and `npm --prefix frontend run typecheck` → pass.
- [ ] **E12 leak test:** `npm -w story-editor-backend run test -- tests/security/byok-leak.test.ts` → pass.

**Suggested bd verify line for `story-editor-cgg`** (stack must be healthy first — `docker compose up -d --wait` gates on the Postgres healthcheck so `globalSetup`'s `docker exec` reset doesn't race a cold container):
`verify: docker compose up -d --wait && npm -w story-editor-backend run test 2>&1 | tee /tmp/be.out | grep -E "Tests +[0-9]+ passed" && [ "$(grep -cE '\[venice\.|\[chapter\.repo\]|\[V15\]|\[error-handler\.dev\]|Applying migration' /tmp/be.out)" = "0" ]`

## Out of scope (tracked separately)

- **story-editor-10m** — frontend `act()` warning burn-down. Stays open; not addressed here (surfaced, not hidden). Update its notes with the spike result.
- **story-editor-21b** — close as superseded (the zero-gate it would wire is dropped).
