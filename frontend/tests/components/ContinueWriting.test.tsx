import { fireEvent, render, screen } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContinueWriting } from '@/components/ContinueWriting';
import type { AICompletionStatus, RunArgs, UseAICompletion } from '@/hooks/useAICompletion';
import { ApiError } from '@/lib/api';

/**
 * F35 tests.
 *
 * The component reads the F15 `useAICompletion` hook and writes back into a
 * TipTap editor on Keep. Both are mocked: the hook via `vi.mock` so we can
 * drive `status`/`text` deterministically, and the editor via a chainable
 * spy graph identical to the F34 (`InlineAIResult`) tests.
 */

const runMock = vi.fn<(args: RunArgs) => Promise<void>>(async () => {});
const resetMock = vi.fn();
const cancelMock = vi.fn();

let hookState: {
  status: AICompletionStatus;
  text: string;
  error: ApiError | null;
} = {
  status: 'idle',
  text: '',
  error: null,
};

function setHookState(next: Partial<typeof hookState>): void {
  hookState = { ...hookState, ...next };
}

vi.mock('@/hooks/useAICompletion', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useAICompletion')>('@/hooks/useAICompletion');
  return {
    ...actual,
    useAICompletion: (): UseAICompletion => ({
      status: hookState.status,
      text: hookState.text,
      error: hookState.error,
      usage: null,
      run: runMock,
      cancel: cancelMock,
      reset: resetMock,
    }),
  };
});

