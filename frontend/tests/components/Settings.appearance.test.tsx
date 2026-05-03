// [F46] Settings → Appearance tab.
//
// Covers:
//   - Three theme tiles render in order Paper / Sepia / Dark with the
//     active one carrying aria-checked="true".
//   - Clicking a tile flips aria-checked, mirrors onto
//     document.documentElement.dataset.theme, and PATCHes
//     /api/users/me/settings with `{ theme }`.
//   - Prose font select renders all four options and PATCHes on change.
//   - Prose size slider renders, reflects the server value, and (debounced)
//     PATCHes the new size.
//   - Line-height slider mirrors the prose size behaviour.
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SettingsState {
  theme: 'paper' | 'sepia' | 'dark';
  prose: { font: string; size: number; lineHeight: number };
  writing: {
    spellcheck: boolean;
    typewriterMode: boolean;
    focusMode: boolean;
    dailyWordGoal: number;
  };
  chat: { model: string | null; temperature: number; topP: number; maxTokens: number };
  ai: { includeVeniceSystemPrompt: boolean };
}

interface SettingsOverrides {
  theme?: 'paper' | 'sepia' | 'dark';
  proseFont?: string;
  proseSize?: number;
  proseLineHeight?: number;
}

function makeSettings(overrides: SettingsOverrides = {}): SettingsState {
  return {
    theme: overrides.theme ?? 'paper',
    prose: {
      font: overrides.proseFont ?? 'iowan',
      size: overrides.proseSize ?? 18,
      lineHeight: overrides.proseLineHeight ?? 1.7,
    },
    writing: {
      spellcheck: true,
      typewriterMode: false,
      focusMode: false,
      dailyWordGoal: 500,
    },
    chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
    ai: { includeVeniceSystemPrompt: true },
  };
}

function veniceKeyStatus(): unknown {
  return { hasKey: false, lastFour: null, endpoint: null };
}

interface BuildFetchOpts {
  initial?: SettingsOverrides;
}

// State-tracking mock: PATCH bodies are merged into the in-memory shape and
// echoed back, so the wrapper's onSuccess setQueryData reflects the patched
// values rather than overwriting the optimistic update with the seed.
function buildFetch(opts: BuildFetchOpts = {}): FetchMock {
  let state = makeSettings(opts.initial ?? {});
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me/settings') {
      if (method === 'PATCH' && typeof init?.body === 'string') {
        const patch = JSON.parse(init.body) as Partial<SettingsState>;
        state = {
          ...state,
          ...patch,
          prose: { ...state.prose, ...(patch.prose ?? {}) },
          writing: { ...state.writing, ...(patch.writing ?? {}) },
          chat: { ...state.chat, ...(patch.chat ?? {}) },
          ai: { ...state.ai, ...(patch.ai ?? {}) },
        } as SettingsState;
      }
      return Promise.resolve(jsonResponse(200, { settings: state }));
    }
    if (url === '/api/users/me/venice-key' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, veniceKeyStatus()));
    }
    if (url === '/api/ai/models' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { models: [] }));
    }
    if (url === '/api/stories' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderModal(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function openAppearanceTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('settings-tab-appearance'));
}

function findAllSettingsPatches(fetchMock: FetchMock): RequestInit[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/users/me/settings' && init?.method === 'PATCH',
    )
    .map(([, init]: [string, RequestInit]) => init);
}

function findLastSettingsPatchBody(fetchMock: FetchMock): Record<string, unknown> | undefined {
  const patches = findAllSettingsPatches(fetchMock);
  if (patches.length === 0) return undefined;
  const last = patches[patches.length - 1];
  if (last.body == null) return undefined;
  return JSON.parse(String(last.body)) as Record<string, unknown>;
}

function resetThemeArtifacts(): void {
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
  document.documentElement.style.removeProperty('--prose-font');
  document.documentElement.style.removeProperty('--prose-size');
  document.documentElement.style.removeProperty('--prose-line-height');
}

