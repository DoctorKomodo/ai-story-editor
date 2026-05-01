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
import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import { CastSectionHeader } from '@/components/CastSectionHeader';
import {
  CloseIcon,
  GripIcon,
  IconButton,
  InlineConfirm,
  useInlineConfirm,
} from '@/design/primitives';
import {
  type Character,
  charactersQueryKey,
  computeReorderedCharacters,
  useDeleteCharacterMutation,
  useReorderCharactersMutation,
} from '@/hooks/useCharacters';
import { ApiError } from '@/lib/api';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

export interface CastTabProps {
  storyId: string;
  characters: Character[];
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
  onCreateCharacter: () => void;
  isLoading?: boolean;
  isError?: boolean;
}

function avatarInitial(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

function displayName(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return 'Untitled';
  return trimmed;
}

function characterSecondary(c: Character): string {
  const parts: string[] = [];
  const role = c.role?.trim() ?? '';
  const age = c.age?.trim() ?? '';
  if (role.length > 0) parts.push(role);
  if (age.length > 0) parts.push(`Age ${age}`);
  return parts.join(' · ');
}

const AVATAR_PALETTE: readonly string[] = [
  'color-mix(in srgb, var(--ai) 18%, transparent)',
  'color-mix(in srgb, var(--accent-soft) 80%, transparent)',
  'color-mix(in srgb, var(--mark) 35%, transparent)',
  'color-mix(in srgb, var(--danger) 14%, transparent)',
  'color-mix(in srgb, var(--ai-soft) 90%, transparent)',
  'color-mix(in srgb, var(--line-2) 60%, transparent)',
];

function avatarBg(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx] as string;
}

interface CharRowProps {
  character: Character;
  selected: boolean;
  onSelect: (id: string, anchorEl: HTMLElement) => void;
  onRequestDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}

function CharRow({
  character,
  selected,
  onSelect,
  onRequestDelete,
  isDeleting,
}: CharRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: character.id });

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
      await onRequestDelete(character.id);
      confirm.dismiss();
    } catch {
      /* aria-live carries the message; keep confirm open for retry. */
    }
  };

  return (
    <li
      ref={setRefs}
      style={style}
      data-active={selected ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`character-row-${character.id}`}
      aria-current={selected ? 'true' : undefined}
      className={[
        'group relative flex items-center gap-2 px-2 py-2.5 mx-1 mb-1',
        'rounded-[var(--radius)] transition-colors w-[calc(100%-8px)]',
        selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
        isOver ? 'ring-1 ring-ink' : '',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        aria-label="Reorder"
        data-testid={`character-row-${character.id}-grip`}
        className={[
          'cursor-grab touch-none text-ink-4 hover:text-ink-2',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'flex-shrink-0',
        ].join(' ')}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <button
        type="button"
        onClick={(e) => {
          onSelect(character.id, e.currentTarget);
        }}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
      >
        <span
          className="grid place-items-center w-7 h-7 rounded-full font-serif italic text-[13px] text-ink border border-[var(--line-2)] flex-shrink-0"
          style={{ background: avatarBg(character.id || character.name) }}
          aria-hidden="true"
        >
          {avatarInitial(character)}
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[13px] font-medium text-ink truncate">
            {displayName(character)}
          </span>
          {characterSecondary(character).length > 0 ? (
            <span className="block text-[11px] text-ink-4 truncate tracking-[.02em]">
              {characterSecondary(character)}
            </span>
          ) : null}
        </span>
      </button>
      {confirm.open ? (
        <InlineConfirm
          {...confirm.props}
          label={`Delete ${displayName(character)}`}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          pending={isDeleting}
          testId={`character-row-${character.id}-confirm`}
        />
      ) : selected ? (
        <IconButton
          ariaLabel={`Delete ${displayName(character)}`}
          onClick={confirm.ask}
          testId={`character-row-${character.id}-delete`}
          className="flex-shrink-0"
        >
          <CloseIcon />
        </IconButton>
      ) : null}
    </li>
  );
}

export function CastTab({
  storyId,
  characters,
  onOpenCharacter,
  onCreateCharacter,
  isLoading,
  isError,
}: CastTabProps): JSX.Element {
  const queryClient = useQueryClient();
  const reorderCharacters = useReorderCharactersMutation(storyId);
  const deleteCharacter = useDeleteCharacterMutation(storyId);
  const selectedCharacterId = useSelectedCharacterStore((s) => s.selectedCharacterId);
  const setSelectedCharacterId = useSelectedCharacterStore((s) => s.setSelectedCharacterId);

  const [reorderStatus, setReorderStatus] = useState<string>('');
  const [deleteStatus, setDeleteStatus] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleAdd = useCallback((): void => {
    onCreateCharacter();
  }, [onCreateCharacter]);

  const handleSelect = useCallback(
    (id: string, anchorEl: HTMLElement): void => {
      setSelectedCharacterId(id);
      onOpenCharacter(id, anchorEl);
    },
    [onOpenCharacter, setSelectedCharacterId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const current = queryClient.getQueryData<Character[]>(charactersQueryKey(storyId));
      if (current === undefined) return;
      const next = computeReorderedCharacters(current, activeId, overId);
      if (next === null) return;
      setReorderStatus('');
      reorderCharacters.mutate(next, {
        onError: () => {
          setReorderStatus('Reorder failed — reverted');
        },
        onSuccess: () => {
          setReorderStatus('');
        },
      });
    },
    [queryClient, reorderCharacters, storyId],
  );

  const handleRequestDelete = useCallback(
    async (id: string): Promise<void> => {
      setDeleteStatus('');
      setPendingDeleteId(id);
      try {
        await deleteCharacter.mutateAsync({ id });
        if (selectedCharacterId === id) setSelectedCharacterId(null);
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Character already removed — refreshed'
            : 'Delete failed — try again';
        setDeleteStatus(message);
        throw err;
      } finally {
        setPendingDeleteId(null);
      }
    },
    [deleteCharacter, selectedCharacterId, setSelectedCharacterId],
  );

  const ids = characters.map((c) => c.id);

  return (
    <div className="flex flex-col" data-testid="cast-list">
      <CastSectionHeader onAdd={handleAdd} />

      {isError === true ? (
        <p role="alert" className="px-3 py-2 text-[12px] text-danger">
          Failed to load characters
        </p>
      ) : isLoading === true && characters.length === 0 ? (
        <p role="status" aria-live="polite" className="px-3 py-2 text-[12px] text-ink-4">
          Loading cast…
        </p>
      ) : characters.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-ink-4">No characters yet</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col">
              {characters.map((c) => (
                <CharRow
                  key={c.id}
                  character={c}
                  selected={selectedCharacterId === c.id}
                  onSelect={handleSelect}
                  onRequestDelete={handleRequestDelete}
                  isDeleting={pendingDeleteId === c.id}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {reorderStatus}
        {deleteStatus}
      </div>
    </div>
  );
}
