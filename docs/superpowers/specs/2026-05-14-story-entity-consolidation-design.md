# Story entity consolidation — design

**bd:** `story-editor-d7e` — Migrate Story Zod schemas to `story-editor-shared`.

**Pattern source:** PR #100 (Character entity consolidation) and PR #104 (Message entity
consolidation). The `shared/` workspace, the `respond()` egress helper, the `serialize*` handler-
boundary converters, and the `*ResponseSchema.parse(…)` frontend runtime-validation idiom are all
already in place. This design extends them to `Story`. No new dependencies, no Prisma schema or
migration changes — Story's columns are already in their post-`[E11]` ciphertext-only shape.

## Goal

One canonical `Story` Zod schema set in `story-editor-shared`. Rip out the inline backend request
validators (`CreateStoryBody` / `UpdateStoryBody` in `backend/src/routes/stories.routes.ts`) and
the frontend hand-rolled `Story` / `StoryListItem` / `StoryInput` interfaces in
`frontend/src/hooks/useStories.ts`. Apply the `respond(schema, res, data)` egress pattern to every
*surviving* story handler. Delete the dead `GET /api/stories/:id/progress` endpoint and its
backend-only support code (no consumer — see divergence #4). Add frontend runtime validation of API
responses. Rip-and-replace in one PR; no incremental dual-definitions.

## Story-specific differences from the Character pattern

The Character migration is the template, but Story diverges in four ways. Each is called out
here so the implementation doesn't blindly copy Character. (#1–#3 are genuine implementation
divergences; #4 is a piece of dead code Story carries that the Character/Message templates didn't,
surfaced by asking "what does Story duplicate that Character didn't?" — the answer was an entire
endpoint, and the resolution is deletion, not migration.)

### 1. `userId` egress — `serializeStory` must pick, not spread

`Story` rows carry a direct `userId` foreign key (`Character` rows carry `storyId`, not `userId`).
The repo's `projectDecrypted` only strips the `*Ciphertext / *Iv / *AuthTag` columns — so `userId`
survives into the repo's output object, and **all four non-progress handlers currently ship
`userId` on the wire**: `GET /` spreads `...s` over each repo row, and `GET /:id` / `POST` / `PATCH`
return the raw `{ story }`. The frontend `Story` interface omits it, so nothing reads it, but it is
on the wire today. Routing every handler through `serializeStory` closes all four at once.

With a `z.strictObject` `storySchema` and `respond()`'s non-prod egress parse, a `serializeStory`
that did `{ ...row, createdAt: …, updatedAt: … }` would throw a `ZodError` on the stray `userId`
key. So `serializeStory` must **explicitly pick** the eight wire fields — the same situation as
`serializeMessage`, which picks because the runtime row still carries `chatId`. Net effect:
`userId` drops off the wire. This is strictly better (no reason to ship the owning user's id back
to the owning user) and no consumer depends on it.

### 2. No prompt-input projection

The Character migration added `CharacterPromptInput` (a `Pick<Character, NarrativeFieldKey>`) and
`toCharacterPromptInput` because `prompt.service.ts` consumed `Character[]` directly. Story has no
equivalent seam: `prompt.service.ts` takes `worldNotes: string | null` as a plain scalar
parameter, and `ai.routes.ts` / `chat.routes.ts` already destructure `story.worldNotes` at the
call site before handing it to the prompt builder. There is no `Story`-shaped value flowing into
the prompt service, so there is **no `StoryPromptInput` / `toStoryPromptInput`** in this design.
`STORY_ENCRYPTED_FIELD_KEYS` exists only to feed the repo's `ENCRYPTED_FIELDS`. It still lives in
`shared/` despite having a single (repo) consumer — this matches `MESSAGE_ENCRYPTED_FIELD_KEYS`,
which is likewise repo-only: the field-key tuple belongs beside the schema that describes the same
entity, not split into the backend. (Character's `NARRATIVE_FIELD_KEYS` has wider use because the
prompt-input `Pick` consumes it; Story's and Message's do not, but co-location still wins.)

