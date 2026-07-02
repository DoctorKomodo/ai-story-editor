import type { JSX } from 'react';

export interface ChapterConflictBannerProps {
  onReload: () => void;
  onOverwrite: () => void;
  /** Disables both buttons while a reload/overwrite is in flight. */
  busy?: boolean;
}

/**
 * Shown when a chapter PATCH's `expectedUpdatedAt` precondition fails — the
 * chapter changed elsewhere (another tab/device) since this client last read
 * it. Modeled on `InlineErrorBanner.tsx` (`role="alert"`, danger tokens).
 */
export function ChapterConflictBanner({
  onReload,
  onOverwrite,
  busy,
}: ChapterConflictBannerProps): JSX.Element {
  return (
    <div
      role="alert"
      data-testid="chapter-conflict-banner"
      className="border border-[var(--danger)] bg-[var(--bg-sunken)] text-[var(--danger)] rounded-[var(--radius)] p-3 text-[12.5px] font-sans flex items-center gap-2"
    >
      <span className="flex-1 leading-snug">
        This chapter changed elsewhere. Reload it, or overwrite with your version.
      </span>
      <button
        type="button"
        onClick={onReload}
        disabled={busy}
        className="px-2 py-0.5 rounded-[var(--radius)] border border-[var(--danger)] hover:bg-[var(--danger)] hover:text-bg text-[12px]"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={onOverwrite}
        disabled={busy}
        className="px-2 py-0.5 rounded-[var(--radius)] border border-[var(--danger)] hover:bg-[var(--danger)] hover:text-bg text-[12px]"
      >
        Overwrite
      </button>
    </div>
  );
}
