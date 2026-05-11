# Character entity consolidation — design

## Summary

Consolidate `Character` into a single canonical entity that flows through every layer of the app. Today the schema has 10 ciphertext-encrypted narrative fields, the frontend type carries only 7, the `CharacterSheet` form exposes 7, and the prompt builder narrows further to a 3-field projection (`name`, `role`, `keyTraits` — a `; `-joined string of personality + arc + appearance + voice). Three of the schema's columns are encrypted dead weight (`physicalDescription`, `notes`, plus a yet-to-be-added `relationships`), and the prompt builder loses information at every interpolation.

The entity is also re-shaped: `physicalDescription` collapses into `appearance` (semantic duplication), `notes` is removed (was author-only scratchpad with no clear lifecycle), and a new `relationships` field is added (user-requested — describes character relationships in the prompt).

The single source of truth is implemented via **shared Zod schemas** in a new `shared/` **npm workspace**, consumed by both backend (where Zod is already the request validator) and frontend (which adds Zod as a dependency and runtime-validates response bodies). The Zod schema is also the **egress** validator on the backend: a small `respond(schema, res, data)` helper runs `.parse(data)` in non-production before serializing — making the schema authoritative for what the API returns, not just what types compile. ts-rest was considered and rejected — see "Considered alternatives."

## Motivation

Today there are three drift seams:

1. **Schema vs. UI.** The schema has `physicalDescriptionCiphertext` / `notesCiphertext` triples; the frontend type and form know nothing about them. The user can never write or read them. They're encrypted columns paying CPU + storage cost for data that doesn't exist.
2. **UI vs. prompt builder.** The form collects 7 fields; `toCharacterContext` consumes only 4 (`personality`, `arc`, `appearance`, `voice`) and drops `age` entirely. The user's `age` input never reaches the model. The other fields are concatenated with `; ` into one opaque string — the model can't distinguish personality from voice.
3. **Backend type vs. frontend type vs. prompt type.** `CharacterCreateInput` (backend), `Character` (frontend `useCharacters.ts`), `CharacterContext` + `CharacterRecord` (prompt service), and the inline `CreateCharacterBody = z.object({...}).strict()` in `characters.routes.ts` are five hand-maintained definitions of the same entity. Adding a field requires changing all five. No automated drift detection.

The goal is a single canonical `Character` Zod schema — defined once, consumed everywhere for both types and runtime validation — with the prompt builder receiving the full sheet.

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
- **Add** `relationshipsCiphertext`, `relationshipsIv`, `relationshipsAuthTag` (all `String?` in Prisma → `TEXT` in PostgreSQL, all nullable). The narrative-encryption helpers in `_narrative.ts` store base64-encoded ciphertext as text; this matches the existing convention for every other narrative ciphertext column. Don't introduce `BYTEA` — `writeEncrypted` would silently break.

Pre-deployment per CLAUDE.md "General" rule — no data-migration branches. Migration runs against an empty `Character` table in dev/test.

## Type architecture

### Single source of truth: shared Zod schemas

New file: **`shared/src/schemas/character.ts`**.

```ts
import { z } from 'zod';

// Full row, as returned by the API after decryption.
// Wire format for timestamps is ISO-8601 — backend serializes Date → string
// at the handler boundary. The Zod schema is the source of truth for the
// wire format; the repo's Date return is normalised before egress.
//
// `z.strictObject` rejects unknown keys — this is what closes the
// Prisma↔Zod drift seam at egress validation time. Adding a column to
// Prisma without updating this schema causes a `respond()` parse failure
// in dev/test, surfacing the drift loudly.
export const characterSchema = z.strictObject({
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Create input — name required; everything else optional. Strict at the
// inner shape; backend additionally calls `.strict()` at the request
// validator (defensive, since some derivations may relax strictness).
export const characterCreateSchema = z.strictObject({
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

// Update input — every field optional. `.partial()` preserves the
// strictness of the underlying object schema.
export const characterUpdateSchema = characterCreateSchema.partial();

// Response wrappers — match the existing API shape. Strict at every
// layer so `{ character, foo }` is also caught at egress.
export const characterResponseSchema = z.strictObject({ character: characterSchema });
export const charactersResponseSchema = z.strictObject({ characters: z.array(characterSchema) });

// Reorder payload — preserves the existing { characters: [...] } body shape.
export const characterReorderSchema = z.strictObject({
  characters: z.array(z.strictObject({
    id: z.string().uuid(),
    orderIndex: z.number().int().nonnegative(),
  })),
});

// Inferred types — consumed everywhere a Character is referenced.
export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;

// Narrow projection consumed by the prompt builder. Derived from Character
// (no parallel definition), so the field list can't drift. Drops id /
// storyId / orderIndex / color / initial / createdAt / updatedAt — none of
// which the prompt builder reads, two of which (id, storyId) are leak risks
// if a future contributor adds them to a template by accident.
export type CharacterPromptInput = Pick<
  Character,
  | 'name'
  | 'role'
  | 'age'
  | 'appearance'
  | 'personality'
  | 'voice'
  | 'backstory'
  | 'arc'
  | 'relationships'
>;

// Helper for routes that have a Character-shaped (or repo-shaped) value and
// need the narrowed projection. Accepts the structural subset so repo
// outputs with `Date` timestamps still type-check — timestamps aren't read.
export function toCharacterPromptInput(c: CharacterPromptInput): CharacterPromptInput {
  return {
    name: c.name,
    role: c.role,
    age: c.age,
    appearance: c.appearance,
    personality: c.personality,
    voice: c.voice,
    backstory: c.backstory,
    arc: c.arc,
    relationships: c.relationships,
  };
}
```

