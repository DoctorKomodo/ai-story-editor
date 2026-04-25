// [F46] Settings → Appearance tab.
//
// Three concerns, all writing through to the backend `settings` shape via
// [B11] PATCH /api/users/me/settings:
//
//   1. Theme picker — three radio tiles (Paper / Sepia / Dark). Click flips
//      `useTweaksStore.tweaks.theme`, mirrors the choice onto
//      `document.documentElement.dataset.theme` so the F23 token system
//      repaints, and PATCHes `{ theme }`.
//
//   2. Prose font — `<select>` over the four mockup fonts, persisted as a
//      stable token (`iowan` | `palatino` | `garamond` | `plex-serif`) on
//      both `useTweaksStore.proseFont` and `prose.font`. Writes a font-stack
//      to the `--prose-font` CSS variable on the document root so the
//      `.paper-prose .ProseMirror` rule in `index.css` swaps faces live.
//
//   3. Prose size + line-height sliders — write to `--prose-size` /
//      `--prose-line-height` CSS vars (live preview) and PATCH the matching
//      `prose` fields, debounced ~200ms so dragging the slider doesn't fire
//      a request per pixel.
//
// Auto-save semantics match the rest of the modal — every change persists
// immediately (or after debounce for the sliders); Cancel / Done just close.
//
// F46 supersedes the F21 dark-mode toggle for theme switching, but doesn't
// delete `<DarkModeToggle>` — F21 tests still mount that component
// directly, and removing it would break them. The toggle and this tab both
// write to the same `data-theme` attribute, so the two are compatible.
import type { ChangeEvent, JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
import { type ProseFont, type Theme, useTweaksStore } from '@/store/tweaks';

// --- Theme tile data --------------------------------------------------------

interface ThemeTile {
  id: Theme;
  label: string;
  bg: string;
  ink: string;
}

// Hex values mirror `index.css`'s `--bg` / `--ink` per theme.
const THEME_TILES: ReadonlyArray<ThemeTile> = [
  { id: 'paper', label: 'Paper', bg: '#faf8f3', ink: '#1a1a1a' },
  { id: 'sepia', label: 'Sepia', bg: '#f4ecd8', ink: '#2d230f' },
  { id: 'dark', label: 'Dark', bg: '#14130f', ink: '#ebe7dc' },
];

// --- Prose font data --------------------------------------------------------

interface ProseFontOption {
  id: ProseFont;
  label: string;
  stack: string;
}

const PROSE_FONTS: ReadonlyArray<ProseFontOption> = [
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

function fontStackFor(id: ProseFont): string {
  const found = PROSE_FONTS.find((f) => f.id === id);
  return found?.stack ?? PROSE_FONTS[0].stack;
}

function fontIdFromStored(font: string): ProseFont {
  const known = PROSE_FONTS.find((f) => f.id === font);
  return known?.id ?? 'iowan';
}

// --- DOM side-effects -------------------------------------------------------

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

function applyProseFont(stack: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-font', stack);
}

function applyProseSize(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-size', `${String(px)}px`);
}

function applyProseLineHeight(value: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--prose-line-height', String(value));
}

// --- Debounce hook (mirrors SettingsWritingTab) -----------------------------

function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, []);

  return (...args: A): void => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delayMs);
  };
}

// --- ThemeTileButton --------------------------------------------------------

interface ThemeTileButtonProps {
  tile: ThemeTile;
  active: boolean;
  groupName: string;
  onSelect: (theme: Theme) => void;
}

function ThemeTileButton({ tile, active, groupName, onSelect }: ThemeTileButtonProps): JSX.Element {
  // Native <input type="radio"> wrapped in a <label> — the input handles
  // role + aria-checked + keyboard nav semantics for free, the visible
  // tile is the label's content.
  return (
    <label
      className={[
        'flex flex-col items-stretch gap-2 p-2 rounded-[var(--radius)] border bg-bg transition-colors cursor-pointer',
        active ? 'border-ink' : 'border-line hover:border-line-2',
      ].join(' ')}
    >
      <input
        type="radio"
        name={groupName}
        value={tile.id}
        checked={active}
        data-testid={`appearance-theme-${tile.id}`}
        onChange={() => {
          onSelect(tile.id);
        }}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        data-testid={`appearance-theme-swatch-${tile.id}`}
        className="block w-[60px] h-[40px] rounded-[2px] border border-line overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: tile.bg }}
      >
        <span
          className="block w-[36px] h-[2px] rounded-full"
          style={{ backgroundColor: tile.ink }}
        />
      </span>
      <span className="text-[12px] font-sans text-ink-2 text-center">{tile.label}</span>
    </label>
  );
}

// --- Main tab ---------------------------------------------------------------

