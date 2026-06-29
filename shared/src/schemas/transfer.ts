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

export const importResultSchema = z.strictObject({
  imported: z.strictObject({
    stories: z.number().int().nonnegative(),
    chapters: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    outlineItems: z.number().int().nonnegative(),
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }),
});
export type ImportResult = z.infer<typeof importResultSchema>;
