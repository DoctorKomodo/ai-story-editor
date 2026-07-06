import { z } from 'zod';
import { chapterSummarySchema } from './chapter';

export const DRAFT_LABEL_MAX = 200;

/**
 * Draft metadata — the LIST endpoint payload shape. Excludes the TipTap body
 * so the sidebar draft-tree payload stays small. `draftSchema` (below) extends
 * this with `bodyJson` + summary for detail responses.
 * `label: null` ⇒ the frontend renders a positional label ("Draft A/B/C").
 */
export const draftMetaSchema = z.strictObject({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  label: z.string().max(DRAFT_LABEL_MAX).nullable(),
  wordCount: z.number().int().nonnegative(),
  orderIndex: z.number().int().nonnegative(),
  isActive: z.boolean(),
  hasSummary: z.boolean(),
  summaryIsStale: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Full draft — meta + TipTap body + decoded summary. */
export const draftSchema = draftMetaSchema.extend({
  bodyJson: z.unknown(),
  summary: chapterSummarySchema.nullable(),
  summaryUpdatedAt: z.string().datetime().nullable(),
});

/** POST /api/chapters/:chapterId/drafts body. */
export const draftCreateSchema = z.strictObject({
  mode: z.enum(['fork', 'blank']),
  label: z.string().min(1).max(DRAFT_LABEL_MAX).optional(),
});

/**
 * PATCH /api/drafts/:draftId body. `label: null` clears back to positional.
 * `expectedUpdatedAt` is the optimistic-concurrency precondition against
 * Draft.updatedAt (ported from the chapter PATCH, 409 'conflict' when stale).
 */
export const draftUpdateSchema = z.strictObject({
  bodyJson: z.unknown().optional(),
  label: z.string().min(1).max(DRAFT_LABEL_MAX).nullable().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** PUT /api/chapters/:chapterId/active-draft body. */
export const activeDraftPutSchema = z.strictObject({
  draftId: z.string().min(1),
});

// Response envelopes
export const draftResponseSchema = z.strictObject({ draft: draftSchema });
export const draftsResponseSchema = z.strictObject({ drafts: z.array(draftMetaSchema) });

// Co-located encrypted-field tuple (moved from backend/src/repos/draft.repo.ts).
export const DRAFT_ENCRYPTED_FIELD_KEYS = ['body', 'summaryJson', 'label'] as const;

// z.infer type exports
export type Draft = z.infer<typeof draftSchema>;
export type DraftMeta = z.infer<typeof draftMetaSchema>;
export type DraftCreateInput = z.infer<typeof draftCreateSchema>;
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;
export type DraftEncryptedFieldKey = (typeof DRAFT_ENCRYPTED_FIELD_KEYS)[number];
