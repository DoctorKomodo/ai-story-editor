import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSX } from 'react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CharRefMenu } from '@/components/CharRefMenu';
import { setCharRefSuggestionProvider } from '@/lib/charRefSuggestion';
import { formatBarExtensions } from '@/lib/tiptap-extensions';
import { resetCharRefSuggestionStore, useCharRefSuggestionStore } from '@/store/charRefSuggestion';

const CAST = [
  { id: 'c1', name: 'Elena Marsh', role: 'Protagonist' },
  { id: 'c2', name: 'Eli Bracken', role: 'Antagonist' },
  { id: 'c3', name: 'Marcus Stone', role: null },
];

function Harness({ onReady }: { onReady?: (e: Editor) => void }): JSX.Element {
  const editor = useEditor({
    extensions: formatBarExtensions,
    content: '<p></p>',
    shouldRerenderOnTransaction: true,
  });
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);
  return (
    <>
      <div data-testid="editor">
        <EditorContent editor={editor} />
      </div>
      <CharRefMenu />
    </>
  );
}

async function setupEditor(): Promise<Editor> {
  let editor: Editor | undefined;
  render(
    <Harness
      onReady={(e) => {
        editor = e;
      }}
    />,
  );
  await waitFor(() => expect(editor).toBeDefined());
  if (!editor) throw new Error('editor not ready');
  return editor;
}

function typeAt(editor: Editor, text: string): void {
  act(() => {
    editor.commands.focus();
    editor.commands.insertContent(text);
  });
}

function pressKey(editor: Editor, key: string): void {
  const dom = editor.view.dom as HTMLElement;
  act(() => {
    fireEvent.keyDown(dom, { key });
  });
}

describe('charRef @-trigger authoring (F62)', () => {
  beforeEach(() => {
    setCharRefSuggestionProvider(() => CAST);
  });
  afterEach(() => {
    setCharRefSuggestionProvider(null);
    act(() => {
      resetCharRefSuggestionStore();
    });
  });

  it('typing @ opens the menu with all characters (capped to 8)', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@');

    await waitFor(() => {
      expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /elena marsh/i })).toBeInTheDocument();
  });

  it('narrows the list as the user types', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@el');

    await waitFor(() => {
      const opts = screen.getAllByRole('option');
      expect(opts.length).toBe(2);
    });
    expect(screen.queryByRole('option', { name: /marcus stone/i })).not.toBeInTheDocument();
  });

  it('ArrowDown / Enter inserts the active item with charRef mark', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@e');

    await waitFor(() => {
      expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument();
    });
    pressKey(editor, 'ArrowDown');
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(1);
    pressKey(editor, 'Enter');

    await waitFor(() => {
      expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument();
    });

    const json = editor.getJSON();
    const text = editor.getText();
    expect(text).toContain('Eli Bracken');
    const para = json.content?.[0];
    const run = para?.content?.find(
      (n) =>
        n.type === 'text' &&
        typeof n.text === 'string' &&
        n.text.includes('Eli Bracken') &&
        Array.isArray(n.marks) &&
        n.marks.some((m) => m.type === 'charRef' && m.attrs?.characterId === 'c2'),
    );
    expect(run).toBeDefined();
  });

  it('Escape closes the menu without inserting; the typed @query stays as plain text', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@el');
    await waitFor(() => expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument());

    pressKey(editor, 'Escape');
    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());

    expect(editor.getText()).toContain('@el');
    const json = editor.getJSON();
    const para = json.content?.[0];
    const hasMark = para?.content?.some(
      (n) => Array.isArray(n.marks) && n.marks.some((m) => m.type === 'charRef'),
    );
    expect(hasMark).toBeFalsy();
  });

  it('clicking a row inserts that character and closes the menu', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@m');
    const marcusOption = await screen.findByRole('option', { name: /marcus stone/i });

    act(() => {
      fireEvent.mouseDown(marcusOption);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument();
    });
    expect(editor.getText()).toContain('Marcus Stone');
  });

  it('empty cast → menu opens with the empty-state row, Enter is a no-op', async () => {
    setCharRefSuggestionProvider(() => []);
    const editor = await setupEditor();
    typeAt(editor, '@');

    await waitFor(() => {
      expect(screen.getByText(/no characters in this story yet/i)).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    pressKey(editor, 'Enter');
    const json = editor.getJSON();
    const hasMark = (json.content ?? []).some(
      (block) =>
        Array.isArray(block.content) &&
        block.content.some(
          (n) => Array.isArray(n.marks) && n.marks.some((m) => m.type === 'charRef'),
        ),
    );
    expect(hasMark).toBeFalsy();
  });

  it('typing a space after @query closes the menu (allowSpaces:false)', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@el');
    await waitFor(() => expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument());

    typeAt(editor, ' ');
    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());
  });

  it('the inserted run has charRef mark only on the name, not on the trailing space', async () => {
    const editor = await setupEditor();
    typeAt(editor, '@el');
    await waitFor(() => expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument());
    pressKey(editor, 'Enter');

    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());

    const para = editor.getJSON().content?.[0];
    const runs = para?.content ?? [];
    const named = runs.find(
      (r) => Array.isArray(r.marks) && r.marks.some((m) => m.type === 'charRef'),
    );
    const space = runs.find(
      (r) => r.type === 'text' && typeof r.text === 'string' && r.text === ' ',
    );
    expect(named).toBeDefined();
    expect(space).toBeDefined();
    expect(space?.marks ?? []).toEqual([]);
  });
});
