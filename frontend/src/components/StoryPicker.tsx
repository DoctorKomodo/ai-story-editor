// [F30] Story Picker modal — 480px card with story rows (34×44 serif-italic
// initial tile + title + mono metadata). Active row gets the "open" pill and
// `border: 1px solid var(--ink)`. Footer shows "N stories in vault" + Import
// .docx button + primary New story button.
//
// Faithful port of `mockups/frontend-prototype/design/modals.jsx` (the
// `StoryPicker` + `StoryRow` block) using the `.modal-backdrop` / `.modal`
// chrome from `mockups/frontend-prototype/design/styles.css` lines 876–937.
import type { JSX } from 'react';
import { type MouseEvent, useEffect, useId, useRef } from 'react';
import { StoryPickerEmpty } from '@/components/StoryPickerEmpty';
import { useEscape } from '@/hooks/useKeyboardShortcuts';
import { useStoriesQuery } from '@/hooks/useStories';

export interface StoryPickerProps {
  open: boolean;
  onClose: () => void;
  activeStoryId: string | null;
  /** Fires when the user picks a row. Parent navigates; the modal closes itself. */
  onSelectStory: (id: string) => void;
  /** Primary "New story" — parent typically opens the F6 StoryModal. */
  onCreateStory?: () => void;
  /** TODO(future): no backend import endpoint yet. Render the button anyway. */
  onImportDocx?: () => void;
  /**
   * [F58] When true, render only the inner card (no backdrop, no Close
   * button, no Escape registration). Used by the dashboard to surface the
   * picker as a permanent landing surface.
   */
  embedded?: boolean;
}

function CloseIcon(): JSX.Element {
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
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function initialOf(title: string): string {
  const t = title.trim();
  if (t.length === 0) return 'U';
  return t[0]?.toUpperCase() ?? 'U';
}

export function StoryPicker({
  open,
  onClose,
  activeStoryId,
  onSelectStory,
  onCreateStory,
  onImportDocx,
  embedded = false,
}: StoryPickerProps): JSX.Element | null {
  const headingId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Always call hooks unconditionally; the query is cheap when idle.
  const { data: stories, isLoading, isError, error } = useStoriesQuery();

  // Focus the close button when the modal opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open]);

  // [F57] Escape closes the modal — priority 100 via the F47 registry.
  // [F58] Disabled in embedded mode (the picker is a permanent surface,
  // not a dismissable modal).
  useEscape(
    () => {
      onClose();
    },
    { priority: 100, enabled: open && !embedded },
  );

  if (!open) return null;

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSelect = (id: string): void => {
    onSelectStory(id);
    onClose();
  };

  const count = stories?.length ?? 0;

  const card = (
    <div
      role="dialog"
      aria-modal={embedded ? undefined : 'true'}
      aria-labelledby={headingId}
      data-testid="story-picker"
      className={[
        'w-[480px] max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden',
        'rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop',
        embedded ? '' : 't-modal-in fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="px-[18px] py-[14px] border-b border-line flex items-center justify-between">
        <div>
          <h2
            id={headingId}
            className="m-0 font-serif text-[18px] font-medium text-ink tracking-[-0.005em]"
          >
            Your Stories
          </h2>
          <div className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Switch projects or start a new one
          </div>
        </div>
        {!embedded ? (
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            data-testid="story-picker-close"
          >
            <CloseIcon />
          </button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-3" data-testid="story-picker-body">
        {isLoading ? (
          <div className="py-8 text-center font-mono text-[12px] text-ink-4">Loading stories…</div>
        ) : isError ? (
          <div
            role="alert"
            className="py-8 text-center font-mono text-[12px] text-[color:var(--danger)]"
          >
            {error instanceof Error ? error.message : 'Failed to load stories.'}
          </div>
        ) : count === 0 ? (
          <StoryPickerEmpty />
        ) : (
          <div className="grid gap-1">
            {stories?.map((s) => {
              const active = s.id === activeStoryId;
              const target = s.targetWords;
              const wc = s.totalWordCount ?? 0;
              const genre = s.genre ?? null;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`story-picker-row-${s.id}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => {
                    handleSelect(s.id);
                  }}
                  className={[
                    'flex w-full items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] cursor-pointer text-left transition-colors',
                    'hover:bg-[var(--surface-hover)]',
                    active ? 'border border-ink bg-bg-elevated' : 'border border-line bg-bg',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className="grid place-items-center w-[34px] h-[44px] rounded-[var(--radius)] bg-[var(--accent-soft)] font-serif italic text-[18px] text-ink-2 flex-shrink-0"
                  >
                    {initialOf(s.title)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-serif text-[15px] text-ink truncate">
                      {s.title || 'Untitled'}
                    </span>
                    <span className="mt-[2px] block font-mono text-[11px] text-ink-4 truncate">
                      {genre ? `${genre} · ` : ''}
                      {wc.toLocaleString()}
                      {' / '}
                      {target != null ? target.toLocaleString() : '—'}
                    </span>
                  </span>
                  {active ? (
                    <span
                      data-testid={`story-picker-pill-${s.id}`}
                      className="ml-2 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[.08em] bg-[var(--accent-soft)] text-ink"
                    >
                      open
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <footer className="px-[18px] py-3 border-t border-line flex items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-ink-4" data-testid="story-picker-count">
          {count} {count === 1 ? 'story' : 'stories'} in vault
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] border border-line rounded-[var(--radius)] text-ink-2 hover:bg-[var(--surface-hover)] hover:text-ink transition-colors"
            onClick={onImportDocx}
            data-testid="story-picker-import"
          >
            Import .docx
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors"
            onClick={onCreateStory}
            data-testid="story-picker-new"
          >
            New story
          </button>
        </div>
      </footer>
    </div>
  );

  if (embedded) return card;

  return (
    <div
      role="presentation"
      data-testid="story-picker-backdrop"
      onMouseDown={handleBackdropMouseDown}
      className="t-backdrop-in fixed inset-0 z-50 bg-backdrop backdrop-blur-[3px]"
    >
      {card}
    </div>
  );
}
