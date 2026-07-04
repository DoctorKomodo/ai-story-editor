# Documentation Truth Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four clusters of documentation that have drifted from the code. These docs are load-bearing: `/bd-execute` prepends the rule digests to every implementer/reviewer dispatch, `docs/encryption.md` is the design-of-record for the crypto surface ("If a future task disagrees with this document, update this document first"), and `.env.example` is the operator's contract. Every fix below was re-verified against the working tree on 2026-07-02; each task quotes the current wrong text and the replacement.

**Architecture:** Docs-only. Zero behavior change, zero source-code edits. The full touch-set is: `docs/encryption.md`, `CLAUDE.md`, `tests/e2e/README.md`, `playwright.config.ts` (repo root — **comment only**), `.github/workflows/e2e.yml` (**one comment line only**, triggers untouched), `.env.example`, a new `.env.test.example`, and `SELF_HOSTING.md`. Historical archives (`docs/done/**`, existing `docs/superpowers/plans/*.md`, `TASKS.md`) are records of what was true when written — do NOT "fix" them even where they repeat retired claims (e.g. `done-S.md` documenting `VITE_API_URL`, `done-T.md` calling T8 "PR-blocking").

**Tech Stack:** Markdown + env-example files. No test framework applies; the verification discipline is "grep the code to prove the claim, then edit the doc, then grep the doc to prove the fix." Biome (`make lint`) does **not** process `.md` or `.env*` files (it has no Markdown support; verified against `biome.json` — only js/ts/json/css surfaces), so the only automatable gates are the greps below plus `npx biome check playwright.config.ts` for the one `.ts` comment edit.

## Global Constraints