### 3. Two response shapes — base `Story` vs. enriched `StoryListItem`

`GET /api/stories` returns each story enriched with `chapterCount` + `totalWordCount` aggregates
(computed in one `chapter.repo` `groupBy` pass). `GET /api/stories/:id`, `POST /api/stories`, and
`PATCH /api/stories/:id` return the base story with no aggregates. This needs two schemas:
`storySchema` (base) and `storyListItemSchema` (= `storySchema.extend({ … })`).

This also surfaces — and fixes — an existing frontend drift: `useCreateStoryMutation` /
`useUpdateStoryMutation` are typed to return `StoryListItem` today, but the backend `POST` / `PATCH`
handlers return the *base* story (no aggregates). Post-migration their return type becomes `Story`.
`StoryModal.tsx` is the only mutation consumer and never reads `chapterCount` / `totalWordCount`
off the result, so the type tightening is safe.

### 4. The `/progress` endpoint is dead code — delete it, don't migrate it

`GET /api/stories/:id/progress` has **no consumer anywhere** — not the frontend, not the e2e
suite. The only references to the path in the whole repo are the route definition itself and its
205-line test file. It returns `{ wordCount, targetWords, percent, chapters: [{ id, wordCount }] }`,
all of which the frontend already derives client-side, *better*:
- `totalWordCount` — `chaptersQuery.data.reduce((sum, c) => sum + c.wordCount, 0)` in
  `EditorPage.tsx:309-311`. `useChaptersQuery` is fetched anyway (it drives `<ChapterList>`), and
  every chapter row carries `wordCount`.
- `goalWordCount` — `story.targetWords`, already on the `useStoryQuery` result.
- `percent` — `Math.round((words / goal) * 100)` clamped 0–100, `Sidebar.tsx:110`.

The client-side version updates **live as the user types** (chapter `wordCount` flows back through
the query cache); the endpoint is a point-in-time snapshot needing a refetch, with `Math.floor`
and no clamp. It is strictly the worse implementation. It looks like `[B9]` built the "proper" API
before the frontend settled on deriving the footer locally.

So this migration **deletes the endpoint and everything that exists solely to serve it**, rather
than wiring `respond()` onto dead code and adding a `storyProgressResponseSchema` nobody parses:
- `GET /:id/progress` route handler — `backend/src/routes/stories.routes.ts`.
- `story.repo.ts` → `findTargetWords()` — sole caller is that route.
- `chapter.repo.ts` → `listWordCountsForStory()` — sole caller is that route.
- `backend/tests/routes/story-progress.test.ts` — deleted (it tests a deleted endpoint).

There is **no `storyProgressResponseSchema`** in this design. Neither dead repo method has its own
repo-level test (they were only exercised through the route test), so the deletion is clean. The
follow-up issue `story-editor-9qg` (originally filed as "wire the frontend onto `/progress`") was
mis-framed — wiring the frontend onto a snapshot endpoint would be a *regression* — and is closed
in favour of this deletion.

## Shared schemas — `shared/src/schemas/story.ts`

All object schemas are `z.strictObject` (rejects unknown keys at every layer — the load-bearing
invariant that closes the Prisma↔Zod drift seam at egress-validation time, same as `character.ts`).

| Symbol | Shape | Used by |
|---|---|---|
| `storySchema` | base entity | `GET /:id`, `POST`, `PATCH` responses; element of `storyListItemSchema` |
| `storyListItemSchema` | `storySchema.extend({ chapterCount, totalWordCount })` | `GET /` response elements |
| `storyCreateSchema` | request body for `POST` | `stories.routes.ts`, repo `StoryCreateInput` |
| `storyUpdateSchema` | `storyCreateSchema.partial()` | request body for `PATCH`, repo `StoryUpdateInput` |
| `storyResponseSchema` | `{ story: storySchema }` | `respond()` on `GET /:id`, `POST`, `PATCH` |
| `storiesResponseSchema` | `{ stories: storyListItemSchema[] }` | `respond()` on `GET /` |
| `STORY_ENCRYPTED_FIELD_KEYS` | `['title', 'synopsis', 'worldNotes'] as const` | `story.repo.ts` `ENCRYPTED_FIELDS` |
| `STORY_TITLE_MAX` etc. (4 consts) | field-length caps | `storyCreateSchema` + `StoryModal.tsx` `maxLength` attrs |

