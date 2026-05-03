# Story Editor — Development Tasks

> A self-hosted, web-based story and text editor with Venice.ai AI integration. Users can manage multiple stories, break them into chapters, attach characters for consistency, and invoke AI assistance directly from the editor.

---

## Tech Stack

- **Frontend:** React + Vite + TypeScript + TailwindCSS + TipTap
- **Backend:** Node.js + Express + TypeScript + Prisma
- **Database:** PostgreSQL
- **Auth:** JWT (access token) + refresh token (httpOnly cookie)
- **AI:** Venice.ai API — OpenAI-compatible, proxied through backend
- **Venice SDK:** `openai` npm package pointed at Venice base URL (`https://api.venice.ai/api/v1`)
- **Containerisation:** Docker + Docker Compose
- **Testing:** Vitest + Supertest (backend), Vitest + React Testing Library (frontend), Playwright (E2E)

---

## Current focus

- **In flight:** F63 chat history, F65 terminal-401 redirect.
- **Backlog (next):** M1–M3 maintenance, X26–X29 testing-found UI/settings polish.
- **Proposed (no plan yet):** X1, X2, X3, X4, X5, X6, X7, X8, X9, X11, X17, X18, X26, X27, X28, X29, DS-* (none yet).
- **Archived:** S, A, D, AU, E, V, L, B, I, T (full task history in `docs/done/`).
- **Live sections:** F (Phase 4 only), X, M, DS.

---

## Workflow

Tasks lifecycle: `proposed` → `planned` / `trivial` → `done`.

- Add a task with description only — no plan needed at creation.
- Before implementation, every task needs either:
  - `- plan: [...]` link to a spec/plan under `docs/superpowers/plans/`, OR
  - `- trivial: <one-line justification>` (≤30 LoC, no new abstractions, no schema/auth/crypto/repo touch, no new dependency)
- Both gates also require `- verify: <command>`.
- Tick `[x]` only after `/task-verify <ID>` exits 0 (auto-ticked by the pre-edit hook).

Helpers:
- `bash scripts/tasks-proposed.sh` — list open tasks missing both `plan:` and `trivial:`.
- `bash scripts/tasks-implementable.sh` — list open tasks ready to start.

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

- [ ] **[F63]** **[design-first]** Chat history pane content. `[F38]` mounts a History tab whose body is the placeholder string `"History — coming in a future task"`. Render the list of chats for the active chapter via `useChatsQuery(chapterId)` — each row showing title (or first user-message preview), relative timestamp, and message count. Click selects-and-loads the chat into the Chat tab. Define archive/pin/delete semantics in the design (recommended minimum: just delete + select; archive/pin punted). Decide what "New chat" does to the previous one.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatHistory.test.tsx`

- [ ] **[F65]** Terminal-401 redirect to login. `[F3]`'s api client retries refresh once; when the refresh itself returns 401, the user is left on a broken page. Wire the existing `setUnauthorizedHandler(...)` (already in `frontend/src/lib/api.ts`) so a terminal failure clears `useSessionStore` and navigates to `/login`. Confirm `useInitAuth()` correctly handles a hard 401 on app boot. Add a small "Your session expired — please sign in again" toast/banner on the login page when redirected from a terminal 401. No design needed — uses existing toast/error patterns.
  - verify: `cd frontend && npm run test:frontend -- --run tests/lib/api-401-terminal.test.ts tests/pages/auth.test.tsx`

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

- [ ] **[X1]** Word count goals per chapter with progress bar in chapter list.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WordCountGoal.test.tsx`

- [ ] **[X2]** Focus mode: keyboard shortcut hides all UI chrome. Escape to exit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FocusMode.test.tsx`

- [ ] **[X9]** Typewriter mode + Focus paragraph rendering (Settings → Writing toggles from [F45]): typewriter keeps active line vertically centred via padding manipulation; focus paragraph dims all but the current paragraph via an `opacity: .35` rule controlled by `data-focus-active` on the prose container.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FocusParagraph.test.tsx`

