import { create } from 'zustand';

export interface SelectedCharacterState {
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  reset: () => void;
}

const initialState: { selectedCharacterId: string | null } = {
  selectedCharacterId: null,
};

export const useSelectedCharacterStore = create<SelectedCharacterState>((set) => ({
  ...initialState,
  setSelectedCharacterId: (selectedCharacterId) => set({ selectedCharacterId }),
  reset: () => set(initialState),
}));
