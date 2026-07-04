import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Story } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  storiesQueryKey,
  storyQueryKey,
  useDeleteStoryMutation,
  useUpdateStoryMutation,
} from '@/hooks/useStories';
import { resetApiClientForTests } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: 'The Long Dark',
    genre: 'Sci-Fi',
    synopsis: 'A ship adrift.',
    worldNotes: null,
    targetWords: 80_000,
    includePreviousChaptersInPrompt: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('useUpdateStoryMutation', () => {
  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('writes the returned story into storyQueryKey(id) on success', async () => {
    const updated = makeStory({ title: 'Renamed' });
    fetchMock.mockResolvedValue(jsonResponse(200, { story: updated }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateStoryMutation(), { wrapper });

    await result.current.mutateAsync({ id: 's1', input: { title: 'Renamed' } });

    expect(client.getQueryData(storyQueryKey('s1'))).toEqual(updated);
  });
});

describe('useDeleteStoryMutation', () => {
  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('DELETEs /stories/:id, evicts the per-story cache, and invalidates the list on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(storyQueryKey('s1'), makeStory());
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteStoryMutation(), { wrapper });

    await result.current.mutateAsync('s1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/stories/s1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(client.getQueryData(storyQueryKey('s1'))).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: storiesQueryKey });
  });

  it('surfaces the error on a failed delete (no silent catch)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { message: 'boom', code: 'internal_error' } }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteStoryMutation(), { wrapper });

    await expect(result.current.mutateAsync('s1')).rejects.toThrow('boom');
  });
});
