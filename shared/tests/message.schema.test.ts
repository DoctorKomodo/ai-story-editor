import { describe, expect, it } from 'vitest';
import {
  citationSchema,
  MESSAGE_ENCRYPTED_FIELD_KEYS,
  MESSAGE_JSON_PAYLOAD_FIELD_KEYS,
  messageAttachmentSchema,
  messageRoleSchema,
  messageSchema,
  messagesResponseSchema,
  sendMessageBodySchema,
} from '../src/schemas/message';

const validCitation = {
  title: 'Some Article',
  url: 'https://example.com/article',
  snippet: 'A relevant excerpt from the article.',
  publishedAt: '2026-01-15T00:00:00.000Z',
};

const validAttachment = {
  selectionText: 'Selected passage from chapter.',
  chapterId: '550e8400-e29b-41d4-a716-446655440010',
};

const validMessage = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  role: 'user' as const,
  content: 'Hello, continue the story.',
  attachmentJson: validAttachment,
  citationsJson: [validCitation],
  model: null,
  tokens: null,
  latencyMs: null,
  createdAt: '2026-05-11T00:00:00.000Z',
};

describe('messageSchema', () => {
  it('parses a valid message row', () => {
    expect(() => messageSchema.parse(validMessage)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => messageSchema.parse({ ...validMessage, extra: 'field' })).toThrow();
  });

  it('rejects extra keys nested inside citationsJson items', () => {
    const badCitation = { ...validCitation, unknownKey: 'boom' };
    expect(() => messageSchema.parse({ ...validMessage, citationsJson: [badCitation] })).toThrow();
  });

  it('accepts null for nullable fields (attachmentJson, citationsJson, model, tokens, latencyMs)', () => {
    const minimal = {
      ...validMessage,
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
    };
    expect(() => messageSchema.parse(minimal)).not.toThrow();
  });

  it('accepts an assistant role', () => {
    expect(() => messageSchema.parse({ ...validMessage, role: 'assistant' })).not.toThrow();
  });

  it('accepts a system role', () => {
    expect(() => messageSchema.parse({ ...validMessage, role: 'system' })).not.toThrow();
  });

  it('rejects non-ISO datetime in createdAt', () => {
    expect(() => messageSchema.parse({ ...validMessage, createdAt: 'not a date' })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => messageSchema.parse({ ...validMessage, id: '' })).toThrow();
  });
});

describe('messageAttachmentSchema', () => {
  it('parses a valid attachment', () => {
    expect(() => messageAttachmentSchema.parse(validAttachment)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => messageAttachmentSchema.parse({ ...validAttachment, extra: 'field' })).toThrow();
  });

  it('rejects empty selectionText', () => {
    expect(() =>
      messageAttachmentSchema.parse({ ...validAttachment, selectionText: '' }),
    ).toThrow();
  });

  it('rejects empty chapterId', () => {
    expect(() => messageAttachmentSchema.parse({ ...validAttachment, chapterId: '' })).toThrow();
  });

  it('requires both selectionText and chapterId', () => {
    expect(() => messageAttachmentSchema.parse({ selectionText: 'text only' })).toThrow();
    expect(() => messageAttachmentSchema.parse({ chapterId: 'id-only' })).toThrow();
  });
});

describe('citationSchema', () => {
  it('parses a valid citation', () => {
    expect(() => citationSchema.parse(validCitation)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => citationSchema.parse({ ...validCitation, unknownKey: 'boom' })).toThrow();
  });

  it('accepts null for publishedAt', () => {
    expect(() => citationSchema.parse({ ...validCitation, publishedAt: null })).not.toThrow();
  });

  it('accepts a string for publishedAt', () => {
    expect(() =>
      citationSchema.parse({ ...validCitation, publishedAt: '2026-01-15' }),
    ).not.toThrow();
  });

  it('rejects missing fields', () => {
    const { title: _title, ...rest } = validCitation;
    expect(() => citationSchema.parse(rest)).toThrow();
  });
});

describe('messageRoleSchema', () => {
  it('accepts "user"', () => {
    expect(() => messageRoleSchema.parse('user')).not.toThrow();
  });

  it('accepts "assistant"', () => {
    expect(() => messageRoleSchema.parse('assistant')).not.toThrow();
  });

  it('accepts "system"', () => {
    expect(() => messageRoleSchema.parse('system')).not.toThrow();
  });

  it('rejects unknown role values', () => {
    expect(() => messageRoleSchema.parse('admin')).toThrow();
    expect(() => messageRoleSchema.parse('bot')).toThrow();
    expect(() => messageRoleSchema.parse('')).toThrow();
  });
});

describe('messagesResponseSchema', () => {
  it('round-trips { messages: [validMessage, validMessage] }', () => {
    const second = { ...validMessage, id: 'msg-2', role: 'assistant' as const };
    expect(() => messagesResponseSchema.parse({ messages: [validMessage, second] })).not.toThrow();
  });

  it('round-trips { messages: [] }', () => {
    expect(() => messagesResponseSchema.parse({ messages: [] })).not.toThrow();
  });

  it('rejects extra top-level keys', () => {
    expect(() => messagesResponseSchema.parse({ messages: [validMessage], extra: true })).toThrow();
  });
});

describe('sendMessageBodySchema superRefine', () => {
  const baseBody = { modelId: 'venice-model-1' };

  it('(retry=true, content=present) → fails', () => {
    expect(() =>
      sendMessageBodySchema.parse({ ...baseBody, retry: true, content: 'some content' }),
    ).toThrow();
  });

  it('(retry=false, content=missing) → fails', () => {
    expect(() => sendMessageBodySchema.parse({ ...baseBody, retry: false })).toThrow();
  });

  it('(retry=true, content=omitted) → passes', () => {
    expect(() => sendMessageBodySchema.parse({ ...baseBody, retry: true })).not.toThrow();
  });

  it('(retry=false, content=present) → passes', () => {
    expect(() =>
      sendMessageBodySchema.parse({ ...baseBody, retry: false, content: 'write more' }),
    ).not.toThrow();
  });

  it('(retry=undefined, content=present) → passes', () => {
    expect(() => sendMessageBodySchema.parse({ ...baseBody, content: 'write more' })).not.toThrow();
  });

  it('(retry=undefined, content=missing) → fails', () => {
    expect(() => sendMessageBodySchema.parse({ ...baseBody })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      sendMessageBodySchema.parse({ ...baseBody, content: 'text', unknownProp: true }),
    ).toThrow();
  });
});

describe('MESSAGE_ENCRYPTED_FIELD_KEYS', () => {
  it('is exactly ["content", "attachmentJson", "citationsJson"]', () => {
    expect(MESSAGE_ENCRYPTED_FIELD_KEYS).toEqual(['content', 'attachmentJson', 'citationsJson']);
  });
});

describe('MESSAGE_JSON_PAYLOAD_FIELD_KEYS', () => {
  it('is exactly ["attachmentJson", "citationsJson"]', () => {
    expect(MESSAGE_JSON_PAYLOAD_FIELD_KEYS).toEqual(['attachmentJson', 'citationsJson']);
  });
});
