# Frontend Rules Digest

> **Read by:** `/bd-execute` prepends this file to the implementer +
> code-quality-reviewer prompts when the plan's touch-set includes
> frontend code (per `docs/agent-rules/index.md`). Keep prose tight,
> imperative, and self-contained — the implementer/reviewer subagent
> will not read other docs at dispatch time.

## Lane

`frontend/**` — React + Vite + TypeScript + TailwindCSS + TipTap +
Zustand + TanStack Query. Single SPA served at `:3000` in dev. Talks
to the backend at `/api/*`; never talks to Venice.ai directly.

## Authentication & session

- **JWT access token is held in memory** in the Zustand `session`
  slice. **Never** in `localStorage` or `sessionStorage`.
- **Refresh token lives in an httpOnly cookie** set by the backend.
  The frontend never reads it directly. Refresh requests are made
  with `credentials: 'include'`.
- The auth identifier is `username` (lowercased, 3–32 chars,
  `/^[a-z0-9_-]+$/`). `User.email` is optional metadata only.
- **Telemetry / error-reporting buffers must flush on every auth
  transition.** If a future change introduces Sentry, PostHog, an
  in-app feedback widget, a breadcrumb buffer, or any other client-
  side sink that retains content across renders, it must be wired
  into `frontend/src/lib/sessionReset.ts` (or its successor). The
  invariant: no buffer that captured user A's content may survive
  into user B's session. There are no such sinks today; the rule
  exists so the next contributor sees it before adding one.

## State management

- **Zustand for client / UI state** (`session`, `activeStoryId`,
  `activeChapterId`, `sidebarTab`, `selection`, `inlineAIResult`,
  `attachedSelection`, `model`, `params`, `tweaks`).
- **TanStack Query for server state** (`stories`, `story(id)`,
  `chapter(id)`, `characters(storyId)`, `outline(storyId)`,
  `chats(chapterId)`).
- **No other stores.** No Redux, no MobX, no React Context for app
  data. (Context is fine for inert tree-wide things like theme or
  router primitives.)
- **TanStack Query keys: `[entity, id]`** for single entities,
  `[entity, 'list', filters?]` for lists. Hooks named
  `use<Entity>(id)`.

## Per-user state must reset on auth transition

Any new Zustand store under `frontend/src/store/*.ts` that holds
plaintext content, IDs referencing user-owned rows, or any state that
should not survive a session swap must be added to `resetClientState`
in `frontend/src/lib/sessionReset.ts` AND to the `PER_USER_STORES`
allowlist in `frontend/tests/lib/sessionReset.test.ts`.

UI-only stores (theme, layout, sidebar tab) go on the `UI_ONLY_STORES`
allowlist instead. The enumeration test fails on unclassified stores —
pick one explicitly.

Every auth-transition site must reset before flipping the session slice:
- `useAuth.login` → `swapSession(qc, user, token)` (atomic).
- `useAuth.logout` → `await resetClientState(qc); clearSession();`
- `useSignOutEverywhereMutation.onSuccess` → `await resetClientState(qc); clearSession(); navigate(...);`
- `useDeleteAccountMutation.onSuccess` → same shape.
- `handleUnauthorizedAccess` (terminal-401, non-React) → `void resetClientStateUsingRegistered();` then the existing setState.

If you add a store that uses Zustand's `persist` middleware,
`setState({ ...initial })` does NOT clear the mirrored `localStorage`
entry — call `useFooStore.persist.clearStorage()` from
`resetClientState` in addition.

## API access

- **All API calls go through `src/lib/api.ts`.** Never call `fetch`
  directly from a component or hook. The api module owns base URL,
  auth headers, refresh-token retry, and error shape.
- Components contain **no business logic** — use hooks in
  `src/hooks/`. Components render and dispatch; hooks orchestrate.

## Styling & design tokens

