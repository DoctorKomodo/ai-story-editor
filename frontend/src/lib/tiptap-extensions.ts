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

import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

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
];