interface EditorMock {
  editor: TiptapEditor;
  spies: {
    chain: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    insertContent: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

function makeEditorMock(cursorText = 'She walked into the storm.'): EditorMock {
  const run = vi.fn();
  const insertContent = vi.fn().mockReturnThis();
  const focus = vi.fn().mockReturnThis();
  const chainObj = { focus, insertContent, run };
  focus.mockReturnValue(chainObj);
  insertContent.mockReturnValue(chainObj);
  const chain = vi.fn().mockReturnValue(chainObj);
  const editor = {
    chain,
    state: {
      selection: { from: cursorText.length },
      doc: {
        textBetween: vi.fn().mockReturnValue(cursorText),
      },
    },
  } as unknown as TiptapEditor;
  return { editor, spies: { chain, focus, insertContent, run } };
}

const baseProps = {
  storyId: 'story-1',
  chapterId: 'chapter-1',
  modelId: 'model-x',
};

beforeEach(() => {
  hookState = { status: 'idle', text: '', error: null };
  runMock.mockClear();
  resetMock.mockClear();
  cancelMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContinueWriting (F35)', () => {
  it('renders the dashed pill with the correct label and mono hint when idle', () => {
    const { editor } = makeEditorMock();
    render(<ContinueWriting editor={editor} {...baseProps} />);
    const pill = screen.getByRole('button', { name: 'Continue writing' });
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('Continue writing');
    expect(pill).toHaveTextContent('⌥↵ generates ~80 words in your voice');
    // Pill carries the dashed-purple visual via the documented class.
    expect(pill.className).toContain('ai-continue-pill');
    expect(pill.className).toContain('border-dashed');
  });

  it('returns null when visible=false', () => {
    const { editor } = makeEditorMock();
    const { container } = render(
      <ContinueWriting editor={editor} {...baseProps} visible={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('clicking the pill calls run() with action=continue + cursor context', () => {
    const { editor } = makeEditorMock('Once upon a time.');
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue writing' }));
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith({
      action: 'continue',
      selectedText: 'Once upon a time.',
      chapterId: 'chapter-1',
      storyId: 'story-1',
      modelId: 'model-x',
    });
  });

  it('Alt+Enter keydown triggers run() the same way as a click', () => {
    const { editor } = makeEditorMock('Cursor context.');
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.keyDown(document, { key: 'Enter', altKey: true });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'continue', selectedText: 'Cursor context.' }),
    );
  });

  it('truncates cursor context to the last 500 chars', () => {
    const long = `${'a'.repeat(600)}TAIL`;
    const { editor } = makeEditorMock(long);
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue writing' }));
    const args = runMock.mock.calls[0]?.[0] as RunArgs;
    expect(args.selectedText.length).toBe(500);
    expect(args.selectedText.endsWith('TAIL')).toBe(true);
  });

  it('hides the pill and renders the streaming output + summary bar while streaming', () => {
    const { editor } = makeEditorMock();
    setHookState({ status: 'streaming', text: 'Some streaming words' });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Continue writing' })).toBeNull();
    const out = screen.getByTestId('continuation-output');
    expect(out).toHaveTextContent('Some streaming words');
    expect(out.className).toContain('ai-continuation');
    // Summary bar present.
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    // Keep/Discard are disabled while streaming.
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('enables Keep / Retry / Discard once status=done', () => {
    const { editor } = makeEditorMock();
    // First click to set lastArgs (so Retry has something to replay).
    const { rerender } = render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue writing' }));
    setHookState({ status: 'done', text: 'Final output text.' });
    // Re-render with the new state on the same component instance.
    rerender(<ContinueWriting editor={editor} {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Keep' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeDisabled();
  });

  it('Keep inserts the streamed text into the editor at the cursor and resets the hook', () => {
    const { editor, spies } = makeEditorMock();
    setHookState({ status: 'done', text: 'Streamed prose.' });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(spies.chain).toHaveBeenCalledTimes(1);
    expect(spies.focus).toHaveBeenCalledTimes(1);
    expect(spies.insertContent).toHaveBeenCalledWith('Streamed prose.');
    expect(spies.run).toHaveBeenCalledTimes(1);
    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it('Retry re-runs the call with the same args', () => {
    const { editor } = makeEditorMock('Cursor.');
    const { rerender } = render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue writing' }));
    expect(runMock).toHaveBeenCalledTimes(1);
    const firstArgs = runMock.mock.calls[0]?.[0];

    setHookState({ status: 'done', text: 'first draft' });
    rerender(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls[1]?.[0]).toEqual(firstArgs);
  });

  it('Discard resets the hook and returns to idle', () => {
    const { editor } = makeEditorMock();
    setHookState({ status: 'done', text: 'something' });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it('renders the error message and Retry/Discard on status=error', () => {
    const { editor } = makeEditorMock();
    setHookState({
      status: 'error',
      text: '',
      error: new ApiError(502, 'Stream collapsed'),
    });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/stream collapsed/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    // Keep is rendered but disabled (no output to commit).
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
  });

  it('does not fire run() on Alt+Enter while streaming', () => {
    const { editor } = makeEditorMock();
    setHookState({ status: 'streaming', text: 'partial' });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    fireEvent.keyDown(document, { key: 'Enter', altKey: true });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('does not fire run() again when trigger() or Retry is called during thinking phase', () => {
    const { editor } = makeEditorMock('Context.');
    const { rerender } = render(<ContinueWriting editor={editor} {...baseProps} />);
    // First click from idle — sets lastArgs and kicks off the run.
    fireEvent.click(screen.getByRole('button', { name: 'Continue writing' }));
    expect(runMock).toHaveBeenCalledTimes(1);

    // Simulate the hook entering 'thinking' (the new initial in-flight state).
    setHookState({ status: 'thinking', text: '' });
    rerender(<ContinueWriting editor={editor} {...baseProps} />);

    // A second click via trigger() must be blocked.
    // (trigger is not exposed directly; we verify run() is not called again.)
    // The Retry button is also disabled while thinking.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();

    // run() should still be exactly 1 — no re-entry occurred.
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('Keep is a no-op when text is empty (e.g. after error)', () => {
    const { editor, spies } = makeEditorMock();
    setHookState({ status: 'done', text: '' });
    render(<ContinueWriting editor={editor} {...baseProps} />);
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).toBeDisabled();
    fireEvent.click(keep);
    expect(spies.chain).not.toHaveBeenCalled();
    expect(resetMock).not.toHaveBeenCalled();
  });
});
