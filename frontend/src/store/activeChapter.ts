import { create } from 'zustand';

export interface ActiveChapterState {
  activeChapterId: string | null;
  setActiveChapterId: (id: string | null) => void;
}

export const useActiveChapterStore = create<ActiveChapterState>((set) => ({
  activeChapterId: null,
  setActiveChapterId: (activeChapterId) => set({ activeChapterId }),
}));
