import { z } from 'zod';
import { chapterSummarySchema } from './chapter';
import { characterCreateSchema } from './character';
import { chatKindSchema } from './chat';
import { citationSchema, messageAttachmentSchema, messageRoleSchema } from './message';
import { outlineCreateSchema } from './outline';
import { storyCreateSchema } from './story';

/** Bump only on a breaking change to the file shape. Import rejects anything else. */
export const EXPORT_FORMAT_VERSION = 2 as const;

const messageExportSchema = z.strictObject({
  role: messageRoleSchema,
  content: z.string(),
  attachmentJson: messageAttachmentSchema.nullable().default(null),
  citationsJson: z.array(citationSchema).nullable().default(null),
  model: z.string().nullable().default(null),
  tokens: z.number().int().nullable().default(null),
  latencyMs: z.number().int().nullable().default(null),
  // Advisory only — import stamps a fresh createdAt (see plan / spec "known lossiness").
  createdAt: z.string().datetime(),
});

const chatExportSchema = z.strictObject({
  title: z.string().nullable().default(null),
  kind: chatKindSchema,
  messages: z.array(messageExportSchema).default([]),
});

const chapterExportSchema = z.strictObject({
  title: z.string().min(1).max(500),
  orderIndex: z.number().int().nonnegative(),
  bodyJson: z.unknown().optional(),
  summary: chapterSummarySchema.nullable().default(null),
  chats: z.array(chatExportSchema).default([]),
});

const characterExportSchema = characterCreateSchema.extend({
  orderIndex: z.number().int().nonnegative(),
});

const outlineExportSchema = outlineCreateSchema.extend({
  order: z.number().int().nonnegative(),
});

const storyExportSchema = storyCreateSchema.extend({
  // The live story's id and the max `updatedAt` across its subtree (story,
  // chapters, characters, outline items, chats, messages) at export time —
  // used by the preflight plan to match a file-story against a live story and
  // detect drift since the export was taken. Both are absent from legacy
  // (pre-conflict-detection) export files, which always plan as `new`.
  id: z.string().optional(),
  snapshotUpdatedAt: z.string().datetime().optional(),
  chapters: z.array(chapterExportSchema).default([]),
  characters: z.array(characterExportSchema).default([]),
  outlineItems: z.array(outlineExportSchema).default([]),
});

export const exportSchema = z.strictObject({
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  app: z.literal('inkwell'),
  exportedAt: z.string().datetime(),
  stories: z.array(storyExportSchema).default([]),
});
export type ExportFile = z.infer<typeof exportSchema>;

/** Import validates against the same shape; aliased for intent + future divergence. */
export const importSchema = exportSchema;
export type ImportFile = z.infer<typeof importSchema>;

/** Per-file-story status against the caller's live stories, keyed by `id`. */
const importPlanStoryStatusSchema = z.enum(['new', 'unchanged', 'conflict']);

/** POST /users/me/import/plan request body — preflight, no mutation. */
export const importPlanRequestSchema = z.strictObject({
  stories: z
    .array(
      z.strictObject({
        id: z.string(),
        snapshotUpdatedAt: z.string().datetime(),
      }),
    )
    .max(1000),
});
export type ImportPlanRequest = z.infer<typeof importPlanRequestSchema>;

export const importPlanResponseSchema = z.strictObject({
  stories: z.array(
    z.strictObject({
      id: z.string(),
      status: importPlanStoryStatusSchema,
    }),
  ),
});
export type ImportPlanResponse = z.infer<typeof importPlanResponseSchema>;

/** Per-file-story resolution chosen by the caller after reviewing the plan. */
export const importResolutionSchema = z.enum(['create', 'replace', 'skip']);
export type ImportResolution = z.infer<typeof importResolutionSchema>;

/**
 * POST /users/me/import request body. `resolutions` is keyed by file-story
 * `id`; a story without an `id`, or whose `id` has no entry, defaults to
 * `create`.
 */
export const importRequestSchema = z.strictObject({
  file: importSchema,
  resolutions: z.record(z.string(), importResolutionSchema).optional(),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

const importOutcomeActionSchema = z.enum(['created', 'replaced', 'skipped', 'failed']);

export const importResultSchema = z.strictObject({
  imported: z.strictObject({
    stories: z.number().int().nonnegative(),
    chapters: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    outlineItems: z.number().int().nonnegative(),
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }),
  // Per-story outcome, indexed into `file.stories` (no titles — import errors
  // must carry story index, not narrative content, per the no-leak rule).
  // Optional: absent from the legacy whole-file-replace response shape.
  outcomes: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        action: importOutcomeActionSchema,
      }),
    )
    .optional(),
});
export type ImportResult = z.infer<typeof importResultSchema>;
