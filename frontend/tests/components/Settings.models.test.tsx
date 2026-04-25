// [F44] Settings → Models tab.
//
// Covers:
//   - Models render as <ModelCard>s with `aria-checked` reflecting the store.
//   - Selecting a card writes both useModelStore AND PATCH /users/me/settings
//     `{ chat: { model } }`.
//   - All four sliders render, bound to `useParamsStore`.
//   - Dragging a slider updates the store + (debounced) PATCH.
//   - System prompt textarea is hidden when no active story is set, visible
//     and seeded from the story query when one is, and PATCHes the story
//     on blur.
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useActiveStoryStore } from '@/store/activeStory';
import { useModelStore } from '@/store/model';
import { useParamsStore } from '@/store/params';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface DefaultSettingsOptions {
  model?: string | null;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

function defaultSettings(opts: DefaultSettingsOptions = {}): unknown {
  return {
    settings: {
      theme: 'paper',
      prose: { font: 'serif', size: 18, lineHeight: 1.7 },
      writing: {
        spellcheck: true,
        typewriterMode: false,
        focusMode: false,
        dailyWordGoal: 500,
      },
      chat: {
        model: opts.model ?? null,
        temperature: opts.temperature ?? 0.7,
        topP: opts.topP ?? 1,
        maxTokens: opts.maxTokens ?? 1024,
      },
      ai: { includeVeniceSystemPrompt: true },
    },
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

function storyResponse(systemPrompt: string | null): unknown {
  return {
    story: {
      id: 'story-1',
      title: 'The Test Story',
      genre: null,
      synopsis: null,
      worldNotes: null,
      targetWords: null,
      systemPrompt,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

interface RouteOptions {
  modelsBody?: unknown;
  settingsBody?: unknown;
  storySystemPrompt?: string | null;
  /** Override the systemPrompt persisted by the next PATCH /stories/:id. */
  storyPatchResponse?: (body: unknown) => unknown;
}

function buildFetch(opts: RouteOptions = {}): FetchMock {
  const modelsBody = opts.modelsBody ?? TWO_MODELS;
  const settingsBody = opts.settingsBody ?? defaultSettings();
  const storyPrompt = opts.storySystemPrompt ?? null;
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me/settings') {
      if (method === 'PATCH') {
        // Echo back default settings on PATCH; the test asserts call args
        // not the response body, so this can stay simple.
        return Promise.resolve(jsonResponse(200, defaultSettings()));
      }
      return Promise.resolve(jsonResponse(200, settingsBody));
    }
    if (url === '/api/users/me/venice-key' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, veniceKeyStatus()));
    }
    if (url === '/api/ai/models' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, modelsBody));
    }
    if (url === '/api/stories/story-1' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, storyResponse(storyPrompt)));
    }
    if (url === '/api/stories/story-1' && method === 'PATCH') {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const next = opts.storyPatchResponse
        ? opts.storyPatchResponse(body)
        : storyResponse(typeof body.systemPrompt === 'string' ? body.systemPrompt : null);
      return Promise.resolve(jsonResponse(200, next));
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
    useModelStore.setState({ modelId: null });
    useParamsStore.setState({
      params: { temperature: 0.85, topP: 0.95, maxTokens: 800, frequencyPenalty: 0 },
    });
    useActiveStoryStore.setState({ activeStoryId: null });
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useModelStore.setState({ modelId: null });
    useParamsStore.setState({
      params: { temperature: 0.85, topP: 0.95, maxTokens: 800, frequencyPenalty: 0 },
    });
    useActiveStoryStore.setState({ activeStoryId: null });
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

  it('selecting a model writes the store AND PATCHes /users/me/settings', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const card = await screen.findByTestId('model-card-llama-3.3-70b');
    await user.click(card);

    expect(useModelStore.getState().modelId).toBe('llama-3.3-70b');

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

  it('renders all four sliders with current store values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    const topP = await screen.findByTestId('param-top-p');
    const maxTokens = await screen.findByTestId('param-max-tokens');
    const freq = await screen.findByTestId('param-frequency-penalty');

    expect(temp).toHaveValue('0.85');
    expect(topP).toHaveValue('0.95');
    expect(maxTokens).toHaveValue('800');
    expect(freq).toHaveValue('0');

    expect(screen.getByTestId('param-temperature-value').textContent).toBe('0.85');
    expect(screen.getByTestId('param-top-p-value').textContent).toBe('0.95');
    expect(screen.getByTestId('param-max-tokens-value').textContent).toBe('800');
    expect(screen.getByTestId('param-frequency-penalty-value').textContent).toBe('0.00');
  });

  it('dragging temperature updates the store and (debounced) PATCHes settings', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    fireEvent.change(temp, { target: { value: '1.25' } });

    expect(useParamsStore.getState().params.temperature).toBeCloseTo(1.25, 5);

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

  it('frequency penalty stays local (no PATCH on change)', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const freq = await screen.findByTestId('param-frequency-penalty');
    fireEvent.change(freq, { target: { value: '0.5' } });

    expect(useParamsStore.getState().params.frequencyPenalty).toBeCloseTo(0.5, 5);

    // Wait past debounce window then assert no settings PATCH happened.
    await new Promise((r) => setTimeout(r, 350));
    const patch = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/users/me/settings' && init?.method === 'PATCH',
    );
    expect(patch).toBeUndefined();
  });

  it('hides the system prompt textarea when no active story', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    expect(screen.queryByTestId('system-prompt-textarea')).toBeNull();
    expect(screen.getByTestId('system-prompt-empty')).toBeInTheDocument();
  });

  it('shows the system prompt seeded from the story when active, and PATCHes on blur', async () => {
    useActiveStoryStore.setState({ activeStoryId: 'story-1' });
    const fetchMock = buildFetch({ storySystemPrompt: 'My prompt' });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);
    await openModelsTab();

    const textarea = (await screen.findByTestId('system-prompt-textarea')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe('My prompt');
    });

    await user.clear(textarea);
    await user.type(textarea, 'new value');
    // Blur to trigger the PATCH.
    textarea.blur();

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/stories/story-1' && init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const init = (patch as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ systemPrompt: 'new value' });
    });
  });
});
