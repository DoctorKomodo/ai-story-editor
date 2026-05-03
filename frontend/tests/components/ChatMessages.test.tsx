import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessages, formatTokens } from '@/components/ChatMessages';
import type { ChatMessage } from '@/hooks/useChat';
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

function renderWithProviders(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

function makeMessage(
  over: Partial<ChatMessage> & { id: string; role: ChatMessage['role'] },
): ChatMessage {
  return {
    contentJson: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: '2026-04-25T00:00:00.000Z',
    ...over,
  };
}

describe('ChatMessages (F39)', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  function mockMessages(messages: ChatMessage[]): void {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/chats/') && url.endsWith('/messages')) {
        return Promise.resolve(jsonResponse(200, { messages }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  }

  it('formatTokens compresses values >= 1000 into "k" and renders raw small counts', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(412)).toBe('412');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(2400)).toBe('2.4k');
  });

  it('empty state: renders "Start a conversation" + 3 suggestion chips that fire onPickSuggestion', async () => {
    const onPick = vi.fn();
    renderWithProviders(<ChatMessages chatId={null} onPickSuggestion={onPick} />);

    expect(screen.getByText('Start a conversation')).toBeInTheDocument();

    const rewrite = screen.getByTestId('suggestion-rewrite');
    const describeBtn = screen.getByTestId('suggestion-describe');
    const expand = screen.getByTestId('suggestion-expand');

    expect(rewrite).toBeInTheDocument();
    expect(describeBtn).toBeInTheDocument();
    expect(expand).toBeInTheDocument();

    await userEvent.click(rewrite);
    await userEvent.click(describeBtn);
    await userEvent.click(expand);

    expect(onPick).toHaveBeenNthCalledWith(1, 'rewrite');
    expect(onPick).toHaveBeenNthCalledWith(2, 'describe');
    expect(onPick).toHaveBeenNthCalledWith(3, 'expand');

    // No context chip when chatId is null.
    expect(screen.queryByTestId('context-chip')).not.toBeInTheDocument();
  });

  it('shows loading state while the query is in flight', () => {
    // Use a never-resolving fetch so isLoading stays true.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderWithProviders(<ChatMessages chatId="chat-1" />);
    expect(screen.getByTestId('chat-loading')).toBeInTheDocument();
  });

  it('shows an error state when the messages fetch rejects', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/chats/') && url.endsWith('/messages')) {
        return Promise.resolve(jsonResponse(500, { error: { message: 'boom' } }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    // Disable retries so the error is observable quickly.
    const qc = createQueryClient();
    qc.setDefaultOptions({ queries: { retry: false } });
    renderWithProviders(<ChatMessages chatId="chat-1" />, qc);

    await waitFor(() => {
      expect(screen.getByTestId('chat-error')).toBeInTheDocument();
    });
  });

  it('renders user bubble for role:user messages', async () => {
    mockMessages([makeMessage({ id: 'm1', role: 'user', contentJson: 'Hello there' })]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument();
    });
    const bubble = screen.getByText('Hello there');
    expect(bubble.className).toContain('user-bubble');
  });

  it('renders assistant bubble with serif + 2px left border via class hooks', async () => {
    mockMessages([
      makeMessage({
        id: 'm-ai',
        role: 'assistant',
        contentJson: 'Consider the rhythm.',
        tokens: 412,
        latencyMs: 1800,
      }),
    ]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    const bubble = await screen.findByTestId('assistant-m-ai');
    expect(bubble).toHaveTextContent('Consider the rhythm.');
    expect(bubble.className).toContain('assistant-bubble');
    expect(bubble.className).toContain('font-serif');
    expect(bubble.className).toContain('border-l-2');
    expect(bubble.getAttribute('data-message-id')).toBe('m-ai');
  });

  it('renders attachment preview above user bubble when selectionText is present', async () => {
    mockMessages([
      makeMessage({
        id: 'm-att',
        role: 'user',
        contentJson: 'What about this?',
        attachmentJson: { selectionText: 'The dragon roared.', chapterId: 'ch-3' },
      }),
    ]);
    renderWithProviders(<ChatMessages chatId="chat-1" chapterTitle="Chapter 3" />);

    const preview = await screen.findByTestId('attachment-m-att');
    expect(preview).toBeInTheDocument();
    expect(within(preview).getByText('The dragon roared.')).toBeInTheDocument();
    // Caption "FROM CH. <UPPERCASED chapterTitle>" — chapterTitle="Chapter 3"
    // becomes "CHAPTER 3".
    expect(within(preview).getByText(/^FROM CH\. CHAPTER 3$/)).toBeInTheDocument();
  });

  it('does NOT render attachment preview when attachmentJson is null', async () => {
    mockMessages([makeMessage({ id: 'm-no-att', role: 'user', contentJson: 'plain msg' })]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    await waitFor(() => {
      expect(screen.getByText('plain msg')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('attachment-m-no-att')).not.toBeInTheDocument();
  });

  it('renders Copy + Regenerate buttons on assistant meta row', async () => {
    mockMessages([makeMessage({ id: 'm1', role: 'assistant', contentJson: 'AI text' })]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    await screen.findByTestId('assistant-m1');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('Copy button calls onCopyMessage AND writes to clipboard with the message text', async () => {
    mockMessages([makeMessage({ id: 'm1', role: 'assistant', contentJson: 'copy me' })]);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const onCopy = vi.fn();
    renderWithProviders(<ChatMessages chatId="chat-1" onCopyMessage={onCopy} />);

    await screen.findByTestId('assistant-m1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(onCopy).toHaveBeenCalledWith('m1');
  });

  it('Regenerate button calls onRegenerateMessage with the message id', async () => {
    mockMessages([makeMessage({ id: 'm1', role: 'assistant', contentJson: 'AI' })]);
    const onRegen = vi.fn();
    renderWithProviders(<ChatMessages chatId="chat-1" onRegenerateMessage={onRegen} />);

    await screen.findByTestId('assistant-m1');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegen).toHaveBeenCalledWith('m1');
  });

  it('shows tokens · latency when both are present, hides otherwise', async () => {
    mockMessages([
      makeMessage({
        id: 'm-stats',
        role: 'assistant',
        contentJson: 'with stats',
        tokens: 412,
        latencyMs: 1800,
      }),
      makeMessage({
        id: 'm-no-stats',
        role: 'assistant',
        contentJson: 'no stats',
        tokens: null,
        latencyMs: null,
      }),
    ]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    await screen.findByTestId('assistant-m-stats');
    expect(screen.getByTestId('stats-m-stats')).toHaveTextContent('412 tok · 1.8s');
    expect(screen.queryByTestId('stats-m-no-stats')).not.toBeInTheDocument();
  });

  it('renders the dashed context chip with chapter title + counts', async () => {
    mockMessages([makeMessage({ id: 'm1', role: 'user', contentJson: 'hi' })]);
    renderWithProviders(
      <ChatMessages
        chatId="chat-1"
        chapterTitle="Chapter 3"
        attachedCharacterCount={4}
        attachedTokenCount={2400}
      />,
    );

    const chip = await screen.findByTestId('context-chip');
    expect(chip.textContent ?? '').toContain('Chapter 3');
    expect(chip.textContent ?? '').toContain('4 characters');
    expect(chip.textContent ?? '').toContain('2.4k tokens attached to context');
    expect(chip.className).toContain('border-dashed');
  });

  it('renders one data-citations-slot per assistant message (F50 mount point)', async () => {
    mockMessages([
      makeMessage({ id: 'a1', role: 'assistant', contentJson: 'first' }),
      makeMessage({ id: 'u1', role: 'user', contentJson: 'between' }),
      makeMessage({ id: 'a2', role: 'assistant', contentJson: 'second' }),
    ]);
    const { container } = renderWithProviders.bind(null)(
      <ChatMessages chatId="chat-1" />,
    ) as unknown as { client: QueryClient };
    void container;

    await screen.findByTestId('assistant-a2');
    const slots = document.querySelectorAll('[data-citations-slot]');
    expect(slots.length).toBe(2);
    const ids = Array.from(slots).map((el) => el.getAttribute('data-message-id'));
    expect(ids).toEqual(['a1', 'a2']);
  });

  it('does NOT render system role messages', async () => {
    mockMessages([
      makeMessage({ id: 'sys', role: 'system', contentJson: 'SYSTEM PROMPT' }),
      makeMessage({ id: 'u1', role: 'user', contentJson: 'visible user msg' }),
    ]);
    renderWithProviders(<ChatMessages chatId="chat-1" />);

    await waitFor(() => {
      expect(screen.getByText('visible user msg')).toBeInTheDocument();
    });
    expect(screen.queryByText('SYSTEM PROMPT')).not.toBeInTheDocument();
  });

  describe('sendError', () => {
    it('renders InlineErrorBanner at the end when sendError is set; Retry fires onRetrySend', async () => {
      mockMessages([
        makeMessage({ id: 'm1', role: 'user', contentJson: 'hello' }),
        makeMessage({ id: 'm2', role: 'assistant', contentJson: 'hi' }),
      ]);
      const onRetry = vi.fn();
      renderWithProviders(
        <ChatMessages
          chatId="c1"
          sendError={new Error('venice_key_invalid · bad key')}
          onRetrySend={onRetry}
        />,
      );

      // Wait for the messages query to resolve so the banner sits at the
      // bottom of a real list rather than during the loading state.
      await screen.findByTestId('assistant-m2');

      const banner = screen.getByTestId('inline-error-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/venice_key_invalid · bad key/);

      await userEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render the banner when sendError is null', async () => {
      mockMessages([makeMessage({ id: 'm1', role: 'user', contentJson: 'hi' })]);
      renderWithProviders(<ChatMessages chatId="c1" sendError={null} />);
      await screen.findByText('hi');
      expect(screen.queryByTestId('inline-error-banner')).toBeNull();
    });
  });
});
