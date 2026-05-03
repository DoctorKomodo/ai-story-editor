import type { JSX, ReactNode } from 'react';

/**
 * [F49] Shared mount-time transitions.
 *
 * Three named transitions matching the design tokens in `src/index.css`:
 *  - `backdrop` — fade-in 160ms ease-out (modal/dialog scrims).
 *  - `modal`    — translate-y 8→0 + scale .98→1 over 180ms with a soft cubic-bezier.
 *                 The keyframe animates `transform` only (translateY + scale); centring
 *                 is the caller's responsibility (typically a flex-centered backdrop).
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
