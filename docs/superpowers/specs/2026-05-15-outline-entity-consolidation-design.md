# OutlineItem entity consolidation — design

**bd:** `story-editor-lrd` — Migrate OutlineItem Zod schemas to `story-editor-shared`.

**Pattern source:** PR #100 (Character entity consolidation), PR #104 (Message entity
consolidation), PR #105 (Story entity consolidation). The `shared/` workspace, the `respond()`
egress helper, the `serialize*` handler-boundary converters (explicit-pick form), and the
`*ResponseSchema.parse(…)` frontend runtime-validation idiom are all in place. This design extends
them to `OutlineItem`. No new dependencies, no Prisma schema or migration changes — OutlineItem's
columns are already in their post-`[E11]` ciphertext-only shape.

## Goal

One canonical `OutlineItem` Zod schema set in `story-editor-shared`. Rip out the inline backend
request validators (`CreateOutlineBody` / `UpdateOutlineBody` / `ReorderOutlineBody` in
`backend/src/routes/outline.routes.ts`) and the frontend hand-rolled `OutlineItem` /
`OutlineListResponse` / `OutlineItemResponse` / `CreateOutlineInput` / `UpdateOutlinePatch` /
`UpdateOutlineInput` interfaces in `frontend/src/hooks/useOutline.ts`. Apply the
`respond(schema, res, data)` egress pattern to every surviving outline handler. Add
`serializeOutlineItem` at the handler boundary (explicit-pick form, locked by a stray-key
assertion in `serialize.test.ts`). Opt `outline.repo.ts` into the typed
`projectDecrypted<RepoOutlineItem>` form. Define `OUTLINE_ENCRYPTED_FIELD_KEYS` co-located with the
schema. Add frontend runtime validation of API responses. Rip-and-replace in one PR; no incremental
dual-definitions.

## OutlineItem-specific differences from the established pattern

The previous three migrations are the template. OutlineItem diverges in three real ways. Each is
called out here so the implementation doesn't blindly copy Character/Message/Story.

### 1. Reorder endpoint — port verbatim from Character

OutlineItem already has the same `PATCH /reorder` shape as Character. Confirmed at
[characters.routes.ts:97-143](../../backend/src/routes/characters.routes.ts): the imperative
duplicate-id / duplicate-`orderIndex` checks live in the route, not in `characterReorderSchema`,
because the error contract returns a specific human message per failure that Zod's `.refine()`
default formatting wouldn't preserve cleanly. **OutlineItem follows the same pattern.** Shared
package adds `outlineReorderSchema` with the array-of-`{id, order}` shape (max 500 items, same as
today's inline `ReorderOutlineBody`); the imperative dup checks stay in the route. Field name is
`order`, not `orderIndex` (matching the existing wire contract; Outline is the first migrated
entity to use bare `order` — Character / Chapter use `orderIndex`).

### 2. Two narrative-encrypted fields, both nullable in different ways

`OUTLINE_ENCRYPTED_FIELD_KEYS = ['title', 'sub'] as const`. `title` is required + non-empty + max
300 on create. `sub` is `.max(2000).nullable().optional()` on both create and update. The encrypted
column count and the asymmetry between the two fields' nullability is the only knob worth naming
explicitly — both create and update paths read both keys.

### 3. `status` stays free-form `z.string().min(1).max(40)`

This is **deliberate, not a tightening opportunity.** The existing route comment at
[outline.routes.ts:28-30](../../backend/src/routes/outline.routes.ts) is explicit: "frontend uses
'queued' / 'active' / 'done' today, but there's no server-side enum contract yet." The frontend's
`OutlineStatus = 'queued' | 'active' | 'done'` union at
[useOutline.ts:25](../../frontend/src/hooks/useOutline.ts) is a UI rendering convention, not a
wire contract. The DB column at [schema.prisma:175](../../backend/prisma/schema.prisma) is plain
`String` (no Prisma `enum`). So the loose contract is preserved end-to-end: `status: z.string()` on
the entity, `z.string().min(1).max(40)` on create/update. `OutlineStatus` is **not** exported from
`story-editor-shared` — the package's surface today is wire-contract-only (schemas, derived
`z.infer<>` types, encrypted-field-keys tuples). UI narrowing stays in
`frontend/src/hooks/useOutline.ts`. Parallel to Story not having an enum for `genre`.

