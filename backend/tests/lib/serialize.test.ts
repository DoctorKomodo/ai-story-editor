import { messagesResponseSchema } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';
import { serializeCharacter, serializeMessage } from '../../src/lib/serialize';
import type { RepoMessage } from '../../src/repos/message.repo';

const dbRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Imogen',
  role: 'protagonist',
  age: '34',
  appearance: 'tall',
  personality: 'wry',
  voice: 'alto',
  backstory: 'widow',
  arc: 'insurgent',
  relationships: 'sister to Felix',
  orderIndex: 0,
  color: null,
  initial: null,
  createdAt: new Date('2026-05-11T00:00:00.000Z'),
  updatedAt: new Date('2026-05-11T01:00:00.000Z'),
};

describe('serializeCharacter()', () => {
  it('ISO-strings Date fields', () => {
    const wire = serializeCharacter(dbRow);
    expect(wire.createdAt).toBe('2026-05-11T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-11T01:00:00.000Z');
  });

  it('passes narrative + structural fields through unchanged', () => {
    const wire = serializeCharacter(dbRow);
    expect(wire.id).toBe(dbRow.id);
    expect(wire.name).toBe('Imogen');
    expect(wire.relationships).toBe('sister to Felix');
    expect(wire.orderIndex).toBe(0);
    expect(wire.color).toBeNull();
  });

  it('does not mutate the input row', () => {
    const snapshot = { ...dbRow, createdAt: dbRow.createdAt, updatedAt: dbRow.updatedAt };
    serializeCharacter(dbRow);
    expect(dbRow.createdAt).toEqual(snapshot.createdAt);
    expect(dbRow.updatedAt).toEqual(snapshot.updatedAt);
  });
});

describe('serializeMessage()', () => {
  // RepoMessage's TYPE omits chatId, but the runtime row from messageRepo
  // still carries it (projectDecrypted strips only ciphertext triples).
  // serializeMessage uses an explicit pick rather than spread specifically
  // to keep chatId out of the wire shape — this fixture deliberately
  // includes an extra chatId at runtime to lock that invariant.
  const dbRow = {
    id: 'msg-1',
    chatId: 'chat-extra-should-not-leak',
    role: 'user' as const,
    content: 'Hello',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
  } as unknown as RepoMessage;

  it('ISO-strings createdAt', () => {
    expect(serializeMessage(dbRow).createdAt).toBe('2026-05-12T00:00:00.000Z');
  });

  it('excludes chatId from the wire shape', () => {
    const wire = serializeMessage(dbRow) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('chatId');
  });

  it('produces a value that satisfies messagesResponseSchema egress validation', () => {
    expect(() =>
      messagesResponseSchema.parse({ messages: [serializeMessage(dbRow)] }),
    ).not.toThrow();
  });
});
