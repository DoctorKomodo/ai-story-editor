import type { JSX } from 'react';

/**
 * Three-dot bouncing "thinking" indicator. Used wherever the UI is
 * waiting for an AI request to start producing tokens.
 *
 * The `.think-dot` keyframe lives in `frontend/src/index.css` and is
 * shared with any future caller. A `prefers-reduced-motion` block in
 * the same file disables the bounce and renders the dots at low
 * opacity instead.
 */

export interface ThinkingDotsProps {
  /** Accessible label announced to screen readers. Defaults to "Thinking". */
  label?: string;
  /** Optional class for layout (margin, gap with surrounding text). */
  className?: string;
}

const DELAYS_MS: readonly number[] = [0, 150, 300];

export function ThinkingDots({ label = 'Thinking', className }: ThinkingDotsProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      data-testid="thinking-dots"
      className={['inline-flex items-center', className].filter(Boolean).join(' ')}
    >
      {DELAYS_MS.map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="think-dot inline-block w-2 h-2 mx-0.5 rounded-full bg-[var(--ink-4)]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
