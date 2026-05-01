import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterSheet } from '@/components/CharacterSheet';
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

function noContent(): Response {
  return new Response(null, { status: 204 });
}

interface CharacterFixture {
  id: string;
  storyId: string;
  name: string;
  role: string | null;
  age: string | null;
  appearance: string | null;
  voice: string | null;
  arc: string | null;
  personality: string | null;
  createdAt: string;
  updatedAt: string;
}

function char(overrides: Partial<CharacterFixture> & { id: string }): CharacterFixture {
  return {
    storyId: 'story-1',
    name: 'Ada',
    role: 'Protagonist',
    age: '28',
    appearance: 'Tall',
    voice: 'Measured',
    arc: 'Redemption',
    personality: 'Curious',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSheet(props: {
  characterId: string | null;
  onClose?: () => void;
  client?: QueryClient;
}): { client: QueryClient; onClose: ReturnType<typeof vi.fn> } {
  const qc = props.client ?? createQueryClient();
  const onClose = (props.onClose ?? vi.fn()) as ReturnType<typeof vi.fn>;
  render(
    <QueryClientProvider client={qc}>
      {props.characterId !== null ? (
        <CharacterSheet
          storyId="story-1"
          mode="edit"
          characterId={props.characterId}
          onClose={onClose}
        />
      ) : null}
    </QueryClientProvider>,
  );
  return { client: qc, onClose };
}

describe('CharacterSheet (F19)', () => {
  let fetchMock: FetchMock;

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders nothing when characterId is null', () => {
    renderSheet({ characterId: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens, fetches the character, and populates the fields', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });
    expect(screen.getByLabelText(/role/i)).toHaveValue('Protagonist');
    expect(screen.getByLabelText(/age/i)).toHaveValue('28');
    expect(screen.getByLabelText(/appearance/i)).toHaveValue('Tall');
    expect(screen.getByLabelText(/voice/i)).toHaveValue('Measured');
    expect(screen.getByLabelText(/arc/i)).toHaveValue('Redemption');
    expect(screen.getByLabelText(/personality/i)).toHaveValue('Curious');
  });

  it('shows role="status" while GET is pending', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return pending;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderSheet({ characterId: 'c1' });

    const status = await screen.findByRole('status');
    expect(status.textContent ?? '').toMatch(/loading character/i);

    resolveFetch?.(jsonResponse(200, { character: char({ id: 'c1' }) }));
  });

  it('fetch error shows role="alert" with "Could not load character"', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(500, { error: { message: 'boom', code: 'internal' } }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderSheet({ characterId: 'c1' });

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/could not load character/i);
  });

  it('Save button disabled when name is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const user = userEvent.setup();
    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    const nameInput = screen.getByLabelText(/name/i);
    await user.clear(nameInput);

    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
  });

  it('Save sends PATCH with only changed fields', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        if (!init || init.method === undefined || init.method === 'GET') {
          return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
        }
        if (init.method === 'PATCH') {
          return Promise.resolve(
            jsonResponse(200, { character: char({ id: 'c1', name: 'AdaX' }) }),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const user = userEvent.setup();
    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    await user.type(screen.getByLabelText(/name/i), 'X');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, init]: [string, RequestInit | undefined]) => init && init.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]: [string, RequestInit | undefined]) => init && init.method === 'PATCH',
    ) as [string, RequestInit];
    expect(patchCall[1].body).toBe(JSON.stringify({ name: 'AdaX' }));
  });

  it('Save sends null for a cleared field', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        if (!init || init.method === undefined || init.method === 'GET') {
          return Promise.resolve(
            jsonResponse(200, { character: char({ id: 'c1', name: 'Ada', role: 'Protagonist' }) }),
          );
        }
        if (init.method === 'PATCH') {
          return Promise.resolve(
            jsonResponse(200, { character: char({ id: 'c1', name: 'Ada', role: null }) }),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const user = userEvent.setup();
    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/role/i)).toHaveValue('Protagonist');
    });

    await user.clear(screen.getByLabelText(/role/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, init]: [string, RequestInit | undefined]) => init && init.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]: [string, RequestInit | undefined]) => init && init.method === 'PATCH',
    ) as [string, RequestInit];
    const body = JSON.parse(String(patchCall[1].body)) as Record<string, unknown>;
    expect(body).toHaveProperty('role', null);
    expect(body).not.toHaveProperty('name');
  });

  it('successful Save closes the modal', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        if (!init || init.method === undefined || init.method === 'GET') {
          return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
        }
        if (init.method === 'PATCH') {
          return Promise.resolve(
            jsonResponse(200, { character: char({ id: 'c1', name: 'AdaX' }) }),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ characterId: 'c1', onClose });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    await user.type(screen.getByLabelText(/name/i), 'X');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('Delete button opens an in-modal confirm dialog (alertdialog)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const user = userEvent.setup();
    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('Confirm Delete fires DELETE and closes the modal on success', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        if (!init || init.method === undefined || init.method === 'GET') {
          return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
        }
        if (init.method === 'DELETE') {
          return Promise.resolve(noContent());
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ characterId: 'c1', onClose });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const confirmBtn = await screen.findByRole('button', { name: /^confirm$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]: [string, RequestInit | undefined]) => init && init.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('Cancel Delete dismisses the confirm dialog and keeps the main modal open', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ characterId: 'c1', onClose });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Cancel inside the confirm dialog — match the button scoped to alertdialog.
    const confirmDialog = screen.getByRole('alertdialog');
    const cancelBtn = Array.from(confirmDialog.querySelectorAll('button')).find((b) =>
      /cancel/i.test(b.textContent ?? ''),
    );
    expect(cancelBtn).toBeDefined();
    await user.click(cancelBtn as HTMLElement);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes main dialog when no confirm is open; with confirm open, closes only the confirm first', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ characterId: 'c1', onClose });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    // Open confirm, Escape should close only the confirm.
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Now Escape with no confirm open → closes main.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('click-outside the main dialog closes it', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ characterId: 'c1', onClose });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it('Name input is focused after open', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1', name: 'Ada' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderSheet({ characterId: 'c1' });

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Ada');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/name/i));
    });
  });

  it('renders with design-system primitives (Modal/Field/Button — no raw Tailwind colors)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters/c1')) {
        return Promise.resolve(jsonResponse(200, { character: char({ id: 'c1' }) }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderSheet({ characterId: 'c1' });

    const card = await screen.findByTestId('character-sheet');
    expect(card.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(card).toHaveClass('bg-bg-elevated');
    expect(card).toHaveClass('shadow-pop');

    const save = await screen.findByTestId('character-sheet-save');
    expect(save.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(save).toHaveClass('bg-ink');

    const del = screen.getByTestId('character-sheet-delete');
    expect(del.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
  });
});
