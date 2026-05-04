// [F42] Model Picker modal — covers visibility, dialog accessibility,
// radio-card list rendering from `useModelsQuery`, the selected-card
// `aria-checked` state, click → useUpdateUserSetting PATCH + onClose
// wiring, and modal-close behaviour (X button, Escape, backdrop).
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from '@/components/ModelPicker';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
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

const THREE_MODELS = {
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
    {
      id: 'deepseek-r1',
      name: 'DeepSeek R1',
      contextLength: 64000,
      supportsReasoning: true,
      supportsVision: false,
      supportsWebSearch: false,
    },
  ],
};

function renderPicker(
  ui: ReactElement,
  opts: { modelId?: string | null } = {},
): { client: QueryClient } {
  const client = createQueryClient();
  client.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: opts.modelId ?? null },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
}

describe('ModelPicker (F42)', () => {
  let fetchMock: FetchMock;
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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('does not render when open=false', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    renderPicker(<ModelPicker open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible dialog when open', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    renderPicker(<ModelPicker open onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: /pick a model/i });
    expect(dialog).toBeInTheDocument();
  });

  it('lists every model returned by the query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, THREE_MODELS));
    renderPicker(<ModelPicker open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-card-venice-uncensored')).toBeInTheDocument();
      expect(screen.getByTestId('model-card-llama-3.3-70b')).toBeInTheDocument();
      expect(screen.getByTestId('model-card-deepseek-r1')).toBeInTheDocument();
    });

    // Each card should be a radio inside a radiogroup.
    const group = screen.getByRole('radiogroup', { name: /model/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the currently-selected card with aria-checked=true', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, THREE_MODELS));
    renderPicker(<ModelPicker open onClose={onClose} />, { modelId: 'llama-3.3-70b' });

    const selected = await screen.findByTestId('model-card-llama-3.3-70b');
    expect(selected).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByTestId('model-card-venice-uncensored')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByTestId('model-card-deepseek-r1')).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking a card PATCHes /users/me/settings and calls onClose (multi-device fix)', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, THREE_MODELS));
      }
      if (url.endsWith('/users/me/settings') && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(200, {
            settings: {
              ...DEFAULT_SETTINGS,
              chat: { ...DEFAULT_SETTINGS.chat, model: 'deepseek-r1' },
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    const user = userEvent.setup();
    const { client } = renderPicker(<ModelPicker open onClose={onClose} />);

    const card = await screen.findByTestId('model-card-deepseek-r1');
    await user.click(card);

    // Optimistic cache update is synchronous; PATCH fires after.
    expect(client.getQueryData<typeof DEFAULT_SETTINGS>(userSettingsQueryKey)?.chat.model).toBe(
      'deepseek-r1',
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/users/me/settings') &&
            (init as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the close X fires onClose', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    const user = userEvent.setup();
    renderPicker(<ModelPicker open onClose={onClose} />);

    await user.click(screen.getByTestId('model-picker-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the modal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    const user = userEvent.setup();
    renderPicker(<ModelPicker open onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes the modal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    const user = userEvent.setup();
    renderPicker(<ModelPicker open onClose={onClose} />);

    const backdrop = screen.getByTestId('model-picker-backdrop');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders a context-length pill for each model', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, THREE_MODELS));
    renderPicker(<ModelPicker open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-card-venice-uncensored-ctx')).toHaveTextContent(/33k/i);
    });
    expect(screen.getByTestId('model-card-llama-3.3-70b-ctx')).toHaveTextContent(/128k/i);
    expect(screen.getByTestId('model-card-deepseek-r1-ctx')).toHaveTextContent(/64k/i);
  });

  it('renders an empty state when no models are available', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    renderPicker(<ModelPicker open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/no models available/i)).toBeInTheDocument();
    });
  });

  it('[X27] renders the price-units hint when open', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
    renderPicker(<ModelPicker open onClose={onClose} />);
    expect(await screen.findByTestId('model-picker-price-hint')).toHaveTextContent(
      /prices are usd per 1m tokens/i,
    );
  });
});
