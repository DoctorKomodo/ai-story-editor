// [X28] Settings → Models tab — resolver wiring, Reset button, disabled-when-no-model.
//
// Covers (post-X28):
//   - Sliders show resolved values (override → venice-default → global-default).
//   - Switching active model updates slider readouts to that model's defaults.
//   - Dragging a slider PATCHes chat.overrides[activeModelId].field.
//   - Reset button is disabled when no overrides exist for the active model.
//   - Reset clears only the active model's overrides in the PATCH body.
//   - Sliders carry `disabled` attribute when chat.model is null.
//   - Reset tooltip references Venice defaults when the model exposes them.
//   - Reset tooltip says "general defaults" when Venice exposes neither.
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import type { Model } from '@/hooks/useModels';
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

// ---------------------------------------------------------------------------
// Settings shape (post-X28): chat uses overrides, not flat fields.
// ---------------------------------------------------------------------------

interface ChatOverride {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

interface SettingsState {
  theme: 'paper' | 'sepia' | 'dark';
  prose: { font: string; size: number; lineHeight: number };
  writing: {
    spellcheck: boolean;
    typewriterMode: boolean;
    focusMode: boolean;
    dailyWordGoal: number;
    smartQuotes: boolean;
    emDashExpansion: boolean;
  };
  chat: { model: string | null; overrides: Record<string, ChatOverride> };
  ai: { includeVeniceSystemPrompt: boolean };
  prompts: {
    system: null;
    continue: null;
    rewrite: null;
    expand: null;
    summarise: null;
    describe: null;
  };
}

interface DefaultSettingsOptions {
  model?: string | null;
  overrides?: Record<string, ChatOverride>;
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
      smartQuotes: true,
      emDashExpansion: true,
    },
    chat: {
      model: opts.model ?? null,
      overrides: opts.overrides ?? {},
    },
    ai: { includeVeniceSystemPrompt: true },
    prompts: {
      system: null,
      continue: null,
      rewrite: null,
      expand: null,
      summarise: null,
      describe: null,
    },
  };
}

// Two test models: m1 has Venice defaults; m2 has Venice defaults too (different).
const MODEL_M1: Model = {
  id: 'm1',
  name: 'Model One',
  contextLength: 128000,
  maxCompletionTokens: 16000,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: true,
  description: 'Test model 1.',
  pricing: null,
  defaultTemperature: 0.7,
  defaultTopP: 0.8,
};

const MODEL_M2: Model = {
  id: 'm2',
  name: 'Model Two',
  contextLength: 64000,
  maxCompletionTokens: 8000,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: 'Test model 2.',
  pricing: null,
  defaultTemperature: 1.2,
  defaultTopP: 0.95,
};

// A model with no Venice defaults (falls back to global defaults).
const MODEL_M3: Model = {
  id: 'm3',
  name: 'Model Three',
  contextLength: 32000,
  maxCompletionTokens: 4096,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: 'Test model 3 — no Venice defaults.',
  pricing: null,
  defaultTemperature: null,
  defaultTopP: null,
};

const TWO_MODELS_BODY = { models: [MODEL_M1, MODEL_M2] };
const THREE_MODELS_BODY = { models: [MODEL_M1, MODEL_M2, MODEL_M3] };

function veniceKeyStatus(): unknown {
  return { hasKey: false, lastFour: null, endpoint: null };
}

interface RouteOptions {
  modelsBody?: { models: Model[] };
  initialSettings?: DefaultSettingsOptions;
}

