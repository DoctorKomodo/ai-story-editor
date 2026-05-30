import { describe, expect, it } from 'vitest';
import {
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  CHAPTER_SUMMARY_FIELD_MAX,
  CHAPTER_TITLE_MAX,
  CHAPTER_TITLE_MIN,
  chapterCreateSchema,
  chapterMetaSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chapterSchema,
  chapterStatusSchema,
  chapterSummaryJsonSchema,
  chapterSummaryResponseSchema,
  chapterSummarySchema,
  chaptersResponseSchema,
  chapterUpdateSchema,
} from '../src/schemas/chapter';

const VALID_META = {
  id: 'c1',
  storyId: 's1',
  title: 'Chapter One',
  wordCount: 0,
  orderIndex: 0,
  status: 'draft' as const,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  hasSummary: false,
  summaryIsStale: false,
};

describe('chapterStatusSchema', () => {
  it('accepts the three documented values', () => {
    expect(chapterStatusSchema.parse('draft')).toBe('draft');
    expect(chapterStatusSchema.parse('revision')).toBe('revision');
    expect(chapterStatusSchema.parse('final')).toBe('final');
  });

  it('rejects unknown status values', () => {
    expect(() => chapterStatusSchema.parse('archived')).toThrow();
    expect(() => chapterStatusSchema.parse('DRAFT')).toThrow();
    expect(() => chapterStatusSchema.parse(0)).toThrow();
  });
});

describe('chapterMetaSchema', () => {
  it('accepts a valid meta row', () => {
    expect(chapterMetaSchema.parse(VALID_META)).toEqual(VALID_META);
  });

  it('is strict — rejects unknown keys', () => {
    expect(() => chapterMetaSchema.parse({ ...VALID_META, bodyJson: { type: 'doc' } })).toThrow();
    expect(() => chapterMetaSchema.parse({ ...VALID_META, userId: 'u1' })).toThrow();
  });

  it('rejects non-datetime created/updated strings', () => {
    expect(() => chapterMetaSchema.parse({ ...VALID_META, createdAt: '' })).toThrow();
    expect(() => chapterMetaSchema.parse({ ...VALID_META, createdAt: 'yesterday' })).toThrow();
  });

  it('rejects negative wordCount or non-integer orderIndex', () => {
    expect(() => chapterMetaSchema.parse({ ...VALID_META, wordCount: -1 })).toThrow();
    expect(() => chapterMetaSchema.parse({ ...VALID_META, orderIndex: 1.5 })).toThrow();
  });
});

describe('chapterSchema', () => {
  it('accepts meta + bodyJson (full shape)', () => {
    const full = {
      ...VALID_META,
      bodyJson: { type: 'doc', content: [] },
      summary: null,
      summaryUpdatedAt: null,
    };
    expect(chapterSchema.parse(full)).toEqual(full);
  });

  it('accepts bodyJson: null (empty chapter)', () => {
    const full = { ...VALID_META, bodyJson: null, summary: null, summaryUpdatedAt: null };
    expect(chapterSchema.parse(full)).toEqual(full);
  });

  it('preserves strictness through .extend() — rejects keys beyond meta + bodyJson + summary fields', () => {
    expect(() =>
      chapterSchema.parse({
        ...VALID_META,
        bodyJson: null,
        summary: null,
        summaryUpdatedAt: null,
        userId: 'u1',
      }),
    ).toThrow();
  });

  it('rejects Story-side denormalisation drift (e.g. chapterCount)', () => {
    expect(() =>
      chapterSchema.parse({
        ...VALID_META,
        bodyJson: null,
        summary: null,
        summaryUpdatedAt: null,
        chapterCount: 1,
      }),
    ).toThrow();
  });
});

describe('chapterCreateSchema', () => {
  it('accepts title-only', () => {
    expect(chapterCreateSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
  });

  it('accepts title + bodyJson + status', () => {
    const input = { title: 'New', bodyJson: { type: 'doc' }, status: 'draft' as const };
    expect(chapterCreateSchema.parse(input)).toEqual(input);
  });

  it(`rejects title shorter than ${CHAPTER_TITLE_MIN} or longer than ${CHAPTER_TITLE_MAX}`, () => {
    expect(() => chapterCreateSchema.parse({ title: '' })).toThrow();
    expect(() => chapterCreateSchema.parse({ title: 'x'.repeat(CHAPTER_TITLE_MAX + 1) })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => chapterCreateSchema.parse({ title: 'New', orderIndex: 0 })).toThrow();
    expect(() => chapterCreateSchema.parse({ title: 'New', wordCount: 0 })).toThrow();
  });
});

describe('chapterUpdateSchema', () => {
  it('accepts every optional field individually', () => {
    expect(chapterUpdateSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
    expect(chapterUpdateSchema.parse({ bodyJson: { type: 'doc' } })).toEqual({
      bodyJson: { type: 'doc' },
    });
    expect(chapterUpdateSchema.parse({ status: 'final' })).toEqual({ status: 'final' });
    expect(chapterUpdateSchema.parse({ orderIndex: 3 })).toEqual({ orderIndex: 3 });
  });

  it('accepts an empty object (no-op update)', () => {
    expect(chapterUpdateSchema.parse({})).toEqual({});
  });

  it('rejects unknown keys including server-derived wordCount', () => {
    expect(() => chapterUpdateSchema.parse({ wordCount: 5 })).toThrow();
    expect(() => chapterUpdateSchema.parse({ id: 'c1' })).toThrow();
  });
});

describe('chapterReorderSchema', () => {
  it('accepts a non-empty array of {id, orderIndex} pairs', () => {
    const input = {
      chapters: [
        { id: 'c1', orderIndex: 0 },
        { id: 'c2', orderIndex: 1 },
      ],
    };
    expect(chapterReorderSchema.parse(input)).toEqual(input);
  });

  it('rejects empty arrays', () => {
    expect(() => chapterReorderSchema.parse({ chapters: [] })).toThrow();
  });

  it('rejects arrays over 500 items', () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, orderIndex: i }));
    expect(() => chapterReorderSchema.parse({ chapters: tooMany })).toThrow();
  });

  it('rejects extra keys on each item', () => {
    expect(() =>
      chapterReorderSchema.parse({
        chapters: [{ id: 'c1', orderIndex: 0, title: 'sneak' }],
      }),
    ).toThrow();
  });
});

