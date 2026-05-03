import { fireEvent, render, screen } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineAIResult } from '@/components/InlineAIResult';
import { useInlineAIResultStore } from '@/store/inlineAIResult';

/**
 * F34 tests.
 *
 * The card reads from `useInlineAIResultStore`. The TipTap editor is mocked
 * via a chainable spy graph so we can assert which command sequence each
 * action button issued without spinning up a real ProseMirror instance —
 * jsdom's contenteditable is limited and a real editor isn't needed for the
 * action wiring.
 */

interface EditorMock {
  editor: TiptapEditor;
  spies: {
    chain: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    deleteSelection: ReturnType<typeof vi.fn>;
    insertContent: ReturnType<typeof vi.fn>;
    insertContentAt: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

function makeEditorMock(selectionTo = 10): EditorMock {
  const run = vi.fn();
  const insertContent = vi.fn().mockReturnThis();
  const insertContentAt = vi.fn().mockReturnThis();
  const deleteSelection = vi.fn().mockReturnThis();
  const focus = vi.fn().mockReturnThis();
  const chainObj = { focus, deleteSelection, insertContent, insertContentAt, run };
  // Make every chainable method return the same chain object so chains of
  // arbitrary length resolve without TS or runtime gymnastics.
  focus.mockReturnValue(chainObj);
  deleteSelection.mockReturnValue(chainObj);
  insertContent.mockReturnValue(chainObj);
  insertContentAt.mockReturnValue(chainObj);
  const chain = vi.fn().mockReturnValue(chainObj);
  const editor = {
    chain,
    state: { selection: { to: selectionTo } },
  } as unknown as TiptapEditor;
  return {
    editor,
    spies: { chain, focus, deleteSelection, insertContent, insertContentAt, run },
  };
}

afterEach(() => {
  useInlineAIResultStore.setState({ inlineAIResult: null });
  vi.restoreAllMocks();
});

describe('InlineAIResult (F34)', () => {
  it('returns null when the store is empty', () => {
    const { container } = render(<InlineAIResult editor={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the quote and three think dots when status is thinking', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: { action: 'rewrite', text: 'old', status: 'thinking', output: '' },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByRole('complementary', { name: 'AI result' })).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    const region = screen.getByTestId('thinking-dots');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-label', 'Thinking');
    const dots = region.querySelectorAll('.think-dot');
    expect(dots).toHaveLength(3);
    // No action row while thinking.
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('renders streaming output without an action row', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'streaming',
        output: 'new content',
      },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByText('new content')).toBeInTheDocument();
    expect(screen.queryAllByTestId('think-dot')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it('renders dots while status=streaming and output is still empty (race safety)', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'A long sentence selected by the user.',
        status: 'streaming',
        output: '',
      },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByTestId('thinking-dots')).toBeInTheDocument();
  });

  it('renders the action row with all four buttons when status is done', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    const { editor } = makeEditorMock();
    render(<InlineAIResult editor={editor} />);
    expect(screen.getByText('new content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert after' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('Replace runs deleteSelection + insertContent on the editor and clears the store', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    const { editor, spies } = makeEditorMock();
    render(<InlineAIResult editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(spies.chain).toHaveBeenCalledTimes(1);
    expect(spies.focus).toHaveBeenCalledTimes(1);
    expect(spies.deleteSelection).toHaveBeenCalledTimes(1);
    expect(spies.insertContent).toHaveBeenCalledWith('new content');
    expect(spies.run).toHaveBeenCalledTimes(1);
    expect(useInlineAIResultStore.getState().inlineAIResult).toBeNull();
  });

  it('Insert after runs insertContentAt at selection.to and clears the store', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    const { editor, spies } = makeEditorMock(42);
    render(<InlineAIResult editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert after' }));
    expect(spies.chain).toHaveBeenCalledTimes(1);
    expect(spies.focus).toHaveBeenCalledTimes(1);
    expect(spies.insertContentAt).toHaveBeenCalledWith(42, 'new content');
    expect(spies.run).toHaveBeenCalledTimes(1);
    expect(useInlineAIResultStore.getState().inlineAIResult).toBeNull();
  });

  it('Retry calls onRetry and does not clear the store', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    const onRetry = vi.fn();
    const { editor } = makeEditorMock();
    render(<InlineAIResult editor={editor} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(useInlineAIResultStore.getState().inlineAIResult).not.toBeNull();
  });

  it('Discard clears the store', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    const { editor } = makeEditorMock();
    render(<InlineAIResult editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useInlineAIResultStore.getState().inlineAIResult).toBeNull();
  });

  it('disables Replace and Insert after when output is empty', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: { action: 'rewrite', text: 'old', status: 'done', output: '' },
    });
    const { editor } = makeEditorMock();
    render(<InlineAIResult editor={editor} />);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Insert after' })).toBeDisabled();
    // Retry and Discard remain enabled.
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeDisabled();
  });

  it('disables Replace and Insert after when editor is null', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'done',
        output: 'new content',
      },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Insert after' })).toBeDisabled();
  });

  it('renders InlineErrorBanner with fallback copy when status=error and no error payload', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: { action: 'rewrite', text: 'old', status: 'error', output: '' },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByTestId('inline-error-banner')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.?t generate/i);
    // Banner's Retry button is rendered via onRetry prop.
    // Discard is in the error action row below the banner.
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    // Replace + Insert after are NOT rendered on error (action row restructured).
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Insert after' })).toBeNull();
  });

  it('renders InlineErrorBanner with code+message when status=error and error payload provided', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'old',
        status: 'error',
        output: '',
        error: { code: 'venice_key_invalid', message: 'Your Venice API key was rejected.' },
      },
    });
    const onRetry = vi.fn();
    render(<InlineAIResult editor={null} onRetry={onRetry} />);
    expect(screen.getByTestId('inline-error-banner')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('venice_key_invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Your Venice API key was rejected.');
    // Banner's own Retry button (inside the banner).
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    expect(retryButtons).toHaveLength(1);
    fireEvent.click(retryButtons[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Discard still rendered in action row.
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
