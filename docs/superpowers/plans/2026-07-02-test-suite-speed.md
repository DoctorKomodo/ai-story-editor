# Backend Test-Suite Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**bd issue:** `story-editor-k5o` · **Assessment ref:** item 12 of `docs/superpowers/specs/2026-07-02-quality-assessment.md`

**Goal:** Cut backend test wall-clock substantially without weakening any production security parameter or deleting/skipping any test. The suite is a per-PR, per-`/bd-close-reviewed`, per-reviewer-loop tax — it is paid many times per task.

**Measured baseline (2026-07-02, this container, `CI=true npm -w story-editor-backend run test`):** 108 files / 1091 tests, **2m08s wall** (72.5s in-test, 17.3s import, 6.8s setup, remainder serial file-boot overhead). Time is spread across the route-test tail (top file `tests/routes/chat.test.ts` at 6.6s; ~40 files over 500ms) — consistent with the diagnosis: every `registerAndLogin` pays 4–5 production-cost argon2id derivations (OWASP 19 MiB / t=2: register = password hash + password-wrap KDF + recovery-wrap KDF; login = verify + unwrap KDF), and `registerAndLogin` variants exist in **38 files**, table-wipe blocks in **58 files**, all forced serial by `maxWorkers: 1`.

**Architecture:** Three tasks, strictly ordered, with a **measure-and-decide gate before Task 3**. Task 1 (test-only argon2 params) is expected to be most of the win at the least risk. Task 2 (shared helpers) kills the copy-paste drift and is a precondition for Task 3. Task 3 (per-worker databases → parallelism) is the structural fix but the most invasive; it only runs if the post-Task-2 measurement still justifies it.

**Tech Stack:** vitest 3 config, node-argon2, Prisma/Postgres (template databases), existing `backend/tests/helpers/` dir (currently `makeUser.ts`).

## Global Constraints

- **Production argon2 parameters are untouchable.** `ARGON2_PARAMS` at OWASP baseline (19_456 KiB / t=2 / p=1 / argon2id) must remain byte-identical for every non-test execution path. This plan changes *which* params tests use, never what production uses.
- **The override must be structurally impossible in production**, not just discouraged: double-gated on `NODE_ENV === 'test'` AND an explicit `TEST_FAST_ARGON2=1` opt-in that lives only in `.env.test` / CI test env; additionally `backend/src/boot/env-validation.ts` must **hard-fail boot** if `TEST_FAST_ARGON2` is set while `NODE_ENV === 'production'` (and warn on any other non-test NODE_ENV).
- This touches the auth/crypto surface (`argon2.config.ts`, boot validation) → `security-reviewer` is in-lane and will be dispatched by `/bd-close-reviewed`. Do not route around it.
- The absolute logging rules hold in tests: no plaintext passwords/recovery codes/DEKs in any new helper's logs or error messages.
- No test is skipped, deleted, or weakened in assertion strength. The E12 leak test keeps passing throughout.
- One dedicated test keeps the **real** OWASP parameters covered (hash + verify + wrap/unwrap round-trip at production cost) so a node-argon2 major bump or params typo can't hide behind the fast path.
- `TEST_FAST_ARGON2` is documented in `.env.test.example` (its only legitimate home); add a pointer comment in `.env.example` explaining it is test-only and must never appear in `.env`.
- Commit format `[story-editor-k5o] …`; one commit per numbered task; re-measure and record timing in each commit message.
- Verify (whole plan): `CI=true npm -w story-editor-backend run test` green, plus the boot-guard test below, plus recorded before/after timings in the plan-completion note on the bd issue.

---

### Task 1: Test-only argon2 parameters (double-gated)

**Files:** modify `backend/src/services/argon2.config.ts`, `backend/src/boot/env-validation.ts`, `backend/.env.test.example` + `.env.test` wiring (`tests/globalSetup.ts` or vitest `env`), `.env.example` (pointer comment only); add `backend/tests/services/argon2.config.test.ts`.

