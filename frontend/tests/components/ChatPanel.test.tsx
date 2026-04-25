import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/ChatPanel';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
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

function renderWithProviders(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

const SAMPLE_MODELS = {
  models: [
    {
      id: 'venice-uncensored-1.5',
      name: 'Venice Uncensored 1.5',
      contextLength: 32000,
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

const DEFAULT_PARAMS = {
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 800,
  frequencyPenalty: 0,
};

describe('ChatPanel (F38)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useModelStore.setState({ modelId: null });
    useParamsStore.setState({ params: { ...DEFAULT_PARAMS } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useModelStore.setState({ modelId: null });
    useParamsStore.setState({ params: { ...DEFAULT_PARAMS } });
  });

  function mockModels(body: unknown = SAMPLE_MODELS): void {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, body));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  }

  it('renders header tabs, model bar, body, and composer landmarks', () => {
    mockModels();
    renderWithProviders(
      <ChatPanel
        messagesBody={<div data-testid="msg-slot">messages</div>}
        composer={<div data-testid="composer-slot">composer</div>}
      />,
    );

    // Header — both tabs as role=tab.
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();

    // Model bar — testid + the MODEL label.
    expect(screen.getByTestId('model-bar')).toBeInTheDocument();
    expect(screen.getByText('MODEL')).toBeInTheDocument();

    // Scrollable body region.
    expect(screen.getByRole('region', { name: 'Chat messages' })).toBeInTheDocument();

    // Slot props rendered.
    expect(screen.getByTestId('msg-slot')).toBeInTheDocument();
    expect(screen.getByTestId('composer-slot')).toBeInTheDocument();
  });

  it('Chat tab is active by default; clicking History flips state', async () => {
    mockModels();
    renderWithProviders(
      <ChatPanel
        messagesBody={<div data-testid="msg-slot">messages</div>}
        composer={<div data-testid="composer-slot">composer</div>}
      />,
    );

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    const historyTab = screen.getByRole('tab', { name: 'History' });

    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(historyTab).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(historyTab);

    expect(chatTab).toHaveAttribute('aria-selected', 'false');
    expect(historyTab).toHaveAttribute('aria-selected', 'true');
  });

  it('New chat button calls onNewChat', async () => {
    mockModels();
    const onNewChat = vi.fn();
    renderWithProviders(
      <ChatPanel messagesBody={<div />} composer={<div />} onNewChat={onNewChat} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('Settings button calls onOpenSettings', async () => {
    mockModels();
    const onOpenSettings = vi.fn();
    renderWithProviders(
      <ChatPanel messagesBody={<div />} composer={<div />} onOpenSettings={onOpenSettings} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('Model picker button calls onOpenModelPicker', async () => {
    mockModels();
    const onOpenModelPicker = vi.fn();
    renderWithProviders(
      <ChatPanel messagesBody={<div />} composer={<div />} onOpenModelPicker={onOpenModelPicker} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open model picker' }));
    expect(onOpenModelPicker).toHaveBeenCalledTimes(1);
  });

  it('renders model name and ctx chip from the store + models query', async () => {
    mockModels();
    useModelStore.setState({ modelId: 'venice-uncensored-1.5' });

    renderWithProviders(<ChatPanel messagesBody={<div />} composer={<div />} />);

    // Wait for the query to resolve and the picker to render the model name.
    await waitFor(() => {
      const picker = screen.getByRole('button', { name: 'Open model picker' });
      expect(picker).toHaveTextContent('Venice Uncensored 1.5');
    });

    // 32000 → "32k"
    expect(screen.getByTestId('ctx-chip')).toHaveTextContent('32k');
    // The Venice mark is rendered.
    expect(screen.getByTestId('venice-mark')).toBeInTheDocument();
    // The right-aligned model label uses the same human name.
    expect(screen.getByTestId('model-label')).toHaveTextContent('Venice Uncensored 1.5');
  });

  it('shows "No model" and "—" ctx chip when no model is selected', () => {
    mockModels();
    // modelId left as null in beforeEach.
    renderWithProviders(<ChatPanel messagesBody={<div />} composer={<div />} />);

    expect(screen.getByText('No model')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-chip')).toHaveTextContent('—');
  });

  it('renders the params row from current store values', () => {
    mockModels();
    useParamsStore.setState({
      params: { temperature: 0.7, topP: 0.9, maxTokens: 1200, frequencyPenalty: 0 },
    });

    renderWithProviders(<ChatPanel messagesBody={<div />} composer={<div />} />);

    const params = screen.getByTestId('model-params');
    expect(params.textContent ?? '').toContain('temp 0.7');
    expect(params.textContent ?? '').toContain('top_p 0.9');
    expect(params.textContent ?? '').toContain('max 1200');
  });

  it('composer is visible on Chat tab and hidden on History tab', async () => {
    mockModels();
    renderWithProviders(
      <ChatPanel
        messagesBody={<div data-testid="msg-slot">messages</div>}
        composer={<div data-testid="composer-slot">composer</div>}
      />,
    );

    expect(screen.getByTestId('composer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('msg-slot')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.queryByTestId('composer-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('msg-slot')).not.toBeInTheDocument();
    expect(screen.getByText(/history — coming in a future task/i)).toBeInTheDocument();
  });
});
