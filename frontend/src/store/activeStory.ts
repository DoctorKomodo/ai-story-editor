import { create } from 'zustand';

export interface ActiveStoryState {
  activeStoryId: string | null;
  setActiveStoryId: (id: string | null) => void;
}

export const useActiveStoryStore = create<ActiveStoryState>((set) => ({
  activeStoryId: null,
  setActiveStoryId: (activeStoryId) => set({ activeStoryId }),
}));
