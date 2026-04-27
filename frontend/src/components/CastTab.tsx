import type { JSX } from 'react';
import type { Character } from '@/hooks/useCharacters';

/**
 * F28 — Cast sidebar tab.
 *
 * Renders the story's characters split into two sections — Principal (the first
 * two characters) and Supporting (the rest) — using the mockup's `.char-card`
 * styling: 28px circular avatar with a deterministic colored tint, serif-italic
 * initial, name (13/500) and "role · Age N" secondary line.
 *
 * Click on a card calls `onOpenCharacter(id)`. The avatar inside the button is
 * `aria-hidden`; the whole card is the focusable target. F37 will plug the
 * Character Popover into the same callback (anchored to the avatar element);
 * until it lands the parent routes the click to the F19 character sheet modal.
 *
 * Data is fetched by the parent via `useCharactersQuery` and passed in as
 * props — keeps this component dumb and easy to test.
 */
export interface CastTabProps {
  characters: Character[];
  /**
   * [F54] Forwards the avatar/card button element so the F37 popover can
   * anchor below it.
   */
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
  isLoading?: boolean;
  isError?: boolean;
}

/** Initial letter for the avatar — uppercase, falls back to "?" if empty. */
function avatarInitial(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}

/** Display name — "Untitled" when the character has no name. */
function displayName(c: Character): string {
  const trimmed = c.name.trim();
  if (trimmed.length === 0) return 'Untitled';
  return trimmed;
}

/**
 * Secondary line under the name. Mirrors `characterSecondary()` in
 * `CharacterList.tsx`: role and/or `Age N`, separated by " · ". Returns
 * the empty string when both fields are blank — the caller suppresses the
 * line entirely in that case.
 */
function characterSecondary(c: Character): string {
  const parts: string[] = [];
  const role = c.role?.trim() ?? '';
  const age = c.age?.trim() ?? '';
  if (role.length > 0) parts.push(role);
  if (age.length > 0) parts.push(`Age ${age}`);
  return parts.join(' · ');
}

/**
 * Deterministic 6-entry palette of design-token-aware tints. The character id
 * (or name as a fallback) hashes into one slot. Each tint is a `color-mix`
 * over a token color so it adapts to the active theme automatically.
 */
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
  // Non-null: idx is always in-range and the palette is non-empty.
  return AVATAR_PALETTE[idx] as string;
}

interface CharCardProps {
  character: Character;
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
}

function CharCard({ character, onOpenCharacter }: CharCardProps): JSX.Element {
  const secondary = characterSecondary(character);
  return (
    <button
      type="button"
      onClick={(e) => {
        onOpenCharacter(character.id, e.currentTarget);
      }}
      className="char-card flex gap-2.5 items-start px-3 py-2.5 mx-1 mb-1 rounded-[var(--radius)] cursor-pointer hover:bg-[var(--surface-hover)] w-[calc(100%-8px)] text-left transition-colors"
    >
      <span
        className="char-avatar grid place-items-center w-7 h-7 rounded-full font-serif italic text-[13px] text-ink border border-[var(--line-2)] flex-shrink-0"
        style={{ background: avatarBg(character.id || character.name) }}
        aria-hidden="true"
      >
        {avatarInitial(character)}
      </span>
      <span className="char-info flex-1 min-w-0 text-left">
        <span className="char-name block text-[13px] font-medium text-ink truncate">
          {displayName(character)}
        </span>
        {secondary.length > 0 ? (
          <span className="char-role block text-[11px] text-ink-4 truncate tracking-[.02em]">
            {secondary}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function CastTab({
  characters,
  onOpenCharacter,
  isLoading,
  isError,
}: CastTabProps): JSX.Element {
  if (isError === true) {
    return (
      <div role="alert" className="px-3 py-2 text-[12px] text-danger">
        Failed to load characters
      </div>
    );
  }

  if (isLoading === true && characters.length === 0) {
    return (
      <div role="status" aria-live="polite" className="px-3 py-2 text-[12px] text-ink-4">
        Loading cast…
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="px-3 py-2 text-[12px] text-ink-4">
        No characters yet. Use the + button to add one.
      </div>
    );
  }

  const principal = characters.slice(0, 2);
  const supporting = characters.slice(2);

  return (
    <div className="flex flex-col">
      <section className="sidebar-section">
        <header className="sidebar-section-header px-2 pt-2 pb-1 text-[11px] uppercase tracking-[.08em] text-ink-4">
          Principal
        </header>
        {principal.map((c) => (
          <CharCard key={c.id} character={c} onOpenCharacter={onOpenCharacter} />
        ))}
      </section>

      {supporting.length > 0 ? (
        <section className="sidebar-section">
          <header className="sidebar-section-header px-2 pt-2 pb-1 text-[11px] uppercase tracking-[.08em] text-ink-4">
            Supporting
          </header>
          {supporting.map((c) => (
            <CharCard key={c.id} character={c} onOpenCharacter={onOpenCharacter} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
