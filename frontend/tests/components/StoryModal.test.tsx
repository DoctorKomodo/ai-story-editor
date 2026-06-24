import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { StoryModalInitial } from '@/components/StoryModal';
import { StoryModal } from '@/components/StoryModal';
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

function renderModal(ui: React.ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('StoryModal (F6)', () => {
  let fetchMock: FetchMock;
  let onClose: Mock<() => void>;

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
          includePreviousChaptersInPrompt: true,
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

    const call = fetchMock.mock.calls.find(
      (c): c is [string, RequestInit] => c[1] != null && c[0] === '/api/stories',
    );
    expect(call).toBeDefined();
    if (!call) return;
    const [, init] = call;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        title: 'Dune',
        genre: 'Sci-Fi',
        synopsis: null,
        worldNotes: null,
        includePreviousChaptersInPrompt: true,
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
          includePreviousChaptersInPrompt: true,
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

    const call = fetchMock.mock.calls.find(
      (c): c is [string, RequestInit] => c[1] != null && c[0] === '/api/stories/s1',
    );
    expect(call).toBeDefined();
    if (!call) return;
    const [, init] = call;
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
          includePreviousChaptersInPrompt: true,
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

  it('create: calls onClose then onCreated with the new story', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        story: {
          id: 'new-1',
          title: 'Dune',
          genre: null,
          synopsis: null,
          worldNotes: null,
          targetWords: null,
          includePreviousChaptersInPrompt: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderModal(<StoryModal mode="create" open onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText(/title/i), 'Dune');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-1' }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onCreated.mock.invocationCallOrder[0]);
  });

  it('does not render when open=false', () => {
    renderModal(<StoryModal mode="create" open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders with design-system primitives (Modal/Field/Button — no raw Tailwind colors)', () => {
    renderModal(<StoryModal mode="create" open onClose={onClose} />);

    const card = screen.getByTestId('story-modal');
    expect(card.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(card).toHaveClass('bg-bg-elevated');
    expect(card).toHaveClass('shadow-pop');

    const submit = screen.getByTestId('story-modal-submit');
    expect(submit.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(submit).toHaveClass('bg-ink');

    const cancel = screen.getByTestId('story-modal-cancel');
    expect(cancel.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
  });
});

// ---------------------------------------------------------------------------
// includePreviousChaptersInPrompt toggle — merged from colocated test file
// ---------------------------------------------------------------------------

const BASE_STORY: StoryModalInitial = {
  id: 's1',
  title: 'The Cartographer',
  genre: 'Literary fantasy',
  synopsis: 'A novel about borders.',
  worldNotes: null,
  includePreviousChaptersInPrompt: true,
};

function storyResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      story: {
        id: 's1',
        title: 'The Cartographer',
        genre: 'Literary fantasy',
        synopsis: 'A novel about borders.',
        worldNotes: null,
        targetWords: null,
        includePreviousChaptersInPrompt: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('StoryModal — includePreviousChaptersInPrompt toggle', () => {
  let fetchMock2: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock2 = vi.fn();
    vi.stubGlobal('fetch', fetchMock2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the toggle checked when story has the flag true', () => {
    renderModal(
      <StoryModal
        mode="edit"
        open={true}
        onClose={() => {}}
        initial={{ ...BASE_STORY, includePreviousChaptersInPrompt: true }}
      />,
    );
    const checkbox = screen.getByRole('checkbox', {
      name: /include previous-chapter summaries/i,
    });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it('shows the toggle unchecked when story has the flag false', () => {
    renderModal(
      <StoryModal
        mode="edit"
        open={true}
        onClose={() => {}}
        initial={{ ...BASE_STORY, includePreviousChaptersInPrompt: false }}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: /include previous-chapter summaries/i }),
    ).not.toBeChecked();
  });

  it('shows the toggle checked by default in create mode', () => {
    renderModal(<StoryModal mode="create" open={true} onClose={() => {}} />);
    expect(
      screen.getByRole('checkbox', { name: /include previous-chapter summaries/i }),
    ).toBeChecked();
  });

  it('PATCH includes includePreviousChaptersInPrompt when toggled', async () => {
    fetchMock2.mockResolvedValue(storyResponse({ includePreviousChaptersInPrompt: false }));

    renderModal(
      <StoryModal
        mode="edit"
        open={true}
        onClose={() => {}}
        initial={{ ...BASE_STORY, includePreviousChaptersInPrompt: true }}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /include previous-chapter summaries/i,
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByTestId('story-modal-submit'));

    await waitFor(() => {
      expect(fetchMock2).toHaveBeenCalled();
    });

    const [, init] = fetchMock2.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ includePreviousChaptersInPrompt: false });
  });
});