export function SettingsAppearanceTab(): JSX.Element {
  const fontId = useId();
  const sizeId = useId();
  const lineHeightId = useId();
  const themeGroupName = useId();

  const settingsQuery = useUserSettingsQuery();
  const updateSettings = useUpdateUserSettingsMutation();
  const tweaks = useTweaksStore((s) => s.tweaks);
  const setTweaks = useTweaksStore((s) => s.setTweaks);

  const settings = settingsQuery.data;
  const settingsLoading = settings == null;

  // Mirror the server settings onto the tweaks store + DOM tokens once,
  // when the settings query resolves. Subsequent changes go through the
  // user-facing controls below — re-running the seed effect on store
  // changes would clobber those.
  const seededThemeRef = useRef(false);
  useEffect(() => {
    if (seededThemeRef.current) return;
    if (settings == null) return;
    seededThemeRef.current = true;
    const tweaksState = useTweaksStore.getState();
    const partial: Partial<{ theme: Theme; proseFont: ProseFont }> = {};
    if (settings.theme !== tweaksState.tweaks.theme) {
      partial.theme = settings.theme;
    }
    const fontId2 = fontIdFromStored(settings.prose.font);
    if (fontId2 !== tweaksState.tweaks.proseFont) {
      partial.proseFont = fontId2;
    }
    if (Object.keys(partial).length > 0) {
      tweaksState.setTweaks(partial);
    }
    applyTheme(settings.theme);
    applyProseFont(fontStackFor(fontId2));
    applyProseSize(settings.prose.size);
    applyProseLineHeight(settings.prose.lineHeight);
  }, [settings]);

  // --- Theme picker ---------------------------------------------------------

  const handleThemeSelect = (theme: Theme): void => {
    setTweaks({ theme });
    applyTheme(theme);
    updateSettings.mutate({ theme });
  };

  // --- Prose font select ----------------------------------------------------

  const handleFontChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value as ProseFont;
    setTweaks({ proseFont: next });
    applyProseFont(fontStackFor(next));
    updateSettings.mutate({ prose: { font: next } });
  };

  // --- Prose size slider ----------------------------------------------------

  const serverSize = settings?.prose.size ?? 18;
  const [sizeDraft, setSizeDraft] = useState<number>(serverSize);
  const lastSeededSizeRef = useRef<number | null>(null);
  useEffect(() => {
    if (settings == null) return;
    if (lastSeededSizeRef.current === settings.prose.size) return;
    lastSeededSizeRef.current = settings.prose.size;
    setSizeDraft(settings.prose.size);
  }, [settings]);

  const flushSize = useDebouncedCallback((value: number): void => {
    updateSettings.mutate({ prose: { size: value } });
  }, 200);

  const handleSizeChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = Number.parseInt(e.target.value, 10);
    if (Number.isNaN(next)) return;
    setSizeDraft(next);
    applyProseSize(next);
    flushSize(next);
  };

  // --- Line-height slider ---------------------------------------------------

  const serverLineHeight = settings?.prose.lineHeight ?? 1.7;
  const [lineHeightDraft, setLineHeightDraft] = useState<number>(serverLineHeight);
  const lastSeededLhRef = useRef<number | null>(null);
  useEffect(() => {
    if (settings == null) return;
    if (lastSeededLhRef.current === settings.prose.lineHeight) return;
    lastSeededLhRef.current = settings.prose.lineHeight;
    setLineHeightDraft(settings.prose.lineHeight);
  }, [settings]);

  const flushLineHeight = useDebouncedCallback((value: number): void => {
    updateSettings.mutate({ prose: { lineHeight: value } });
  }, 200);

  const handleLineHeightChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = Number.parseFloat(e.target.value);
    if (Number.isNaN(next)) return;
    setLineHeightDraft(next);
    applyProseLineHeight(next);
    flushLineHeight(next);
  };

  // --- Render ---------------------------------------------------------------

  const activeFont = fontIdFromStored(settings?.prose.font ?? tweaks.proseFont);

  return (
    <div className="flex flex-col gap-6">
      <section
        className="flex flex-col gap-3"
        data-testid="appearance-section-theme"
        aria-labelledby="appearance-theme-heading"
      >
        <header>
          <h3
            id="appearance-theme-heading"
            className="m-0 font-serif text-[14px] font-medium text-ink"
          >
            Theme
          </h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Choose the page palette. Applies immediately and persists across sessions.
          </p>
        </header>
        <div
          role="radiogroup"
          aria-label="Theme"
          data-testid="appearance-theme-group"
          className="flex gap-3"
        >
          {THEME_TILES.map((tile) => (
            <ThemeTileButton
              key={tile.id}
              tile={tile}
              active={tweaks.theme === tile.id}
              groupName={themeGroupName}
              onSelect={handleThemeSelect}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="appearance-section-prose">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Prose</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Font face, size, and line height for the editor surface.
          </p>
        </header>

        <div className="flex flex-col gap-1">
          <label htmlFor={fontId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">Prose font</span>
          </label>
          <select
            id={fontId}
            data-testid="appearance-prose-font"
            value={activeFont}
            disabled={settingsLoading}
            onChange={handleFontChange}
            className="w-full px-3 py-2 text-[13px] font-sans border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {PROSE_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1" data-testid="appearance-prose-size-row">
          <label htmlFor={sizeId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">Prose size</span>
            <span
              data-testid="appearance-prose-size-readout"
              className="text-ink-4 font-mono"
            >{`${String(sizeDraft)}px`}</span>
          </label>
          <input
            id={sizeId}
            data-testid="appearance-prose-size"
            type="range"
            min={14}
            max={24}
            step={1}
            value={sizeDraft}
            disabled={settingsLoading}
            onChange={handleSizeChange}
            className="w-full"
          />
        </div>

        <div className="flex flex-col gap-1" data-testid="appearance-prose-line-height-row">
          <label htmlFor={lineHeightId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">Line height</span>
            <span
              data-testid="appearance-prose-line-height-readout"
              className="text-ink-4 font-mono"
            >
              {lineHeightDraft.toFixed(2)}
            </span>
          </label>
          <input
            id={lineHeightId}
            data-testid="appearance-prose-line-height"
            type="range"
            min={1.3}
            max={2.0}
            step={0.05}
            value={lineHeightDraft}
            disabled={settingsLoading}
            onChange={handleLineHeightChange}
            className="w-full"
          />
        </div>
      </section>
    </div>
  );
}
