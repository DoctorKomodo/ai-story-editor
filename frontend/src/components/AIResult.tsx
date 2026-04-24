/**
 * AI result card (F15).
 *
 * The plain right-panel surface that renders the accumulating streamed text,
 * plus `Insert at cursor` / `Copy` / `Dismiss` controls when the stream is
 * done. This is explicitly the F15 minimal UX — F33–F36 replace it with the
 * selection-bubble + inline-AI-card in the editor surface; F38/F42 redesign
 * the whole chat pane. F16 later hangs Venice rate-limit indicators off the
 * same response headers but lives outside this component.
 */
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { AICompletionStatus } from '@/hooks/useAICompletion';

export interface AIResultProps {
  status: AICompletionStatus;
  text: string;
  error: ApiError | null;
  onInsertAtCursor: (text: string) => void;
  onDismiss: () => void;
}

const COPIED_FEEDBACK_MS = 1500;

function friendlyError(error: ApiError | null): string {
  if (!error) return 'Something went wrong.';
  if (error.code === 'venice_key_required') return 'Add a Venice API key in Settings.';
  if (error.status === 429) return 'Rate limit reached — try again in a moment.';
  return error.message || 'Something went wrong.';
}

type CopyFeedback = 'idle' | 'copied' | 'failed';

export function AIResult({
  status,
  text,
  error,
  onInsertAtCursor,
  onDismiss,
}: AIResultProps): JSX.Element | null {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  if (status === 'idle' && text === '' && error === null) return null;

  const handleCopy = async (): Promise<void> => {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (!mountedRef.current) return;
      setCopyFeedback('copied');
      copyTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setCopyFeedback('idle');
        copyTimerRef.current = null;
      }, COPIED_FEEDBACK_MS);
    } catch {
      if (!mountedRef.current) return;
      setCopyFeedback('failed');
    }
  };

  const handleInsert = (): void => {
    onInsertAtCursor(text);
    onDismiss();
  };

  return (
    <section
      aria-label="AI result"
      className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800"
    >
      {status === 'error' ? (
        <p role="alert" className="text-red-600">
          {friendlyError(error)}
        </p>
      ) : (
        <>
          <div className="whitespace-pre-wrap break-words">{text}</div>
          {status === 'streaming' && (
            <p role="status" className="mt-2 text-xs italic text-neutral-500">
              Generating…
            </p>
          )}
          {status === 'done' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleInsert}
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
              >
                Insert at cursor
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCopy();
                }}
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
              >
                Dismiss
              </button>
              {copyFeedback === 'copied' && (
                <span role="status" className="text-xs text-green-700">
                  Copied ✓
                </span>
              )}
              {copyFeedback === 'failed' && (
                <span role="alert" className="text-xs text-red-600">
                  Copy failed
                </span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
