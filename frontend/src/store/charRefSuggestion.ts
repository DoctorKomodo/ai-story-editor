import { create } from 'zustand';

export interface CharRefSuggestionItem {
  id: string;
  name: string;
  role?: string | null;
}

export interface CharRefSuggestionOpenInput {
  items: CharRefSuggestionItem[];
  query: string;
  clientRect: DOMRect | null;
  onSelect: (item: CharRefSuggestionItem) => void;
}

export interface CharRefSuggestionUpdateInput {
  items: CharRefSuggestionItem[];
  query: string;
  clientRect: DOMRect | null;
}

export interface CharRefSuggestionState {
  open: boolean;
  items: CharRefSuggestionItem[];
  activeIndex: number;
  query: string;
  clientRect: DOMRect | null;
  onSelect: ((item: CharRefSuggestionItem) => void) | null;
  openMenu: (input: CharRefSuggestionOpenInput) => void;
  updateItems: (input: CharRefSuggestionUpdateInput) => void;
  moveDown: () => void;
  moveUp: () => void;
  close: () => void;
}

const INITIAL = {
  open: false,
  items: [] as CharRefSuggestionItem[],
  activeIndex: 0,
  query: '',
  clientRect: null as DOMRect | null,
  onSelect: null as ((item: CharRefSuggestionItem) => void) | null,
};

export const useCharRefSuggestionStore = create<CharRefSuggestionState>((set, get) => ({
  ...INITIAL,
  openMenu: (input) =>
    set({
      open: true,
      items: input.items,
      activeIndex: 0,
      query: input.query,
      clientRect: input.clientRect,
      onSelect: input.onSelect,
    }),
  updateItems: (input) => {
    const { activeIndex } = get();
    set({
      items: input.items,
      activeIndex: input.items.length === 0 ? 0 : Math.min(activeIndex, input.items.length - 1),
      query: input.query,
      clientRect: input.clientRect,
    });
  },
  moveDown: () => {
    const { items, activeIndex } = get();
    if (items.length === 0) return;
    set({ activeIndex: (activeIndex + 1) % items.length });
  },
  moveUp: () => {
    const { items, activeIndex } = get();
    if (items.length === 0) return;
    set({ activeIndex: (activeIndex - 1 + items.length) % items.length });
  },
  close: () => set(INITIAL),
}));

export function resetCharRefSuggestionStore(): void {
  useCharRefSuggestionStore.setState(INITIAL);
}
