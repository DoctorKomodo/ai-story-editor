// [F30] Story Picker modal — covers visibility, dialog accessibility, list
// rendering from `useStoriesQuery`, the active-row pill, click → onSelectStory
// + onClose wiring, footer count, primary New story / Import .docx callbacks,
// and modal-close behaviour (X button, Escape, backdrop).
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryPicker } from '@/components/StoryPicker';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
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
  let onClose: ReturnType<typeof vi.fn>;
  let onSelectStory: ReturnType<typeof vi.fn>;
  let onCreateStory: ReturnType<typeof vi.fn>;
  let onImportDocx: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onClose = vi.fn();
    onSelectStory = vi.fn();
    onCreateStory = vi.fn();
    onImportDocx = vi.fn();
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
});
