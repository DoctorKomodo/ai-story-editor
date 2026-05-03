import { create } from 'zustand';

/**
 * Ephemeral UI state. Pure in-memory — defaults reset on every page load
 * by design (layout / focus mode are session affordances, not persistent
 * preferences).
 *
 * Persistent settings (theme, proseFont, AI params, model) live in the
 * TanStack Query cache via `useUserSettings`/`useUpdateUserSetting`, NOT
 * here. If you find yourself adding a field that should survive reloads,
 * it belongs in `UserSettings` instead.
 */

export type Layout = 'three-col' | 'nochat' | 'focus';

export interface UiState {
  layout: Layout;
  setLayout: (layout: Layout) => void;
}

export const useUiStore = create<UiState>((set) => ({
  layout: 'three-col',
  setLayout: (layout) => set({ layout }),
}));
