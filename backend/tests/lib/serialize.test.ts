import {
  messagesResponseSchema,
  outlineItemResponseSchema,
  storyResponseSchema,
} from 'story-editor-shared';
import { describe, expect, it } from 'vitest';
import {
  serializeCharacter,
  serializeMessage,
  serializeOutlineItem,
  serializeStory,
} from '../../src/lib/serialize';
import type { RepoCharacter } from '../../src/repos/character.repo';
import type { RepoMessage } from '../../src/repos/message.repo';
import type { RepoOutlineItem } from '../../src/repos/outline.repo';
import type { RepoStory } from '../../src/repos/story.repo';

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
    const snapshot = {
      ...dbRow,
      createdAt: new Date(dbRow.createdAt.getTime()),
      updatedAt: new Date(dbRow.updatedAt.getTime()),
    };
    serializeCharacter(dbRow);
    expect(dbRow).toEqual(snapshot);
  });

  it('excludes any stray runtime key from the wire shape (explicit pick)', () => {
    const rowWithExtra = {
      ...dbRow,
      leakedColumn: 'should not appear',
    } as unknown as RepoCharacter;
    const wire = serializeCharacter(rowWithExtra) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('leakedColumn');
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

describe('serializeStory()', () => {
  // RepoStory's TYPE omits userId, but the runtime row from storyRepo still
  // carries it (projectDecrypted strips only ciphertext triples). serializeStory
  // uses an explicit pick rather than spread specifically to keep userId out of
  // the wire shape — this fixture deliberately includes an extra userId at
  // runtime to lock that invariant.
  const dbRow = {
    id: 'story-1',
    userId: 'user-extra-should-not-leak',
    title: 'The First Draft',
    synopsis: 'A synopsis.',
    genre: 'literary',
    worldNotes: 'World notes.',
    targetWords: 50000,
    createdAt: new Date('2026-05-14T00:00:00.000Z'),
    updatedAt: new Date('2026-05-14T01:00:00.000Z'),
  } as unknown as RepoStory;

  it('ISO-strings Date fields', () => {
    const wire = serializeStory(dbRow);
    expect(wire.createdAt).toBe('2026-05-14T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-14T01:00:00.000Z');
  });

  it('excludes userId from the wire shape', () => {
    const wire = serializeStory(dbRow) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('userId');
  });

  it('produces a value that satisfies storyResponseSchema egress validation', () => {
    expect(() => storyResponseSchema.parse({ story: serializeStory(dbRow) })).not.toThrow();
  });
});

describe('serializeOutlineItem()', () => {
  // RepoOutlineItem omits no extra columns today, but use explicit pick to
  // match the established pattern across all four serialize* helpers. Also
  // locks the contract via a stray-key assertion.
  const validRow = {
    id: 'cm0outline00001',
    storyId: 'cm0story0000001',
    title: 'Chapter 1 — the call',
    sub: 'protagonist receives the inciting incident',
    status: 'active',
    order: 0,
    createdAt: new Date('2026-05-15T00:00:00.000Z'),
    updatedAt: new Date('2026-05-15T01:00:00.000Z'),
  };

  it('ISO-strings Date fields', () => {
    const wire = serializeOutlineItem(validRow);
    expect(wire.createdAt).toBe('2026-05-15T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-15T01:00:00.000Z');
  });

  it('passes narrative + structural fields through unchanged', () => {
    const wire = serializeOutlineItem(validRow);
    expect(wire.id).toBe(validRow.id);
    expect(wire.storyId).toBe(validRow.storyId);
    expect(wire.title).toBe(validRow.title);
    expect(wire.sub).toBe(validRow.sub);
    expect(wire.status).toBe(validRow.status);
    expect(wire.order).toBe(validRow.order);
  });

  it('does not mutate the input row', () => {
    const before = {
      ...validRow,
      createdAt: new Date(validRow.createdAt.getTime()),
      updatedAt: new Date(validRow.updatedAt.getTime()),
    };
    serializeOutlineItem(validRow);
    expect(validRow).toEqual(before);
  });

  it('excludes any stray runtime key from the wire shape (explicit pick)', () => {
    const rowWithExtra = {
      ...validRow,
      titleCiphertext: 'should-not-leak',
    } as unknown as RepoOutlineItem;
    const wire = serializeOutlineItem(rowWithExtra) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('titleCiphertext');
  });

  it('produces a value that satisfies outlineItemResponseSchema egress validation', () => {
    const wire = serializeOutlineItem(validRow);
    expect(() => outlineItemResponseSchema.parse({ outlineItem: wire })).not.toThrow();
  });
});
