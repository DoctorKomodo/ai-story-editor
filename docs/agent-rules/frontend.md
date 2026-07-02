# Frontend Rules Digest

> **Read by:** `/bd-execute` prepends this file to the implementer +
> task-reviewer prompts when the plan's touch-set includes
> frontend code (per `docs/agent-rules/index.md`). Keep prose tight,
> imperative, and self-contained — the implementer/reviewer subagent
> will not read other docs at dispatch time.

## Lane

`frontend/**` — React + Vite + TypeScript + TailwindCSS + TipTap +
Zustand + TanStack Query. Single SPA served at `:3000` in dev. Talks
to the backend at `/api/*`; never talks to Venice.ai directly.

## Authentication & session

- Authentication uses an opaque httpOnly **session cookie** set by
  `POST /auth/login`. The frontend never reads it — the browser sends
  it automatically on every request via `credentials: 'include'`.
- **There is no JS-held JWT, no Bearer header, no refresh-token
  cookie, and no `/auth/refresh` endpoint.** Do not add these.
- A **401 is terminal**. There is no silent-refresh or retry dance.
  On any 401 from any API call, `onUnauthorized` fires, client state
  is reset, and the user is routed to /login. The backend
  distinguishes `session_expired` (cookie present, session gone —
  e.g. after a server restart) from `unauthorized` (no cookie), but
  the frontend currently treats both identically via the single
  `onUnauthorized` handler (`frontend/src/lib/api.ts`) — there is
  **no** code-specific branch and no "session expired" banner
  (known UX gap, documented in `docs/encryption.md`'s 401-handling
  step; the server-side code split exists so the frontend can adopt
  a distinct banner later without an API change).
  Both paths clear the session slice and all per-user stores.
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

- **Zustand for client / UI state** — e.g. `session`, `activeChapter`,
  `sidebarTab`, `ui` (layout mode), `selection`, `inlineAIResult`,
  `attachedSelection`, `chatDraft`, `composerDraft`, `selectedCharacter`,
  `errors`. (Model / params / theme / prose settings are **server** state
  via `useUserSettings`, not a Zustand store.)
- **TanStack Query for server state** — stories, chapters, characters,
  outline, chats + messages, user-settings, venice account / key status,
  AI models, default prompts. Query-key + hook + mutation conventions live
  under "Data fetching & mutations".
- **No other stores.** No Redux, no MobX, no React Context for app
  data. (Context is fine for inert tree-wide things like theme or
  router primitives.)
- **Store shape:** `create<T>()` over an `initialState`, with a `reset()`
  that restores it. A domain `clear()` is a separate action — `clear` is a
  UI gesture (e.g. dismiss the current selection); `reset` is the
  account-switch lifecycle hook (next section). Don't conflate them.

## Per-user state must reset on auth transition

Any new Zustand store under `frontend/src/store/*.ts` that holds
plaintext content, IDs referencing user-owned rows, or any state that
should not survive a session swap must be added to `PER_USER_STORES` in
`frontend/src/lib/sessionReset.ts` AND to the `PER_USER_STORES`
allowlist in `frontend/tests/lib/sessionReset.test.ts`. The reset helper
has zero shape knowledge — it just calls each store's `reset()`.

UI-only stores (layout, sidebar tab, settings modal) go on the
`UI_ONLY_STORES` allowlist instead. The enumeration test fails on
unclassified stores — pick one explicitly.

Every auth-transition site must reset before flipping the session slice:
- `useAuth.login` → `swapSession(qc, user, token)` (atomic).
- `useAuth.logout` → `await resetClientState(qc); clearSession();`
- `useSignOutEverywhereMutation.onSuccess` → `await resetClientState(qc); clearSession(); navigate(...);`
- `useDeleteAccountMutation.onSuccess` → same shape.
- `handleUnauthorizedAccess` (terminal-401, non-React) → `void resetClientStateUsingRegistered();` then the existing setState.

`resetClientState` aborts in-flight streams, cancels + clears the query
cache, then resets every `PER_USER_STORES` entry — in that order. If you
add a store that uses Zustand's `persist` middleware, `reset()` does NOT
clear the mirrored `localStorage` entry — call
`useFooStore.persist.clearStorage()` from `resetClientState` too.

## Data fetching & mutations

The TanStack Query layer has a rigid house style — match it.

- **All API calls go through `src/lib/api.ts`.** Never call `fetch`
  directly from a component or hook. The api module owns base URL,
  `credentials: 'include'`, and the error shape. There is no Bearer
  header — the session cookie is sent automatically.
- **`api<T>(path, init?)`** resolves to parsed JSON (or `undefined` for a
  204). Pass a plain object as `init.body` and it is **auto-JSON-
  stringified** with `Content-Type: application/json` — never hand-
  stringify. `credentials: 'include'` is added for you.
- **Reads validate the response with the shared Zod schema.** The pattern
  is `api<unknown>(path)` then `<schema>.parse(res).<field>` (e.g.
  `storyResponseSchema.parse(raw).story`). The shared schema is the
  wire-contract gate — the mirror of the backend's `respond()`. **Parse
  fetched data; don't cast it.** (That parse is also why query hooks don't
  need a generic `T` — the parse yields the type.)
