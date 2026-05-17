import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Message } from 'story-editor-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptRow } from '@/components/messageRow/TranscriptView';
import { TranscriptView } from '@/components/messageRow/TranscriptView';
import { chatMessagesQueryKey } from '@/hooks/useChat';
import { ApiError } from '@/lib/api';
import { useChatDraftStore } from '@/store/chatDraft';

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeMessage(over: Partial<Message> & { id: string }): Message {
  return {
    id: over.id,
    role: 'user',
    content: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function rowKey(r: TranscriptRow): string {
  if (r.kind === 'persisted') return r.message.id;
  return r.kind;
}

describe('TranscriptView', () => {
  beforeEach(() => {
    useChatDraftStore.setState({ drafts: {} });
  });

  it('renders empty state when chatId is null', () => {
    const qc = makeQc();
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId={null} emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('renders empty state when no messages and no draft', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), []);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('renders persisted messages via render-prop', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-1', role: 'user', content: 'hi' }),
      makeMessage({ id: 'm-2', role: 'assistant', content: 'hello' }),
    ]);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r) =>
                r.kind === 'persisted' ? (
                  <li key={rowKey(r)} data-testid="persisted">
                    {r.message.content}
                  </li>
                ) : null,
              )}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    const items = screen.getAllByTestId('persisted');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('hi');
    expect(items[1]).toHaveTextContent('hello');
  });

  it('merges draft pair after persisted messages', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-1', role: 'user', content: 'past' }),
      makeMessage({ id: 'm-2', role: 'assistant', content: 'old' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: 'new question',
      attachment: null,
    });
    useChatDraftStore.getState().appendDelta('c-1', 'streaming response');
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r) => {
                if (r.kind === 'persisted')
                  return (
                    <li key={rowKey(r)} data-testid="persisted">
                      {r.message.content}
                    </li>
                  );
                if (r.kind === 'draft-user')
                  return (
                    <li key={rowKey(r)} data-testid="draft-user">
                      {r.userContent}
                    </li>
                  );
                return (
                  <li key={rowKey(r)} data-testid="draft-assistant">
                    {r.assistantText}
                  </li>
                );
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId('persisted')).toHaveLength(2);
    expect(screen.getByTestId('draft-user')).toHaveTextContent('new question');
    expect(screen.getByTestId('draft-assistant')).toHaveTextContent('streaming response');
  });

  it('suppresses draft-user when persisted trailing user matches draft userContent (mid-stream-error path)', () => {
    // Simulates the moment after server persistence + cache refetch — the
    // persisted user matches the draft's userContent; the draft-user is
    // redundant and would cause a duplicate flicker.
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-X', role: 'user', content: 'new question' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: 'new question',
      attachment: null,
    });
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r) => {
                if (r.kind === 'persisted')
                  return (
                    <li key={rowKey(r)} data-testid="persisted">
                      {r.message.content}
                    </li>
                  );
                if (r.kind === 'draft-user')
                  return (
                    <li key={rowKey(r)} data-testid="draft-user">
                      {r.userContent}
                    </li>
                  );
                return (
                  <li key={rowKey(r)} data-testid="draft-assistant">
                    {r.assistantText}
                  </li>
                );
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('persisted')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-user')).toBeNull();
  });

  it('suppresses draft-user when draft.userContent is empty (retry path)', () => {
    // Simulates the retry path: mutateAsync({retry: true}) calls start()
    // with userContent: ''. The user is already persisted; rendering an
    // empty synthetic user bubble would be ugly.
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'persisted-user', role: 'user', content: 'previously sent' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: '',
      attachment: null,
    });
    useChatDraftStore.getState().appendDelta('c-1', 'regenerated reply');
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r) => {
                if (r.kind === 'persisted')
                  return (
                    <li key={rowKey(r)} data-testid="persisted">
                      {r.message.content}
                    </li>
                  );
                if (r.kind === 'draft-user')
                  return (
                    <li key={rowKey(r)} data-testid="draft-user">
                      {r.userContent}
                    </li>
                  );
                return (
                  <li key={rowKey(r)} data-testid="draft-assistant">
                    {r.assistantText}
                  </li>
                );
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    // The persisted user is shown; no synthetic empty-user bubble.
    expect(screen.getByTestId('persisted')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-user')).toBeNull();
    expect(screen.getByTestId('draft-assistant')).toHaveTextContent('regenerated reply');
  });

  it('renders error state with Retry button when query.isError', () => {
    const qc = makeQc();
    // Force isError state by setting a failed-promise query.
    qc.setQueryDefaults(chatMessagesQueryKey('c-err'), {
      queryFn: () => Promise.reject(new Error('boom')),
      retry: false,
    });
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-err" emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    return waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});

describe('TranscriptView — send-error branch', () => {
  beforeEach(() => {
    useChatDraftStore.setState({ drafts: {} });
  });

  function renderWithOneMessage(sendError?: ApiError | null) {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-1', role: 'user', content: 'hi' }),
    ]);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>} sendError={sendError}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
  }

  it('sendError == null → no VeniceErrorBanner rendered', () => {
    renderWithOneMessage(null);
    expect(screen.queryByTestId('venice-error-banner')).toBeNull();
  });

  it('sendError venice_rate_limited with retryAfterSeconds → renders banner with countdown', () => {
    vi.useFakeTimers();
    const error = new ApiError(429, 'Rate limited', 'venice_rate_limited', {
      error: { message: 'Rate limited', code: 'venice_rate_limited', retryAfterSeconds: 7 },
    });
    renderWithOneMessage(error);
    expect(screen.getByTestId('venice-error-banner')).toBeInTheDocument();
    expect(screen.getByText(/Try again in 7s/)).toBeInTheDocument();
    act(() => {
      vi.useRealTimers();
    });
  });

  it('sendError venice_key_invalid with veniceMessage → renders Open Settings + Venice said line', () => {
    const error = new ApiError(401, 'Invalid Venice key', 'venice_key_invalid', {
      error: {
        message: 'Invalid Venice key',
        code: 'venice_key_invalid',
        details: { veniceMessage: 'Bad bearer token.' },
      },
    });
    renderWithOneMessage(error);
    expect(screen.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
    expect(screen.getByText(/Venice said: Bad bearer token\./)).toBeInTheDocument();
  });
});
