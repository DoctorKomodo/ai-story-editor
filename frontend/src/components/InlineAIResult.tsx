import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { ThinkingDots } from '@/design/ThinkingDots';
import { useEscape } from '@/hooks/useKeyboardShortcuts';
import { useInlineAIResultStore } from '@/store/inlineAIResult';

/**
 * Inline AI result card (F34).
 *
 * Renders below the prose surface inside the paper area, wrapping the user's
 * selection as a serif-italic blockquote with a left border, then either:
 *   - three bouncing `.think-dot`s while `status === 'thinking'`,
 *   - the streaming/done output as serif 16px text, or
 *   - an `<InlineErrorBanner>` on `status === 'error'` showing the actual
 *     `code · message` (with debug-mode raw payload).
 *
 * Action rows are split by status:
 *   - `status === 'done'`: Replace · Insert after · Retry · Discard.
 *   - `status === 'error'`: Discard only — the banner has its own Retry
 *     button wired to `onRetry`.
 *
 * F34 owns the visual + the action wiring; the parent (EditorPage) is
 * responsible for routing the SelectionBubble's `onAction` callback to a
 * handler that seeds the store and kicks off the F15 SSE stream. F34 itself
 * never calls `/api/ai/complete` — it just renders whatever the store says.
 *
 * Replace/Insert after are disabled when:
 *   - `editor` is null (no TipTap instance yet), OR
 *   - `output.length === 0` (nothing to insert).
 */

export interface InlineAIResultProps {
  editor: TiptapEditor | null;
  onRetry?: () => void;
}

export function InlineAIResult({ editor, onRetry }: InlineAIResultProps): JSX.Element | null {
  const inlineAIResult = useInlineAIResultStore((s) => s.inlineAIResult);
  const clear = useInlineAIResultStore((s) => s.clear);

  // [F57] Escape dismisses the card — priority 20 (between popovers / bubble).
  useEscape(
    () => {
      clear();
    },
    { priority: 20, enabled: inlineAIResult !== null },
  );

  if (!inlineAIResult) return null;

  const { text, status, output } = inlineAIResult;
  const canMutate = editor !== null && output.length > 0;

  const handleReplace = (): void => {
    if (!editor || output.length === 0) return;
    editor.chain().focus().deleteSelection().insertContent(output).run();
    clear();
  };

  const handleInsertAfter = (): void => {
    if (!editor || output.length === 0) return;
    editor.chain().focus().insertContentAt(editor.state.selection.to, output).run();
    clear();
  };

  const handleRetry = (): void => {
    onRetry?.();
  };

  const handleDiscard = (): void => {
    clear();
  };

  const buttonClass =
    'px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-ink-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors';
  const discardClass =
    'px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-danger transition-colors';

  return (
    <aside aria-label="AI result" className="mt-4 mx-auto max-w-[720px] px-20 inline-ai-result">
      <blockquote className="border-l-4 border-line-2 pl-4 py-1 font-serif italic text-[15px] text-ink-3">
        {text}
      </blockquote>

      {(status === 'thinking' || (status === 'streaming' && output.length === 0)) && (
        <div className="mt-3">
          <ThinkingDots />
        </div>
      )}

      {(status === 'streaming' || status === 'done') && output.length > 0 && (
        <div className="font-serif text-[16px] text-ink leading-[1.6] mt-3 whitespace-pre-wrap">
          {output}
        </div>
      )}

      {status === 'error' && (
        <div className="mt-3">
          <InlineErrorBanner
            error={inlineAIResult.error ?? { code: null, message: "Couldn't generate." }}
            onRetry={onRetry}
          />
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-2 mt-4 text-[12px]">
          <button
            type="button"
            onClick={handleReplace}
            disabled={!canMutate}
            className={buttonClass}
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleInsertAfter}
            disabled={!canMutate}
            className={buttonClass}
          >
            Insert after
          </button>
          <button type="button" onClick={handleRetry} className={buttonClass}>
            Retry
          </button>
          <span className="flex-1" aria-hidden="true" />
          <button type="button" onClick={handleDiscard} className={discardClass}>
            Discard
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 mt-4 text-[12px]">
          <span className="flex-1" aria-hidden="true" />
          <button type="button" onClick={handleDiscard} className={discardClass}>
            Discard
          </button>
        </div>
      )}
    </aside>
  );
}
