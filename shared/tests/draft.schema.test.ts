import { describe, expect, it } from 'vitest';
import {
  activeDraftPutSchema,
  DRAFT_ENCRYPTED_FIELD_KEYS,
  draftCreateSchema,
  draftMetaSchema,
  draftSchema,
  draftUpdateSchema,
} from '../src';

const META = {
  id: 'd1',
  chapterId: 'c1',
  label: null,
  wordCount: 42,
  orderIndex: 0,
  isActive: true,
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-07-04T12:00:00.000Z',
  updatedAt: '2026-07-04T12:00:00.000Z',
};

describe('draft schemas', () => {
  it('draftMetaSchema requires chatCount and rejects ciphertext keys', () => {
    const withCount = { ...META, chatCount: 0 };
    expect(draftMetaSchema.parse(withCount)).toEqual(withCount);
    // chatCount is required on meta now
    expect(() => draftMetaSchema.parse(META)).toThrow();
    expect(() => draftMetaSchema.parse({ ...withCount, bodyCiphertext: 'x' })).toThrow();
  });

  it('draftSchema = core + bodyJson + summary + summaryUpdatedAt, and has NO chatCount (egress trap)', () => {
    const full = { ...META, bodyJson: { type: 'doc' }, summary: null, summaryUpdatedAt: null };
    expect(draftSchema.parse(full)).toEqual(full);
    // The egress-trap guard: a full Draft must NOT carry chatCount.
    expect(() => draftSchema.parse({ ...full, chatCount: 3 })).toThrow();
  });

  it('draftCreateSchema: fork|blank mode, optional label', () => {
    expect(draftCreateSchema.parse({ mode: 'fork' })).toEqual({ mode: 'fork' });
    expect(draftCreateSchema.parse({ mode: 'blank', label: 'darker take' })).toEqual({
      mode: 'blank',
      label: 'darker take',
    });
    expect(() => draftCreateSchema.parse({ mode: 'copy' })).toThrow();
  });

  it('draftCreateSchema: optional copyChats boolean', () => {
    expect(draftCreateSchema.parse({ mode: 'fork', copyChats: true })).toEqual({
      mode: 'fork',
      copyChats: true,
    });
    expect(draftCreateSchema.parse({ mode: 'fork' })).toEqual({ mode: 'fork' });
    expect(() => draftCreateSchema.parse({ mode: 'fork', copyChats: 'yes' })).toThrow();
  });

  it('draftUpdateSchema: bodyJson / label / expectedUpdatedAt all optional; label nullable', () => {
    expect(draftUpdateSchema.parse({})).toEqual({});
    expect(draftUpdateSchema.parse({ label: null })).toEqual({ label: null });
    expect(
      draftUpdateSchema.parse({ bodyJson: { type: 'doc' }, expectedUpdatedAt: META.updatedAt }),
    ).toEqual({ bodyJson: { type: 'doc' }, expectedUpdatedAt: META.updatedAt });
  });

  it('activeDraftPutSchema requires draftId', () => {
    expect(activeDraftPutSchema.parse({ draftId: 'd1' })).toEqual({ draftId: 'd1' });
    expect(() => activeDraftPutSchema.parse({})).toThrow();
  });

  it('DRAFT_ENCRYPTED_FIELD_KEYS names the three encrypted fields', () => {
    expect(DRAFT_ENCRYPTED_FIELD_KEYS).toEqual(['body', 'summaryJson', 'label']);
  });
});
