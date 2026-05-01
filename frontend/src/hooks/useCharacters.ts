import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * F18 — character list queries + create mutation.
 * F19 — single-character query + update / delete mutations for the sheet modal.
 *
 * Backend contract (B5):
 * - GET    /api/stories/:storyId/characters        → { characters: Character[] }
 * - POST   /api/stories/:storyId/characters        → { character: Character }
 * - GET    /api/stories/:storyId/characters/:id    → { character: Character }
 * - PATCH  /api/stories/:storyId/characters/:id    → { character: Character }
 * - DELETE /api/stories/:storyId/characters/:id    → 204
 *
 * See also F27 (Cast tab redesign) + F37 (character popover).
 */
export interface Character {
  id: string;
  storyId: string;
  name: string;
  role: string | null;
  age: string | null;
  appearance: string | null;
  voice: string | null;
  arc: string | null;
  personality: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharactersResponse {
  characters: Character[];
}

export interface CharacterResponse {
  character: Character;
}

/**
 * Query key for the character list belonging to a story.
 */
export const charactersQueryKey = (storyId: string): readonly ['characters', string] =>
  ['characters', storyId] as const;

export function useCharactersQuery(
  storyId: string | undefined,
): UseQueryResult<Character[], Error> {
  return useQuery({
    queryKey: charactersQueryKey(storyId ?? ''),
    queryFn: async (): Promise<Character[]> => {
      const res = await api<CharactersResponse>(
        `/stories/${encodeURIComponent(storyId ?? '')}/characters`,
      );
      return res.characters;
    },
    enabled: Boolean(storyId),
    staleTime: 30_000,
  });
}

export interface CreateCharacterInput {
  name: string;
}

export function useCreateCharacterMutation(
  storyId: string,
): UseMutationResult<Character, Error, CreateCharacterInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCharacterInput): Promise<Character> => {
      const res = await api<CharacterResponse>(
        `/stories/${encodeURIComponent(storyId)}/characters`,
        {
          method: 'POST',
          body: input,
        },
      );
      return res.character;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: charactersQueryKey(storyId) });
    },
  });
}

/**
 * Query key for a single character under a story.
 */
export const characterQueryKey = (
  storyId: string,
  characterId: string,
): readonly ['character', string, string] => ['character', storyId, characterId] as const;

export function useCharacterQuery(
  storyId: string | null | undefined,
  characterId: string | null | undefined,
): UseQueryResult<Character, Error> {
  return useQuery({
    queryKey: characterQueryKey(storyId ?? '', characterId ?? ''),
    queryFn: async (): Promise<Character> => {
      const res = await api<CharacterResponse>(
        `/stories/${encodeURIComponent(storyId ?? '')}/characters/${encodeURIComponent(
          characterId ?? '',
        )}`,
      );
      return res.character;
    },
    enabled: storyId != null && characterId != null,
    staleTime: 30_000,
  });
}

/**
 * PATCH body shape accepted by the sheet modal. Every field is optional —
 * only keys the user actually changed are forwarded; an explicit `null`
 * clears the stored value server-side.
 */
export type UpdateCharacterPatch = Partial<
  Pick<Character, 'name' | 'role' | 'age' | 'appearance' | 'voice' | 'arc' | 'personality'>
>;

export interface UpdateCharacterInput {
  id: string;
  patch: UpdateCharacterPatch;
}

export function useUpdateCharacterMutation(
  storyId: string,
): UseMutationResult<Character, Error, UpdateCharacterInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateCharacterInput): Promise<Character> => {
      const res = await api<CharacterResponse>(
        `/stories/${encodeURIComponent(storyId)}/characters/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: patch,
        },
      );
      return res.character;
    },
    onSuccess: (_updated, { id }) => {
      void qc.invalidateQueries({ queryKey: characterQueryKey(storyId, id) });
      void qc.invalidateQueries({ queryKey: charactersQueryKey(storyId) });
    },
  });
}

export interface DeleteCharacterInput {
  id: string;
}

export function useDeleteCharacterMutation(
  storyId: string,
): UseMutationResult<void, Error, DeleteCharacterInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: DeleteCharacterInput): Promise<void> => {
      await api<void>(
        `/stories/${encodeURIComponent(storyId)}/characters/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: (_void, { id }) => {
      qc.removeQueries({ queryKey: characterQueryKey(storyId, id) });
      void qc.invalidateQueries({ queryKey: charactersQueryKey(storyId) });
    },
  });
}

/**
 * Pure array-move helper. Returns a new array.
 */
function arrayMove<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list.slice();
  if (fromIndex < 0 || fromIndex >= list.length) return list.slice();
  if (toIndex < 0 || toIndex >= list.length) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}

function withSequentialOrderIndex<T extends { orderIndex: number }>(list: readonly T[]): T[] {
  return list.map((c, idx) => (c.orderIndex === idx ? c : { ...c, orderIndex: idx }));
}

/**
 * Pure handler used by the CastTab's `DndContext.onDragEnd`. Given the cache
 * and a dnd-kit `{active, over}` pair, returns the new list (with sequential
 * orderIndex). Returns null when nothing needs to change.
 */
export function computeReorderedCharacters(
  current: readonly Character[],
  activeId: string,
  overId: string | null,
): Character[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrderIndex(moved);
}

/**
 * Pure helper for the optimistic delete update — removes the character and
 * reassigns sequential orderIndex on the remainder. Returns null when the id
 * isn't present.
 */
export function computeCharactersAfterDelete(
  current: readonly Character[],
  characterId: string,
): Character[] | null {
  const idx = current.findIndex((c) => c.id === characterId);
  if (idx === -1) return null;
  const remaining = current.filter((c) => c.id !== characterId);
  return withSequentialOrderIndex(remaining);
}
