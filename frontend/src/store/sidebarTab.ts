import { create } from 'zustand';

export type SidebarTab = 'chapters' | 'cast' | 'outline';

export interface SidebarTabState {
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
}

export const useSidebarTabStore = create<SidebarTabState>((set) => ({
  sidebarTab: 'chapters',
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}));
