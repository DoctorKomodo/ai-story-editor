# I7 — BYOK env swap (`VENICE_API_KEY` out, `APP_ENCRYPTION_KEY` in)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the env-var swap that the project has been mid-migration on. Remove the legacy `VENICE_API_KEY` line from `.env.example` (the BYOK model means there is no server-wide key). Confirm `APP_ENCRYPTION_KEY` is documented with a generation one-liner. The boot-time validator already exists; this task is the doc-side cleanup plus a verify-script path correction.

**Architecture:** Mostly text edits. The boot validator (`backend/src/boot/env-validation.ts`) already throws on missing/wrong-length `APP_ENCRYPTION_KEY`. The encryption-keys boot test (`backend/tests/boot/encryption-keys.test.ts`) already covers the throw. Two small drift items to fix: the `.env.example` still carries `VENICE_API_KEY=…`, and the `[I7]` verify command in `TASKS.md` references the wrong filename (`encryption-key.test.ts`, singular).

**Tech Stack:** None new.

**Prerequisites:** None for the doc edit. `[I6]` either ships with the corrected verify (per `[I6]` Task 5), or `[I7]` lands first and `[I6]` adopts the new content cleanly.

**Out of scope:**
- Boot-validator code — already shipped (`validateEncryptionEnv`).
- Test code — already shipped (`tests/boot/encryption-keys.test.ts`).
- Any narrative-content rekeying — content DEKs are user-credential-derived, not affected by `APP_ENCRYPTION_KEY`.

---

### Task 1: Remove `VENICE_API_KEY` from `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Delete the legacy block**

Find these three lines (currently `.env.example:20-22`):

```
# Venice.ai API key. Backend only — never expose to the frontend build.
VENICE_API_KEY=your-venice-api-key-here

```

Delete all three (the comment, the assignment, and the blank line that follows).

- [ ] **Step 2: Confirm `APP_ENCRYPTION_KEY` block is intact**

`.env.example` should still contain (around lines 13–18):

```
# AES-256-GCM key that wraps stored BYOK Venice API keys. Must decode from
# base64 to exactly 32 bytes. Generate with:
#   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# Losing this key loses stored Venice keys (users must re-enter once); it does
# NOT render narrative content unrecoverable — content DEKs are derived from
# user credentials (see docs/encryption.md).
APP_ENCRYPTION_KEY=change-me-to-a-base64-encoded-32-byte-key
```

No edit needed there — it already says exactly what `[I7]` requires.

- [ ] **Step 3: Confirm the file**

```bash
grep -n "VENICE_API_KEY" .env.example
echo "---"
grep -n "APP_ENCRYPTION_KEY" .env.example
```

