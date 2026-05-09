import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptRow } from '@/components/messageRow/TranscriptView';
import { TranscriptView } from '@/components/messageRow/TranscriptView';
import type { ChatMessage } from '@/hooks/useChat';
import { chatMessagesQueryKey } from '@/hooks/useChat';
import { useChatDraftStore } from '@/store/chatDraft';

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeMessage(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    id: over.id,
    role: 'user',
    contentJson: '',
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
      makeMessage({ id: 'm-1', role: 'user', contentJson: 'hi' }),
      makeMessage({ id: 'm-2', role: 'assistant', contentJson: 'hello' }),
    ]);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r) =>
                r.kind === 'persisted' ? (
                  <li key={rowKey(r)} data-testid="persisted">
                    {String(r.message.contentJson)}
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
      makeMessage({ id: 'm-1', role: 'user', contentJson: 'past' }),
      makeMessage({ id: 'm-2', role: 'assistant', contentJson: 'old' }),
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
                      {String(r.message.contentJson)}
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
      makeMessage({ id: 'm-X', role: 'user', contentJson: 'new question' }),
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
                      {String(r.message.contentJson)}
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
      makeMessage({ id: 'persisted-user', role: 'user', contentJson: 'previously sent' }),
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
                      {String(r.message.contentJson)}
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
