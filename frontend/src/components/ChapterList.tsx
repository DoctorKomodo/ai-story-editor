import { useCallback, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import {
  chaptersQueryKey,
  computeReorderedChapters,
  useChaptersQuery,
  useCreateChapterMutation,
  useReorderChaptersMutation,
  type Chapter,
} from '@/hooks/useChapters';

export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
}

function formatWordCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;
}

function chapterDisplayTitle(c: Chapter): string {
  const trimmed = c.title.trim();
  if (trimmed.length > 0) return trimmed;
  return `Chapter ${String(c.orderIndex + 1)}`;
}

interface ChapterRowProps {
  chapter: Chapter;
  active: boolean;
  onSelect: (id: string) => void;
}

/**
 * Single row. Uses `useSortable` so F11's drag-to-reorder works; for F10 the
 * drag handle exists but only does anything once the DndContext is wired
 * (it is — see ChapterList below). The whole row is a button except for the
 * drag handle itself, which sits to the left and captures pointer events so
 * a drag does not fire the row's click.
 */
function ChapterRow({ chapter, active, onSelect }: ChapterRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chapter.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-2 rounded border px-2 py-2 bg-white',
        active ? 'border-neutral-800' : 'border-neutral-200',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-current={active ? 'true' : undefined}
    >
      <button
        type="button"
        aria-label="Reorder"
        className="cursor-grab touch-none text-neutral-400 hover:text-neutral-700 px-1"
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">::</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onSelect(chapter.id);
        }}
        className="flex-1 min-w-0 text-left"
      >
        <span className="block truncate text-sm font-medium text-neutral-900">
          {chapterDisplayTitle(chapter)}
        </span>
        <span className="block text-xs text-neutral-500">
          {formatWordCount(chapter.wordCount)}
        </span>
      </button>
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
      const current = queryClient.getQueryData<Chapter[]>(chaptersQueryKey(storyId));
      if (current === undefined) return;
      const next = computeReorderedChapters(current, activeId, overId);
      if (next === null) return;
      setReorderStatus('');
      reorderChapters.mutate(next, {
        onError: (err: Error) => {
          const message =
            err instanceof ApiError
              ? 'Reorder failed — reverted'
              : 'Reorder failed — reverted';
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
      <div role="status" aria-live="polite" className="text-sm text-neutral-500">
        Loading chapters…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-600">
          Could not load chapters{error instanceof Error && error.message ? `: ${error.message}` : ''}
        </p>
      </div>
    );
  }

  const list = chapters ?? [];
  const ids = list.map((c) => c.id);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleAdd}
        disabled={createChapter.isPending}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
      >
        {createChapter.isPending ? 'Adding…' : 'Add chapter'}
      </button>

      {list.length === 0 ? (
        <p className="text-sm text-neutral-500">No chapters yet</p>
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