function buildFetch(opts: RouteOptions = {}): FetchMock {
  const modelsBody = opts.modelsBody ?? TWO_MODELS_BODY;
  let settings = makeSettings(opts.initialSettings ?? {});

  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (url === '/api/users/me/settings') {
      if (method === 'PATCH' && typeof init?.body === 'string') {
        const patch = JSON.parse(init.body) as Partial<SettingsState>;
        // Deep-ish merge matching backend + mergeSettings behavior.
        settings = {
          ...settings,
          ...patch,
          prose: { ...settings.prose, ...(patch.prose ?? {}) },
          writing: { ...settings.writing, ...(patch.writing ?? {}) },
          chat: {
            ...settings.chat,
            ...(patch.chat ?? {}),
            overrides: {
              ...settings.chat.overrides,
              ...((patch.chat as { overrides?: Record<string, ChatOverride> })?.overrides ?? {}),
            },
          },
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

// Render helper that exposes the QueryClient for cache pre-seeding.
function renderModal(
  ui: ReactElement,
  qc?: QueryClient,
): ReturnType<typeof render> & { qc: QueryClient } {
  const client = qc ?? createQueryClient();
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...result, qc: client };
}

describe('SettingsModal Models tab (X28)', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
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

  // -------------------------------------------------------------------------
  // 1. Sliders show resolved values (Venice default when no override)
  // -------------------------------------------------------------------------
  it('sliders show resolved values for the active model (Venice default when no override)', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: 'm1', overrides: {} },
      }),
    );

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    // m1 has defaultTemperature: 0.7, defaultTopP: 0.8, no override.
    // The resolver should surface Venice defaults.
    await waitFor(() => {
      expect(screen.getByTestId('param-temperature-value')).toHaveTextContent('0.70');
      expect(screen.getByTestId('param-top-p-value')).toHaveTextContent('0.80');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Switching active model in the picker updates slider readouts
  // -------------------------------------------------------------------------
  it('switching the active model in the picker updates slider readouts', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: 'm1', overrides: {} },
      }),
    );

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    // Initially m1 active: temp 0.70, topP 0.80
    await waitFor(() => {
      expect(screen.getByTestId('param-temperature-value')).toHaveTextContent('0.70');
    });

    // Click on m2 in the rail, then "Use this model"
    await user.click(await screen.findByTestId('model-rail-m2'));
    await user.click(screen.getByTestId('model-detail-cta'));

    // After switching to m2: temp 1.20, topP 0.95
    await waitFor(() => {
      expect(screen.getByTestId('param-temperature-value')).toHaveTextContent('1.20');
      expect(screen.getByTestId('param-top-p-value')).toHaveTextContent('0.95');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Dragging temperature PATCHes chat.overrides[activeModelId].temperature
  // -------------------------------------------------------------------------
  it('dragging temperature PATCHes chat.overrides[activeModelId].temperature', async () => {
    const fetchMock = buildFetch({
      modelsBody: TWO_MODELS_BODY,
      initialSettings: { model: 'm1', overrides: {} },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    // Wait until models have loaded and the slider is enabled before dragging.
    const temp = await screen.findByTestId('param-temperature');
    await waitFor(() => {
      expect(temp).not.toBeDisabled();
    });

    fireEvent.change(temp, { target: { value: '1.25' } });

    await waitFor(
      () => {
        const patch = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/settings' && init?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
        const init = (patch as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as {
          chat?: { overrides?: Record<string, { temperature?: number }> };
        };
        expect(body.chat?.overrides?.m1?.temperature).toBeCloseTo(1.25, 5);
      },
      { timeout: 1000 },
    );
  });

  // -------------------------------------------------------------------------
  // 4. Reset button is disabled when no overrides set for active model
  // -------------------------------------------------------------------------
  it('Reset button is disabled when no overrides set for active model', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: 'm1', overrides: {} },
      }),
    );

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    const resetBtn = await screen.findByTestId('param-reset');
    await waitFor(() => {
      expect(resetBtn).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Reset button clears overrides for the active model only
  // -------------------------------------------------------------------------
  it('Reset button clears overrides for the active model only', async () => {
    const fetchMock = buildFetch({
      modelsBody: TWO_MODELS_BODY,
      initialSettings: {
        model: 'm1',
        overrides: { m1: { temperature: 1.5 }, m2: { topP: 0.5 } },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    // Wait for the tab to be ready — Reset button enabled because m1 has override
    const resetBtn = await screen.findByTestId('param-reset');
    await waitFor(() => {
      expect(resetBtn).not.toBeDisabled();
    });

    await user.click(resetBtn);

    // The PATCH body should send m1: {} (empty override), preserving m2 in the payload.
    await waitFor(
      () => {
        const patches = fetchMock.mock.calls.filter(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/settings' && init?.method === 'PATCH',
        );
        expect(patches.length).toBeGreaterThan(0);
        const lastPatch = patches[patches.length - 1];
        const init = (lastPatch as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as {
          chat?: { overrides?: Record<string, unknown> };
        };
        // m1 cleared to empty override
        expect(body.chat?.overrides?.m1).toEqual({});
      },
      { timeout: 1000 },
    );
  });

  // -------------------------------------------------------------------------
  // 6. Sliders are disabled when chat.model is null
  // -------------------------------------------------------------------------
  it('sliders are disabled when chat.model is null', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: null, overrides: {} },
      }),
    );

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    await waitFor(() => {
      expect(screen.getByTestId('param-temperature')).toBeDisabled();
      expect(screen.getByTestId('param-top-p')).toBeDisabled();
      expect(screen.getByTestId('param-max-tokens')).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // 7. Reset tooltip mentions Venice defaults when at least one is exposed
  // -------------------------------------------------------------------------
  it('Reset tooltip mentions Venice defaults when both are exposed', async () => {
    // m1 has defaultTemperature: 0.7, defaultTopP: 0.8 → Venice defaults.
    // Set an override so Reset is enabled.
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: {
          model: 'm1',
          overrides: { m1: { temperature: 1.5 } },
        },
      }),
    );

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    const resetBtn = await screen.findByTestId('param-reset');
    await waitFor(() => {
      expect(resetBtn).not.toBeDisabled();
    });

    const title = resetBtn.getAttribute('title') ?? '';
    expect(title).toMatch(/venice/i);
    expect(title).toMatch(/0\.7/);
  });

  // -------------------------------------------------------------------------
  // 8. Reset tooltip says "general defaults" when Venice exposes neither
  // -------------------------------------------------------------------------
  it("Reset tooltip says 'general defaults' when Venice exposes neither", async () => {
    // m3 has defaultTemperature: null, defaultTopP: null → no Venice defaults.
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: THREE_MODELS_BODY,
        initialSettings: {
          model: 'm3',
          overrides: { m3: { temperature: 1.5 } },
        },
      }),
    );

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    const resetBtn = await screen.findByTestId('param-reset');
    await waitFor(() => {
      expect(resetBtn).not.toBeDisabled();
    });

    const title = resetBtn.getAttribute('title') ?? '';
    expect(title).toMatch(/general/i);
  });

  // -------------------------------------------------------------------------
  // 9. Params section follows the highlighted (clicked) model, not just the active one
  // -------------------------------------------------------------------------
  it('params section follows the highlighted (clicked) model, not just the active one', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: 'm1', overrides: {} },
      }),
    );

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    // Wait for models to load and initial params to show (m1: temp 0.70)
    await waitFor(() => {
      expect(screen.getByTestId('param-temperature-value')).toHaveTextContent('0.70');
    });

    // Click m2 in the rail WITHOUT clicking "Use this model"
    await user.click(await screen.findByTestId('model-rail-m2'));

    // Temperature slider now shows m2's defaultTemperature (1.2), NOT m1's (0.7)
    await waitFor(() => {
      expect(screen.getByTestId('param-temperature-value')).toHaveTextContent('1.20');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Max-tokens slider ceiling reflects the highlighted model cap (min with 32k)
  // -------------------------------------------------------------------------
  it('max-tokens slider ceiling reflects the highlighted model cap (min with 32k)', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: THREE_MODELS_BODY,
        initialSettings: { model: 'm1', overrides: {} },
      }),
    );

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    await screen.findByTestId('model-rail');
    await user.click(screen.getByTestId('model-rail-m3')); // m3: maxCompletionTokens 4096
    expect(screen.getByTestId('param-max-tokens')).toHaveAttribute('max', '4096');
  });

  // -------------------------------------------------------------------------
  // Legacy: renders the inline picker with the active model in the detail pane
  // -------------------------------------------------------------------------
  it('renders the inline picker with the active model in the detail pane', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({
        modelsBody: TWO_MODELS_BODY,
        initialSettings: { model: 'm1' },
      }),
    );
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('model-detail-name')).toHaveTextContent('Model One');
    expect(screen.getByTestId('model-detail-cta')).toHaveTextContent(/currently in use/i);
  });

  // -------------------------------------------------------------------------
  // Legacy: clicking "Use this model" PATCHes settings.chat.model
  // -------------------------------------------------------------------------
  it('clicking "Use this model" PATCHes settings.chat.model', async () => {
    const fetchMock = buildFetch({
      modelsBody: TWO_MODELS_BODY,
      initialSettings: { model: 'm1' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    await user.click(await screen.findByTestId('model-rail-m2'));
    await user.click(screen.getByTestId('model-detail-cta'));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/users/me/settings' && init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const init = (patch as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ chat: { model: 'm2' } });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy: initialTab="models" opens directly on Models tab
  // -------------------------------------------------------------------------
  it('initialTab="models" opens the modal directly on the Models tab', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetch({ modelsBody: TWO_MODELS_BODY, initialSettings: { model: 'm1' } }),
    );
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('settings-panel-models')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Legacy: does not render Cancel/Done buttons (auto-save chrome)
  // -------------------------------------------------------------------------
  it('does not render Cancel/Done buttons (auto-save chrome)', async () => {
    vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(screen.queryByTestId('settings-cancel')).toBeNull();
    expect(screen.queryByTestId('settings-done')).toBeNull();
    expect(screen.getByTestId('settings-autosave-hint')).toBeInTheDocument();
  });
});
