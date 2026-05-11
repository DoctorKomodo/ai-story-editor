import { create } from 'zustand';

export interface ActiveChapterState {
  activeChapterId: string | null;
  setActiveChapterId: (id: string | null) => void;
  reset: () => void;
}

const initialState: { activeChapterId: string | null } = {
  activeChapterId: null,
};

export const useActiveChapterStore = create<ActiveChapterState>((set) => ({
  ...initialState,
  setActiveChapterId: (activeChapterId) => set({ activeChapterId }),
  reset: () => set(initialState),
}));
