// [F31] Shared TipTap extension list used by the FormatBar harness, tests,
// and (after F32 refactors `Editor.tsx`) the production editor mount.
//
// StarterKit at @tiptap/* v2.27 bundles Bold / Italic / Strike / Heading /
// BulletList / OrderedList / Blockquote / History but NOT Underline / Link /
// Highlight, so those are added explicitly below.
//
// `openOnClick: false` keeps clicks inside the editor from navigating away
// while editing; the link is reachable via `target="_blank"` from preview /
// export contexts. `rel="noopener noreferrer"` is the usual defensive pair.
//
// [F35] Adds a custom `aiContinuation` mark used by the continue-writing
// affordance to tint inserted prose with `var(--ai)` until the user
// explicitly commits it as plain prose (Keep) or discards it.

import { Mark, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiContinuation: {
      setAIContinuation: () => ReturnType;
      unsetAIContinuation: () => ReturnType;
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

export const formatBarExtensions = [
  StarterKit,
  Underline,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      rel: 'noopener noreferrer',
      target: '_blank',
    },
  }),
  Highlight,
  AIContinuation,
];
