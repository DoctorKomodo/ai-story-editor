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
}

export const useAttachedSelectionStore = create<AttachedSelectionState>((set) => ({
  attachedSelection: null,
  setAttachedSelection: (attachedSelection) => set({ attachedSelection }),
  clear: () => set({ attachedSelection: null }),
}));
