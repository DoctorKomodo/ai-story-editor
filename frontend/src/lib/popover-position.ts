export interface Position {
  top: number;
  left: number;
}

export const POPOVER_GAP_PX = 6;
export const VIEWPORT_PAD_PX = 8;

export interface ComputePopoverPositionOptions {
  /** Popover width in px (required — varies per consumer). */
  width: number;
  /** Gap between anchor's bottom edge and popover's top edge. Defaults to POPOVER_GAP_PX. */
  gap?: number;
  /** Viewport-edge padding. Defaults to VIEWPORT_PAD_PX. */
  viewportPad?: number;
}

export function computePopoverPosition(
  anchor: HTMLElement,
  opts: ComputePopoverPositionOptions,
): Position {
  const { width, gap = POPOVER_GAP_PX, viewportPad = VIEWPORT_PAD_PX } = opts;
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + gap;
  let left = rect.left + window.scrollX;
  const viewportWidth =
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0;
  if (viewportWidth > 0) {
    const maxLeft = viewportWidth - width - viewportPad + window.scrollX;
    if (left > maxLeft) left = Math.max(viewportPad + window.scrollX, maxLeft);
  }
  if (left < window.scrollX + viewportPad) {
    left = window.scrollX + viewportPad;
  }
  return { top, left };
}
