import { describe, expect, it } from 'vitest';
import {
  CHAT_TITLE_MAX,
  CHAT_TITLE_MIN,
  chatCreateSchema,
  chatKindSchema,
  chatResponseSchema,
  chatSchema,
  chatSummarySchema,
  chatsResponseSchema,
  chatUpdateSchema,
} from '../src/schemas/chat';

const validChat = {
  id: 'cm0chat00000001',
  chapterId: 'cm0chap00000001',
  title: 'First-draft brainstorm',
  kind: 'ask' as const,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T01:00:00.000Z',
  lastActivityAt: '2026-05-15T02:00:00.000Z',
};

describe('chatKindSchema', () => {
  it('accepts "ask" and "scene"', () => {
    expect(() => chatKindSchema.parse('ask')).not.toThrow();
    expect(() => chatKindSchema.parse('scene')).not.toThrow();
  });
  it('rejects unknown kinds', () => {
    expect(() => chatKindSchema.parse('story')).toThrow();
  });
});

describe('chatSchema', () => {
  it('accepts a fully-populated valid chat', () => {
    expect(() => chatSchema.parse(validChat)).not.toThrow();
  });
  it('accepts null title', () => {
    expect(() => chatSchema.parse({ ...validChat, title: null })).not.toThrow();
  });
  it('rejects unknown fields (strict)', () => {
    expect(() => chatSchema.parse({ ...validChat, userId: 'u1' })).toThrow();
  });
  it('rejects messageCount on the bare chat shape', () => {
    expect(() => chatSchema.parse({ ...validChat, messageCount: 0 })).toThrow();
  });
  it('rejects non-ISO datetime', () => {
    expect(() => chatSchema.parse({ ...validChat, createdAt: 'not-a-date' })).toThrow();
  });
  it('rejects empty id', () => {
    expect(() => chatSchema.parse({ ...validChat, id: '' })).toThrow();
  });
});

describe('chatSummarySchema', () => {
  const validSummary = { ...validChat, messageCount: 3 };

  it('accepts chat + messageCount', () => {
    expect(() => chatSummarySchema.parse(validSummary)).not.toThrow();
  });
  it('rejects when messageCount missing', () => {
    expect(() => chatSummarySchema.parse(validChat)).toThrow();
  });
  it('rejects negative messageCount', () => {
    expect(() => chatSummarySchema.parse({ ...validSummary, messageCount: -1 })).toThrow();
  });
  it('rejects unknown keys (strictness preserved through .extend())', () => {
    expect(() => chatSummarySchema.parse({ ...validSummary, foo: 1 })).toThrow();
  });
});

describe('chatCreateSchema (POST body)', () => {
  it('accepts empty body (all optional)', () => {
    expect(() => chatCreateSchema.parse({})).not.toThrow();
  });
  it('accepts { title, kind }', () => {
    expect(() => chatCreateSchema.parse({ title: 'hi', kind: 'scene' })).not.toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => chatCreateSchema.parse({ chapterId: 'x' })).toThrow();
  });
  it('rejects bad kind', () => {
    expect(() => chatCreateSchema.parse({ kind: 'story' })).toThrow();
  });
});

describe('chatUpdateSchema (PATCH body)', () => {
  it('accepts a single-char title', () => {
    expect(() => chatUpdateSchema.parse({ title: 'a' })).not.toThrow();
  });
  it('rejects empty title', () => {
    expect(() => chatUpdateSchema.parse({ title: '' })).toThrow();
  });
  it(`rejects title > ${CHAT_TITLE_MAX} chars`, () => {
    expect(() => chatUpdateSchema.parse({ title: 'x'.repeat(CHAT_TITLE_MAX + 1) })).toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => chatUpdateSchema.parse({ title: 'ok', kind: 'ask' })).toThrow();
  });
  it('rejects null title (PATCH renames; clearing not supported on this endpoint)', () => {
    expect(() => chatUpdateSchema.parse({ title: null })).toThrow();
  });
});

describe('chatResponseSchema / chatsResponseSchema', () => {
  it('chatResponseSchema accepts { chat }', () => {
    expect(() => chatResponseSchema.parse({ chat: validChat })).not.toThrow();
  });
  it('chatResponseSchema rejects messageCount inside chat', () => {
    expect(() => chatResponseSchema.parse({ chat: { ...validChat, messageCount: 0 } })).toThrow();
  });
  it('chatsResponseSchema requires messageCount on every entry', () => {
    expect(() => chatsResponseSchema.parse({ chats: [validChat] })).toThrow();
  });
  it('chatsResponseSchema accepts entries with messageCount', () => {
    expect(() =>
      chatsResponseSchema.parse({ chats: [{ ...validChat, messageCount: 0 }] }),
    ).not.toThrow();
  });
});

describe('CHAT_TITLE_MIN constant', () => {
  it('equals 1', () => {
    expect(CHAT_TITLE_MIN).toBe(1);
  });
});
