# Previous-Chapter Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-chapter AI-consumption-shaped summaries (events / stateAtEnd / openThreads), surfaced via a Cast-pattern popover triggered from a per-row icon on ChapterRow, and fed into the prompt builder as a `<previous_chapters>` block so AI actions in chapter N have continuity context from chapters 1..N-1.

**Architecture:** Encrypted JSON blob on `Chapter` (mirrors the existing `bodyJson` branch in `chapter.repo.ts` `update()` — wired through the same generic `update()` + `writeEncrypted` path, no parallel methods). Shared Zod schema in `chapter.ts`; Venice payload derives via `z.toJSONSchema(...)` — no hand-rolled mirror. Capability prechecked via Venice's `supportsResponseSchema` (a **new** pattern — first request-rejecting capability check; existing capability flags only enrich `venice_parameters`, never block). Repo extends the existing `update()` with a `summaryJson?: ChapterSummary | null` branch and adds an `{ includeSummary?: boolean }` overload to `findManyForStory` — no new repo methods. Prompt builder gets a `previousChapters` input and an oldest-first drop-summaries-when-budget-tight rule (current chapter always wins). Summarisation system prompt lives in `DEFAULT_PROMPTS.summariseChapter` (user-overridable via the existing `UserPromptKey` registry — not a standalone export). Frontend reuses Cast's `CharacterPopover` + `CharacterSheet` shapes — `FieldRow` and `computePosition` are extracted to shared spots and `CharacterPopover` migrates in the same change. New `SummaryStateIcon` on every `ChapterRow` doubles as state badge and popover trigger. Hook surface mirrors existing one-mutation-per-hook convention: `useSummariseChapterMutation` + `useUpdateChapterSummaryMutation` + pure exported `deriveSummaryState`. Per-story `includePreviousChaptersInPrompt` toggle on `StoryModal`.

**Tech Stack:** TypeScript strict mode · Zod 4.4.3 · Prisma · Express · `respond()` + `validateBody` envelope · Vitest (backend + frontend jsdom) · TanStack Query · TailwindCSS (token-only via `lint:design`) · Venice `response_format: { type: 'json_schema' }` via the existing `getVeniceClient(userId)` BYOK path · OpenAI SDK (chat.completions inline).

**Spec:** `docs/superpowers/specs/2026-05-18-previous-chapter-summaries-design.md`

**bd issue:** story-editor-v6x

**Build invariant:** Every commit leaves `make typecheck` and the affected workspace's tests green. Backend tests require `make dev` up first (vitest globalSetup hits Postgres).

---

## File Structure

**Create:**
- `backend/prisma/migrations/<timestamp>_chapter_summary_and_story_pcs_toggle/migration.sql` — add 4 cols on Chapter + 1 col on Story
- `backend/src/routes/chapters.summarise.test.ts` — POST integration tests (or extend an existing chapters route test file)
- `backend/tests/services/prompt.service.previous-chapters.test.ts` — block render + truncation tests
- `backend/tests/repos/chapter.repo.summary.test.ts` — repo round-trip + decrypt-failure tests
- `frontend/src/lib/popover-position.ts` — extracted `computePosition` helper
- `frontend/src/hooks/useChapterSummary.ts` — two single-purpose mutation hooks + pure `deriveSummaryState`
- `frontend/src/hooks/useChapterSummary.test.ts` — `deriveSummaryState` derivation tests (incl. Corrupted)
- `frontend/src/components/SummaryStateIcon.tsx` + `.test.tsx`
- `frontend/src/components/ChapterSummaryPopover.tsx` + `.test.tsx`
- `frontend/src/components/ChapterSummarySheet.tsx` + `.test.tsx`

**Modify:**
- `shared/src/schemas/chapter.ts` — add `chapterSummarySchema`, extend `chapterMetaSchema` + `chapterSchema`, add `'summaryJson'` to `CHAPTER_ENCRYPTED_FIELD_KEYS`
- `shared/tests/chapter.schema.test.ts` — assertions for the new schema + JSON-Schema roundtrip
- `shared/src/schemas/story.ts` — add `includePreviousChaptersInPrompt` to `storyCreateSchema`
- `backend/prisma/schema.prisma` — match the migration
- `backend/src/repos/chapter.repo.ts` — encryption wiring + `summaryJson` branch on `update()` + `includeSummary` overload on `findManyForStory`
- `backend/src/lib/serialize.ts` — extend `serializeChapter` (+`summary`, `summaryUpdatedAt`) and `serializeChapterMeta` (+`hasSummary`, `summaryIsStale`). **Build-critical:** both are explicit picks gated by `respond(chapterResponseSchema/chaptersResponseSchema)`; once Task 1 makes those fields required they must be added here or every chapter response 500s (dev/test) and `serializeChapter`'s return type fails typecheck. See the Task 1 ↔ Task 4 coupling note.
- `backend/src/services/venice.models.service.ts` — `supportsResponseSchema` in three places (`VeniceRawCapabilities`, `ModelInfo`, `mapModel`)
- `backend/src/services/prompt.service.ts` — `previousChapters` input, `<previous_chapters>` block, drop-oldest truncation, summarisation prompt template
- `backend/src/routes/chapters.routes.ts` — POST `/:id/summarise`, PUT `/:id/summary`
- `backend/src/routes/ai.routes.ts` — load prior summaries via `findManyForStory(storyId, { includeSummary: true })`, pass to `buildPrompt`
- `backend/src/routes/chat.routes.ts` — same load-and-pass change
- `backend/src/routes/stories.routes.ts` — `PATCH /stories/:id` accepts new toggle (via the updated `storyUpdateSchema`)
- `backend/tests/security/encryption-leak.test.ts` — bury the `[E12]` sentinel in `summaryJson` (existing disk-scan covers the new ciphertext column)
- `frontend/src/design/primitives.tsx` — add exported `FieldRow` primitive
- `frontend/src/components/CharacterPopover.tsx` — import extracted `FieldRow` + `computePosition`, drop inline copies
- `frontend/src/components/ChapterList.tsx` — render `<SummaryStateIcon>` on every `ChapterRow`; pass `onOpenSummary(chapterId, anchorEl)` up; hide icon while `InlineConfirm` is open
- `frontend/src/pages/EditorPage.tsx` — page-root mount `<ChapterSummaryPopover>` and `<ChapterSummarySheet>`; wire callbacks
- `frontend/src/components/StoryModal.tsx` + `.test.tsx` — toggle field
- `frontend/src/components/ChapterSummaryPopover.stories.tsx` — overwrite the existing design-mockup 1:1 with a real story file against the production component

**Touch only if needed:**
- `frontend/src/hooks/useChapters.ts` — if the chapter detail shape change breaks an existing call site

---

## Task 1: Shared Zod Schemas

