import type { CSSProperties, JSX } from 'react';

export interface UndoToastProps {
  title: string;
  onUndo: () => void;
  timeoutMs?: number;
}

function UndoArrowIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <path d="M9 14l-4-4 4-4" />
      <path d="M5 10h9a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

export function UndoToast({ title, onUndo, timeoutMs = 5000 }: UndoToastProps): JSX.Element {
  const countdownStyle = { '--undo-ms': `${timeoutMs}ms` } as CSSProperties;
  return (
    <div
      role="status"
      aria-live="polite"
      className="t-popover-in relative bg-bg-elevated border border-line-2 rounded-[var(--radius)] shadow-pop overflow-hidden"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-[10px] uppercase tracking-[.08em] font-sans text-ink-4 flex-shrink-0">
          Deleted
        </span>
        <span className="font-serif italic text-[13px] text-ink truncate flex-1 min-w-0">
          &ldquo;{title}&rdquo;
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.08em] text-ink-2 hover:text-ink flex-shrink-0"
        >
          <UndoArrowIcon />
          Undo
        </button>
      </div>
      <div
        aria-hidden="true"
        className="undo-countdown absolute bottom-0 left-0 right-0 h-px bg-ink-5"
        style={countdownStyle}
      />
    </div>
  );
}
