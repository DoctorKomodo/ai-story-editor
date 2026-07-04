// [F30] Story Picker modal — covers visibility, dialog accessibility, list
// rendering from `useStoriesQuery`, the active-row pill, click → onSelectStory
// + onClose wiring, footer count, primary New story / Import .docx callbacks,
// and modal-close behaviour (X button, Escape, backdrop).
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { StoryPicker } from '@/components/StoryPicker';
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

function makeStory(id: string, overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    id,
    title: `Story ${id}`,
    genre: 'Fantasy',
    synopsis: null,
    worldNotes: null,
    targetWords: 80_000,
    chapterCount: 1,
    totalWordCount: 1234,
    includePreviousChaptersInPrompt: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPicker(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('StoryPicker (F30)', () => {
  let fetchMock: FetchMock;
  let onClose: Mock<() => void>;
  let onSelectStory: Mock<(id: string) => void>;
  let onCreateStory: Mock<() => void>;
  let onImportDocx: Mock<() => void>;

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
    onClose = vi.fn<() => void>();
    onSelectStory = vi.fn<(id: string) => void>();
    onCreateStory = vi.fn<() => void>();
    onImportDocx = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('does not render when open=false', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    renderPicker(
      <StoryPicker
        open={false}
        onClose={onClose}
        activeStoryId={null}
        onSelectStory={onSelectStory}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible dialog with the title when open', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );
    const dialog = await screen.findByRole('dialog', { name: /your stories/i });
    expect(dialog).toBeInTheDocument();
  });

  it('renders all stories returned by the query', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        stories: [
          makeStory('s1', { title: 'Dune' }),
          makeStory('s2', { title: 'Foundation' }),
          makeStory('s3', { title: 'Hyperion' }),
        ],
      }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId="s2" onSelectStory={onSelectStory} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-row-s1')).toBeInTheDocument();
      expect(screen.getByTestId('story-picker-row-s2')).toBeInTheDocument();
      expect(screen.getByTestId('story-picker-row-s3')).toBeInTheDocument();
    });

    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Foundation')).toBeInTheDocument();
    expect(screen.getByText('Hyperion')).toBeInTheDocument();
  });

  it('marks only the active row with the open pill and data-active=true', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        stories: [makeStory('s1'), makeStory('s2'), makeStory('s3')],
      }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId="s2" onSelectStory={onSelectStory} />,
    );

    const activeRow = await screen.findByTestId('story-picker-row-s2');
    expect(activeRow).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('story-picker-pill-s2')).toHaveTextContent(/open/i);

    expect(screen.getByTestId('story-picker-row-s1')).toHaveAttribute('data-active', 'false');
    expect(screen.queryByTestId('story-picker-pill-s1')).toBeNull();
    expect(screen.getByTestId('story-picker-row-s3')).toHaveAttribute('data-active', 'false');
    expect(screen.queryByTestId('story-picker-pill-s3')).toBeNull();
  });

  it('clicking a row calls onSelectStory(id) and onClose', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        stories: [makeStory('s1'), makeStory('s2')],
      }),
    );
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    const row = await screen.findByTestId('story-picker-row-s2');
    await user.click(row);

    expect(onSelectStory).toHaveBeenCalledWith('s2');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the active row still fires onSelectStory + onClose', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [makeStory('s1')] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId="s1" onSelectStory={onSelectStory} />,
    );

    const row = await screen.findByTestId('story-picker-row-s1');
    await user.click(row);
    expect(onSelectStory).toHaveBeenCalledWith('s1');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders an empty state when there are no stories', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    // [F64] Empty branch now renders <StoryPickerEmpty>.
    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /your stories live here/i })).toBeInTheDocument();
  });

  it('footer "N stories in vault" matches the story count', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        stories: [makeStory('s1'), makeStory('s2'), makeStory('s3')],
      }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-count')).toHaveTextContent('3 stories in vault');
    });
  });

  it('singularises the footer count when only one story exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [makeStory('s1')] }));
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-count')).toHaveTextContent('1 story in vault');
    });
  });

  it('clicking New story fires onCreateStory', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker
        open
        onClose={onClose}
        activeStoryId={null}
        onSelectStory={onSelectStory}
        onCreateStory={onCreateStory}
      />,
    );

    await user.click(screen.getByTestId('story-picker-new'));
    expect(onCreateStory).toHaveBeenCalled();
  });

  it('clicking Import .docx fires onImportDocx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker
        open
        onClose={onClose}
        activeStoryId={null}
        onSelectStory={onSelectStory}
        onImportDocx={onImportDocx}
      />,
    );

    await user.click(screen.getByTestId('story-picker-import'));
    expect(onImportDocx).toHaveBeenCalled();
  });

  it('hides the New story button when onCreateStory is not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('story-picker-count')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-picker-new')).toBeNull();
  });

  it('hides the Import .docx button when onImportDocx is not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('story-picker-count')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-picker-import')).toBeNull();
  });

  it('clicking the close X fires onClose', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(screen.getByTestId('story-picker-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the modal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop (outside the card) closes the modal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stories: [] }));
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    const backdrop = screen.getByTestId('story-picker-backdrop');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders metadata as `genre · wordCount / target`', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        stories: [
          makeStory('s1', {
            title: 'Dune',
            genre: 'Sci-Fi',
            totalWordCount: 12345,
            targetWords: 90000,
          }),
        ],
      }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText((content) => /Sci-Fi\s+·\s+12,345\s+\/\s+90,000/.test(content)),
      ).toBeInTheDocument();
    });
  });

  it('surfaces an error when the /stories response is malformed (schema drift)', async () => {
    // chapterCount as a string violates storyListItemSchema — the hook's
    // storiesResponseSchema.parse() throws a ZodError, so the query lands in
    // its error state and StoryPicker renders the role="alert" branch.
    fetchMock.mockResolvedValue(
      jsonResponse(200, { stories: [makeStory('s1', { chapterCount: 'not-a-number' })] }),
    );
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId('story-picker-row-s1')).toBeNull();
  });
});

