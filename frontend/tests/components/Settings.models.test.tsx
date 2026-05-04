// [F44 / X27] Settings → Models tab.
//
// Covers (post-X27):
//   - The Models tab renders a single trigger button (not an inline radiogroup)
//     showing the currently-selected model name + ctx chip.
//   - Clicking the trigger fires the onOpenModelPicker prop exactly once.
//   - When chat.model is null the trigger reads "Pick a model" with no ctx chip.
//   - Sliders still render bound to settings.chat values and dragging PATCHes.
//
// The "selecting a model PATCHes settings.chat.model" scenario lives in
// tests/components/ModelPicker.test.tsx (where the actual selection happens).
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
      description: null,
      pricing: null,
    },
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      description: null,
      pricing: null,
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

describe('SettingsModal Models tab (F44 / X27)', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onOpenModelPicker: ReturnType<typeof vi.fn>;

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
    onOpenModelPicker = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders a trigger showing the selected model name + ctx chip', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
    await openModelsTab();

    const trigger = await screen.findByTestId('settings-model-trigger');
    expect(trigger).toHaveTextContent('Llama 3.3 70B');
    expect(await screen.findByTestId('settings-model-trigger-ctx')).toHaveTextContent(/128k/i);
  });

  it('renders "Pick a model" with no ctx chip when chat.model is null', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: null } }));
    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
    await openModelsTab();

    const trigger = await screen.findByTestId('settings-model-trigger');
    expect(trigger).toHaveTextContent(/pick a model/i);
    expect(screen.queryByTestId('settings-model-trigger-ctx')).toBeNull();
  });

  it('clicking the trigger fires onOpenModelPicker exactly once', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
    await openModelsTab();

    await user.click(await screen.findByTestId('settings-model-trigger'));
    expect(onOpenModelPicker).toHaveBeenCalledTimes(1);
  });

  it('does not render the inline radiogroup any more', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
    await openModelsTab();

    await screen.findByTestId('settings-model-trigger');
    expect(screen.queryByTestId('models-radiogroup')).toBeNull();
  });

  it('renders the three sliders bound to settings.chat values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
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

    renderModal(<SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />);
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