describe('chapterResponseSchema / chaptersResponseSchema', () => {
  it('chapterResponseSchema wraps a full chapter', () => {
    const full = { ...VALID_META, bodyJson: null, summary: null, summaryUpdatedAt: null };
    expect(chapterResponseSchema.parse({ chapter: full })).toEqual({ chapter: full });
  });

  it('chapterResponseSchema rejects extra envelope keys', () => {
    expect(() =>
      chapterResponseSchema.parse({
        chapter: { ...VALID_META, bodyJson: null, summary: null, summaryUpdatedAt: null },
        ok: true,
      }),
    ).toThrow();
  });

  it('chaptersResponseSchema wraps an array of metas', () => {
    expect(chaptersResponseSchema.parse({ chapters: [VALID_META] })).toEqual({
      chapters: [VALID_META],
    });
  });

  it('chaptersResponseSchema rejects extra envelope keys', () => {
    expect(() => chaptersResponseSchema.parse({ chapters: [VALID_META], total: 1 })).toThrow();
  });

  it('chaptersResponseSchema rejects bodyJson on individual entries', () => {
    expect(() =>
      chaptersResponseSchema.parse({
        chapters: [{ ...VALID_META, bodyJson: { type: 'doc' } }],
      }),
    ).toThrow();
  });
});

describe('encrypted-field tuples', () => {
  it('exports both tuples with the expected members', () => {
    expect(CHAPTER_ENCRYPTED_FIELD_KEYS).toEqual(['title', 'body', 'summaryJson']);
    expect(CHAPTER_META_ENCRYPTED_FIELD_KEYS).toEqual(['title']);
  });
});

const VALID_SUMMARY = { events: 'A then B.', stateAtEnd: 'They are in C.', openThreads: 'Why D?' };

describe('chapterSummarySchema', () => {
  it('accepts a valid summary', () => {
    expect(chapterSummarySchema.parse(VALID_SUMMARY)).toEqual(VALID_SUMMARY);
  });
  it('is strict — rejects unknown keys', () => {
    expect(() => chapterSummarySchema.parse({ ...VALID_SUMMARY, foo: 'bar' })).toThrow();
  });
  it('enforces per-field max length', () => {
    const tooLong = 'x'.repeat(CHAPTER_SUMMARY_FIELD_MAX + 1);
    expect(() => chapterSummarySchema.parse({ ...VALID_SUMMARY, events: tooLong })).toThrow();
  });
  it('chapterSummaryJsonSchema produces the minimal OpenAI-safe wire shape', () => {
    const json = chapterSummaryJsonSchema();
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['events', 'stateAtEnd', 'openThreads']);
    const props = json.properties as Record<string, { description?: string; maxLength?: number }>;
    expect(typeof props.events?.description).toBe('string');
    expect(typeof props.stateAtEnd?.description).toBe('string');
    expect(typeof props.openThreads?.description).toBe('string');
    expect('$schema' in json).toBe(false);
    expect(props.events?.maxLength).toBeUndefined();
    expect(props.stateAtEnd?.maxLength).toBeUndefined();
    expect(props.openThreads?.maxLength).toBeUndefined();
  });
});

describe('chapterMetaSchema (summary flags)', () => {
  it('accepts hasSummary + summaryIsStale', () => {
    expect(() =>
      chapterMetaSchema.parse({
        id: 'c1',
        storyId: 's1',
        title: 't',
        wordCount: 0,
        orderIndex: 0,
        status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
        hasSummary: true,
        summaryIsStale: false,
      }),
    ).not.toThrow();
  });
  it('requires both summary flags', () => {
    expect(() =>
      chapterMetaSchema.parse({
        id: 'c1',
        storyId: 's1',
        title: 't',
        wordCount: 0,
        orderIndex: 0,
        status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('chapterSchema (summary + summaryUpdatedAt)', () => {
  it('accepts summary + summaryUpdatedAt nullable', () => {
    expect(() =>
      chapterSchema.parse({
        id: 'c1',
        storyId: 's1',
        title: 't',
        wordCount: 0,
        orderIndex: 0,
        status: 'draft',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
        hasSummary: false,
        summaryIsStale: false,
        bodyJson: null,
        summary: null,
        summaryUpdatedAt: null,
      }),
    ).not.toThrow();
  });
});

describe('chapterSummaryResponseSchema', () => {
  it('accepts a valid summary response with an ISO datetime summaryUpdatedAt', () => {
    const input = {
      summary: VALID_SUMMARY,
      summaryUpdatedAt: '2026-05-18T12:00:00.000Z',
    };
    expect(chapterSummaryResponseSchema.parse(input)).toEqual(input);
  });

  it('accepts summaryUpdatedAt: null', () => {
    const input = { summary: VALID_SUMMARY, summaryUpdatedAt: null };
    expect(chapterSummaryResponseSchema.parse(input)).toEqual(input);
  });

  it('rejects extra envelope keys (strictObject)', () => {
    expect(() =>
      chapterSummaryResponseSchema.parse({
        summary: VALID_SUMMARY,
        summaryUpdatedAt: null,
        ok: true,
      }),
    ).toThrow();
  });
});
