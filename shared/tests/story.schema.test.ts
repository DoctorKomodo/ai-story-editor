import { describe, expect, it } from 'vitest';
import {
  STORY_GENRE_MAX,
  STORY_SYNOPSIS_MAX,
  STORY_TITLE_MAX,
  STORY_WORLD_NOTES_MAX,
  storiesResponseSchema,
  storyCreateSchema,
  storyListItemSchema,
  storyResponseSchema,
  storySchema,
  storyUpdateSchema,
} from '../src/schemas/story';

const validStory = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'The First Draft',
  synopsis: 'A writer meets a deadline.',
  genre: 'literary',
  worldNotes: 'Set in a quiet town.',
  targetWords: 50000,
  includePreviousChaptersInPrompt: false,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T01:00:00.000Z',
};

const validListItem = { ...validStory, chapterCount: 3, totalWordCount: 425 };

describe('storySchema', () => {
  it('accepts a fully-populated valid story', () => {
    expect(() => storySchema.parse(validStory)).not.toThrow();
  });

  it('rejects unknown fields (strict) — notably userId', () => {
    expect(() => storySchema.parse({ ...validStory, userId: 'u1' })).toThrow();
  });

  it('rejects missing required title', () => {
    const { title: _title, ...rest } = validStory;
    expect(() => storySchema.parse(rest)).toThrow();
  });

  it('accepts null for synopsis, genre, worldNotes, targetWords', () => {
    expect(() =>
      storySchema.parse({
        ...validStory,
        synopsis: null,
        genre: null,
        worldNotes: null,
        targetWords: null,
      }),
    ).not.toThrow();
  });

  it('rejects non-ISO datetime in createdAt', () => {
    expect(() => storySchema.parse({ ...validStory, createdAt: 'not a date' })).toThrow();
  });

  it('rejects empty string id', () => {
    expect(() => storySchema.parse({ ...validStory, id: '' })).toThrow();
  });

  it('rejects a non-positive targetWords', () => {
    expect(() => storySchema.parse({ ...validStory, targetWords: 0 })).toThrow();
  });
});

describe('storyListItemSchema', () => {
  it('accepts a valid enriched list item', () => {
    expect(() => storyListItemSchema.parse(validListItem)).not.toThrow();
  });

  it('rejects a row missing the aggregates', () => {
    expect(() => storyListItemSchema.parse(validStory)).toThrow();
  });

  it('still rejects unknown keys (strict preserved through extend)', () => {
    expect(() => storyListItemSchema.parse({ ...validListItem, userId: 'u1' })).toThrow();
  });
});

describe('storyCreateSchema', () => {
  it('accepts minimal input (title only)', () => {
    expect(() => storyCreateSchema.parse({ title: 'Untitled' })).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => storyCreateSchema.parse({ title: '' })).toThrow();
  });

  it('rejects a title over STORY_TITLE_MAX', () => {
    expect(() => storyCreateSchema.parse({ title: 'x'.repeat(STORY_TITLE_MAX + 1) })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => storyCreateSchema.parse({ title: 'X', author: 'me' })).toThrow();
  });

  it('accepts all fields', () => {
    expect(() =>
      storyCreateSchema.parse({
        title: 'X',
        synopsis: 'a tale',
        genre: 'epic',
        worldNotes: 'notes',
        targetWords: 1000,
      }),
    ).not.toThrow();
  });
});

describe('storyUpdateSchema', () => {
  it('accepts empty input (all fields optional)', () => {
    expect(() => storyUpdateSchema.parse({})).not.toThrow();
  });

  it('accepts a single-field subset', () => {
    expect(() => storyUpdateSchema.parse({ genre: null })).not.toThrow();
  });

  it('still rejects unknown fields (strict preserved through partial)', () => {
    expect(() => storyUpdateSchema.parse({ author: 'me' })).toThrow();
  });
});

describe('response wrappers', () => {
  it('storyResponseSchema accepts { story }', () => {
    expect(() => storyResponseSchema.parse({ story: validStory })).not.toThrow();
  });

  it('storyResponseSchema rejects extra top-level fields', () => {
    expect(() => storyResponseSchema.parse({ story: validStory, foo: 1 })).toThrow();
  });

  it('storiesResponseSchema accepts { stories: [listItem] }', () => {
    expect(() => storiesResponseSchema.parse({ stories: [validListItem] })).not.toThrow();
  });

  it('storiesResponseSchema rejects base stories without aggregates', () => {
    expect(() => storiesResponseSchema.parse({ stories: [validStory] })).toThrow();
  });
});

describe('field-length cap constants', () => {
  it('match the legacy inline CreateStoryBody bounds', () => {
    expect(STORY_TITLE_MAX).toBe(500);
    expect(STORY_GENRE_MAX).toBe(200);
    expect(STORY_SYNOPSIS_MAX).toBe(10_000);
    expect(STORY_WORLD_NOTES_MAX).toBe(50_000);
  });
});

describe('includePreviousChaptersInPrompt toggle', () => {
  it('storyCreateSchema accepts includePreviousChaptersInPrompt as optional', () => {
    expect(() => storyCreateSchema.parse({ title: 'X' })).not.toThrow();
    expect(() =>
      storyCreateSchema.parse({ title: 'X', includePreviousChaptersInPrompt: true }),
    ).not.toThrow();
    expect(() =>
      storyCreateSchema.parse({ title: 'X', includePreviousChaptersInPrompt: false }),
    ).not.toThrow();
  });

  it('storyUpdateSchema accepts includePreviousChaptersInPrompt as optional', () => {
    expect(() => storyUpdateSchema.parse({})).not.toThrow();
    expect(() => storyUpdateSchema.parse({ includePreviousChaptersInPrompt: true })).not.toThrow();
  });

  it('storySchema requires includePreviousChaptersInPrompt on responses', () => {
    const { includePreviousChaptersInPrompt: _, ...withoutFlag } = validStory;
    expect(() => storySchema.parse(withoutFlag)).toThrow();
    expect(() =>
      storySchema.parse({ ...validStory, includePreviousChaptersInPrompt: true }),
    ).not.toThrow();
  });
});
