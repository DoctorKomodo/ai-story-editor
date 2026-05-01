import { create } from 'zustand';

export interface SelectedCharacterState {
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
}

export const useSelectedCharacterStore = create<SelectedCharacterState>((set) => ({
  selectedCharacterId: null,
  setSelectedCharacterId: (selectedCharacterId) => set({ selectedCharacterId }),
}));
