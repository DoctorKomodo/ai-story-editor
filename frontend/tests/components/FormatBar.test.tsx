import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { type JSX, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatBar } from '@/components/FormatBar';
import { formatBarExtensions } from '@/lib/tiptap-extensions';
import { useUiStore } from '@/store/ui';

/**
 * F31 tests.
 *
 * jsdom doesn't route real keystrokes through TipTap's contenteditable,
 * so the test mounts a real editor instance, exposes it via `onReady`,
 * and drives content via `editor.commands.*` — the same pattern
 * `Editor.test.tsx` uses for F8.
 */

interface HarnessProps {
  onReady?: (editor: TiptapEditor) => void;
  onToggleFind?: () => void;
  initialContent?: string;
}

function Harness({ onReady, onToggleFind, initialContent }: HarnessProps): JSX.Element {
  const editor = useEditor({
    extensions: formatBarExtensions,
    content: initialContent ?? '<p>Hello world</p>',
    shouldRerenderOnTransaction: true,
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  return (
    <div>
      <FormatBar editor={editor} onToggleFind={onToggleFind} />
      <EditorContent editor={editor} />
    </div>
  );
}

async function renderAndGrab(
  props: HarnessProps = {},
): Promise<{ editor: TiptapEditor; unmount: () => void }> {
  let captured: TiptapEditor | null = null;
  const { unmount } = render(
    <Harness
      {...props}
      onReady={(ed) => {
        captured = ed;
        props.onReady?.(ed);
      }}
    />,
  );
  await waitFor(() => {
    expect(captured).not.toBeNull();
  });
  return { editor: captured!, unmount };
}

describe('F31 · FormatBar', () => {
  afterEach(() => {
    useUiStore.setState({ layout: 'three-col' });
    vi.clearAllMocks();
  });

  it('renders the toolbar with all expected button groups', async () => {
    const { unmount } = await renderAndGrab();

    expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
    // Undo / Redo
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^redo$/i })).toBeInTheDocument();
    // Style selector
    expect(screen.getByRole('button', { name: /paragraph style/i })).toBeInTheDocument();
    // Marks
    expect(screen.getByRole('button', { name: /^bold$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^italic$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^underline$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^strike$/i })).toBeInTheDocument();
    // Headings + Quote
    expect(screen.getByRole('button', { name: /heading 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /heading 2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^quote$/i })).toBeInTheDocument();
    // Lists
    expect(screen.getByRole('button', { name: /bullet list/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /numbered list/i })).toBeInTheDocument();
    // Link / Highlight
    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^highlight$/i })).toBeInTheDocument();
    // Find / Focus
    expect(screen.getByRole('button', { name: /^find$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /focus mode/i })).toBeInTheDocument();

    unmount();
  });

  it('Bold button toggles the bold mark on the current selection', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();

    act(() => {
      editor.commands.selectAll();
    });

    expect(editor.isActive('bold')).toBe(false);
    await user.click(screen.getByRole('button', { name: /^bold$/i }));
    await waitFor(() => {
      expect(editor.isActive('bold')).toBe(true);
    });
    expect(screen.getByRole('button', { name: /^bold$/i })).toHaveAttribute('aria-pressed', 'true');

    unmount();
  });

  it('Italic button toggles the italic mark', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    act(() => {
      editor.commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: /^italic$/i }));
    await waitFor(() => {
      expect(editor.isActive('italic')).toBe(true);
    });
    unmount();
  });

  it('Underline button toggles the underline mark', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    act(() => {
      editor.commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: /^underline$/i }));
    await waitFor(() => {
      expect(editor.isActive('underline')).toBe(true);
    });
    unmount();
  });

  it('Strike button toggles the strike mark', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    act(() => {
      editor.commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: /^strike$/i }));
    await waitFor(() => {
      expect(editor.isActive('strike')).toBe(true);
    });
    unmount();
  });

  it('Heading 1 button promotes the current block to an h1', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /heading 1/i }));
    await waitFor(() => {
      expect(editor.isActive('heading', { level: 1 })).toBe(true);
    });
    expect(screen.getByRole('button', { name: /heading 1/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    unmount();
  });

  it('Heading 2 button promotes the current block to an h2', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /heading 2/i }));
    await waitFor(() => {
      expect(editor.isActive('heading', { level: 2 })).toBe(true);
    });
    unmount();
  });

  it('Quote button toggles a blockquote', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /^quote$/i }));
    await waitFor(() => {
      expect(editor.isActive('blockquote')).toBe(true);
    });
    unmount();
  });

  it('Bullet list button toggles a bulletList node', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /bullet list/i }));
    await waitFor(() => {
      expect(editor.isActive('bulletList')).toBe(true);
    });
    unmount();
  });

  it('Ordered list button toggles an orderedList node', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /numbered list/i }));
    await waitFor(() => {
      expect(editor.isActive('orderedList')).toBe(true);
    });
    unmount();
  });

  it('Highlight button toggles the highlight mark', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();
    act(() => {
      editor.commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: /^highlight$/i }));
    await waitFor(() => {
      expect(editor.isActive('highlight')).toBe(true);
    });
    unmount();
  });

  it('Style selector dropdown opens, lists options, and selecting Heading 1 promotes the block', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();

    const selector = screen.getByRole('button', { name: /paragraph style/i });
    expect(selector).toHaveTextContent('Body');
    await user.click(selector);

    const menu = screen.getByRole('menu', { name: /paragraph style/i });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Body' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Heading 1' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Heading 2' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Heading 3' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Quote' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Heading 1' }));
    await waitFor(() => {
      expect(editor.isActive('heading', { level: 1 })).toBe(true);
    });

    // Menu closes after selection.
    expect(screen.queryByRole('menu', { name: /paragraph style/i })).not.toBeInTheDocument();
    // Active label updates.
    expect(screen.getByRole('button', { name: /paragraph style/i })).toHaveTextContent('Heading 1');

    unmount();
  });

  it('Style selector closes on Escape', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderAndGrab();
    await user.click(screen.getByRole('button', { name: /paragraph style/i }));
    expect(screen.getByRole('menu', { name: /paragraph style/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: /paragraph style/i })).not.toBeInTheDocument();
    unmount();
  });

  it('Undo button reverts the last content change', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab({
      initialContent: '<p>Initial</p>',
    });

    // Mutate via a TipTap command so it lands in the history stack.
    // Place cursor at end of the existing paragraph and insert text inline
    // (insertContentAt at doc.content.size would create a new block).
    act(() => {
      const endOfParagraph = editor.state.doc.firstChild?.nodeSize ?? 0;
      editor.commands.setTextSelection(endOfParagraph - 1);
      editor.commands.insertContent(' more');
    });
    await waitFor(() => {
      expect(editor.getText()).toContain('more');
    });

    const undo = screen.getByRole('button', { name: /^undo$/i });
    await waitFor(() => {
      expect(undo).not.toBeDisabled();
    });
    await user.click(undo);
    await waitFor(() => {
      expect(editor.getText()).not.toContain('more');
    });

    unmount();
  });

  it('Link popover sets a link href on the selected text', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();

    act(() => {
      editor.commands.selectAll();
    });

    await user.click(screen.getByRole('button', { name: /^link$/i }));
    const popover = screen.getByRole('dialog', { name: /^link$/i });
    expect(popover).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: /url/i });
    await user.type(input, 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      expect(editor.isActive('link')).toBe(true);
    });
    expect(editor.getAttributes('link').href).toBe('https://example.com');

    unmount();
  });

  it('Link popover Remove unsets an existing link', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = await renderAndGrab();

    // Pre-apply a link so Remove has something to do.
    act(() => {
      editor.commands.selectAll();
      editor.chain().focus().extendMarkRange('link').setLink({ href: 'https://x.test' }).run();
    });
    await waitFor(() => {
      expect(editor.isActive('link')).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: /^link$/i }));
    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => {
      expect(editor.isActive('link')).toBe(false);
    });

    unmount();
  });

  it('Find button calls onToggleFind', async () => {
    const user = userEvent.setup();
    const onToggleFind = vi.fn();
    const { unmount } = await renderAndGrab({ onToggleFind });
    await user.click(screen.getByRole('button', { name: /^find$/i }));
    expect(onToggleFind).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('Focus button flips useUiStore.layout to focus', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderAndGrab();
    expect(useUiStore.getState().layout).toBe('three-col');
    await user.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(useUiStore.getState().layout).toBe('focus');
    unmount();
  });

  it('renders all action buttons disabled when editor is null', () => {
    render(<FormatBar editor={null} />);
    expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^bold$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^italic$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^underline$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^strike$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /heading 1/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /heading 2/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^quote$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /bullet list/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /numbered list/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^link$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^highlight$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /paragraph style/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
  });

  // [F52] Find button is wired but the actual feature is deferred to [X17].
  // Until X17 ships, the button is disabled and surfaces the deferred status
  // via a `title` tooltip.
  it('Find button is disabled and surfaces the [X17] title when onToggleFind is undefined', () => {
    render(<FormatBar editor={null} />);
    const findBtn = screen.getByRole('button', { name: /^find$/i });
    expect(findBtn).toBeDisabled();
    expect(findBtn.getAttribute('title') ?? '').toMatch(/x17/i);
  });

  it('Find button is enabled when onToggleFind is provided', () => {
    const onToggleFind = vi.fn();
    render(<FormatBar editor={null} onToggleFind={onToggleFind} />);
    const findBtn = screen.getByRole('button', { name: /^find$/i });
    expect(findBtn).not.toBeDisabled();
  });
});
