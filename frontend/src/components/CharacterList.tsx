import type { JSX } from 'react';
import { useCallback } from 'react';
import {
  type Character,
  useCharactersQuery,
  useCreateCharacterMutation,
} from '@/hooks/useCharacters';

/**
 * F18 — Characters sidebar panel.
 *
 * Renders the story's characters as a clickable list with an "Add character"
 * button at the top. Styling mirrors `<ChapterList>` (Tailwind utilities); the
 * mockup-fidelity Cast tab redesign is F27. The character-sheet modal is F19
 * — this component just emits `onOpenCharacter(id)` and lets the parent
 * decide what to open. F37 adds the mention-popover.
 *
 * No PATCH / DELETE here on purpose: those belong to the sheet modal.
 */
export interface CharacterListProps {
  storyId: string;
  onOpenCharacter: (characterId: string) => void;
  /**
   * Optional. When provided, the "Add character" button delegates to the
   * parent (which can open an empty sheet and let the user type a name
   * before hitting POST). When omitted, the button falls back to creating
   * a character named "Untitled character" and opens it via onOpenCharacter
   * on success.
   */
  onAddCharacter?: () => void;
}

function characterDisplayName(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length > 0) return trimmed;
  return 'Untitled character';
}

/**
 * Secondary line under the character name: role and/or age, separated by
 * a middle dot. Empty string when both are null/blank — in which case the
 * caller skips rendering the node entirely.
 */
function characterSecondary(c: Character): string {
  const parts: string[] = [];
  const role = c.role?.trim() ?? '';
  const age = c.age?.trim() ?? '';
  if (role.length > 0) parts.push(role);
  if (age.length > 0) parts.push(`Age ${age}`);
  return parts.join(' · ');
}

export function CharacterList({
  storyId,
  onOpenCharacter,
  onAddCharacter,
}: CharacterListProps): JSX.Element {
  const { data: characters, isLoading, isError, error } = useCharactersQuery(storyId);
  const createCharacter = useCreateCharacterMutation(storyId);

  const handleAdd = useCallback((): void => {
    if (onAddCharacter !== undefined) {
      onAddCharacter();
      return;
    }
    createCharacter.mutate(
      { name: 'Untitled character' },
      {
        onSuccess: (created) => {
          onOpenCharacter(created.id);
        },
      },
    );
  }, [createCharacter, onAddCharacter, onOpenCharacter]);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="text-sm text-neutral-500">
        Loading characters…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-600">
          Could not load characters
          {error instanceof Error && error.message ? `: ${error.message}` : ''}
        </p>
      </div>
    );
  }

  const list = characters ?? [];

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleAdd}
        disabled={createCharacter.isPending}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
      >
        {createCharacter.isPending ? 'Adding…' : 'Add character'}
      </button>

      {list.length === 0 ? (
        <p className="text-sm text-neutral-500">No characters yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((c) => {
            const secondary = characterSecondary(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCharacter(c.id);
                  }}
                  className="w-full min-w-0 text-left rounded border border-neutral-200 bg-white px-2 py-2 hover:bg-neutral-50"
                >
                  <span className="block truncate text-sm font-medium text-neutral-900">
                    {characterDisplayName(c)}
                  </span>
                  {secondary.length > 0 ? (
                    <span className="block text-xs text-neutral-500">{secondary}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
