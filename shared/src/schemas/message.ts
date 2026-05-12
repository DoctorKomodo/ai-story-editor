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

// Wire/read shape. `content: z.string().min(1)` matches the write contract
// (sendMessageBodySchema also requires min(1)). Renamed from the legacy
// `contentJson` (the Json suffix was inherited from an earlier design that
// never materialised). The other two ciphertext fields keep their *Json
// names because they actually carry JSON payloads.
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string().min(1),
  attachmentJson: messageAttachmentSchema.nullable(),
  citationsJson: z.array(citationSchema).nullable(),
  model: z.string().nullable(),
  tokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export const messagesResponseSchema = z.strictObject({
  messages: z.array(messageSchema),
});

// Wire POST body: POST /api/chats/:chatId/messages.
// Replaces the inline `PostMessageBody` in chat.routes.ts byte-for-byte.
export const sendMessageBodySchema = z
  .strictObject({
    content: z.string().min(1).optional(),
    modelId: z.string().min(1),
    retry: z.boolean().optional(),
    attachment: messageAttachmentSchema.optional(),
    enableWebSearch: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.retry && !body.content) {
      ctx.addIssue({
        code: 'custom',
        message: 'content is required unless retry is true',
        path: ['content'],
      });
    }
    if (body.retry && body.content !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'content must be omitted when retry is true',
        path: ['content'],
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
