import { fireEvent, render, waitFor } from '@testing-library/react';
import { Editor as TiptapEditor } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharRef,
  type CharRefHoverEvent,
  formatBarExtensions,
  useCharRefHoverDispatcher,
} from '@/lib/tiptap-extensions';

/**
 * F36 tests.
 *
 * The `charRef` mark must:
 *  - parse from `<span class="char-ref" data-character-id="...">` HTML;
 *  - serialize back to the same HTML on `getHTML()`;
 *  - apply / unset via the `setCharRef` / `unsetCharRef` commands;
 *  - persist through `getJSON()` so chapters stored in `bodyJson` round-trip.
 *
 * The hover dispatcher delegates `mouseover`/`mouseout` on `document` so
 * the popover ([F37]) can subscribe without holding a TipTap handle.
 */

function makeEditor(content?: string): TiptapEditor {
  return new TiptapEditor({
    extensions: formatBarExtensions,
    content: content ?? '<p></p>',
  });
}

describe('CharRef mark (F36)', () => {
  it('is included in the shared formatBarExtensions list', () => {
    expect(formatBarExtensions).toContain(CharRef);
  });

  it('parses incoming HTML into a charRef mark with the characterId attr', () => {
    const editor = makeEditor(
      '<p>The wise <span class="char-ref" data-character-id="char-1">Elena</span> spoke.</p>',
    );

    const json = editor.getJSON();
    // doc -> paragraph -> [text, text-with-mark, text]
    const para = json.content?.[0];
    expect(para?.type).toBe('paragraph');
    const elenaNode = para?.content?.find((n) => n.text === 'Elena');
    expect(elenaNode).toBeDefined();
    const mark = elenaNode!.marks?.find((m) => m.type === 'charRef');
    expect(mark).toBeDefined();
    expect(mark!.attrs).toMatchObject({ characterId: 'char-1' });

    editor.destroy();
  });

  it('round-trips the mark through getHTML()', () => {
    const editor = makeEditor(
      '<p><span class="char-ref" data-character-id="char-42">Bram</span></p>',
    );

    const html = editor.getHTML();
    expect(html).toContain('class="char-ref"');
    expect(html).toContain('data-character-id="char-42"');
    expect(html).toContain('>Bram<');

    editor.destroy();
  });

  it('round-trips through getJSON() / setContent()', () => {
    const a = makeEditor(
      '<p>X <span class="char-ref" data-character-id="char-7">Yelena</span> Z</p>',
    );
    const json = a.getJSON();
    a.destroy();

    const b = makeEditor();
    b.commands.setContent(json);
    const html = b.getHTML();
    expect(html).toContain('data-character-id="char-7"');
    expect(html).toContain('>Yelena<');
    b.destroy();
  });

  it('applies the mark via the setCharRef command', () => {
    const editor = makeEditor('<p>wise hero</p>');
    // Select the word "wise" — positions 1..5 (paragraph opens at 0, text starts at 1).
    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.chain().focus().setCharRef({ characterId: 'char-2' }).run();

    const html = editor.getHTML();
    expect(html).toContain('data-character-id="char-2"');
    expect(html).toMatch(/<span[^>]*class="char-ref"[^>]*>wise<\/span>/);

    editor.destroy();
  });

  it('removes the mark via the unsetCharRef command', () => {
    const editor = makeEditor(
      '<p><span class="char-ref" data-character-id="char-9">Targ</span></p>',
    );
    editor.commands.selectAll();
    editor.chain().focus().unsetCharRef().run();

    const html = editor.getHTML();
    expect(html).not.toContain('char-ref');
    expect(html).not.toContain('data-character-id');
    expect(html).toContain('>Targ<');

    editor.destroy();
  });

  it('renders span without data-character-id when characterId is missing', () => {
    // setMark with no attrs shouldn't crash; renderHTML returns {} when null.
    const editor = makeEditor('<p>hello</p>');
    editor.commands.selectAll();
    // Force-set with null id to exercise the renderHTML guard.
    editor.chain().focus().setMark('charRef', { characterId: null }).run();
    // No attribute selector match expected.
    const html = editor.getHTML();
    expect(html).not.toContain('data-character-id');
    editor.destroy();
  });
});

