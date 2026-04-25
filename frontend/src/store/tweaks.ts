import { create } from 'zustand';

export type Theme = 'paper' | 'sepia' | 'dark';
export type Layout = 'three-col' | 'nochat' | 'focus';
export type ProseFont = 'iowan' | 'palatino' | 'garamond' | 'plex-serif';

export interface TweaksValue {
  theme: Theme;
  layout: Layout;
  proseFont: ProseFont;
}

export interface TweaksState {
  tweaks: TweaksValue;
  setTweaks: (partial: Partial<TweaksValue>) => void;
}

const DEFAULT_TWEAKS: TweaksValue = {
  theme: 'paper',
  layout: 'three-col',
  proseFont: 'iowan',
};

export const useTweaksStore = create<TweaksState>((set) => ({
  tweaks: { ...DEFAULT_TWEAKS },
  setTweaks: (partial) => set((state) => ({ tweaks: { ...state.tweaks, ...partial } })),
}));
