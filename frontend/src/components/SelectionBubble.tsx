import type { JSX, MouseEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSelectionStore } from '@/store/selection';

/**
 * Selection bubble (F33).
 *
 * A document-level `mouseup` / `keyup` listener watches `window.getSelection()`
 * and, when the selection is non-collapsed and lives inside a node matching
 * the prose selector (default `.paper-prose`), pushes the selection into the
 * F22 `useSelectionStore`. The pill component reads the same store and
 * positions itself 44px above the selection rect, centered horizontally,
 * clamped to the paper area.
 *
 * Wiring rules:
 *   - The bubble itself does not own the action callbacks beyond surfacing
 *     them — F34 (Rewrite/Describe/Expand inline result) and F41 (Ask AI →
 *     `attachedSelection` + chat panel) consume `onAction` on the parent.
 *   - `onMouseDown.preventDefault()` is bound on every interactive surface
 *     (the container and each button). Without this the user's selection
 *     would collapse the moment they click an action — see CLAUDE.md
 *     "Known Gotchas".
 *   - The hook clears the store on Escape, on any document scroll, on a
 *     collapsed / out-of-prose selection, and on unmount.
 *
 * jsdom limitation: `Range#getBoundingClientRect()` returns zeros under
 * jsdom (no layout). Pixel positioning is best-effort there; the test
 * harness verifies the wiring (rect prop reaches the bubble, listeners
 * fire) but cannot assert real coordinates.
 */

export type SelectionAction = 'rewrite' | 'describe' | 'expand' | 'ask';

export interface SelectionBubbleProps {
  /** CSS selector for the prose region. Defaults to `.paper-prose`. */
  proseSelector?: string;
  /** Routed by the parent — F34 consumes rewrite/describe/expand, F41 ask. */
  onAction: (action: SelectionAction) => void;
}

const DEFAULT_PROSE_SELECTOR = '.paper-prose';
const BUBBLE_OFFSET_PX = 44;
const BUBBLE_FALLBACK_HEIGHT_PX = 32;
const PAPER_EDGE_PAD_PX = 8;

/** Walk from a Node up to the nearest Element, then run `closest`. */
function elementClosest(node: Node | null, selector: string): Element | null {
  if (node === null) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  return el.closest(selector);
}

/**
 * Listener hook — bind document-level `mouseup` / `keyup` for selection
 * changes, `scroll` (capture phase, all nested scrollers) for dismissal,
 * and `keydown` for Escape. Resets the store on unmount.
 */
function useSelectionListener({ proseSelector }: { proseSelector: string }): void {
  const setSelection = useSelectionStore((s) => s.setSelection);
  const clear = useSelectionStore((s) => s.clear);

  useEffect(() => {
    const recompute = (): void => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        clear();
        return;
      }
      const range = sel.getRangeAt(0);
      const inProse = elementClosest(range.commonAncestorContainer, proseSelector);
      if (!inProse) {
        clear();
        return;
      }
      const text = range.toString();
      if (text.length === 0) {
        clear();
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({ text, range, rect });
    };

    const onScroll = (): void => {
      clear();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        clear();
      }
    };

    document.addEventListener('mouseup', recompute);
    document.addEventListener('keyup', recompute);
    // Capture phase so scroll on any nested element dismisses too.
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mouseup', recompute);
      document.removeEventListener('keyup', recompute);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown);
      clear();
    };
  }, [proseSelector, setSelection, clear]);
}

interface BubblePosition {
  top: number;
  left: number;
}

function computePosition(
  rect: DOMRect,
  proseSelector: string,
  bubbleEl: HTMLElement | null,
): BubblePosition {
  const bubbleHeight = bubbleEl?.offsetHeight ?? BUBBLE_FALLBACK_HEIGHT_PX;
  const bubbleWidth = bubbleEl?.offsetWidth ?? 0;

  const top = rect.top + window.scrollY - BUBBLE_OFFSET_PX - bubbleHeight;
  let left = rect.left + window.scrollX + rect.width / 2;

  // Clamp horizontally to the paper region (if measurable).
  const paper = document.querySelector(proseSelector);
  if (paper) {
    const paperRect = paper.getBoundingClientRect();
    if (paperRect.width > 0 && bubbleWidth > 0) {
      const min = paperRect.left + window.scrollX + PAPER_EDGE_PAD_PX + bubbleWidth / 2;
      const max = paperRect.right + window.scrollX - PAPER_EDGE_PAD_PX - bubbleWidth / 2;
      if (max > min) {
        left = Math.max(min, Math.min(max, left));
      }
    }
  }

  return { top, left };
}

export function SelectionBubble({
  proseSelector,
  onAction,
}: SelectionBubbleProps): JSX.Element | null {
  const selector = proseSelector ?? DEFAULT_PROSE_SELECTOR;
  useSelectionListener({ proseSelector: selector });
  const selection = useSelectionStore((s) => s.selection);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<BubblePosition | null>(null);

  // Position after layout — `useLayoutEffect` so we measure the bubble's own
  // size before paint and avoid a one-frame flash at (0, 0).
  useLayoutEffect(() => {
    if (!selection) {
      setPos(null);
      return;
    }
    const rect = selection.rect;
    if (!rect) {
      setPos(null);
      return;
    }
    setPos(computePosition(rect, selector, bubbleRef.current));
  }, [selection, selector]);

  if (!selection) return null;

  // `onMouseDown.preventDefault()` keeps the document selection intact
  // when the user clicks the bubble — see Known Gotchas in CLAUDE.md.
  const swallowMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
  };

  const handle = (action: SelectionAction) => () => {
    onAction(action);
  };

  const buttonClass =
    'px-2.5 py-1 font-sans text-[12px] rounded-[var(--radius)] hover:bg-[color-mix(in_srgb,var(--bg)_15%,transparent)] transition-colors';

  return (
    <div
      ref={bubbleRef}
      role="menu"
      aria-label="Selection actions"
      onMouseDown={swallowMouseDown}
      className="t-popover-in fixed z-50 inline-flex items-center gap-1 p-1 bg-ink text-bg rounded-[var(--radius)] shadow-[0_6px_18px_rgba(0,0,0,.22)]"
      style={
        pos
          ? {
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              transform: 'translateX(-50%)',
            }
          : { top: 0, left: 0, transform: 'translateX(-50%)', visibility: 'hidden' }
      }
    >
      <button
        type="button"
        onMouseDown={swallowMouseDown}
        onClick={handle('rewrite')}
        className={buttonClass}
      >
        Rewrite
      </button>
      <button
        type="button"
        onMouseDown={swallowMouseDown}
        onClick={handle('describe')}
        className={buttonClass}
      >
        Describe
      </button>
      <button
        type="button"
        onMouseDown={swallowMouseDown}
        onClick={handle('expand')}
        className={buttonClass}
      >
        Expand
      </button>
      <span
        aria-hidden="true"
        className="mx-0.5 w-px h-4 bg-[color-mix(in_srgb,var(--bg)_30%,transparent)]"
      />
      <button
        type="button"
        onMouseDown={swallowMouseDown}
        onClick={handle('ask')}
        className={buttonClass}
      >
        Ask AI
      </button>
    </div>
  );
}
