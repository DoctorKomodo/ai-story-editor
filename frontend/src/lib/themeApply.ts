// Shared theme + prose token application.
//
// Used by `<ThemeApply />` (mounted at app root, applies tokens whenever
// the user-settings cache changes) and by `SettingsAppearanceTab` (calls
// the helpers directly inside change handlers for instant DOM feedback
// before the optimistic cache update has propagated through React).

export type Theme = 'paper' | 'sepia' | 'dark';
export type ProseFont = 'iowan' | 'palatino' | 'garamond' | 'plex-serif';

interface ProseFontOption {
  id: ProseFont;
  label: string;
  stack: string;
}

export const PROSE_FONTS: ReadonlyArray<ProseFontOption> = [
  {
    id: 'iowan',
    label: 'Iowan Old Style',
    stack: '"Iowan Old Style", "Palatino Linotype", "Palatino", "Book Antiqua", Georgia, serif',
  },
  {
    id: 'palatino',
    label: 'Palatino',
    stack: '"Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif',
  },
  {
    id: 'garamond',
    label: 'Garamond',
    stack: '"EB Garamond", "Garamond", "Adobe Garamond Pro", Georgia, serif',
  },
  {
    id: 'plex-serif',
    label: 'IBM Plex Serif',
    stack: '"IBM Plex Serif", Georgia, serif',
  },
];

export function fontStackFor(id: ProseFont): string {
  const found = PROSE_FONTS.find((f) => f.id === id);
  return found?.stack ?? PROSE_FONTS[0].stack;
}

export function fontIdFromStored(font: string): ProseFont {
  const known = PROSE_FONTS.find((f) => f.id === font);
  return known?.id ?? 'iowan';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function applyProseFont(stack: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-font', stack);
}

export function applyProseSize(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-size', `${String(px)}px`);
}

export function applyProseLineHeight(value: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-line-height', String(value));
}
