import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useRef, useState } from 'react';
import type { DraftMeta } from 'story-editor-shared';
import {
  CloseIcon,
  IconButton,
  InlineConfirm,
  InlineEdit,
  revealOnRowHover,
  useInlineConfirm,
} from '@/design/primitives';
import {
  activeDraftIdOf,
  draftDisplayLabel,
  draftsQueryKey,
  useDeleteDraftMutation,
  useDraftsQuery,
  useSetActiveDraftMutation,
  useUpdateDraftMutation,
} from '@/hooks/useDrafts';
import { ApiError } from '@/lib/api';
import { formatWordCountCompact } from '@/lib/formatWordCount';
import { useSelectedDraftStore } from '@/store/selectedDraft';

export interface DraftListProps {
  chapterId: string;
  storyId: string;
  /** The draft open in the editor (EditorPage's viewedDraftId), or null. */
  viewedDraftId: string | null;
  onSelectDraft: (chapterId: string, draftId: string) => void;
  onRequestNewDraft: (chapterId: string) => void;
  /** Sink into ChapterList's aria-live status region. */
  onStatus: (message: string) => void;
}

interface DraftRowProps {
  draft: DraftMeta;
  displayLabel: string;
  viewed: boolean;
  editing: boolean;
  onSelect: () => void;
  onSetActive: () => void;
  onStartRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onRequestDelete: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * One draft child row. Anatomy mirrors ChapterRow at three-quarter scale:
 * active dot · label · word count · hover actions (★ set active, ✎ rename,
 * delete — never on the active row, parent spec §7).
 */
function DraftRow({
  draft,
  displayLabel,
  viewed,
  editing,
  onSelect,
  onSetActive,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  isDeleting,
}: DraftRowProps): JSX.Element {
  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);

  const onConfirmDelete = async (): Promise<void> => {
    try {
      await onRequestDelete();
      confirm.dismiss();
    } catch {
      // Failure surfaced via ChapterList's aria-live region (onStatus); keep
      // the confirm open so the user can retry or cancel.
    }
  };

  return (
    <li
      ref={liRef}
      data-testid={`draft-row-${draft.id}`}
      aria-current={viewed ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-10 pr-2 h-7 rounded-[var(--radius)]',
        'transition-colors',
        viewed ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
      ].join(' ')}
    >
      {draft.isActive ? (
        <span
          role="img"
          aria-label="Active draft"
          className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0"
        />
      ) : (
        <span aria-hidden="true" className="w-1.5 h-1.5 flex-shrink-0" />
      )}
      {editing ? (
        <InlineEdit
          initialValue={draft.label ?? ''}
          placeholder={displayLabel}
          ariaLabel="Rename draft"
          onCommit={onCommitRename}
          onCancel={onCancelRename}
          testId={`draft-row-${draft.id}-rename`}
        />
      ) : confirm.open ? (
        <InlineConfirm
          {...confirm.props}
          label={`Delete ${displayLabel}`}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          pending={isDeleting}
          testId={`draft-row-${draft.id}-confirm`}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            className="flex-1 min-w-0 text-left font-sans text-[12.5px] text-ink-2 leading-tight truncate"
          >
            {displayLabel}
          </button>
          <span className="font-mono text-[11px] text-ink-4 tabular-nums flex-shrink-0">
            {formatWordCountCompact(draft.wordCount)}
          </span>
          <span className={['flex items-center gap-0.5 flex-shrink-0', revealOnRowHover].join(' ')}>
            {draft.isActive ? null : (
              <IconButton
                ariaLabel={`Set ${displayLabel} as active draft`}
                onClick={onSetActive}
                testId={`draft-row-${draft.id}-set-active`}
              >
                <span aria-hidden="true">★</span>
              </IconButton>
            )}
            <IconButton
              ariaLabel={`Rename ${displayLabel}`}
              onClick={onStartRename}
              testId={`draft-row-${draft.id}-rename-button`}
            >
              <span aria-hidden="true">✎</span>
            </IconButton>
            {draft.isActive ? null : (
              <IconButton
                ariaLabel={`Delete ${displayLabel}`}
                onClick={confirm.ask}
                testId={`draft-row-${draft.id}-delete`}
              >
                <CloseIcon />
              </IconButton>
            )}
          </span>
        </>
      )}
    </li>
  );
}

