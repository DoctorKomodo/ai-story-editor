import type { JSX } from 'react';
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
import { Button } from '@/design/primitives';
import type { AICompletionStatus } from '@/hooks/useAICompletion';
import type { ApiError } from '@/lib/api';

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
      data-testid="ai-result"
      className="mt-4 rounded border border-line bg-bg-sunken p-3 font-serif text-[13.5px] leading-[1.55] text-ink-2"
    >
      {status === 'error' ? (
        <p role="alert" className="font-sans text-[12.5px] text-danger">
          {friendlyError(error)}
        </p>
      ) : (
        <>
          <div className="whitespace-pre-wrap break-words">{text}</div>
          {status === 'streaming' && (
            <p role="status" className="mt-2 font-mono text-[11px] italic text-ink-3">
              Generating…
            </p>
          )}
          {status === 'done' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="md" onClick={handleInsert}>
                Insert at cursor
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  void handleCopy();
                }}
              >
                Copy
              </Button>
              <Button variant="ghost" size="md" onClick={onDismiss}>
                Dismiss
              </Button>
              {copyFeedback === 'copied' && (
                <span role="status" className="font-mono text-[11px] text-accent">
                  Copied ✓
                </span>
              )}
              {copyFeedback === 'failed' && (
                <span role="alert" className="font-mono text-[11px] text-danger">
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