**Files:**
- Modify: `shared/src/schemas/chapter.ts`
- Modify: `shared/tests/chapter.schema.test.ts`
- Modify: `shared/src/schemas/story.ts`
- Modify: `shared/tests/story.schema.test.ts`
- Modify: `shared/src/index.ts` (only if the new symbols aren't picked up by an existing wildcard re-export — verify with `grep`)

> **⚠️ Build-coupling with Task 4 (read before sequencing).** Making `hasSummary`/`summaryIsStale` required on `chapterMetaSchema` and `summary`/`summaryUpdatedAt` required on `chapterSchema` immediately breaks the backend: `serializeChapter`/`serializeChapterMeta` ([`serialize.ts:111-139`](backend/src/lib/serialize.ts#L111-L139)) are explicit picks that don't yet emit those fields, so (a) `serializeChapter`'s `Chapter` return type fails `npm --prefix backend run typecheck`, and (b) `respond(chapterResponseSchema, …)` `.parse()` 500s in dev/test. The serializer fix lives in Task 4 (it needs `RepoChapter.summary` etc., which Task 4 adds). So **Task 1 + Task 4 + the serialize.ts edit are one type-coupled unit**: sequence **Task 2 (prisma) and Task 3 (venice) BEFORE Task 1** (neither depends on the summary schema), then do Task 1 → Task 4 back-to-back. Backend `make typecheck` is transiently red between the Task 1 commit and the Task 4 commit — the next all-workspaces-green checkpoint is the end of Task 4, not Task 1. (Task 1's own verify is `npm --prefix shared run …`, which stays green.)

- [ ] **Step 0: Verify index re-exports for the new symbols**

Both schema test files already exist at `shared/tests/<entity>.schema.test.ts` — append the new assertions in Step 1, don't create new files. Confirm the index exports cover the new symbols:

```bash
grep -n "schemas/chapter\|schemas/story" shared/src/index.ts | head -5
```

If the index uses `export * from './schemas/chapter.js'`, the new `chapterSummarySchema`, `chapterSummaryJsonSchema`, `chapterSummaryResponseSchema`, `CHAPTER_SUMMARY_FIELD_MAX`, and `ChapterSummary` are picked up automatically — no edit needed in Step 5. If the index uses explicit named re-exports, add the five new names there (`chapterSummaryJsonSchema` + `chapterSummaryResponseSchema` are imported by the backend summarise route in Task 7).

- [ ] **Step 1: Write failing tests in `shared/tests/chapter.schema.test.ts`**

```ts
// Append to the existing describe blocks in shared/tests/chapter.schema.test.ts.
// Do not delete existing assertions.
import { z } from 'zod';
import {
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_SUMMARY_FIELD_MAX,
  chapterMetaSchema,
  chapterSchema,
  chapterSummaryJsonSchema,
  chapterSummarySchema,
} from '../src/schemas/chapter';

const VALID_SUMMARY = {
  events: 'A then B.',
  stateAtEnd: 'They are in C.',
  openThreads: 'Why D?',
};

describe('chapterSummarySchema', () => {
  it('accepts a valid summary', () => {
    expect(chapterSummarySchema.parse(VALID_SUMMARY)).toEqual(VALID_SUMMARY);
  });
  it('is strict — rejects unknown keys', () => {
    expect(() =>
      chapterSummarySchema.parse({ ...VALID_SUMMARY, foo: 'bar' }),
    ).toThrow();
  });
  it('enforces per-field max length', () => {
    const tooLong = 'x'.repeat(CHAPTER_SUMMARY_FIELD_MAX + 1);
    expect(() =>
      chapterSummarySchema.parse({ ...VALID_SUMMARY, events: tooLong }),
    ).toThrow();
  });
  it('chapterSummaryJsonSchema produces the minimal OpenAI-safe wire shape', () => {
    const json = chapterSummaryJsonSchema();
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['events', 'stateAtEnd', 'openThreads']);
    // Descriptions survive (they steer the model)…
    const props = json.properties as Record<string, { description?: string; maxLength?: number }>;
    expect(typeof props.events?.description).toBe('string');
    expect(typeof props.stateAtEnd?.description).toBe('string');
    expect(typeof props.openThreads?.description).toBe('string');
    // …but the unsupported keywords are stripped.
    expect('$schema' in json).toBe(false);
    expect(props.events?.maxLength).toBeUndefined();
    expect(props.stateAtEnd?.maxLength).toBeUndefined();
    expect(props.openThreads?.maxLength).toBeUndefined();
  });
});

describe('chapterMetaSchema (summary flags)', () => {
  it('accepts hasSummary + summaryIsStale', () => {
    expect(() =>
      chapterMetaSchema.parse({
        id: 'c1', storyId: 's1', title: 't', wordCount: 0, orderIndex: 0, status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z',
        hasSummary: true, summaryIsStale: false,
      }),
    ).not.toThrow();
  });
  it('requires both summary flags', () => {
    expect(() =>
      chapterMetaSchema.parse({
        id: 'c1', storyId: 's1', title: 't', wordCount: 0, orderIndex: 0, status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('chapterSchema (summary + summaryUpdatedAt)', () => {
  it('accepts summary + summaryUpdatedAt nullable', () => {
    expect(() =>
      chapterSchema.parse({
        id: 'c1', storyId: 's1', title: 't', wordCount: 0, orderIndex: 0, status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z',
        hasSummary: false, summaryIsStale: false, bodyJson: null,
        summary: null, summaryUpdatedAt: null,
      }),
    ).not.toThrow();
  });
});

it('CHAPTER_ENCRYPTED_FIELD_KEYS includes summaryJson', () => {
  expect(CHAPTER_ENCRYPTED_FIELD_KEYS).toContain('summaryJson');
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
npm --prefix shared run test -- chapter.schema.test.ts
```
Expected: failures for `chapterSummarySchema`, `CHAPTER_SUMMARY_FIELD_MAX`, summary flags, encrypted-keys list.

- [ ] **Step 3: Update `shared/src/schemas/chapter.ts`**

```ts
// Add after CHAPTER_TITLE_MAX:
// Generous per-field upper bound — a soft abuse guard on the PUT /summary
// path, NOT a terseness mechanism (the system prompt enforces brevity). 8000
// chars ≈ 1200 words leaves ample headroom; adjust if it ever feels tight.
export const CHAPTER_SUMMARY_FIELD_MAX = 8000;

export const chapterSummarySchema = z.strictObject({
  events: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Plot events: 1–3 sentences. What happened in this chapter.'),
  stateAtEnd: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Location, possessions, who is with whom at chapter close.'),
  openThreads: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Unresolved questions, planted seeds, dangling tension.'),
});

export type ChapterSummary = z.infer<typeof chapterSummarySchema>;

// Egress shape for POST /:id/summarise and PUT /:id/summary. Mirrors the
// existing chapterResponseSchema / chaptersResponseSchema convention so both
// routes validate through respond() like the rest of chapters.routes.ts (the
// summarise route is a plain JSON response, not an SSE stream). `summary` is
// always present on these success paths; `summaryUpdatedAt` stays nullable to
// match the route's defensive `?? null`.
export const chapterSummaryResponseSchema = z.strictObject({
  summary: chapterSummarySchema,
  summaryUpdatedAt: z.string().datetime().nullable(),
});

/**
 * JSON Schema for the Venice `response_format: { type: 'json_schema' }` wire
 * payload. Decoupled from the runtime schema on purpose: the `.max()` caps are
 * for `.parse()` validation, but `z.toJSONSchema` emits them as `maxLength`,
 * and whether Venice/OpenAI's structured-output subset accepts `maxLength`
 * (or a `$schema` root key) is undocumented. Strip both so the wire schema
 * stays within the safe minimal subset (object + additionalProperties:false +
 * all-required + descriptions). API-version-independent post-processing — no
 * dependency on the toJSONSchema `override` callback shape. Verify acceptance
 * once on the opt-in `test:live` path before trusting the round-trip.
 */
export function chapterSummaryJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(chapterSummarySchema) as Record<string, unknown>;
  delete json.$schema;
  const props = json.properties as Record<string, Record<string, unknown>> | undefined;
  if (props) {
    for (const key of Object.keys(props)) {
      delete props[key].maxLength;
      delete props[key].minLength;
    }
  }
  return json;
}
```

Extend the existing `chapterMetaSchema` (do **not** rewrite from scratch — extension preserves any fields the plan author may not have listed):

```ts
// Was: export const chapterMetaSchema = z.strictObject({ ... });
// Becomes:
const chapterMetaBase = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  status: chapterStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const chapterMetaSchema = chapterMetaBase.extend({
  hasSummary: z.boolean(),
  summaryIsStale: z.boolean(),
});
```

Verify the existing field list against this base before applying — if there are fields in the current `chapterMetaSchema` not represented here (the plan author worked from a snapshot, the schema may have moved on), add them to `chapterMetaBase` first.

Modify `chapterSchema` similarly via `.extend()`:

```ts
export const chapterSchema = chapterMetaSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});
```

Append `'summaryJson'` to the encrypted-field tuple:

```ts
export const CHAPTER_ENCRYPTED_FIELD_KEYS = ['title', 'body', 'summaryJson'] as const;
```

- [ ] **Step 4: Update `shared/src/schemas/story.ts`**

Add to `storyCreateSchema`:

```ts
includePreviousChaptersInPrompt: z.boolean().optional(),
```

(`storyUpdateSchema = storyCreateSchema.partial()` picks it up automatically.)

- [ ] **Step 5: Re-export — verify `shared/src/index.ts`**

```bash
grep -n "chapterSummarySchema\|chapterSummaryJsonSchema\|chapterSummaryResponseSchema\|CHAPTER_SUMMARY_FIELD_MAX" shared/src/index.ts || echo "NEEDS EXPORT"
```

If "NEEDS EXPORT" appears, add to `shared/src/index.ts` re-exports.

- [ ] **Step 6: Run tests — expect pass**

```bash
npm --prefix shared run test
npm --prefix shared run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add shared/
git commit -m "[pcs] shared: chapter summary schema + story toggle"
```

---

## Task 2: Prisma Migration + Schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_pcs_chapter_summary_story_toggle/migration.sql`

- [ ] **Step 1: Update `backend/prisma/schema.prisma`**

In `model Chapter { ... }`, after the existing body triple:

```prisma
  summaryJsonCiphertext String?
  summaryJsonIv         String?
  summaryJsonAuthTag    String?
  summaryJsonUpdatedAt  DateTime?
```

In `model Story { ... }`, after the existing narrative triples:

```prisma
  includePreviousChaptersInPrompt Boolean @default(true)
```

- [ ] **Step 2: Generate the migration**

```bash
make dev   # stack must be up
docker compose exec -T backend npx prisma migrate dev \
  --name pcs_chapter_summary_story_toggle --create-only
```

This emits a new SQL file under `backend/prisma/migrations/<timestamp>_.../migration.sql`. Inspect it:

```bash
ls backend/prisma/migrations/ | tail -1
```

- [ ] **Step 3: Verify the migration SQL**

Open the generated file. Expect:

```sql
ALTER TABLE "Chapter" ADD COLUMN "summaryJsonCiphertext" TEXT;
ALTER TABLE "Chapter" ADD COLUMN "summaryJsonIv" TEXT;
ALTER TABLE "Chapter" ADD COLUMN "summaryJsonAuthTag" TEXT;
ALTER TABLE "Chapter" ADD COLUMN "summaryJsonUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Story" ADD COLUMN "includePreviousChaptersInPrompt" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 4: Apply and regenerate client**

```bash
docker compose exec -T backend npx prisma migrate deploy
docker compose exec -T backend npx prisma generate
```

- [ ] **Step 5: Typecheck**

```bash
npm --prefix backend run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/
git commit -m "[pcs] prisma: chapter summary columns + story includePreviousChaptersInPrompt"
```

---

## Task 3: Venice Models — `supportsResponseSchema`

**Files:**
- Modify: `backend/src/services/venice.models.service.ts`
- Modify: `backend/tests/services/venice.models.service.test.ts` (or wherever this is tested today)

- [ ] **Step 1: Write failing test**

In the existing models-service test file, add:

```ts
it('maps supportsResponseSchema from capabilities', () => {
  const raw = {
    id: 'm1',
    type: 'text',
    model_spec: {
      capabilities: { supportsResponseSchema: true },
      availableContextTokens: 32768,
      maxCompletionTokens: 4096,
    },
  };
  const mapped = mapModel(raw);
  expect(mapped.supportsResponseSchema).toBe(true);
});

it('defaults supportsResponseSchema to false when omitted', () => {
  const raw = { id: 'm2', type: 'text', model_spec: { capabilities: {} } };
  expect(mapModel(raw).supportsResponseSchema).toBe(false);
});
```

```bash
make dev
npm --prefix backend run test -- venice.models.service.test.ts
```
Expected: fail (property missing).

- [ ] **Step 2: Add the field in three places in `backend/src/services/venice.models.service.ts`**

```ts
// 1. VeniceRawCapabilities
interface VeniceRawCapabilities {
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsWebSearch?: boolean;
  supportsResponseSchema?: boolean;
}

// 2. ModelInfo
export interface ModelInfo {
  // ... existing fields ...
  supportsResponseSchema: boolean;
}

// 3. mapModel — alongside existing supports* mappings
supportsResponseSchema: Boolean(caps.supportsResponseSchema),
```

- [ ] **Step 3: Test pass + typecheck**

```bash
npm --prefix backend run test -- venice.models.service.test.ts
npm --prefix backend run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/venice.models.service.ts backend/tests/services/venice.models.service.test.ts
git commit -m "[pcs] venice.models: surface supportsResponseSchema capability"
```

---

## Task 4: Chapter Repo — Summary Round-trip

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts`
- Create: `backend/tests/repos/chapter.repo.summary.test.ts`

- [ ] **Step 1: Write failing repo tests**

Use the existing `makeUserContext` helper from `backend/tests/repos/_req.ts` — it builds a real `User` row with DEK wraps and returns a `Request` with the DEK attached, exactly what `createChapterRepo` needs. Create the story directly via `prisma.story.create` (also the convention in other repo tests under `backend/tests/repos/`).

```ts
// backend/tests/repos/chapter.repo.summary.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { prisma } from '../setup';
import { makeUserContext } from './_req';

describe('chapter.repo summary', () => {
  let ctx: Awaited<ReturnType<typeof makeUserContext>>;
  let storyId: string;
  let chapterId: string;

  beforeEach(async () => {
    ctx = await makeUserContext();
    const story = await prisma.story.create({
      data: { userId: ctx.user.id },
    });
    storyId = story.id;
    const chapter = await createChapterRepo(ctx.req).create({
      storyId, title: 'Ch 1', orderIndex: 0, wordCount: 10,
    });
    chapterId = chapter.id;
  });

  it('update({ summaryJson }) persists encrypted blob + timestamp; findById round-trips', async () => {
    const repo = createChapterRepo(ctx.req);
    const summary = { events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' };
    const updated = await repo.update(chapterId, { summaryJson: summary });
    expect(updated?.summary).toEqual(summary);
    expect(updated?.summaryUpdatedAt).toBeInstanceOf(Date);

    const fetched = await repo.findById(chapterId);
    expect(fetched?.summary).toEqual(summary);
  });

  it('findById returns summary: null when columns are null', async () => {
    const fetched = await createChapterRepo(ctx.req).findById(chapterId);
    expect(fetched?.summary).toBeNull();
    expect(fetched?.summaryUpdatedAt).toBeNull();
  });

  it('findManyForStory surfaces hasSummary + summaryIsStale without decrypting body', async () => {
    const repo = createChapterRepo(ctx.req);
    let list = await repo.findManyForStory(storyId);
    expect(list[0]!.hasSummary).toBe(false);
    expect(list[0]!.summaryIsStale).toBe(false);

    await repo.update(chapterId, { summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } });
    list = await repo.findManyForStory(storyId);
    expect(list[0]!.hasSummary).toBe(true);
    expect(list[0]!.summaryIsStale).toBe(false);
  });

  it('summaryIsStale becomes true after the chapter is updated', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, { summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } });
    // Force a chapter update with a later updatedAt
    await new Promise((r) => setTimeout(r, 10));
    await repo.update(chapterId, { title: 'Ch 1 renamed' });
    const list = await repo.findManyForStory(storyId);
    expect(list[0]!.summaryIsStale).toBe(true);
  });

  it('update({ summaryJson: null }) clears all four summary columns', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, { summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } });
    const cleared = await repo.update(chapterId, { summaryJson: null });
    expect(cleared?.summary).toBeNull();
    expect(cleared?.summaryUpdatedAt).toBeNull();
  });

  it('findManyForStory({ includeSummary: true }) decrypts title + summary, skips body', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, { summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' } });
    const rows = await repo.findManyForStory(storyId, { includeSummary: true });
    expect(rows[0]).toMatchObject({
      id: chapterId,
      title: 'Ch 1',
      orderIndex: 0,
      summary: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    // `bodyJson` is never selected on the list path
    expect((rows[0] as unknown as { bodyJson?: unknown }).bodyJson).toBeUndefined();
  });
});
```

```bash
make dev
npm --prefix backend run test -- chapter.repo.summary
```
Expected: fail (methods missing).

- [ ] **Step 2: Implement in `chapter.repo.ts`**

Add to the `RepoChapter` type:

```ts
export type RepoChapter = {
  // ... existing ...
  summary: import('story-editor-shared').ChapterSummary | null;
  summaryUpdatedAt: Date | null;
};
```

Update `RepoChapterMeta` to exclude the new summary fields and add the two derived booleans:

```ts
// Was: Omit<RepoChapter, 'bodyJson'>
export type RepoChapterMeta = Omit<RepoChapter, 'bodyJson' | 'summary' | 'summaryUpdatedAt'> & {
  hasSummary: boolean;
  summaryIsStale: boolean;
};
```

(The Omit chain expands because `RepoChapter` now carries `summary` + `summaryUpdatedAt`. List responses don't decrypt those, so they're excluded; the two derived booleans replace them.)

**Extend `RepoChapterUpdateInput`** — adds one optional field, no parallel methods needed:

```ts
export interface RepoChapterUpdateInput {
  title?: string;
  bodyJson?: unknown;
  status?: string;
  orderIndex?: number;
  wordCount?: number;
  /** Set to a `ChapterSummary` to (re)write; set to `null` to clear all four columns; omit to leave alone.
   *  Mirrors the existing `bodyJson?: unknown` undefined/null/value pattern. */
  summaryJson?: import('story-editor-shared').ChapterSummary | null;
}
```

**Modify `shape()`** to surface `summary` + `summaryUpdatedAt`. Add to the encrypted-key list (already done via `CHAPTER_ENCRYPTED_FIELD_KEYS = ['title', 'body', 'summaryJson']` in Task 1 — the `projectDecrypted` call automatically handles the new key):

```ts
// In shape(), after projectDecrypted(...) — alongside the existing
// `bodyJson` reparenting:
let summary: ChapterSummary | null = null;
if (typeof projected.summaryJson === 'string' && projected.summaryJson.length > 0) {
  try {
    summary = chapterSummarySchema.parse(JSON.parse(projected.summaryJson));
  } catch {
    // Log ONLY the chapter id + a static code — never the error object. A
    // ZodError / SyntaxError on a decryptable-but-invalid blob can embed the
    // decrypted field values, and decrypted narrative content must never reach
    // logs (CLAUDE.md, absolute rule; repo-boundary-reviewer enforces this).
    console.warn(`[chapter.repo] summary_parse_failed chapter=${projected.id}`);
    summary = null;
  }
}
delete projected.summaryJson;
projected.summary = summary;
projected.summaryUpdatedAt = (row as { summaryJsonUpdatedAt: Date | null }).summaryJsonUpdatedAt;
```

**Modify `shapeMeta()`** to emit `hasSummary` + `summaryIsStale`. The `findManyForStory` `select` clause gains `summaryJsonCiphertext: true` (for the non-null check — do **not** decrypt) and `summaryJsonUpdatedAt: true`:

```ts
function shapeMeta(row: unknown, req: Request): RepoChapterMeta {
  const projected = projectDecrypted<Omit<RepoChapterMeta, 'hasSummary' | 'summaryIsStale'>>(
    req,
    row as Record<string, unknown>,
    CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  );
  const r = row as { summaryJsonCiphertext: string | null; summaryJsonUpdatedAt: Date | null; updatedAt: Date };
  const hasSummary = r.summaryJsonCiphertext != null;
  const summaryIsStale = hasSummary && r.summaryJsonUpdatedAt != null && r.summaryJsonUpdatedAt < r.updatedAt;
  return { ...projected, hasSummary, summaryIsStale } as RepoChapterMeta;
}
```

**Extend the existing `update()` method** with one new branch (no parallel `updateSummary` / `clearSummary` methods — copy the sibling `bodyJson` branch already in this file's `update()` at [`chapter.repo.ts:161-167`](backend/src/repos/chapter.repo.ts#L161-L167), which does `input.bodyJson === null ? null : JSON.stringify(...)` → `writeEncrypted`. That is the exact undefined/null/value shape `summaryJson` needs.

> Precedent note: `message.repo.ts` is **not** the model here — `Message` is append-only and has no `update()`; its `attachmentJson` / `citationsJson` serialisation lives in `create()` via the `serialiseJsonField` helper. The right sibling pattern is the in-file `bodyJson` branch above.):

```ts
// Inside update(), after the existing wordCount branch:
if (input.summaryJson !== undefined) {
  // null → clear (writeEncrypted serialises null as all-null triple)
  // value → encrypt the JSON-stringified summary
  const plaintext = input.summaryJson === null ? null : JSON.stringify(input.summaryJson);
  Object.assign(data, writeEncrypted(req, 'summaryJson', plaintext));
  data.summaryJsonUpdatedAt = input.summaryJson === null ? null : new Date();
}
```

**Add a `{ includeSummary }` option to `findManyForStory`** via a TS overload. When the flag is on, decrypt the summary column too; when off (default), behave exactly as today. The return type narrows per the overload signature.

```ts
// Type signatures (place above the function body):
function findManyForStory(storyId: string): Promise<RepoChapterMeta[]>;
function findManyForStory(
  storyId: string,
  opts: { includeSummary: true },
): Promise<Array<RepoChapterMeta & { summary: ChapterSummary | null; summaryUpdatedAt: Date | null }>>;

// Single implementation:
async function findManyForStory(
  storyId: string,
  opts?: { includeSummary?: boolean },
) {
  const userId = resolveUserId(req);
  await ensureStoryOwned(client, storyId, userId);
  const include = opts?.includeSummary === true;
  const rows = await client.chapter.findMany({
    where: { storyId, story: { userId } },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      storyId: true,
      orderIndex: true,
      status: true,
      wordCount: true,
      createdAt: true,
      updatedAt: true,
      titleCiphertext: true,
      titleIv: true,
      titleAuthTag: true,
      // Always selected — needed for hasSummary + summaryIsStale on the meta path.
      summaryJsonCiphertext: true,
      summaryJsonUpdatedAt: true,
      // Only selected when the caller asked to decrypt the summary too.
      ...(include
        ? { summaryJsonIv: true, summaryJsonAuthTag: true }
        : {}),
    },
  });
  if (!include) return rows.map((r) => shapeMeta(r, req));

  // include === true: re-decrypt summary alongside the meta projection.
  return rows.map((r) => {
    const meta = shapeMeta(r, req);
    const decrypted = projectDecrypted<{ summaryJson?: string }>(
      req,
      r as unknown as Record<string, unknown>,
      ['summaryJson'] as const,
    );
    let summary: ChapterSummary | null = null;
    if (typeof decrypted.summaryJson === 'string' && decrypted.summaryJson.length > 0) {
      try { summary = chapterSummarySchema.parse(JSON.parse(decrypted.summaryJson)); }
      catch { summary = null; }
    }
    return { ...meta, summary, summaryUpdatedAt: r.summaryJsonUpdatedAt };
  });
}
```

No new exports — the public surface stays at the existing `update` + `findManyForStory`. The repo's return object is unchanged.

- [ ] **Step 2b: Update the chapter serializers (`backend/src/lib/serialize.ts`)**

`serializeChapter`/`serializeChapterMeta` are explicit picks (deliberately — they force the compiler to surface any new repo field). Now that `RepoChapter`/`RepoChapterMeta` carry the summary fields (Step 2) and the shared `Chapter`/`ChapterMeta` types require them (Task 1), add the picks. Without this, `serializeChapter` fails to typecheck against `Chapter` and `respond()` 500s in dev/test:

```ts
// serializeChapter — append to the returned object:
  summary: row.summary,
  summaryUpdatedAt: row.summaryUpdatedAt ? row.summaryUpdatedAt.toISOString() : null,

// serializeChapterMeta — append to the returned object:
  hasSummary: row.hasSummary,
  summaryIsStale: row.summaryIsStale,
```

(`summaryUpdatedAt` serialises to the `z.string().datetime().nullable()` wire shape from Task 1; `summary` is the `ChapterSummary | null` the schema already accepts.)

- [ ] **Step 3: Run tests — expect pass**

```bash
npm --prefix backend run test -- chapter.repo.summary
npm --prefix backend run typecheck   # first all-workspaces-green checkpoint since Task 1
```

Also run the existing chapter-route tests to confirm the `respond()` egress gate passes with the new required fields:

```bash
npm --prefix backend run test -- chapters
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/repos/chapter.repo.ts backend/src/lib/serialize.ts backend/tests/repos/chapter.repo.summary.test.ts
git commit -m "[pcs] chapter.repo: summaryJson branch + includeSummary; serializers emit summary fields"
```

---

## Task 5: Prompt Builder — `<previous_chapters>` Block

**Files:**
- Modify: `backend/src/services/prompt.service.ts`
- Create: `backend/tests/services/prompt.service.previous-chapters.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// backend/tests/services/prompt.service.previous-chapters.test.ts
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/services/prompt.service';

const base = {
  action: 'continue' as const,
  selectedText: '',
  chapterContent: 'Current chapter prose.',
  characters: [],
  worldNotes: null,
  modelContextLength: 8000,
  modelMaxCompletionTokens: 1000,
  userMaxCompletionTokens: Number.POSITIVE_INFINITY,
};

const SUMMARY = (n: number) => ({
  events: `events-${n}`, stateAtEnd: `state-${n}`, openThreads: `threads-${n}`,
});

describe('prompt.service previousChapters', () => {
  it('omits the block when previousChapters is empty/undefined', () => {
    const out = buildPrompt(base);
    expect(out.messages[0]!.content).not.toContain('<previous_chapters>');
  });

  it('renders entries between <characters> and <chapter_so_far>', () => {
    const out = buildPrompt({
      ...base,
      previousChapters: [
        { orderIndex: 0, title: 'Crossing', summary: SUMMARY(1) },
      ],
    });
    const sys = out.messages[0]!.content;
    expect(sys).toContain('<previous_chapters>');
    expect(sys).toContain('<chapter index="1" title="Crossing">');
    expect(sys).toContain('<events>events-1</events>');
    expect(sys).toContain('<state_at_end>state-1</state_at_end>');
    expect(sys).toContain('<open_threads>threads-1</open_threads>');
    expect(sys.indexOf('<previous_chapters>')).toBeLessThan(sys.indexOf('<chapter_so_far>'));
  });

  it('XML-escapes &/</> in fields', () => {
    const out = buildPrompt({
      ...base,
      previousChapters: [
        { orderIndex: 0, title: 'A & B', summary: { events: '<x>', stateAtEnd: '&', openThreads: '>y' } },
      ],
    });
    const sys = out.messages[0]!.content;
    expect(sys).toContain('title="A &amp; B"');
    expect(sys).toContain('&lt;x&gt;');
    expect(sys).toContain('&amp;');
    expect(sys).toContain('&gt;y');
  });

  it('drops oldest first when summaries push chapter below budget', () => {
    // Pick a tiny model context so summaries crowd the chapter
    const tiny = { ...base, modelContextLength: 600 };
    const five = [0, 1, 2, 3, 4].map((i) => ({
      orderIndex: i, title: `t${i}`, summary: {
        events: 'x'.repeat(400), stateAtEnd: 'y'.repeat(400), openThreads: 'z'.repeat(400),
      },
    }));
    const out = buildPrompt({ ...tiny, previousChapters: five });
    const sys = out.messages[0]!.content;
    // Two valid outcomes under budget pressure:
    //  - some survive → block present, truncated_count>0, oldest dropped first
    //  - all dropped  → block omitted ENTIRELY (no empty element)
    if (sys.includes('<previous_chapters')) {
      expect(sys).toMatch(/<previous_chapters truncated_count="[1-9]\d*">/);
      expect(sys).toContain('<chapter index="5"');     // highest-index survives
      expect(sys).not.toContain('<chapter index="1"'); // oldest dropped
    } else {
      expect(sys).not.toContain('truncated_count');
    }
  });
});
```

```bash
make dev
npm --prefix backend run test -- prompt.service.previous-chapters
```
Expected: fail.

- [ ] **Step 2: Implement in `prompt.service.ts`**

Add to `BuildPromptInput`:

```ts
previousChapters?: Array<{
  orderIndex: number;
  title: string;
  summary: import('story-editor-shared').ChapterSummary;
}>;
```

In `buildPrompt`, after `charactersBlock` is built and before computing `fixedTokens`:

```ts
function renderChapterEntry(c: NonNullable<BuildPromptInput['previousChapters']>[number]): string {
  const idx = c.orderIndex + 1;
  const title = escapeXmlAttr(c.title);
  return [
    `<chapter index="${idx}" title="${title}">`,
    `  <events>${escapeXmlText(c.summary.events)}</events>`,
    `  <state_at_end>${escapeXmlText(c.summary.stateAtEnd)}</state_at_end>`,
    `  <open_threads>${escapeXmlText(c.summary.openThreads)}</open_threads>`,
    `</chapter>`,
  ].join('\n');
}

let entries = (input.previousChapters ?? []).slice();
let truncatedCount = 0;

function renderPreviousChaptersBlock(): string {
  // Omit the block entirely when nothing survives — even if budget pressure
  // truncated everything away (spec: no empty <previous_chapters> element).
  if (entries.length === 0) return '';
  const inner = entries.map(renderChapterEntry).join('\n');
  const opener = truncatedCount > 0
    ? `<previous_chapters truncated_count="${truncatedCount}">`
    : `<previous_chapters>`;
  return `${opener}\n${inner}\n</previous_chapters>`;
}
```

Insert the block into `systemParts` between `charactersBlock` and `chapterBlock`. **Reuse the existing precomputed `fixedTokens`** ([`prompt.service.ts:244-251`](backend/src/services/prompt.service.ts#L244-L251)) rather than re-deriving the whole `systemContent + worldNotesBlock + charactersBlock + taskBlock + userPayload` chain — fold the previous-chapters term into it so the accounting stays single-sourced and won't drift if `fixedTokens` composition changes. On each drop, recompute only the `previousChaptersBlock` term:

```ts
// `fixedTokens` already sums systemContent + worldNotesBlock + charactersBlock
//  + taskBlock + userPayload (existing code at lines 244-251). Add the new
//  previous-chapters term on top of it.
let previousChaptersBlock = renderPreviousChaptersBlock();
let chapterBudgetTokens =
  promptBudgetTokens - fixedTokens - estimateTokens(previousChaptersBlock);

while (chapterBudgetTokens <= 0 && entries.length > 0) {
  entries.shift();
  truncatedCount++;
  previousChaptersBlock = renderPreviousChaptersBlock();
  chapterBudgetTokens =
    promptBudgetTokens - fixedTokens - estimateTokens(previousChaptersBlock);
}
```

This replaces the existing `const chapterBudgetTokens = promptBudgetTokens - fixedTokens;` line (251) — make it `let` and seed it with the `- estimateTokens(previousChaptersBlock)` term as above. Then proceed with the existing chapter tail-truncation logic using the (possibly negative) `chapterBudgetTokens`. Insert `previousChaptersBlock` between `charactersBlock` and `chapterBlock` in `systemParts`.

- [ ] **Step 3: Add `summariseChapter` to the existing `UserPromptKey` + `DEFAULT_PROMPTS` registry**

The codebase already has a registry of user-overridable prompt templates at [`prompt.service.ts:75-99`](backend/src/services/prompt.service.ts#L75-L99). Adding our new system prompt there (instead of as a standalone `export const SUMMARISE_CHAPTER_SYSTEM_PROMPT`) gives users the same override knob they have for every other prompt and keeps the prompts-tab UI auto-discoverable.

Extend `UserPromptKey` and `DEFAULT_PROMPTS`:

```ts
export type UserPromptKey =
  | 'system'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'summarise'
  | 'describe'
  | 'scene'
  | 'ask'
  | 'summariseChapter';   // <-- new

export const DEFAULT_PROMPTS = {
  // ... existing entries ...
  summariseChapter:
    'You produce structured per-chapter summaries for a long-form fiction project. ' +
    'Read the chapter and emit a JSON object matching the provided schema exactly. ' +
    'Be terse and concrete; the consumer is another LLM that will use your output as context when writing the next chapter.',
} as const satisfies Record<UserPromptKey, string>;
```

The summarise route (Task 7) reads this via the existing `resolvePrompt(userPrompts, 'summariseChapter')` helper instead of importing a standalone const. The user-settings prompts tab on the frontend auto-picks up the new key — no UI work required for this addition.

Note: `'summarise'` (the selection-bubble summarise-action task template) already exists and is distinct from `'summariseChapter'` (system prompt for whole-chapter summarisation). Don't collapse them.

- [ ] **Step 4: Tests pass + typecheck**

```bash
npm --prefix backend run test -- prompt.service
npm --prefix backend run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.previous-chapters.test.ts
git commit -m "[pcs] prompt.service: <previous_chapters> block + drop-oldest truncation + summarise template"
```

---

## Task 6: Extract Shared Venice-Fetch Test Helpers

**Files:**
- Modify: `backend/tests/routes/_chat-test-helpers.ts` — export `jsonResponse`, `stubVeniceFetch`, `storeKey`, `MODEL_LIST_BODY`
- Modify: `backend/tests/routes/chat.test.ts` — import the now-shared helpers; delete the inline copies

These four helpers are currently defined inline in [`chat.test.ts:194-244`](backend/tests/routes/chat.test.ts#L194-L244). The new `chapters.summarise.test.ts` (Task 7) needs them too, so two test files would duplicate identical code. Move them to the existing `_chat-test-helpers.ts` (the file name is already a bit fuzzy — it houses `registerAndLogin` which isn't chat-specific — but renaming is out of scope for this plan).

- [ ] **Step 1: Move helpers**

Open [`backend/tests/routes/chat.test.ts`](backend/tests/routes/chat.test.ts) and copy these four definitions verbatim out of it into [`backend/tests/routes/_chat-test-helpers.ts`](backend/tests/routes/_chat-test-helpers.ts), prefixing each top-level declaration with `export`:

- `MODEL_ID` constant (line ~175 — `'venice-test-model'`)
- `MODEL_LIST_BODY` constant (line ~177 — see note below about adding a capability flag)
- `jsonResponse(status, body)` function (line ~194)
- `stubVeniceFetch()` function (line ~221)
- `storeKey(agent, fetchSpy)` function (line ~228)
- `queueSseResponse(fetchSpy, content)` function (line ~242) — used by ai-routes tests too in Task 9

When moving `storeKey`, keep its `agent` parameter typed as `ReturnType<typeof request.agent>` (or whatever the chat.test.ts version uses); add `import request from 'supertest'` to the helpers file if needed.

**Augment `MODEL_LIST_BODY.data[0].model_spec.capabilities`** to include `supportsResponseSchema: true` alongside the existing flags — the new summarise route prechecks it. Adding the flag is invisible to the existing chat tests (they don't read it).

- [ ] **Step 2: Update `chat.test.ts` imports**

Delete the four inline definitions in `chat.test.ts`. Update the existing helpers import line:

```ts
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  queueSseResponse,
  registerAndLogin,
  resetAll,
  storeKey,
  stubVeniceFetch,
} from './_chat-test-helpers';
```

- [ ] **Step 3: Tests pass + commit**

```bash
make dev
npm --prefix backend run test -- chat.test.ts
npm --prefix backend run typecheck
git add backend/tests/routes/_chat-test-helpers.ts backend/tests/routes/chat.test.ts
git commit -m "[pcs] tests: extract Venice-fetch helpers to _chat-test-helpers"
```

---

## Task 7: POST `/api/chapters/:id/summarise`

**Files:**
- Modify: `backend/src/lib/venice-errors.ts` (extend `VeniceErrorContext.route` union)
- Modify: `backend/src/routes/chapters.routes.ts`
- Create: `backend/tests/routes/chapters.summarise.test.ts`

- [ ] **Step 1: Extend `VeniceErrorContext.route` to include `'chapter-summarise'`**

The route union at `backend/src/lib/venice-errors.ts:158` is `'ai-models' | 'ai-complete' | 'chat'`. **Add only the new union member** — do not retype the rest of the interface. In particular, `userId` is `string | undefined` (line 157), not `string`; rewriting the whole block as `userId: string` would narrow the type and break every existing call site that passes `undefined`. The single change is:

```ts
// In backend/src/lib/venice-errors.ts — edit the `route` union ONLY.
// Leave `userId: string | undefined` exactly as-is.
export interface VeniceErrorContext {
  userId: string | undefined;
  route: 'ai-models' | 'ai-complete' | 'chat' | 'chapter-summarise';
}
```

Verify nothing else switches on the literal set (`grep -n "route ===" backend/src/lib/venice-errors.ts`) — verified at plan time there is **no** exhaustive switch on `route`, so the union edit is sufficient; if a future switch is added, add a case branch.

```bash
npm --prefix backend run typecheck
```

- [ ] **Step 2: Write failing integration tests**

Use the shared helpers from Task 6 (`registerAndLogin`, `makeFakeReq`, `resetAll`, `jsonResponse`, `stubVeniceFetch`, `storeKey`, `MODEL_LIST_BODY`). Only define what's genuinely test-file-specific: the `setup()` factory (story + chapter + agent) and a one-off `MODEL_LIST_BODY_NO_SCHEMA` variant. The `vi.stubGlobal('fetch', fetchSpy)` pattern intercepts the OpenAI SDK's underlying `fetch` calls — preferable to mocking `getVeniceClient`.

```ts
// backend/tests/routes/chapters.summarise.test.ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  registerAndLogin,
  resetAll,
  storeKey,
  stubVeniceFetch,
} from './_chat-test-helpers';

// Returns { agent, chapterId, accessToken } — same shape as chat.test.ts setup().
async function setup(username: string, body: string | null = 'A sentence of prose.') {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);
  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id,
    title: 'Ch',
    bodyJson: body == null
      ? null
      : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] },
    orderIndex: 0,
    wordCount: body ? body.split(/\s+/).length : 0,
  });
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);
  return { agent, chapterId: chapter.id as string, accessToken };
}

// One-off variant for the supportsResponseSchema=false case. If a second
// summarise-test file ever needs this, promote to _chat-test-helpers.ts.
const MODEL_LIST_BODY_NO_SCHEMA = {
  data: [
    {
      id: MODEL_ID,
      type: 'text',
      model_spec: {
        availableContextTokens: 8000,
        maxCompletionTokens: 1000,
        capabilities: { supportsResponseSchema: false },
      },
    },
  ],
};

describe('POST /api/chapters/:id/summarise', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });
  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  it('400 empty_chapter when chapter has zero words', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId } = await setup('summarise-empty', null);
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    const res = await agent
      .post(`/api/chapters/${chapterId}/summarise`)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('empty_chapter');
  });

  it('400 model_unsupported_for_summarisation when supportsResponseSchema is false', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId } = await setup('summarise-noschema');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY_NO_SCHEMA));
    const res = await agent
      .post(`/api/chapters/${chapterId}/summarise`)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('model_unsupported_for_summarisation');
  });

  it('happy path: persists a valid summary returned by Venice', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId } = await setup('summarise-happy');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          { message: { content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }) } },
        ],
      }),
    );
    const res = await agent
      .post(`/api/chapters/${chapterId}/summarise`)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
    expect(typeof res.body.summaryUpdatedAt).toBe('string');
  });

  it('502 summary_parse_failed on malformed JSON', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId } = await setup('summarise-malformed');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { choices: [{ message: { content: 'not json at all' } }] }),
    );
    const res = await agent
      .post(`/api/chapters/${chapterId}/summarise`)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('summary_parse_failed');
  });
});
```

```bash
make dev
npm --prefix backend run test -- chapters.summarise
```
Expected: fail (route not yet defined).

- [ ] **Step 3: Implement the route in `backend/src/routes/chapters.routes.ts`**

Add imports near the existing imports. The system-prompt template comes from the existing `DEFAULT_PROMPTS` registry (Task 5 Step 3) via the existing `resolvePrompt` helper; user-prompt overrides flow through the standard `resolveUserPrompts(rawSettings)` path that `/complete` already uses ([`ai.routes.ts:90`](backend/src/routes/ai.routes.ts#L90)).

```ts
import { z } from 'zod';
import { chapterSummaryJsonSchema, chapterSummaryResponseSchema, chapterSummarySchema } from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { respond } from '../lib/respond';
import { getVeniceClient } from '../lib/venice';
import { mapVeniceError } from '../lib/venice-errors';
import { resolvePrompt } from '../services/prompt.service';
import { resolveUserPrompts } from '../services/user-settings-resolvers';
import { veniceModelsService } from '../services/venice.models.service';
import { tipTapJsonToText } from '../services/tiptap-text';
```
(`respond` / `serializeChapter` / the shared schemas may already be imported at the top of `chapters.routes.ts` — merge, don't duplicate.)

(`resolvePrompt` is a small private helper today at [`prompt.service.ts:160-164`](backend/src/services/prompt.service.ts#L160-L164) — export it as part of Task 5 Step 3 so the route can use it.)

Add the route handler:

```ts
const SummariseBody = z.object({ modelId: z.string().min(1) });

router.post(
  '/:id/summarise',
  validateBody(SummariseBody, async (body, req, res) => {
    const userId = req.user!.id;
    const chapterId = req.params.id;

    const chapter = await createChapterRepo(req).findById(chapterId);
    if (!chapter) {
      res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
      return;
    }

    const plaintext = tipTapJsonToText(chapter.bodyJson ?? null).trim();
    if (plaintext.length === 0 || chapter.wordCount === 0) {
      res.status(400).json({ error: { message: 'Chapter has no body to summarise', code: 'empty_chapter' } });
      return;
    }

    // User-prompt overrides (per-user settingsJson) — pattern from ai.routes.ts:84-90.
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { settingsJson: true },
    });
    const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);

    try {
      await veniceModelsService.fetchModels(userId);
    } catch (err) {
      if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
      throw err;
    }

    const modelInfo = veniceModelsService.findModel(body.modelId);
    if (!modelInfo || modelInfo.supportsResponseSchema === false) {
      res.status(400).json({
        error: {
          message: "This model doesn't support structured output — switch to a schema-capable model.",
          code: 'model_unsupported_for_summarisation',
        },
      });
      return;
    }

    const client = await getVeniceClient(userId);
    let raw: { choices?: Array<{ message?: { content?: string } }> };
    try {
      // OpenAI SDK 6.36+ types `response_format: { type: 'json_schema', json_schema: {...} }`
      // natively — no cast needed. If a future SDK regression breaks this, add
      // `as unknown as Parameters<typeof client.chat.completions.create>[0]` with
      // a one-line comment noting the SDK version that regressed.
      // `chapterSummaryJsonSchema()` strips maxLength/$schema — see its doc comment.
      const completion = await client.chat.completions.create({
        model: body.modelId,
        messages: [
          { role: 'system', content: resolvePrompt(userPrompts, 'summariseChapter') },
          { role: 'user', content: plaintext },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ChapterSummary',
            schema: chapterSummaryJsonSchema(),
            strict: true,
          },
        },
      });
      raw = completion as unknown as typeof raw;
    } catch (err) {
      if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
      throw err;
    }

    const content = raw.choices?.[0]?.message?.content ?? '';
    let parsed;
    try {
      parsed = chapterSummarySchema.parse(JSON.parse(content));
    } catch {
      res.status(502).json({
        error: { message: 'Venice returned a malformed summary.', code: 'summary_parse_failed' },
      });
      return;
    }

    const updated = await createChapterRepo(req).update(chapterId, { summaryJson: parsed });
    if (!updated) {
      res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
      return;
    }
    respond(chapterSummaryResponseSchema, res, {
      // Non-null assertion: the update({ summaryJson }) just above always wrote a
      // ChapterSummary, so updated.summary is never null here — but its type stays
      // `ChapterSummary | null`, and the response schema requires non-null. (`!` is
      // lint-safe: biome noNonNullAssertion is off.)
      summary: updated.summary!,
      summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() ?? null,
    });
  }),
);
```

> Note: `respond()` will `.parse()` the body in dev/test against `chapterSummaryResponseSchema`, which requires `summary` non-null — fine here, since a successful summarise always parsed a `ChapterSummary`. The `summary_parse_failed` (502) and `empty_chapter` (400) branches above return *before* this point, so they never hit the success schema.

- [ ] **Step 4: Tests pass + typecheck**

```bash
npm --prefix backend run test -- chapters.summarise
npm --prefix backend run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "[pcs] POST /api/chapters/:id/summarise — Venice json_schema + capability precheck"
```

---

## Task 8: PUT `/api/chapters/:id/summary`

**Files:**
- Modify: `backend/src/routes/chapters.routes.ts`
- Create or extend: `backend/tests/routes/chapters.summary-put.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// backend/tests/routes/chapters.summary-put.test.ts
// Reuse the setup() helper from chapters.summarise.test.ts pattern (Task 7) —
// or copy it inline here if you'd rather not couple the two test files.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { makeFakeReq, registerAndLogin, resetAll } from './_chat-test-helpers';

async function setup(username: string) {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);
  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id,
    title: 'Ch',
    bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'prose' }] }] },
    orderIndex: 0,
    wordCount: 1,
  });
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);
  return { agent, chapterId: chapter.id as string };
}

describe('PUT /api/chapters/:id/summary', () => {
  beforeEach(async () => { _resetSessionStore(); await resetAll(); });
  afterEach(async () => { _resetSessionStore(); await resetAll(); });

  it('persists a user-edited summary', async () => {
    const { agent, chapterId } = await setup('put-summary-happy');
    const payload = { events: 'a', stateAtEnd: 'b', openThreads: 'c' };
    const res = await agent.put(`/api/chapters/${chapterId}/summary`).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(payload);
  });

  it('rejects invalid shape (missing required fields)', async () => {
    const { agent, chapterId } = await setup('put-summary-invalid');
    const res = await agent
      .put(`/api/chapters/${chapterId}/summary`)
      .send({ events: 'only one field' });
    expect(res.status).toBe(400);
  });

  it('404 for non-owner', async () => {
    const a = await setup('put-summary-owner-a');
    const b = await setup('put-summary-owner-b');
    const res = await b.agent
      .put(`/api/chapters/${a.chapterId}/summary`)
      .send({ events: 'a', stateAtEnd: 'b', openThreads: 'c' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Add the route**

```ts
router.put(
  '/:id/summary',
  validateBody(chapterSummarySchema, async (body, req, res) => {
    const updated = await createChapterRepo(req).update(req.params.id, { summaryJson: body });
    if (!updated) {
      res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
      return;
    }
    respond(chapterSummaryResponseSchema, res, {
      // Non-null assertion: the update({ summaryJson }) just above always wrote a
      // ChapterSummary, so updated.summary is never null here — but its type stays
      // `ChapterSummary | null`, and the response schema requires non-null. (`!` is
      // lint-safe: biome noNonNullAssertion is off.)
      summary: updated.summary!,
      summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() ?? null,
    });
  }),
);
```

(`chapterSummaryResponseSchema` + `respond` are imported in Task 7; this route shares the file.)

- [ ] **Step 3: Tests pass + typecheck + commit**

```bash
npm --prefix backend run test -- chapters.summary-put
npm --prefix backend run typecheck
git add backend/
git commit -m "[pcs] PUT /api/chapters/:id/summary — user-edited summary"
```

---

## Task 9: AI / Chat Routes — Inject `<previous_chapters>`

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`
- Modify: `backend/src/routes/chat.routes.ts`
- Modify: existing tests for ai.routes / chat.routes (assert block presence/absence)

- [ ] **Step 1: Extend an existing ai-routes test**

First locate the existing ai-routes test file:

```bash
ls backend/tests/routes/ai*.test.ts
```

Likely `backend/tests/routes/ai.test.ts` or `ai.complete.test.ts`. Extend it (or chat.test.ts for the chat-side change) with two new cases. Use the same `stubVeniceFetch` + `registerAndLogin` + `setup()` pattern as Task 7; inspect the captured fetch payload to assert what was sent to Venice.

```ts
// Two new cases for the existing ai-routes describe block; reuses Task 6 shared helpers.
it('includes <previous_chapters> when story.includePreviousChaptersInPrompt is true', async () => {
  const fetchSpy = stubVeniceFetch();
  // setup() here needs >=2 chapters and a summary on chapter 0. Either extend the
  // existing setup() in ai.test.ts (likely already creates a story + 1 chapter)
  // or build a small local variant. Pattern from Task 7 / chat.test.ts setup().
  const { agent, chapter0Id, chapter1Id, req } = await setupTwoChapters('ai-prev-on');
  await storeKey(agent, fetchSpy);
  await createChapterRepo(req).update(chapter0Id, {
    summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 't' },
  });

  fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
  queueSseResponse(fetchSpy, '...');

  await agent.post('/api/ai/complete').send({
    action: 'continue', selectedText: '', chapterId: chapter1Id, storyId: /* ... */,
    modelId: MODEL_ID,
  });

  // Find the chat/completions call (the SECOND fetch call after the /models one).
  const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/chat/completions'));
  const sentBody = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? '{}'));
  const systemMessage = sentBody.messages?.[0]?.content as string;
  expect(systemMessage).toContain('<previous_chapters>');
  expect(systemMessage).toContain('<chapter index="1"');
});

it('omits <previous_chapters> when story.includePreviousChaptersInPrompt=false', async () => {
  // Same setup, but PATCH the story to set includePreviousChaptersInPrompt=false
  // before the /api/ai/complete call. Assert the captured system message does NOT
  // contain '<previous_chapters>'.
});
```

(`queueSseResponse` already lives in `_chat-test-helpers.ts` after Task 6's extraction.)

- [ ] **Step 2: Modify `backend/src/routes/ai.routes.ts`**

> Precheck: both `ai.routes.ts` and `chat.routes.ts` load the story via `createStoryRepo(req).findById(storyId)` (no route-level Prisma `select`), so the read of `story.includePreviousChaptersInPrompt` below depends on `story.repo`'s `findById` surfacing the new scalar column. Prisma returns all scalar columns by default, so a plain spread/`shape()` will carry it — but confirm with a one-line grep that `story.repo.findById` doesn't use a narrowing `select`, and that `RepoStory` / `serializeStory` (Task 10) include the field. If `findById` selects an explicit column set, add `includePreviousChaptersInPrompt`.

In `/complete`, between "Load characters" and "Build prompt":

```ts
const previousChapters = story.includePreviousChaptersInPrompt
  ? (await createChapterRepo(req).findManyForStory(body.storyId, { includeSummary: true }))
      .filter((c) => c.orderIndex < chapter.orderIndex && c.summary !== null)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((c) => ({ orderIndex: c.orderIndex, title: c.title, summary: c.summary! }))
  : undefined;
```

Pass `previousChapters` into the `buildPrompt({ ... })` call.

- [ ] **Step 3: Modify `backend/src/routes/chat.routes.ts`**

Same change in the corresponding ask/scene prompt-assembly site.

- [ ] **Step 4: Tests pass + typecheck**

```bash
npm --prefix backend run test -- ai.complete chat
npm --prefix backend run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "[pcs] ai.routes + chat.routes: inject <previous_chapters> via findManyForStory({ includeSummary })"
```

---

## Task 10: `PATCH /api/stories/:id` — Accept Toggle

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`
- Extend existing stories.routes tests

- [ ] **Step 1: Concretely check the PATCH handler's data-write shape**

```bash
grep -n "patch\|PATCH\|data:" backend/src/routes/stories.routes.ts | head -20
```

Report which pattern the handler uses:
- (a) `data: req.body` or `data: { ...req.body }` — spreads validated body straight to Prisma. Adding `includePreviousChaptersInPrompt: z.boolean().optional()` to `storyCreateSchema` (Task 1) is sufficient; no route-code change.
- (b) Explicit field whitelist (e.g. `data: { title: body.title, genre: body.genre, ... }`). Needs a one-line addition: `includePreviousChaptersInPrompt: body.includePreviousChaptersInPrompt`.

Also check the **story serializer** (`backend/src/lib/serialize.ts:serializeStory`):

```bash
grep -n "serializeStory\|includePreviousChaptersInPrompt" backend/src/lib/serialize.ts
```

If `serializeStory` is an explicit-pick converter, add the new field to its picked keys. Same for `storySchema` in `shared/src/schemas/story.ts` if it's `z.strictObject` (which would reject the unknown field on response).

- [ ] **Step 2: Write failing test**

```ts
// Append to the existing stories.routes test file. Reuse setup() / registerAndLogin from
// whichever helpers that file already imports (most likely registerAndLogin directly).
it('PATCH accepts includePreviousChaptersInPrompt and persists it', async () => {
  const accessToken = await registerAndLogin('stories-pcs-toggle');
  const req = makeFakeReq(accessToken);
  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);

  const res = await agent
    .patch(`/api/stories/${story.id}`)
    .send({ includePreviousChaptersInPrompt: false });
  expect(res.status).toBe(200);
  expect(res.body.story.includePreviousChaptersInPrompt).toBe(false);
});
```

- [ ] **Step 3: Implement based on Step 1's findings**

Apply whichever of (a) or (b) from Step 1 matches. Update the serializer / shared schema as needed.

- [ ] **Step 4: Tests pass + typecheck + commit**

```bash
npm --prefix backend run test -- stories
npm --prefix backend run typecheck
git add backend/ shared/
git commit -m "[pcs] PATCH /api/stories/:id accepts includePreviousChaptersInPrompt"
```

---

## Task 11: `[E12]` Leak-Test Extension

**Files:**
- Modify: `backend/tests/security/encryption-leak.test.ts` (the real `[E12]` file — verified path)

The `[E12]` test is **not** a log/response-capture test (that's the `[AU13]` BYOK pattern in `byok-leak.test.ts`). It is a **raw-disk-scan**: it seeds every narrative entity through the repo layer with the sentinel `SENTINEL_E12_DO_NOT_LEAK` buried in each encrypted-at-rest field, then opens a raw `pg` connection and scans every row of every `NARRATIVE_TABLES` table — the sentinel must appear **nowhere** (proving the value was encrypted before it hit disk). For chapter summaries, the extension is therefore one extra repo write that buries the sentinel in `summaryJson`; the existing scan loop already iterates **all** columns of the `Chapter` row, so it covers the new `summaryJsonCiphertext` column automatically with no new scan code.

- [ ] **Step 1: Bury the sentinel in `summaryJson` within the existing seed block**

In the first `it(...)` of `encryption-leak.test.ts` (the "full repo write of every entity type" case), immediately after the existing `chapterRepo.create({...})` that produces `chapter`, add a summary write using the file's existing `SENTINEL` const (do **not** introduce a new sentinel):

```ts
// Encrypted-at-rest chapter summary — must not reach disk in plaintext.
await chapterRepo.update(chapter.id as string, {
  summaryJson: {
    events: `summary-events ${SENTINEL}`,
    stateAtEnd: `summary-state ${SENTINEL}`,
    openThreads: `summary-threads ${SENTINEL}`,
  },
});
```

No change to the scan loop, the `NARRATIVE_TABLES` list, or the assertions — `SELECT * FROM "Chapter"` already enumerates `summaryJsonCiphertext` and the loop scans every column. If the summary plaintext ever lands on disk (e.g. a repo bug writing the JSON unencrypted), the existing `hits` check fails with `Chapter.summaryJson…`.

> Do not add a separate log/response-leak `it(...)` here — the production-log and non-owner-response rules for narrative content are covered elsewhere (the global egress rules + `respond()` gate); the `[E12]` file's sole job is the disk-scan invariant. `repo-boundary-reviewer` fans out on this file, so keep the extension inside the existing harness rather than inventing a parallel one.

- [ ] **Step 2: Test passes + commit**

```bash
make dev   # raw pg scan needs the test DB up
npm --prefix backend run test -- encryption-leak
git add backend/tests/security/encryption-leak.test.ts
git commit -m "[pcs] [E12] bury sentinel in chapter summaryJson — disk-scan covers summaryJsonCiphertext"
```

---

## Task 12: Frontend — Extract `FieldRow` Primitive

**Files:**
- Modify: `frontend/src/design/primitives.tsx`
- Modify: `frontend/src/components/CharacterPopover.tsx`

- [ ] **Step 1: Add `FieldRow` to `primitives.tsx`**

```ts
export interface FieldRowProps {
  label: string;
  value: string | null;
}

export function FieldRow({ label, value }: FieldRowProps): JSX.Element {
  const display = value && value.trim().length > 0 ? value : '—';
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono mt-2">{label}</dt>
      <dd className="font-serif text-[13px] text-ink mt-0.5 whitespace-pre-wrap">{display}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Migrate `CharacterPopover.tsx`**

Delete the local `FieldRow` function (lines 75-88 in current file). Add:

```ts
import { FieldRow } from '@/design/primitives';
```

Confirm the three call sites still compile (`<FieldRow label="Appearance" value={appearance} />` etc.).

- [ ] **Step 3: Run frontend tests + typecheck**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- CharacterPopover
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design/primitives.tsx frontend/src/components/CharacterPopover.tsx
git commit -m "[pcs] frontend: extract FieldRow to primitives; CharacterPopover migrates"
```

---

## Task 13: Frontend — Extract `computePosition` Helper

**Files:**
- Create: `frontend/src/lib/popover-position.ts`
- Modify: `frontend/src/components/CharacterPopover.tsx`

- [ ] **Step 1: Create the helper**

Co-locate the named constants with the helper (so both consumers reach a single source of truth instead of either redefining defaults inline or maintaining two copies). The constants are lifted from [`CharacterPopover.tsx:36-38`](frontend/src/components/CharacterPopover.tsx#L36-L38) — copy the literal values verbatim, then delete from `CharacterPopover.tsx`.

```ts
// frontend/src/lib/popover-position.ts
export interface Position {
  top: number;
  left: number;
}

export const POPOVER_GAP_PX = 6;
export const VIEWPORT_PAD_PX = 8;

export interface ComputePopoverPositionOptions {
  /** Popover width in px (required — varies per consumer). */
  width: number;
  /** Gap between anchor's bottom edge and popover's top edge. Defaults to POPOVER_GAP_PX. */
  gap?: number;
  /** Viewport-edge padding. Defaults to VIEWPORT_PAD_PX. */
  viewportPad?: number;
}

export function computePopoverPosition(
  anchor: HTMLElement,
  opts: ComputePopoverPositionOptions,
): Position {
  const { width, gap = POPOVER_GAP_PX, viewportPad = VIEWPORT_PAD_PX } = opts;
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + gap;
  let left = rect.left + window.scrollX;
  const viewportWidth =
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0;
  if (viewportWidth > 0) {
    const maxLeft = viewportWidth - width - viewportPad + window.scrollX;
    if (left > maxLeft) left = Math.max(viewportPad + window.scrollX, maxLeft);
  }
  if (left < window.scrollX + viewportPad) {
    left = window.scrollX + viewportPad;
  }
  return { top, left };
}
```

- [ ] **Step 2: Migrate `CharacterPopover.tsx`**

Delete the inline `computePosition` function, the `Position` interface, and the `POPOVER_GAP_PX` / `VIEWPORT_PAD_PX` constants (they now live in `popover-position.ts`). Keep `POPOVER_WIDTH_PX` — it's CharacterPopover-specific (the new chapter popover uses its own width constant). Replace the in-component call:

```ts
import { computePopoverPosition } from '@/lib/popover-position';
// ...
setPos(computePopoverPosition(anchorEl, { width: POPOVER_WIDTH_PX }));
```

- [ ] **Step 3: Test + typecheck + commit**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- CharacterPopover
git add frontend/src/lib/popover-position.ts frontend/src/components/CharacterPopover.tsx
git commit -m "[pcs] frontend: extract computePopoverPosition; CharacterPopover migrates"
```

---

## Task 14: Chapter-Summary Hooks (`useSummariseChapterMutation` + `useUpdateChapterSummaryMutation`) + `deriveSummaryState`

Matches the existing one-mutation-per-hook convention in [`frontend/src/hooks/useChapters.ts`](frontend/src/hooks/useChapters.ts) (`useCreateChapterMutation`, `useUpdateChapterMutation`, `useDeleteChapterMutation`, `useReorderChaptersMutation`). The popover composes them; no compound `useChapterSummary` wrapper.

`deriveSummaryState` is a pure function: testable in isolation, called from both the popover and the per-row `SummaryStateIcon`. Lives next to the mutations in the new chapter-summaries hook file rather than as an inline `useMemo` so it's exercisable without a React harness.

**Files:**
- Create: `frontend/src/hooks/useChapterSummary.ts` — both mutations + `deriveSummaryState` (detail) + `deriveListSummaryState` (list-meta, no `corrupted`) + `SummaryState` type
- Create: `frontend/src/hooks/useChapterSummary.test.ts` — tests for both derivations (the mutations themselves get exercised through the component tests in Tasks 16/17)

- [ ] **Step 1: Write failing tests**

```ts
// frontend/src/hooks/useChapterSummary.test.ts
import { describe, expect, it } from 'vitest';
import { deriveSummaryState } from './useChapterSummary';

describe('deriveSummaryState', () => {
  it('returns missing when hasSummary is false', () => {
    expect(deriveSummaryState({ hasSummary: false, summaryIsStale: false, summary: null })).toBe('missing');
  });
  it('returns corrupted when hasSummary && summary === null (decrypt failure path)', () => {
    expect(deriveSummaryState({ hasSummary: true, summaryIsStale: false, summary: null })).toBe('corrupted');
  });
  it('returns stale when hasSummary && summaryIsStale && summary present', () => {
    expect(deriveSummaryState({
      hasSummary: true, summaryIsStale: true,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    })).toBe('stale');
  });
  it('returns current when hasSummary && !summaryIsStale && summary present', () => {
    expect(deriveSummaryState({
      hasSummary: true, summaryIsStale: false,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    })).toBe('current');
  });
});

describe('deriveListSummaryState (no detail — never corrupted)', () => {
  it('returns missing when hasSummary is false', () => {
    expect(deriveListSummaryState({ hasSummary: false, summaryIsStale: false })).toBe('missing');
  });
  it('returns stale when hasSummary && summaryIsStale', () => {
    expect(deriveListSummaryState({ hasSummary: true, summaryIsStale: true })).toBe('stale');
  });
  it('returns current when hasSummary && !summaryIsStale (NEVER corrupted from list meta)', () => {
    expect(deriveListSummaryState({ hasSummary: true, summaryIsStale: false })).toBe('current');
  });
});
```

Add `deriveListSummaryState` to the import:

```ts
import { deriveListSummaryState, deriveSummaryState } from './useChapterSummary';
```

```bash
npm --prefix frontend run test -- useChapterSummary
```
Expected: fail (function not defined).

- [ ] **Step 2: Implement two mutations + pure function**

```ts
// frontend/src/hooks/useChapterSummary.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChapterSummary } from 'story-editor-shared';
import { chaptersQueryKey, chapterQueryKey } from './useChapters';
import { api } from '@/lib/api';

export type SummaryState = 'missing' | 'current' | 'stale' | 'corrupted' | 'generating';

/**
 * Pure derivation from chapter detail flags + summary. Exported so callers
 * can test their state-handling without a React harness. The 'generating'
 * variant is decided at the call site by reading the mutation's isPending
 * (not derivable from data alone).
 */
export function deriveSummaryState(input: {
  hasSummary: boolean;
  summaryIsStale: boolean;
  summary: ChapterSummary | null;
}): Exclude<SummaryState, 'generating'> {
  if (!input.hasSummary) return 'missing';
  if (input.summary === null) return 'corrupted';
  return input.summaryIsStale ? 'stale' : 'current';
}

/**
 * List-row derivation. The chapters-list cache is metadata-only — it carries
 * `hasSummary` + `summaryIsStale` but NEVER the decrypted `summary`. The
 * `corrupted` state requires detail (the `hasSummary && summary === null`
 * disagreement, which only the chapter-detail query can observe), so the list
 * can only ever surface missing / current / stale. Calling `deriveSummaryState`
 * with a hard-coded `summary: null` from the list would mislabel every
 * summarised row as `corrupted` — hence this separate, detail-free derivation.
 * `corrupted` surfaces later, in the popover, once detail is fetched.
 */
export function deriveListSummaryState(input: {
  hasSummary: boolean;
  summaryIsStale: boolean;
}): 'missing' | 'current' | 'stale' {
  if (!input.hasSummary) return 'missing';
  return input.summaryIsStale ? 'stale' : 'current';
}

/** POST /api/chapters/:id/summarise — generate OR regenerate; same endpoint either way. */
export function useSummariseChapterMutation(chapterId: string, storyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      return api<{ summary: ChapterSummary; summaryUpdatedAt: string }>(
        `/chapters/${encodeURIComponent(chapterId)}/summarise`,
        { method: 'POST', body: JSON.stringify({ modelId }) },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey(chapterId) });
      queryClient.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}

/** PUT /api/chapters/:id/summary — user-edited summary. */
export function useUpdateChapterSummaryMutation(chapterId: string, storyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (summary: ChapterSummary) => {
      return api<{ summary: ChapterSummary; summaryUpdatedAt: string }>(
        `/chapters/${encodeURIComponent(chapterId)}/summary`,
        { method: 'PUT', body: JSON.stringify(summary) },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey(chapterId) });
      queryClient.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}
```

The popover (Task 16) and sheet (Task 17) consume these directly. The existing `useChapterQuery(chapterId, storyId)` from `useChapters.ts` provides `summary`, `summaryUpdatedAt`, `hasSummary`, `summaryIsStale` — feed those into `deriveSummaryState` at the call site, then override to `'generating'` when the summarise mutation `isPending`.

- [ ] **Step 3: Test pass + typecheck + commit**

```bash
npm --prefix frontend run test -- useChapterSummary
npm --prefix frontend run typecheck
git add frontend/src/hooks/useChapterSummary.ts frontend/src/hooks/useChapterSummary.test.ts
git commit -m "[pcs] hooks: useSummariseChapterMutation + useUpdateChapterSummaryMutation + deriveSummaryState"
```

---

## Task 15: `<SummaryStateIcon>`

**Files:**
- Create: `frontend/src/components/SummaryStateIcon.tsx`
- Create: `frontend/src/components/SummaryStateIcon.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SummaryStateIcon } from './SummaryStateIcon';

describe('SummaryStateIcon', () => {
  it('renders aria-label per state', () => {
    render(<SummaryStateIcon state="missing" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/no summary yet/i);
  });
  it('click does not bubble (stopPropagation)', () => {
    const rowClick = vi.fn();
    const iconClick = vi.fn();
    render(
      <button type="button" onClick={rowClick}>
        <SummaryStateIcon state="current" onClick={iconClick} ariaPressed={false} />
      </button>,
    );
    fireEvent.click(screen.getByLabelText(/summary present/i));
    expect(iconClick).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement (copy the mockup component verbatim, drop into production)**

Copy `SummaryStateIcon` from `frontend/src/components/ChapterSummaryPopover.stories.tsx:79-134` into a new file `frontend/src/components/SummaryStateIcon.tsx`. Export it.

- [ ] **Step 3: Test pass + commit**

```bash
npm --prefix frontend run test -- SummaryStateIcon
git add frontend/src/components/SummaryStateIcon.tsx frontend/src/components/SummaryStateIcon.test.tsx
git commit -m "[pcs] SummaryStateIcon — per-row state badge + popover trigger"
```

---

## Task 16: `<ChapterSummaryPopover>`

**Files:**
- Create: `frontend/src/components/ChapterSummaryPopover.tsx`
- Create: `frontend/src/components/ChapterSummaryPopover.test.tsx`

**Prop-contract reconciliation (single source of truth).** This component is **smart**, not presentational. Reason: the chapter-list cache is metadata-only (no decrypted `summary`), so the popover must fetch detail itself to know the real state (`current` vs `stale` vs `corrupted`) and to render the three fields. It therefore owns: `useChapterQuery(chapter.id, storyId)` for detail, `deriveSummaryState(...)` over the fetched flags, the `useSummariseChapterMutation` (Regenerate/Generate), and the token estimate (computed from `chapter.wordCount`). EditorPage (Task 19) mounts it with the **list meta** + ids + `modelId` only — matching the spec's `{ chapterId, anchorEl }` page-root state. The single prop contract is:

```ts
export interface ChapterSummaryPopoverProps {
  /** List-meta only (id, orderIndex, title, wordCount, hasSummary, summaryIsStale).
   *  Detail (summary / summaryUpdatedAt) is fetched internally via useChapterQuery. */
  chapter: ChapterMeta | null;
  storyId: string;
  anchorEl: HTMLElement | null;
  modelId: string;
  onClose: () => void;
  /** Fires with chapterId when Edit is clicked → EditorPage opens the sheet. */
  onEdit: (chapterId: string) => void;
}
```

> NB: this differs from Cast's *presentational* `CharacterPopover` because `useCharactersQuery` carries full character detail, so `CharacterPopoverHost` can resolve everything and pass it down. The chapter list has no equivalent summary detail, so the fetch lives in the popover. (`'generating'` is `summariseMutation.isPending`; `'corrupted'` is the `hasSummary && summary === null` disagreement only visible after the detail fetch.)

- [ ] **Step 1: Write failing tests**

The component is smart → tests wrap in `QueryClientProvider`, seed the chapter-detail cache via `qc.setQueryData(chapterQueryKey('c1'), ...)`, and mock `fetch` for the summarise mutation. Assert against the smart contract above (no `state` / `summary` / `onSummarise` / `summariseTokenEstimate` / `modelName` props — those are derived internally).

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { chapterQueryKey } from '@/hooks/useChapters';
import { ChapterSummaryPopover } from './ChapterSummaryPopover';

const META = { id: 'c1', storyId: 's1', orderIndex: 0, title: 'Ch', wordCount: 10, status: 'draft' as const };

// Seeds the chapter-detail cache so useChapterQuery resolves synchronously.
function renderHarness(
  detail: { hasSummary: boolean; summaryIsStale: boolean; summary: unknown },
  props: Partial<React.ComponentProps<typeof ChapterSummaryPopover>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(chapterQueryKey('c1'), {
    ...META,
    bodyJson: null,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    summaryUpdatedAt: detail.hasSummary ? '2026-05-18T00:00:00.000Z' : null,
    ...detail,
  });
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return render(
    <QueryClientProvider client={qc}>
      <ChapterSummaryPopover
        chapter={{ ...META, hasSummary: detail.hasSummary, summaryIsStale: detail.summaryIsStale }}
        storyId="s1"
        anchorEl={anchor}
        modelId="m1"
        onClose={() => {}}
        onEdit={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ChapterSummaryPopover', () => {
  it('renders three FieldRows in current state', () => {
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } });
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('State at end')).toBeInTheDocument();
    expect(screen.getByText('Open threads')).toBeInTheDocument();
  });
  it('renders Generate button in missing state', () => {
    renderHarness({ hasSummary: false, summaryIsStale: false, summary: null });
    expect(screen.getByRole('button', { name: /generate summary/i })).toBeInTheDocument();
  });
  it('shows the corrupted/unreadable branch when hasSummary but summary is null', () => {
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: null });
    expect(screen.getByRole('button', { name: /(regenerate|generate)/i })).toBeInTheDocument();
    expect(screen.getByText(/unreadable|couldn.t be read/i)).toBeInTheDocument();
  });
  it('Regenerate fires the summarise mutation (POST /summarise)', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' }, summaryUpdatedAt: '2026-05-18T00:00:00Z' }), { status: 200 }),
    );
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } });
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/chapters/c1/summarise'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
  it('Edit fires onEdit with the chapter id', () => {
    const onEdit = vi.fn();
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } }, { onEdit });
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith('c1');
  });
  it('Escape closes', () => {
    const onClose = vi.fn();
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' } }, { onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement using CharacterPopover as the structural template**

Copy `CharacterPopover.tsx` to `ChapterSummaryPopover.tsx` and adapt to the **smart** contract above:
- Import `FieldRow` and `computePopoverPosition` from the extracted spots (Tasks 12–13)
- Props shape per `ChapterSummaryPopoverProps` above (list meta + ids + `modelId` + callbacks)
- Internally: `const detail = useChapterQuery(chapter?.id ?? null, storyId)`; `const summariseMutation = useSummariseChapterMutation(chapter!.id, storyId)`
- Derive state: `summariseMutation.isPending ? 'generating' : deriveSummaryState({ hasSummary, summaryIsStale, summary })` using the fetched detail flags (fall back to the `chapter` meta flags while detail is still loading)
- Compute the token estimate internally from `chapter.wordCount` (e.g. the existing `estimateTokens`-equivalent on the frontend, or a simple `wordCount`-based heuristic — match whatever the spec's cost caption specifies)
- Header: chapter title + "Chapter N" caption with stale/corrupted pill
- Body branches per state (mirror the mockup at `ChapterSummaryPopover.stories.tsx`); `corrupted` renders the "unreadable" body + a Regenerate affordance
- Footer: Edit + Regenerate (current/stale), Generate (missing/corrupted), Cancel (generating); cost-estimate caption right-aligned. Regenerate/Generate both call `summariseMutation.mutate(modelId)`
- Use `useEscape({ priority: 50 })` for Escape, mousedown listener for outside-click — same as CharacterPopover

- [ ] **Step 3: Test pass + typecheck + commit**

```bash
npm --prefix frontend run test -- ChapterSummaryPopover
npm --prefix frontend run typecheck
git add frontend/src/components/ChapterSummaryPopover.tsx frontend/src/components/ChapterSummaryPopover.test.tsx
git commit -m "[pcs] ChapterSummaryPopover — 280px Cast-style popover, five state branches"
```

---

## Task 17: `<ChapterSummarySheet>`

**Files:**
- Create: `frontend/src/components/ChapterSummarySheet.tsx`
- Create: `frontend/src/components/ChapterSummarySheet.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChapterSummarySheet } from './ChapterSummarySheet';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
};

describe('ChapterSummarySheet', () => {
  it('submits all three fields', async () => {
    const onClose = vi.fn();
    // Mock fetch
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' }, summaryUpdatedAt: '2026-05-18T00:00:00Z' }), { status: 200 }),
    );
    render(wrap(
      <ChapterSummarySheet chapterId="c1" storyId="s1" open onClose={onClose}
        initialSummary={{ events: '', stateAtEnd: '', openThreads: '' }} />,
    ));
    await userEvent.type(screen.getByLabelText(/events/i), 'a');
    await userEvent.type(screen.getByLabelText(/state at end/i), 'b');
    await userEvent.type(screen.getByLabelText(/open threads/i), 'c');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/chapters/c1/summary'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
```

- [ ] **Step 2: Implement**

Use `CharacterSheet.tsx` as the structural template. Three `<textarea>` fields, Zod-validated submit via `useUpdateChapterSummaryMutation(chapterId, storyId).mutate(...)`, modal opens/closes via `open` prop.

- [ ] **Step 3: Test pass + commit**

```bash
npm --prefix frontend run test -- ChapterSummarySheet
git add frontend/src/components/ChapterSummarySheet.tsx frontend/src/components/ChapterSummarySheet.test.tsx
git commit -m "[pcs] ChapterSummarySheet — three-field edit modal"
```

---

## Task 18: `ChapterList` / `ChapterRow` Integration

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx`
- Modify: existing `ChapterList.test.tsx` (or extend)

- [ ] **Step 1: Write failing test**

```tsx
it('renders SummaryStateIcon on every row, with state derived from meta flags', () => {
  // Seed cache with chapters that have varying hasSummary / summaryIsStale
  // Render <ChapterList>; assert icon present per row with correct aria-label
});

it('clicking the icon fires onOpenSummary and does not bubble to chapter-select', () => {
  // Spy on both; click icon; assert onOpenSummary called, onSelectChapter not called
});

it('hides SummaryStateIcon while InlineConfirm is open on the active row', () => {
  // Open delete confirm; assert icon is not in the DOM for that row
});
```

- [ ] **Step 2: Modify `ChapterList.tsx`**

Add a new prop on `ChapterListProps`:

```ts
onOpenSummary: (chapterId: string, anchorEl: HTMLElement) => void;
```

Threading it down through `ChapterRow`. Render `<SummaryStateIcon>` between the title button and the word-count span, only when `!confirm.open`:

```tsx
{!confirm.open && (
  <SummaryStateIcon
    // List-meta only — use deriveListSummaryState (NOT deriveSummaryState).
    // The list cache has no decrypted summary; passing summary: null into the
    // detail derivation would mislabel every summarised row as `corrupted`.
    state={deriveListSummaryState({
      hasSummary: chapter.hasSummary,
      summaryIsStale: chapter.summaryIsStale,
    })}
    ariaPressed={false}
    onClick={(e) => {
      onOpenSummary(chapter.id, e.currentTarget as HTMLElement);
    }}
  />
)}
```

(Note: the icon never shows `corrupted` from the list — that fact requires detail, which the list cache doesn't carry. `deriveListSummaryState` returns only `missing` / `current` / `stale`. The popover, after fetching detail, may show `corrupted` via the full `deriveSummaryState`.)

- [ ] **Step 3: Tests + typecheck + commit**

```bash
npm --prefix frontend run test -- ChapterList
npm --prefix frontend run typecheck
git add frontend/src/components/ChapterList.tsx frontend/src/components/ChapterList.test.tsx
git commit -m "[pcs] ChapterList: SummaryStateIcon on every row + onOpenSummary callback"
```

---

## Task 19: `EditorPage` — Mount Popover + Sheet at Page Root

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Add page-root state**

```tsx
const [summaryPopoverState, setSummaryPopoverState] =
  useState<{ chapterId: string; anchorEl: HTMLElement } | null>(null);
const [summarySheetChapterId, setSummarySheetChapterId] = useState<string | null>(null);
```

- [ ] **Step 2: Wire callbacks**

Pass to `<ChapterList>`:

```tsx
onOpenSummary={(chapterId, anchorEl) => setSummaryPopoverState({ chapterId, anchorEl })}
```

Mount at page root, same pattern as `CharacterSheet`:

```tsx
{summaryPopoverState && story && (
  <ChapterSummaryPopover
    chapter={chaptersQuery.data?.find((c) => c.id === summaryPopoverState.chapterId) ?? null}
    storyId={story.id}
    anchorEl={summaryPopoverState.anchorEl}
    onClose={() => setSummaryPopoverState(null)}
    onEdit={(chapterId) => {
      setSummaryPopoverState(null);
      setSummarySheetChapterId(chapterId);
    }}
    modelId={selectedModelId}
  />
)}
{summarySheetChapterId && story && (
  <ChapterSummarySheet
    chapterId={summarySheetChapterId}
    storyId={story.id}
    open
    onClose={() => setSummarySheetChapterId(null)}
  />
)}
```

- [ ] **Step 3: Typecheck + smoke-test**

```bash
npm --prefix frontend run typecheck
make dev   # browse to a story, click a chapter's summary icon
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[pcs] EditorPage: mount ChapterSummaryPopover + ChapterSummarySheet at page root"
```

---

## Task 20: `StoryModal` Toggle

**Files:**
- Modify: `frontend/src/components/StoryModal.tsx`
- Modify: `frontend/src/components/StoryModal.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('shows the includePreviousChaptersInPrompt toggle, default checked', async () => {
  // Open StoryModal in edit mode against a story with the field true
  // Assert: checkbox is checked
});

it('PATCH includes includePreviousChaptersInPrompt when changed', async () => {
  // Toggle off, save, assert fetch payload includes includePreviousChaptersInPrompt: false
});
```

- [ ] **Step 2: Add the toggle field**

Inside the existing form, after the existing toggle/checkbox group:

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={form.includePreviousChaptersInPrompt}
    onChange={(e) => setField('includePreviousChaptersInPrompt', e.target.checked)}
  />
  <span>Include previous-chapter summaries in AI context</span>
</label>
```

Update the form's initial state from `story.includePreviousChaptersInPrompt` and include it in the PATCH payload.

- [ ] **Step 3: Tests + commit**

```bash
npm --prefix frontend run test -- StoryModal
git add frontend/src/components/StoryModal.tsx frontend/src/components/StoryModal.test.tsx
git commit -m "[pcs] StoryModal: includePreviousChaptersInPrompt toggle"
```

---

## Task 21: Replace Mockup Story with Production Story

**Files:**
- Overwrite: `frontend/src/components/ChapterSummaryPopover.stories.tsx`

- [ ] **Step 1: Rewrite the file as a production story**

Replace the entire file content with a Storybook story file that imports the real `ChapterSummaryPopover` from `./ChapterSummaryPopover` and exercises the five states (Current / Stale / Missing / Corrupted / Generating). Pattern: see existing real `.stories.tsx` files like `ChapterList.stories.tsx`.

Title becomes `'Components/ChapterSummaryPopover'` (drop the `Design Mockups/` namespace — production now).

- [ ] **Step 2: Verify Storybook renders all five stories**

```bash
make dev
npm --prefix frontend run storybook   # browse Components → ChapterSummaryPopover
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChapterSummaryPopover.stories.tsx
git commit -m "[pcs] ChapterSummaryPopover.stories: real story replaces design mockup"
```

---

## Task 22: End-to-End Sanity + `make verify`

- [ ] **Step 1: Run the local verify gate**

```bash
make verify
```

Expected: lint + typecheck + design-lint + builds + tests all green. Backend tests need `make dev` up first (vitest globalSetup hits Postgres).

- [ ] **Step 2: Smoke test in browser**

With `make dev` running:
1. Create a story with 3 chapters, fill chapter 1 with prose
2. Open the chapter sidebar — chapter 1's icon should show **missing**
3. Click the icon → popover opens → click **Generate summary** → wait → fields populate
4. Edit chapter 1's title → icon shifts to **stale**
5. Click icon → popover shows stale pill → **Regenerate** → fields refresh, pill clears
6. Click chapter 2, run an AI **continue** action → backend logs (in dev) should show `<previous_chapters>` block in the system message
7. Open story settings → toggle **Include previous-chapter summaries in AI context** off → AI action no longer logs the block
8. Tamper a row's `summaryJsonCiphertext` directly (psql) and reload → icon stays **current** (list flag) but popover shows **unreadable** state with Regenerate button

- [ ] **Step 3: If all green, no commit needed — done**

---

## Out-of-Plan Reminders for the Implementer

- Wire `bd update <id> --claim` and `bd close <id>` through the normal `/bd-execute` → `/bd-close-reviewed` flow once the bd issue exists.
- The `[E12]` leak test extension (Task 11) and the `repo-boundary-reviewer` automatic fan-out are gate items — close-gate will refuse `BLOCK` / `FIX_BEFORE_MERGE` findings.
- No `security-reviewer` fan-out needed (no auth/key/crypto-primitive surface change).
- **Verify the Venice json_schema round-trip on the opt-in `test:live` path** (`backend/tests/live/**`, run via `npm run test:live` with `.env.live`). Every default-suite route test mocks `fetch`, so a real schema rejection is never exercised. `chapterSummaryJsonSchema()` strips `maxLength`/`$schema` defensively, but confirm against a live schema-capable model that the structured-output call actually returns a parseable `ChapterSummary`. If the live call still rejects the schema, that's where it surfaces — not in CI.
- Storybook namespace migration: the file goes from `Design Mockups/ChapterSummaryPopover` to `Components/ChapterSummaryPopover` in Task 21 — old story link will 404, that's fine.
