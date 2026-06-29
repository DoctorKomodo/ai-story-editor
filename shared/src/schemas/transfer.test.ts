import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT_VERSION, exportSchema, importResultSchema, importSchema } from './transfer';

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
    expect(exportSchema.safeParse({ ...minimal, formatVersion: 2 }).success).toBe(false);
  });
  it('rejects unknown top-level keys (strict)', () => {
    expect(exportSchema.safeParse({ ...minimal, settings: {} }).success).toBe(false);
  });
  it('importSchema is structurally the export schema', () => {
    expect(importSchema.safeParse(minimal).success).toBe(true);
  });
  it('importResultSchema validates a count summary', () => {
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
});
