# Character entity consolidation — design

## Summary

Consolidate `Character` into a single canonical entity that flows through every layer of the app. Today the schema has 10 ciphertext-encrypted narrative fields, the frontend type carries only 7, the `CharacterSheet` form exposes 7, and the prompt builder narrows further to a 3-field projection (`name`, `role`, `keyTraits` — a `; `-joined string of personality + arc + appearance + voice). Three of the schema's columns are encrypted dead weight (`physicalDescription`, `notes`, plus a yet-to-be-added `relationships`), and the prompt builder loses information at every interpolation. This design replaces all of that with one source-of-truth contract, surfaces every field in the form, and renders the full character into the prompt.

The entity is also re-shaped: `physicalDescription` collapses into `appearance` (semantic duplication), `notes` is removed (was author-only scratchpad with no clear lifecycle), and a new `relationships` field is added (user-requested — describes character relationships in the prompt).

The single source of truth is implemented via **ts-rest** for the character routes only — adopted as a mixed-pattern interim. ts-rest's contract becomes the canonical shape; Zod inference produces the TypeScript type; backend, frontend, and prompt builder all consume it. Other entities stay on raw Express + manual Zod for now, with this PR scaffolding the migration path.

## Motivation

Today there are three drift seams:

1. **Schema vs. UI.** The schema has `physicalDescriptionCiphertext` / `notesCiphertext` triples; the frontend type and form know nothing about them. The user can never write or read them. They're encrypted columns paying CPU + storage cost for data that doesn't exist.
2. **UI vs. prompt builder.** The form collects 7 fields; `toCharacterContext` consumes only 4 (`personality`, `arc`, `appearance`, `voice`) and drops `age` entirely. The user's `age` input never reaches the model. The other fields are concatenated with `; ` into one opaque string — the model can't distinguish personality from voice.
3. **Backend type vs. frontend type.** `CharacterCreateInput` (backend), `Character` (frontend `useCharacters.ts`), `CharacterContext` + `CharacterRecord` (prompt service) are four hand-maintained interfaces describing the same entity from different angles. Adding a field requires changing all four. Each lives in its own file with no automated drift detection.

The goal is a single canonical `Character` shape — defined once, consumed everywhere, with the prompt builder receiving the full sheet.

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

### Single source of truth: ts-rest contract

New file: **`shared/contracts/character.contract.ts`**.

```ts
import { initContract } from '@ts-rest/core';
import { z } from 'zod';

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

export const characterCreateSchema = characterSchema
  .omit({ id: true, storyId: true, createdAt: true, updatedAt: true, orderIndex: true })
  .extend({
    name: z.string().min(1),
    // role…relationships stay nullable (omitting is equivalent to passing null)
  })
  .partial({ role: true, age: true, appearance: true, personality: true, voice: true,
             backstory: true, arc: true, relationships: true, color: true, initial: true });

export const characterUpdateSchema = characterCreateSchema.partial();

export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;

const c = initContract();

export const characterContract = c.router({
  list: {
    method: 'GET',
    path: '/api/stories/:storyId/characters',
    pathParams: z.object({ storyId: z.string().uuid() }),
    responses: { 200: z.object({ characters: z.array(characterSchema) }) },
    summary: 'List characters for a story',
  },
  get: {
    method: 'GET',
    path: '/api/characters/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: { 200: z.object({ character: characterSchema }), 404: z.object({ error: z.object({ message: z.string(), code: z.string() }) }) },
  },
  create: {
    method: 'POST',
    path: '/api/stories/:storyId/characters',
    pathParams: z.object({ storyId: z.string().uuid() }),
    body: characterCreateSchema,
    responses: { 201: z.object({ character: characterSchema }) },
  },
  update: {
    method: 'PATCH',
    path: '/api/characters/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    body: characterUpdateSchema,
    responses: { 200: z.object({ character: characterSchema }), 404: z.object({ error: z.object({ message: z.string(), code: z.string() }) }) },
  },
  remove: {
    method: 'DELETE',
    path: '/api/characters/:id',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: { 204: z.null(), 404: z.object({ error: z.object({ message: z.string(), code: z.string() }) }) },
  },
  reorder: {
    method: 'PATCH',
    path: '/api/stories/:storyId/characters/reorder',
    pathParams: z.object({ storyId: z.string().uuid() }),
    body: z.object({ items: z.array(z.object({ id: z.string().uuid(), orderIndex: z.number().int().nonnegative() })) }),
    responses: { 204: z.null() },
  },
});
```

(Final endpoint shapes are inferred from current `characters.routes.ts` — adjusted only to express the contract.)

### Wiring

