import { create } from 'zustand';

export interface ModelState {
  modelId: string | null;
  setModelId: (id: string | null) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  modelId: null,
  setModelId: (id) => set({ modelId: id }),
}));
