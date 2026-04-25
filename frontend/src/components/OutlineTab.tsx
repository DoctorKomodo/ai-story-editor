import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import {
  computeReorderedOutline,
  type OutlineItem,
  outlineQueryKey,
  useOutlineQuery,
  useReorderOutlineMutation,
} from '@/hooks/useOutline';

/**
 * F29 — Outline (Story Arc) sidebar tab.
 *
 * Renders the story's outline items as a single Story Arc section. Each row
 * shows a 6px circular bullet anchored at `(left: 12px, top: 12px)` whose
 * colour reflects the item's `status`:
 *
 * - `done`             → green bullet
 * - `active`           → black bullet + 3px halo ring
 * - `queued` / unknown → `--ink-5`
 *
 * Drag-to-reorder uses dnd-kit + the [B8] reorder endpoint with optimistic
 * cache update + revert-on-failure (mirrors F11's chapter reorder).
 *
 * `onAddItem` and `onEditItem` are wired by the parent — this component is
 * dumb about who creates / edits the items.
 */
export interface OutlineTabProps {
  storyId: string;
  onAddItem?: () => void;
  onEditItem?: (id: string) => void;
}

/**
 * Map a backend status string to one of the three styling buckets the mockup
 * defines. Anything outside the known set falls back to `'queued'` so unknown
 * statuses render the default bullet.
 */
function statusBucket(raw: string): 'done' | 'active' | 'queued' {
  if (raw === 'done') return 'done';
  if (raw === 'active') return 'active';
  return 'queued';
}

interface SortableOutlineItemProps {
  item: OutlineItem;
  onEdit?: (id: string) => void;
}

function SortableOutlineItem({ item, onEdit }: SortableOutlineItemProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const bucket = statusBucket(item.status);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'outline-item',
        `outline-item-${bucket}`,
        'relative list-none rounded-[var(--radius)] cursor-pointer',
        'hover:bg-[var(--surface-hover)]',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-status={bucket}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => onEdit?.(item.id)}
        className="block w-full text-left pl-7 pr-2.5 py-1.5 text-[13px] text-ink-2"
      >
        <span
          aria-hidden="true"
          className={`outline-bullet outline-bullet-${bucket}`}
          data-testid={`outline-bullet-${item.id}`}
        />
        <span className="block truncate">{item.title}</span>
        {item.sub !== null && item.sub.length > 0 ? (
          <span className="sub block text-[11px] text-ink-4 mt-0.5 truncate">{item.sub}</span>
        ) : null}
      </button>
    </li>
  );
}

export function OutlineTab({ storyId, onAddItem, onEditItem }: OutlineTabProps): JSX.Element {
  const { data: outline, isLoading, isError } = useOutlineQuery(storyId);
  const reorder = useReorderOutlineMutation(storyId);
  const queryClient = useQueryClient();

  const [reorderStatus, setReorderStatus] = useState<string>('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const current = queryClient.getQueryData<OutlineItem[]>(outlineQueryKey(storyId));
      if (current === undefined) return;
      const next = computeReorderedOutline(current, activeId, overId);
      if (next === null) return;
      setReorderStatus('');
      reorder.mutate(
        {
          items: next.map((it) => ({ id: it.id, order: it.order })),
          previousItems: next,
        },
        {
          onError: () => {
            setReorderStatus('Reorder failed — reverted');
          },
          onSuccess: () => {
            setReorderStatus('');
          },
        },
      );
    },
    [queryClient, reorder, storyId],
  );

  if (isError) {
    return (
      <div role="alert" className="px-3 py-2 text-[12px] text-danger">
        Failed to load outline
      </div>
    );
  }

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="px-3 py-2 text-[12px] text-ink-4">
        Loading outline…
      </div>
    );
  }

  const list = outline ?? [];
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const ids = sorted.map((c) => c.id);

  return (
    <div className="flex flex-col">
      <section className="sidebar-section">
        <header className="sidebar-section-header flex items-center justify-between px-2 pt-2 pb-1 text-[11px] uppercase tracking-[.08em] text-ink-4">
          <span>Story Arc</span>
          {onAddItem !== undefined ? (
            <button
              type="button"
              aria-label="Add outline item"
              onClick={onAddItem}
              className="icon-btn"
            >
              <span aria-hidden="true">+</span>
            </button>
          ) : null}
        </header>

        {sorted.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-ink-4">No outline yet</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col">
                {sorted.map((item) => (
                  <SortableOutlineItem key={item.id} item={item} onEdit={onEditItem} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <div role="status" aria-live="polite" className="sr-only">
        {reorderStatus}
      </div>
    </div>
  );
}