### Exported from `shared/src/index.ts`

The barrel re-exports everything the rest of the codebase consumes:

- **Schemas (Zod)**: `characterSchema`, `characterCreateSchema`, `characterUpdateSchema`, `characterResponseSchema`, `charactersResponseSchema`, `characterReorderSchema`.
- **Types (inferred)**: `Character`, `CharacterCreateInput`, `CharacterUpdateInput`.
- **Prompt projection**: `CharacterPromptInput`, `toCharacterPromptInput`.

No other types or schemas in this file are exported. The acceptance criteria reference this list — any deviation surfaces during review.

Strictness in `z.strictObject` is preserved through `.partial()`, `.omit()`, and similar derivations — once strict at the source, derivative schemas inherit it. Both ingress (request-body validation) and egress (`respond()` parse) reject unknown keys.

### Build wiring: npm workspaces

The project adopts npm workspaces. The wiring touches the root, both Dockerfiles, both tsconfigs, and `docker-compose.yml`.

**Root `package.json`:**
```jsonc
{
  "name": "story-editor",
  "private": true,
  "workspaces": ["backend", "frontend", "shared"],
  // ... existing scripts, devDependencies unchanged
}
```

**`shared/package.json`** (new):
```jsonc
{
  "name": "story-editor-shared",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.4.3" }
}
```

Resolution semantics — chose plain `main + types` over a conditional `exports` map to dodge the Vitest-resolves-to-`dist/`-without-a-build cliff edge that conditional maps create:

| Consumer | Hits | Resolves to | Build needed? |
|---|---|---|---|
| `tsc` typecheck / IDE | `types` | `src/index.ts` | no |
| Backend runtime (`node dist/`) — CJS | `main` | `dist/index.js` | yes |
| Backend Vitest — CJS | `main` | `dist/index.js` | yes |
| Backend `ts-node-dev` (dev) | `main` | `dist/index.js` | yes (kept fresh by `tsc -w` sidecar in `make dev`) |
| Frontend Vite (dev + prod bundle) | Vite alias | `shared/src/index.ts` | **no** |
| Frontend Vitest (jsdom) | Vite alias | `shared/src/index.ts` | **no** |

The frontend skips the build entirely via a Vite alias (`'story-editor-shared': path.resolve(__dirname, '../shared/src')` in `vite.config.ts`), which Vitest inherits because Vitest reads the same Vite config. **The frontend Dockerfile builder therefore needs no shared build step.** The backend Dockerfile builder DOES — `npm -w story-editor-shared run build` runs before `npm -w backend run build`.

`vitest` is **hoisted to the root `devDependencies`** (both backend and frontend currently pin `^4.1.5` — match that). The shared workspace inherits via npm-workspace dep resolution; no per-workspace vitest pin needed. Hoisting also avoids the version-drift surface of three independent vitest copies.

`shared/package.json` deliberately does NOT declare `"type": "module"` — it inherits CommonJS by default, matching backend (which is `"type": "commonjs"`). Backend's compiled CJS does `require('story-editor-shared')` and resolves to the workspace's `main`; no ESM/CJS interop needed.

Naming note: backend is `story-editor-backend`, frontend is `story-editor-frontend`, root is `story-editor` — all unscoped. The new workspace matches this convention.

