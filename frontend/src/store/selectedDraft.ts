import { create } from 'zustand';

export interface SelectedDraft {
  chapterId: string;
  draftId: string;
}

/**
 * Which draft is being VIEWED in the editor — ephemeral UI state, distinct
 * from the persisted `Chapter.activeDraftId`. `selected === null` = follow
 * the chapter's active draft. Chapter-scoped pair (not a bare draft id) so
 * a selection made for another chapter is inert rather than racing the
 * chapter switch — EditorPage ignores a pair whose chapterId doesn't match
 * the open chapter, and clears stale pairs on chapter switch ([9wk.7] D1).
 */
export interface SelectedDraftState {
  selected: SelectedDraft | null;
  setSelectedDraft: (chapterId: string, draftId: string) => void;
  clearSelectedDraft: () => void;
  reset: () => void;
}

const initialState: { selected: SelectedDraft | null } = {
  selected: null,
};

export const useSelectedDraftStore = create<SelectedDraftState>((set) => ({
  ...initialState,
  setSelectedDraft: (chapterId, draftId) => set({ selected: { chapterId, draftId } }),
  clearSelectedDraft: () => set({ selected: null }),
  reset: () => set(initialState),
}));
