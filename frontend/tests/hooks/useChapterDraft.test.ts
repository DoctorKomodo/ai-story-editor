import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type UseChapterDraftArgs, useChapterDraft } from '@/hooks/useChapterDraft';
import { type ChapterDraft, getDraft, putDraft } from '@/lib/chapterDrafts';

const T1 = '2026-07-02T00:00:00.000Z';
const T2 = '2026-07-02T00:05:00.000Z';

function baseArgs(overrides: Partial<UseChapterDraftArgs> = {}): UseChapterDraftArgs {
  return {
    userId: 'user-a',
    storyId: 'story-1',
    chapterId: 'ch-1',
    draftId: 'draft-1',
    serverUpdatedAt: T1,
    serverLoaded: true,
    ...overrides,
  };
}

describe('useChapterDraft', () => {
  it('persistDraft writes a record carrying the current serverUpdatedAt as baseUpdatedAt', async () => {
    const { result } = renderHook((props: UseChapterDraftArgs) => useChapterDraft(props), {
      initialProps: baseArgs({
        chapterId: 'ch-persist',
        draftId: 'draft-persist',
        serverLoaded: false,
      }),
    });

    act(() => {
      result.current.persistDraft({ type: 'doc' });
    });

    await waitFor(async () => {
      const draft = await getDraft('user-a', 'ch-persist', 'draft-persist');
      expect(draft).not.toBeNull();
      expect(draft?.baseUpdatedAt).toBe(T1);
      expect(draft?.bodyJson).toEqual({ type: 'doc' });
    });
  });

  it('clearDraft deletes it', async () => {
    await putDraft({
      userId: 'user-a',
      chapterId: 'ch-clear',
      draftId: 'draft-clear',
      storyId: 'story-1',
      bodyJson: { type: 'doc' },
      baseUpdatedAt: T1,
      savedAt: Date.now(),
    });

    const { result } = renderHook((props: UseChapterDraftArgs) => useChapterDraft(props), {
      initialProps: baseArgs({
        chapterId: 'ch-clear',
        draftId: 'draft-clear',
        serverLoaded: false,
      }),
    });

    act(() => {
      result.current.clearDraft();
    });

    await waitFor(async () => {
      expect(await getDraft('user-a', 'ch-clear', 'draft-clear')).toBeNull();
    });
  });

  it('offers a draft whose baseUpdatedAt matches the current server updatedAt', async () => {
    await putDraft({
      userId: 'user-a',
      chapterId: 'ch-offer',
      draftId: 'draft-offer',
      storyId: 'story-1',
      bodyJson: { type: 'doc' },
      baseUpdatedAt: T1,
      savedAt: Date.now(),
    });

    const { result } = renderHook((props: UseChapterDraftArgs) => useChapterDraft(props), {
      initialProps: baseArgs({
        chapterId: 'ch-offer',
        draftId: 'draft-offer',
        serverUpdatedAt: T1,
        serverLoaded: true,
      }),
    });

    await waitFor(() => {
      expect(result.current.pendingDraft).not.toBeNull();
    });
    expect(result.current.pendingDraft?.chapterId).toBe('ch-offer');
    expect(result.current.pendingDraft?.draftId).toBe('draft-offer');
  });

  it('discards + deletes a stale draft whose server has moved past it', async () => {
    await putDraft({
      userId: 'user-a',
      chapterId: 'ch-stale',
      draftId: 'draft-stale',
      storyId: 'story-1',
      bodyJson: { type: 'doc' },
      baseUpdatedAt: T1,
      savedAt: Date.now(),
    });

    const { result } = renderHook((props: UseChapterDraftArgs) => useChapterDraft(props), {
      initialProps: baseArgs({
        chapterId: 'ch-stale',
        draftId: 'draft-stale',
        serverUpdatedAt: T2,
        serverLoaded: true,
      }),
    });

    await waitFor(async () => {
      expect(await getDraft('user-a', 'ch-stale', 'draft-stale')).toBeNull();
    });
    expect(result.current.pendingDraft).toBeNull();
  });

  it('acceptDraft returns and clears the pending draft; discardDraft clears state and deletes the record', async () => {
    await putDraft({
      userId: 'user-a',
      chapterId: 'ch-accept',
      draftId: 'draft-accept',
      storyId: 'story-1',
      bodyJson: { type: 'doc' },
      baseUpdatedAt: T1,
      savedAt: Date.now(),
    });

    const { result } = renderHook((props: UseChapterDraftArgs) => useChapterDraft(props), {
      initialProps: baseArgs({
        chapterId: 'ch-accept',
        draftId: 'draft-accept',
        serverUpdatedAt: T1,
        serverLoaded: true,
      }),
    });

    await waitFor(() => {
      expect(result.current.pendingDraft).not.toBeNull();
    });

    const accepted: { value: ChapterDraft | null } = { value: null };
    act(() => {
      accepted.value = result.current.acceptDraft();
    });
    expect(accepted.value?.chapterId).toBe('ch-accept');
    expect(result.current.pendingDraft).toBeNull();

    // The record itself still exists after accept — the caller re-persists
    // via the autosave dirty path, and a confirmed save clears it.
    expect(await getDraft('user-a', 'ch-accept', 'draft-accept')).not.toBeNull();

    act(() => {
      result.current.discardDraft();
    });
    expect(result.current.pendingDraft).toBeNull();
    await waitFor(async () => {
      expect(await getDraft('user-a', 'ch-accept', 'draft-accept')).toBeNull();
    });
  });
});