Expected: first grep prints nothing; second grep prints two lines (one comment, one assignment).

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "[I7] remove VENICE_API_KEY from .env.example (BYOK supersedes)"
```

---

### Task 2: Sweep the rest of the repo for stragglers

**Files:**
- Audit only — no code edits expected unless a hit shows up.

- [ ] **Step 1: Look for any other `VENICE_API_KEY` references**

```bash
grep -rn "VENICE_API_KEY" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .
```

Expected matches (allowed, do **not** delete):

- `CLAUDE.md` — names the var as part of the past-tense migration narrative ("`VENICE_API_KEY` removed in `[I7]`").
- `TASKS.md` — `[I7]`'s own task body and any retrospective references.
- `docs/superpowers/plans/I7-*` — this plan.
- Old planning notes under `docs/` referring to the historical name.

Unexpected matches (must be removed in this task):

- Any live code path (`backend/src/**`, `frontend/src/**`).
- `SELF_HOSTING.md` body copy that asks operators to set the var.
- `Makefile`, `docker-compose*.yml`, scripts under `scripts/` that read from it.

If any unexpected match exists, fix it in this task — see Step 2.

- [ ] **Step 2: If a live-code reference is found, remove it**

Example (hypothetical): if `backend/src/services/ai.service.ts` reads `process.env.VENICE_API_KEY`, replace with the per-user key path (`getVeniceClient(userId)` from `[V17]`). If a script reads it, drop the script's reliance.

If Step 1 returned only the four allowed sources, skip this step.

- [ ] **Step 3: Commit any sweep changes**

```bash
git add -A
git commit -m "[I7] purge stale VENICE_API_KEY references"
```

---

### Task 3: Confirm the boot validator + test still pass

**Files:** none (smoke).

- [ ] **Step 1: Run the boot test**

```bash
cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 2: Boot the backend with no `APP_ENCRYPTION_KEY` to confirm fail-fast**

```bash
cd backend && APP_ENCRYPTION_KEY= npm run dev 2>&1 | head -20
```

Expected: process exits with `BootValidationError: APP_ENCRYPTION_KEY is not set...` followed by the generation one-liner. Kill the process if it's still running (`Ctrl-C`).

---

### Task 4: Fix the `[I7]` verify path typo in `TASKS.md`

`TASKS.md`'s `[I7]` verify references `tests/boot/encryption-key.test.ts` (singular) but the actual file is `encryption-keys.test.ts` (plural). The verify currently fails on a missing test file, not on the assertion.

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Replace the verify line**

Find:

```
  - verify: `grep -q "APP_ENCRYPTION_KEY" .env.example && ! grep -q "VENICE_API_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-key.test.ts`
```

Replace with:

```
  - verify: `grep -q "APP_ENCRYPTION_KEY" .env.example && ! grep -q "VENICE_API_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts`
```

(Only the file name changes: `encryption-key` → `encryption-keys`.)

- [ ] **Step 2: Commit**

```bash
git add TASKS.md
git commit -m "[I7] fix verify path — encryption-keys.test.ts is plural"
```

---

### Task 5: Run the corrected verify

- [ ] **Step 1: Run via `/task-verify I7`** and only tick on exit 0.

```bash
# Equivalent direct invocation:
grep -q "APP_ENCRYPTION_KEY" .env.example \
  && ! grep -q "VENICE_API_KEY" .env.example \
  && (cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts)
```

Expected: exit 0.

- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I7] tick — BYOK env swap complete"
```

---

### Task 6: `security-reviewer` gate

CLAUDE.md flags `[I7]` as needing a `security-reviewer` pass.

- [ ] **Step 1: Invoke**

```
Agent(
  description: "Review I7 BYOK env swap",
  subagent_type: "security-reviewer",
  prompt: "Review [I7] as currently implemented. Scope: .env.example, backend/src/boot/env-validation.ts, backend/tests/boot/encryption-keys.test.ts, backend/src/index.ts (boot wiring). Confirm: (1) no VENICE_API_KEY references remain in any live code path or in .env.example; (2) APP_ENCRYPTION_KEY is the only encryption env required for boot; (3) the validator's error message includes a generation one-liner that does not leak any actual key material; (4) the boot validator is invoked before any module that touches encryption (search for the import order); (5) the boot validator does not log the raw env value on failure."
)
```

- [ ] **Step 2: Resolve any `BLOCK` / `FIX_BEFORE_MERGE` findings** before ticking.

---

## Self-Review Notes

- **Boot validator is already wired.** Confirmed in `backend/tests/boot/encryption-keys.test.ts` — covers missing, empty, wrong-length, and the friendly error message including the generation hint. No new test needed.
- **`SELF_HOSTING.md` copy** about operator key handling lives in `[I6]`. `[I7]` does not edit `SELF_HOSTING.md`.
- **Verify-command typo** — fixing it inside `[I7]` rather than in a separate cleanup means a fresh contributor running `/task-verify I7` after a clean clone gets a green run, not a confusing missing-file error.
- **No data migration.** Per CLAUDE.md, pre-deployment there are no users with stored Venice keys under the old scheme; nothing to rewrap.
- **`CONTENT_ENCRYPTION_KEY` already absent** — the validator warns if it's accidentally set; no further action needed.
