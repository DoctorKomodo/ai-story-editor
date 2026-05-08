import { type JSX, type KeyboardEvent, useCallback, useState } from 'react';

/**
 * [SC12] Scene Composer — textarea + Generate / Stop button.
 *
 * Pure presentational. The parent owns state transitions:
 * - `state="idle"`      → shows Generate button (disabled when empty).
 * - `state="streaming"` → locks textarea, swaps Generate for Stop.
 *
 * Keyboard shortcut: Cmd/Ctrl+Enter submits when idle and non-empty.
 */

export interface SceneComposerProps {
  state: 'idle' | 'streaming';
  onGenerate: (text: string) => void;
  onStop: () => void;
}

function StopIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

export function SceneComposer({ state, onGenerate, onStop }: SceneComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const isStreaming = state === 'streaming';
  const canSubmit = !isStreaming && text.trim().length > 0;

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onGenerate(trimmed);
    setText('');
  }, [text, isStreaming, onGenerate]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="border-t border-line p-3 bg-bg flex flex-col gap-2">
      <textarea
        rows={3}
        aria-label="Scene direction"
        placeholder="Describe a scene…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
        disabled={isStreaming}
        className="resize-none bg-bg-sunken border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-ink-3 disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-ink-4">
          {isStreaming ? 'generating… ⎋ to stop' : '⌘↵ to send'}
        </span>
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="px-3 py-1 rounded-[var(--radius)] bg-danger text-bg text-[12px] inline-flex items-center gap-1.5"
          >
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate
          </button>
        )}
      </div>
    </div>
  );
}
