import type { Character } from 'story-editor-shared';

/**
 * Typed Character fixture. The explicit `: Character` return annotation is
 * load-bearing: when characterSchema gains a required field, this single
 * factory fails to compile — not the dozens of call sites that consume it.
 * Override any field via the partial param.
 */
export function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    storyId: 'story-1',
    name: 'Elena',
    role: 'Protagonist',
    age: '32',
    appearance: 'Tall, with auburn hair',
    voice: 'Measured and warm',
    arc: 'From doubt to conviction',
    personality: 'Curious',
    backstory: null,
    relationships: null,
    color: null,
    initial: null,
    orderIndex: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}