- [ ] **[X17]** Find / Replace UI in the editor. Wire `<FormatBar>`'s `onToggleFind` callback to a small inline find bar inside `<Paper>` that highlights matches, supports next/previous, and optionally Replace. Decision (capture in plan): inline strip vs floating popover. Match the prototype's mockup if one is added; otherwise design-first. F52 ships the FormatBar Find button as `disabled` with a `title="Find — coming in [X17]"` tooltip; X17 lifts the disabled state and wires the actual feature.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/EditorFind.test.tsx`

- [x] **[X25]** Modals open in an off-centre position (towards the upper-left) on first frame, then visibly snap to the centre of the viewport once mounted. Fix the `<Modal>` primitive (and any wrapper layout) so the dialog renders in its final centred position from frame one — likely a transform / measurement / focus-trap-mount race. Affects every modal across the app (Story picker, Settings, Account confirm, etc.).
  - trivial: Root cause was a Tailwind v4 `translate` longhand × `t-modal-in` keyframe `transform` collision — the two composed into a -100%/-100% double translate during the 180ms animation, then snapped back when the keyframe `transform` reverted. Fix: drop `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` from the Modal card (the backdrop's `flex items-center justify-center` already centres it), simplify the keyframe to `translateY(8px) scale(.98) → translateY(0) scale(1)`. Single primitive change, covers every modal.
  - verify: `cd frontend && npm run test:frontend -- --run tests/design/ModalCentering.test.tsx tests/components/Animations.test.tsx`

### X — AI features

- [ ] **[X4]** Image generation: "Generate image" button calls `POST /api/ai/image` which forwards to Venice's image generation endpoint. Result inserted as a TipTap image node.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/image.test.ts`

- [ ] **[X8]** Consistency check (character popover footer button): sends the character bible entry + the last N chapters (budget-aware via [V3]) to the selected model, returns an annotated list of discrepancies ("Eira's eye colour — grey in Ch.2 but hazel in Ch.5"). Renders as a scrollable list in the popover's expanded state.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/consistency-check.test.ts`

- [ ] **[X27]** Settings → Models picker rework. The current dialog dumps the full model list inline and gets unwieldy. Mirror the chat-window pattern: the Settings panel shows only the currently selected model; clicking it opens a dedicated picker modal containing the full list. In the picker, surface the per-model description from Venice's `/models` endpoint and the per-token price alongside the model name.