Field-level shapes:

```ts
storySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  synopsis: z.string().nullable(),
  genre: z.string().nullable(),
  worldNotes: z.string().nullable(),
  targetWords: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

storyListItemSchema = storySchema.extend({
  chapterCount: z.number().int().nonnegative(),
  totalWordCount: z.number().int().nonnegative(),
});

// Field-length caps — single source of truth, exported so the frontend form
// imports them instead of re-declaring the same numbers (see "Shared max caps"
// below). Values copied verbatim from today's inline CreateStoryBody.
export const STORY_TITLE_MAX = 500;
export const STORY_GENRE_MAX = 200;
export const STORY_SYNOPSIS_MAX = 10_000;
export const STORY_WORLD_NOTES_MAX = 50_000;

storyCreateSchema = z.strictObject({
  title: z.string().min(1).max(STORY_TITLE_MAX),
  synopsis: z.string().max(STORY_SYNOPSIS_MAX).nullable().optional(),
  genre: z.string().max(STORY_GENRE_MAX).nullable().optional(),
  worldNotes: z.string().max(STORY_WORLD_NOTES_MAX).nullable().optional(),
  targetWords: z.number().int().positive().nullable().optional(),
});

storyUpdateSchema = storyCreateSchema.partial();   // every field optional, still strict
```

Notes:
- The `max()` bounds on `storyCreateSchema` are copied verbatim from today's `CreateStoryBody` —
  conservative caps on free-text narrative metadata. No change in validation behaviour except that
  the schema is now `strict` (today's `CreateStoryBody` is a plain `z.object`, so `POST` currently
  accepts unknown keys silently — tightening this matches the Character pattern and is an
  improvement). Today's `UpdateStoryBody` is *already* `.strict()`, so `PATCH` is unchanged.
- **Shared max caps.** `StoryModal.tsx:36-39` currently hard-codes `TITLE_MAX = 500`,
  `GENRE_MAX = 200`, `SYNOPSIS_MAX = 10_000`, `WORLD_NOTES_MAX = 50_000` — the exact numbers
  `storyCreateSchema` enforces. Story is the first migrated entity where a shared schema and a
  frontend form re-declare the same bounds (Character and Message had no `.max()` caps, so the
  templates never had to solve it). Exporting `STORY_TITLE_MAX` etc. from `story.ts` and having
  `StoryModal` import them — deleting its four local constants — makes the cap a single source of
  truth. This is squarely on the consolidation goal, so it is *in scope* for this PR, not a
  follow-up.
- Type exports: `Story`, `StoryListItem`, `StoryCreateInput`, `StoryUpdateInput`,
  `StoryEncryptedFieldKey` — all `z.infer<>` / tuple-derived.

`shared/src/index.ts` re-exports exactly: the six `*Schema` values, `STORY_ENCRYPTED_FIELD_KEYS`,
the four `STORY_*_MAX` constants, and the five types listed above. No other symbols leak out.

## Backend

