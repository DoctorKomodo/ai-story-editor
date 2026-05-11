# Character entity consolidation — design

## Summary

Consolidate `Character` into a single canonical entity that flows through every layer of the app. Today the schema has 10 ciphertext-encrypted narrative fields, the frontend type carries only 7, the `CharacterSheet` form exposes 7, and the prompt builder narrows further to a 3-field projection (`name`, `role`, `keyTraits` — a `; `-joined string of personality + arc + appearance + voice). Three of the schema's columns are encrypted dead weight (`physicalDescription`, `notes`, plus a yet-to-be-added `relationships`), and the prompt builder loses information at every interpolation. This design replaces all of that with one source-of-truth Zod schema, surfaces every field in the form, and renders the full character into the prompt.

The entity is also re-shaped: `physicalDescription` collapses into `appearance` (semantic duplication), `notes` is removed (was author-only scratchpad with no clear lifecycle), and a new `relationships` field is added (user-requested — describes character relationships in the prompt).

The single source of truth is implemented via **shared Zod schemas** in a new `/shared/` directory, consumed by both backend (where Zod is already the request validator) and frontend (which adds Zod as a dependency and runtime-validates response bodies). No new library, no router contract layer, no API client rewrite. The project keeps its existing Express + manual Zod + `frontend/src/lib/api.ts` shape; only the Zod schema *location* moves to `/shared/`. ts-rest was considered and rejected for this PR — see "Considered alternatives" below.

## Motivation

Today there are three drift seams:

1. **Schema vs. UI.** The schema has `physicalDescriptionCiphertext` / `notesCiphertext` triples; the frontend type and form know nothing about them. The user can never write or read them. They're encrypted columns paying CPU + storage cost for data that doesn't exist.
2. **UI vs. prompt builder.** The form collects 7 fields; `toCharacterContext` consumes only 4 (`personality`, `arc`, `appearance`, `voice`) and drops `age` entirely. The user's `age` input never reaches the model. The other fields are concatenated with `; ` into one opaque string — the model can't distinguish personality from voice.
3. **Backend type vs. frontend type.** `CharacterCreateInput` (backend), `Character` (frontend `useCharacters.ts`), `CharacterContext` + `CharacterRecord` (prompt service) are four hand-maintained interfaces describing the same entity from different angles. Adding a field requires changing all four. Each lives in its own file with no automated drift detection.

The goal is a single canonical `Character` shape — defined once as a Zod schema, consumed everywhere, with the prompt builder receiving the full sheet and the frontend runtime-validating every response against the schema.

## Field set

The canonical entity has **9 narrative fields**:

| Field | Type | Purpose | Required |
|---|---|---|---|
| `name` | string | Display name | yes |
| `role` | string \| null | Story role (protagonist, rival, mentor, …) | no |
| `age` | string \| null | Numeric or descriptive ("late 30s", "ancient") | no |
| `appearance` | string \| null | Physical description — **merges** today's `appearance` + `physicalDescription` | no |
| `personality` | string \| null | Who they are inside | no |
| `voice` | string \| null | Speech patterns, vocal mannerisms | no |
| `backstory` | string \| null | Past events before the story | no |
| `arc` | string \| null | Trajectory through this story | no |
| `relationships` | string \| null | Relationships with other characters | no |

Plus structural fields (unchanged): `id`, `storyId`, `orderIndex`, `color`, `initial`, `createdAt`, `updatedAt`.

## Schema migration

Single migration `YYYYMMDDHHMMSS_character_field_consolidation`:

- **Drop** `physicalDescriptionCiphertext`, `physicalDescriptionIv`, `physicalDescriptionAuthTag`.
- **Drop** `notesCiphertext`, `notesIv`, `notesAuthTag`.
- **Add** `relationshipsCiphertext`, `relationshipsIv`, `relationshipsAuthTag` (all `BYTEA`, all nullable).

Pre-deployment per CLAUDE.md "General" rule — no data-migration branches. Migration runs against an empty `Character` table in dev/test.

## Type architecture

### Single source of truth: shared Zod schemas

New file: **`shared/schemas/character.ts`**.