- **`ApiError` is the thrown error contract.** A non-2xx throws
  `ApiError(status, message, code?, body?)` exposing `.status`, `.code`,
  and `.body.error.{ code, message, details?.veniceMessage,
  retryAfterSeconds? }`. Every catch / error banner keys off this —
  including the backend's structured `venice_*` codes. A 401 is
  terminal: it fires the unauthorized handler and throws — there is no
  refresh or retry.
- **Query keys are exported factories**, not inline arrays:
  - single entity → `['<entity>', id]` (`storyQueryKey(id)` →
    `['story', id]`).
  - list → `['<plural>']` or `['<plural>', parentId]` (`storiesQueryKey`
    → `['stories']`; `chaptersQueryKey(storyId)` → `['chapters',
    storyId]`). **There is no `'list'` segment.**
  - sub-resource nested under a parent → append the child segment(s)
    (`chatsQueryKey(chapterId, kind)` → `['chapter', chapterId, 'chats',
    kind]`; `chatMessagesQueryKey(chatId)` → `['chat', chatId,
    'messages']`). Register individual queries with the **full** key, but
    **invalidate with the prefix** (`chatsBaseQueryKey(chapterId)` →
    `['chapter', chapterId, 'chats']`) so TanStack's prefix-match sweeps
    every variant (e.g. both `kind`s).
- **Hook names:** `use<Entity>Query` / `use<Plural>Query(parentId?)` for
  reads, `use<Verb><Entity>Mutation` for writes (`useStoryQuery`,
  `useChaptersQuery`, `useCreateChapterMutation`).
- **Mutations that shouldn't wait for the round-trip use the
  optimistic-rollback pattern:** `onMutate` (`cancelQueries` → snapshot via
  `getQueryData` → optimistic `setQueryData` → return the snapshot as
  context) / `onError` (restore from context) / `onSettled`
  (`invalidateQueries` so the server's truth wins) / `onSuccess` (targeted
  `setQueryData`). Plain create/update mutations may just
  `invalidateQueries` in `onSuccess`.
- **List caches are metadata-only; the single-entity query owns the heavy
  field.** The chapters list holds `ChapterMeta` (no `bodyJson`); the
  single-chapter query is the sole authority for the body. On update, write
  the stripped meta to the list cache **and** the full entity to the
  per-entity cache; on delete, **evict** the per-entity cache
  (`removeQueries`) so a stale hit can't resurrect deleted content.
- **`QueryClient` defaults** (`src/lib/queryClient.ts`): `staleTime` 30s,
  one retry but **never on 401** (api.ts already did the refresh dance),
  `refetchOnWindowFocus: false`, mutations don't retry.
- Components contain **no business logic** — hooks in `src/hooks/`
  orchestrate; components render and dispatch.

## Styling & design tokens

- **TailwindCSS for layout + utilities.**
- **Theme-level design tokens** (colours, typography, spacing,
  radii, shadows) live as CSS custom properties in `src/index.css`.
  Tailwind v4 exposes them via the CSS-first `@theme` block in that file
  (not a `tailwind.config` `theme.extend`).
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

- Streaming endpoints live under `/api/ai/*` (inline AI result card,
  chat/scene send, continue-writing). Consume them via `apiStream()`
  (`src/lib/api.ts`) + the SSE reader in `src/lib/sse.ts` /
  `streamingAI.ts` — **never** `fetch(...).then(r => r.json())`, which
  fails on an SSE body.
- **Register every stream's `AbortController` with `streamRegistry`**
  (`registerStream()`). `resetClientState` calls `abortAllStreams()` first
  on any auth transition; an unregistered stream keeps writing chunks into a
  store that has just been reset under the next session.

## Errors & banners

- A caught `ApiError` is surfaced one of two ways: pushed to the `errors`
  store (`useErrorStore.push({ severity, source, code, message,
  httpStatus })`, capped at 50) for toast display, or rendered as an inline
  / Venice banner. `extractVeniceMessage(err.body)`
  (`src/lib/veniceError.ts`) pulls the human-readable Venice detail from
  `body.error.details.veniceMessage`. Branch on `err.code` (the `venice_*`
  / `validation_error` codes) for user-facing copy rather than echoing
  `err.message` raw.

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
- Pure logic that's hard to drive under jsdom (drag reorder, optimistic
  cache math) is factored into exported pure helpers (`arrayMove`,
  `computeReorderedChapters`, …) and unit-tested directly. Follow that when
  adding similar logic.

## Library-version awareness (frontend lane)

- Fast-movers to version-check before pinning: TipTap, Vite, Tailwind,
  TanStack Query, Zustand. (The Context7-over-muscle-memory principle and
  the dependency policy live in `general.md`.)

## Forbidden

- JWT, access tokens, or session identifiers in `localStorage` / `sessionStorage`.
- `fetch` in a component (route everything through `src/lib/api.ts`).
- Casting fetched data to a type instead of parsing it with the shared
  schema.
- A streaming call whose `AbortController` isn't registered with
  `streamRegistry`.
- Inline styles or per-component CSS files.
- Raw hex / `rgb()` / `hsl()` for colour values that should be
  themeable (use tokens; `lint:design` will fail otherwise).
- New CSS without checking the `Tokens/` Storybook page first.
- jsdom tests that depend on browser layout (positions, scroll,
  visible-by-overflow) — promote those to Playwright.