**`shared/tsconfig.json`** (new) — broad include with `noEmit` so vitest, IDE, and `tsc --noEmit` cover both src and tests:
```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**`shared/tsconfig.build.json`** (new) — extends the base, narrows include to `src/`, emits `dist/`:
```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "noEmit": false
  },
  "include": ["src/**/*"]
}
```

**`shared/src/index.ts`** (new) — barrel:
```ts
export * from './schemas/character.ts';
```

**Backend wiring:**
- `backend/package.json` adds `"story-editor-shared": "*"` to `dependencies`. npm-workspace protocol auto-symlinks.
- `backend/tsconfig.json` is unchanged (`rootDir: "src"` continues to work; shared's compiled `dist/` is consumed via `node_modules/story-editor-shared/` from the workspace symlink — same as any other npm dep).
- `backend/Dockerfile` build context changes: `docker-compose.yml`'s `context: ./backend` becomes `context: .` with `dockerfile: backend/Dockerfile`. Same for frontend. The `deps` stage runs `npm ci --workspaces --include-workspace-root` (or equivalent) from the repo-root context. The `builder` stage runs `npm -w story-editor-shared run build` before `npm -w backend run build`.
- `backend/src/lib/serialize.ts` (new) — `serializeCharacter(row)` ISO-strings Date fields (createdAt, updatedAt) from the repo's `Date` return into wire-format strings before responses. Handler boundaries call it once.

**Frontend wiring:**
- `frontend/package.json` adds `"story-editor-shared": "*"` and `"zod": "^4.4.3"`.
- `frontend/vite.config.ts` adds an alias `'story-editor-shared': path.resolve(__dirname, '../shared/src')` so Vite consumes shared TS source directly, bypassing the workspace's `main`-pointed-`dist/`. No `optimizeDeps` entry needed, no shared build step required for the frontend dev server or production bundle. Vitest inherits the alias from the same Vite config.
- `frontend/tsconfig.app.json` — confirm it resolves `story-editor-shared` via node module resolution (no `paths` entry needed; the `node_modules` symlink suffices for both type and runtime resolution).

**`docker-compose.yml`:**
- `backend.build.context: ./backend` → `context: .`, `dockerfile: backend/Dockerfile`.
- `frontend.build.context: ./frontend` → `context: .`, `dockerfile: frontend/Dockerfile`.
- Per-subdir lockfiles (`backend/package-lock.json`, `frontend/package-lock.json`) are removed; a single root `package-lock.json` takes their place. `.gitignore` and any CI workflows referencing the per-subdir lockfiles need updating.

**Lockfile-drift verification.** Workspaces resolve transitive deps against the combined dep graph from root, which can pin different transitive versions than the per-subdir lockfiles previously did. Before merging the workspace conversion: capture `npm ls --all --workspaces` post-conversion and diff against the pre-conversion state (per-subdir `npm ls --all` outputs concatenated). Flag any major-version drift in transitive deps for explicit review — most are harmless; some (e.g. a runtime dep silently going up a major) deserve a deliberate look. Add this diff to the workspace-adoption task's verify line.

**`Makefile`:**
- `make dev`, `make rebuild-frontend`, etc. — verify they still work. Most should be transparent since they use `docker compose` which honors the updated context.

**CI workflows (`.github/workflows/`):**
This is the largest non-Docker surface to update. Verified against the actual files:

- **`ci.yml`** caches `backend/package-lock.json` and `frontend/package-lock.json` and does three separate `npm ci` runs (root, `working-directory: backend`, `working-directory: frontend`). Subsequent steps use `working-directory: backend` / `working-directory: frontend` for typecheck, test, build (~17 step-level overrides). Under workspaces, this collapses to a single root `npm ci`, the cache key becomes the root `package-lock.json`, and the per-step `working-directory` overrides for npm scripts switch to `npm -w backend run <script>` (or stay as-is — `npm run` works from any subdir with workspaces).
- **`e2e.yml`** has the same per-subdir lockfile cache + single root `npm ci` shape — adjust the cache key to the root lockfile.
- **`codeql.yml` and `secret-scan.yml`** — config-driven; spot-check that no path assumptions exist but no structural change expected.

The workflow updates land in the same commit/PR as the workspace adoption. CI must go green on the first push.

This wiring is a real change to the build setup. The implementation plan treats workspaces adoption as its own task block, landed before any character-specific work — so a failure mode is easy to localise.

### Egress validation: `respond(schema, res, data)` helper

New file: **`backend/src/lib/respond.ts`**.

```ts
import type { Response } from 'express';
import type { z } from 'zod';

const VALIDATE = process.env.NODE_ENV !== 'production';

