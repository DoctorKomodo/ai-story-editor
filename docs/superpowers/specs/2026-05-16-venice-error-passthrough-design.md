# Richer Venice error passthrough — design

> **bd:** story-editor-c0c
> **Date:** 2026-05-16
> **Branch:** `feature/venice-error-passthrough`

## Why this exists

`backend/src/lib/venice-errors.ts` already emits five distinct error codes (`venice_key_invalid`, `venice_rate_limited`, `venice_insufficient_balance`, `venice_unavailable`, `venice_error`), already parses `Retry-After` + `x-ratelimit-reset-*`, and already sanitises key fragments. `frontend/src/lib/api.ts:66-75` already carries `code` + `retryAfterSeconds` + `upstreamStatus` on `ApiErrorBody`. The literal "add granular subclasses" prescription on the c0c bd issue is stale — that piece is functionally done without subclasses.

The remaining gap is operational and user-facing:

- The error response includes `details.veniceMessage` on the 400/404/422 + fallback paths, but **not** on the typed paths (auth / rate-limit / insufficient-balance / unavailable). Users see only our generic copy, never Venice's actual error text.
- `InlineErrorBanner` renders `code · message` and a Retry button. It does **not** surface the `retryAfterSeconds` countdown, does **not** render an "Open Settings" affordance on auth errors, does **not** render a "Top up credits" link on insufficient-balance, and does **not** render `details.veniceMessage` even when present.
- Three log branches inside the mapper are silent server-side (rate-limit / insufficient-balance / unavailable), so an operator tailing logs cannot see when Venice is rate-limiting users or when accounts run out of credits.
- The error-code catalog is fragmented across `docs/api-contract.md:12` (one-liner) and `docs/venice-integration.md:254-258` (partial table missing `venice_insufficient_balance`). No single canonical list.

## Scope

**In:**

- Backend: thread `details.veniceMessage` through every branch in `mapVeniceError` + `mapVeniceErrorToSse`.
- Backend: rename the log tag from the legacy `[V11]` prefix to `[venice.error]` with a structured JSON payload; replace all 5 existing log lines (3 in `mapVeniceError`, 2 in `mapVeniceErrorToSse`), add log lines on the 6 currently-silent branches (3 codes × 2 mappers: `venice_rate_limited` / `venice_insufficient_balance` / `venice_unavailable` in each of the HTTP and SSE variants). After this change, every branch in both mappers emits exactly one structured `[venice.error]` log line. Add a `ctx: { userId, route }` parameter so the log payload carries the route.
- Frontend: new `VeniceErrorBanner` wrapper that interprets Venice error codes and renders per-code affordances on top of the existing generic `InlineErrorBanner`.
- Docs: consolidate the error-code catalog into `docs/venice-integration.md`; update `docs/api-contract.md:12` to point at it.

**Out:**

- Subclass refactor of `venice-errors.ts` (current `instanceof AuthenticationError | RateLimitError` + `err.status` discriminator works; subclasses would be busywork).
- New `venice_model_unavailable` code for 404-on-model-not-found (defer until observed often enough to need a dedicated CTA; currently lumped into `venice_error`).
- Wiring p75 (rate-limit indicator). p75 stays its own task.
- Shared error-code type in `story-editor-shared`. The wire shape is stable enough as a string union in api.ts; promoting to shared adds dependency surface without a current consumer.

## Backend changes

### `backend/src/lib/venice-errors.ts`

**Structural refactor of `mapVeniceError` to mirror `mapVeniceErrorToSse`.** Today each branch in `mapVeniceError` (auth / rate-limit / 402 / 5xx / 4xx-forwarded / fallback) embeds `code` and `retryAfterSeconds` as literals inline inside the response JSON, then returns. To share a single `[venice.error]` log call with consistent shape across branches, hoist per-branch state to locals first — exactly the shape `mapVeniceErrorToSse` already uses (`let code: string; let message: string; let retryAfterSeconds: number | null | undefined; let httpStatus: number`). After hoisting, write the response and emit the structured log at the bottom of the function. Removes the asymmetry between the two mappers and makes the log call a single statement.

**Signature change.** Both mappers gain a context param so the log payload can carry the route:

```ts
type VeniceErrorContext = {
  userId: string | undefined;
  route: 'ai-models' | 'ai-complete' | 'chat';
};

export function mapVeniceError(err: unknown, res: Response, ctx: VeniceErrorContext): boolean;
export function mapVeniceErrorToSse(
  err: unknown,
  write: (data: string) => void,
  ctx: VeniceErrorContext,
): boolean;
```

