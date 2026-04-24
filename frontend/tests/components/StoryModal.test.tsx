import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryModal } from '@/components/StoryModal';
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

function renderModal(ui: React.ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('StoryModal (F6)', () => {
  let fetchMock: FetchMock;
  let onClose: ReturnType<typeof vi.fn>;

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders title, genre, synopsis, and world notes fields', () => {
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/genre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/synopsis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/world notes/i)).toBeInTheDocument();
  });

  it('submit disabled when title empty', () => {
    renderModal(<StoryModal mode="create" open onClose={onClose} />);
    const submit = screen.getByRole('button', { name: /create story/i });
    expect(submit).toBeDisabled();
  });

  it('create: submits POST /api/stories with trimmed payload and nullable fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        story: {
          id: 's1',
          title: 'Dune',
          genre: 'Sci-Fi',
          synopsis: null,
          worldNotes: null,
          targetWords: null,
          systemPrompt: null,
          chapterCount: 0,
          totalWordCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    await user.type(screen.getByLabelText(/title/i), '  Dune  ');
    await user.type(screen.getByLabelText(/genre/i), 'Sci-Fi');

    const submit = screen.getByRole('button', { name: /create story/i });
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const call = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/stories');
    expect(call).toBeDefined();
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        title: 'Dune',
        genre: 'Sci-Fi',
        synopsis: null,
        worldNotes: null,
      }),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('edit: seeds fields from initial and PATCHes only changed fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        story: {
          id: 's1',
          title: 'Dune (revised)',
          genre: 'Sci-Fi',
          synopsis: 'A boy on a desert planet.',
          worldNotes: null,
          targetWords: null,
          systemPrompt: null,
          chapterCount: 2,
          totalWordCount: 3000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    const user = userEvent.setup();
    renderModal(
      <StoryModal
        mode="edit"
        open
        onClose={onClose}
        initial={{
          id: 's1',
          title: 'Dune',
          genre: 'Sci-Fi',
          synopsis: 'A boy on a desert planet.',
          worldNotes: null,
        }}
      />,
    );

    // Fields seeded.
    expect(screen.getByLabelText(/title/i)).toHaveValue('Dune');
    expect(screen.getByLabelText(/genre/i)).toHaveValue('Sci-Fi');
    expect(screen.getByLabelText(/synopsis/i)).toHaveValue('A boy on a desert planet.');

    // Change only title.
    const titleInput = screen.getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Dune (revised)');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const call = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/stories/s1');
    expect(call).toBeDefined();
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    // Only `title` should be in the body — genre/synopsis/worldNotes unchanged.
    expect(init.body).toBe(JSON.stringify({ title: 'Dune (revised)' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('surfaces API error in the form-level alert', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: { message: 'Title too long', code: 'BAD_INPUT' } }),
    );
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/title too long/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes the modal', async () => {
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click closes the modal', async () => {
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    // The outer div (role="presentation") is the backdrop.
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it('cancel button closes without saving', async () => {
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('successful submit closes the modal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        story: {
          id: 's1',
          title: 'Dune',
          genre: null,
          synopsis: null,
          worldNotes: null,
          targetWords: null,
          systemPrompt: null,
          chapterCount: 0,
          totalWordCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} />);
    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('does not render when open=false', () => {
    renderModal(<StoryModal mode="create" open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
