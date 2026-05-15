import { describe, expect, it } from 'vitest';
import {
  OUTLINE_STATUS_MAX,
  OUTLINE_SUB_MAX,
  OUTLINE_TITLE_MAX,
  outlineCreateSchema,
  outlineItemResponseSchema,
  outlineItemSchema,
  outlineListResponseSchema,
  outlineReorderSchema,
  outlineUpdateSchema,
} from '../src/schemas/outline';

const validItem = {
  id: 'cm0outline00001',
  storyId: 'cm0story0000001',
  title: 'Chapter 1 — the call',
  sub: 'protagonist receives the inciting incident',
  status: 'active',
  order: 0,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T01:00:00.000Z',
};

describe('outlineItemSchema', () => {
  it('accepts a fully-populated valid item', () => {
    expect(() => outlineItemSchema.parse(validItem)).not.toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, userId: 'u1' })).toThrow();
  });

  it('accepts null sub', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, sub: null })).not.toThrow();
  });

  it('rejects negative order', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, order: -1 })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, id: '' })).toThrow();
  });

  it('rejects non-ISO datetime', () => {
    expect(() => outlineItemSchema.parse({ ...validItem, createdAt: 'not-a-date' })).toThrow();
  });
});

describe('outlineCreateSchema', () => {
  const validCreate = { title: 'New beat', sub: null, status: 'queued' };

  it('accepts a minimal valid body', () => {
    expect(() => outlineCreateSchema.parse(validCreate)).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, title: '' })).toThrow();
  });

  it(`rejects title over ${OUTLINE_TITLE_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, title: 'x'.repeat(OUTLINE_TITLE_MAX + 1) }),
    ).toThrow();
  });

  it(`rejects sub over ${OUTLINE_SUB_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, sub: 'x'.repeat(OUTLINE_SUB_MAX + 1) }),
    ).toThrow();
  });

  it(`rejects status over ${OUTLINE_STATUS_MAX} chars`, () => {
    expect(() =>
      outlineCreateSchema.parse({ ...validCreate, status: 'x'.repeat(OUTLINE_STATUS_MAX + 1) }),
    ).toThrow();
  });

  it('rejects empty status', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, status: '' })).toThrow();
  });

  it('rejects unknown keys — notably order (create must not set order)', () => {
    expect(() => outlineCreateSchema.parse({ ...validCreate, order: 0 })).toThrow();
  });

  it('accepts sub absent (undefined)', () => {
    const { sub: _sub, ...rest } = validCreate;
    expect(() => outlineCreateSchema.parse(rest)).not.toThrow();
  });
});

describe('outlineUpdateSchema', () => {
  it('accepts empty object', () => {
    expect(() => outlineUpdateSchema.parse({})).not.toThrow();
  });

  it('accepts any single-field subset', () => {
    expect(() => outlineUpdateSchema.parse({ title: 'x' })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ sub: null })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ status: 'done' })).not.toThrow();
    expect(() => outlineUpdateSchema.parse({ order: 5 })).not.toThrow();
  });

  it('rejects unknown keys (strictness preserved through .partial().extend())', () => {
    expect(() => outlineUpdateSchema.parse({ unknown: 1 })).toThrow();
  });

  it('rejects negative order', () => {
    expect(() => outlineUpdateSchema.parse({ order: -1 })).toThrow();
  });
});

describe('outlineReorderSchema', () => {
  const item = { id: 'a', order: 0 };

  it('accepts a single-item batch', () => {
    expect(() => outlineReorderSchema.parse({ items: [item] })).not.toThrow();
  });

  it('rejects an empty items array', () => {
    expect(() => outlineReorderSchema.parse({ items: [] })).toThrow();
  });

  it('rejects > 500 items', () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ id: `id-${i}`, order: i }));
    expect(() => outlineReorderSchema.parse({ items })).toThrow();
  });

  it('rejects unknown keys inside each item', () => {
    expect(() => outlineReorderSchema.parse({ items: [{ ...item, extra: 1 }] })).toThrow();
  });
});

describe('response schemas', () => {
  it('outlineItemResponseSchema wraps the entity', () => {
    expect(() => outlineItemResponseSchema.parse({ outlineItem: validItem })).not.toThrow();
  });

  it('outlineListResponseSchema wraps an array', () => {
    expect(() => outlineListResponseSchema.parse({ outline: [validItem] })).not.toThrow();
  });
});