export function respond<T>(
  schema: z.ZodType<T>,
  res: Response,
  data: T,
  status = 200,
): Response {
  if (VALIDATE) {
    // Throws ZodError on drift; the global error handler renders it.
    schema.parse(data);
  }
  return res.status(status).json(data);
}
```

Every character route handler returns via `respond(characterResponseSchema, res, { character })` etc. The schema is authoritative: if the repo starts returning an extra field, or a `Date` slips through unsterilised, the parse fails loudly in dev/test and fails the leak-test-style regression check at CI.

In production, the parse is skipped to avoid per-request latency. The dev/test coverage is sufficient — drift surfaces during development before it reaches prod.

Tests call `schema.parse(response.body)` (or use a small `expectShape(schema, response)` helper) directly, so the validation runs at test time regardless of `NODE_ENV`.

### Date serialization

The Zod schema declares `createdAt` and `updatedAt` as `z.string().datetime()`. The repo's `projectDecrypted` returns `Date` objects from Prisma. A small `serializeRow` helper (or the handler itself) converts Date → ISO string before `res.json()`. The wire format is the SoT; the backend conforms.

Concretely in `characters.routes.ts`:

```ts
const character = await createCharacterRepo(req).findById(id);
if (!character) return res.status(404).json({ error: { ... } });
const wire = { ...character, createdAt: character.createdAt.toISOString(), updatedAt: character.updatedAt.toISOString() };
respond(characterResponseSchema, res, { character: wire });
```

For the list endpoint, the same transform runs per row. Encapsulating this in `serializeCharacter(row)` keeps the handlers tidy.

### What gets deleted

- `frontend/src/hooks/useCharacters.ts`'s hand-rolled `interface Character` (and `CharactersResponse`, `CharacterResponse`).
- `backend/src/services/prompt.service.ts`'s `CharacterContext` interface, `CharacterRecord` interface, `toCharacterContext` function.
- `backend/src/repos/character.repo.ts`'s `CharacterCreateInput`, `CharacterUpdateInput` interfaces (replaced by inferred types from the shared workspace).
- `backend/src/routes/characters.routes.ts`'s inline `CreateCharacterBody`, `UpdateCharacterBody`, `ReorderCharactersBody` Zod schemas — replaced by `characterCreateSchema.strict()`, `characterUpdateSchema.strict()`, `characterReorderSchema.strict()` imports.
- All `toCharacterContext` tests from h0z Task 1 — function is gone.

### Import-site update (no re-export shim)

The previous draft proposed re-exporting `Character` from `useCharacters.ts` for backwards-compat. **Rejected**: that creates two import paths for the same type and is exactly the drift seam this work is supposed to close. Instead, every component that does:

```ts
import { type Character } from '../hooks/useCharacters';
```

gets updated to:

```ts
import { type Character } from 'story-editor-shared';
```

One find-and-replace step in the implementation plan. The hook still exports its TanStack Query helpers, just not the type.

## API surface

### Backend

`backend/src/routes/characters.routes.ts` keeps its current Express-style shape. Only the Zod schemas, the egress response shape, and the import sources change. The route preserves the existing per-handler `safeParse` + early-return pattern (matching every other route in the codebase):

```ts
import {
  characterCreateSchema,
  characterResponseSchema,
} from 'story-editor-shared';
import { badRequestFromZod } from '../lib/bad-request';
import { respond } from '../lib/respond';
import { serializeCharacter } from '../lib/serialize';

