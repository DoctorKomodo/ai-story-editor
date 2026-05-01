import type { JSX } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Character } from '@/hooks/useCharacters';
import { useEscape } from '@/hooks/useKeyboardShortcuts';

/**
 * F37 — Character popover.
 *
 * 280px-wide absolute-positioned card anchored below a triggering element.
 * Surfaces a compact subset of a {@link Character}:
 *   - serif name (16px) + uppercase mono caption ("Role · Age N")
 *   - three labelled fields: Appearance / Voice / Arc (em-dash placeholder
 *     when blank)
 *   - footer: **Edit** (opens the F19 character sheet) and, when
 *     `consistencyEnabled` is true, **Consistency check** (calls the X8
 *     handler — feature not yet shipped, so the button is hidden by default).
 *
 * Used from:
 *   - F28 Cast tab cards (parent decides between sheet and popover)
 *   - F36 `.char-ref` hover dispatcher (parent owns the
 *     `useCharRefHoverDispatcher` plumbing — F37 itself only knows about
 *     `character + anchorEl + onClose`).
 *
 * Positioning: computed from `anchorEl.getBoundingClientRect()` once the
 * component lays out. Top sits 6px below the anchor; horizontal position
 * is clamped so the 280px card never spills past the viewport's right
 * edge. No full collision detection — the parent is expected to anchor
 * to elements with reasonable spacing above/below.
 *
 * Dismissal: Escape key OR clicking outside the popover triggers
 * `onClose`. The hover-grace window for `.char-ref` re-entry lives in the
 * parent (via the `anchorEl` prop flipping to null with a delay) — that's
 * a wiring concern, not the popover's responsibility. See task notes.
 */

const POPOVER_WIDTH_PX = 280;
const POPOVER_GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;

export interface CharacterPopoverProps {
  /** `null` → not rendered. */
  character: Character | null;
  /** Element to anchor below; `null` → not rendered. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Called with the character id when **Edit** is clicked. */
  onEdit?: (id: string) => void;
  /** Called with the character id when **Consistency check** is clicked. */
  onConsistencyCheck?: (id: string) => void;
  /** Show the **Consistency check** button. Hidden by default until X8 ships. */
  consistencyEnabled?: boolean;
}

interface Position {
  top: number;
  left: number;
}

function computePosition(anchor: HTMLElement): Position {
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + POPOVER_GAP_PX;
  let left = rect.left + window.scrollX;
  const viewportWidth =
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0;
  if (viewportWidth > 0) {
    const maxLeft = viewportWidth - POPOVER_WIDTH_PX - VIEWPORT_PAD_PX + window.scrollX;
    if (left > maxLeft) left = Math.max(VIEWPORT_PAD_PX + window.scrollX, maxLeft);
  }
  if (left < window.scrollX + VIEWPORT_PAD_PX) {
    left = window.scrollX + VIEWPORT_PAD_PX;
  }
  return { top, left };
}

interface FieldRowProps {
  label: string;
  value: string | null;
}

function FieldRow({ label, value }: FieldRowProps): JSX.Element {
  const display = value && value.trim().length > 0 ? value : '—';
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono mt-2">{label}</dt>
      <dd className="font-serif text-[13px] text-ink mt-0.5 whitespace-pre-wrap">{display}</dd>
    </div>
  );
}

export function CharacterPopover({
  character,
  anchorEl,
  onClose,
  onEdit,
  onConsistencyCheck,
  consistencyEnabled = false,
}: CharacterPopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  // Recompute position whenever the anchor changes (and it's non-null). We
  // intentionally don't subscribe to scroll/resize — F37's parent re-renders
  // on the F36 dispatcher events, which is a coarser but sufficient signal.
  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null);
      return;
    }
    setPos(computePosition(anchorEl));
  }, [anchorEl]);

  // [F57] Escape dismissal — priority 50 (under modals, over the
  // selection bubble) via the F47 priority registry.
  useEscape(
    () => {
      onClose();
    },
    { priority: 50, enabled: character !== null && anchorEl !== null },
  );

  // Outside-click dismissal — kept as a hand-rolled listener since it's a
  // mouse event, not a keyboard one.
  useEffect(() => {
    if (!character || !anchorEl) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [character, anchorEl, onClose]);

  if (!character || !anchorEl) return null;

  const { name, role, age, appearance, voice, arc } = character;
  const displayName = name && name.trim().length > 0 ? name : 'Untitled';
  const roleText = role && role.trim().length > 0 ? role : '';
  const ageText = age && age.trim().length > 0 ? `Age ${age}` : '';
  const captionParts: string[] = [];
  if (roleText) captionParts.push(roleText);
  if (ageText) captionParts.push(ageText);
  const caption = captionParts.join(' · ');

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Character: ${displayName}`}
      className="t-popover-in character-popover absolute z-40 w-[280px] bg-bg-elevated border border-line rounded-[var(--radius-lg)] shadow-pop p-3"
      style={{
        top: pos ? `${pos.top}px` : 0,
        left: pos ? `${pos.left}px` : 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <header className="mb-3">
        <h3 className="font-serif text-[16px] text-ink leading-tight">{displayName}</h3>
        {caption.length > 0 && (
          <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono">
            {caption}
          </div>
        )}
      </header>

      <dl>
        <FieldRow label="Appearance" value={appearance} />
        <FieldRow label="Voice" value={voice} />
        <FieldRow label="Arc" value={arc} />
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEdit?.(character.id)}
          className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
        >
          Edit
        </button>
        {consistencyEnabled && (
          <button
            type="button"
            onClick={() => onConsistencyCheck?.(character.id)}
            className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
          >
            Consistency check
          </button>
        )}
      </div>
    </div>
  );
}
