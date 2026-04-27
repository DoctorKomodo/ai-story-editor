/**
 * [F35] Continue-writing affordance.
 *
 * Idle state renders a dashed `var(--ai)` pill ("Continue writing") with a
 * mono hint ("⌥↵ generates ~80 words in your voice"). Click — or `⌥+Enter`
 * while the editor has focus — kicks off a streaming `/api/ai/complete` call
 * with `action: 'continue'`, seeding it with the last ~500 chars of editor
 * content as cursor context.
 *
 * Streaming output is rendered as a sibling `<span class="ai-continuation">`
 * (purple-tinted via `var(--ai)`); we do NOT mutate the TipTap document until
 * the user explicitly accepts via `Keep`. This keeps the UX cancellable
 * without having to reverse partial inserts on Discard.
 *
 * Summary bar:
 *   - Keep    — inserts the streamed text into the editor at the cursor as
 *               plain prose (no continuation mark) and resets the hook.
 *   - Retry   — re-runs the call with the same args.
 *   - Discard — resets the hook and returns to idle.
 *
 * `Keep` and `Discard` are disabled while the request is still streaming;
 * `Retry` is also disabled while streaming (don't double-issue). All three
 * are enabled on `done` and `error`.
 *
 * The `⌥+Enter` keydown listener here is intentionally local — F47 will own
 * the global shortcut routing across the app. Until then, the listener is
 * mounted only while the pill is visible (i.e. idle) so it can't fight a
 * future global handler during streaming.
 */

import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { type RunArgs, useAICompletion } from '@/hooks/useAICompletion';
import { useAltEnter } from '@/hooks/useKeyboardShortcuts';

export interface ContinueWritingProps {
  editor: TiptapEditor | null;
  storyId: string;
  chapterId: string;
  modelId: string;
  /** Parent-controlled visibility hint. Defaults to true. */
  visible?: boolean;
}

const CURSOR_CONTEXT_CHARS = 500;

function readCursorContext(editor: TiptapEditor | null): string {
  if (!editor) return '';
  const { state } = editor;
  const from = 0;
  const to = state.selection.from;
  const text = state.doc.textBetween(from, to, '\n');
  if (text.length <= CURSOR_CONTEXT_CHARS) return text;
  return text.slice(text.length - CURSOR_CONTEXT_CHARS);
}

export function ContinueWriting({
  editor,
  storyId,
  chapterId,
  modelId,
  visible = true,
}: ContinueWritingProps): JSX.Element | null {
  const { run, reset, status, text, error } = useAICompletion();
  const [lastArgs, setLastArgs] = useState<RunArgs | null>(null);
  // Captures the last invocation so Retry can replay the same args (notably
  // the cursor context that was live when the user originally clicked).
  const lastArgsRef = useRef<RunArgs | null>(null);

  const isIdle = status === 'idle';
  const isStreaming = status === 'streaming';
  const isError = status === 'error';

  const trigger = useCallback((): void => {
    if (!editor) return;
    if (status === 'streaming') return;
    const cursorContext = readCursorContext(editor);
    const args: RunArgs = {
      action: 'continue',
      selectedText: cursorContext,
      chapterId,
      storyId,
      modelId,
    };
    setLastArgs(args);
    lastArgsRef.current = args;
    void run(args);
  }, [editor, status, chapterId, storyId, modelId, run]);

  // [F57] ⌥+Enter via the F47 priority registry. Only enabled while the
  // pill is visible + idle so we don't compete with streaming. The handler
  // still suppresses input/textarea targets so a user typing in the chat
  // composer doesn't accidentally trigger continue-writing.
  useAltEnter(
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return false; // not handled — let other registrations / defaults run
      }
      e.preventDefault();
      trigger();
    },
    { enabled: visible && isIdle, priority: 0 },
  );

  const handleKeep = useCallback((): void => {
    if (!editor || text.length === 0) return;
    // Insert the streamed text at the cursor as plain prose. We deliberately
    // skip the `aiContinuation` mark here so the committed content reads as
    // normal text — the mark exists in the schema for future flows that need
    // to mark-then-revoke (e.g. multi-stage Keep/Undo).
    editor.chain().focus().insertContent(text).run();
    reset();
    setLastArgs(null);
    lastArgsRef.current = null;
  }, [editor, text, reset]);

  const handleRetry = useCallback((): void => {
    const args = lastArgsRef.current ?? lastArgs;
    if (!args) return;
    if (status === 'streaming') return;
    void run(args);
  }, [lastArgs, run, status]);

  const handleDiscard = useCallback((): void => {
    reset();
    setLastArgs(null);
    lastArgsRef.current = null;
  }, [reset]);

  const buttonClass = useMemo(
    () =>
      'px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-ink-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors',
    [],
  );
  const discardClass =
    'px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-danger transition-colors';

  if (!visible) return null;

  // Idle: render the dashed pill.
  if (isIdle) {
    return (
      <div className="continue-writing mt-4 mx-auto max-w-[720px] px-20">
        <button
          type="button"
          onClick={trigger}
          aria-label="Continue writing"
          className="ai-continue-pill border border-dashed border-[var(--ai)] text-[var(--ai)] rounded-full px-3 py-1 text-[13px] hover:bg-[color-mix(in_srgb,var(--ai)_10%,transparent)] inline-flex items-center gap-2"
        >
          Continue writing
          <span className="text-[11px] font-mono text-ink-4">
            ⌥↵ generates ~80 words in your voice
          </span>
        </button>
      </div>
    );
  }

  // Streaming / done / error: hide the pill, show output + summary bar.
  return (
    <aside
      aria-label="Continue writing"
      className="continue-writing mt-4 mx-auto max-w-[720px] px-20"
    >
      {!isError && (
        <div
          data-testid="continuation-output"
          className={`ai-continuation font-serif text-[16px] leading-[1.6] whitespace-pre-wrap${
            isStreaming ? ' streaming' : ''
          }`}
        >
          {text}
        </div>
      )}

      {isError && (
        <div role="alert" className="text-danger text-[13px]">
          {error?.message ?? "Couldn't generate. Try again?"}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 text-[12px]">
        <button
          type="button"
          onClick={handleKeep}
          disabled={isStreaming || isError || text.length === 0}
          className={buttonClass}
        >
          Keep
        </button>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isStreaming || lastArgsRef.current === null}
          className={buttonClass}
        >
          Retry
        </button>
        <span className="flex-1" aria-hidden="true" />
        <button
          type="button"
          onClick={handleDiscard}
          disabled={isStreaming}
          className={discardClass}
        >
          Discard
        </button>
      </div>
    </aside>
  );
}