// POST /api/stories/:storyId/characters
router.post('/', ownStory, async (req, res, next) => {
  const parsed = characterCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequestFromZod(res, parsed.error);
    return;
  }
  const body = parsed.data;
  try {
    const character = await createCharacterRepo(req).create({
      storyId: req.params.storyId as string,
      ...body,
    });
    respond(characterResponseSchema, res, { character: serializeCharacter(character) }, 201);
  } catch (err) {
    next(err);
  }
});
```

Auth + ownership middleware unchanged. Request-scoped DEK cache unchanged. `badRequestFromZod` (existing helper at `backend/src/lib/bad-request.ts`) continues to produce 400s on input validation failures; ownership middleware produces 401/403/404. The `[D16]` POST retry loop for orderIndex collisions is preserved verbatim — only the schema source moves.

**Reorder-handler semantic checks survive verbatim.** The current handler does duplicate-id and duplicate-orderIndex validation in JS (`characters.routes.ts:171-188`) with the contract's `code: 'validation_error'` envelope — these are semantic checks that Zod can't express cleanly. Preserve them as-is; only the body schema's source moves to the shared workspace. An implementer reading "Zod now validates everything" should not be tempted to delete them.

**Why no `validateBody()` middleware in this PR.** A wrapper that does `safeParse` + 400 + attach `req.validatedBody` would be cleaner than per-handler boilerplate, but adopting it for character routes only creates an asymmetry against the eight other route files. Better as a workspace-wide cleanup PR after a few entities have migrated. Listed in Follow-up tasks.

The repo (`backend/src/repos/character.repo.ts`) updates:
- `ENCRYPTED_FIELDS` → `['name', 'role', 'age', 'appearance', 'voice', 'arc', 'personality', 'backstory', 'relationships']`.
- `CharacterCreateInput` / `CharacterUpdateInput` interfaces deleted; replaced by inferred types from `story-editor-shared`.
- All other repo behaviour unchanged (encrypt-on-write / decrypt-on-read, transaction logic for `remove`/`reorder`, ownership checks).

### Frontend

`frontend/src/components/CharacterSheet.tsx` adds **one new field**: `relationships` (textarea). Same pattern as the existing 8 prose fields. Imports update from `../hooks/useCharacters` → `story-editor-shared`.

`frontend/src/hooks/useCharacters.ts`:
- Drops the hand-rolled `Character` interface (no re-export).
- Imports `Character`, `characterResponseSchema`, `charactersResponseSchema` from `story-editor-shared`.
- Keeps using the existing `api()` helper from `lib/api.ts` — no new HTTP client, no library swap.
- **Adds runtime validation** on every response:
  ```ts
  const raw = await api(`/api/stories/${storyId}/characters`);
  const { characters } = charactersResponseSchema.parse(raw);
  return characters;
  ```
  Validation errors throw a `z.ZodError`; the api error boundary catches them as it would any other thrown error.
- TanStack Query keys preserved (`['characters', storyId]`, etc.).
- Existing optimistic-update mutations (`useDeleteCharacterMutation`, `useReorderCharactersMutation`) stay exactly as written. The reorder body keeps the `{ characters: [...] }` shape (no contract enforces a rename).

### What stays REST

All other routes (stories, chapters, outline, chats, messages, ai/*, auth/*) are untouched. Their existing Zod validators stay inline in the route files. Other entities can migrate their Zod schemas to `story-editor-shared` incrementally in follow-up PRs — purely a file relocation, no architectural shift.

## Prompt builder

`backend/src/services/prompt.service.ts`:

- Remove `CharacterContext`, `CharacterRecord`, `toCharacterContext`.
- `BuildPromptInput.characters` becomes `CharacterPromptInput[]` (imported from `story-editor-shared`). This is the narrow `Pick<Character, ...>` projection — `id`, `storyId`, structural fields, and timestamps are intentionally out of scope here. The narrower type is leak-defensive (a future contributor can't `${c.id}` into a template) and avoids forcing callers to serialize Date → ISO strings before calling `buildPrompt` (since timestamps aren't part of the type at all).
- `ai.routes.ts` and `chat.routes.ts` call `rawCharacters.map(toCharacterPromptInput)` before passing to `buildPrompt` — explicit projection at the seam.
- New `renderCharacterTag(c: CharacterPromptInput): string`:

```ts
function renderCharacterTag(c: CharacterPromptInput): string {
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

`ai.routes.ts` and `chat.routes.ts` replace their `.map(toCharacterContext)` calls with `.map(toCharacterPromptInput)` — the function lives in `story-editor-shared`, not the prompt service.

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

## Prisma ↔ Zod drift seam (honest acknowledgment)

This design closes the type-drift seams between backend, frontend, and prompt builder. It does **not** close the seam between Prisma's schema and the Zod schema. If a future contributor adds a `nickname` column to `Character` in Prisma without updating `characterSchema`, the repo will return a row containing `nickname` and the shared "single source of truth" silently isn't. Two mitigations:

1. **Egress validation** (above) catches it at test time. The schemas are declared with `z.strictObject` from the source — `characterSchema` itself rejects unknown keys, not just the wrapper. `respond()`'s `parse()` therefore fails loudly when Prisma adds a column without a Zod-schema update. No additional `.strict()` call at the use site is needed.
2. **A future option** (out of scope here) is `prisma-zod-generator` — generates the Zod schema from Prisma. Would close this seam too. Not adopted now; flagged for consideration once the project has a second or third entity migrated to shared schemas and the pattern is settled.

## Testing

### New tests

- **`shared/tests/character.schema.test.ts`** — Zod schema unit tests living in the shared workspace itself: valid input round-trips for `characterSchema` / `characterCreateSchema` / `characterUpdateSchema`, invalid input rejection, wrapper schema round-trips, `.strict()` rejection behaviour.
- **`backend/tests/services/prompt.service.test.ts`** — new describe block `character XML rendering — full sheet`:
  - Full 9-field render with hybrid attrs+nested shape.
  - Scalar-only render (only name/role/age set).
  - Single-prose-field render.
  - All-empty render → self-closing.
  - Escape across attributes (`& < > "`) and nested children (`& < >`).
  - Collision tests against new tag names: `</relationships>`, `</backstory>`, `</personality>`.
  - Existing collision test against `</character>` extended to confirm structural integrity with the new multi-line shape.
- **`backend/tests/repos/character.repo.test.ts`** — `relationships` round-trip; verify `physicalDescription` / `notes` are no longer accepted by the repo (TS-level — the fields no longer exist on the input type).
- **`backend/tests/lib/respond.test.ts`** — `respond` helper coverage: parses in non-prod (rejects on drift), skips parse in prod (no throw, status set correctly).
- **`backend/tests/routes/characters.test.ts`** — every existing route test extended with `charactersResponseSchema.parse(response.body)` / `characterResponseSchema.parse(response.body)` assertions. The route tests *become* the egress contract enforcement.
- **`frontend/tests/hooks/useCharacters.test.tsx`** — runtime-validation path: schema parse on success, schema parse on drift (mock a response missing a required field, assert `ZodError` surfaces through the hook's error path).
- **`frontend/src/components/CharacterSheet.stories.tsx`** — story variant with `relationships` populated.

### Updated tests

- `backend/tests/services/prompt.service.test.ts`'s `toCharacterContext (h0z)` describe block — **deleted entirely**. Function is gone.
- `backend/tests/services/prompt.service.test.ts`'s `charactersBlock XML rendering (h0z)` describe block — updated for hybrid shape.
- Every test file in the frontend that imports `type Character` from `useCharacters` — import sites updated to `story-editor-shared`.

### Encryption leak test

`backend/tests/security/encryption-leak.test.ts` requires no test changes — its sentinel scan covers all narrative tables generically. Must pass after the migration. The new `relationships*` columns are encrypted via the same pipeline; the dropped `physicalDescription*` and `notes*` columns simply leave the scan list.

### Verify line for the bd issue

```
npm -w story-editor-shared run build && npm -w story-editor-shared run typecheck && npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && npm -w story-editor-shared test && npm -w story-editor-backend test -- tests/services/prompt.service.test.ts tests/repos/character.repo.test.ts tests/lib/respond.test.ts tests/routes/characters.test.ts tests/security/encryption-leak.test.ts && npm -w story-editor-frontend test -- src/hooks/useCharacters src/components/CharacterSheet
```

The `npm -w story-editor-shared run build` step is **first** — backend Vitest resolves `story-editor-shared` to `dist/`, so dist must exist before any backend test runs. (Frontend Vitest reads source via the Vite alias and doesn't need it, but running the build once at the start is cheap.) The verify line uses `npm -w <workspace>` rather than `npm --prefix <subdir>` to align with the workspaces-adoption posture; both work, but `-w` is the canonical form.

## Migration ergonomics & forward compatibility

This PR is forward-compatible with multiple future paths:

- **Migrating other entities** — purely mechanical: each entity's Zod schemas move from its route file into `shared/src/schemas/<entity>.ts`, route handlers adopt `respond()`, frontend hooks parse responses. No architectural change.
- **Adding ts-rest later** — if a future need arises for typed clients or automatic OpenAPI generation, ts-rest contracts can be added on top of the shared Zod schemas without redesign.
- **`prisma-zod-generator`** — closes the Prisma↔Zod seam; trivial to add once one or two more entities have migrated and the workflow is settled.
- **Stricter egress validation in production** — the `respond` helper's prod skip can be removed (with a small latency cost) if drift becomes a recurring class of bug.

## Considered alternatives

**ts-rest mixed pattern (character routes only)** — initially proposed in an earlier draft of this design; rejected. Trade-off summary: ts-rest gives stronger end-to-end inference and an OpenAPI-generation path "for free," but introduces a new library, a new client pattern on the frontend, a custom-fetcher delegation to preserve auth-retry semantics, and asymmetry against the rest of the API. Shared Zod schemas + egress validation deliver the same single-source-of-truth without those costs. ts-rest remains an option for a later PR.

**Generated types from Prisma alone** — rejected. Prisma's generated types model the database row shape, not the API response shape (decrypted columns, optional vs nullable mismatches, Date vs string serialization). Would require adapter types at the API edge — partially defeats the single-source goal. `prisma-zod-generator` (generates Zod from Prisma) is a different option, mentioned above as a future possibility.

**Hand-keep types in sync, lint for drift** — rejected. Doesn't solve the problem; pays interest forever.

**Path mapping without workspaces** — rejected. Verified against the actual build setup: `backend/tsconfig.json:7` has `rootDir: "src"` (tsc won't compile files outside `backend/src/`), both Dockerfiles do `COPY . .` against per-subdir contexts (a repo-root `shared/` would be invisible at build time), and Vite has no `@shared` alias. Path mapping alone can't bridge those constraints; workspaces or a Docker-context change is required. Workspaces is cleaner.

## Risks

- **Workspaces adoption is a one-time cost.** Lockfile consolidation, Dockerfile context changes, `docker-compose.yml` context changes, Makefile sanity-check, CI workflow updates (concrete: `ci.yml` and `e2e.yml` both reference per-subdir lockfiles and per-subdir `working-directory: backend|frontend` patterns — see the wiring section above). Mitigation: land workspaces adoption as the first task block in the plan; verify `make dev`, a full `make test` cycle, and a CI dry-run all pass before any character-specific changes start.
- **Frontend bundle cost.** Zod 4 adds ~13kb gzipped. Accepted; documented here.
- **`shared/` build orchestration.** Backend Vitest and prod runtime both resolve `story-editor-shared` to its `main` (`dist/index.js`). Three orchestration points must build shared before backend tests/dev run: (1) `make dev` runs `tsc -w -p shared/tsconfig.build.json` as a sidecar so dist stays fresh during dev; (2) `make test` runs `npm -w story-editor-shared run build` before invoking workspace tests; (3) CI workflows do the same. The verify line below builds shared explicitly. Frontend is unaffected — its Vite alias bypasses dist.
- **Egress validation latency.** Schema parse on every response adds <1ms in dev and is skipped in prod. Not a hot-path concern.
- **Repo-boundary surface.** Prompt service consumes a richer `Character` shape but still receives decrypted plaintext from the repo. No new ciphertext-egress paths. `repo-boundary-reviewer` runs at close-gate as usual.
- **Prisma↔Zod drift remains uncovered by static analysis.** Egress validation catches it at test time. Acknowledged honestly in its own section above.

## Out of scope

Explicitly NOT in this PR:

- ts-rest adoption for any route.
- Migration of other entities' Zod schemas into `story-editor-shared`. (Each is a small follow-up — see "Follow-up tasks" below.)
- Character context truncation strategy (deferred per direction question — see "Follow-up tasks" below).
- `prisma-zod-generator` adoption.
- Production-mode egress validation (would add latency; not justified yet).
- Storybook redesign of `CharacterSheet` (the new field uses the established pattern; no UI redesign).
- `Story.systemPrompt` or other entities' consolidation.
- Per-character / per-field "include in AI" flags.

## Follow-up tasks

**Each item below requires a separate bd issue to be filed after this PR lands.** The workspace foundation makes these cheap to execute individually; bundling them into this PR would balloon scope. They are listed here so they're not lost.

### High-value, mechanical (unblocked by this PR's workspace adoption)

- **Migrate `Story` Zod schemas → `story-editor-shared`.** Move inline request validators from `backend/src/routes/stories.routes.ts` into `shared/src/schemas/story.ts`. Drop the frontend's hand-rolled `Story` interface in `frontend/src/hooks/useStories.ts`. Apply the `respond(schema, res, data)` egress pattern. Pattern identical to Character; file an issue per entity.
- **Migrate `Chapter` Zod schemas → `story-editor-shared`.** Same shape as Story. Note: chapter has a TipTap JSON body that needs careful schema treatment (likely `z.unknown()` or `z.record(z.unknown())` at the boundary — TipTap's internal structure is its own contract).
- **Migrate `OutlineItem` Zod schemas → `story-editor-shared`.** Same shape.
- **Migrate `Chat` Zod schemas → `story-editor-shared`.** Same shape.
- **Migrate `Message` Zod schemas → `story-editor-shared`.** Append-only entity (no update endpoint); slightly simpler schema set than the others.

### Design-and-decide

- **Character context truncation strategy.** Send-all is the right starting point but breaks down at scale. Three candidate shapes (per the original brainstorm): per-field soft caps; per-character or per-field `includeInAi` toggle; characters block becomes truncatable like chapters with `orderIndex` as priority. File when a user actually hits a context wall; pick based on the failure mode.
- **`prisma-zod-generator` evaluation.** Closes the Prisma↔Zod drift seam acknowledged in this design. Worth revisiting once two or three entities have settled into the shared pattern — gives a concrete data point on how much per-PR boilerplate the generator would save vs. its setup + maintenance cost.
- **Production-mode egress validation.** The `respond` helper currently skips parsing in production. Removing the skip catches drift in prod at a small latency cost (~<1ms per response). File when there's evidence drift is leaking past dev/test (recurring class of bug), or when the latency budget allows.
- **`validateBody(schema)` ingress middleware.** A wrapper that runs `safeParse` + 400 on failure + attaches typed body to `req` would replace the per-handler `safeParse` + early-return boilerplate everywhere. Cleaner end state but should be applied workspace-wide in one PR (not character-routes-only) to avoid asymmetry. File once two or three entities have migrated to shared schemas and the friction is observable.
- **OpenAPI / API documentation generation from shared schemas.** Once 3+ entities have migrated to `shared/`, the Zod schemas can drive an OpenAPI spec via `@anatine/zod-openapi` or similar. Useful for a generated API reference, Postman collection, or future external integrations. Out of scope until there's a concrete consumer.

### Opportunistic

- **Shared TS utilities cleanup.** Any cross-tree duplicates that surface as future contributors notice them — date formatters, ID generators, common parsing helpers. No forcing function; let them migrate when someone touches them.
- **`Story.systemPrompt` consolidation.** The story-level system prompt override has its own type-drift surface (different from Character's). Worth its own design pass; not blocked by this PR but not enabled by it either.
- **Per-character / per-field "include in AI" flags.** UX-bearing feature; depends on truncation strategy decision above. File when the truncation conversation reaches a UI question.

## Acceptance criteria

- npm workspaces adopted (`backend`, `frontend`, `shared`); root `package-lock.json` is the single lockfile; both Dockerfiles build from repo-root context; `make dev` and `make test` pass.
- CI workflows updated: `ci.yml` and `e2e.yml` cache the root lockfile only; `npm ci` runs once from root; per-step `working-directory` overrides for npm scripts adjusted; first push to CI on the converted branch is green.
- Schema migration runs cleanly; new `relationships*` triple present, old `physicalDescription*` / `notes*` triples gone.
- Single canonical `Character` Zod schema in `shared/src/schemas/character.ts`; no other hand-maintained `Character` interface anywhere in `backend/`, `frontend/`, or `shared/`.
- Backend `characters.routes.ts` consumes `characterCreateSchema.strict()`, `characterUpdateSchema.strict()`, `characterReorderSchema.strict()` from `story-editor-shared` — no inline duplicates.
- Backend `character.repo.ts` consumes `CharacterCreateInput` / `CharacterUpdateInput` inferred from the shared schemas — no parallel interfaces.
- `respond(schema, res, data)` helper exists; every character handler returns via it; non-prod parsing catches drift; prod skips the parse cleanly.
- Wire format for `createdAt` / `updatedAt` is ISO-8601 strings; backend serialises Date → ISO string at the handler boundary.
- `CharacterSheet` form exposes all 9 narrative fields; `relationships` is fillable end-to-end (UI → API → DB → re-read → UI).
- Prompt builder renders the full character with the hybrid XML shape; all 9 fields appear in the system message when populated; empty fields suppressed; escapes applied; collision tests pass for all new tag names.
- Frontend runtime-validates API responses against the shared schemas; a drift smoke test (mocked malformed response) surfaces as a `ZodError` through the hook's error path.
- No `Character` re-export from `useCharacters.ts`; all component import sites point at `story-editor-shared`.
- Encryption leak test passes.
- `lint:design` and all three typechecks (`shared`, `backend`, `frontend`) clean.
- `shared/src/index.ts` re-exports exactly the documented set: `characterSchema`, `characterCreateSchema`, `characterUpdateSchema`, `characterResponseSchema`, `charactersResponseSchema`, `characterReorderSchema`, `Character`, `CharacterCreateInput`, `CharacterUpdateInput`, `CharacterPromptInput`, `toCharacterPromptInput`. No other symbols leak out.
- Prompt builder consumes `CharacterPromptInput[]`, not `Character[]`. `ai.routes.ts` and `chat.routes.ts` call `toCharacterPromptInput` at the seam. No `id` / `storyId` / timestamp references inside `prompt.service.ts`.
- Repo-boundary review CLEAN at close-gate.

## bd

Will be filed when this design is approved and a plan is written.
