import type { JSX, ReactNode } from 'react';

/**
 * [F49] Shared mount-time transitions.
 *
 * Three named transitions matching the design tokens in `src/index.css`:
 *  - `backdrop` — fade-in 160ms ease-out (modal/dialog scrims).
 *  - `modal`    — translate-y 8→0 + scale .98→1 over 180ms with a soft cubic-bezier.
 *                 The keyframe sets `transform: translate(-50%, -50%)` for the final
 *                 state, so callers should NOT layer Tailwind's `-translate-x-1/2 -translate-y-1/2`
 *                 onto the same element — apply `t-modal-in` to a wrapper that owns
 *                 the centring transform itself, or to an element that handles centring
 *                 inline. (See note in TASKS.md F49 for migration guidance.)
 *  - `popover`  — opacity 0 + translateY 4px → 1 over 140ms ease-out (hover popovers,
 *                 selection bubble, and other small floating UI).
 *
 * F49 deliberately ships only an enter animation — components unmount cleanly on close,
 * so there is no exit-animation machinery here.
 */
export type TransitionKind = 'backdrop' | 'modal' | 'popover';

export interface TransitionProps {
  kind: TransitionKind;
  children: ReactNode;
  className?: string;
}

const KIND_TO_CLASS: Record<TransitionKind, string> = {
  backdrop: 't-backdrop-in',
  modal: 't-modal-in',
  popover: 't-popover-in',
};

export function Transition({ kind, children, className }: TransitionProps): JSX.Element {
  const cls = `${KIND_TO_CLASS[kind]} ${className ?? ''}`.trim();
  return <div className={cls}>{children}</div>;
}
