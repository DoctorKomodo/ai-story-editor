import { create } from 'zustand';

export interface ActiveChapterState {
  activeChapterId: string | null;
  setActiveChapterId: (id: string | null) => void;
  reset: () => void;
}

const initialState: { activeChapterId: string | null } = {
  activeChapterId: null,
};

export const useActiveChapterStore = create<ActiveChapterState>((set) => ({
  ...initialState,
  setActiveChapterId: (activeChapterId) => set({ activeChapterId }),
  reset: () => set(initialState),
}));

export function resolveActiveChapterId(
  chapters: { id: string; orderIndex: number }[],
  currentId: string | null,
): string | null {
  if (currentId !== null && chapters.some((c) => c.id === currentId)) return currentId;
  const first = [...chapters].sort((a, b) => a.orderIndex - b.orderIndex)[0];
  return first?.id ?? null;
}
