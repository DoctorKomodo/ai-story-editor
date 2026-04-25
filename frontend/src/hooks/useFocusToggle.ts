// [F25] Focus-mode toggle hook.
//
// Exposes `toggleFocus()` which flips the layout slice between `'focus'` and
// `'three-col'`. Layout state lives on `useTweaksStore` (see [F22]). F26 will
// wire this up to the top-bar button; F47 will fold the keyboard shortcut
// (`Cmd/Ctrl+Shift+F`) into the central `useKeyboardShortcuts` registry.
import { useCallback } from 'react';
import { useTweaksStore } from '@/store/tweaks';

export interface UseFocusToggle {
  isFocus: boolean;
  toggleFocus: () => void;
}

export function useFocusToggle(): UseFocusToggle {
  const layout = useTweaksStore((s) => s.tweaks.layout);
  const setTweaks = useTweaksStore((s) => s.setTweaks);

  const toggleFocus = useCallback(() => {
    setTweaks({ layout: layout === 'focus' ? 'three-col' : 'focus' });
  }, [layout, setTweaks]);

  return { isFocus: layout === 'focus', toggleFocus };
}
