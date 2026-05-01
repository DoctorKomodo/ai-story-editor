import type { JSX } from 'react';
import { IconButton, Spinner } from '@/design/primitives';

interface PlusIconProps {
  className?: string;
}

function PlusIcon({ className }: PlusIconProps): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export interface CastSectionHeaderProps {
  onAdd: () => void;
  pending?: boolean;
}

/**
 * DRAMATIS PERSONAE + section header for the cast list. Stateless. Mirrors
 * the shape of ChapterListSectionHeader.
 */
export function CastSectionHeader({ onAdd, pending = false }: CastSectionHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
      <span
        className="font-mono text-[11px] tracking-[.08em] uppercase text-ink-4"
        data-testid="cast-list-section-label"
      >
        DRAMATIS PERSONAE
      </span>
      <IconButton
        ariaLabel="Add character"
        onClick={onAdd}
        disabled={pending}
        testId="cast-list-add"
      >
        {pending ? <Spinner size={12} /> : <PlusIcon />}
      </IconButton>
    </div>
  );
}
