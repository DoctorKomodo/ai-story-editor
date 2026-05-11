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
  reset: () => void;
}

const initialState: { selection: SelectionValue | null } = {
  selection: null,
};

export const useSelectionStore = create<SelectionState>((set) => ({
  ...initialState,
  setSelection: (selection) => set({ selection }),
  /** Domain action: clear the current TipTap selection. For account-switch lifecycle reset, call `reset()` instead. */
  clear: () => set(initialState),
  reset: () => set(initialState),
}));
