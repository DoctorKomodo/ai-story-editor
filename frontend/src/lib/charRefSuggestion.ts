import { type Editor, Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';

export interface CharRefSuggestionItem {
  id: string;
  name: string;
  role: string | null;
}

const MAX_ITEMS = 8;

let provider: (() => CharRefSuggestionItem[]) | null = null;

export function setCharRefSuggestionProvider(fn: (() => CharRefSuggestionItem[]) | null): void {
  provider = fn;
}

export function __getCharRefSuggestionProvider(): () => CharRefSuggestionItem[] {
  return () => (provider ? provider() : []);
}

export function filterCharacters(
  characters: ReadonlyArray<CharRefSuggestionItem>,
  query: string,
): CharRefSuggestionItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return characters.slice(0, MAX_ITEMS);
  }
  const scored = characters
    .map((c) => {
      const lower = c.name.toLowerCase();
      if (lower.startsWith(q)) return { c, score: 0 };
      if (lower.includes(q)) return { c, score: 1 };
      return { c, score: 2 };
    })
    .filter((entry) => entry.score < 2)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.c.name.localeCompare(b.c.name);
    });
  return scored.slice(0, MAX_ITEMS).map((entry) => entry.c);
}

interface CommandProps {
  editor: Editor;
  range: { from: number; to: number };
  props: CharRefSuggestionItem;
}

const suggestionConfig: Omit<SuggestionOptions<CharRefSuggestionItem>, 'editor'> = {
  char: '@',
  startOfLine: false,
  allowSpaces: false,

  items: ({ query }) => {
    const characters = provider ? provider() : [];
    return filterCharacters(characters, query);
  },

  command: ({ editor, range, props }: CommandProps) => {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: 'text',
          text: props.name,
          marks: [{ type: 'charRef', attrs: { characterId: props.id } }],
        },
        { type: 'text', text: ' ' },
      ])
      .run();
  },

  render: () => {
    return {
      onStart: (props) => {
        useCharRefSuggestionStore.getState().openMenu({
          items: props.items,
          query: props.query,
          clientRect: props.clientRect ? props.clientRect() : null,
          onSelect: (item) => {
            props.command(item);
          },
        });
      },
      onUpdate: (props) => {
        useCharRefSuggestionStore.getState().updateItems({
          items: props.items,
          query: props.query,
          clientRect: props.clientRect ? props.clientRect() : null,
        });
        useCharRefSuggestionStore.setState({
          onSelect: (item) => props.command(item),
        });
      },
      onKeyDown: (props) => {
        const state = useCharRefSuggestionStore.getState();
        if (props.event.key === 'ArrowDown') {
          state.moveDown();
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          state.moveUp();
          return true;
        }
        if (props.event.key === 'Enter' || props.event.key === 'Tab') {
          const item = state.items[state.activeIndex];
          if (item && state.onSelect) {
            state.onSelect(item);
            return true;
          }
          return false;
        }
        if (props.event.key === 'Escape') {
          state.close();
          return true;
        }
        return false;
      },
      onExit: () => {
        useCharRefSuggestionStore.getState().close();
      },
    };
  },
};

export const CharRefSuggestion = Extension.create({
  name: 'charRefSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
      }),
    ];
  },
});
