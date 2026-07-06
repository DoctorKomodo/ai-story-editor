import { z } from 'zod';

export const CHAPTER_TITLE_MIN = 1;
export const CHAPTER_TITLE_MAX = 500;
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
 * stays within the safe minimal subset.
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

/**
 * Chapter metadata — the LIST endpoint payload shape. Excludes the TipTap
 * body so the chapter-sidebar payload stays small. `chapterSchema` (below)
 * extends this with `bodyJson` for detail responses.
 */
const chapterMetaBase = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const chapterMetaSchema = chapterMetaBase.extend({
  hasSummary: z.boolean(),
  summaryIsStale: z.boolean(),
  // [9wk.4] Draft-tree wire fields: the sidebar needs both without an extra
  // round-trip; wordCount/summary flags are sourced from the ACTIVE draft.
  draftCount: z.number().int().positive(),
  activeDraftId: z.string().min(1),
});

/**
 * Full chapter — meta + TipTap body. POST / PATCH / GET-by-id payload shape.
 * `bodyJson` is `z.unknown()` because TipTap's internal tree structure is
 * its own contract; we pass it through unvalidated.
 */
export const chapterSchema = chapterMetaSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});

export const chapterCreateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX),
  bodyJson: z.unknown().optional(),
});

export const chapterUpdateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  // [9wk.4] bodyJson + expectedUpdatedAt moved to the draft-scoped PATCH
  // (/api/drafts/:draftId) — body writes to this endpoint now 400.
});

/**
 * Bulk reorder payload. Semantic checks (duplicate ids, duplicate orderIndex
 * values) live in the route handler — this schema only validates shape.
 */
export const chapterReorderSchema = z.strictObject({
  chapters: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        orderIndex: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

// Response envelopes
export const chapterResponseSchema = z.strictObject({ chapter: chapterSchema });
export const chaptersResponseSchema = z.strictObject({
  chapters: z.array(chapterMetaSchema),
});

// [9wk.4] Chapter's `body`/`summaryJson` columns are dormant post-cutover —
// the active draft is the sole source for both (see chapter.repo `shape()`).
// Only `title` remains chapter-own encrypted content.
export const CHAPTER_META_ENCRYPTED_FIELD_KEYS = ['title'] as const;

// z.infer type exports
export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterMeta = z.infer<typeof chapterMetaSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type ChapterReorderInput = z.infer<typeof chapterReorderSchema>;
export type ChapterMetaEncryptedFieldKey = (typeof CHAPTER_META_ENCRYPTED_FIELD_KEYS)[number];
