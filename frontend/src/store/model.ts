import { create } from 'zustand';

export interface ModelState {
  model: { id: string | null };
  setModelId: (id: string | null) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  model: { id: null },
  setModelId: (id) => set({ model: { id } }),
}));
