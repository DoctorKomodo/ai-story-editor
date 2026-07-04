import type { JSX } from 'react';

export interface DraftRestoreBannerProps {
  /** `Date.now()` the draft was last persisted locally. */
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Informational (not error) banner offered when a chapter loads and a local
 * IndexedDB draft newer than — or equal to — the server's `updatedAt` is
 * found. `role="status"` (not "alert") since this isn't a failure state.
 *
 * No new global key handling: Escape stays owned by the existing selection /
 * modal listener (see keyboard-shortcuts contract in CLAUDE.md).
 */
export function DraftRestoreBanner({
  savedAt,
  onRestore,
  onDiscard,
}: DraftRestoreBannerProps): JSX.Element {
  const time = new Date(savedAt).toLocaleTimeString();

  return (
    <div
      role="status"
      data-testid="draft-restore-banner"
      className="border border-line-2 bg-bg-elevated text-ink rounded-[var(--radius)] p-3 text-[12.5px] font-sans flex items-center gap-2"
    >
      <span className="flex-1 leading-snug">Unsaved draft from {time} found on this device.</span>
      <button
        type="button"
        onClick={onRestore}
        className="px-2 py-0.5 rounded-[var(--radius)] border border-line-2 hover:bg-[var(--surface-hover)] text-[12px]"
      >
        Restore draft
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="px-2 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-[12px]"
      >
        Discard
      </button>
    </div>
  );
}