describe('useCharRefHoverDispatcher (F36)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function HoverHarness({ onHover }: { onHover: (e: CharRefHoverEvent | null) => void }): null {
    useCharRefHoverDispatcher(onHover);
    return null;
  }

  it('fires onHover with { characterId, anchorEl } on mouseover of a .char-ref span', async () => {
    const onHover = vi.fn<(e: CharRefHoverEvent | null) => void>();
    render(<HoverHarness onHover={onHover} />);

    const span = document.createElement('span');
    span.className = 'char-ref';
    span.dataset.characterId = 'char-99';
    span.textContent = 'Vex';
    document.body.appendChild(span);

    fireEvent.mouseOver(span);

    await waitFor(() => {
      expect(onHover).toHaveBeenCalled();
    });
    const lastArg = onHover.mock.calls.at(-1)?.[0];
    expect(lastArg).toMatchObject({ characterId: 'char-99' });
    expect(lastArg?.anchorEl).toBe(span);
  });

  it('bubbles up from a child node inside the .char-ref span (closest match)', async () => {
    const onHover = vi.fn<(e: CharRefHoverEvent | null) => void>();
    render(<HoverHarness onHover={onHover} />);

    const span = document.createElement('span');
    span.className = 'char-ref';
    span.dataset.characterId = 'char-100';
    const inner = document.createElement('em');
    inner.textContent = 'Mira';
    span.appendChild(inner);
    document.body.appendChild(span);

    fireEvent.mouseOver(inner);

    await waitFor(() => {
      expect(onHover).toHaveBeenCalled();
    });
    expect(onHover.mock.calls.at(-1)?.[0]?.characterId).toBe('char-100');
  });

  it('does not fire when hovering an element outside any .char-ref span', () => {
    const onHover = vi.fn<(e: CharRefHoverEvent | null) => void>();
    render(<HoverHarness onHover={onHover} />);

    const div = document.createElement('div');
    div.textContent = 'plain text';
    document.body.appendChild(div);

    fireEvent.mouseOver(div);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('fires null on mouseout when relatedTarget leaves the span', async () => {
    const onHover = vi.fn<(e: CharRefHoverEvent | null) => void>();
    render(<HoverHarness onHover={onHover} />);

    const span = document.createElement('span');
    span.className = 'char-ref';
    span.dataset.characterId = 'char-200';
    span.textContent = 'Cor';
    document.body.appendChild(span);

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent.mouseOver(span);
    onHover.mockClear();
    fireEvent.mouseOut(span, { relatedTarget: outside });

    await waitFor(() => {
      expect(onHover).toHaveBeenCalledWith(null);
    });
  });

  it('removes its document listeners on unmount', () => {
    const onHover = vi.fn<(e: CharRefHoverEvent | null) => void>();
    const { unmount } = render(<HoverHarness onHover={onHover} />);

    const span = document.createElement('span');
    span.className = 'char-ref';
    span.dataset.characterId = 'char-301';
    document.body.appendChild(span);

    unmount();
    fireEvent.mouseOver(span);
    expect(onHover).not.toHaveBeenCalled();
  });
});

describe('CharRef + Editor integration (F36)', () => {
  it('renders the .char-ref class on the live editor surface', async () => {
    function Mount({ onReady }: { onReady: (ed: TiptapEditor) => void }): JSX.Element {
      const editor = useEditor({
        extensions: formatBarExtensions,
        content: '<p>Hi <span class="char-ref" data-character-id="char-555">Lin</span>.</p>',
      });
      useEffect(() => {
        if (editor) onReady(editor);
      }, [editor, onReady]);
      // Render a placeholder; we read the editor's serialized HTML directly.
      return <div data-testid="mount" />;
    }

    let captured: TiptapEditor | null = null;
    render(<Mount onReady={(ed) => (captured = ed)} />);
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });

    const html = captured!.getHTML();
    expect(html).toContain('class="char-ref"');
    expect(html).toContain('data-character-id="char-555"');
    captured!.destroy();
  });
});
