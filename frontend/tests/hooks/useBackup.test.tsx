import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload, useImportBackup } from '@/hooks/useBackup';
import * as apiModule from '@/lib/api';

function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('triggerDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an object URL and clicks an anchor with the filename', () => {
    const click = vi.fn();
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    triggerDownload(new Blob(['{}']), 'inkwell-backup.json');
    expect(createURL).toHaveBeenCalled();
    expect(anchor.download).toBe('inkwell-backup.json');
    expect(click).toHaveBeenCalled();
  });
});

describe('useImportBackup', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
    queryClient.unmount();
    vi.restoreAllMocks();
  });

  it('calls invalidateQueries on success', async () => {
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      imported: { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useImportBackup(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        formatVersion: 2,
        app: 'inkwell',
        exportedAt: '2026-06-24T12:00:00.000Z',
        stories: [],
      });
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });
});