## Non-divergences (verified, called out to pre-empt review questions)

- **`order` on the base entity schema.** Character has `orderIndex: z.number().int().nonnegative()`
  on `characterSchema` ([shared/src/schemas/character.ts:19](../../shared/src/schemas/character.ts)).
  Outline's `order` on `outlineItemSchema` matches that established pattern. The POST handler's
  race-retry (`POST_ORDER_RETRY_ATTEMPTS = 3`, `@@unique([storyId, order])`, P2002 catch) is
  plumbing, not schema — stays in the route untouched.
- **No `userId` on outline rows.** OutlineItem rows carry `storyId`, not `userId` (unlike Story
  rows). So Story-divergence #1 (`serializeStory` picks to drop the wire-leaking `userId`) doesn't
  apply. `serializeOutlineItem` still uses **explicit pick** for the established Story-PR pattern —
  pick is the load-bearing form across all four `serialize*` helpers, not a per-entity opt-in.
- **`OutlineNotOwnedError` → 403 stays as-is.** The custom error class at
  [outline.repo.ts:39-44](../../backend/src/repos/outline.repo.ts) is thrown from `reorder()` when
  any id in the batch doesn't resolve under `storyId` for the caller. The route's catch at
  [outline.routes.ts:163-167](../../backend/src/routes/outline.routes.ts) maps it to a 403 with a
  stock `{ error: { message, code } }` body. **Migration does not touch this path** for two
  reasons: (a) error responses don't go through `respond()` in this codebase — the Story PR is
  explicit that "404 / race-condition branches are unchanged — they still respond with the plain
  `{ error: … }` shape, not via `respond()`" — and the 403 here follows the same convention; (b)
  the error is an authorization primitive (the repo deliberately collapses "unknown id" /
  "wrong-story id" / "wrong-owner id" into one error so the endpoint is not an id-enumeration
  oracle, per the [comment at outline.repo.ts:35-37](../../backend/src/repos/outline.repo.ts)),
  which is below the Zod-migration layer. Naming it as a non-divergence pre-empts the reviewer
  question "why doesn't the reorder route's 403 branch go through `respond()`?"
- **No prompt-input projection.** `prompt.service.ts` does not reference outline. So no
  `OutlinePromptInput` / `toOutlinePromptInput` — parallel to Story divergence #2 and
  Message-as-a-whole. `OUTLINE_ENCRYPTED_FIELD_KEYS` exists only to feed `outline.repo.ts`'s
  `ENCRYPTED_FIELDS`. It still lives in `shared/` despite having a single (repo) consumer —
  co-location with the schema describing the same entity is the established pattern.
- **No `OutlineModal` consumer.** The Story PR rewired `StoryModal` to import shared `STORY_*_MAX`
  constants. There is no equivalent component for Outline today — `EditorPage` passes
  `onAddItem={() => undefined}` and `onEditItem={() => undefined}` stubs to `OutlineTab` (filed
  as `story-editor-syb`). `OUTLINE_*_MAX` constants still ship from shared with `outlineCreateSchema`
  as their sole consumer in this PR; when `story-editor-syb` lands and the modal is built, it
  imports them. This is the most important asymmetry vs the Story PR: do not invent a modal to
  feed the constants. The bd ticket for the missing UX is filed and orthogonal.
- **Frontend reorder helpers stay in the hook.** `computeReorderedOutline`, `arrayMove`,
  `withSequentialOrder` at [useOutline.ts:150-185](../../frontend/src/hooks/useOutline.ts) are
  frontend-only optimistic-reorder helpers, not wire contract. They stay in
  `frontend/src/hooks/useOutline.ts`. Same treatment as `useChapters.ts`.
- **Encryption leak test coverage unchanged.** Outline `title` and `sub` sentinel writes are
  already in [backend/tests/security/encryption-leak.test.ts:115-119](../../backend/tests/security/encryption-leak.test.ts).
  The Outline table is in the column scan and no schema columns change in this PR, so coverage is
  untouched; the verify line runs the test for regression confidence only.