### `backend/src/routes/stories.routes.ts`
- Delete the inline `CreateStoryBody` and `UpdateStoryBody` schemas.
- **Delete the entire `GET /:id/progress` handler** (divergence #4). With it gone,
  `createChapterRepo` is still imported (the `GET /` list handler uses `aggregateForStories`), so
  the import stays.
- Import `storyCreateSchema`, `storyUpdateSchema`, `storyResponseSchema`, `storiesResponseSchema`
  from `story-editor-shared`.
- Every *surviving* handler returns via `respond(schema, res, data, status?)`:
  - `GET /` → `respond(storiesResponseSchema, res, { stories })` where each story is
    `{ ...serializeStory(repoRow), chapterCount, totalWordCount }`.
  - `GET /:id` → `respond(storyResponseSchema, res, { story: serializeStory(row) })`.
  - `POST /` → `respond(storyResponseSchema, res, { story: serializeStory(created) }, 201)`.
  - `PATCH /:id` → `respond(storyResponseSchema, res, { story: serializeStory(updated) })`.
- The `PATCH` handler keeps its explicit `undefined`-vs-`null` forwarding block — the repo
  distinguishes "leave alone" (`undefined`) from "clear" (`null`), and that contract is unchanged.
- 404 / race-condition branches (`if (!story)` after an ownership-checked lookup) are unchanged —
  they still respond with the plain `{ error: … }` shape, not via `respond()`.

### `backend/src/lib/serialize.ts`
- Add `serializeStory(row: RepoStory): Story`. **Explicit pick, not spread** — picks `id`, `title`,
  `synopsis`, `genre`, `worldNotes`, `targetWords`, and converts `createdAt` / `updatedAt`
  `Date → ISO string`. Drops `userId` (see Story-specific difference #1). Mirror the comment style
  of `serializeMessage`, explaining *why* it picks.
- **Rewrite `serializeCharacter` to explicit-pick** (small in-scope tidy). It currently spreads
  `...row`, which is safe today only because `RepoCharacter`'s row happens to carry no extra
  columns — but that makes it a copy-paste footgun: the next entity author who copies the spread
  form for a row that *does* have an extra column leaks it. After this change all three helpers
  (`serializeCharacter`, `serializeMessage`, `serializeStory`) use the one safe pattern — explicit
  pick of the wire fields + `Date → ISO`. No generic `serializeNarrative` helper: that would trade
  per-field compile-time type-checking for schema reflection and `as T`, which is not a win (this
  is why `story-editor-ehi` is closed rather than implemented). The behaviour of
  `serializeCharacter` is unchanged — `RepoCharacter` has no extra runtime columns, so pick and
  spread produce identical output; this only hardens the *example*.

### `backend/src/repos/story.repo.ts`
- Delete the hand-rolled `StoryCreateInput` / `StoryUpdateInput` interfaces; import them (inferred)
  from `story-editor-shared`.
- Import `STORY_ENCRYPTED_FIELD_KEYS` and bind `const ENCRYPTED_FIELDS = STORY_ENCRYPTED_FIELD_KEYS`
  (keep the local `ENCRYPTED_FIELDS` name as the repo-local invariant, same as `character.repo.ts`).
- Add `export type RepoStory = Omit<Story, 'createdAt' | 'updatedAt'> & { createdAt: Date;
  updatedAt: Date }` and type the `projectDecrypted<RepoStory>(…)` calls in `create` / `findById` /
  `findManyForUser` / `update`.
- **Delete `findTargetWords`** and drop it from the returned repo object — its sole caller was the
  `/:id/progress` handler (divergence #4). It has no repo-level test of its own.
- All other repo behaviour is unchanged: encrypt-on-write / decrypt-on-read, `updateMany`-scoped
  ownership.
- The repo no longer exports a `StoryUpdateInput` of its own — `stories.routes.ts` currently
  imports `type StoryUpdateInput` from `../repos/story.repo`; that import moves to
  `story-editor-shared`.

### `backend/src/repos/chapter.repo.ts`
- **Delete `listWordCountsForStory`** and drop it from the returned repo object — its sole caller
  was the `/:id/progress` handler. It has no repo-level test of its own. This is the only change
  to `chapter.repo.ts`; `aggregateForStories` (used by the `GET /api/stories` list handler) and
  every other method are untouched.

### `backend/src/routes/ai.routes.ts` and `backend/src/routes/chat.routes.ts`
- Neither file imports a Story *type* — so the import-path concern does not apply. The actual
  (latent) effect: today `story.repo.ts`'s `findById` calls `projectDecrypted(...)` without an
  explicit generic, so it returns `Record<string, unknown> | null` and `story.worldNotes` is
  `unknown`. Typing the call `projectDecrypted<RepoStory>` narrows `findById` to `RepoStory | null`,
  so `story.worldNotes` becomes `string | null`. Both files only read `story.worldNotes` behind a
  `typeof story.worldNotes === 'string'` guard — that guard becomes redundant but stays
  type-correct, so **no edit to either file is required**. The redundant guard is left in place
  rather than cleaned up: touching `chat.routes.ts` would pull it (and `ai.routes.ts`) into the
  `security-reviewer` surface for a purely cosmetic change. If a future contributor accesses a
  property *not* on `RepoStory`, that now fails typecheck — a correctness gain, not a break.

## Frontend

### `frontend/src/hooks/useStories.ts`
- Delete the six hand-rolled interfaces: `StoryListItem`, `StoriesResponse`, `StoryResponse`,
  `Story`, `StoryDetailResponse`, `StoryInput`.
- Import `Story`, `StoryListItem`, `StoryCreateInput`, `StoryUpdateInput`, `storyResponseSchema`,
  `storiesResponseSchema` from `story-editor-shared`.
- Keep `storyQueryKey`, `storiesQueryKey` — query keys are a frontend-only concern, not wire
  contract.
- Add runtime validation on every response, mirroring `useCharacters.ts`:
  - `useStoriesQuery` → `storiesResponseSchema.parse(raw).stories`
  - `useStoryQuery` → `storyResponseSchema.parse(raw).story`
  - `useCreateStoryMutation` / `useUpdateStoryMutation` → `storyResponseSchema.parse(raw).story`
  A malformed response throws `ZodError`, caught by the existing `api()` error path.
- `useCreateStoryMutation` / `useUpdateStoryMutation` return type changes `StoryListItem → Story`
  (the backend `POST` / `PATCH` return the base story; see Story-specific difference #3).
- TanStack Query keys preserved (`['stories']`, `['story', id]`).

### Consumers
- `frontend/src/pages/EditorPage.tsx` — `useStoryQuery` import unchanged; `Story` type now resolves
  through the hook's re-export-free path — adjust if it imports the `Story` type directly.
- `frontend/src/components/StoryPicker.tsx` + `StoryPicker.stories.tsx` — `StoryListItem` import
  path → `story-editor-shared`.
- `frontend/src/components/StoryModal.tsx` — `StoryInput` / `Partial<StoryInput>` → `StoryCreateInput`
  / `StoryUpdateInput` (the `diffForPatch` helper currently typed `Partial<StoryInput>` becomes
  `StoryUpdateInput`). Also: delete the four local `TITLE_MAX` / `GENRE_MAX` / `SYNOPSIS_MAX` /
  `WORLD_NOTES_MAX` constants and import `STORY_TITLE_MAX` / `STORY_GENRE_MAX` / `STORY_SYNOPSIS_MAX`
  / `STORY_WORLD_NOTES_MAX` from `story-editor-shared` for the form's `maxLength` attributes.

## Tests

### New
- `shared/tests/story.schema.test.ts` — mirrors `shared/tests/character.schema.test.ts`:
  - `storySchema` parses a valid row, rejects unknown keys (notably `userId`), rejects wrong types.
  - `storyListItemSchema` parses a valid enriched row; rejects a row missing the aggregates.
  - `storyCreateSchema` enforces `title` min/max, rejects unknown keys; `storyUpdateSchema` accepts
    `{}` and any single-field subset.

### Backend
- `backend/tests/routes/stories.test.ts` — list/create response assertions updated to the new wire
  shape; assert the response body has **no `userId`** key.
- `backend/tests/routes/story-detail.test.ts` — `GET /:id` response shape; assert no `userId`.
- `backend/tests/routes/story-progress.test.ts` — **deleted** along with the endpoint it tests
  (divergence #4).
- `backend/tests/repos/story.repo.test.ts` — repo output now typed `RepoStory`; fixture / assertion
  updates only if the test referenced the deleted `StoryCreateInput` / `StoryUpdateInput` interface
  names. No `findTargetWords` test exists to remove.
- `backend/tests/security/encryption-leak.test.ts` — Story's `title*` / `synopsis*` / `worldNotes*`
  columns are unchanged by this migration, so the sentinel coverage should be untouched; verify the
  test still passes and the Story table is still in the column scan.
- `backend/tests/lib/serialize.test.ts` — add a `serializeStory()` block mirroring the
  `serializeMessage()` one: ISO-strings `createdAt` / `updatedAt`, and a fixture with a stray
  `userId` at runtime asserting `userId` is **not** on the wire output. Also add the equivalent
  stray-key assertion to the existing `serializeCharacter()` block — that test locks the
  explicit-pick rewrite so a future revert to spread fails. The existing `serializeCharacter`
  assertions (ISO-strings, fields-through-unchanged, no-mutate) still pass unchanged.

### Frontend
There is **no `useStories` hook test file** — the only Story-related frontend tests are
`StoryModal.test.tsx`, `StoryPicker.test.tsx`, `StoryPickerEmpty.test.tsx`.
- `frontend/tests/components/StoryPicker.test.tsx` — fixtures use shared `StoryListItem`. This is
  the definitive home for the drift smoke test: a mocked malformed `/stories` response surfaces as
  a `ZodError` through the hook's error path (mirrors the Character drift test). No new hook test
  file is created.
- `frontend/tests/components/StoryModal.test.tsx` — touched: fixture / type updates for
  `StoryCreateInput` / `StoryUpdateInput`, and any assertion that referenced the now-deleted local
  `*_MAX` constants moves to the shared `STORY_*_MAX` imports.
- `frontend/tests/components/StoryPickerEmpty.test.tsx` — only touched if it references a moved
  type; likely fixture-free.

## Verify line

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/models/story tests/routes/stor tests/repos/story tests/repos/chapter tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/components/Story
```

Deliberate changes from the bd issue's `verify:` line:
- `tests/routes/stories` → `tests/routes/stor` so the filter also catches `story-detail.test.ts`.
  (`story-progress.test.ts` is deleted by this migration, so it is not run — but the broader filter
  is still the right shape for `story-detail`.)
- Added `tests/models/story` — catches `story.test.ts`, `story-encrypted.test.ts`,
  `story-settings.test.ts`. These are Prisma-model-level and don't import the deleted repo
  interfaces (so `npm run typecheck` would catch breakage regardless), but running them is cheap
  and this migration touches the Story repo + serialize path, so the coverage is worth it.
- Added `tests/lib/serialize` — this migration adds `serializeStory` and rewrites
  `serializeCharacter` to explicit-pick, both covered by `serialize.test.ts`.
- Added `tests/repos/chapter` — the migration deletes `listWordCountsForStory` from
  `chapter.repo.ts` (a `repo-boundary-reviewer` surface). `chapter.repo.test.ts` has no reference
  to that method, so `typecheck` plus this run together confirm the deletion is clean; included
  for parity with every other touched repo's test suite.
- Frontend filter `tests/components/StoryPicker` → `tests/components/Story` so it also runs
  `StoryModal.test.tsx` (touched — `StoryInput` rename + `*_MAX` constant relocation) and
  `StoryPickerEmpty.test.tsx`.
- Added `npm -w story-editor-frontend run typecheck` and the frontend test run — the bd issue's
  verify line omitted the frontend surface entirely, which is a gap given this migration deletes
  the frontend's hand-rolled interfaces and rewires four consumer files.

## Acceptance criteria

- Single canonical `Story` Zod schema set in `shared/src/schemas/story.ts`; no other hand-maintained
  `Story` / `StoryListItem` / `StoryInput` interface anywhere in `backend/`, `frontend/`, or
  `shared/`.
- `shared/src/index.ts` re-exports exactly: `storySchema`, `storyListItemSchema`, `storyCreateSchema`,
  `storyUpdateSchema`, `storyResponseSchema`, `storiesResponseSchema`,
  `STORY_ENCRYPTED_FIELD_KEYS`, `STORY_TITLE_MAX`, `STORY_GENRE_MAX`, `STORY_SYNOPSIS_MAX`,
  `STORY_WORLD_NOTES_MAX`, and the types `Story`, `StoryListItem`, `StoryCreateInput`,
  `StoryUpdateInput`, `StoryEncryptedFieldKey`. No other symbols leak.
- `stories.routes.ts` consumes the shared create/update schemas — no inline `CreateStoryBody` /
  `UpdateStoryBody`. Every surviving story handler (list, get, create, patch) returns via
  `respond()`.
- The dead `GET /:id/progress` endpoint is gone: the route handler, `story.repo.ts`'s
  `findTargetWords`, `chapter.repo.ts`'s `listWordCountsForStory`, and
  `backend/tests/routes/story-progress.test.ts` are all deleted.
  `grep -rn ":id/progress\|findTargetWords\|listWordCountsForStory" backend/src backend/tests`
  returns nothing. (Pattern is `:id/progress`, not bare `/progress` — the latter false-matches the
  string "UI/progress" in a `chapter-encrypted.test.ts` test description, which is unrelated and
  stays.)
- The four field-length caps have one source of truth: `STORY_*_MAX` exported from
  `shared/src/schemas/story.ts`, consumed by both `storyCreateSchema` and `StoryModal.tsx`'s
  `maxLength` attributes. `StoryModal`'s local `TITLE_MAX` / `GENRE_MAX` / `SYNOPSIS_MAX` /
  `WORLD_NOTES_MAX` constants are deleted.
- `story.repo.ts` consumes `StoryCreateInput` / `StoryUpdateInput` inferred from the shared schemas
  and `STORY_ENCRYPTED_FIELD_KEYS` for `ENCRYPTED_FIELDS` — no parallel hand-rolled interfaces.
- `serializeStory` exists, picks (does not spread), converts `Date → ISO`, and drops `userId`;
  story responses no longer carry `userId` on the wire.
- All three `serialize*` helpers use the same explicit-pick pattern — `serializeCharacter` is
  rewritten from spread to pick; `serialize.test.ts` has a stray-key assertion locking it. No
  generic `serializeNarrative` helper is introduced.
- No `StoryPromptInput` / `toStoryPromptInput` is added (the prompt builder consumes scalar
  `worldNotes`, not a `Story` object).
- Frontend `useStories.ts` runtime-validates every response against the shared schemas; a drift
  smoke test surfaces a malformed response as a `ZodError` through the hook's error path.
- No `Story` / `StoryListItem` / `StoryInput` re-export from `useStories.ts`; all consumer import
  sites (`EditorPage`, `StoryPicker`, `StoryPicker.stories`, `StoryModal`) point at
  `story-editor-shared`.
- Encryption leak test passes; Story remains in the column scan.
- `lint:design` and all three typechecks (`shared`, `backend`, `frontend`) clean.
- No new dependencies; no Prisma schema or migration changes.
- `repo-boundary-reviewer` and `security-reviewer` (path-matched on `repos/` + `routes/`) CLEAN at
  close-gate.

## Out of scope

- The other three sibling migrations (`Chapter`, `OutlineItem`, `Chat`) — separate bd issues
  (`story-editor-ggl`, `story-editor-lrd`, `story-editor-up6`).
- `validateBody(schema)` ingress middleware (`story-editor-xgb`) — a workspace-wide cleanup, not
  per-entity.
- Production-mode egress validation, `prisma-zod-generator`, OpenAPI generation — all separate
  follow-up issues.
- `Story.systemPrompt` consolidation (`story-editor-2ip`) — already removed from the schema in
  `[X29]`; the remaining work is user-settings-level and unrelated to this migration.
- A generic `serializeNarrative(row, schema)` helper (`story-editor-ehi`) — **closed, not
  deferred.** Investigation found the three `serialize*` helpers aren't harmful drift (three tiny
  co-located tested boundary converters; the spread-vs-pick split is structurally justified). A
  generic helper would trade per-field type-checking for schema reflection + `as T`. Instead this
  PR does the cheap hardening — making `serializeCharacter` explicit-pick like the other two (see
  the `serialize.ts` section) — and `ehi` is closed.
