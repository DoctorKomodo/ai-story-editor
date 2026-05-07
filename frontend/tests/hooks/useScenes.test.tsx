import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScenes } from '@/hooks/useScenes';
import * as api from '@/lib/api';

vi.mock('@/lib/api');

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useScenes', () => {
  beforeEach(() => {
    vi.mocked(api.listChats).mockResolvedValue([
      {
        id: 's1',
        kind: 'scene',
        title: 'Veranda',
        chapterId: 'c1',
        createdAt: '',
        updatedAt: '',
      },
    ]);
  });

  it('lists scene sessions for a chapter', async () => {
    const { result } = renderHook(() => useScenes('c1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(api.listChats).toHaveBeenCalledWith('c1', { kind: 'scene' });
  });

  it('create() calls api.createChat with kind=scene and refetches', async () => {
    vi.mocked(api.createChat).mockResolvedValue({
      id: 's2',
      kind: 'scene',
      title: null,
      chapterId: 'c1',
      createdAt: '',
      updatedAt: '',
    });
    const { result } = renderHook(() => useScenes('c1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.create();
    });
    expect(api.createChat).toHaveBeenCalledWith('c1', { kind: 'scene' });
  });

  it('rename() calls api.patchChat', async () => {
    vi.mocked(api.patchChat).mockResolvedValue({} as never);
    const { result } = renderHook(() => useScenes('c1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.rename('s1', 'New title');
    });
    expect(api.patchChat).toHaveBeenCalledWith('s1', 'New title');
  });

  it('remove() calls api.deleteChat', async () => {
    vi.mocked(api.deleteChat).mockResolvedValue();
    const { result } = renderHook(() => useScenes('c1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.remove('s1');
    });
    expect(api.deleteChat).toHaveBeenCalledWith('s1');
  });
});
