// [F25] Focus-mode toggle hook.
//
// Exposes `toggleFocus()` which flips the layout slice between `'focus'` and
// `'three-col'`. Layout state lives on `useUiStore` (ephemeral; resets on
// reload by design). F26 wires this up to the top-bar button; F47 will fold
// the keyboard shortcut (`Cmd/Ctrl+Shift+F`) into the central
// `useKeyboardShortcuts` registry.
import { useCallback } from 'react';
import { useUiStore } from '@/store/ui';

export interface UseFocusToggle {
  isFocus: boolean;
  toggleFocus: () => void;
}

export function useFocusToggle(): UseFocusToggle {
  const layout = useUiStore((s) => s.layout);
  const setLayout = useUiStore((s) => s.setLayout);

  const toggleFocus = useCallback(() => {
    setLayout(layout === 'focus' ? 'three-col' : 'focus');
  }, [layout, setLayout]);

  return { isFocus: layout === 'focus', toggleFocus };
}
