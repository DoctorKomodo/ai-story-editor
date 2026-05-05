// [X33] Settings → Models tab — inline picker.
//
// Covers (post-X33):
//   - The Models tab renders <ModelPickerInline> with the user's active model
//     highlighted in the detail pane.
//   - Clicking "Use this model" on a non-active model PATCHes settings.chat.model.
//   - The three sliders still render bound to settings.chat values and dragging PATCHes.
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
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: true,
      description: 'Meta-tuned 70B general-purpose model.',
      pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
    },
    {
      id: 'qwen-3-6-plus',
      name: 'Qwen 3.6 Plus',
      contextLength: 1000000,
      supportsReasoning: true,
      supportsVision: false,
      supportsWebSearch: true,
      description: 'Reasoning flagship.',
      pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
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

describe('SettingsModal Models tab (X33)', () => {
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

  it('renders the inline picker with the active model in the detail pane', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('model-detail-name')).toHaveTextContent('Llama 3.3 70B');
    expect(screen.getByTestId('model-detail-cta')).toHaveTextContent(/currently in use/i);
  });

  it('clicking "Use this model" PATCHes settings.chat.model', async () => {
    const fetchMock = buildFetch({ initialSettings: { model: 'llama-3.3-70b' } });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    await user.click(await screen.findByTestId('model-rail-qwen-3-6-plus'));
    await user.click(screen.getByTestId('model-detail-cta'));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/users/me/settings' && init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const init = (patch as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ chat: { model: 'qwen-3-6-plus' } });
    });
  });

  it('renders the three sliders bound to settings.chat values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    const topP = await screen.findByTestId('param-top-p');
    const maxTokens = await screen.findByTestId('param-max-tokens');

    await waitFor(() => {
      expect(temp).toHaveValue('0.85');
      expect(topP).toHaveValue('0.95');
      expect(maxTokens).toHaveValue('800');
    });
  });

  it('dragging temperature PATCHes settings.chat.temperature', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
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
        expect((body.chat as { temperature: number }).temperature).toBeCloseTo(1.25, 5);
      },
      { timeout: 1000 },
    );
  });

  it('initialTab="models" opens the modal directly on the Models tab', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('settings-panel-models')).toBeInTheDocument();
  });

  it('does not render Cancel/Done buttons (auto-save chrome)', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(screen.queryByTestId('settings-cancel')).toBeNull();
    expect(screen.queryByTestId('settings-done')).toBeNull();
    expect(screen.getByTestId('settings-autosave-hint')).toBeInTheDocument();
  });
});
