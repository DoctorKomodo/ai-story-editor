// StoryBrowser — picker + create modal + navigation wiring shared by the
// dashboard landing surface and the in-editor Your-Stories modal.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryBrowser } from '@/components/StoryBrowser';
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

function LocationProbe(): null {
  const loc = useLocation();
  (window as unknown as { __probeLocation: string }).__probeLocation = loc.pathname;
  return null;
}

function probeLocation(): string {
  return (window as unknown as { __probeLocation: string }).__probeLocation;
}

function makeStory(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    genre: 'Fantasy',
    synopsis: null,
    worldNotes: null,
    targetWords: 80_000,
    chapterCount: 1,
    totalWordCount: 100,
    includePreviousChaptersInPrompt: true,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
  };
}

function renderBrowser(opts: { embedded?: boolean; activeStoryId?: string | null } = {}): void {
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route
            path="/start"
            element={
              <>
                <StoryBrowser
                  open
                  onClose={() => undefined}
                  activeStoryId={opts.activeStoryId ?? null}
                  embedded={opts.embedded}
                />
                <LocationProbe />
              </>
            }
          />
          <Route path="/stories/:id" element={<LocationProbe />} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StoryBrowser', () => {
  let fetchMock: FetchMock;

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

  it('navigates to /stories/:id when a story row is selected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [makeStory('abc', 'Dune')] }));
    renderBrowser();

    await userEvent.setup().click(await screen.findByTestId('story-picker-row-abc'));
    await waitFor(() => {
      expect(probeLocation()).toBe('/stories/abc');
    });
  });

  it('opens the create StoryModal when New story is clicked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderBrowser();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByTestId('story-picker-new'));
    expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
  });

  it('navigates to the new story after a successful create', async () => {
    // Route by URL+method: useCreateStoryMutation.onSuccess invalidates the
    // stories query, and the picker is still mounted (modal open over it), so a
    // 3rd GET /stories fires after the POST. A positional mockResolvedValueOnce
    // chain would leave that refetch resolving undefined (schema.parse throws).
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/stories') && method === 'POST') {
        return jsonResponse(201, {
          story: {
            id: 'created-9',
            title: 'New Tale',
            genre: null,
            synopsis: null,
            worldNotes: null,
            targetWords: null,
            includePreviousChaptersInPrompt: true,
            createdAt: '2026-04-24T00:00:00.000Z',
            updatedAt: '2026-04-24T00:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/api/stories')) {
        return jsonResponse(200, { stories: [] });
      }
      return jsonResponse(200, {});
    });
    renderBrowser();

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('story-picker-new'));
    await user.type(screen.getByLabelText(/title/i), 'New Tale');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    await waitFor(() => {
      expect(probeLocation()).toBe('/stories/created-9');
    });
  });

  it('does not render an Import .docx button (no import handler wired)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderBrowser();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-picker-import')).toBeNull();
  });

  // [story-editor-0wz] The [story-editor-f1t] dead-end: deleting the story
  // the editor currently has open must exit to the library, not leave
  // EditorPage's storyQuery 404ing into "Could not load story".
  describe('deleting a story (story-editor-0wz)', () => {
    function mockFetchWithStories(stories: Record<string, unknown>[]): void {
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        if (/\/api\/stories\/[^/]+$/.test(url) && method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/api/stories')) {
          return jsonResponse(200, { stories });
        }
        return jsonResponse(404, { error: 'not_mocked' });
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('navigates to the library once the currently-open story is actually deleted', async () => {
      mockFetchWithStories([makeStory('abc', 'Dune')]);
      renderBrowser({ activeStoryId: 'abc' });
      const deleteIcon = await screen.findByRole('button', { name: 'Delete "Dune"' });

      // fireEvent-style .click() (not userEvent) once fake timers are live —
      // userEvent's internal delay pipeline fights fake timers.
      vi.useFakeTimers();
      await act(async () => {
        deleteIcon.click();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Delete' }).click();
      });
      // Still on the story route mid-window — undo would leave it unharmed.
      expect(probeLocation()).toBe('/start');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(probeLocation()).toBe('/');
    });

    it('does not navigate when the deleted story is not the currently-open one', async () => {
      mockFetchWithStories([makeStory('abc', 'Dune'), makeStory('xyz', 'Foundry')]);
      renderBrowser({ activeStoryId: 'abc' });
      const deleteIcon = await screen.findByRole('button', { name: 'Delete "Foundry"' });

      vi.useFakeTimers();
      await act(async () => {
        deleteIcon.click();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Delete' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(probeLocation()).toBe('/start');
    });
  });
});
