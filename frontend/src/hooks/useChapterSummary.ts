import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChapterSummary } from 'story-editor-shared';
import { api } from '@/lib/api';
import { chapterQueryKey, chaptersQueryKey } from './useChapters';

export type SummaryState = 'missing' | 'current' | 'stale' | 'corrupted' | 'generating';

/**
 * Pure derivation from chapter detail flags + summary. The 'generating' variant
 * is decided at the call site by reading the mutation's isPending — not derivable
 * from data alone.
 */
export function deriveSummaryState(input: {
  hasSummary: boolean;
  summaryIsStale: boolean;
  summary: ChapterSummary | null;
}): Exclude<SummaryState, 'generating'> {
  if (!input.hasSummary) return 'missing';
  if (input.summary === null) return 'corrupted';
  return input.summaryIsStale ? 'stale' : 'current';
}

/**
 * List-row derivation. The chapters-list cache is metadata-only — it carries
 * `hasSummary` + `summaryIsStale` but NEVER the decrypted `summary`. The
 * `corrupted` state requires detail (the `hasSummary && summary === null`
 * disagreement, only the detail query observes it), so the list can only ever
 * surface missing / current / stale. Calling `deriveSummaryState` with a
 * hard-coded `summary: null` from the list would mislabel every summarised row
 * as `corrupted` — hence this separate, detail-free derivation.
 */
export function deriveListSummaryState(input: {
  hasSummary: boolean;
  summaryIsStale: boolean;
}): 'missing' | 'current' | 'stale' {
  if (!input.hasSummary) return 'missing';
  return input.summaryIsStale ? 'stale' : 'current';
}

/** POST /stories/:storyId/chapters/:chapterId/summarise — generate OR regenerate; same endpoint either way. */
export function useSummariseChapterMutation(chapterId: string, storyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      return api<{ summary: ChapterSummary; summaryUpdatedAt: string }>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}/summarise`,
        { method: 'POST', body: { modelId } },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chapterQueryKey(chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}

/** PUT /stories/:storyId/chapters/:chapterId/summary — user-edited summary. */
export function useUpdateChapterSummaryMutation(chapterId: string, storyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (summary: ChapterSummary) => {
      return api<{ summary: ChapterSummary; summaryUpdatedAt: string }>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}/summary`,
        { method: 'PUT', body: summary },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chapterQueryKey(chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}