- [ ] **Step 1: parameterize `argon2.config.ts`.** Export `ARGON2_PARAMS` chosen at module load: if `process.env.NODE_ENV === 'test' && process.env.TEST_FAST_ARGON2 === '1'` → fast params (target: `memoryCost` 8_192 KiB, `timeCost` at node-argon2's accepted floor — confirm the library's minimum at implementation time, do not guess; keep `type: argon2id`, `parallelism: 1` so hash strings stay format-compatible); otherwise the frozen OWASP baseline, unchanged. Keep both param objects as named exports (`ARGON2_PARAMS_PRODUCTION`, `ARGON2_PARAMS_TEST`) so tests can reference each explicitly.
- [ ] **Step 2: boot guard.** In `env-validation.ts`: `TEST_FAST_ARGON2` present + `NODE_ENV === 'production'` → throw (boot refuses); present + any other non-`test` NODE_ENV → loud warn. Add to the validator's test file.
- [ ] **Step 3: wire the opt-in.** Set `TEST_FAST_ARGON2=1` via `.env.test` (and `.env.test.example` with a comment: what it does, why it's safe, why it must never be in `.env`). Confirm the CI workflow's test env picks it up the same way local runs do.
- [ ] **Step 4: real-params coverage test.** New `argon2.config.test.ts`: (a) asserts `ARGON2_PARAMS_PRODUCTION` equals the OWASP baseline literally; (b) one full register-shaped round-trip (hash → verify, wrap-derive → unwrap) **using the production params explicitly** — this is the only test allowed to be slow; (c) asserts the fast path is active in the suite (guards against the opt-in silently falling out of `.env.test`, which would look like "tests got slow again" instead of failing).
- [ ] **Step 5: measure.** Full suite timed run; record wall-clock delta in the commit message.

**Verify:** `CI=true npm -w story-editor-backend run test` green; `grep -n "memoryCost: 19_456" backend/src/services/argon2.config.ts` still hits; boot-guard test green.

### Task 2: Canonical `registerAndLogin` + table-wipe helpers

**Files:** add `backend/tests/helpers/auth.ts` and `backend/tests/helpers/db.ts` (or extend `makeUser.ts` — implementer judgment, one canonical home each); modify the 38 / 58 consuming test files mechanically.

- [ ] **Step 1: survey the variants.** Enumerate every `registerAndLogin` signature and every wipe-block shape currently in the tree (`grep -rn "registerAndLogin" backend/tests`, wipe blocks via `deleteMany|TRUNCATE`). Pick the superset signature (options object with defaults) and the canonical wipe order (FK-safe).
- [ ] **Step 2: implement helpers** with the superset signature; JSDoc states the contract (fresh user per call, returns agent/cookie/user, never reuses usernames across tests).
- [ ] **Step 3: migrate consumers** file-by-file, assertion-neutral (the diff in each test file should be import + call-site only). Batch commits are fine (e.g. 10–15 files per commit) as long as the suite is green at each commit.
- [ ] **Step 4: guard against regression.** Add a lint-style check or a grep in the close-gate verify ensuring no *local* `function registerAndLogin` re-definitions remain under `backend/tests/` outside the helper.

**Verify:** `CI=true npm -w story-editor-backend run test` green; `grep -rln "function registerAndLogin" backend/tests | grep -v helpers` → empty.

### ⛔ Measure-and-decide gate before Task 3

Record the post-Task-2 wall-clock. **If the full backend suite is ≤ ~45s wall locally, STOP here:** document `maxWorkers: 1` as load-bearing (comment in `vitest.config.ts` explaining the shared-DB constraint and pointing at this plan), note the decision + timings on `story-editor-k5o`, and file Task 3 as a separate follow-up issue instead of implementing it. Otherwise proceed.

### Task 3 (conditional): Per-worker template databases → parallelism

**Files:** modify `backend/tests/globalSetup.ts`, `backend/tests/setup.ts`, `backend/vitest.config.ts`, the `db:test:reset` script if needed; helpers from Task 2 are the only place wipe/connection logic lives, so the fan-out is contained.

- [ ] **Step 1: template DB.** `globalSetup` migrates one template database (current behavior), then each worker clones it: `CREATE DATABASE storyeditor_test_w${VITEST_POOL_ID} TEMPLATE storyeditor_test` (drop-if-exists first). Workers get their own `DATABASE_URL` before any Prisma client is constructed (per-worker setup file, keyed on `VITEST_POOL_ID`).
- [ ] **Step 2: unlock parallelism.** Remove `maxWorkers: 1`; keep `sequence.concurrent: false` (tests within a file stay serial — per-file DB assumptions hold). Start with a conservative worker cap (e.g. 4) and measure.
- [ ] **Step 3: CI parity.** Confirm the CI Postgres service allows multiple databases (it does — same server) and that `db:test:reset` semantics still make sense (it now resets the template).
- [ ] **Step 4: document.** `vitest.config.ts` comment explains the per-worker scheme; `docs/agent-rules/backend.md` testing section gets one paragraph so future implementers don't hand-serialize again.
- [ ] **Step 5: flush-out run.** Three consecutive full-suite runs green (worker-isolation flakes show up as cross-run nondeterminism, not single-run failures). Record final timing.

**Verify:** `CI=true npm -w story-editor-backend run test` green ×3 consecutively; final wall-clock recorded on the bd issue.

---

## Explicit non-goals

- No change to frontend or shared test suites (frontend is already parallel jsdom).
- No change to what any test asserts; no mocking argon2 (tests still exercise the real KDF, just cheaper params).
- No swappable session-store work, no Docker changes, no CI topology changes beyond env plumbing.
- The `tests/live/**` opt-in suite is untouched.
