import { z } from 'zod';

// Field-length caps — single source of truth.
// Values from the legacy inline `PatchChatBody` (min 1, max 200).
export const CHAT_TITLE_MIN = 1;
export const CHAT_TITLE_MAX = 200;

export const chatKindSchema = z.enum(['ask', 'scene']);

// `z.strictObject` rejects unknown keys at every layer — closes the
// Prisma↔Zod drift seam at egress-validation time, same as the other entities.
export const chatSchema = z.strictObject({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  // Title is encrypted at rest; the wire format is plaintext (null when unset).
  title: z.string().nullable(),
  kind: chatKindSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Bumped on every child-message create; surfaces "most-recent chat" at
  // index 0 of the LIST endpoint's response.
  lastActivityAt: z.string().datetime(),
});

// LIST-endpoint enrichment. Zod 4: `.extend()` on a strictObject preserves
// strictness (verified in test "rejects unknown keys (strictness preserved
// through .extend())"). Same trick outlineUpdateSchema uses.
export const chatSummarySchema = chatSchema.extend({
  messageCount: z.number().int().nonnegative(),
});

// POST body — chapterId comes from the URL, not the body. Both fields optional.
export const chatCreateSchema = z.strictObject({
  title: z.string().optional(),
  kind: chatKindSchema.optional(),
});

// PATCH body — title only, must be non-empty (legacy behaviour). Null not
// permitted on this endpoint (clearing a title isn't a supported action).
export const chatUpdateSchema = z.strictObject({
  title: z.string().min(CHAT_TITLE_MIN).max(CHAT_TITLE_MAX),
});

// Egress envelopes.
export const chatResponseSchema = z.strictObject({ chat: chatSchema });
export const chatsResponseSchema = z.strictObject({
  chats: z.array(chatSummarySchema),
});

// Single source of truth for which Chat fields are encrypted at rest.
// Imported by backend/src/repos/chat.repo.ts as ENCRYPTED_FIELDS. Repo-only
// consumer, but the tuple belongs beside the schema describing the same entity
// (matches the STORY / MESSAGE pattern).
export const CHAT_ENCRYPTED_FIELD_KEYS = ['title'] as const;

export type Chat = z.infer<typeof chatSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type ChatKind = z.infer<typeof chatKindSchema>;
export type ChatCreateInput = z.infer<typeof chatCreateSchema>;
export type ChatUpdateInput = z.infer<typeof chatUpdateSchema>;
export type ChatEncryptedFieldKey = (typeof CHAT_ENCRYPTED_FIELD_KEYS)[number];
