import type { JSX } from 'react';
import { Spinner } from '@/design/primitives';
import type { SummaryState } from '@/hooks/useChapterSummary';

export interface SummaryStateIconProps {
  state: SummaryState;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaPressed: boolean;
}

const labelByState: Record<SummaryState, string> = {
  missing: 'No summary yet — click to generate',
  current: 'Summary present — click to view',
  stale: 'Summary possibly stale — click to view',
  generating: 'Generating summary…',
  corrupted: 'Summary unreadable — click to regenerate',
};

export function SummaryStateIcon({
  state,
  onClick,
  ariaPressed,
}: SummaryStateIconProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={labelByState[state]}
      aria-pressed={ariaPressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={labelByState[state]}
      className="flex-shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-ink-4 hover:text-ink-2 transition-colors"
    >
      {state === 'missing' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      )}
      {state === 'current' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3" fill="currentColor" />
        </svg>
      )}
      {state === 'stale' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3" fill="currentColor" />
          <circle cx="8.5" cy="1.5" r="1.5" className="text-accent" fill="currentColor" />
        </svg>
      )}
      {state === 'generating' && <Spinner size={10} />}
      {state === 'corrupted' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="text-danger">
          <path d="M5 1 L9 9 L1 9 Z" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M5 4 L5 6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <circle cx="5" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
