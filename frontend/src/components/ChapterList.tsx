import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { ChapterListSectionHeader } from '@/components/ChapterListSectionHeader';
import { GripIcon } from '@/design/primitives';
import {
  type ChapterMeta,
  chaptersQueryKey,
  computeReorderedChapters,
  useChaptersQuery,
  useCreateChapterMutation,
  useReorderChaptersMutation,
} from '@/hooks/useChapters';
import { ApiError } from '@/lib/api';
import { formatWordCountCompact } from '@/lib/formatWordCount';

export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
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
}

/**
 * Single row. Uses `useSortable` so drag-to-reorder works. The grip handle
 * sits to the left and captures pointer events so a drag does not fire the
 * row's click. Task 12 extends ChapterRowProps with onRequestDelete +
 * isDeleting — do not add those here.
 */
function ChapterRow({ chapter, active, onSelect }: ChapterRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: chapter.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-active={active ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`chapter-row-${chapter.id}`}
      aria-current={active ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-3 pr-2 h-8 rounded-[var(--radius)]',
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
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'is-coarse-pointer-visible',
          'flex-shrink-0',
        ].join(' ')}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <span
        aria-hidden="true"
        className="font-mono text-[11px] text-ink-4 tabular-nums w-5 flex-shrink-0"
      >
        {String(chapter.orderIndex + 1).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => {
          onSelect(chapter.id);
        }}
        className="flex-1 min-w-0 text-left font-serif text-[14px] text-ink leading-tight truncate"
      >
        {chapterDisplayTitle(chapter)}
      </button>
      <span className="font-mono text-[11px] text-ink-4 tabular-nums w-14 flex-shrink-0 text-right">
        {formatWordCountCompact(chapter.wordCount)}
      </span>
    </li>
  );
}

export function ChapterList({
  storyId,
  activeChapterId,
  onSelectChapter,
}: ChapterListProps): JSX.Element {
  const { data: chapters, isLoading, isError, error } = useChaptersQuery(storyId);
  const createChapter = useCreateChapterMutation(storyId);
  const reorderChapters = useReorderChaptersMutation(storyId);
  const queryClient = useQueryClient();

  const [reorderStatus, setReorderStatus] = useState<string>('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
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
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {reorderStatus}
      </div>
    </div>
  );
}
