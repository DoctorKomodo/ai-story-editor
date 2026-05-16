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

## Frontend changes

### `frontend/src/components/VeniceErrorBanner.tsx` (new)

Wrapper around the existing `InlineErrorBanner`. Receives the same `error` + `onRetry` + `onDismiss` + `disabled` props as `InlineErrorBanner` but with a typed-narrower `error` shape that knows the Venice codes:

```ts
export interface VeniceErrorBannerProps {
  error: ApiError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}
```

It reads `error.body?.error?.code` and `error.body?.error?.retryAfterSeconds` and `error.body?.error?.details?.veniceMessage`, builds the `InlineErrorBannerError` shape from the `ApiError`, and renders per-code affordances:

| Code | Affordance |
|---|---|
| `venice_rate_limited` | Live countdown line below the headline: "Try again in 23s." Decrements each second via `setInterval(1000)`. When `retryAfterSeconds` is `null` or reaches 0, the countdown hides; Retry button remains usable throughout. |
| `venice_key_invalid` | Secondary button "Open Settings" alongside Retry. Click opens the existing `SettingsModal` (frontend/src/components/Settings.tsx) on the `'venice'` tab (the BYOK panel; it's the modal's default tab). Modal state lives in `EditorPage` (`frontend/src/pages/EditorPage.tsx:640-642`); the implementer threads a callback down to `VeniceErrorBanner` via prop on the two consumers — pick prop-drilling or a Zustand slice based on what reads cleanest. |
| `venice_key_required` | Same "Open Settings" affordance (this is the 409 emitted before any Venice call when no key is stored). |
| `venice_insufficient_balance` | External link "Top up at venice.ai →" rendered alongside Retry. Opens `https://venice.ai/settings/api` in a new tab (`target="_blank" rel="noopener noreferrer"`). |
| Other codes (`venice_unavailable`, `venice_error`, anything else) | No special affordance — generic banner rendering. |

For **every** Venice code: if `details?.veniceMessage` is present, render it under the headline as an italic small line, prefixed "Venice said: ". Always visible (not gated on debug mode). Trade-off note: Venice's raw error messages could theoretically echo parts of the request body. The backend sanitises key fragments via `SK_KEY_RE` already. If Venice ever proves to echo narrative content, we add a length-cap or a production-gate.

Trade-offs considered:
- Building this into `InlineErrorBanner` directly: rejected. `InlineErrorBanner` stays the generic primitive, reusable for non-Venice errors. `VeniceErrorBanner` is the Venice-aware composition.
- Putting per-code logic in each consumer: rejected. Every AI surface would duplicate the switch. Centralise.

### `frontend/src/components/InlineAIResult.tsx` + `frontend/src/components/messageRow/TranscriptView.tsx`

Both consumers swap their `<InlineErrorBanner …>` usage for `<VeniceErrorBanner …>`. The prop shape changes: today they pass an `InlineErrorBannerError` (a flat `{ code, message, ... }`); the new `VeniceErrorBanner` accepts the full `ApiError` so it can read `.body.error.retryAfterSeconds` etc. Each consumer already holds an `ApiError` in state — the swap is straightforward.

### `frontend/src/components/InlineErrorBanner.tsx`

Unchanged. Stays the generic primitive.

## Docs

### `docs/venice-integration.md`

Existing "Error mapping" section around line 254-258 has a per-code table that's missing `venice_insufficient_balance` and doesn't document `details.veniceMessage`. Replace it with a full "Error catalog" subsection covering all 6 codes (`venice_key_required` + the 5 from the mapper) with: HTTP status, response body shape (`VeniceErrorBody` shape with optional fields enumerated), when emitted, the `[venice.error]` log payload shape, and the frontend's user-facing rendering.

### `docs/api-contract.md`

The one-liner at line 12 currently lists `venice_key_required` and `venice_key_invalid` as "common codes". Update it to mention only the non-Venice codes (`unauthorized` / `forbidden` / `not_found` / `conflict` / `rate_limited` for our-own throttle / `internal_error`) and add: "Venice-specific codes are catalogued in `docs/venice-integration.md#error-catalog`." Per-endpoint tables further down in api-contract.md that already list specific venice_* codes (e.g. lines 81, 90-92, 260) stay as-is.

## Tests

### `backend/tests/lib/venice-errors.test.ts`

Extend (the file exists from V11/V24 work). New assertions per branch:

- `details.veniceMessage` is present on the auth / rate-limit / insufficient-balance / unavailable branches when Venice supplied a body; absent when it didn't.
- One `[venice.error]` log line is emitted per error path, parseable as JSON, with the expected `code` + `route` + `upstreamStatus` + `retryAfterSeconds` shape.
- The legacy `[V11]` prefix is gone from the log output (regression guard).
- The `ctx.route` param is plumbed through (use a stub route value `'test-route'` cast, or extend the union; the test fixtures decide).

### `frontend/src/components/VeniceErrorBanner.test.tsx` (new)

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

- `frontend/src/components/InlineErrorBanner.test.tsx`: no changes.
- `frontend/src/components/InlineErrorBanner.stories.tsx`: no changes.
- The two consumer components' tests (if any) get a fixture update to use the `ApiError` shape rather than the flat `InlineErrorBannerError`.

## File map

**Backend:**

- `backend/src/lib/venice-errors.ts` — modify (signature change, always-include veniceMessage, log-tag rename + structured payload, 3 new log lines)
- `backend/src/routes/ai.routes.ts` — modify (3 callsites pass new ctx)
- `backend/src/routes/chat.routes.ts` — modify (2 callsites pass new ctx)
- `backend/tests/lib/venice-errors.test.ts` — modify (extended assertions)

**Frontend:**

- `frontend/src/components/VeniceErrorBanner.tsx` — new
- `frontend/src/components/VeniceErrorBanner.test.tsx` — new
- `frontend/src/components/VeniceErrorBanner.stories.tsx` — new
- `frontend/src/components/InlineAIResult.tsx` — modify (swap import + prop shape)
- `frontend/src/components/messageRow/TranscriptView.tsx` — modify (swap import + prop shape)
- `frontend/src/components/InlineErrorBanner.tsx` — unchanged

**Docs:**

- `docs/venice-integration.md` — modify (Error catalog subsection)
- `docs/api-contract.md` — modify (one-line pointer update)

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
