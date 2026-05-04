// [F44] Settings → Models tab.
//
// Covers:
//   - Models render as <ModelCard>s with `aria-checked` reflecting the
//     selected model from useUserSettings().chat.model.
//   - Selecting a card PATCHes /users/me/settings `{ chat: { model } }`
//     (the multi-device fix); the optimistic cache update flips the radio
//     immediately.
//   - The three server-backed sliders render bound to settings.chat.
//   - Dragging a slider PATCHes settings.
//
// [X29] The per-story system-prompt section was removed from the Models
// tab; corresponding test scenarios moved to Settings.prompts.test.tsx.
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

interface DefaultSettingsOptions {
  model?: string | null;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

function makeSettings(opts: DefaultSettingsOptions = {}): SettingsState {
  return {
    theme: 'paper',
    prose: { font: 'iowan', size: 18, lineHeight: 1.7 },
    writing: {
      spellcheck: true,
      typewriterMode: false,
      focusMode: false,
      dailyWordGoal: 500,
    },
    chat: {
      model: opts.model ?? null,
      temperature: opts.temperature ?? 0.85,
      topP: opts.topP ?? 0.95,
      maxTokens: opts.maxTokens ?? 800,
    },
    ai: { includeVeniceSystemPrompt: true },
  };
}

const TWO_MODELS = {
  models: [
    {
      id: 'venice-uncensored',
      name: 'Venice Uncensored',
      contextLength: 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
    },
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
    },
  ],
};

function veniceKeyStatus(): unknown {
  return { hasKey: false, lastFour: null, endpoint: null };
}

interface RouteOptions {
  modelsBody?: unknown;
  initialSettings?: DefaultSettingsOptions;
}

// State-tracking mock: PATCH bodies are merged into the in-memory settings
// shape and echoed back, so the wrapper's onSuccess setQueryData reflects
// the patched values rather than overwriting the optimistic update with
// the seed.
function buildFetch(opts: RouteOptions = {}): FetchMock {
  const modelsBody = opts.modelsBody ?? TWO_MODELS;
  let settings = makeSettings(opts.initialSettings ?? {});
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me/settings') {
      if (method === 'PATCH' && typeof init?.body === 'string') {
        const patch = JSON.parse(init.body) as Partial<SettingsState>;
        settings = {
          ...settings,
          ...patch,
          prose: { ...settings.prose, ...(patch.prose ?? {}) },
          writing: { ...settings.writing, ...(patch.writing ?? {}) },
          chat: { ...settings.chat, ...(patch.chat ?? {}) },
          ai: { ...settings.ai, ...(patch.ai ?? {}) },
        } as SettingsState;
      }
      return Promise.resolve(jsonResponse(200, { settings }));
    }
    if (url === '/api/users/me/venice-key' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, veniceKeyStatus()));
    }
    if (url === '/api/ai/models' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, modelsBody));
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

async function openModelsTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('settings-tab-models'));
}

describe('SettingsModal Models tab (F44)', () => {
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
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders ModelCards in a radiogroup', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const group = await screen.findByTestId('models-radiogroup');
    expect(group).toHaveAttribute('role', 'radiogroup');

    const venice = await screen.findByTestId('model-card-venice-uncensored');
    const llama = await screen.findByTestId('model-card-llama-3.3-70b');
    expect(venice).toHaveAttribute('role', 'radio');
    expect(llama).toHaveAttribute('role', 'radio');
  });

  it('selecting a model PATCHes /users/me/settings (multi-device fix)', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const card = await screen.findByTestId('model-card-llama-3.3-70b');
    await user.click(card);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/users/me/settings' && init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const init = (patch as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ chat: { model: 'llama-3.3-70b' } });
    });
  });

  it('renders the three sliders bound to settings.chat values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    const topP = await screen.findByTestId('param-top-p');
    const maxTokens = await screen.findByTestId('param-max-tokens');

    await waitFor(() => {
      expect(temp).toHaveValue('0.85');
      expect(topP).toHaveValue('0.95');
      expect(maxTokens).toHaveValue('800');
    });

    expect(screen.getByTestId('param-temperature-value').textContent).toBe('0.85');
    expect(screen.getByTestId('param-top-p-value').textContent).toBe('0.95');
    expect(screen.getByTestId('param-max-tokens-value').textContent).toBe('800');
  });

  it('dragging temperature PATCHes settings.chat.temperature', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    fireEvent.change(temp, { target: { value: '1.25' } });

    await waitFor(
      () => {
        const patch = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/settings' && init?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
        const init = (patch as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as { chat?: Record<string, unknown> };
        expect(body.chat).toBeDefined();
        expect((body.chat as { temperature: number }).temperature).toBeCloseTo(1.25, 5);
      },
      { timeout: 1000 },
    );
  });
});
