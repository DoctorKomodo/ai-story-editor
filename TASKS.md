# Story Editor — Development Tasks

> **Working task tracker is [bd (beads)](https://gastownhall.github.io/beads/).** Run `bd ready` for available work, `bd show <id>` for details. This file is now a **historical journal + ID-mapping table** — it preserves the original `[A-Z]\d+` task IDs that are referenced from plan docs (`docs/superpowers/plans/*.md`), commit messages, and agent prompts, mapped to the bd issue each one lives in today.

---

## How work gets done

```bash
bd ready                # pick a task with no blockers
bd show <id>            # read the description + verify: line in --notes
bd update <id> --claim  # claim it
… write code …
/task-verify <id>       # gate (reads verify: from bd notes)
/bd-close <id>          # closes only if verify exits 0
```

The verify-as-contract convention from the original workflow is preserved: each bd issue's `--notes` carries a `verify: <command>` line; `/task-verify` runs it with `bash -o pipefail`. A `plan:` link or `trivial:` justification line in `--notes` indicates implementability.

---

## Section glossary (historical bring-up order)

The original project bring-up sequenced work through these letters. Most are now archived; the glossary stays for cross-refs in plans, commits, and agent prompts.

**S → A → D → AU → E → V → L → B → F → I → T → X**, plus **M** (maintenance) and **DS** (design-system) added later.

| Letter | Scope | Status |
|---|---|---|
| S | scaffold | archived → `docs/done/done-S.md` |
| A | architecture docs | archived → `docs/done/done-A.md` |
| D | database (schema + migrations + seed) | archived → `docs/done/done-D.md` |
| AU | auth (username, refresh, BYOK Venice key) | archived → `docs/done/done-AU.md` |
| E | encryption at rest | archived → `docs/done/done-E.md` |
| V | Venice.ai integration | archived → `docs/done/done-V.md` |
| L | live Venice testing | archived → `docs/done/done-L.md` |
| B | backend non-AI routes | archived → `docs/done/done-B.md` |
| I | infra (Docker / compose) | archived → `docs/done/done-I.md` |
| T | testing (integration + E2E) | archived → `docs/done/done-T.md` |
| F | frontend | live (closed `[x]` rows pending rotation into `docs/done/done-F.md`) |
| X | extras / feature backlog | live (closed `[x]` rows pending rotation into `docs/done/done-X.md`) |
| M | maintenance & dependency upgrades | live |
| DS | design-system follow-ups | live (no open issues) |

Hard gates from the original plan (preserved as cross-ref):
- **B** required **AU** (ownership middleware).
- **Any narrative-entity CRUD** required **E3 + E9**.
- **V** beyond `[A4]` required **AU11 + AU12** (BYOK).
- **L** required **V17** (per-user OpenAI client).
- **F AI features** ([F33]–[F42]) required **V5+** streaming endpoints.
- **E2E tests** ([T8]) required full stack via Docker Compose.

---

## S — archived

All [S]-series tasks complete — archived in [`docs/done/done-S.md`](docs/done/done-S.md).

---

## A — archived

All [A]-series tasks complete — archived in [`docs/done/done-A.md`](docs/done/done-A.md).

---

## D — archived

All [D]-series tasks complete — archived in [`docs/done/done-D.md`](docs/done/done-D.md).

---

## AU — archived

All [AU]-series tasks complete — archived in [`docs/done/done-AU.md`](docs/done/done-AU.md).

---

## E — archived

All [E]-series tasks complete — archived in [`docs/done/done-E.md`](docs/done/done-E.md).

---

## V — archived

All [V]-series tasks complete — archived in [`docs/done/done-V.md`](docs/done/done-V.md).

---

## L — archived

All [L]-series tasks complete — archived in [`docs/done/done-L.md`](docs/done/done-L.md).

---

## B — archived

All [B]-series tasks complete (B1–B12, plus V19–V28 follow-ups and [D17]) — archived in [`docs/done/done-B.md`](docs/done/done-B.md).

---

## I — archived

All [I]-series tasks complete — archived in [`docs/done/done-I.md`](docs/done/done-I.md).

---

## 🧪 T — archived

All [T]-series tasks complete — archived in [`docs/done/done-T.md`](docs/done/done-T.md).

---

## 🎨 F — Frontend

> Closed [F]-series tasks (F1–F62, F64, F66, F67) archived in [`docs/done/done-F.md`](docs/done/done-F.md). Two live subsections remain below: Core completion (F63, F65) and Phase 4 (Storybook).

### F — Core completion

- **[F63]** → bd:story-editor-9vm
- **[F65]** → bd:story-editor-6ug

### F — Phase 4 (Storybook)

> Phase 4 of the design-system migration: stand up Storybook as the live design surface, author stories for the eight primitives + the design tokens, backfill stories for the twelve Phase-2 ports, and retire the parallel `mockups/frontend-prototype/` HTML universe. Full handoff doc: [docs/HANDOFF.md](docs/HANDOFF.md) § Phase 4. Visual-regression slot is already tracked as **[X24]**.

- [x] **[F68]** Install Storybook 9.x in the frontend workspace and wire the theme decorator. Run `cd frontend && npx storybook@latest init --type react-vite`, then **before committing** confirm the resolved version with `npm view storybook version` (HANDOFF.md notes SB9 vs SB8 differ in the `addon-essentials` bundle, the `@storybook/react-vite` renderer entry, and the `backgrounds` parameter API). Delete the wizard-generated `frontend/src/stories/` sample directory. Replace `.storybook/preview.tsx` verbatim with the snippet in [docs/HANDOFF.md](docs/HANDOFF.md) § "Wire tokens + themes" — that decorator imports `frontend/src/index.css` (so the theme tokens apply inside Storybook) and adds a paper/sepia/dark global toolbar that toggles `document.documentElement.dataset.theme`. Confirm the viewport addon is listed in `.storybook/main.ts` under `addons` (Storybook installs it by default in 9.x). No stories ship in this task — F69 / F70 / F71 add them; this task is pure infrastructure.
  - verify: `cd frontend && npm run build-storybook -- --quiet && [ -d storybook-static ]`

- [x] **[F69]** Author primitive stories for the seven non-Modal primitives in `frontend/src/design/` (`Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Pill`, `Spinner`) — one sibling `*.stories.tsx` per primitive, single PR. Modal owns its own task ([F70]) because it needs a stateful demo wrapper. State matrix, Biome / `lint:design` interactions (folded in from the dropped reactive task), and per-task TDD steps in the plan.
  - plan: [docs/superpowers/plans/F69-storybook-primitive-stories.md](docs/superpowers/plans/F69-storybook-primitive-stories.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && npx biome ci src/design/`

- [x] **[F70]** Author `Modal.stories.tsx` with a stateful `ModalDemo` wrapper covering the five behavioural axes (size, dismissable, role, focus trap, `labelledBy`). Demo wrapper + per-story manual verification matrix in the plan.
  - plan: [docs/superpowers/plans/F70-storybook-modal-story.md](docs/superpowers/plans/F70-storybook-modal-story.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && npx biome ci src/design/Modal.stories.tsx`

- [x] **[F71]** Author `Tokens.stories.tsx` — colour / type / radius / shadow swatches with a runtime `useLayoutEffect` hex/font readout that auto-refreshes on theme flip. Replaces [docs/Design System Handoff.html](docs/Design%20System%20Handoff.html) § Tokens. Token audit step + full code in the plan.
  - plan: [docs/superpowers/plans/F71-storybook-tokens-story.md](docs/superpowers/plans/F71-storybook-tokens-story.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design`

- [x] **[F72]** Add `Build Storybook` step to `.github/workflows/ci.yml`. Single new step: `- name: Build Storybook` running `npm --prefix frontend run build-storybook -- --quiet`. Slot it after the existing **Frontend build** step (around line 113) and before the **Test** section. Catches "story breaks because primitive prop renamed" before review. No further changes — visual regression is owned by [X24].
  - verify: `grep -q "build-storybook" .github/workflows/ci.yml`

- [x] **[F73]** Backfill stories for the twelve components actively ported in Phase 2 (PR #39 commit `93d58d9`) — eleven new `*.stories.tsx` files (EditorPage skipped), single PR. Bundles, per-component story matrix, `Editor` TipTap demo-wrapper special case, [X22] sequencing note in the plan.
  - plan: [docs/superpowers/plans/F73-storybook-component-backfill.md](docs/superpowers/plans/F73-storybook-component-backfill.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && for c in AutosaveIndicator BalanceDisplay UsageIndicator AIResult ChapterList CharacterList DarkModeToggle Editor Export CharacterSheet StoryModal; do test -f src/components/$c.stories.tsx || { echo "missing: $c.stories.tsx"; exit 1; }; done`

- [x] **[F74]** Retire the parallel HTML universe — multi-PR destructive cleanup gated on hard prerequisites. PR-A rewrites `CLAUDE.md`'s "UI source of truth" rule + sweeps repo references; PR-B `git mv`s `mockups/frontend-prototype/` and `docs/Design System Handoff.html` into `mockups/archive/v1-2025-11/`; F75 updates the README. Prerequisites gate ([F68]–[F73] merged + [X24] green on main + ≥1 feature shipped via the new workflow), full PR scripts in the plan. Bundled with [F75] in a single PR (small project — reviewability concern from the plan didn't apply).
  - plan: [docs/superpowers/plans/F74-retire-html-mockups.md](docs/superpowers/plans/F74-retire-html-mockups.md)
  - verify: `! [ -d mockups/frontend-prototype ] && [ -d mockups/archive/v1-2025-11 ] && ! grep -rE '(mockups/frontend-prototype|docs/Design System Handoff)' CLAUDE.md docs/ .github/ README.md --exclude-dir=archive --exclude=F74-retire-html-mockups.md`

- [x] **[F75]** Update repo `README.md` "Design system" / "Contributing" section to point at Storybook + the `lint:design` guard. Use the copy block from [docs/HANDOFF.md](docs/HANDOFF.md) § Step 4 verbatim, adjusted to the project's existing tone. Land in the same PR as F74's Step 3 (archive) for atomicity, OR as a follow-up — operator's call. No design needed.
  - verify: `grep -q -i 'storybook' README.md && grep -q 'lint:design' README.md`

---

## 💡 X — Extras (feature backlog)

> Open feature ideas, grouped by theme. Maintenance tasks are now under [M]; design-system follow-ups under [DS]. Closed X-numbered entries are archived in [`docs/done/done-X.md`](docs/done/done-X.md).

### X — Editor & writing

- **[X1]** → bd:story-editor-566
- **[X2]** → bd:story-editor-4i7
- **[X9]** → bd:story-editor-coi
- **[X17]** → bd:story-editor-6aa

- [x] **[X25]** Modals open in an off-centre position (towards the upper-left) on first frame, then visibly snap to the centre of the viewport once mounted. Fix the `<Modal>` primitive (and any wrapper layout) so the dialog renders in its final centred position from frame one — likely a transform / measurement / focus-trap-mount race. Affects every modal across the app (Story picker, Settings, Account confirm, etc.).
  - trivial: Root cause was a Tailwind v4 `translate` longhand × `t-modal-in` keyframe `transform` collision — the two composed into a -100%/-100% double translate during the 180ms animation, then snapped back when the keyframe `transform` reverted. Fix: drop `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` from the Modal card (the backdrop's `flex items-center justify-center` already centres it), simplify the keyframe to `translateY(8px) scale(.98) → translateY(0) scale(1)`. Single primitive change, covers every modal.
  - verify: `cd frontend && npm run test:frontend -- --run tests/design/ModalCentering.test.tsx tests/components/Animations.test.tsx`

- **[X30]** → bd:story-editor-8od

- [x] **[X31]** `/api/ai/balance` still returns `{ credits, diem }` after [X26] renamed `credits` → `balanceUsd` on the verify endpoint. The two endpoints both surface the same `x-venice-balance-usd` header value and now disagree on field name, which is the kind of drift that bites the next person reading either response. Rename the field on the balance route too: `backend/src/routes/ai.routes.ts:97-108` (`{ credits, diem }` → `{ balanceUsd, diem }`); `frontend/src/hooks/useBalance.ts` `Balance.credits` → `balanceUsd`; `frontend/src/components/BalanceDisplay.tsx:73` reads `balance.credits` → `balance.balanceUsd`; `frontend/src/components/UserMenu.tsx` if it forwards the field; tests under `backend/tests/ai/balance.test.ts` and `frontend/tests/components/{BalanceDisplay,UserMenu}.test.tsx`; `docs/api-contract.md` for the balance endpoint shape. Pure rename, no behaviour change. Out of [X26]'s scope per security-reviewer's call (the field is auth-gated USD, not key material), but worth doing before the naming rot spreads further.
  - superseded-by: X32 (the rename and the balance endpoint were consolidated into one unified `/api/users/me/venice-account` endpoint replacing both `/api/ai/balance` and the verify endpoint)
  - verify: `cd backend && npx vitest run tests/routes/venice-account.test.ts && cd ../frontend && npx vitest run tests/components/BalanceDisplay.test.tsx`

- [x] **[X32]** Unified Venice account-info endpoint. Replaces `GET /api/ai/balance` and `POST /api/users/me/venice-key/verify` with one `GET /api/users/me/venice-account` returning `{ verified, balanceUsd, diem, endpoint, lastSix }`. Fixes the BalanceDisplay header pill (was reading non-existent `x-venice-balance-*` headers off `/v1/models`). Per-user 30/min rate limit (distinct `account_rate_limited` code from `venice_rate_limited`). `upstreamStatus` carried in error body for the #54 diagnostics overlay. Internal `getStatusAndKey()` halves DB reads + decrypts. `parseRetryAfter` deduped via `lib/venice-errors`.
  - spec: [docs/superpowers/specs/2026-05-04-x32-venice-account-endpoint-design.md](docs/superpowers/specs/2026-05-04-x32-venice-account-endpoint-design.md)
  - plan: [docs/superpowers/plans/2026-05-04-x32-venice-account-endpoint.md](docs/superpowers/plans/2026-05-04-x32-venice-account-endpoint.md)
  - verify: `cd backend && npx vitest run tests/routes/venice-account.test.ts && cd ../frontend && npx vitest run tests/hooks/useVeniceAccount.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/BalanceDisplay.test.tsx`

### X — AI features

- **[X4]** → bd:story-editor-nx0
- **[X8]** → bd:story-editor-fo3

- [x] **[X27]** Settings → Models picker rework. The current dialog dumps the full model list inline and gets unwieldy. Mirror the chat-window pattern: the Settings panel shows only the currently selected model; clicking it opens a dedicated picker modal containing the full list. In the picker, surface the per-model description from Venice's `/models` endpoint and the per-token price alongside the model name.
  - spec: [docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md](docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md)
  - plan: [docs/superpowers/plans/2026-05-04-x27-models-picker-rework.md](docs/superpowers/plans/2026-05-04-x27-models-picker-rework.md)
  - superseded-by: [X33] (modal-trigger pattern replaced by inline master/detail picker; the backend mapper + frontend Model type from X27 survive in X33)
  - verify: `npm --prefix backend run test -- venice.models.service.test.ts && npm --prefix frontend run typecheck`

- [x] **[X33]** Settings → Models tab inline picker. Supersedes X27's modal trigger pattern with an inline master/detail picker living inside the Settings → Models tab. Chat-bar model trigger reroutes to Settings → Models. Drops Cancel/Done from Settings (auto-save). Bumps modal close-X to 44×44 across the app.
  - spec: [docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md](docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md)
  - plan: [docs/superpowers/plans/2026-05-05-x33-models-tab-inline-picker.md](docs/superpowers/plans/2026-05-05-x33-models-tab-inline-picker.md)
  - verify: `npm --prefix backend run test -- venice.models.service.test.ts && npm --prefix frontend run test -- ModelPickerInline Settings.models editor-shell.integration && npm --prefix frontend run typecheck && npm --prefix frontend run build-storybook`

- **[X34]** → bd:story-editor-myi
- **[X28]** → bd:story-editor-tdc

- [x] **[X29]** Settings → Models system prompt is dead UI. Repurposed as a Settings → Prompts tab with user-level overrides for the system prompt and five action templates (continue, rewrite/rephrase, expand, summarise, describe). Per-story `Story.systemPrompt` (column + repo path + dead Models-tab UI) removed entirely.
  - plan: [docs/superpowers/plans/2026-05-04-x29-prompts-tab.md](docs/superpowers/plans/2026-05-04-x29-prompts-tab.md)
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.user-prompts.test.ts tests/routes/user-settings.test.ts tests/routes/ai-defaults.test.ts tests/repos/story.repo.test.ts tests/routes/stories.test.ts && cd ../frontend && npm run test:frontend -- --run tests/components/Settings.prompts.test.tsx tests/components/Settings.models.test.tsx tests/hooks/useDefaultPrompts.test.tsx`

- **[X11]** → bd:story-editor-h1i

### X — Import & export

- **[X5]** → bd:story-editor-lbn
- **[X6]** → bd:story-editor-wh3
- **[X7]** → bd:story-editor-8og

### X — Account

- **[X3]** → bd:story-editor-3xj

- [x] **[X26]** Settings → Venice.ai polish pass: (a) the toggle currently labelled "Include Venice creative-writing prompt" should ask whether to include Venice's *default system prompt* — current copy is misleading about what the flag actually toggles; (b) once a key is stored, prefill the API-key input with a partially-masked value showing the last **6** characters (currently last 4) and remove the separate "Stored key" field above the Remove button — collapse into one field; (c) the Save button should validate against Venice in the same call (saves an extra click), keep the standalone Verify button for re-checking an existing stored key; (d) the Verify result text "Verified · — credits" leaves the credit count blank — fill it in from the verify response, and double-check Venice's API: their balance is denominated in $ (USD) on the dashboard, not "credits". Update the label accordingly.
  - trivial: (a) copy fix in Settings.tsx; (b) `lastFour`→`lastSix` rename across backend service + routes + frontend hook + Settings UI (placeholder replaces inline indicator); (c) `handleSave` chains `verifyMutation` after `storeMutation` and reuses the existing pill UI; (d) `credits`→`balanceUsd` rename on the verify endpoint only (the `/api/ai/balance` `credits` field is a separate endpoint, untouched here per security-reviewer scope note). docs/api-contract.md updated. security-reviewer CLEAN (1 stale-comment fix folded in, no other findings).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/venice-key.test.ts tests/routes/venice-key-verify.test.ts && cd ../frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

- **[X18]** → bd:story-editor-6bw

---

## 🔧 M — Maintenance & dependencies

> Recurring dependency upgrades, security advisories, and tooling hygiene. Open work tracked in bd; the rows below are the ID → bd-issue mapping.

- **[M1]** → bd:story-editor-907
- **[M2]** → bd:story-editor-10m
- **[M3]** → bd:story-editor-ei0

---

## 🎨 DS — Design-system follow-ups

> No open tasks. Land DS-related follow-ups here as the design system evolves (new primitives, token additions, lint:design rule changes, Storybook story patterns). Closed entries from the original X-bucket (X22–X24) are archived in [`docs/done/done-X.md`](docs/done/done-X.md).
