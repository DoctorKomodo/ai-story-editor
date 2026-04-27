// [F66] Editor input rules — smart quotes + em-dash via getTypographyExtensions.
//
// Mirrors the structural assertions from tests/lib/tiptap-typography.test.ts
// at the component-test layer for the verify command path.

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { getTypographyExtensions } from '@/lib/tiptap-typography';

function makeEditor(opts: { smartQuotes: boolean; emDashExpansion: boolean }): Editor {
  return new Editor({
    extensions: [StarterKit, ...getTypographyExtensions(opts)],
    content: '',
  });
}

describe('Editor input rules (F66)', () => {
  it('mounts cleanly with smart quotes + em-dash on', () => {
    const editor = makeEditor({ smartQuotes: true, emDashExpansion: true });
    editor.commands.setContent('hello');
    expect(editor.getText()).toContain('hello');
    editor.destroy();
  });

  it('exposes the inkwellSmartQuotes extension when smartQuotes is on', () => {
    const exts = getTypographyExtensions({ smartQuotes: true, emDashExpansion: false });
    expect(exts.find((e) => e.name === 'inkwellSmartQuotes')).toBeDefined();
  });

  it('exposes the inkwellEmDash extension when emDashExpansion is on', () => {
    const exts = getTypographyExtensions({ smartQuotes: false, emDashExpansion: true });
    expect(exts.find((e) => e.name === 'inkwellEmDash')).toBeDefined();
  });

  it('returns no extensions when both flags are off', () => {
    const exts = getTypographyExtensions({ smartQuotes: false, emDashExpansion: false });
    expect(exts).toHaveLength(0);
  });
});
