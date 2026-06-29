import type { Chapter, ChapterMeta } from 'story-editor-shared';

/**
 * Typed chapter-metadata fixture (list-endpoint shape, no body). The explicit
 * `: ChapterMeta` return annotation localizes schema drift to this factory.
 */
export function makeChapterMeta(overrides: Partial<ChapterMeta> = {}): ChapterMeta {
  return {
    id: 'c1',
    storyId: 's1',
    title: 'Opening',
    wordCount: 42,
    orderIndex: 0,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Typed full-chapter fixture (meta + TipTap body + summary). Built on
 * makeChapterMeta so the shared metadata fields stay defined in one place.
 */
export function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    ...makeChapterMeta(),
    bodyJson: { type: 'doc', content: [] },
    summary: null,
    summaryUpdatedAt: null,
    ...overrides,
  };
}
