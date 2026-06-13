import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Story } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storyQueryKey, useUpdateStoryMutation } from '@/hooks/useStories';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

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
    setAccessToken('tok-1');
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

    await waitFor(() => {
      expect(client.getQueryData(storyQueryKey('s1'))).toEqual(updated);
    });
  });
});
