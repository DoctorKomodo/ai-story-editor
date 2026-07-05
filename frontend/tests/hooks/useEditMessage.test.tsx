import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatMessagesQueryKey, chatsBaseQueryKey, useEditMessageMutation } from '@/hooks/useChat';
import { resetApiClientForTests } from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function makeWrapper(client: QueryClient): (p: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useEditMessageMutation', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('PATCHes the message and invalidates messages + chats list', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        message: {
          id: 'm1',
          role: 'user',
          content: 'edited',
          attachmentJson: null,
          citationsJson: null,
          model: null,
          tokens: null,
          latencyMs: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          // updatedAt is nullable — non-null here since the message was edited
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      }),
    );

    const { result } = renderHook(() => useEditMessageMutation(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({
        chatId: 'c1',
        draftId: 'ch1',
        messageId: 'm1',
        content: 'edited',
      });
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chats/c1/messages/m1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ content: 'edited' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatMessagesQueryKey('c1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatsBaseQueryKey('ch1') });
  });
});
