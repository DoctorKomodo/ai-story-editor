import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT_VERSION,
  exportSchema,
  importPlanRequestSchema,
  importPlanResponseSchema,
  importRequestSchema,
  importResultSchema,
  importSchema,
} from './transfer';

const minimal = {
  formatVersion: EXPORT_FORMAT_VERSION,
  app: 'inkwell',
  exportedAt: '2026-06-24T12:00:00.000Z',
  stories: [
    {
      title: 'S',
      chapters: [
        {
          title: 'C',
          orderIndex: 0,
          bodyJson: { type: 'doc', content: [] },
          summary: null,
          chats: [
            {
              title: null,
              kind: 'ask',
              messages: [
                {
                  role: 'user',
                  content: 'hi',
                  attachmentJson: null,
                  citationsJson: null,
                  model: null,
                  tokens: null,
                  latencyMs: null,
                  createdAt: '2026-06-24T12:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
      characters: [{ name: 'X', orderIndex: 0 }],
      outlineItems: [{ title: 'O', sub: null, status: 'todo', order: 0 }],
    },
  ],
};

describe('transfer schemas', () => {
  it('accepts a well-formed export tree', () => {
    expect(exportSchema.parse(minimal)).toBeTruthy();
  });
  it('rejects an unknown formatVersion', () => {
    expect(exportSchema.safeParse({ ...minimal, formatVersion: 99 }).success).toBe(false);
  });
  it('rejects a real v1 backup (formatVersion 1, chapters carrying status)', () => {
    // Pre-2.0 files are deliberately unsupported (spec §4). Pin the rejection
    // so a regression in how v1 files fail cannot ship silently.
    const v1 = {
      ...minimal,
      formatVersion: 1,
      stories: [
        {
          ...minimal.stories[0],
          chapters: [{ ...minimal.stories[0]!.chapters[0], status: 'draft' }],
        },
      ],
    };
    expect(importSchema.safeParse(v1).success).toBe(false);
  });
  it('rejects unknown top-level keys (strict)', () => {
    expect(exportSchema.safeParse({ ...minimal, settings: {} }).success).toBe(false);
  });
  it('importSchema is structurally the export schema', () => {
    expect(importSchema.safeParse(minimal).success).toBe(true);
  });
  it('importResultSchema validates a count summary (legacy shape, no outcomes)', () => {
    expect(
      importResultSchema.parse({
        imported: {
          stories: 1,
          chapters: 1,
          characters: 1,
          outlineItems: 1,
          chats: 1,
          messages: 1,
        },
      }),
    ).toBeTruthy();
  });

  it('a legacy v1 file with no id/snapshotUpdatedAt still validates', () => {
    expect(exportSchema.parse(minimal)).toBeTruthy();
    expect(minimal.stories[0]).not.toHaveProperty('id');
    expect(minimal.stories[0]).not.toHaveProperty('snapshotUpdatedAt');
  });

  it('story id + snapshotUpdatedAt round-trip when present', () => {
    const withMeta = {
      ...minimal,
      stories: [
        {
          ...minimal.stories[0],
          id: 'story-1',
          snapshotUpdatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    };
    const parsed = exportSchema.parse(withMeta);
    expect(parsed.stories[0]?.id).toBe('story-1');
    expect(parsed.stories[0]?.snapshotUpdatedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('importPlanRequestSchema accepts a bounded stories array', () => {
    expect(
      importPlanRequestSchema.parse({
        stories: [{ id: 'story-1', snapshotUpdatedAt: '2026-07-01T00:00:00.000Z' }],
      }),
    ).toBeTruthy();
  });

  it('importPlanRequestSchema rejects more than 1000 stories', () => {
    const stories = Array.from({ length: 1001 }, (_, i) => ({
      id: `story-${i}`,
      snapshotUpdatedAt: '2026-07-01T00:00:00.000Z',
    }));
    expect(importPlanRequestSchema.safeParse({ stories }).success).toBe(false);
  });

  it('importPlanResponseSchema accepts the three status values', () => {
    expect(
      importPlanResponseSchema.parse({
        stories: [
          { id: 'a', status: 'new' },
          { id: 'b', status: 'unchanged' },
          { id: 'c', status: 'conflict' },
        ],
      }),
    ).toBeTruthy();
  });

  it('importPlanResponseSchema rejects an unknown status', () => {
    expect(
      importPlanResponseSchema.safeParse({ stories: [{ id: 'a', status: 'bogus' }] }).success,
    ).toBe(false);
  });

  it('importRequestSchema accepts a file with resolutions', () => {
    expect(
      importRequestSchema.parse({
        file: minimal,
        resolutions: { 'story-1': 'replace', 'story-2': 'skip', 'story-3': 'create' },
      }),
    ).toBeTruthy();
  });

  it('importRequestSchema accepts a file with no resolutions', () => {
    expect(importRequestSchema.parse({ file: minimal })).toBeTruthy();
  });

  it('importRequestSchema resolutions enum rejects an unknown value', () => {
    expect(
      importRequestSchema.safeParse({
        file: minimal,
        resolutions: { 'story-1': 'delete' },
      }).success,
    ).toBe(false);
  });

  it('importResultSchema accepts outcomes when present', () => {
    expect(
      importResultSchema.parse({
        imported: {
          stories: 2,
          chapters: 0,
          characters: 0,
          outlineItems: 0,
          chats: 0,
          messages: 0,
        },
        outcomes: [
          { index: 0, action: 'created' },
          { index: 1, action: 'failed' },
        ],
      }),
    ).toBeTruthy();
  });
});
