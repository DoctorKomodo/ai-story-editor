// [F45] Settings → Writing tab.
//
// Covers:
//   - All five toggles + the daily-goal input render.
//   - Typewriter / focus toggles bind to settings.writing and PATCH on flip.
//   - Auto-save / smart-quotes / em-dash toggles persist to localStorage.
//   - Daily goal input shows the current value and PATCHes after debounce.
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

interface WritingOverrides {
  typewriterMode?: boolean;
  focusMode?: boolean;
  dailyWordGoal?: number;
  spellcheck?: boolean;
  smartQuotes?: boolean;
  emDashExpansion?: boolean;
}

function settingsBody(writing: WritingOverrides = {}): unknown {
  return {
    settings: {
      theme: 'paper',
      prose: { font: 'serif', size: 18, lineHeight: 1.7 },
      writing: {
        spellcheck: writing.spellcheck ?? true,
        typewriterMode: writing.typewriterMode ?? false,
        focusMode: writing.focusMode ?? false,
        dailyWordGoal: writing.dailyWordGoal ?? 500,
        smartQuotes: writing.smartQuotes ?? false,
        emDashExpansion: writing.emDashExpansion ?? false,
      },
      chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
      ai: { includeVeniceSystemPrompt: true },
    },
  };
}

function veniceKeyStatus(): unknown {
  return { hasKey: false, lastFour: null, endpoint: null };
}

interface BuildFetchOpts {
  initialWriting?: WritingOverrides;
}

function buildFetch(opts: BuildFetchOpts = {}): FetchMock {
  const initial = opts.initialWriting ?? {};
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me/settings') {
      if (method === 'PATCH') {
        // Echo back the same default settings; tests assert on call args,
        // not the response body.
        return Promise.resolve(jsonResponse(200, settingsBody(initial)));
      }
      return Promise.resolve(jsonResponse(200, settingsBody(initial)));
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
    // Default no-op so an unmocked endpoint doesn't hang a query.
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderModal(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function openWritingTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('settings-tab-writing'));
}

function findSettingsPatch(fetchMock: FetchMock): RequestInit | undefined {
  const entry = fetchMock.mock.calls.find(
    ([url, init]: [string, RequestInit | undefined]) =>
      url === '/api/users/me/settings' && init?.method === 'PATCH',
  );
  if (entry == null) return undefined;
  return (entry as [string, RequestInit])[1];
}

function findAllSettingsPatches(fetchMock: FetchMock): RequestInit[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/users/me/settings' && init?.method === 'PATCH',
    )
    .map(([, init]: [string, RequestInit]) => init);
}

describe('SettingsModal Writing tab (F45)', () => {
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
    window.localStorage.clear();
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    window.localStorage.clear();
  });

  it('renders all five toggles and the daily-goal input', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    expect(await screen.findByTestId('writing-typewriter-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('writing-focus-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('writing-autosave-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('writing-smart-quotes-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('writing-em-dash-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('writing-daily-goal-input')).toBeInTheDocument();
  });

  it('typewriter toggle reflects settings.writing.typewriterMode and PATCHes on flip', async () => {
    const fetchMock = buildFetch({ initialWriting: { typewriterMode: true } });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const typewriter = (await screen.findByTestId('writing-typewriter-toggle')) as HTMLInputElement;
    await waitFor(() => {
      expect(typewriter.checked).toBe(true);
    });

    await user.click(typewriter);

    await waitFor(() => {
      const init = findSettingsPatch(fetchMock);
      expect(init).toBeDefined();
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      expect(body).toEqual({ writing: { typewriterMode: false } });
    });
  });

  it('focus paragraph toggle binds to settings.writing.focusMode and PATCHes on flip', async () => {
    const fetchMock = buildFetch({ initialWriting: { focusMode: false } });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const focusToggle = (await screen.findByTestId('writing-focus-toggle')) as HTMLInputElement;
    await waitFor(() => {
      expect(focusToggle.checked).toBe(false);
    });

    await user.click(focusToggle);

    await waitFor(() => {
      const init = findSettingsPatch(fetchMock);
      expect(init).toBeDefined();
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      expect(body).toEqual({ writing: { focusMode: true } });
    });
  });

  it('auto-save toggle defaults to true and persists to localStorage', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const autoSave = (await screen.findByTestId('writing-autosave-toggle')) as HTMLInputElement;
    expect(autoSave.checked).toBe(true);

    await user.click(autoSave);

    expect(autoSave.checked).toBe(false);
    expect(window.localStorage.getItem('inkwell.writing.autoSave')).toBe('false');

    await user.click(autoSave);
    expect(window.localStorage.getItem('inkwell.writing.autoSave')).toBe('true');

    // Should not have hit the settings PATCH endpoint for auto-save.
    const patches = findAllSettingsPatches(fetchMock);
    expect(patches.length).toBe(0);
  });

  // [F66] Smart-quotes + em-dash now persist via B11.
  it('smart-quotes toggle defaults to false and PATCHes via B11', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const sq = (await screen.findByTestId('writing-smart-quotes-toggle')) as HTMLInputElement;
    expect(sq.checked).toBe(false);

    await user.click(sq);

    await waitFor(() => {
      const patch = findSettingsPatch(fetchMock);
      expect(patch).toBeDefined();
      const body = JSON.parse(patch?.body as string);
      expect(body).toEqual({ writing: { smartQuotes: true } });
    });
  });

  it('em-dash toggle defaults to false and PATCHes via B11', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const em = (await screen.findByTestId('writing-em-dash-toggle')) as HTMLInputElement;
    expect(em.checked).toBe(false);

    await user.click(em);

    await waitFor(() => {
      const patch = findSettingsPatch(fetchMock);
      expect(patch).toBeDefined();
      const body = JSON.parse(patch?.body as string);
      expect(body).toEqual({ writing: { emDashExpansion: true } });
    });
  });

  it('seeds smart-quotes / em-dash from server settings (not localStorage)', async () => {
    window.localStorage.setItem('inkwell.writing.autoSave', 'false');
    vi.stubGlobal(
      'fetch',
      buildFetch({ initialWriting: { smartQuotes: true, emDashExpansion: true } }),
    );

    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const autoSave = (await screen.findByTestId('writing-autosave-toggle')) as HTMLInputElement;
    const sq = (await screen.findByTestId('writing-smart-quotes-toggle')) as HTMLInputElement;
    const em = (await screen.findByTestId('writing-em-dash-toggle')) as HTMLInputElement;
    expect(autoSave.checked).toBe(false);
    await waitFor(() => {
      expect(sq.checked).toBe(true);
      expect(em.checked).toBe(true);
    });
  });

  it('daily goal input shows the current value and (debounced) PATCHes', async () => {
    const fetchMock = buildFetch({ initialWriting: { dailyWordGoal: 750 } });
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openWritingTab();

    const goal = (await screen.findByTestId('writing-daily-goal-input')) as HTMLInputElement;
    await waitFor(() => {
      expect(goal.value).toBe('750');
    });

    fireEvent.change(goal, { target: { value: '1200' } });
    expect(goal.value).toBe('1200');

    // Before debounce flushes, no PATCH should have been recorded.
    expect(findSettingsPatch(fetchMock)).toBeUndefined();

    await waitFor(
      () => {
        const init = findSettingsPatch(fetchMock);
        expect(init).toBeDefined();
        const body = JSON.parse(String((init as RequestInit).body)) as {
          writing?: Record<string, unknown>;
        };
        expect(body.writing).toBeDefined();
        expect((body.writing as { dailyWordGoal: number }).dailyWordGoal).toBe(1200);
      },
      { timeout: 1500 },
    );
  });
});
