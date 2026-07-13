import type { Chapter, ChapterMeta, Draft, DraftMeta } from 'story-editor-shared';

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
    draftCount: 1,
    activeDraftId: 'draft-1',
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

/**
 * Typed draft-metadata fixture (list-endpoint shape, no body). The explicit
 * `: DraftMeta` return annotation localizes schema drift to this factory.
 */
export function makeDraftMeta(overrides: Partial<DraftMeta> = {}): DraftMeta {
  return {
    id: 'draft-1',
    chapterId: 'c1',
    label: null,
    wordCount: 42,
    orderIndex: 0,
    isActive: true,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    chatCount: 0,
    ...overrides,
  };
}

/**
 * Typed full-draft fixture (meta + TipTap body + summary). Built on
 * makeDraftMeta so the shared metadata fields stay defined in one place.
 */
export function makeDraft(overrides: Partial<Draft> = {}): Draft {
  const { chatCount: _chatCount, ...core } = makeDraftMeta();
  return {
    ...core,
    bodyJson: { type: 'doc', content: [] },
    summary: null,
    summaryUpdatedAt: null,
    ...overrides,
  };
}