- [ ] **[X28]** Settings → Models generation-parameter revisit: (1) audit the UI defaults — confirm temperature / top_p / max_tokens etc. are sane for general writing use; (2) parameter changes must persist *per model* (today they're applied globally), so the saved settings shape becomes `{ [modelId]: { temperature, ... } }` keyed by Venice model ID; (3) add a per-model Reset button that clears the user's saved overrides for that model and falls back to the model's defaults; (4) some models expose default parameter values via Venice's `/models` endpoint (e.g. "Qwen 3.5 397B") — load those as the baseline defaults instead of a global hardcode where present.

- [ ] **[X29]** Settings → Models system prompt is dead UI. Current copy reads "Per-story override for the default creative-writing prompt" with a "Pick a story to set a custom system prompt" hint, but no story selector exists in this surface. Repurpose the field as a *user-level* system prompt that applies to every AI call, used either alongside the Venice default system prompt (when the [X26] toggle is on) or on its own. Per-story `Story.systemPrompt` ([V13]) continues to override the user-level value when present.

- [ ] **[X11]** (optional) Reconsider whether `/api/ai/complete` should keep `enable_web_search` on at all. Context: V7 wired web-search opt-in (`enableWebSearch?: boolean` on the `/api/ai/complete` body). V26 scoped citations to the chat panel only, so on the inline-AI surface users currently pay Venice web-search cost with zero user-visible benefit — citations are dropped silently. Decide one of: (a) turn web search OFF across all inline AI actions (simplest, removes the wasted spend); (b) keep it ON as a silent fact-grounding nudge for accuracy (tolerable but undocumented); (c) extend V26's delivery to inline AI (requires a new F-design for a sources UI on the inline card — the selection bubble / inline AI card has no mockup for this today). Write the decision + rationale into `docs/venice-integration.md` § Web Search. If (a), also remove `enableWebSearch` from `ai.routes.ts` body schema + update `docs/api-contract.md` § `/api/ai/complete`. If (c), spawn a follow-up F-task and a follow-up V-task.
  - verify: (design decision — no automated verify)

### X — Import & export

- [ ] **[X5]** DOCX export (per chapter + whole story): backend converts `bodyJson` → .docx via the `docx` npm package; frontend "Import .docx" sits in Story Picker footer ([F30]) and triggers `POST /api/stories/:id/export/docx`.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/export-docx.test.ts`

- [ ] **[X6]** EPUB export (whole story): stitches chapters in `orderIndex` order into a single .epub. Async — returns a job id, polled for the download URL.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/export-epub.test.ts`

- [ ] **[X7]** Import .docx into a story: parses headings as chapter splits, creates Chapter rows with derived `bodyJson` + `content`.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/import-docx.test.ts`

### X — Account

- [ ] **[X3]** Remaining account-settings scope: edit display name — no editor exists today (`User.name` is set once at register time to the username and cannot be changed; backend has no `PATCH /api/users/me` for name/username). The (b) delete-account piece shipped 2026-05-02 via the F61 modal-takeover redesign — `DELETE /api/auth/delete-account` (auth + per-user rate-limit + timing-equalised wrong-password + cookie clear), `useDeleteAccountMutation` (clears session/cache + navigates to `/login` with `accountDeleted: true`), and the in-modal password + typed-`DELETE` confirm form. Change-password / rotate-recovery / sign-out-everywhere are not in this task's scope (already shipped under F61/B12/AU15/AU17).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/account.test.ts && cd ../frontend && npm run test:frontend -- --run tests/pages/account.test.tsx`

- [ ] **[X26]** Settings → Venice.ai polish pass: (a) the toggle currently labelled "Include Venice creative-writing prompt" should ask whether to include Venice's *default system prompt* — current copy is misleading about what the flag actually toggles; (b) once a key is stored, prefill the API-key input with a partially-masked value showing the last **6** characters (currently last 4) and remove the separate "Stored key" field above the Remove button — collapse into one field; (c) the Save button should validate against Venice in the same call (saves an extra click), keep the standalone Verify button for re-checking an existing stored key; (d) the Verify result text "Verified · — credits" leaves the credit count blank — fill it in from the verify response, and double-check Venice's API: their balance is denominated in $ (USD) on the dashboard, not "credits". Update the label accordingly.

- [ ] **[X18]** Display name in the registration flow. Today `frontend/src/components/AuthForm.tsx` collects only `username` + `password`; `frontend/src/hooks/useAuth.ts:register()` defaults the backend-required `name` to the username so the schema's `nameSchema` (min 1) passes. Add a third `Display name` field to the register variant of `<AuthForm>` (login variant unchanged), validate min 1 / max 80 client-side to mirror `nameSchema`, and pass it through `register({ name, username, password })`. Update `Credentials` (or split into `LoginCredentials` / `RegisterCredentials`) so the type captures the register-only field. Sweep the existing register tests to assert `name` is sent in the body. Pairs with [X3]'s display-name editor — together they let users set + later edit a name distinct from the login handle.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx tests/hooks/useAuth.test.tsx tests/pages/recovery-code-handoff.test.tsx`

---

## 🔧 M — Maintenance & dependencies

> Recurring dependency upgrades, security advisories, and tooling hygiene. Each task that touches more than ~30 LoC, adds an abstraction, touches schema/auth/crypto/repo, or adds a dependency requires a plan before implementation (per the Workflow section above).

- [ ] **[M1]** (was X16) Resolve `pg@8` `client.query() when the client is already executing a query` DeprecationWarning surfaced under the X13 Prisma 7 + `@prisma/adapter-pg` migration. Backend `npm test` and `npm run venice:probe` now emit `(node:NNNN) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0` once per process. Source is the adapter shim — `node-postgres` is reusing a single `Client` for overlapping queries inside a Prisma `$transaction` callback. Three resolution paths in priority order: (1) wait for `@prisma/adapter-pg` to ship a release that switches to `pg.Pool`-per-statement (track https://github.com/prisma/prisma/issues — search `adapter-pg DeprecationWarning`); (2) bump to `pg@^9` if Prisma's adapter declares it as a peer; (3) if neither lands within ~6 weeks, file an upstream issue with a minimal repro and add a `process.removeAllListeners('warning')` filter scoped to that exact code (NOT a blanket suppress). Do not introduce a global silencer of node warnings in tests — masks future real deprecations.
  - verify: `cd backend && npm test 2>&1 | tee /tmp/backend-test.log && ! grep -q 'client.query() when the client is already executing' /tmp/backend-test.log`

- [ ] **[M2]** (was X20) Finish the [X15] act-warning sweep — it was ticked but a verbose run still emits **60** `An update to <Component> inside a test was not wrapped in act(...)` lines across **9** files: `AppShell.test.tsx`, `ChatComposer.test.tsx`, `ChatPanel.test.tsx`, `InlineAIResult.test.tsx`, `ModelPicker.test.tsx`, `SelectionBubble.test.tsx`, `Settings.appearance.test.tsx`, `Settings.models.test.tsx`, `Sidebar.test.tsx`. Two distinct root causes seen so far: (a) TanStack Query settle-after-test — the `useUserSettingsQuery` resolution fires `setSizeDraft` / `setTweaks` / etc. inside seed `useEffect`s after the test's last `await` returns (`SettingsAppearanceTab.tsx:208,252,276`); fix per-test by `await waitFor(() => expect(...).toBe(...))` on a settings-derived element, or by adding a settle-helper to `tests/setup.ts` and calling it after every render; (b) Zustand `setState` from outside React combined with `useLayoutEffect`-driven re-positioning (`SelectionBubble.tsx:157`); some tests already wrap `setState` in `act()` but the chained re-render still leaks. The X15 fix pattern (`await userEvent.click` / `await screen.findBy…` / `await waitFor`) is correct — apply consistently. Verify with the exact command in [X15] (`--reporter=verbose`, asserting zero `not wrapped in act` lines).
  - verify: `cd frontend && bash -c 'npm run test:frontend -- --run --reporter=verbose 2>&1 | grep -c "not wrapped in act"' | tee /tmp/act-count && [ "$(cat /tmp/act-count)" = "0" ]`

- [ ] **[M3]** (was X21) Track upstream Prisma fix for `@hono/node-server` advisory **GHSA-92pp-h63x-v22m** (path-traversal in `serveStatic` via repeated slashes). Pulled in transitively as `prisma → @prisma/dev → @hono/node-server@<1.19.13`. `@prisma/dev` is the package powering `prisma studio` / `prisma dev` — it's a dev-only surface and is not loaded by `@prisma/client` at runtime, so production hosts (which only run `prisma migrate deploy`) are not exposed. The Prisma maintainers ship bundled-dep bumps in patch releases; periodically re-run `cd backend && npm audit` and bump `prisma` / `@prisma/client` / `@prisma/adapter-pg` together when a clean version is available. Don't take `npm audit fix --force` — its proposed fix is `prisma@6.19.3`, a major-version downgrade. Close this when the audit advisory disappears without a downgrade, or when the underlying advisory is withdrawn.
  - verify: `cd backend && bash -c 'npm audit --omit=dev --json 2>/dev/null | jq ".vulnerabilities | to_entries | map(select(.value.via[] | type==\"object\" and .source==1107173)) | length"' | tee /tmp/x21-count && [ "$(cat /tmp/x21-count)" = "0" ]`

---

## 🎨 DS — Design-system follow-ups

> No open tasks. Land DS-related follow-ups here as the design system evolves (new primitives, token additions, lint:design rule changes, Storybook story patterns). Closed entries from the original X-bucket (X22–X24) are archived in [`docs/done/done-X.md`](docs/done/done-X.md).
