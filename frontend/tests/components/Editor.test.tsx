import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@/components/Editor';

/**
 * F8 tests.
 *
 * jsdom doesn't implement contenteditable the way a real browser does,
 * so instead of typing through user-event we drive content via
 * `editor.commands.*` — grabbed out through the `onReady` escape hatch
 * the component exposes for exactly this purpose.
 */

async function renderAndGrab(
  props: Parameters<typeof Editor>[0] = {},
): Promise<{ editor: TiptapEditor; unmount: () => void }> {
  let captured: TiptapEditor | null = null;
  const { unmount } = render(
    <Editor
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

describe('Editor (F8)', () => {
  it('renders a toolbar with bold/italic/H1-H3/paragraph buttons and a word-count footer', async () => {
    const { unmount } = await renderAndGrab();

    expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^bold$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^italic$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /heading 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /heading 2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /heading 3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /paragraph/i })).toBeInTheDocument();

    // Editor surface + initial empty word count.
    expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/^0 words$/);

    unmount();
  });

  it('updates the word-count footer as content changes (0 / 1 singular / 2 / 0)', async () => {
    const { editor, unmount } = await renderAndGrab();

    expect(screen.getByRole('status')).toHaveTextContent(/^0 words$/);

    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^1 word$/);
    });

    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^2 words$/);
    });

    act(() => {
      editor.commands.clearContent();
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^0 words$/);
    });

    unmount();
  });

  it('fires onUpdate with { bodyJson, wordCount } when content changes', async () => {
    const onUpdate = vi.fn<(args: { bodyJson: JSONContent; wordCount: number }) => void>();
    const { editor, unmount } = await renderAndGrab({ onUpdate });

    // insertContent emits an update transaction; setContent's emit behaviour
    // varies by version, so use insertContent to guarantee onUpdate fires.
    act(() => {
      editor.commands.insertContent('Hello world');
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });

    const lastCall = onUpdate.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0].wordCount).toBe(2);
    expect(lastCall![0].bodyJson).toMatchObject({ type: 'doc' });

    unmount();
  });

  it('toggles bold active state (aria-pressed) via toolbar button click', async () => {
    const { editor, unmount } = await renderAndGrab();

    // Put some content in and select it, so toggleBold has something to act on.
    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      });
      editor.commands.selectAll();
    });

    const boldBtn = screen.getByRole('button', { name: /^bold$/i });
    expect(boldBtn).toHaveAttribute('aria-pressed', 'false');

    const user = userEvent.setup();
    await user.click(boldBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^bold$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    await user.click(screen.getByRole('button', { name: /^bold$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^bold$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    unmount();
  });

  it('reflects active state for heading levels and paragraph', async () => {
    const { editor, unmount } = await renderAndGrab();

    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Title' }] }],
      });
      editor.commands.selectAll();
    });

    // Initially paragraph is active, headings are not.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /paragraph/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(screen.getByRole('button', { name: /heading 2/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /heading 2/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /heading 2/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(screen.getByRole('button', { name: /paragraph/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /heading 1/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Flip back to paragraph.
    await user.click(screen.getByRole('button', { name: /paragraph/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /paragraph/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    unmount();
  });

  it('honours initialBodyJson on mount', async () => {
    const initial: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }],
    };
    const { editor, unmount } = await renderAndGrab({ initialBodyJson: initial });

    // Content round-trips.
    expect(editor.getText()).toBe('one two three');
    expect(screen.getByRole('status')).toHaveTextContent(/^3 words$/);

    unmount();
  });
});