## Shared schemas — `shared/src/schemas/outline.ts`

All object schemas are `z.strictObject` (rejects unknown keys at every layer — the load-bearing
invariant that closes the Prisma↔Zod drift seam at egress-validation time, same as `character.ts` /
`message.ts` / `story.ts`).

| Symbol | Shape | Used by |
|---|---|---|
| `outlineItemSchema` | base entity | `GET /:id`, `POST`, `PATCH` responses; element of list |
| `outlineCreateSchema` | request body for `POST` | `outline.routes.ts`, repo `OutlineCreateInput` |
| `outlineUpdateSchema` | `outlineCreateSchema.partial().extend({ order })` | request body for `PATCH`, repo `OutlineUpdateInput` |
| `outlineReorderSchema` | `{ items: [{id, order}] }`, 1..500 items | request body for `PATCH /reorder` |
| `outlineItemResponseSchema` | `{ outlineItem: outlineItemSchema }` | `respond()` on `GET /:id`, `POST`, `PATCH` |
| `outlineListResponseSchema` | `{ outline: outlineItemSchema[] }` | `respond()` on `GET /` |
| `OUTLINE_ENCRYPTED_FIELD_KEYS` | `['title', 'sub'] as const` | `outline.repo.ts` `ENCRYPTED_FIELDS` |
| `OUTLINE_TITLE_MAX = 300`, `OUTLINE_SUB_MAX = 2000`, `OUTLINE_STATUS_MAX = 40` | field-length caps | `outlineCreateSchema`; future `OutlineModal` |

Field-level shapes:

```ts
outlineItemSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  sub: z.string().nullable(),
  status: z.string(),
  order: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Field-length caps — single source of truth, exported so future `OutlineModal`
// imports them instead of re-declaring the numbers. Values copied verbatim from
// today's inline CreateOutlineBody.
export const OUTLINE_TITLE_MAX = 300;
export const OUTLINE_SUB_MAX = 2000;
export const OUTLINE_STATUS_MAX = 40;

outlineCreateSchema = z.strictObject({
  title: z.string().min(1).max(OUTLINE_TITLE_MAX),
  sub: z.string().max(OUTLINE_SUB_MAX).nullable().optional(),
  status: z.string().min(1).max(OUTLINE_STATUS_MAX),
});

// Update extends `partial()` with the optional `order` field — `order` is not
// settable on create (the POST handler auto-allocates via maxOrder + retry,
// guarded by @@unique([storyId, order])), but `order` IS settable on update
// (the per-item PATCH path; bulk reorder goes through `outlineReorderSchema`).
// This is the first migrated entity to need `.partial().extend(...)` — the
// other three (Character/Message/Story) have `*UpdateSchema = *CreateSchema.partial()`
// with no extra fields. In Zod 3 (the project's pinned version), both `.partial()`
// and `.extend()` on a `strictObject` preserve strictness — so unknown keys are
// still rejected on PATCH, matching the load-bearing invariant.
outlineUpdateSchema = outlineCreateSchema.partial().extend({
  order: z.number().int().nonnegative().optional(),
});

outlineReorderSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});
```

Notes:

- The `max()` bounds on `outlineCreateSchema` and `outlineUpdateSchema` are copied verbatim from
  today's inline `CreateOutlineBody` / `UpdateOutlineBody`. No change in validation behaviour —
  both today's inline schemas are already `.strict()`, so this migration is a pure relocation, not
  a strictness tightening (unlike Story's `CreateStoryBody → storyCreateSchema` which tightened
  from `z.object` to `z.strictObject`).
- `outlineReorderSchema` is also a pure relocation — today's inline `ReorderOutlineBody` is
  already strict and uses the same `min(1).max(500)` array bounds.
- The `order` field placement (update only, not create) mirrors today's behaviour: today's
  `CreateOutlineBody` rejects an `order` key (strict), `UpdateOutlineBody` accepts it as optional.
  Schema migration preserves both.
