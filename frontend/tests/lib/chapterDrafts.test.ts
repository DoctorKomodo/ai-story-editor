import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  type ChapterDraft,
  deleteDraft,
  getDraft,
  putDraft,
  resolveDraftDecision,
} from '@/lib/chapterDrafts';

function draft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    userId: 'user-a',
    chapterId: 'ch-1',
    draftId: 'draft-1',
    storyId: 'story-1',
    bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    baseUpdatedAt: '2026-07-02T00:00:00.000Z',
    savedAt: Date.now(),
    ...overrides,
  };
}

describe('chapterDrafts', () => {
  it('round-trips a draft through put/get', async () => {
    const d = draft();
    await putDraft(d);
    const got = await getDraft(d.userId, d.chapterId, d.draftId);
    expect(got).toEqual(d);
  });

  it('returns null for a missing draft and isolates by userId', async () => {
    const d = draft({ userId: 'user-a', chapterId: 'ch-1', draftId: 'draft-1' });
    await putDraft(d);

    const otherUser = await getDraft('user-b', 'ch-1', 'draft-1');
    expect(otherUser).toBeNull();

    const missing = await getDraft('user-a', 'ch-does-not-exist', 'draft-1');
    expect(missing).toBeNull();
  });

  it('isolates two drafts of the same chapter as independent records', async () => {
    const a = draft({ chapterId: 'ch-shared', draftId: 'draft-a', bodyJson: { text: 'A' } });
    const b = draft({ chapterId: 'ch-shared', draftId: 'draft-b', bodyJson: { text: 'B' } });
    await putDraft(a);
    await putDraft(b);

    const gotA = await getDraft('user-a', 'ch-shared', 'draft-a');
    expect(gotA?.bodyJson).toEqual({ text: 'A' });

    const gotB = await getDraft('user-a', 'ch-shared', 'draft-b');
    expect(gotB?.bodyJson).toEqual({ text: 'B' });
  });

  it('deleteDraft removes the record', async () => {
    const d = draft({ userId: 'user-a', chapterId: 'ch-delete', draftId: 'draft-1' });
    await putDraft(d);
    expect(await getDraft(d.userId, d.chapterId, d.draftId)).not.toBeNull();

    await deleteDraft(d.userId, d.chapterId, d.draftId);
    expect(await getDraft(d.userId, d.chapterId, d.draftId)).toBeNull();
  });

  describe('resolveDraftDecision', () => {
    const T1 = '2026-07-02T00:00:00.000Z';
    const T2_LATER = '2026-07-02T00:05:00.000Z';

    it("offers when the server hasn't moved since the draft", () => {
      expect(resolveDraftDecision(draft({ baseUpdatedAt: T1 }), T1)).toBe('offer');
    });

    it('discards when the server moved past the draft (flush landed / other writer)', () => {
      expect(resolveDraftDecision(draft({ baseUpdatedAt: T1 }), T2_LATER)).toBe('discard');
    });
  });
});