- **TailwindCSS for layout + utilities.**
- **Theme-level design tokens** (colours, typography, spacing,
  radii, shadows) live as CSS custom properties in `src/index.css`.
  Tailwind references them via `theme.extend`.
- **Themes** (`paper` default, `sepia`, `dark`) switch via
  `data-theme` on `<html>`.
- **No inline styles.** No per-component CSS files.
- **Token usage is enforced by `lint:design`**
  (`frontend/scripts/lint-design.mjs`). Raw hex colours, `rgb(...)`,
  and `hsl(...)` for theme-able values fail the lint. Use the
  `--ink-*` / `--bg-*` tokens instead.
- **Storybook is the UI source of truth.** Run
  `npm --prefix frontend run storybook` and browse `Primitives/`,
  `Tokens/`, and component-namespaced stories before authoring new
  UI. The `Tokens/` story is authoritative for hex values, type
  scale, radii, and shadows.
- **New components and new feature mockups are written as
  `*.stories.tsx`** alongside the component source. There is no
  parallel HTML mockup universe; historical mockups live read-only at
  `mockups/archive/v1-2025-11/`.

## TipTap editor

- **`useEditor` hook must have a stable reference.** Wrap dependent
  configs in `useMemo` with the right dep array; if you see
  re-render thrash or selection-loss, check this first.
- The editor's content type is the **TipTap JSON tree**, not HTML
  string. Word counts derive from the JSON tree on the backend, not
  from the rendered DOM.

## Selection bubble & keyboard shortcuts

- **Selection bubble:** apply `onMouseDown: e.preventDefault()` on
  the bubble itself so clicking it doesn't collapse the user's
  selection in the editor.
- **Keyboard shortcuts contract** (single global listener with
  scoped callbacks):
  - `⌘/Ctrl+Enter` → chat send
  - `⌥+Enter` → continue-writing
  - `Escape` → dismiss selection bubble / inline AI card / close
    modal

## Streaming AI responses

- Venice streams come back as **SSE**. Consume them with a
  `ReadableStream` reader on the response, **not**
  `fetch(...).then(r => r.json())` — JSON-parsing the stream
  body will fail.
- Streaming endpoints live under `/api/ai/*` and are routable only
  after V5+ ships. If you're touching `[F33]`–`[F42]`-class UI
  (selection bubble, inline result, chat panel, model picker),
  confirm V5+ is alive locally.

## Testing (frontend lane)

- **vitest + jsdom** for unit and component tests. **Do not** write
  jsdom tests that require a real browser — use Playwright for
  that.
- **Mock at the `src/lib/api.ts` level**, not deeper. Mocking
  individual fetches scattered across hooks misses the auth-retry
  path and is brittle.
- **Playwright** owns E2E. E2E specs assume the full stack is up
  via Docker Compose (`make dev`).
- Storybook stories double as visual fixtures and as the QA target
  for component-level regression — when you add a component, add a
  peer `*.stories.tsx`.

## TypeScript discipline

- Strict mode is on. **No `any` types.** Prefer `unknown` plus a
  narrowing guard. Use generic `T` parameters on TanStack Query
  hooks rather than casting fetched data.

## Library-version awareness

- TipTap, Vite, Tailwind, TanStack Query, and Zustand all move fast.
  **Prefer the Context7 MCP `query-docs` tool over muscle-memory
  recall** for syntax and migration questions — training data lags.
  This applies whenever you'd otherwise type out an API call from
  memory for a library that has shipped a major version in the last
  ~12 months.

## Forbidden

- JWT in `localStorage` / `sessionStorage`.
- `fetch` in a component (route everything through `src/lib/api.ts`).
- Inline styles or per-component CSS files.
- Raw hex / `rgb()` / `hsl()` for colour values that should be
  themeable (use tokens; `lint:design` will fail otherwise).
- New CSS without checking the `Tokens/` Storybook page first.
- jsdom tests that depend on browser layout (positions, scroll,
  visible-by-overflow) — promote those to Playwright.