- `sub`'s nullability: today's inline `UpdateOutlineBody` declares `sub: z.string().max(2000).nullable().optional()`
  — explicitly allowing `null` to clear, `undefined` to leave alone. Migration preserves both.
  The repo's `update()` already distinguishes the two correctly
  ([outline.repo.ts:82-99](../../backend/src/repos/outline.repo.ts)) — the contract is unchanged.
- Type exports: `OutlineItem`, `OutlineCreateInput`, `OutlineUpdateInput`, `OutlineReorderInput`,
  `OutlineEncryptedFieldKey` — all `z.infer<>` / tuple-derived.

`shared/src/index.ts` re-exports exactly: the six `*Schema` values, `OUTLINE_ENCRYPTED_FIELD_KEYS`,
the three `OUTLINE_*_MAX` constants, and the five types listed above. **No `OutlineStatus`**
(frontend-only convention, see Outline-difference #3). No other symbols leak.

## Backend

### `backend/src/routes/outline.routes.ts`

- Delete the three inline schemas (`CreateOutlineBody`, `UpdateOutlineBody`, `ReorderOutlineBody`).
- Import `outlineCreateSchema`, `outlineUpdateSchema`, `outlineReorderSchema`,
  `outlineItemResponseSchema`, `outlineListResponseSchema` from `story-editor-shared`.
- Every surviving success-path handler returns via `respond(schema, res, data, status?)`:
  - `GET /` → `respond(outlineListResponseSchema, res, { outline: rows.map(serializeOutlineItem) })`.
  - `GET /:outlineId` → `respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(row) })`.
  - `POST /` → `respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(created) }, 201)`.
  - `PATCH /:outlineId` → `respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(updated) })`.
- `PATCH /reorder` returns 204 — no schema, no `respond()` call. Keeps the imperative
  duplicate-id / duplicate-order checks at lines 141-158 (verbatim from today; matches Character).
  The `OutlineNotOwnedError` catch at lines 163-167 stays as-is — see "Non-divergences" above.
- 404 / race-condition / `validation_error` branches (`if (!existing)`, `if (existing.storyId !== storyId)`,
  duplicate-id-in-payload, duplicate-order-in-payload, `OutlineNotOwnedError`) all keep the plain
  `{ error: … }` shape and do not go through `respond()`.
- The `PATCH /:outlineId` handler keeps its explicit `'title' in body` / `'sub' in body` /
  `'status' in body` / `'order' in body` forwarding block — the repo's `OutlineUpdateInput` (now
  inferred from `outlineUpdateSchema`) still distinguishes "leave alone" (`undefined`) from "clear"
  (`null` for `sub`).

### `backend/src/lib/serialize.ts`

