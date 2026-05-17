import { create } from 'zustand';
import type { SettingsTab } from '@/types/settings';

interface SettingsModalState {
  open: boolean;
  initialTab: SettingsTab | undefined;
  openWith: (tab?: SettingsTab) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  initialTab: undefined,
  openWith: (tab) => set({ open: true, initialTab: tab }),
  close: () => set({ open: false, initialTab: undefined }),
}));
