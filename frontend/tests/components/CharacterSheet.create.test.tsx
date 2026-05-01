import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterSheet } from '@/components/CharacterSheet';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

const STORY_ID = 'story-create';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

function makeChar(
  overrides: Partial<CharacterFixture> & { id: string; name: string },
): CharacterFixture {
  return {
    storyId: STORY_ID,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 0,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSheet(props: { onClose?: (id: string | null) => void; client?: QueryClient }): {
  client: QueryClient;
  onClose: ReturnType<typeof vi.fn>;
} {
  const qc = props.client ?? createQueryClient();
  const onClose = (props.onClose ?? vi.fn()) as ReturnType<typeof vi.fn>;
  render(
    <QueryClientProvider client={qc}>
      <CharacterSheet storyId={STORY_ID} mode="create" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { client: qc, onClose };
}

describe('CharacterSheet — create mode', () => {
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

  it('renders with title "Create character"', () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('no fetch expected')));
    renderSheet({});
    expect(screen.getByRole('heading', { name: /create character/i })).toBeInTheDocument();
  });

  it('renders all fields empty and focuses the name input', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('no fetch expected')));
    renderSheet({});
    const name = screen.getByLabelText(/name/i) as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    expect(name.value).toBe('');
    expect((screen.getByLabelText(/role/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/age/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/appearance/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/voice/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/arc/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/personality/i) as HTMLTextAreaElement).value).toBe('');
  });

  it('disables Save when name is empty / whitespace; enables it when name has content', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('no fetch expected')));
    const user = userEvent.setup();
    renderSheet({});
    const save = screen.getByTestId('character-sheet-save') as HTMLButtonElement;
    const name = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(save.disabled).toBe(true);
    await user.type(name, '   ');
    expect(save.disabled).toBe(true);
    await user.clear(name);
    await user.type(name, 'Astra');
    expect(save.disabled).toBe(false);
  });

  it('does not render the Delete button', () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('no fetch expected')));
    renderSheet({});
    expect(screen.queryByTestId('character-sheet-delete')).toBeNull();
  });

  it('Cancel calls onClose(null) and never fires the create request', async () => {
    let createCalls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith(`/stories/${STORY_ID}/characters`) && init?.method === 'POST') {
        createCalls += 1;
        return Promise.resolve(jsonResponse(500, {}));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onClose });
    await user.click(screen.getByTestId('character-sheet-cancel'));
    expect(onClose).toHaveBeenCalledWith(null);
    expect(createCalls).toBe(0);
  });

  it('Save calls onClose with the created id on success', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/stories/${STORY_ID}/characters`) && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string };
        return jsonResponse(200, {
          character: makeChar({ id: 'new-id-1', name: body.name }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onClose });
    await user.type(screen.getByLabelText(/name/i), 'Astra');
    await user.click(screen.getByTestId('character-sheet-save'));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith('new-id-1');
    });
  });

  it('keeps the modal open and shows form error on create failure', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith(`/stories/${STORY_ID}/characters`) && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(400, { error: { message: 'Validation failed', code: 'invalid' } }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onClose });
    await user.type(screen.getByLabelText(/name/i), 'Astra');
    await user.click(screen.getByTestId('character-sheet-save'));
    await waitFor(() => {
      expect(screen.getByTestId('character-sheet-form-error')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
