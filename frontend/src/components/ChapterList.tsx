import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChapterMeta } from 'story-editor-shared';
import { ChapterListSectionHeader } from '@/components/ChapterListSectionHeader';
import { DraftList } from '@/components/DraftList';
import {
  CloseIcon,
  GripIcon,
  IconButton,
  InlineConfirm,
  revealOnRowHover,
  useInlineConfirm,
} from '@/design/primitives';
import { deriveListSummaryState } from '@/hooks/useChapterSummary';
import {
  chaptersQueryKey,
  computeReorderedChapters,
  useChaptersQuery,
  useCreateChapterMutation,
  useDeleteChapterMutation,
  useReorderChaptersMutation,
} from '@/hooks/useChapters';
import { ApiError } from '@/lib/api';
import { formatWordCountCompact } from '@/lib/formatWordCount';
import { SummaryStateIcon } from './SummaryStateIcon';

export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  /**
   * Called after a chapter is successfully deleted. Lets the parent clear
   * `activeChapterId` if the active chapter was removed (otherwise the
   * editor would render against a dead id). Optional.
   */
  onChapterDeleted?: (chapterId: string) => void;
  onOpenSummary: (chapterId: string, anchorEl: HTMLElement) => void;
  /** Id of the chapter whose summary popover is currently open. Controls aria-pressed on its icon. */
  openPopoverChapterId?: string | null;
  /** [9wk.7] The draft open in the editor — highlights its row in the tree. */
  viewedDraftId: string | null;
  /** [9wk.7] Draft row clicked (chapter + draft pair, set atomically upstream). */
  onSelectDraft: (chapterId: string, draftId: string) => void;
  /** [9wk.7] ＋ affordances — opens the new-draft dialog for the chapter. */
  onRequestNewDraft: (chapterId: string) => void;
}

function chapterDisplayTitle(c: ChapterMeta): string {
  const trimmed = c.title.trim();
  if (trimmed.length > 0) return trimmed;
  return `Chapter ${String(c.orderIndex + 1)}`;
}

interface ChapterRowProps {
  chapter: ChapterMeta;
  active: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (chapterId: string) => Promise<void>;
  isDeleting: boolean;
  onOpenSummary: (chapterId: string, anchorEl: HTMLElement) => void;
  popoverOpen: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  showNewDraftAffordance: boolean;
  onRequestNewDraft: (chapterId: string) => void;
  children?: ReactNode;
}

/**
 * Single row. Uses `useSortable` so drag-to-reorder works. The grip handle
 * sits to the left and captures pointer events so a drag does not fire the
 * row's click. The × delete button is always mounted (opacity-revealed on
 * hover or when the row is active) so selecting a row never reflows it;
 * clicking it opens an InlineConfirm that replaces the word-count slot.
 */
