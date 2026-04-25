import type { JSX } from 'react';
/**
 * [F21] Header button that flips dark mode.
 *
 * Uses `role="switch"` + `aria-checked` so screen readers read the state
 * aloud as a toggle, not a plain button. The visible label ("Dark: on" /
 * "Dark: off") doubles as a visual affordance since we haven't wired icon
 * SVGs yet — F25/F46 replace this with the themed header treatment.
 *
 * Wrapped Tailwind class list matches the other header buttons (Hide AI,
 * Export) plus `dark:` overrides so the toggle itself re-skins when clicked.
 */
import { useDarkMode } from '@/hooks/useDarkMode';

export function DarkModeToggle(): JSX.Element {
  const { enabled, toggle } = useDarkMode();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Dark mode"
      onClick={toggle}
      className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
    >
      {enabled ? 'Dark: on' : 'Dark: off'}
    </button>
  );
}
