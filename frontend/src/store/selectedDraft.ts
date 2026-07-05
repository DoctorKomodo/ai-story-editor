import { create } from 'zustand';

/**
 * Which draft is being VIEWED in the editor — ephemeral UI state, distinct
 * from the persisted `Chapter.activeDraftId`. `null` = follow the chapter's
 * active draft (the only reachable value until the 9wk.7 sidebar sets it).
 * Reset on chapter switch (EditorPage effect).
 */
export interface SelectedDraftState {
  selectedDraftId: string | null;
  setSelectedDraftId: (id: string | null) => void;
  reset: () => void;
}

const initialState: { selectedDraftId: string | null } = {
  selectedDraftId: null,
};

export const useSelectedDraftStore = create<SelectedDraftState>((set) => ({
  ...initialState,
  setSelectedDraftId: (selectedDraftId) => set({ selectedDraftId }),
  reset: () => set(initialState),
}));
