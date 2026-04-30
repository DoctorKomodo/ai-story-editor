import type { JSX } from 'react';
/**
 * [F21] Header button that flips dark mode.
 *
 * Uses `role="switch"` + `aria-checked` so screen readers read the state
 * aloud as a toggle, not a plain button. Re-skins automatically because
 * the design tokens change with the active theme via `data-theme` on
 * <html> (no `dark:` Tailwind variants needed).
 */
import { Button } from '@/design/primitives';
import { useDarkMode } from '@/hooks/useDarkMode';

export function DarkModeToggle(): JSX.Element {
  const { enabled, toggle } = useDarkMode();

  return (
    <Button
      variant="ghost"
      size="md"
      role="switch"
      aria-checked={enabled}
      aria-label="Dark mode"
      onClick={toggle}
      data-testid="dark-mode-toggle"
    >
      {enabled ? 'Dark: on' : 'Dark: off'}
    </Button>
  );
}
