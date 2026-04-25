// [F42] Model Picker modal — covers visibility, dialog accessibility,
// radio-card list rendering from `useModelsQuery`, the selected-card
// `aria-checked` state, click → `useModelStore.setModelId` + onClose
// wiring, and modal-close behaviour (X button, Escape, backdrop).
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from '@/components/ModelPicker';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useModelStore } from '@/store/model';
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

function renderPicker(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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
    useModelStore.setState({ modelId: null });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useModelStore.setState({ modelId: null });
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
    useModelStore.setState({ modelId: 'llama-3.3-70b' });
    fetchMock.mockResolvedValue(jsonResponse(200, THREE_MODELS));
    renderPicker(<ModelPicker open onClose={onClose} />);

    const selected = await screen.findByTestId('model-card-llama-3.3-70b');
    expect(selected).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByTestId('model-card-venice-uncensored')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByTestId('model-card-deepseek-r1')).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking a card sets useModelStore.modelId and calls onClose', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, THREE_MODELS));
    const user = userEvent.setup();
    renderPicker(<ModelPicker open onClose={onClose} />);

    const card = await screen.findByTestId('model-card-deepseek-r1');
    await user.click(card);

    expect(useModelStore.getState().modelId).toBe('deepseek-r1');
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
});