Replaces the existing optional `userId?: string` param. Five callers update (ai.routes.ts:59, ai.routes.ts:320 (SSE), ai.routes.ts:337, chat.routes.ts:619 (SSE), chat.routes.ts:636).

**`details.veniceMessage` on every branch.** Hoist the `extractVeniceMessage` + `sanitiseVeniceMessage` work to the top of each mapper function so every branch can include it. Current code only includes it on 400/404/422 + fallback; after this change, also include it on `venice_key_invalid` / `venice_rate_limited` / `venice_insufficient_balance` / `venice_unavailable`. When `extractVeniceMessage` returns nothing (Venice didn't send a body), the `details` field stays absent — same shape as today on the no-body case.

**Log tag rename + structured payload.** Replace all 5 existing `console.error('[V11] …')` lines and add 6 new lines on the currently-silent branches (rate-limit / insufficient-balance / unavailable, in both the HTTP and SSE mappers). Single shape across all 11 branches (6 in `mapVeniceError`, 5 in `mapVeniceErrorToSse`):

```ts
console.error(
  '[venice.error]',
  JSON.stringify({
    route: ctx.route,
    userId: ctx.userId ?? null,
    code,
    upstreamStatus: err.status,
    retryAfterSeconds: retryAfterSeconds ?? null,  // null when N/A
    veniceMessage: veniceMessage ?? null,           // null when Venice sent no body
    streaming,                                       // true for mapVeniceErrorToSse, false for mapVeniceError
  }),
);
```

This pairs with the success-side `[venice.params]` log from story-editor-myi: every Venice request emits exactly one server-side line — success → `[venice.params]`, failure → `[venice.error]`. The two tags grep cleanly and the structured JSON payload is stable enough for log indexers.

**No payload-shape change visible to the client** for the error response body itself beyond the now-always-present `details.veniceMessage`. `VeniceErrorBody` interface unchanged; existing fields preserved.

### `backend/src/routes/ai.routes.ts` and `backend/src/routes/chat.routes.ts`

Pass `{ userId, route: 'ai-models' | 'ai-complete' | 'chat' }` instead of the bare `userId` at each callsite. No other logic changes.

### `backend/src/index.ts` — `venice_key_required` headline fix

The `NoVeniceKeyError` branch at line 147-152 currently emits `{ message: 'venice_key_required', code: 'venice_key_required' }` — both fields carry the code string, so the frontend's `InlineErrorBanner` renders "venice_key_required · venice_key_required" as the headline. Change the `message` field to a user-friendly string (the `code` stays unchanged so frontend switches still work):

```ts
res.status(409).json({
  error: {
    message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
    code: 'venice_key_required',
  },
});
```

Pairs with the VeniceErrorBanner "Open Settings" affordance — together they give the user a readable line plus a one-click path to fix it.

## Frontend changes

### `frontend/src/components/VeniceErrorBanner.tsx` (new)

Wrapper around the existing `InlineErrorBanner`. Takes a **flat shape** — not the raw `ApiError` — so the two consumers can each pre-flatten using their existing flatteners (more on the friction below):

```ts
export interface VeniceErrorBannerError {
  code: string | null;
  message: string;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
  httpStatus?: number;
  detail?: unknown;
}

export interface VeniceErrorBannerProps {
  error: VeniceErrorBannerError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}
```

This is `InlineErrorBannerError` plus two optional fields (`retryAfterSeconds`, `veniceMessage`). Building from a flat shape keeps `VeniceErrorBanner` decoupled from the `ApiError` class and matches the existing `InlineErrorBannerError` contract the codebase already uses. It reads `error.code`, `error.retryAfterSeconds`, and `error.veniceMessage` to render per-code affordances:

| Code | Affordance |
|---|---|
| `venice_rate_limited` | Live countdown line below the headline: "Try again in 23s." Decrements each second via `setInterval(1000)`. When `retryAfterSeconds` is `null` or reaches 0, the countdown hides; Retry button remains usable throughout. |
| `venice_key_invalid` | Secondary button "Open Settings" alongside Retry. Click opens the existing `SettingsModal` (frontend/src/components/Settings.tsx) on the `'venice'` tab. Implemented via a new Zustand slice (see "Settings-modal access pattern" below) — VeniceErrorBanner calls `useSettingsModalStore.getState().openWith('venice')` directly; no prop threading. |
| `venice_key_required` | Same "Open Settings" affordance (this is the 409 emitted before any Venice call when no key is stored). |
| `venice_insufficient_balance` | External link "Top up at venice.ai →" rendered alongside Retry. Opens `https://venice.ai/settings/api` in a new tab (`target="_blank" rel="noopener noreferrer"`). |
| Other codes (`venice_unavailable`, `venice_error`, anything else) | No special affordance — generic banner rendering. |

For **every** Venice code: if `error.veniceMessage` is present, render it under the headline as an italic small line, prefixed "Venice said: ". Always visible (not gated on debug mode). **Truncate at 280 characters** (`error.veniceMessage.slice(0, 280)` + ellipsis when truncated) — cheap insurance against Venice echoing long request fragments in error bodies (param-validation 400/422s do echo request shape today). Doesn't preclude a production-gate fallback later if Venice ever proves to echo narrative content; the backend already sanitises key fragments via `SK_KEY_RE`.

Trade-offs considered:
- Building this into `InlineErrorBanner` directly: rejected. `InlineErrorBanner` stays the generic primitive, reusable for non-Venice errors. `VeniceErrorBanner` is the Venice-aware composition.
- Putting per-code logic in each consumer: rejected. Every AI surface would duplicate the switch. Centralise.

### Consumer-side changes (not a one-line swap)

The two consumers do not currently hold a shape that has `retryAfterSeconds` / `veniceMessage` — both flatten `ApiError` to their own narrower shapes before storing/passing. Each needs its error shape widened.

**`frontend/src/store/inlineAIResult.ts` (widen `InlineAIResultError`):** Today `InlineAIResultError` is `{ code, message, httpStatus?, detail? }`. Add two optional fields:

```ts
export interface InlineAIResultError {
  code: string | null;
  message: string;
  httpStatus?: number;
  detail?: unknown;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
}
```

**`frontend/src/pages/EditorPage.tsx` (extend the flattener at lines 399-406):** The flattener that builds `InlineAIResultError` from `completion.error: ApiError` reads `err.code`, `err.message`, `err.status` today. Extend it to also read `err.body?.error?.retryAfterSeconds` and `err.body?.error?.details?.veniceMessage` and include them in the stored shape. Single function, six lines changed.

**`frontend/src/components/InlineAIResult.tsx`:** The render path reads from the store (`useInlineAIResultStore`) and gets the widened `InlineAIResultError`. Swap its `<InlineErrorBanner error={…} />` for `<VeniceErrorBanner error={…} />`. The flat shape lines up.

**`frontend/src/components/messageRow/TranscriptView.tsx`:** Two banner sites. **Only the send-error branch at line 195 swaps to `VeniceErrorBanner`** — the query-error branch at line 154-163 (transcript-load failure) is not a Venice error and stays `InlineErrorBanner`. The send-error path needs three updates:
- Widen the `sendError` prop type from `Error | null` to `ApiError | null` at line 29.
- Update the banner-error builder at line 182 to read `sendError?.body?.error?.retryAfterSeconds` / `…?.details?.veniceMessage` and produce the flat `VeniceErrorBannerError` shape.
- Confirm the mutation-hook generics in `SceneTab.tsx:245` and `ChatTab.tsx:221` already produce `ApiError` (TanStack throws via api.ts's `ApiError` class — likely already typed correctly, but the prop-type widening exposes any drift).

### `frontend/src/components/InlineErrorBanner.tsx`

Unchanged. Stays the generic primitive.

### Settings-modal access pattern

Currently `EditorPage.tsx:153-154` owns the modal state as local `useState`. Five setter callsites inside EditorPage (lines 460, 585-586, 589, 644-645) plus the mount at 640-646 are the only consumers. To let `VeniceErrorBanner` open the modal without prop-drilling through three layers, extract a small Zustand slice:

```ts
// frontend/src/store/settingsModal.ts (new)
import { create } from 'zustand';
import type { SettingsTab } from '@/components/Settings';

interface SettingsModalState {
  open: boolean;
  initialTab: SettingsTab | undefined;
  openWith: (tab?: SettingsTab) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  initialTab: undefined,
  openWith: (tab) => set({ open: true, initialTab: tab }),
  close: () => set({ open: false, initialTab: undefined }),
}));
```

`EditorPage.tsx` migrates: drop the two `useState` declarations, swap each setter callsite for the store action (`useSettingsModalStore.getState().openWith(undefined)` for the no-tab opens, `…openWith('models')` for the models-tab open), and the modal mount reads `open` / `initialTab` from the store hook + binds `onClose` to `close`. `VeniceErrorBanner` imports the store and calls `openWith('venice')` on the "Open Settings" click. No prop drilling.

## Docs

### `docs/venice-integration.md`

The existing "Error Handling ([V11])" section at line 250-260 needs a **full replacement**, not a row addition. Stale items to remove or correct:

- Header references `[V11]` task ID — drop the bracketed reference.
- Line 254 still mentions `500 { code: "internal_error" }` on a server-wide path that no longer exists post-`[AU13]` — remove that row entirely.
- Line 256 says 429 maps to `rate_limited` — actual mapper emits `venice_rate_limited` (distinct from our-own per-user `rate_limited` throttle).
- Missing `venice_insufficient_balance` (added in `[V24]`).
- Missing the `venice_error` catch-all that the mapper falls through to on 4xx-forwarded / unexpected status.
- No mention of `details.veniceMessage` even though the mapper already includes it on 400/404/422 + fallback.

Replace with a full "Error catalog" subsection covering all 6 codes (`venice_key_required` + the 5 from the mapper: `venice_key_invalid`, `venice_rate_limited`, `venice_insufficient_balance`, `venice_unavailable`, `venice_error`) with: HTTP status, response body shape (`VeniceErrorBody` shape with optional `retryAfterSeconds` + optional `details.veniceMessage` enumerated), when emitted, the `[venice.error]` log payload shape, and the frontend's user-facing rendering (link to `VeniceErrorBanner`'s per-code behaviour table).

### `docs/api-contract.md`

The one-liner at line 12 currently lists `venice_key_required` and `venice_key_invalid` as "common codes". Update it to mention only the non-Venice codes (`unauthorized` / `forbidden` / `not_found` / `conflict` / `rate_limited` for our-own throttle / `internal_error`) and add: "Venice-specific codes are catalogued in `docs/venice-integration.md#error-catalog`." Per-endpoint tables further down in api-contract.md that already list specific venice_* codes (e.g. lines 81, 90-92, 260) stay as-is.

## Tests

### `backend/tests/lib/venice-errors.test.ts`

Extend (the file exists from V11/V24 work). New assertions per branch:

- `details.veniceMessage` is present on the auth / rate-limit / insufficient-balance / unavailable branches when Venice supplied a body; absent when it didn't.
- One `[venice.error]` log line is emitted per error path, asserted via a `console.error` spy (`vi.spyOn(console, 'error')`), with the expected `code` + `route` + `upstreamStatus` + `retryAfterSeconds` shape in the second argument's parsed JSON.
- The legacy `[V11]` prefix does not appear in **any** `console.error` spy call from the mapper paths (regression guard, asserted against spy calls — not file content; the comment headers at venice-errors.ts:1 and :116 still reference V11/V11+ as file bookkeeping and stay).
- The `ctx.route` param is plumbed through. The function signature requires `route: 'ai-models' | 'ai-complete' | 'chat'`; tests pass concrete values.

### `frontend/tests/components/VeniceErrorBanner.test.tsx` (new — tests live under `frontend/tests/`)

One test per code-branch:

- `venice_rate_limited` with `retryAfterSeconds: 5`: countdown line renders "Try again in 5s"; after fake-timer-advance of 1s renders "Try again in 4s"; after 5s the countdown line disappears but the Retry button remains.
- `venice_key_invalid`: "Open Settings" button is present and calls the supplied navigation handler.
- `venice_key_required`: same.
- `venice_insufficient_balance`: external "Top up at venice.ai →" link is present with `target="_blank"` and `rel="noopener noreferrer"`.
- `venice_unavailable`: no special affordance; generic rendering.
- `venice_error` with `details.veniceMessage = "Foo"`: "Venice said: Foo" line is rendered.
- `venice_rate_limited` with `details.veniceMessage = "Bar"`: both countdown AND veniceMessage line render.
- Null `details.veniceMessage`: no veniceMessage line.

### `frontend/src/components/VeniceErrorBanner.stories.tsx` (new)

One story per code-branch covering the same shapes. Existing `InlineErrorBanner.stories.tsx` stays as the generic primitive's stories.

### Existing test files

- `frontend/tests/components/InlineErrorBanner.test.tsx`: no changes (banner primitive unchanged).
- `frontend/src/components/InlineErrorBanner.stories.tsx`: no changes (stories co-located with source; banner primitive unchanged).
- `frontend/tests/components/InlineAIResult.test.tsx` (if present) and any TranscriptView-related test fixtures: update to construct the widened `InlineAIResultError` shape (with `retryAfterSeconds` / `veniceMessage` fields) and to pass an `ApiError`-shaped `sendError` rather than a bare `Error`.
- Tests covering the EditorPage flattener (lines 399-406) get a new assertion that `retryAfterSeconds` + `veniceMessage` flow through from a rate-limit-shaped `ApiError`.

## File map

**Backend:**

- `backend/src/lib/venice-errors.ts` — modify (structural refactor of `mapVeniceError` to mirror SSE shape, signature change to take `ctx`, always-include `details.veniceMessage`, log-tag rename + structured payload, 6 new log call-sites)
- `backend/src/routes/ai.routes.ts` — modify (3 callsites pass new `ctx`)
- `backend/src/routes/chat.routes.ts` — modify (2 callsites pass new `ctx`)
- `backend/src/index.ts` — modify (1-line message-field fix on the `NoVeniceKeyError` branch at line 149)
- `backend/tests/lib/venice-errors.test.ts` — modify (extended assertions, console.error spy assertions, regression guard)

**Frontend:**

- `frontend/src/components/VeniceErrorBanner.tsx` — new
- `frontend/src/components/VeniceErrorBanner.stories.tsx` — new (stories live alongside source)
- `frontend/tests/components/VeniceErrorBanner.test.tsx` — new (tests live under `frontend/tests/`)
- `frontend/src/store/settingsModal.ts` — new (Zustand slice; see "Settings-modal access pattern")
- `frontend/src/store/inlineAIResult.ts` — modify (widen `InlineAIResultError` with two optional fields)
- `frontend/src/pages/EditorPage.tsx` — modify (extend flattener at lines 399-406; migrate 5 setter callsites + 1 modal mount to `useSettingsModalStore`; drop two `useState` declarations at lines 153-154)
- `frontend/src/components/InlineAIResult.tsx` — modify (swap `<InlineErrorBanner>` → `<VeniceErrorBanner>`; the store shape already produced is now wider)
- `frontend/src/components/messageRow/TranscriptView.tsx` — modify (widen `sendError` prop type at line 29 to `ApiError | null`; update banner-error builder at line 182; swap only the send-error banner at line 195 — leave the query-error banner at line 154 as `InlineErrorBanner`)
- `frontend/src/components/SceneTab.tsx` + `frontend/src/components/ChatTab.tsx` — likely modify (confirm mutation-hook generics produce `ApiError`; small or no change expected)
- `frontend/src/components/InlineErrorBanner.tsx` — unchanged

**Docs:**

- `docs/venice-integration.md` — modify (full replacement of the "Error Handling ([V11])" section at lines 250-260 with a comprehensive "Error catalog" subsection)
- `docs/api-contract.md` — modify (line 12 one-line pointer update)

## Verify

```
npm -w story-editor-backend run typecheck && \
npm -w story-editor-backend test -- tests/lib/venice-errors && \
npm -w story-editor-frontend run typecheck && \
npm -w story-editor-frontend test -- tests/components/VeniceErrorBanner tests/components/InlineErrorBanner
```

(Backend tests require `make dev` up per the bd-verify-line-backend-test-needs-stack memory; the verify line above will be run by `/bd-close-reviewed` after a `make dev` precheck if needed.)

## Risks and notes

- **Venice could echo narrative content in error messages.** We're trusting it doesn't. If proven wrong, switch the veniceMessage rendering to production-gated (mirroring the existing dev-only "Show raw" toggle pattern in `InlineErrorBanner`). The leak test ([E12]) does not currently cover this surface (the error response body is not "narrative content stored in a row"); a follow-up could extend it.
- **The `ctx` param is a breaking signature change** on `mapVeniceError` and `mapVeniceErrorToSse`. Both are internal — no external consumers. All 5 callsites update in this PR.
- **`venice_key_required` and `venice_rate_limited` from our own per-user limit** (`rate_limited` / `account_rate_limited` in api-contract.md:91) are distinct codes from Venice's `venice_rate_limited`. The VeniceErrorBanner doesn't handle the non-Venice rate-limit; that's the existing generic `InlineErrorBanner` fallthrough.
- **`p75` (shared rate-limit indicator)** is still open. After p75 ships, the rate-limit countdown in VeniceErrorBanner could read from the shared store too — but this PR doesn't require p75, and p75 doesn't require this PR. Sequence-independent.