- Docs-only. The two non-`.md` code files touched (`playwright.config.ts`, `.github/workflows/e2e.yml`) get comment-line edits exclusively — no config keys, no trigger changes. `git diff` on those files must show only `//` / `#` comment lines.
- Never include a real secret in `.env.example` / `.env.test.example`. The `storyeditor`/`storyeditor` credentials are the published local-dev compose defaults (`docker-compose.yml:8-10`), not secrets — they are acceptable in examples.
- Honor `docs/encryption.md`'s own conventions: it has a `## Change log` section (lines 356-363, entry format `- **YYYY-MM-DD** — [id] description`) — append an entry; don't silently rewrite history. Where the code is *weaker* than the doc claimed (no rehash-on-login, no checksum, no distinct session-expired UX), the doc must state the gap honestly, not just delete the sentence.
- Do NOT create bd issues, do NOT change workflow triggers (that is `story-editor-7ns`'s job — confirmed as the tracking id by the comment in `.github/workflows/e2e.yml:8-11`; the `bd` CLI is unavailable in this environment).
- Commit message format `[<bd-id>] …` per CLAUDE.md Git Rules; one commit per numbered task.
- Verify (whole plan, from repo root — every clause must pass):
  `! grep -rn "needsRehash" backend/src && ! grep -n "CRC-16" docs/encryption.md && ! grep -n 'silently rewritten' docs/encryption.md && ! grep -n 'sign in again" banner' docs/encryption.md && ! grep -n "VITE_API_URL" .env.example SELF_HOSTING.md && grep -q "VITE_API_BASE_URL" .env.example && grep -q "POSTGRES_USER" .env.example && test -f .env.test.example && ! grep -q "Two specs gate PRs" tests/e2e/README.md && ! grep -q "PR-blocking" playwright.config.ts && ! grep -qE '\| Files \(backend\) \| camelCase' CLAUDE.md && ! grep -qE '\| Test files \| mirror source path' CLAUDE.md && npx biome check playwright.config.ts`

---

### Task 1: `docs/encryption.md` — three claims that no longer match the code

**Verified state of the code (all citations current):**
- `grep -rn needsRehash backend/src` → **zero hits**. The doc's own change log (`docs/encryption.md:360`, 2026-04-24) records the `needsRehash` upgrade path being deleted under [X10]. Yet three body passages still describe rehash-on-login as live behavior: lines 78, 312, 336.
- Recovery code implementation (`backend/src/services/content-crypto.service.ts:66-104`): `RECOVERY_CODE_BYTES = 20` (160 bits), base32 Crockford → 32 chars, `RECOVERY_CODE_GROUPS = 4` × `RECOVERY_CODE_GROUP_LEN = 8`, joined with `-`. **No checksum of any kind.** `normaliseRecoveryCode` (lines 98-104) strips hyphens, whitespace, *and all Unicode control/format chars* (`/[\p{C}\s-]/gu`) then uppercases. The doc (lines 90-94) claims "10 groups of 16 bits" and a "CRC-16" checksum last group.
- `grep -rn session_expired frontend/src` → **zero hits**. Every 401 funnels through the single `onUnauthorized` handler (`frontend/src/lib/api.ts:30-39`, fired at `api.ts:182`) — no code-specific branch, no banner. The doc (line 143) claims the frontend "treats this distinctly (shows a 'please sign in again' banner)".

**Files:**
- Modify: `docs/encryption.md`

- [ ] **Step 1: Re-prove all three claims before editing**

Run and confirm:
```bash
grep -rn needsRehash backend/src            # expect: no output
grep -n "RECOVERY_CODE" backend/src/services/content-crypto.service.ts   # expect: BYTES=20, GROUPS=4, GROUP_LEN=8
grep -rn "checksum\|CRC" backend/src        # expect: no output
grep -rn session_expired frontend/src       # expect: no output
grep -n "onUnauthorized" frontend/src/lib/api.ts   # expect: hits at ~30-39, 182, 213
```

- [ ] **Step 2: Fix the argon2 drift-detection claim (three sites)**

**(a) Line 78** — replace:

> **Drift detection:** on successful login, `argon2.needsRehash(hash, ARGON2_PARAMS)` is evaluated and the password hash is silently rewritten if parameters have moved since the stored hash was produced ([AU14]). This does not touch the DEK wraps — **raising argon2id parameters for wrap-key derivation requires an [AU17]-style rewrap** (rotate-recovery-code path) or a password-change to produce a new wrap at the new parameters. Parameter drift in wrap-key derivation is therefore a deliberate choice, not an automatic operation.

with:

> **Drift handling:** there is **no automatic rehash-on-login**. The `argon2.needsRehash` upgrade path that originally shipped with [AU14] was deleted along with the other speculative legacy branches in [X10] (see change log, 2026-04-24); `grep -r needsRehash backend/src` has zero hits. If argon2id parameters are ever raised, existing password hashes stay at the old parameters until the user next changes their password ([AU15]), and the DEK wraps likewise upgrade only on password change ([AU15]) or recovery-code rotation ([AU17]). **Known gap (accepted):** an account that never changes its password never picks up stronger parameters. If a parameter bump ever ships, reintroducing a login-time rehash for the password hash is a deliberate new task — it would still not rewrap the DEK.

**(b) Line 312** (Trade-offs table row) — replace:

> | **Raising argon2id parameters doesn't retroactively strengthen existing DEK wraps.** | `argon2.needsRehash` rewrites password hashes on next login, but the wrap-key salts are separate and aren't rederived on login. Users who want stronger wrap-key params under new settings must change their password or rotate their recovery code. |

with:

> | **Raising argon2id parameters doesn't retroactively strengthen existing password hashes or DEK wraps.** | There is no rehash-on-login (the `needsRehash` path was removed in [X10]). Hashes and wrap keys upgrade only when the secret is rewritten: password change ([AU15]) or recovery-code rotation ([AU17]). |

**(c) Line 336** (Revisit § 2) — replace:

> If OWASP raises the baseline (or we choose to), update [argon2.config.ts](../backend/src/services/argon2.config.ts). Password hashes upgrade automatically via `needsRehash` on next login. **DEK wraps do not** — users must either change password ([AU15]) or rotate recovery code ([AU17]) to produce a new wrap at the new parameters. Document the drift and surface a "security upgrade available" nudge in Settings if we care enough.

with:

> If OWASP raises the baseline (or we choose to), update [argon2.config.ts](../backend/src/services/argon2.config.ts). **Neither password hashes nor DEK wraps upgrade automatically** — the login-time `needsRehash` path was removed in [X10]. Both upgrade only when the secret is rewritten: password change ([AU15]) or recovery-code rotation ([AU17]). If a parameter bump ever ships, decide then whether to reintroduce a login-time rehash for password hashes (it would still not help the wraps), and surface a "security upgrade available" nudge in Settings if we care enough.

- [ ] **Step 3: Fix the recovery-code format table (lines 90-94)**

Replace the three wrong rows (Entropy / Encoding / Checksum) and tighten the Normalisation row. Current text:

> | Entropy | ≥128 bits (we target 160 bits — 10 groups of 16 bits each) |
> | Encoding | base32 Crockford, grouped `XXXX-XXXX-XXXX-...` for readability. BIP-39-style wordlist is an acceptable alternative; the format choice is documented in the response schema. |
> | Checksum | Last group is a CRC-16 of the preceding bits so typos are caught client-side before hitting the reset endpoint. Not a security property — just UX. |
> | Lifetime | Valid until rotated via [AU17]. No expiry. |
> | Normalisation before use | Uppercase, strip hyphens/whitespace, then argon2id with `contentDekRecoverySalt`. |

Replacement (Lifetime row unchanged):

> | Entropy | 160 bits — 20 random bytes from `crypto.randomBytes` (`RECOVERY_CODE_BYTES = 20` in [content-crypto.service.ts](../backend/src/services/content-crypto.service.ts)) |
> | Encoding | base32 Crockford → 32 chars (160 bits ÷ 5 bits/char), grouped `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` (4 groups × 8 chars; `RECOVERY_CODE_GROUPS = 4`, `RECOVERY_CODE_GROUP_LEN = 8`) |
> | Checksum | **None** — all 32 chars are random payload. A typo surfaces as a failed unwrap (`InvalidRecoveryCodeError`) at the reset endpoint, not client-side. The original design sketched a CRC-16 last group; it was never implemented, and 160 bits already exceeds the ≥128-bit floor without reserving payload for a check digit. |
> | Lifetime | Valid until rotated via [AU17]. No expiry. |
> | Normalisation before use | Uppercase; strip hyphens, whitespace, and all Unicode control/format characters (`/[\p{C}\s-]/gu` — clipboard and mobile keyboards inject zero-width chars), then argon2id with `contentDekRecoverySalt`. |

> Note for implementer: the entropy arithmetic is exact — 20 bytes × 8 = 160 bits; 160 / 5 bits per Crockford char = 32 chars; 32 / 4 groups = 8 chars per group. Do not write "≥128 bits" as the headline figure; state 160 and mention 128 only as the floor it exceeds.

- [ ] **Step 4: Fix the `session_expired` frontend claim (line 143)**

Replace (mechanism list item 5):

> 5. If the cookie is present but no live session matches (process restarted, evicted, expired, or revoked): 401 with `{ error: { code: 'session_expired', message: 'Session expired' } }`. The frontend treats this distinctly (shows a "please sign in again" banner) and redirects to `/login`.

with:

> 5. If the cookie is present but no live session matches (process restarted, evicted, expired, or revoked): 401 with `{ error: { code: 'session_expired', message: 'Session expired' } }`. The frontend does **not** currently distinguish this code from a plain `unauthorized`: every 401 funnels through the single `onUnauthorized` handler in [frontend/src/lib/api.ts](../frontend/src/lib/api.ts) (the session store flips to unauthenticated and routes to `/login`). A distinct "session expired — please sign in again" banner is a known UX gap, not shipped; the server-side code split exists so the frontend *can* adopt it without an API change.

- [ ] **Step 5: Append the change-log entry**

Append to `## Change log` (after the 2026-06-16 entry), matching the existing format:

> - **2026-07-02** — [<bd-id>] Doc truth pass. Removed three stale claims that outlived their code: (1) the `argon2.needsRehash` rehash-on-login description (deleted by [X10] on 2026-04-24 but still described as live in the parameters section, trade-offs table, and Revisit §2) — the doc now states there is no automatic rehash and records the accepted gap; (2) the recovery-code format ("10 groups of 16 bits", CRC-16 checksum group) — corrected to the implemented format: 160 bits, 4×8 Crockford chars, no checksum; (3) the claim that the frontend shows a distinct "please sign in again" banner on `session_expired` — all 401s share one `onUnauthorized` path; noted as a UX gap. No code changed.

- [ ] **Step 6: Verify**

Run: `! grep -n 'silently rewritten' docs/encryption.md && ! grep -n 'CRC-16' docs/encryption.md && ! grep -n '10 groups' docs/encryption.md && ! grep -n 'sign in again" banner' docs/encryption.md && grep -c '2026-07-02' docs/encryption.md`
Expected: first four clauses silent (no hits), last prints `1` (or more).
Note: `grep -c needsRehash docs/encryption.md` will legitimately remain ≥ 3 — the change log and the new "was deleted in [X10]" prose *should* mention it. The gate is that no sentence describes it as current behavior (`silently rewritten` is the sentinel for the old prose).

- [ ] **Step 7: Commit**

```bash
git add docs/encryption.md
git commit -m "[<bd-id>] docs: encryption.md truth pass (no rehash-on-login, real recovery-code format, no session_expired banner)"
```

---

### Task 2: CLAUDE.md naming-conventions table — state the real backend file + test-file conventions

**Verified state of the code:** `ls backend/src/{services,lib,middleware,routes,repos}` shows the dominant convention is **kebab-case multiword stems with dot-separated role suffixes**: `content-crypto.service.ts`, `venice-key.service.ts`, `venice-call.service.ts`, `session-store.ts`, `origin-check.middleware.ts`, `ai-defaults.routes.ts`, `user-settings.routes.ts`, `session-cookie.ts`, `bad-request.ts`, `chapter.repo.ts`. Nothing is camelCase. One stray exception: `venice.models.service.ts` (dots where a hyphen belongs). `backend/tests/` does **not** mirror `src/` paths: it has role dirs that loosely track src (`routes/`, `services/`, `repos/`, `middleware/`, `lib/`) *plus* feature dirs with no src counterpart (`ai/`, `auth/`, `models/`, `security/`, `boot/`), filenames drop the role suffix (`tests/routes/stories.test.ts` ↔ `src/routes/stories.routes.ts`), and facet suffixes are common (`chapter.repo.summary.test.ts`, `chapters-reorder.test.ts`). Frontend tests live under `frontend/tests/{components,lib,store,...}` named for the subject (`AuthForm.test.tsx`).

`grep -rn "camelCase\|auth\.service\.ts\|mirror source" docs/agent-rules/` → **zero hits** — the wrong claim lives only in CLAUDE.md (lines 213 and 222); no digest copies to fix.

**Files:**
- Modify: `CLAUDE.md` (Naming Conventions table, lines 213 and 222)

- [ ] **Step 1: Re-prove the survey**

Run: `ls backend/src/services backend/src/lib backend/src/middleware backend/src/routes backend/src/repos` and `find backend/tests -type f -name "*.test.ts" | sed 's|backend/tests/||' | cut -d/ -f1 | sort -u`
Expected: no camelCase filenames anywhere; test dirs `ai auth boot lib middleware models repos routes security services` plus root-level tests.

- [ ] **Step 2: Fix the backend-files row (line 213)**

Replace:

> | Files (backend) | camelCase | `auth.service.ts` |

with:

> | Files (backend) | kebab-case stem + dot-separated role suffix (`.service.ts`, `.routes.ts`, `.repo.ts`, `.middleware.ts`, `.config.ts`) | `content-crypto.service.ts`, `venice-key.routes.ts`, `chapter.repo.ts`, `origin-check.middleware.ts` |

- [ ] **Step 3: Fix the test-files row (line 222)**

Replace:

> | Test files | mirror source path + `.test.ts` | `tests/routes/stories.test.ts` |

with:

> | Test files | grouped by role or feature dir under `backend/tests/` / `frontend/tests/` (dirs loosely track `src/` but need not — e.g. `tests/ai/`, `tests/auth/`, `tests/models/` have no src counterpart); filename names the subject, drops the src role suffix, and may add a facet | `tests/routes/stories.test.ts` ↔ `src/routes/stories.routes.ts`; `tests/repos/chapter.repo.summary.test.ts` |

- [ ] **Step 4: Add the known-exception footnote**

Directly below the table, add:

> Known stray: `backend/src/services/venice.models.service.ts` uses a dotted stem where the convention wants `venice-models.service.ts`. Leave it — renaming is not worth the churn; don't copy the pattern.

- [ ] **Step 5: Verify**

Run: `! grep -qE '\| Files \(backend\) \| camelCase' CLAUDE.md && ! grep -qE '\| Test files \| mirror source path' CLAUDE.md && grep -q 'origin-check.middleware.ts' CLAUDE.md`
Expected: passes silently. (Note: `auth.service.ts` legitimately still appears elsewhere in CLAUDE.md — the security-reviewer in-lane list at line 242 names the real file `backend/src/services/auth.service.ts`, which exists and is correct; only the *table row* was wrong.)

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "[<bd-id>] docs: fix CLAUDE.md naming table — backend files are kebab-case + role suffix; tests don't mirror src paths"
```

---

### Task 3: E2E docs claim "PR-blocking" but the workflow is manual-only

**Verified state:** `.github/workflows/e2e.yml:13-18` — `on: workflow_dispatch:` with the push/pull_request triggers commented out, and the header comment (lines 8-11) says PR gating is "an open CI-policy decision tracked in story-editor-7ns — do not flip the triggers without resolving that." (The `bd` CLI is unavailable here; the workflow comment is the authoritative confirmation of the issue id.) Against that:
- `tests/e2e/README.md:3` — "Two specs gate PRs (`smoke.spec.ts`, `full-flow.spec.ts`)".
- `playwright.config.ts:3` (**repo root** — note: the config is NOT at `tests/e2e/playwright.config.ts`; the README's line 12 correctly says "at the repo root") — "// Tier-2 PR-blocking E2E."
- `.github/workflows/e2e.yml:9-10` — the comment says "done-T.md and playwright.config.ts both describe T8 as 'tier-2 PR-blocking'", which becomes half-stale once the config comment is fixed.

`docs/done/done-T.md` also says "PR-blocking" — that is a **historical archive; leave it**.

**Files:**
- Modify: `tests/e2e/README.md`
- Modify: `playwright.config.ts` (repo root, comment lines 3-6 only)
- Modify: `.github/workflows/e2e.yml` (one comment line; triggers and steps untouched)

- [ ] **Step 1: Re-prove the trigger state**

Run: `grep -n -A3 '^on:' .github/workflows/e2e.yml`
Expected: `workflow_dispatch:` only; push/pull_request commented out.

- [ ] **Step 2: Fix `tests/e2e/README.md` line 3**

Replace:

> Tier-2 Playwright specs that run against the live `make dev` Docker Compose stack (frontend :3000, backend :4000, postgres :5432). Two specs gate PRs (`smoke.spec.ts`, `full-flow.spec.ts`) and one is developer-run only (`visual.spec.ts`).

with:

> Tier-2 Playwright specs that run against the live `make dev` Docker Compose stack (frontend :3000, backend :4000, postgres :5432). Two specs make up the default suite (`smoke.spec.ts`, `full-flow.spec.ts`) and one is developer-run only (`visual.spec.ts`). **CI runs this suite on manual trigger only** — `.github/workflows/e2e.yml` is `workflow_dispatch`-only; whether it should also gate PRs is an open CI-policy decision tracked in bd issue `story-editor-7ns`. Do not describe these specs as PR-blocking until that issue lands.

- [ ] **Step 3: Fix the root `playwright.config.ts` header comment (lines 3-6)**

Replace:

```ts
// Tier-2 PR-blocking E2E. Runs against the live `make dev` compose stack
// (frontend :3000, backend :4000, postgres :5432). Tier-3 cross-browser /
// soak specs would live under `tests/e2e-extended/` and use a separate
// config or `--project=extended` selector.
```

with:

```ts
// Tier-2 E2E — CI-manual-only today (.github/workflows/e2e.yml runs on
// workflow_dispatch only; PR gating is an open decision tracked in bd issue
// story-editor-7ns). Runs against the live `make dev` compose stack
// (frontend :3000, backend :4000, postgres :5432). Tier-3 cross-browser /
// soak specs would live under `tests/e2e-extended/` and use a separate
// config or `--project=extended` selector.
```

- [ ] **Step 4: Un-stale the e2e.yml comment (comment only — do NOT touch `on:`)**

In `.github/workflows/e2e.yml` lines 8-11, replace:

```yaml
# This workflow currently runs on manual trigger (workflow_dispatch) only.
# Whether it should also gate PRs (done-T.md and playwright.config.ts both
# describe T8 as "tier-2 PR-blocking") is an open CI-policy decision tracked
# in story-editor-7ns — do not flip the triggers without resolving that.
```

with:

```yaml
# This workflow currently runs on manual trigger (workflow_dispatch) only.
# Whether it should also gate PRs (the historical done-T.md archive describes
# T8 as "tier-2 PR-blocking") is an open CI-policy decision tracked in
# story-editor-7ns — do not flip the triggers without resolving that.
```

- [ ] **Step 5: Verify**

Run: `! grep -q "Two specs gate PRs" tests/e2e/README.md && ! grep -q "PR-blocking" playwright.config.ts && grep -q "story-editor-7ns" tests/e2e/README.md && npx biome check playwright.config.ts && git diff --stat .github/workflows/e2e.yml playwright.config.ts`
Expected: greps pass, biome clean, and the diff on both non-md files shows only comment lines (eyeball this — it is the docs-only gate for this task).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/README.md playwright.config.ts .github/workflows/e2e.yml
git commit -m "[<bd-id>] docs: e2e suite is CI-manual-only, not PR-blocking — gating tracked in story-editor-7ns"
```

---

### Task 4: Env docs — dead `VITE_API_URL`, undocumented `POSTGRES_*`, missing `.env.test.example`

**Verified state:**
- `.env.example:30` documents `VITE_API_URL=http://localhost:4000`, but nothing in the codebase reads it. The real variable is `VITE_API_BASE_URL`: read in `frontend/src/lib/api.ts:24-28` (`resolveBaseUrl`, empty ⇒ origin-relative `/api`), typed in `frontend/src/vite-env.d.ts:14` ("Empty/unset means origin-relative `/api` (nginx reverse-proxies to the backend)"), passed as a build arg in `docker-compose.yml:61` with default empty. The rename happened in [I9] (`docs/done/done-I.md:32`: "Renames the dead `VITE_API_URL` build arg to `VITE_API_BASE_URL`").
- `SELF_HOSTING.md:180` still tells operators `VITE_API_URL=https://api.example.com docker compose build frontend` — dead variable, *and* the framing ("If you run the stack on a host other than `localhost`") predates [I9]'s same-origin `/api` nginx proxy: a non-localhost host needs **no** rebuild; only a separate API *origin* does (`docker-compose.yml:55-60` comment).
- `docker-compose.yml:8-10` consumes `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (defaults `storyeditor`), and `DATABASE_URL`'s compose default interpolates them (`docker-compose.yml:38`) — none documented in `.env.example`, violating the house rule "All environment variables must be documented in `.env.example`".
- `.env.test` is required locally but has no example: `scripts/db-test-reset.sh:10-13` hard-fails (`Missing $ENV_FILE`, exit 1) without it, and `backend/tests/globalSetup.ts:31-34` runs that script before **every** local (non-CI) backend vitest run — so a fresh clone cannot run `make test` until `.env.test` exists. The script needs `DATABASE_URL` (`db-test-reset.sh:20-23`) and optionally `POSTGRES_CONTAINER` (line 34, default `story-editor-postgres-1`). Note the suite itself does *not* read `.env.test` — `backend/tests/setup.ts:10-15` pins `TEST_DATABASE_URL ?? 'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test'` — so the example's `DATABASE_URL` must match that default. `.gitignore:8` ignores exactly `.env.test`, so `.env.test.example` will be tracked.

**Files:**
- Modify: `.env.example`
- Create: `.env.test.example`
- Modify: `SELF_HOSTING.md` (the ~line 178-181 recipe)
- Modify: `CLAUDE.md` (Quick Start — one pointer line)

- [ ] **Step 1: Re-prove the variable names**

Run: `grep -rn "VITE_API_URL" frontend/src frontend/*.ts docker-compose.yml` (expect: no hits) and `grep -rn "VITE_API_BASE_URL" frontend/src/lib/api.ts frontend/src/vite-env.d.ts docker-compose.yml` (expect: hits at api.ts:26, vite-env.d.ts:14, docker-compose.yml:61).

- [ ] **Step 2: Fix `.env.example`**

**(a)** Replace lines 29-30:

```
# Public URL of the backend API, used by the Vite frontend at build/runtime
VITE_API_URL=http://localhost:4000
```

with:

```
# Optional backend API origin, baked into the SPA bundle at image build time
# (docker-compose build arg → import.meta.env.VITE_API_BASE_URL, read by
# frontend/src/lib/api.ts). Leave unset/empty for the default: origin-relative
# `/api`, which the frontend image's nginx reverse-proxies to the backend —
# this is correct for the bundled compose stack on ANY host, not just
# localhost. Set it only when the API is served from a different origin than
# the SPA, then rebuild the frontend image (Vite inlines it at build time)
# and make sure the backend's FRONTEND_URL matches your SPA origin.
# VITE_API_BASE_URL=
```

**(b)** After the `DATABASE_URL` block (line 4), add:

```
# Postgres credentials + database name for the docker-compose postgres service.
# Defaults shown are the compose fallbacks (docker-compose.yml). The backend's
# DATABASE_URL compose default interpolates these three, so overriding them
# without also updating DATABASE_URL above stays consistent automatically —
# but if you set DATABASE_URL explicitly, keep it in sync yourself.
# POSTGRES_USER=storyeditor
# POSTGRES_PASSWORD=storyeditor
# POSTGRES_DB=storyeditor
```

> Note for implementer: commented-out entries (like the existing `SESSION_STORE_MAX` / `TRUST_PROXY_HOPS`) are this file's established idiom for optional-with-default vars — follow it for both additions.

- [ ] **Step 3: Create `.env.test.example`**

```
# Test-database env for local backend test runs. Copy to `.env.test` at the
# repo root (gitignored):
#
#   cp .env.test.example .env.test
#
# scripts/db-test-reset.sh hard-fails without .env.test, and the backend
# vitest globalSetup runs that script before every local (non-CI) suite run —
# so `make test` / `npm run test:backend` need this file to exist. CI skips
# the script and injects DATABASE_URL directly.
#
# Must point at a THROWAWAY test database — the reset script DROPs and
# recreates it on every run. Never point this at the dev database.
# The URL below must match the suite's pinned default in
# backend/tests/setup.ts (storyeditor_test on localhost:5432); if you change
# it, also export TEST_DATABASE_URL with the same value when running tests.
DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test

# Name of the running postgres container the reset script `docker exec`s into.
# Default matches the `make dev` compose stack.
# POSTGRES_CONTAINER=story-editor-postgres-1
```

(No real secrets: these are the published local-dev compose defaults.)

- [ ] **Step 4: Fix `SELF_HOSTING.md` (~lines 178-182)**

Replace:

> If you run the stack on a host other than `localhost`, rebuild the frontend image with the API URL baked in:
>
> ```bash
> VITE_API_URL=https://api.example.com docker compose build frontend
> docker compose up -d frontend
> ```

with:

> The frontend image's nginx reverse-proxies `/api` to the backend same-origin, so running the stack on a host other than `localhost` needs **no** rebuild — the SPA calls `/api` relative to wherever it's served. Only if you serve the API from a **different origin** than the SPA, bake that origin in at build time (and set the backend's `FRONTEND_URL` to your SPA origin):
>
> ```bash
> VITE_API_BASE_URL=https://api.example.com docker compose build frontend
> docker compose up -d frontend
> ```

- [ ] **Step 5: Add the `.env.test` pointer to CLAUDE.md Quick Start**

In the `# First-time setup` block, after the `cp .env.example .env` line, add:

```
cp .env.test.example .env.test   # required before local backend test runs (see Testing Rules)
```

- [ ] **Step 6: Verify**

Run: `! grep -n "VITE_API_URL" .env.example SELF_HOSTING.md && grep -q "VITE_API_BASE_URL" .env.example && grep -q "POSTGRES_USER" .env.example && test -f .env.test.example && grep -q "storyeditor_test" .env.test.example && grep -q ".env.test.example" CLAUDE.md`
Expected: passes silently. Then the end-to-end proof that the example actually satisfies its consumer: `cp .env.test.example /tmp/claude-env-test-check && bash -n scripts/db-test-reset.sh` — and, if the dev stack is up, `cp .env.test.example .env.test && npm -w story-editor-backend run db:test:reset` completes with "Test database ready." (skip the live check if the stack isn't running; say so in the report rather than faking it).

- [ ] **Step 7: Commit**

```bash
git add .env.example .env.test.example SELF_HOSTING.md CLAUDE.md
git commit -m "[<bd-id>] docs: fix VITE_API_BASE_URL name, document POSTGRES_* vars, add .env.test.example"
```

---

## Self-Review notes

- **Spec coverage:** drift item 1 (encryption.md, three claims) → Task 1; item 2 (naming table) → Task 2; item 3 (e2e PR-blocking) → Task 3; item 4 (env docs) → Task 4. All claims were re-verified against the working tree on 2026-07-02, not taken on faith from the brief.
- **Corrections to the brief discovered during verification:** (a) the "PR-blocking" comment lives in the **repo-root** `playwright.config.ts`, not `tests/e2e/playwright.config.ts` (which doesn't exist); (b) the stale needsRehash claim appears **three** times in encryption.md (lines 78, 312, 336), not once; (c) `SELF_HOSTING.md:180` also carries the dead `VITE_API_URL` *and* pre-[I9] "rebuild on any non-localhost host" advice — both fixed in Task 4; (d) the doc's stated 160-bit entropy target is actually **met** by the code (20 bytes) — only the grouping ("10 groups of 16 bits") and the CRC-16 checksum are fiction; (e) `docs/agent-rules/*.md` contain **no** copy of the camelCase claim (grep-verified), so Task 2 touches CLAUDE.md only.
- **Honesty over deletion:** each falsified claim is replaced with the true behavior *plus* an explicit gap note (no rehash-on-login = accepted gap; no session-expired banner = known UX gap; no checksum = typos surface at unwrap). encryption.md gets a dated change-log entry per its own convention.
- **Docs-only discipline:** the two non-md files touched (`playwright.config.ts`, `e2e.yml`) get comment-only edits, gated by an explicit `git diff` eyeball step; workflow triggers are explicitly out of scope (story-editor-7ns). Historical archives (`done-S.md`, `done-T.md`, `done-I.md`, old plan files, TASKS.md) are deliberately untouched even where they repeat retired claims.
- **Verification honesty:** biome does not lint Markdown or env files (checked `biome.json` — no markdown surface), so the plan's gates are targeted greps with expected outcomes plus `npx biome check playwright.config.ts` for the one `.ts` edit; Task 4 adds a live `db:test:reset` run as an optional end-to-end proof when the stack is up.
- **Open items for the user to rule on:** (1) `VITE_APP_VERSION` is consumed by `docker-compose.yml:66` but also absent from `.env.example` — it's Makefile/release-workflow-injected rather than operator-set (the existing `INKWELL_VERSION` comment at `.env.example:38-39` alludes to it), so Task 4 leaves it out; add it if the house rule is read strictly. (2) Whether the needsRehash removal deserves a follow-up bd issue ("reinstate login-time rehash before any argon2 parameter bump") — out of scope here (no bd issues per brief), but worth filing when this plan is linked. (3) `bd show story-editor-7ns` could not be run (bd unavailable in this environment); the id is taken from the e2e.yml comment — confirm it's still open before committing Task 3's wording.
