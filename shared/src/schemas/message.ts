import { z } from 'zod';

export const citationSchema = z.strictObject({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publishedAt: z.string().nullable(),
});

export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);

export const messageAttachmentSchema = z.strictObject({
  selectionText: z.string().min(1),
  chapterId: z.string().min(1),
});

// Wire/read shape. `content: z.string()` (not `.min(1)`) — the write
// contract requires non-empty for user turns, but assistant turns are
// produced by Venice and can legitimately be empty (e.g. a stream
// terminated before any delta chunk; a refusal that emits no content).
// Tightening here would force a "skip persist when empty" workaround
// that hides the state from the UI. Renamed from the legacy `contentJson`
// (the Json suffix was inherited from an earlier design that never
// materialised). The other two ciphertext fields keep their *Json names
// because they actually carry JSON payloads.
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string(),
  attachmentJson: messageAttachmentSchema.nullable(),
  citationsJson: z.array(citationSchema).nullable(),
  model: z.string().nullable(),
  tokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  // Null = never edited; ISO timestamp of the last in-place edit otherwise.
  updatedAt: z.string().datetime().nullable(),
});

export const messagesResponseSchema = z.strictObject({
  messages: z.array(messageSchema),
});

// Single-message response shape: PATCH /api/chats/:chatId/messages/:id.
export const messageResponseSchema = z.strictObject({ message: messageSchema });

// Wire POST→PATCH body: PATCH /api/chats/:chatId/messages/:id.
// An edit only changes text; no modelId/attachment/retry.
export const editMessageBodySchema = z.strictObject({
  content: z.string().min(1),
});
export type EditMessageInput = z.infer<typeof editMessageBodySchema>;

// Wire POST body: POST /api/chats/:chatId/messages.
// Exactly one of three modes:
//   • new message      → { content, modelId, … }
//   • banner retry     → { retry: true, modelId }           (replay last user turn)
//   • resend/regenerate→ { fromMessageId, modelId }          (replay that user turn)
export const sendMessageBodySchema = z
  .strictObject({
    content: z.string().min(1).optional(),
    modelId: z.string().min(1),
    retry: z.boolean().optional(),
    fromMessageId: z.string().min(1).optional(),
    attachment: messageAttachmentSchema.optional(),
    enableWebSearch: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    const isReplay = body.retry === true || body.fromMessageId !== undefined;
    // 1. content required unless this is a replay.
    if (!isReplay && !body.content) {
      ctx.addIssue({
        code: 'custom',
        message: 'content is required unless retry or fromMessageId is set',
        path: ['content'],
      });
    }
    // 2. content must be omitted on a replay (it reuses the anchor's stored text).
    if (isReplay && body.content !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'content must be omitted when retry or fromMessageId is set',
        path: ['content'],
      });
    }
    // 3. retry and fromMessageId are two ways to name the same anchor — exclusive.
    if (body.retry === true && body.fromMessageId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'retry and fromMessageId are mutually exclusive',
        path: ['fromMessageId'],
      });
    }
  });

// Single source of truth for which Message fields are encrypted at rest.
// Imported by backend/src/repos/message.repo.ts as ENCRYPTED_FIELDS.
// Mirrors the NARRATIVE_FIELD_KEYS pattern from character.ts: adding an
// encrypted field here propagates to the repo's write+read paths.
export const MESSAGE_ENCRYPTED_FIELD_KEYS = ['content', 'attachmentJson', 'citationsJson'] as const;

// Subset of encrypted fields whose decrypted plaintext is itself JSON
// (object or array) — these get the JSON.stringify-before-encrypt /
// JSON.parse-after-decrypt round-trip in the repo. `content` is excluded
// because it's a plain string; serialising it would re-introduce the
// `"\"hello\""` storage jank the rename eliminates.
export const MESSAGE_JSON_PAYLOAD_FIELD_KEYS = ['attachmentJson', 'citationsJson'] as const;

export type Message = z.infer<typeof messageSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageBodySchema>;
export type MessageEncryptedFieldKey = (typeof MESSAGE_ENCRYPTED_FIELD_KEYS)[number];
export type MessageJsonPayloadFieldKey = (typeof MESSAGE_JSON_PAYLOAD_FIELD_KEYS)[number];
