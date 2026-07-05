import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ChapterDraft,
  deleteDraft,
  getDraft,
  putDraft,
  resolveDraftDecision,
} from '@/lib/chapterDrafts';

export interface UseChapterDraftArgs {
  userId: string | null;
  storyId: string | null;
  chapterId: string | null;
  draftId: string | null;
  /** draftQuery.data?.updatedAt ?? null. */
  serverUpdatedAt: string | null;
  /** draftQuery.data !== undefined. */
  serverLoaded: boolean;
}

export interface UseChapterDraftResult {
  /** Non-null → render the restore banner. */
  pendingDraft: ChapterDraft | null;
  /** Wire to `useAutosave`'s `onDirty`. */
  persistDraft: (bodyJson: unknown) => void;
  /** Wire to `useAutosave`'s `onSaved`. */
  clearDraft: () => void;
  /** Returns the pending draft and clears the banner state. */
  acceptDraft: () => ChapterDraft | null;
  /** Deletes the record and clears the banner state. */
  discardDraft: () => void;
}

/**
 * Owns the local-draft lifecycle for the currently active chapter: persist on
 * dirty, clear on confirmed save, and — on chapter load — decide whether a
 * newer-than-server draft should be offered for restore.
 *
 * `persistDraft`/`clearDraft` have stable identity (read the latest args via
 * a ref) so they can be passed directly as `useAutosave` callbacks without
 * retriggering its effect on every chapter-context change.
 */
export function useChapterDraft(args: UseChapterDraftArgs): UseChapterDraftResult {
  const [pendingDraft, setPendingDraft] = useState<ChapterDraft | null>(null);

  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  const persistDraft = useCallback((bodyJson: unknown) => {
    const { userId, storyId, chapterId, draftId, serverUpdatedAt } = argsRef.current;
    if (
      userId === null ||
      storyId === null ||
      chapterId === null ||
      draftId === null ||
      serverUpdatedAt === null
    ) {
      return;
    }
    void putDraft({
      userId,
      storyId,
      chapterId,
      draftId,
      bodyJson,
      baseUpdatedAt: serverUpdatedAt,
      savedAt: Date.now(),
    });
  }, []);

  const clearDraft = useCallback(() => {
    const { userId, chapterId, draftId } = argsRef.current;
    if (userId === null || chapterId === null || draftId === null) return;
    void deleteDraft(userId, chapterId, draftId);
  }, []);

  const acceptDraft = useCallback((): ChapterDraft | null => {
    setPendingDraft(null);
    return pendingDraft;
  }, [pendingDraft]);

  const discardDraft = useCallback(() => {
    setPendingDraft(null);
    const { userId, chapterId, draftId } = argsRef.current;
    if (userId === null || chapterId === null || draftId === null) return;
    void deleteDraft(userId, chapterId, draftId);
  }, []);

  const { userId, chapterId, draftId, serverLoaded } = args;

  // Guards a late IDB resolve landing after the draft has already switched
  // again — same pattern as EditorPage's `seededForDraftIdRef`.
  const currentDraftKeyRef = useRef<string | null>(null);
  useEffect(() => {
    setPendingDraft(null);
    if (userId === null || chapterId === null || draftId === null || !serverLoaded) return;

    const key = `${userId}:${chapterId}:${draftId}`;
    currentDraftKeyRef.current = key;

    void (async () => {
      const draft = await getDraft(userId, chapterId, draftId);
      if (currentDraftKeyRef.current !== key) return;
      if (draft === null) return;
      const decision = resolveDraftDecision(draft, argsRef.current.serverUpdatedAt ?? '');
      if (decision === 'offer') {
        setPendingDraft(draft);
      } else {
        void deleteDraft(userId, chapterId, draftId);
      }
    })();
    // serverUpdatedAt is read fresh via argsRef inside the async callback —
    // including it here would re-run the lookup on every save, not just on
    // draft switch.
  }, [userId, chapterId, draftId, serverLoaded]);

  return { pendingDraft, persistDraft, clearDraft, acceptDraft, discardDraft };
}