export function DraftList({
  chapterId,
  storyId,
  viewedDraftId,
  onSelectDraft,
  onRequestNewDraft,
  onStatus,
}: DraftListProps): JSX.Element {
  const { data } = useDraftsQuery(chapterId);
  const drafts = data ?? [];
  const activeId = activeDraftIdOf(data);
  const qc = useQueryClient();

  const setActiveDraft = useSetActiveDraftMutation();
  const deleteDraft = useDeleteDraftMutation();
  const updateDraft = useUpdateDraftMutation();

  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // D9 membership test: draft ids are chapter-unique, so "the viewed draft is
  // in THIS list" ⇔ "this chapter is open in the editor".
  const viewedHere = viewedDraftId !== null && drafts.some((d) => d.id === viewedDraftId);

  const handleSetActive = (draftId: string): void => {
    onStatus('');
    // D9: activating while the editor follows the active draft would jump
    // the view to the new active mid-edit. Pin the current view first — only
    // the dot moves. (No-op when this chapter isn't the open one.)
    if (viewedHere && viewedDraftId !== null) {
      useSelectedDraftStore.getState().setSelectedDraft(chapterId, viewedDraftId);
    }
    setActiveDraft.mutate(
      { chapterId, storyId, draftId, previousActiveDraftId: activeId },
      {
        onError: () => {
          onStatus('Could not set the active draft — try again');
          void qc.invalidateQueries({ queryKey: draftsQueryKey(chapterId) });
        },
      },
    );
  };

  const handleCommitRename = (draft: DraftMeta, value: string): void => {
    setEditingDraftId(null);
    const label = value.length === 0 ? null : value;
    if (label === draft.label) return;
    onStatus('');
    updateDraft.mutate(
      { draftId: draft.id, chapterId, storyId, input: { label } },
      {
        onError: () => {
          onStatus('Rename failed — try again');
        },
      },
    );
  };

  const handleRequestDelete = async (draftId: string): Promise<void> => {
    onStatus('');
    setPendingDeleteId(draftId);
    try {
      await deleteDraft.mutateAsync({ chapterId, storyId, draftId });
      if (useSelectedDraftStore.getState().selected?.draftId === draftId) {
        useSelectedDraftStore.getState().clearSelectedDraft();
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'cannot_delete_active_draft'
          ? 'Draft is now active elsewhere — refreshed'
          : 'Delete failed — try again';
      onStatus(message);
      // Resync: the 409 race codes mean our list is stale.
      void qc.invalidateQueries({ queryKey: draftsQueryKey(chapterId) });
      throw err;
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <ul
      id={`draft-list-${chapterId}`}
      className="flex flex-col gap-0.5 py-0.5"
      data-testid={`draft-list-${chapterId}`}
    >
      {drafts.map((d) => (
        <DraftRow
          key={d.id}
          draft={d}
          displayLabel={draftDisplayLabel(d)}
          viewed={d.id === viewedDraftId}
          editing={editingDraftId === d.id}
          onSelect={() => {
            onSelectDraft(chapterId, d.id);
          }}
          onSetActive={() => {
            handleSetActive(d.id);
          }}
          onStartRename={() => {
            setEditingDraftId(d.id);
          }}
          onCommitRename={(value) => {
            handleCommitRename(d, value);
          }}
          onCancelRename={() => {
            setEditingDraftId(null);
          }}
          onRequestDelete={() => handleRequestDelete(d.id)}
          isDeleting={pendingDeleteId === d.id}
        />
      ))}
      <li className="pl-10 pr-2">
        <button
          type="button"
          aria-label="New draft…"
          onClick={() => {
            onRequestNewDraft(chapterId);
          }}
          data-testid={`draft-list-${chapterId}-new`}
          className="w-full text-left font-sans text-[12px] text-ink-4 hover:text-ink-2 h-6 transition-colors"
        >
          ＋ New draft…
        </button>
      </li>
    </ul>
  );
}
