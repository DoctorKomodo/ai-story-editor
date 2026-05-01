import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { Button } from '@/design/primitives';
import {
  type ChapterMeta,
  chaptersQueryKey,
  computeReorderedChapters,
  useChaptersQuery,
  useCreateChapterMutation,
  useReorderChaptersMutation,
} from '@/hooks/useChapters';
import { ApiError } from '@/lib/api';

export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
}

function formatWordCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;
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
        'flex items-center gap-2 rounded border px-2 py-2 bg-bg-elevated transition-colors',
        active ? 'border-ink' : 'border-line hover:bg-surface-hover',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-current={active ? 'true' : undefined}
      data-testid={`chapter-row-${chapter.id}`}
    >
      <button
        type="button"
        aria-label="Reorder"
        className="cursor-grab touch-none text-ink-4 hover:text-ink-2 transition-colors px-1"
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
        <span className="block truncate font-sans text-[13px] font-medium text-ink">
          {chapterDisplayTitle(chapter)}
        </span>
        <span className="block font-mono text-[11px] text-ink-3">
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
        className="font-sans text-[12.5px] text-ink-3"
      >
        Loading chapters…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <p
          role="alert"
          data-testid="chapter-list-error"
          className="font-sans text-[12.5px] text-danger"
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
    <div className="flex flex-col gap-3" data-testid="chapter-list">
      <Button
        variant="ghost"
        size="md"
        onClick={handleAdd}
        disabled={createChapter.isPending}
        data-testid="chapter-list-add"
      >
        {createChapter.isPending ? 'Adding…' : 'Add chapter'}
      </Button>

      {list.length === 0 ? (
        <p className="font-sans text-[12.5px] text-ink-3">No chapters yet</p>
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
