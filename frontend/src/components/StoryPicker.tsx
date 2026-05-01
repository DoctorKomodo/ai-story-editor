// [F30] Story Picker modal — 480px card with story rows (34×44 serif-italic
// initial tile + title + mono metadata). Active row gets the "open" pill and
// `border: 1px solid var(--ink)`. Footer shows "N stories in vault" + Import
// .docx button + primary New story button.
//
// Faithful port of `mockups/frontend-prototype/design/modals.jsx` (the
// `StoryPicker` + `StoryRow` block).
//
// [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
// focus management, and close-X chrome all live in the primitive now. Embedded
// mode (F58 — dashboard surface) passes `embedded` through to the primitive.
import type { JSX } from 'react';
import { useId } from 'react';
import { StoryPickerEmpty } from '@/components/StoryPickerEmpty';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';
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
  const { data: stories, isLoading, isError, error } = useStoriesQuery();

  const handleSelect = (id: string): void => {
    onSelectStory(id);
    onClose();
  };

  const count = stories?.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={headingId}
      size="md"
      embedded={embedded}
      testId="story-picker"
    >
      <ModalHeader
        titleId={headingId}
        title="Your Stories"
        subtitle="Switch projects or start a new one"
        onClose={embedded ? undefined : onClose}
        closeTestId="story-picker-close"
      />

      <ModalBody data-testid="story-picker-body">
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
      </ModalBody>

      <ModalFooter
        leading={
          <span data-testid="story-picker-count">
            {count} {count === 1 ? 'story' : 'stories'} in vault
          </span>
        }
      >
        <Button variant="ghost" onClick={onImportDocx} data-testid="story-picker-import">
          Import .docx
        </Button>
        <Button variant="primary" onClick={onCreateStory} data-testid="story-picker-new">
          New story
        </Button>
      </ModalFooter>
    </Modal>
  );
}