- **Dependencies**: add `@ts-rest/core`, `@ts-rest/express`, `@ts-rest/react-query` (latest stable per the project's library-version-awareness rule — check `npm view` before pinning).
- **Path mapping**: `@shared/*` → `./shared/*` in both `backend/tsconfig.json` and `frontend/tsconfig.json`.
- **No npm workspaces**: the project doesn't use them today; not adopting that scope. Path mapping alone suffices.

### What gets deleted

- `frontend/src/hooks/useCharacters.ts`'s hand-rolled `interface Character` (and `CharactersResponse`, `CharacterResponse`).
- `backend/src/services/prompt.service.ts`'s `CharacterContext` interface, `CharacterRecord` interface, `toCharacterContext` function.
- `backend/src/repos/character.repo.ts`'s `CharacterCreateInput`, `CharacterUpdateInput` interfaces (replaced by inferred types).
- All tests for `toCharacterContext` (added in h0z Task 1) — function is gone.

### Backwards-compat shim (one item)

`useCharacters.ts` re-exports `Character` as an alias of the inferred response type so component imports (`import { type Character } from '../hooks/useCharacters'`) keep working without a frontend-wide find-and-replace:

```ts
export type Character = (typeof characterContract.list.responses)[200]['characters'][number];
// or via @ts-rest's ClientInferResponses helper — pick whichever reads cleaner
```

This is migration ergonomics, not architectural debt. Each future entity migration faces the same shim-vs-update-imports choice independently.

## API surface

### Backend

`backend/src/routes/characters.routes.ts` becomes thin glue:

```ts
import { createExpressEndpoints, initServer } from '@ts-rest/express';
import { characterContract } from '@shared/contracts/character.contract';
import { createCharacterRepo } from '../repos/character.repo';
import { requireAuth } from '../middleware/requireAuth';
import { requireStoryOwnership } from '../middleware/ownership';

const s = initServer();
const router = s.router(characterContract, {
  list: async ({ params, req }) => {
    const characters = await createCharacterRepo(req).findManyForStory(params.storyId);
    return { status: 200, body: { characters } };
  },
  // …
});

export function mountCharacterRoutes(app: Express) {
  createExpressEndpoints(characterContract, router, app, {
    globalMiddleware: [requireAuth],
    // per-endpoint ownership middleware via the routerImpl above
  });
}
```

The repo (`backend/src/repos/character.repo.ts`) updates:
- `ENCRYPTED_FIELDS` → `['name', 'role', 'age', 'appearance', 'voice', 'arc', 'personality', 'backstory', 'relationships']`.
- `CharacterCreateInput` / `CharacterUpdateInput` interfaces deleted; replaced by ts-rest-inferred types.
- All other repo behaviour unchanged (encrypt-on-write / decrypt-on-read, transaction logic for `remove`/`reorder`, ownership checks).

Auth + ownership middleware unchanged. Request-scoped DEK cache unchanged.

### Frontend

`frontend/src/components/CharacterSheet.tsx` adds **one new field**: `relationships` (textarea). Same pattern as the existing 8 prose fields:
- Add `relationships` to the `FieldKey` union and `Form` interface.
- Add the textarea + label in render.
- Add to the diff helper's iteration list.
- Add `relationships: ''` to `EMPTY_CHARACTER`.

`frontend/src/hooks/useCharacters.ts`:
- Drops the hand-rolled `Character` interface.
- Replaces direct `api()` calls with `initQueryClient(characterContract, { ... })`.
- The ts-rest client uses a **custom fetcher** that delegates to the existing `api()` function — preserves auth header injection + refresh-retry semantics. No duplication of auth-retry logic.
- Existing TanStack Query keys (`['characters', storyId]`, etc.) preserved; the typed client wraps mutations and queries with the existing key shape.
- Re-exports `Character` as documented in the shim section above.

### What stays REST

Stories, chapters, outline, chats, messages, ai/*, auth/* — untouched. Mixed pattern is explicit. Each future entity migration is a separate bd issue.

## Prompt builder

`backend/src/services/prompt.service.ts`:

- Remove `CharacterContext`, `CharacterRecord`, `toCharacterContext`.
- `BuildPromptInput.characters` becomes `Character[]` (imported from `@shared/contracts/character.contract`).
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

`ai.routes.ts` and `chat.routes.ts` drop their `.map(toCharacterContext)` calls and pass `rawCharacters` directly. (`toCharacterContext` doesn't exist anymore.)

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

- **`backend/tests/contracts/character.contract.test.ts`** — Zod schema unit tests: valid input round-trips, invalid input rejection, type inference smoke (a `expectTypeOf` assertion on the inferred shape).
- **`backend/tests/services/prompt.service.test.ts`** — new describe block `character XML rendering — full sheet`:
  - Full 9-field render with hybrid attrs+nested shape.
  - Scalar-only render (only name/role/age set).
  - Single-prose-field render.
  - All-empty render → self-closing.
  - Escape across attributes (`& < > "`) and nested children (`& < >`).
  - Collision tests against new tag names: `</relationships>`, `</backstory>`, `</personality>`.
  - Existing collision test against `</character>` extended to confirm structural integrity.
- **`backend/tests/repos/character.repo.test.ts`** — `relationships` round-trip; verify `physicalDescription`/`notes` no longer accepted by the repo.
- **`frontend/tests/hooks/useCharacters.test.tsx`** — coverage for the ts-rest typed client (mock at the custom-fetcher level since the ts-rest client is the new boundary).
- **`frontend/src/components/CharacterSheet.stories.tsx`** — story variant with `relationships` populated.

### Updated tests

- `backend/tests/services/prompt.service.test.ts`'s `toCharacterContext (h0z)` describe block — **deleted entirely**. Function is gone.
- `backend/tests/services/prompt.service.test.ts`'s `charactersBlock XML rendering (h0z)` describe block — updated for hybrid shape (the existing tests assert the flat `<character name="…" role="…">traits</character>` form, which no longer renders).
- `backend/tests/routes/characters.test.ts` — request/response shape assertions migrated to use the ts-rest contract types instead of literal shape assertions where reasonable.

### Encryption leak test

`backend/tests/security/encryption-leak.test.ts` requires no test changes — its sentinel scan covers all narrative tables generically. Must pass after the migration. The new `relationships*` columns are encrypted via the same pipeline; the dropped `physicalDescription*` and `notes*` columns simply leave the scan list.

### Verify line for the bd issue

```
npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix backend test -- tests/services/prompt.service.test.ts tests/repos/character.repo.test.ts tests/contracts/character.contract.test.ts tests/security/encryption-leak.test.ts && npm --prefix frontend test -- src/hooks/useCharacters
```

## Migration ergonomics & forward compatibility

This PR is fully forward-compatible with completing the ts-rest migration across the rest of the API:

- Each future entity gets a sibling file under `shared/contracts/`. Zero per-contract infrastructure.
- ts-rest and Express coexist on the same Express app — `createExpressEndpoints` registers handlers as ordinary middleware. No conflict.
- ts-rest's react-query client and the existing `frontend/src/lib/api.ts` coexist on the frontend. Both hit the same backend.
- Ownership middleware threads through ts-rest via per-endpoint `middleware: [...]` config.
- The custom-fetcher pattern (ts-rest delegating to `api()`) means the auth-retry logic isn't duplicated — when the second contract lands, factor `createTypedClient(contract)` to share fetcher + base URL config.

When all entities have migrated, `frontend/src/lib/api.ts` either:
- Stays as the low-level HTTP fetcher that ts-rest delegates to (clean separation: contract layer vs. HTTP layer), or
- Gets deleted with auth-retry logic moved into a ts-rest-native interceptor.

That decision is a follow-up, not constrained by this PR.

`@ts-rest/open-api` integration becomes a free win once all routes migrate — generated OpenAPI spec → potential client SDK / Postman collection. Out of scope here.

## Risks

- **ts-rest learning curve.** First time the codebase uses it. Mitigated by following ts-rest's documented Express + react-query patterns directly (see https://ts-rest.com/docs/express/) and keeping the contract minimal.
- **`@shared/*` path mapping drift.** Two tsconfigs must stay in sync. Add a small CI check (a script that grep-asserts both tsconfigs have the mapping; runs alongside `lint:design`). Belt-and-braces; small footprint.
- **Repo-boundary surface.** Prompt service consumes a richer `Character` shape but still receives decrypted plaintext from the repo. No new ciphertext-egress paths. `repo-boundary-reviewer` runs at close-gate as usual.

## Out of scope

Explicitly NOT in this PR:

- ts-rest migration of stories / chapters / outline / chats / messages / ai / auth routes.
- Character context truncation strategy (deferred per direction question — file as separate bd issue).
- OpenAPI generation from contracts.
- Decision on `lib/api.ts`'s long-term existence.
- Storybook redesign of `CharacterSheet` (the new field uses the established pattern; no UI redesign).
- `Story.systemPrompt` or other entities' consolidation.
- Per-character / per-field "include in AI" flags.

## Acceptance criteria

- Schema migration runs cleanly; new `relationships*` triple present, old `physicalDescription*` / `notes*` triples gone.
- Single canonical `Character` type in `shared/contracts/character.contract.ts`; no other hand-maintained `Character` interface in backend or frontend.
- `CharacterSheet` form exposes all 9 narrative fields; `relationships` is fillable end-to-end (UI → API → DB → re-read → UI).
- Prompt builder renders the full character with the hybrid XML shape; all 9 fields appear in the system message when populated; empty fields suppressed; escapes applied; collision tests pass for all new tag names.
- ts-rest contract serves as the type source; backend handlers and frontend hooks both consume it.
- Encryption leak test passes.
- `lint:design` and both typechecks clean.
- Repo-boundary review CLEAN at close-gate.

## bd

Will be filed when this design is approved and a plan is written.
