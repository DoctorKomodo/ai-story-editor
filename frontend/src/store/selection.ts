import { create } from 'zustand';

export interface SelectionValue {
  text: string;
  range: Range | null;
  rect: DOMRect | null;
}

export interface SelectionState {
  selection: SelectionValue | null;
  setSelection: (selection: SelectionValue | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
  clear: () => set({ selection: null }),
}));
