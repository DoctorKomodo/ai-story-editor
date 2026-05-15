import { z } from 'zod';

export const CHAPTER_TITLE_MIN = 1;
export const CHAPTER_TITLE_MAX = 500;

export const chapterStatusSchema = z.enum(['draft', 'revision', 'final']);

/**
 * Chapter metadata — the LIST endpoint payload shape. Excludes the TipTap
 * body so the chapter-sidebar payload stays small. `chapterSchema` (below)
 * extends this with `bodyJson` for detail responses.
 */
export const chapterMetaSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  status: chapterStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Full chapter — meta + TipTap body. POST / PATCH / GET-by-id payload shape.
 * `bodyJson` is `z.unknown()` because TipTap's internal tree structure is
 * its own contract; we pass it through unvalidated.
 */
export const chapterSchema = chapterMetaSchema.extend({
  bodyJson: z.unknown(),
});

export const chapterCreateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX),
  bodyJson: z.unknown().optional(),
  status: chapterStatusSchema.optional(),
});

export const chapterUpdateSchema = z.strictObject({
  title: z.string().min(CHAPTER_TITLE_MIN).max(CHAPTER_TITLE_MAX).optional(),
  bodyJson: z.unknown().optional(),
  status: chapterStatusSchema.optional(),
  orderIndex: z.number().int().nonnegative().optional(),
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

// Co-located encrypted-field tuples. Two — full has body + title; meta has only title.
export const CHAPTER_ENCRYPTED_FIELD_KEYS = ['title', 'body'] as const;
export const CHAPTER_META_ENCRYPTED_FIELD_KEYS = ['title'] as const;

// z.infer type exports
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterMeta = z.infer<typeof chapterMetaSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type ChapterReorderInput = z.infer<typeof chapterReorderSchema>;
export type ChapterEncryptedFieldKey = (typeof CHAPTER_ENCRYPTED_FIELD_KEYS)[number];
export type ChapterMetaEncryptedFieldKey = (typeof CHAPTER_META_ENCRYPTED_FIELD_KEYS)[number];
