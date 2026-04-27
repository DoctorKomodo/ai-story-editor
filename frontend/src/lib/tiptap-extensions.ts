// [F31] Shared TipTap extension list used by the FormatBar harness, tests,
// and (after F32 refactors `Editor.tsx`) the production editor mount.
//
// StarterKit at @tiptap/* v3 bundles Bold / Italic / Strike / Heading /
// BulletList / OrderedList / Blockquote / UndoRedo / Link / Underline.
// Highlight is still a separate package and is added explicitly below.
//
// `openOnClick: false` keeps clicks inside the editor from navigating away
// while editing; the link is reachable via `target="_blank"` from preview /
// export contexts. `rel="noopener noreferrer"` is the usual defensive pair.
//
// [F35] Adds a custom `aiContinuation` mark used by the continue-writing
// affordance to tint inserted prose with `var(--ai)` until the user
// explicitly commits it as plain prose (Keep) or discards it.
//
// [F36] Adds a custom `charRef` mark linking a text run to a character by id.
// The mark renders as a `<span class="char-ref" data-character-id="...">`,
// styled in `index.css` with a 1px dotted underline and `cursor: help`.
// Persists in `chapters.bodyJson` via TipTap's normal mark serialization —
// no separate table. The hover popover ([F37]) subscribes via the
// `useCharRefHoverDispatcher` hook below, which delegates `mouseover`/
// `mouseout` listeners on `document` so it works regardless of where the
// editor is mounted.

import { Mark, mergeAttributes } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { CharRefSuggestion } from '@/lib/charRefSuggestion';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiContinuation: {
      setAIContinuation: () => ReturnType;
      unsetAIContinuation: () => ReturnType;
    };
    charRef: {
      setCharRef: (attrs: { characterId: string }) => ReturnType;
      unsetCharRef: () => ReturnType;
    };
  }
}

export const AIContinuation = Mark.create({
  name: 'aiContinuation',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span.ai-continuation' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'ai-continuation' }), 0];
  },
  addCommands() {
    return {
      setAIContinuation:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetAIContinuation:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const CharRef = Mark.create({
  name: 'charRef',
  inclusive: false,
  addAttributes() {
    return {
      characterId: {
        default: null as string | null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-character-id'),
        renderHTML: (attributes: { characterId: string | null }): Record<string, string> => {
          if (!attributes.characterId) return {};
          return { 'data-character-id': attributes.characterId };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span.char-ref[data-character-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'char-ref' }), 0];
  },
  addCommands() {
    return {
      setCharRef:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetCharRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export interface CharRefHoverEvent {
  characterId: string;
  anchorEl: HTMLElement;
}

/**
 * [F36] Document-delegated hover dispatcher for `charRef` spans.
 * The popover ([F37]) subscribes here without needing a TipTap handle —
 * any `.char-ref[data-character-id]` element in the document fires the
 * callback on `mouseover`, and a `mouseout` whose `relatedTarget` is
 * outside the span fires `null` so the popover can hide.
 */
export function useCharRefHoverDispatcher(
  onHover: (event: CharRefHoverEvent | null) => void,
): void {
  useEffect(() => {
    const handleEnter = (e: MouseEvent): void => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const span = target.closest('.char-ref');
      if (!(span instanceof HTMLElement)) return;
      const characterId = span.dataset.characterId;
      if (!characterId) return;
      onHover({ characterId, anchorEl: span });
    };
    const handleLeave = (e: MouseEvent): void => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const span = target.closest('.char-ref');
      if (!(span instanceof HTMLElement)) return;
      const related = e.relatedTarget;
      if (related instanceof HTMLElement && related.closest('.char-ref') === span) return;
      onHover(null);
    };
    document.addEventListener('mouseover', handleEnter);
    document.addEventListener('mouseout', handleLeave);
    return () => {
      document.removeEventListener('mouseover', handleEnter);
      document.removeEventListener('mouseout', handleLeave);
    };
  }, [onHover]);
}

export const formatBarExtensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    },
  }),
  Highlight,
  AIContinuation,
  CharRef,
  CharRefSuggestion,
];