function ChapterRow({
  chapter,
  active,
  onSelect,
  onRequestDelete,
  isDeleting,
  onOpenSummary,
  popoverOpen,
  expanded,
  onToggleExpanded,
  showNewDraftAffordance,
  onRequestNewDraft,
  children,
}: ChapterRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: chapter.id });

  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);

  const setRefs = (node: HTMLLIElement | null): void => {
    liRef.current = node;
    setNodeRef(node);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const onConfirmDelete = async (): Promise<void> => {
    try {
      await onRequestDelete(chapter.id);
      confirm.dismiss();
    } catch {
      // Mutation surfaces error via parent's aria-live region; keep the
      // confirm open so the user can retry.
    }
  };

  return (
    <li
      ref={setRefs}
      style={style}
      data-active={active ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`chapter-row-${chapter.id}`}
      aria-current={active ? 'true' : undefined}
    >
      <div
        className={[
          'group flex items-center gap-1.5 pl-3 pr-2 h-8 rounded-[var(--radius)]',
          'transition-colors cursor-pointer',
          active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
          isOver ? 'ring-1 ring-ink' : '',
          isDragging ? 'opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <button
          type="button"
          aria-label="Reorder"
          data-testid={`chapter-row-${chapter.id}-grip`}
          className={[
            'grip cursor-grab touch-none text-ink-4 hover:text-ink-2',
            revealOnRowHover,
            'flex-shrink-0',
          ].join(' ')}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
        <span
          aria-hidden="true"
          className="font-mono text-[10px] text-ink-4 tabular-nums w-4 flex-shrink-0"
        >
          {String(chapter.orderIndex + 1).padStart(2, '0')}
        </span>
        {chapter.draftCount > 1 ? (
          <button
            type="button"
            aria-label="Show drafts"
            aria-expanded={expanded}
            aria-controls={`draft-list-${chapter.id}`}
            data-testid={`chapter-row-${chapter.id}-caret`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
            className="w-3 flex-shrink-0 text-ink-4 hover:text-ink-2 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
          >
            <span aria-hidden="true">▸</span>
          </button>
        ) : (
          <span aria-hidden="true" className="w-3 flex-shrink-0" />
        )}
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => {
              onSelect(chapter.id);
            }}
            className="w-full text-left font-serif text-[13px] text-ink leading-tight truncate"
          >
            {chapterDisplayTitle(chapter)}
          </button>
          {/* Word count overlays the title's tail on hover and fades into the
              row background, so revealing it never reflows the title (item 4). */}
          <span
            className={[
              'pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end pl-6 pr-0.5',
              'font-mono text-[11px] text-ink-4 tabular-nums',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              active
                ? '[background-image:linear-gradient(to_right,transparent,var(--accent-soft)_20px)]'
                : '[background-image:linear-gradient(to_right,transparent,var(--surface-hover)_20px)]',
            ].join(' ')}
          >
            {formatWordCountCompact(chapter.wordCount)}
          </span>
        </div>
        {confirm.open ? (
          <InlineConfirm
            {...confirm.props}
            label={`Delete ${chapterDisplayTitle(chapter)}`}
            onConfirm={() => {
              void onConfirmDelete();
            }}
            pending={isDeleting}
            testId={`chapter-row-${chapter.id}-confirm`}
          />
        ) : (
          <>
            {/* list-meta derivation never returns 'generating' (mutation state) or 'corrupted' (requires detail) */}
            <SummaryStateIcon
              state={deriveListSummaryState({
                hasSummary: chapter.hasSummary,
                summaryIsStale: chapter.summaryIsStale,
              })}
              ariaPressed={popoverOpen}
              onClick={(e) => {
                onOpenSummary(chapter.id, e.currentTarget);
              }}
            />
            <span
              className={[
                'flex items-center gap-2 flex-shrink-0',
                // Order-INDEPENDENT reveal: on the active row use opacity-100
                // directly (omit revealOnRowHover's opacity-0 entirely) so
                // visibility never depends on Tailwind's compiled class order;
                // inactive rows reveal on hover/focus via revealOnRowHover.
                active ? 'opacity-100' : revealOnRowHover,
              ].join(' ')}
            >
              {showNewDraftAffordance ? (
                <IconButton
                  ariaLabel="New draft"
                  onClick={() => {
                    onRequestNewDraft(chapter.id);
                  }}
                  testId={`chapter-row-${chapter.id}-new-draft`}
                  className="flex-shrink-0"
                >
                  <span aria-hidden="true">＋</span>
                </IconButton>
              ) : null}
              <IconButton
                ariaLabel={`Delete ${chapterDisplayTitle(chapter)}`}
                onClick={confirm.ask}
                testId={`chapter-row-${chapter.id}-delete`}
                className="flex-shrink-0"
              >
                <CloseIcon />
              </IconButton>
            </span>
          </>
        )}
      </div>
      {children}
    </li>
  );
}

export function ChapterList({
  storyId,
  activeChapterId,
  onSelectChapter,
  onChapterDeleted,
  onOpenSummary,
  openPopoverChapterId,
  viewedDraftId,
  onSelectDraft,
  onRequestNewDraft,
}: ChapterListProps): JSX.Element {
  const { data: chapters, isLoading, isError, error } = useChaptersQuery(storyId);
  const createChapter = useCreateChapterMutation(storyId);
  const reorderChapters = useReorderChaptersMutation(storyId);
  const queryClient = useQueryClient();

  const [reorderStatus, setReorderStatus] = useState<string>('');

  const deleteChapter = useDeleteChapterMutation(storyId);
  const [deleteStatus, setDeleteStatus] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [draftStatus, setDraftStatus] = useState<string>('');

  // [9wk.7] D4 — caret expansion. Manual toggles override the default
  // (default: expanded iff the chapter is open in the editor). Ephemeral;
  // cleared when the story changes.
  const [expandOverrides, setExpandOverrides] = useState<Map<string, boolean>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: storyId change invalidates the overrides.
  useEffect(() => {
    setExpandOverrides(new Map());
  }, [storyId]);

  const isExpanded = useCallback(
    (chapter: ChapterMeta): boolean => {
      if (chapter.draftCount <= 1) return false;
      return expandOverrides.get(chapter.id) ?? chapter.id === activeChapterId;
    },
    [expandOverrides, activeChapterId],
  );

  const toggleExpanded = useCallback(
    (chapter: ChapterMeta): void => {
      setExpandOverrides((prev) => {
        const next = new Map(prev);
        const current = prev.get(chapter.id) ?? chapter.id === activeChapterId;
        next.set(chapter.id, !current);
        return next;
      });
    },
    [activeChapterId],
  );

  const handleRequestDelete = useCallback(
    async (chapterId: string): Promise<void> => {
      setDeleteStatus('');
      setPendingDeleteId(chapterId);
      try {
        await deleteChapter.mutateAsync({ chapterId });
        if (onChapterDeleted) onChapterDeleted(chapterId);
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Chapter already removed — refreshed'
            : 'Delete failed — try again';
        setDeleteStatus(message);
        throw err;
      } finally {
        setPendingDeleteId(null);
      }
    },
    [deleteChapter, onChapterDeleted],
  );

  // Mouse: 4px activation distance.
  // Touch: 200ms long-press, 5px tolerance — lets the user scroll the list
  //        without accidentally lifting a row.
  // Keyboard: Space lifts/drops, arrow keys reorder, Escape cancels.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleAdd = useCallback((): void => {
    createChapter.mutate(
      { title: 'Untitled chapter' },
      {
        onSuccess: (created) => {
          onSelectChapter(created.id);
        },
      },
    );
  }, [createChapter, onSelectChapter]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const current = queryClient.getQueryData<ChapterMeta[]>(chaptersQueryKey(storyId));
      if (current === undefined) return;
      const next = computeReorderedChapters(current, activeId, overId);
      if (next === null) return;
      setReorderStatus('');
      reorderChapters.mutate(next, {
        onError: (err: Error) => {
          const message =
            err instanceof ApiError ? 'Reorder failed — reverted' : 'Reorder failed — reverted';
          setReorderStatus(message);
        },
        onSuccess: () => {
          setReorderStatus('');
        },
      });
    },
    [queryClient, reorderChapters, storyId],
  );

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="chapter-list-loading"
        className="font-sans text-[12.5px] text-ink-3 px-3"
      >
        Loading chapters…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col">
        <p
          role="alert"
          data-testid="chapter-list-error"
          className="font-sans text-[12.5px] text-danger px-3"
        >
          Could not load chapters
          {error instanceof Error && error.message ? `: ${error.message}` : ''}
        </p>
      </div>
    );
  }

  const list = chapters ?? [];
  const ids = list.map((c) => c.id);

  return (
    <div className="flex flex-col" data-testid="chapter-list">
      <ChapterListSectionHeader onAdd={handleAdd} pending={createChapter.isPending} />

      {list.length === 0 ? (
        <p className="font-sans text-[12.5px] text-ink-3 px-3">No chapters yet</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-1">
              {list.map((c) => (
                <ChapterRow
                  key={c.id}
                  chapter={c}
                  active={c.id === activeChapterId}
                  onSelect={onSelectChapter}
                  onRequestDelete={handleRequestDelete}
                  isDeleting={pendingDeleteId === c.id}
                  onOpenSummary={onOpenSummary}
                  popoverOpen={openPopoverChapterId === c.id}
                  expanded={isExpanded(c)}
                  onToggleExpanded={() => {
                    toggleExpanded(c);
                  }}
                  showNewDraftAffordance={c.draftCount === 1}
                  onRequestNewDraft={onRequestNewDraft}
                >
                  {isExpanded(c) ? (
                    <DraftList
                      chapterId={c.id}
                      storyId={storyId}
                      viewedDraftId={viewedDraftId}
                      onSelectDraft={onSelectDraft}
                      onRequestNewDraft={onRequestNewDraft}
                      onStatus={setDraftStatus}
                    />
                  ) : null}
                </ChapterRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {[reorderStatus, deleteStatus, draftStatus].filter(Boolean).join(' ')}
      </div>
    </div>
  );
}