describe('SettingsModal Appearance tab (F46)', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    resetThemeArtifacts();
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    resetThemeArtifacts();
  });

  it('renders three theme tiles in order Paper / Sepia / Dark', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const paper = await screen.findByTestId('appearance-theme-paper');
    const sepia = screen.getByTestId('appearance-theme-sepia');
    const dark = screen.getByTestId('appearance-theme-dark');

    expect(paper).toBeInTheDocument();
    expect(sepia).toBeInTheDocument();
    expect(dark).toBeInTheDocument();

    // Order check via the radiogroup's native radio inputs.
    const group = screen.getByTestId('appearance-theme-group');
    const ordered = Array.from(group.querySelectorAll('input[type="radio"]'));
    expect(ordered.map((el) => el.getAttribute('data-testid'))).toEqual([
      'appearance-theme-paper',
      'appearance-theme-sepia',
      'appearance-theme-dark',
    ]);
  });

  it('default-active tile is Paper (checked=true)', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const paper = (await screen.findByTestId('appearance-theme-paper')) as HTMLInputElement;
    await waitFor(() => {
      expect(paper.checked).toBe(true);
    });
    expect((screen.getByTestId('appearance-theme-sepia') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('appearance-theme-dark') as HTMLInputElement).checked).toBe(false);
  });

  it('clicking Sepia flips checked, sets data-theme, and PATCHes', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const sepia = (await screen.findByTestId('appearance-theme-sepia')) as HTMLInputElement;
    await user.click(sepia);

    await waitFor(() => {
      expect(sepia.checked).toBe(true);
    });
    expect((screen.getByTestId('appearance-theme-paper') as HTMLInputElement).checked).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('sepia');

    await waitFor(() => {
      const body = findLastSettingsPatchBody(fetchMock);
      expect(body).toEqual({ theme: 'sepia' });
    });
  });

  it('clicking Dark mirrors the same flow with theme=dark', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const dark = (await screen.findByTestId('appearance-theme-dark')) as HTMLInputElement;
    await user.click(dark);

    await waitFor(() => {
      expect(dark.checked).toBe(true);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');

    await waitFor(() => {
      const body = findLastSettingsPatchBody(fetchMock);
      expect(body).toEqual({ theme: 'dark' });
    });
  });

  it('renders four prose font options', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const select = (await screen.findByTestId('appearance-prose-font')) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    expect(options).toEqual([
      { value: 'iowan', label: 'Iowan Old Style' },
      { value: 'palatino', label: 'Palatino' },
      { value: 'garamond', label: 'Garamond' },
      { value: 'plex-serif', label: 'IBM Plex Serif' },
    ]);
  });

  it('selecting Palatino updates the --prose-font CSS var and PATCHes', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const select = (await screen.findByTestId('appearance-prose-font')) as HTMLSelectElement;
    await user.selectOptions(select, 'palatino');

    expect(document.documentElement.style.getPropertyValue('--prose-font')).toMatch(/Palatino/);

    await waitFor(() => {
      const body = findLastSettingsPatchBody(fetchMock);
      expect(body).toEqual({ prose: { font: 'palatino' } });
    });
  });

  it('prose size slider reflects settings.prose.size and (debounced) PATCHes the new value', async () => {
    const fetchMock = buildFetch({ initial: { proseSize: 20 } });
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const slider = (await screen.findByTestId('appearance-prose-size')) as HTMLInputElement;
    await waitFor(() => {
      expect(slider.value).toBe('20');
    });

    fireEvent.change(slider, { target: { value: '22' } });
    expect(slider.value).toBe('22');
    expect(document.documentElement.style.getPropertyValue('--prose-size')).toBe('22px');

    await waitFor(
      () => {
        const body = findLastSettingsPatchBody(fetchMock);
        expect(body).toEqual({ prose: { size: 22 } });
      },
      { timeout: 1000 },
    );
  });

  it('line-height slider reflects settings.prose.lineHeight and (debounced) PATCHes the new value', async () => {
    const fetchMock = buildFetch({ initial: { proseLineHeight: 1.5 } });
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openAppearanceTab();

    const slider = (await screen.findByTestId('appearance-prose-line-height')) as HTMLInputElement;
    await waitFor(() => {
      expect(slider.value).toBe('1.5');
    });

    fireEvent.change(slider, { target: { value: '1.85' } });
    expect(slider.value).toBe('1.85');
    expect(document.documentElement.style.getPropertyValue('--prose-line-height')).toBe('1.85');

    await waitFor(
      () => {
        const body = findLastSettingsPatchBody(fetchMock);
        expect(body).toEqual({ prose: { lineHeight: 1.85 } });
      },
      { timeout: 1000 },
    );
  });
});
