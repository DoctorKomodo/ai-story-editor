import { create } from 'zustand';

export interface AttachedSelectionChapter {
  id: string;
  number: number;
  title: string;
}

export interface AttachedSelectionValue {
  text: string;
  chapter: AttachedSelectionChapter;
}

export interface AttachedSelectionState {
  attachedSelection: AttachedSelectionValue | null;
  setAttachedSelection: (value: AttachedSelectionValue | null) => void;
  clear: () => void;
  reset: () => void;
}

const initialState: { attachedSelection: AttachedSelectionValue | null } = {
  attachedSelection: null,
};

export const useAttachedSelectionStore = create<AttachedSelectionState>((set) => ({
  ...initialState,
  setAttachedSelection: (attachedSelection) => set({ attachedSelection }),
  /** Domain action: detach the current selection. For account-switch lifecycle reset, call `reset()` instead. */
  clear: () => set(initialState),
  reset: () => set(initialState),
}));
