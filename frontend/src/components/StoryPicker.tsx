// [F30] Story Picker modal — 480px card with story rows (34×44 serif-italic
// initial tile + title + mono metadata). Active row gets the "open" pill and
// `border: 1px solid var(--ink)`. Footer shows the vault count plus the New
// story / Import .docx buttons when their handlers are wired.
//
// Faithful port of `mockups/frontend-prototype/design/modals.jsx` (the
// `StoryPicker` + `StoryRow` block).
//
// [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
// focus management, and close-X chrome all live in the primitive now. Embedded
// mode (F58 — dashboard surface) passes `embedded` through to the primitive.
//
// [story-editor-0wz] Per-row delete: a hover-revealed trash icon (mirrors
// ChatSceneTab/SessionPicker's row-icon idiom) opens a <ConfirmDialog>;
// confirming schedules a 5s soft-delete/undo (useSoftDelete, same shape as
// ChatSceneTab's) before the real DELETE fires.
import { type JSX, useId, useState } from 'react';
import { StoryPickerEmpty } from '@/components/StoryPickerEmpty';
import { UndoToast } from '@/components/UndoToast';
import {
  Button,
  ConfirmDialog,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@/design/primitives';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useDeleteStoryMutation, useStoriesQuery } from '@/hooks/useStories';

export interface StoryPickerProps {
  open: boolean;
  onClose: () => void;
  activeStoryId: string | null;
  /** Fires when the user picks a row. Parent navigates; the modal closes itself. */
  onSelectStory: (id: string) => void;
  /** Primary "New story" — parent typically opens the F6 StoryModal. */
  onCreateStory?: () => void;
  /** TODO(future): no backend import endpoint yet; the button stays hidden until an onImportDocx handler is wired. */
  onImportDocx?: () => void;
  /**
   * Fires once a story's real DELETE has resolved. A parent that also knows
   * which story id is currently open (e.g. the route) can compare and
   * navigate away — this component has no notion of "currently open" beyond
   * the `activeStoryId` prop it already renders the pill from.
   */
  onStoryDeleted?: (id: string) => void;
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

function TrashIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function StoryPicker({
  open,
  onClose,
  activeStoryId,
  onSelectStory,
  onCreateStory,
  onImportDocx,
  onStoryDeleted,
  embedded = false,
}: StoryPickerProps): JSX.Element | null {
  const headingId = useId();
  const { data: stories, isLoading, isError, error } = useStoriesQuery();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const deleteStoryMutation = useDeleteStoryMutation();
  const {
    pending: pendingDeletes,
    isPending: isDeletePending,
    scheduleDelete,
    undo: undoDelete,
  } = useSoftDelete(
    (id: string) => deleteStoryMutation.mutateAsync(id).then(() => onStoryDeleted?.(id)),
    { timeoutMs: 5_000 },
  );

  const handleSelect = (id: string): void => {
    onSelectStory(id);
    onClose();
  };

  const count = stories?.length ?? 0;
  const visibleStories = (stories ?? []).filter((s) => !isDeletePending(s.id));
  const confirmingStory = stories?.find((s) => s.id === confirmingId) ?? null;
  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

  const handleConfirmDelete = (): void => {
    if (confirmingId === null) return;
    scheduleDelete(confirmingId, confirmingStory?.title || 'Untitled');
    setConfirmingId(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={headingId}
      size="md"
      dismissable={confirmingStory === null}
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
            {visibleStories.map((s) => {
              const active = s.id === activeStoryId;
              const target = s.targetWords;
              const wc = s.totalWordCount ?? 0;
              const genre = s.genre ?? null;
              const title = s.title || 'Untitled';
              return (
                // biome-ignore lint/a11y/useSemanticElements: a real <button> can't host the nested delete IconButton (no interactive-in-interactive nesting) — mirrors SessionPicker's row idiom.
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`story-picker-row-${s.id}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => {
                    handleSelect(s.id);
                  }}
                  onKeyDown={(e) => {
                    // Ignore keydowns bubbling up from the nested delete
                    // button so focusing/activating it doesn't also select
                    // the row.
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(s.id);
                    }
                  }}
                  className={[
                    'group flex w-full items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] cursor-pointer text-left transition-colors',
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
                    <span className="block font-serif text-[15px] text-ink truncate">{title}</span>
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
                  <IconButton
                    ariaLabel={`Delete "${title}"`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(s.id);
                    }}
                    testId={`story-picker-row-${s.id}-delete`}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <TrashIcon />
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
      </ModalBody>

      <div className="relative">
        {lastPending !== null ? (
          <div className="absolute left-3 right-3 bottom-[calc(100%+8px)] z-20">
            <UndoToast
              key={lastPending[0]}
              title={lastPending[1].title}
              onUndo={() => {
                undoDelete(lastPending[0]);
              }}
              timeoutMs={5000}
            />
          </div>
        ) : null}
        <ModalFooter
          leading={
            <span data-testid="story-picker-count">
              {count} {count === 1 ? 'story' : 'stories'} in vault
            </span>
          }
        >
          {onImportDocx ? (
            <Button variant="ghost" onClick={onImportDocx} data-testid="story-picker-import">
              Import .docx
            </Button>
          ) : null}
          {onCreateStory ? (
            <Button variant="primary" onClick={onCreateStory} data-testid="story-picker-new">
              New story
            </Button>
          ) : null}
        </ModalFooter>
      </div>

      {confirmingStory ? (
        <ConfirmDialog
          open
          title={`Delete "${confirmingStory.title || 'Untitled'}"?`}
          body="This permanently removes the story and all its chapters, characters, outline, and chats."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setConfirmingId(null);
          }}
          testId="story-picker-delete-confirm"
        />
      ) : null}
    </Modal>
  );
}
