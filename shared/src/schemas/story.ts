import { z } from 'zod';

// Field-length caps — single source of truth, exported so the frontend form
// (StoryModal) imports them instead of re-declaring the same numbers. Values
// copied verbatim from the legacy inline CreateStoryBody in stories.routes.ts.
export const STORY_TITLE_MAX = 500;
export const STORY_GENRE_MAX = 200;
export const STORY_SYNOPSIS_MAX = 10_000;
export const STORY_WORLD_NOTES_MAX = 50_000;

// `z.strictObject` rejects unknown keys at every layer — the load-bearing
// invariant that closes the Prisma↔Zod drift seam at egress-validation time,
// same as character.ts / message.ts. NOTE: no `userId` — Story rows carry a
// userId FK, but it is dropped at the serialize boundary (serializeStory picks
// rather than spreads).
export const storySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  synopsis: z.string().nullable(),
  genre: z.string().nullable(),
  worldNotes: z.string().nullable(),
  targetWords: z.number().int().positive().nullable(),
  includePreviousChaptersInPrompt: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Enriched shape for GET /api/stories — the list handler attaches per-story
// chapter aggregates. `.extend()` preserves strictObject strictness.
export const storyListItemSchema = storySchema.extend({
  chapterCount: z.number().int().nonnegative(),
  totalWordCount: z.number().int().nonnegative(),
});

// POST /api/stories request body. strictObject — the legacy inline
// CreateStoryBody was a plain z.object, so this tightens POST to reject
// unknown keys, matching the Character/Message pattern.
export const storyCreateSchema = z.strictObject({
  title: z.string().min(1).max(STORY_TITLE_MAX),
  synopsis: z.string().max(STORY_SYNOPSIS_MAX).nullable().optional(),
  genre: z.string().max(STORY_GENRE_MAX).nullable().optional(),
  worldNotes: z.string().max(STORY_WORLD_NOTES_MAX).nullable().optional(),
  targetWords: z.number().int().positive().nullable().optional(),
  includePreviousChaptersInPrompt: z.boolean().optional(),
});

// PATCH /api/stories/:id request body — every field optional, still strict.
export const storyUpdateSchema = storyCreateSchema.partial();

export const storyResponseSchema = z.strictObject({ story: storySchema });
export const storiesResponseSchema = z.strictObject({
  stories: z.array(storyListItemSchema),
});

// Single source of truth for which Story fields are encrypted at rest.
// Imported by backend/src/repos/story.repo.ts as ENCRYPTED_FIELDS. Mirrors the
// MESSAGE_ENCRYPTED_FIELD_KEYS pattern — a repo-only consumer, but the tuple
// belongs beside the schema describing the same entity.
export const STORY_ENCRYPTED_FIELD_KEYS = ['title', 'synopsis', 'worldNotes'] as const;

export type Story = z.infer<typeof storySchema>;
export type StoryListItem = z.infer<typeof storyListItemSchema>;
export type StoryCreateInput = z.infer<typeof storyCreateSchema>;
export type StoryUpdateInput = z.infer<typeof storyUpdateSchema>;
export type StoryEncryptedFieldKey = (typeof STORY_ENCRYPTED_FIELD_KEYS)[number];
