import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Chat, ChatSummary } from 'story-editor-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScenes } from '@/hooks/useScenes';
import * as api from '@/lib/api';

vi.mock('@/lib/api');

const SCENE_LIST_KEY = (chapterId: string) => ['scenes', chapterId] as const;

function makeWrapper(qc?: QueryClient): {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => ReactNode;
} {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe('useScenes', () => {
  beforeEach(() => {
    vi.mocked(api.listChats).mockResolvedValue([
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);
  });

  it('lists scene sessions for a chapter', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(api.listChats).toHaveBeenCalledWith('c1', { kind: 'scene' });
  });

  it('create() calls api.createChat with kind=scene and refetches', async () => {
    vi.mocked(api.createChat).mockResolvedValue({
      id: 's2',
      kind: 'scene',
      title: null,
      draftId: 'c1',
      createdAt: '',
      updatedAt: '',
      lastActivityAt: '',
    } satisfies Chat);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.create();
    });
    expect(api.createChat).toHaveBeenCalledWith('c1', { kind: 'scene' });
  });

  it('create() optimistically prepends the new chat to the query cache', async () => {
    // Bug 1 fix: createMut.onSuccess sets the cache immediately before the
    // invalidate/refetch completes. This prevents the auto-select effect from
    // seeing sessions=[] while activeId is set, which would reset activeId to null.
    const newChat: Chat = {
      id: 's2',
      kind: 'scene',
      title: null,
      draftId: 'c1',
      createdAt: '',
      updatedAt: '',
      lastActivityAt: '',
    };
    // Delay the refetch so we can observe the optimistic cache state.
    vi.mocked(api.createChat).mockResolvedValue(newChat);
    vi.mocked(api.listChats).mockResolvedValueOnce([
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);
    // Second call (post-invalidate refetch) never resolves during this test — we
    // want to observe the optimistic state before the network responds.
    vi.mocked(api.listChats).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const { client, wrapper } = makeWrapper();
    // Seed the cache so useQuery starts with existing data.
    client.setQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'), [
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);

    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.create();
    });

    // Optimistic update: the new chat must be in the cache immediately, prepended.
    const cached = client.getQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'));
    expect(cached).toBeDefined();
    expect(cached?.[0]?.id).toBe('s2');
    expect(cached?.[1]?.id).toBe('s1');
  });

  it('rename() calls api.patchChat', async () => {
    vi.mocked(api.patchChat).mockResolvedValue({
      id: 's1',
      kind: 'scene',
      title: 'New title',
      draftId: 'c1',
      createdAt: '',
      updatedAt: '',
      lastActivityAt: '',
    } satisfies Chat);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.rename('s1', 'New title');
    });
    expect(api.patchChat).toHaveBeenCalledWith('s1', 'New title');
  });

  it('rename() reflects the server-returned title in the query cache, not the client input', async () => {
    // The server normalises the title (e.g. trims whitespace). The cache must
    // reflect the server value, not the raw client-supplied string, so the
    // picker stays in sync with what is actually stored.
    vi.mocked(api.patchChat).mockResolvedValue({
      id: 's1',
      kind: 'scene',
      title: 'Server-Normalized Title',
      draftId: 'c1',
      createdAt: '',
      updatedAt: '',
      lastActivityAt: '',
    } satisfies Chat);
    // Keep the refetch pending so we can assert on the cache before it refills.
    vi.mocked(api.listChats).mockResolvedValueOnce([
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);
    vi.mocked(api.listChats).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const { client, wrapper } = makeWrapper();
    client.setQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'), [
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);

    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    // The client sends a different string than what the server returns.
    await act(async () => {
      await result.current.rename('s1', 'client title');
    });

    // Cache must reflect what the server returned, not the client input.
    const cached = client.getQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'));
    expect(cached).toBeDefined();
    expect(cached?.[0]?.title).toBe('Server-Normalized Title');
    expect(cached?.[0]?.title).not.toBe('client title');
  });

  it('remove() calls api.deleteChat', async () => {
    vi.mocked(api.deleteChat).mockResolvedValue();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.remove('s1');
    });
    expect(api.deleteChat).toHaveBeenCalledWith('s1');
  });

  it('remove() optimistically removes the chat from the query cache', async () => {
    vi.mocked(api.deleteChat).mockResolvedValue();
    // Keep the refetch pending so we can assert on the optimistic cache state.
    vi.mocked(api.listChats).mockResolvedValueOnce([
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);
    vi.mocked(api.listChats).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const { client, wrapper } = makeWrapper();
    client.setQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'), [
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        draftId: 'c1',
        createdAt: '',
        updatedAt: '',
        lastActivityAt: '',
        messageCount: 0,
      },
    ]);

    const { result } = renderHook(() => useScenes('c1'), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.remove('s1');
    });

    // Optimistic update: the deleted chat must be gone from the cache immediately.
    const cached = client.getQueryData<ChatSummary[]>(SCENE_LIST_KEY('c1'));
    expect(cached).toBeDefined();
    expect(cached?.find((c) => c.id === 's1')).toBeUndefined();
  });
});
