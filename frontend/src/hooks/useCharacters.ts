import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * F18 — character list queries + create mutation.
 *
 * Backend contract (B5):
 * - GET    /api/stories/:storyId/characters    → { characters: Character[] }
 * - POST   /api/stories/:storyId/characters    → { character: Character }
 *
 * Update / delete (PATCH, DELETE) mutations are intentionally NOT here — F19
 * (character sheet modal) owns those, and adding them now would be scope
 * creep. See also F27 (Cast tab redesign) + F37 (character popover).
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