```ts
import { z } from 'zod';

// Full row, as returned by the API after decryption.
export const characterSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  age: z.string().nullable(),
  appearance: z.string().nullable(),
  personality: z.string().nullable(),
  voice: z.string().nullable(),
  backstory: z.string().nullable(),
  arc: z.string().nullable(),
  relationships: z.string().nullable(),
  orderIndex: z.number().int().nonnegative(),
  color: z.string().nullable(),
  initial: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Create input — name required; everything else optional.
export const characterCreateSchema = z.object({
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  voice: z.string().nullable().optional(),
  backstory: z.string().nullable().optional(),
  arc: z.string().nullable().optional(),
  relationships: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  initial: z.string().nullable().optional(),
});

// Update input — everything optional.
export const characterUpdateSchema = characterCreateSchema.partial();

// Response wrappers — match the existing API shape.
export const characterResponseSchema = z.object({ character: characterSchema });
export const charactersResponseSchema = z.object({ characters: z.array(characterSchema) });

// Reorder payload.
export const characterReorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    orderIndex: z.number().int().nonnegative(),
  })),
});

// Inferred types — consumed everywhere a Character is referenced.
export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;
```

### Wiring

- **Dependencies**:
  - Backend already has Zod — no new dep.
  - Frontend gets Zod added (`npm install zod` in `frontend/`). Bundle cost ~12kb gzipped; accepted trade-off for runtime response validation.
  - No ts-rest, no @ts-rest/* packages.
- **Path mapping**: `@shared/*` → `./shared/*` in both `backend/tsconfig.json` and `frontend/tsconfig.json`.
- **No npm workspaces**: the project doesn't use them today; not adding that scope. Path mapping alone suffices.

### What gets deleted

- `frontend/src/hooks/useCharacters.ts`'s hand-rolled `interface Character` (and `CharactersResponse`, `CharacterResponse`).
- `backend/src/services/prompt.service.ts`'s `CharacterContext` interface, `CharacterRecord` interface, `toCharacterContext` function.
- `backend/src/repos/character.repo.ts`'s `CharacterCreateInput`, `CharacterUpdateInput` interfaces (replaced by inferred types).
- The existing inline Zod schemas in `backend/src/routes/characters.routes.ts` (request-body validators for create/update/reorder) — replaced by imports from `@shared/schemas/character`.
- All tests for `toCharacterContext` (added in h0z Task 1) — function is gone.

### No backwards-compat shim needed

The inferred `Character` type from the shared schema is a **superset** of the current frontend `Character` interface (it adds `backstory`, `relationships`, and structural fields like `color`, `initial`, `id`, `storyId`, `createdAt`, `updatedAt` that the existing interface already had). Existing component imports of `import { type Character } from '../hooks/useCharacters'` continue to work as long as `useCharacters.ts` re-exports the inferred type under the same name — a one-line re-export. No find-and-replace across the frontend.

## API surface

### Backend

`backend/src/routes/characters.routes.ts` keeps its current Express-style shape. Only the Zod request validators relocate:

```ts
import { characterCreateSchema, characterUpdateSchema, characterReorderSchema } from '@shared/schemas/character';

// existing POST handler:
const body = characterCreateSchema.parse(req.body);
// ... existing logic unchanged ...
```

Auth + ownership middleware unchanged. Request-scoped DEK cache unchanged.

The repo (`backend/src/repos/character.repo.ts`) updates:
- `ENCRYPTED_FIELDS` → `['name', 'role', 'age', 'appearance', 'voice', 'arc', 'personality', 'backstory', 'relationships']`.
- `CharacterCreateInput` / `CharacterUpdateInput` interfaces deleted; replaced by inferred types from `@shared/schemas/character`.
- All other repo behaviour unchanged (encrypt-on-write / decrypt-on-read, transaction logic for `remove`/`reorder`, ownership checks).

### Frontend

`frontend/src/components/CharacterSheet.tsx` adds **one new field**: `relationships` (textarea). Same pattern as the existing 8 prose fields:
- Add `relationships` to the `FieldKey` union and `Form` interface.
- Add the textarea + label in render.
- Add to the diff helper's iteration list.
- Add `relationships: ''` to `EMPTY_CHARACTER`.

`frontend/src/hooks/useCharacters.ts`:
- Drops the hand-rolled `Character` interface; re-exports `Character` from `@shared/schemas/character` for component-import compatibility:
  ```ts
  export type { Character } from '@shared/schemas/character';
  ```
- Keeps using the existing `api()` helper from `lib/api.ts` — no new HTTP client, no library swap.
- **Adds runtime validation** on every response. Each fetched response body is parsed with the appropriate schema before being handed to TanStack Query:
  ```ts
  const raw = await api(`/api/stories/${storyId}/characters`);
  const { characters } = charactersResponseSchema.parse(raw);
  return characters;
  ```
  Validation errors throw a `z.ZodError`; the api error boundary catches them as it would any other thrown error. Drift between backend response shape and the schema surfaces immediately in dev.
- TanStack Query keys preserved (`['characters', storyId]`, etc.).
- Mutation paths gain the same `.parse(...)` on response bodies.

### What stays REST

All other routes (stories, chapters, outline, chats, messages, ai/*, auth/*) are untouched. Their existing Zod validators stay inline in the route files. Other entities can migrate their Zod schemas to `/shared/` incrementally in follow-up PRs — purely a file relocation, no architectural shift.

## Prompt builder

`backend/src/services/prompt.service.ts`:

- Remove `CharacterContext`, `CharacterRecord`, `toCharacterContext`.
- `BuildPromptInput.characters` becomes `Character[]` (imported from `@shared/schemas/character`).
- New `renderCharacterTag(c: Character): string`:

```ts
function renderCharacterTag(c: Character): string {
  if (!c.name) return '';
  const attrs = [
    ` name="${escapeXmlAttr(c.name)}"`,
    c.role ? ` role="${escapeXmlAttr(c.role)}"` : '',
    c.age ? ` age="${escapeXmlAttr(c.age)}"` : '',
  ].join('');

  const proseFields = [
    ['appearance', c.appearance],
    ['personality', c.personality],
    ['voice', c.voice],
    ['backstory', c.backstory],
    ['arc', c.arc],
    ['relationships', c.relationships],
  ] as const;

  const children = proseFields
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([tag, v]) => `  <${tag}>${escapeXmlText(v!.trim())}</${tag}>`)
    .join('\n');

  if (children.length === 0) return `<character${attrs} />`;
  return `<character${attrs}>\n${children}\n</character>`;
}
```

`charactersBlock` construction is unchanged in shape — `<characters>\n<character …>…</character>\n</characters>` — but each `<character>` is now multi-line.

`ai.routes.ts` and `chat.routes.ts` drop their `.map(toCharacterContext)` calls and pass `rawCharacters` directly to `buildPrompt`. (`toCharacterContext` doesn't exist anymore.)

### Concrete output

Full sheet:

```xml
<characters>
<character name="Imogen Thorne" role="protagonist" age="34">
  <appearance>tall, auburn hair shorn at the jaw</appearance>
  <personality>wry, distrusts kindness, holds grudges</personality>
  <voice>measured alto with a Devon edge</voice>
  <backstory>Widowed at 28 when her husband died in the mining collapse...</backstory>
  <arc>from grief-numbed widow to reluctant insurgent</arc>
  <relationships>Sister to Felix; estranged from her father.</relationships>
</character>
</characters>
```

Sparse character (only name + personality):

```xml
<character name="Bystander">
  <personality>shy</personality>
</character>
```

Name-only character:

```xml
<character name="Bystander" />
```

XML escaping rules unchanged: `escapeXmlAttr` for attribute values; `escapeXmlText` for nested children content. Empty/whitespace-only fields suppressed. Empty-name characters skipped entirely (preserved from h0z).

## Testing

### New tests

- **`backend/tests/schemas/character.schema.test.ts`** — Zod schema unit tests: valid input round-trips for `characterSchema` / `characterCreateSchema` / `characterUpdateSchema`, invalid input rejection, `characterResponseSchema` + `charactersResponseSchema` wrapper round-trips.
- **`backend/tests/services/prompt.service.test.ts`** — new describe block `character XML rendering — full sheet`:
  - Full 9-field render with hybrid attrs+nested shape.
  - Scalar-only render (only name/role/age set).
  - Single-prose-field render.
  - All-empty render → self-closing.
  - Escape across attributes (`& < > "`) and nested children (`& < >`).
  - Collision tests against new tag names: `</relationships>`, `</backstory>`, `</personality>`.
  - Existing collision test against `</character>` extended to confirm structural integrity with the new multi-line shape.
- **`backend/tests/repos/character.repo.test.ts`** — `relationships` round-trip; verify `physicalDescription` / `notes` are no longer accepted by the repo (TS-level — the fields no longer exist on the input type).
- **`frontend/tests/hooks/useCharacters.test.tsx`** — coverage for the runtime-validation path: schema parse on success, schema parse on drift (mock a response missing a required field, assert ZodError surfaces through the hook's error path).
- **`frontend/src/components/CharacterSheet.stories.tsx`** — story variant with `relationships` populated.

### Updated tests

- `backend/tests/services/prompt.service.test.ts`'s `toCharacterContext (h0z)` describe block — **deleted entirely**. Function is gone.
- `backend/tests/services/prompt.service.test.ts`'s `charactersBlock XML rendering (h0z)` describe block — updated for hybrid shape (the existing tests assert the flat `<character name="…" role="…">traits</character>` form, which no longer renders).
- `backend/tests/routes/characters.test.ts` — request/response shape assertions migrated to reference the shared schemas instead of literal shape duplication.

### Encryption leak test

`backend/tests/security/encryption-leak.test.ts` requires no test changes — its sentinel scan covers all narrative tables generically. Must pass after the migration. The new `relationships*` columns are encrypted via the same pipeline; the dropped `physicalDescription*` and `notes*` columns simply leave the scan list.

### Verify line for the bd issue

```
npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix backend test -- tests/services/prompt.service.test.ts tests/repos/character.repo.test.ts tests/schemas/character.schema.test.ts tests/security/encryption-leak.test.ts && npm --prefix frontend test -- src/hooks/useCharacters
```

## Migration ergonomics & forward compatibility

This PR is fully forward-compatible with multiple future paths:

- **Migrating other entities to shared schemas** — purely mechanical: move each entity's Zod schemas from its route file into `shared/schemas/<entity>.ts`, update imports. No architectural change.
- **Adding ts-rest later** — if a future need arises for typed clients or automatic OpenAPI generation, ts-rest contracts can be added on top of the shared Zod schemas without redesign. The shared schemas are exactly what a ts-rest contract would consume.
- **Adding runtime validation on backend egress** — currently the backend trusts that the repo's decrypted output matches `characterSchema`. A future "defensive parse on outbound responses too" can be added by parsing handler return bodies against the response schemas. Not in this PR (low value when the repo's output is already type-checked).

## Considered alternatives

**ts-rest mixed pattern (character routes only)** — initially proposed in an earlier draft; rejected. Trade-off summary: ts-rest gives stronger end-to-end inference and an OpenAPI-generation path "for free," but introduces a new library, a new client pattern on the frontend, a custom-fetcher delegation to preserve auth-retry semantics, and asymmetry against the rest of the API. Shared Zod schemas deliver the same single-source-of-truth without those costs. ts-rest remains an option for a later PR if the typed-client benefits become compelling.

**Generated types from Prisma** — rejected. Prisma's generated types model the database row shape, not the API response shape (decrypted columns, optional vs nullable mismatches, Date vs string serialization). Would require adapter types at the API edge — partially defeats the single-source goal.

**Hand-keep types in sync, lint for drift** — rejected. Doesn't solve the problem; pays interest forever.

## Risks

- **Frontend bundle cost.** Zod adds ~12kb gzipped. Accepted; documented here.
- **`@shared/*` path mapping drift.** Two tsconfigs must stay in sync. A small CI check script asserts both have the mapping; runs alongside `lint:design`. Belt-and-braces; small footprint.
- **Runtime validation latency.** Schema parse on every response adds <1ms in practice; negligible. If it becomes a hot path concern (e.g. a chat tab pulling characters every keystroke), parse can be moved into a `useMemo` or skipped on cached responses — handled per-call site if needed.
- **Repo-boundary surface.** Prompt service consumes a richer `Character` shape but still receives decrypted plaintext from the repo. No new ciphertext-egress paths. `repo-boundary-reviewer` runs at close-gate as usual.

## Out of scope

Explicitly NOT in this PR:

- ts-rest adoption for any route.
- Migration of other entities' Zod schemas into `/shared/`. (Each is a small follow-up; can be done as needed.)
- Character context truncation strategy (deferred per direction question — file as separate bd issue).
- Runtime validation of backend response egress (not just inbound request bodies).
- OpenAPI / Swagger generation from the Zod schemas.
- Storybook redesign of `CharacterSheet` (the new field uses the established pattern; no UI redesign).
- `Story.systemPrompt` or other entities' consolidation.
- Per-character / per-field "include in AI" flags.

## Acceptance criteria

- Schema migration runs cleanly; new `relationships*` triple present, old `physicalDescription*` / `notes*` triples gone.
- Single canonical `Character` Zod schema in `shared/schemas/character.ts`; no other hand-maintained `Character` interface in backend or frontend.
- `CharacterSheet` form exposes all 9 narrative fields; `relationships` is fillable end-to-end (UI → API → DB → re-read → UI).
- Prompt builder renders the full character with the hybrid XML shape; all 9 fields appear in the system message when populated; empty fields suppressed; escapes applied; collision tests pass for all new tag names.
- Frontend runtime-validates API responses against the shared schemas; a drift smoke test (mocked malformed response) surfaces as a `ZodError` through the hook's error path.
- Encryption leak test passes.
- `lint:design` and both typechecks clean.
- Repo-boundary review CLEAN at close-gate.

## bd

Will be filed when this design is approved and a plan is written.