// [story-editor-0wz] Per-row delete: confirm dialog + 5s soft-delete/undo.
describe('StoryPicker delete (story-editor-0wz)', () => {
  let fetchMock: FetchMock;
  let onClose: Mock<() => void>;
  let onSelectStory: Mock<(id: string) => void>;
  let onStoryDeleted: Mock<(id: string) => void>;

  function deleteCalls(): unknown[] {
    return fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
  }

  /** Serves GET /stories from `stories` and 204s any DELETE /stories/:id. */
  function mockFetchWithStories(stories: unknown[]): void {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (/\/api\/stories\/[^/]+$/.test(url) && method === 'DELETE') {
        // A 204 response must have a null body (jsonResponse's
        // JSON.stringify(null) would give a "null" string body, which throws).
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/api/stories')) {
        return jsonResponse(200, { stories });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    });
  }

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
    onClose = vi.fn<() => void>();
    onSelectStory = vi.fn<(id: string) => void>();
    onStoryDeleted = vi.fn<(id: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('the delete icon has the accessible name Delete "<title>"', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );
    expect(await screen.findByRole('button', { name: 'Delete "Dune"' })).toBeInTheDocument();
  });

  it('opens a confirm dialog naming the story and describing the cascade delete', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete "Dune"' }));

    const dialog = await screen.findByRole('alertdialog', { name: /delete "dune"/i });
    expect(dialog).toHaveTextContent(
      /permanently removes the story and all its chapters, characters, outline, and chats/i,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('Cancel closes the dialog and fires no delete', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete "Dune"' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('story-picker-row-s1')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('Escape cancels the confirm dialog (and leaves the picker itself open)', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete "Dune"' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('story-picker-row-s1')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('confirming hides the row immediately and shows the undo toast', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete "Dune"' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByTestId('story-picker-row-s1')).toBeNull();
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(/deleted/i);
    expect(toast).toHaveTextContent(/dune/i);
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('undo restores the row and no delete ever fires', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    const user = userEvent.setup();
    renderPicker(
      <StoryPicker open onClose={onClose} activeStoryId={null} onSelectStory={onSelectStory} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete "Dune"' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /undo/i }));

    expect(await screen.findByTestId('story-picker-row-s1')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    // The soft-delete timer was cancelled by undo(); nothing left to fire.
    expect(deleteCalls()).toHaveLength(0);
  });

  it('timer expiry fires the real DELETE exactly once and reports it via onStoryDeleted', async () => {
    mockFetchWithStories([makeStory('s1', { title: 'Dune' })]);
    renderPicker(
      <StoryPicker
        open
        onClose={onClose}
        activeStoryId="s1"
        onSelectStory={onSelectStory}
        onStoryDeleted={onStoryDeleted}
      />,
    );
    const deleteIcon = await screen.findByRole('button', { name: 'Delete "Dune"' });

    // fireEvent-style .click() (not userEvent) from here on — userEvent's
    // internal delay pipeline fights fake timers (see RecoveryCodeCard.test.tsx).
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

    expect(deleteCalls()).toHaveLength(1);
    expect(onStoryDeleted).toHaveBeenCalledTimes(1);
    expect(onStoryDeleted).toHaveBeenCalledWith('s1');
  });

  it('scheduling delete for a story other than activeStoryId still reports it via onStoryDeleted', async () => {
    // onStoryDeleted always fires on real-delete resolution for whichever id
    // was removed — it's the parent's job (StoryBrowser) to compare against
    // activeStoryId and decide whether to navigate.
    mockFetchWithStories([
      makeStory('s1', { title: 'Dune' }),
      makeStory('s2', { title: 'Foundry' }),
    ]);
    renderPicker(
      <StoryPicker
        open
        onClose={onClose}
        activeStoryId="s1"
        onSelectStory={onSelectStory}
        onStoryDeleted={onStoryDeleted}
      />,
    );
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

    expect(onStoryDeleted).toHaveBeenCalledWith('s2');
    // The still-open story's row is untouched.
    expect(screen.getByTestId('story-picker-row-s1')).toBeInTheDocument();
  });
});
