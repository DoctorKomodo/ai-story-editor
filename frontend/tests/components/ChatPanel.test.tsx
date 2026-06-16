import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/ChatPanel';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
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
      maxCompletionTokens: 4096,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      description: null,
      pricing: null,
      defaultTemperature: null,
      defaultTopP: null,
    },
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      maxCompletionTokens: 8192,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      description: null,
      pricing: null,
      defaultTemperature: null,
      defaultTopP: null,
    },
  ],
};

describe('ChatPanel (F38)', () => {
  let fetchMock: FetchMock;

  function seedSettings(partial?: Partial<typeof DEFAULT_SETTINGS>): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, ...partial });
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  function mockModels(body: unknown = SAMPLE_MODELS): void {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, body));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  }

  it('renders header tabs, model footer, body, and chat slot landmarks', () => {
    mockModels();
    renderWithProviders(
      <ChatPanel
        chatBody={<div data-testid="chat-slot">chat</div>}
        sceneBody={<div data-testid="scene-slot">scene</div>}
      />,
    );

    // Header — both tabs as role=tab.
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scene' })).toBeInTheDocument();

    // Model footer — testid + the MODEL label.
    expect(screen.getByTestId('model-footer')).toBeInTheDocument();
    expect(screen.getByText('MODEL')).toBeInTheDocument();

    // Scrollable body region.
    expect(screen.getByRole('region', { name: 'Chat messages' })).toBeInTheDocument();

    // Chat slot rendered on the default Chat tab.
    expect(screen.getByTestId('chat-slot')).toBeInTheDocument();
  });

  it('Model picker button calls onOpenModelPicker', async () => {
    mockModels();
    const onOpenModelPicker = vi.fn();
    renderWithProviders(
      <ChatPanel chatBody={<div />} sceneBody={<div />} onOpenModelPicker={onOpenModelPicker} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open model picker' }));
    expect(onOpenModelPicker).toHaveBeenCalledTimes(1);
  });

  it('renders model name and ctx chip from settings + models query', async () => {
    mockModels();
    const qc = seedSettings({
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-uncensored-1.5' },
    });

    renderWithProviders(<ChatPanel chatBody={<div />} sceneBody={<div />} />, qc);

    // Wait for the query to resolve and the picker to render the model name.
    await waitFor(() => {
      const picker = screen.getByRole('button', { name: 'Open model picker' });
      expect(picker).toHaveTextContent('Venice Uncensored 1.5');
    });

    // 32000 → "32k"
    expect(screen.getByTestId('ctx-chip')).toHaveTextContent('32k');
    // The Venice mark is rendered.
    expect(screen.getByTestId('venice-mark')).toBeInTheDocument();
  });

  it('shows "No model" and "—" ctx chip when no model is selected', () => {
    mockModels();
    // modelId left as null in beforeEach.
    renderWithProviders(<ChatPanel chatBody={<div />} sceneBody={<div />} />);

    expect(screen.getByText('No model')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-chip')).toHaveTextContent('—');
  });

  it('Scene tab becomes aria-selected when clicked and shows sceneBody', async () => {
    mockModels();
    renderWithProviders(
      <ChatPanel
        chatBody={<div data-testid="chat-slot">chat</div>}
        sceneBody={<div data-testid="scene-slot">scene content</div>}
      />,
    );

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    const sceneTab = screen.getByRole('tab', { name: 'Scene' });

    // Chat is active by default, scene body not visible.
    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(sceneTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('scene-slot')).not.toBeInTheDocument();

    await userEvent.click(sceneTab);

    // Scene tab is now active.
    expect(sceneTab).toHaveAttribute('aria-selected', 'true');
    expect(chatTab).toHaveAttribute('aria-selected', 'false');
    // sceneBody renders, chatBody does not.
    expect(screen.getByTestId('scene-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-slot')).not.toBeInTheDocument();
  });

  it('tab order is Chat → Scene', () => {
    mockModels();
    renderWithProviders(<ChatPanel chatBody={<div />} sceneBody={<div />} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('Chat');
    expect(tabs[1]).toHaveTextContent('Scene');
  });
});