- Add `serializeOutlineItem(row: RepoOutlineItem): OutlineItem`. **Explicit pick, not spread** —
  picks `id`, `storyId`, `title`, `sub`, `status`, `order`, and converts `createdAt` / `updatedAt`
  `Date → ISO string`. Mirror the comment style of `serializeStory` / `serializeMessage`,
  explaining *why* it picks (consistency with the established post-Story-PR pattern; stray
  Prisma columns can't leak onto the wire).
- All four `serialize*` helpers (`serializeCharacter`, `serializeMessage`, `serializeStory`,
  `serializeOutlineItem`) now use the same explicit-pick pattern. No generic
  `serializeNarrative` helper is introduced — the Story PR's "Out of scope" section closed
  `story-editor-ehi` against this and the same argument applies here.

### `backend/src/repos/outline.repo.ts`

- Delete the hand-rolled `OutlineCreateInput` interface and the
  `OutlineUpdateInput = Partial<Omit<OutlineCreateInput, 'storyId'>>` derived type.
- Import the inferred types from `story-editor-shared`. Note the wire-vs-repo seam: the shared
  `OutlineCreateInput` is the *body* shape (no `storyId` — the route reads it from `req.params`),
  but the repo's `create()` method needs `storyId` + `order` in its argument. Repo-local
  augmentation: `type RepoCreateOutlineInput = OutlineCreateInput & { storyId: string; order: number }`
  (private to the repo). This matches `story.repo.ts`'s pattern where the route adds `userId`
  before calling `create()`.
- Import `OUTLINE_ENCRYPTED_FIELD_KEYS` from `story-editor-shared` and bind
  `const ENCRYPTED_FIELDS = OUTLINE_ENCRYPTED_FIELD_KEYS` (keep the local `ENCRYPTED_FIELDS` name
  as the repo-local invariant, same as the other three repos).
- Add `export type RepoOutlineItem = Omit<OutlineItem, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }`
  and type the `projectDecrypted<RepoOutlineItem>(…)` calls in `create` / `findById` /
  `findManyForStory` / `update`.
- All other repo behaviour is unchanged: `OutlineNotOwnedError` definition + throw site,
  `ensureStoryOwned`, the two-phase swap transaction, `maxOrder`, `remove`.

## Frontend

### `frontend/src/hooks/useOutline.ts`

- Delete the six hand-rolled types: `OutlineItem`, `OutlineListResponse`, `OutlineItemResponse`,
  `CreateOutlineInput`, `UpdateOutlinePatch`, `UpdateOutlineInput`.
- **`DeleteOutlineInput` collapses to inline `{ id: string }`** in the mutation signature —
  `useDeleteOutlineMutation` becomes `UseMutationResult<void, Error, { id: string }>`. This
  preserves every existing call site's `mutate({ id })` shape (zero consumer churn) while
  eliminating the one-field interface. Not promoted to shared — it's a hook argument shape, not
  a wire contract (the DELETE wire is path-only, no body, 204 response).
- Delete the `ReorderOutlineMutationContext` / `ReorderOutlineInput` interfaces and re-derive from
  shared types. `ReorderOutlineInput` stays as a hook-local interface (it carries
  `previousItems: OutlineItem[]` for optimistic rollback, which has no wire-shape analog), but its
  `items` field is **typed from the shared schema**: `items: OutlineReorderInput['items']` (where
  `OutlineReorderInput = z.infer<typeof outlineReorderSchema>`). This keeps the optimistic-reorder
  helper's payload shape single-sourced to the wire schema — adding or renaming a key in
  `outlineReorderSchema` would surface a type error in the hook, not a runtime drift at mutation
  time.
- **Keep** the `OutlineStatus = 'queued' | 'active' | 'done'` union — frontend-only UI convention,
  no shared analog (see Outline-difference #3).
- Import `OutlineItem`, `OutlineCreateInput`, `OutlineUpdateInput`, `outlineItemResponseSchema`,
  `outlineListResponseSchema` from `story-editor-shared`.
- Keep `outlineQueryKey` — query keys are a frontend-only concern, not wire contract.
- Add runtime validation on every success path, mirroring `useCharacters.ts` /
  `useStories.ts`:
  - `useOutlineQuery` → `outlineListResponseSchema.parse(raw).outline`
  - `useCreateOutlineMutation` / `useUpdateOutlineMutation` → `outlineItemResponseSchema.parse(raw).outlineItem`
  - `useReorderOutlineMutation` — wire response is 204, no parse.
  - `useDeleteOutlineMutation` — wire response is 204, no parse.
  A malformed response throws `ZodError`, caught by the existing `api()` error path.
- Keep the three reorder helpers (`computeReorderedOutline`, `arrayMove`, `withSequentialOrder`)
  unchanged — they reference `OutlineItem`, which is now the shared type, and otherwise need no
  edits.
- TanStack Query key preserved (`['outline', storyId]`).

### Consumers

- `frontend/src/components/OutlineTab.tsx` — `OutlineItem` import path → `story-editor-shared`.
  No behaviour change. **Only frontend consumer touched.**
- `frontend/src/components/Sidebar.tsx` — verified does **not** import `OutlineItem`: the outline
  body is passed in as an opaque `ReactNode` prop ([Sidebar.tsx:25](../../frontend/src/components/Sidebar.tsx)),
  not a typed value. No edit.
- `frontend/src/pages/EditorPage.tsx` — verified does **not** reference `OutlineItem` directly
  (grep returns no matches). It constructs the `OutlineTab` element with its hook output and
  passes that as the `outlineBody` prop. No edit. The `onAddItem` / `onEditItem` stubs stay —
  out of scope.

## Tests

### New

- `shared/tests/outline.schema.test.ts` — mirrors `shared/tests/story.schema.test.ts` /
  `character.schema.test.ts`:
  - `outlineItemSchema` parses a valid row, rejects unknown keys, rejects wrong types.
  - `outlineCreateSchema` enforces `title` min/max, `sub` max + nullable + optional, `status`
    min/max; rejects an unknown key; rejects `order` (create must not set order).
  - `outlineUpdateSchema` accepts `{}` and any single-field subset; accepts `order` as a
    standalone field; still rejects unknown keys.
  - `outlineReorderSchema` accepts a valid items array, rejects empty (`min(1)`), rejects > 500
    items, rejects unknown keys inside each `{id, order}` element.

### Backend

- `backend/tests/routes/outline.test.ts` — list / create / patch / get-by-id response assertions
  updated to the new wire shape (`{ outline: OutlineItem[] }` / `{ outlineItem: OutlineItem }`).
  Existing reorder tests are unchanged (204, with imperative-dup-check 400s and
  `OutlineNotOwnedError` 403s unchanged).
- `backend/tests/repos/outline.repo.test.ts` — repo output now typed `RepoOutlineItem`; fixture /
  assertion updates only if a test referenced the deleted `OutlineCreateInput` /
  `OutlineUpdateInput` interface names from the repo file (they now come from shared).
- `backend/tests/security/encryption-leak.test.ts` — Outline's `title*` / `sub*` columns are
  unchanged by this migration. Sentinel coverage at lines 115-119 stays. Run for regression only.
- `backend/tests/lib/serialize.test.ts` — add a `serializeOutlineItem()` block mirroring the
  existing `serializeStory()` / `serializeMessage()` ones: ISO-strings `createdAt` / `updatedAt`,
  fields-through-unchanged, no-mutate, and a fixture with a stray key at runtime asserting the
  stray key is **not** on the wire output (locks the explicit-pick contract). Existing
  `serializeCharacter` / `serializeMessage` / `serializeStory` assertions still pass unchanged.
- `backend/tests/models/outline-encrypted.test.ts` / `outline-item.test.ts` — Prisma-model-level
  tests, not touched by this migration (they don't reference the repo interfaces). Included in
  the verify line for parity with the Story PR's `tests/models/story` coverage.

### Frontend

- `frontend/tests/components/OutlineTab.test.tsx` — fixtures use the shared `OutlineItem` type.
  Add a drift smoke test: a mocked malformed `/outline` GET response surfaces as a `ZodError`
  through the hook's error path (mirrors the Story / Character drift smoke tests). No new hook
  test file is created — there is no `useOutline.test.tsx` today and one isn't needed
  (the smoke test fits inside `OutlineTab.test.tsx` since it's the only outline-query consumer).

## Verify line

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/outline tests/routes/outline tests/repos/outline tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/OutlineTab
```

Deliberate changes from the bd issue's stock `verify:` line:
- Added shared workspace's `run build && test` — this migration adds `shared/src/schemas/outline.ts`
  and `shared/tests/outline.schema.test.ts`.
- Added both `backend` + `frontend` `typecheck` — the bd issue's stock verify omitted the frontend
  surface entirely, which is a gap given the migration deletes the frontend's hand-rolled
  interfaces and rewires consumer files.
- Added `tests/models/outline` — catches `outline-item.test.ts` + `outline-encrypted.test.ts`.
  Prisma-model-level and don't import the deleted repo interfaces, but the migration touches the
  outline repo + serialize path, so the coverage is worth the seconds.
- Added `tests/lib/serialize` — this migration adds `serializeOutlineItem`, covered by
  `serialize.test.ts`.
- Added the frontend test run for `tests/components/OutlineTab` — the migration rewires
  `OutlineTab.tsx`'s `OutlineItem` import.

## Acceptance criteria

- Single canonical `OutlineItem` Zod schema set in `shared/src/schemas/outline.ts`; no other
  hand-maintained `OutlineItem` / `OutlineCreateInput` / `OutlineUpdateInput` /
  `OutlineListResponse` / `OutlineItemResponse` interface anywhere in `backend/`, `frontend/`, or
  `shared/`.
- `shared/src/index.ts` re-exports exactly: `outlineItemSchema`, `outlineCreateSchema`,
  `outlineUpdateSchema`, `outlineReorderSchema`, `outlineItemResponseSchema`,
  `outlineListResponseSchema`, `OUTLINE_ENCRYPTED_FIELD_KEYS`, `OUTLINE_TITLE_MAX`,
  `OUTLINE_SUB_MAX`, `OUTLINE_STATUS_MAX`, and the types `OutlineItem`, `OutlineCreateInput`,
  `OutlineUpdateInput`, `OutlineReorderInput`, `OutlineEncryptedFieldKey`. No `OutlineStatus`
  export. No other symbols leak.
- `outline.routes.ts` consumes the shared create / update / reorder schemas — no inline
  `CreateOutlineBody` / `UpdateOutlineBody` / `ReorderOutlineBody`. Every surviving success-path
  handler (list, get-by-id, create, patch) returns via `respond()`. The reorder handler still
  returns 204 (no `respond()` call). The `OutlineNotOwnedError` → 403 branch and the imperative
  duplicate-id / duplicate-order 400 branches are unchanged.
- The three field-length caps have one source of truth: `OUTLINE_*_MAX` exported from
  `shared/src/schemas/outline.ts`, consumed by `outlineCreateSchema` (and a future `OutlineModal`
  once `story-editor-syb` lands).
- `outline.repo.ts` consumes `OutlineCreateInput` / `OutlineUpdateInput` inferred from the shared
  schemas (with a repo-local `storyId` + `order` augmentation for `create()`'s argument) and
  `OUTLINE_ENCRYPTED_FIELD_KEYS` for `ENCRYPTED_FIELDS` — no parallel hand-rolled interfaces.
  `OutlineNotOwnedError` and the two-phase swap transaction are unchanged.
- `serializeOutlineItem` exists, picks (does not spread), and converts `Date → ISO`.
  `serialize.test.ts` has a stray-key assertion for the outline helper, matching the equivalent
  assertions for the other three `serialize*` helpers.
- No `OutlinePromptInput` / `toOutlinePromptInput` is added (the prompt builder does not consume
  outline items).
- Frontend `useOutline.ts` runtime-validates every successful response against the shared schemas;
  a drift smoke test in `OutlineTab.test.tsx` surfaces a malformed response as a `ZodError`
  through the hook's error path.
- `OutlineStatus` remains in `useOutline.ts` as a frontend-only UI convention type alias — not
  promoted to shared.
- No `OutlineItem` / `OutlineCreateInput` / `OutlineUpdateInput` re-export from `useOutline.ts`;
  all consumer import sites point at `story-editor-shared`.
- Encryption leak test passes; Outline columns remain in the column scan unchanged.
- `lint:design` and all three typechecks (`shared`, `backend`, `frontend`) clean.
- No new dependencies; no Prisma schema or migration changes.
- `repo-boundary-reviewer` (path-matched on `repos/outline.repo.ts`, `routes/outline.routes.ts`,
  `services/content-crypto.service.ts`) CLEAN at close-gate.

## Out of scope

- The other two sibling migrations (`Chapter`, `Chat`) — separate bd issues (`story-editor-ggl`,
  `story-editor-up6`).
- `OutlineModal` / wiring `onAddItem` + `onEditItem` in `EditorPage` — separate bd issue
  (`story-editor-syb`). The `OUTLINE_*_MAX` constants ship from shared in this PR but have no
  modal consumer yet.
- `validateBody(schema)` ingress middleware (`story-editor-xgb`) — workspace-wide cleanup, not
  per-entity.
- Production-mode egress validation, `prisma-zod-generator`, OpenAPI generation — separate
  follow-up issues.
- Tightening `status` from free-form `z.string()` to an enum — out of scope by explicit design
  decision (see Outline-difference #3). If the UI ever wants a server-enforced enum, that's a
  separate change that touches the DB column shape, the route, and the frontend convention
  together.
- A generic `serializeNarrative(row, schema)` helper — closed in the Story PR (`story-editor-ehi`)
  and the same argument applies.
