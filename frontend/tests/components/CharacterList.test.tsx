import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterList } from '@/components/CharacterList';
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
    name: 'Unnamed',
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderList(props: {
  onOpenCharacter?: (id: string) => void;
  onAddCharacter?: () => void;
  client?: QueryClient;
}): { client: QueryClient } {
  const qc = props.client ?? createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <CharacterList
        storyId="story-1"
        onOpenCharacter={props.onOpenCharacter ?? vi.fn()}
        onAddCharacter={props.onAddCharacter}
      />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('CharacterList (F18)', () => {
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

  it('renders character names and role+age secondary line after fetching', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(
          jsonResponse(200, {
            characters: [
              char({ id: 'c1', name: 'Ada', role: 'Protagonist', age: '28' }),
              char({ id: 'c2', name: 'Brin', role: 'Antagonist' }),
              char({ id: 'c3', name: 'Cal', age: '54' }),
              char({ id: 'c4', name: 'Dia' }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Brin')).toBeInTheDocument();
    expect(screen.getByText('Cal')).toBeInTheDocument();
    expect(screen.getByText('Dia')).toBeInTheDocument();
    // Ada: role + age, middle-dot separated
    expect(screen.getByText('Protagonist · Age 28')).toBeInTheDocument();
    // Brin: role only
    expect(screen.getByText('Antagonist')).toBeInTheDocument();
    // Cal: age only
    expect(screen.getByText('Age 54')).toBeInTheDocument();
  });

  it('renders "Untitled character" fallback when name is an empty string', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(
          jsonResponse(200, {
            characters: [char({ id: 'c1', name: '' })],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    expect(await screen.findByText('Untitled character')).toBeInTheDocument();
  });

  it('clicking a row fires onOpenCharacter with the character id', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(
          jsonResponse(200, {
            characters: [char({ id: 'c1', name: 'Ada' }), char({ id: 'c2', name: 'Brin' })],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onOpen = vi.fn();
    renderList({ onOpenCharacter: onOpen });

    const row = await screen.findByRole('button', { name: /Brin/ });
    await userEvent.setup().click(row);
    expect(onOpen).toHaveBeenCalledWith('c2');
  });

  it('"Add character" with no prop POSTs { name: "Untitled character" }, refetches, and fires onOpenCharacter with the new id', async () => {
    let listCalls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters')) {
        if (init && init.method === 'POST') {
          return Promise.resolve(
            jsonResponse(201, {
              character: char({ id: 'c-new', name: 'Untitled character' }),
            }),
          );
        }
        listCalls += 1;
        return Promise.resolve(jsonResponse(200, { characters: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onOpen = vi.fn();
    renderList({ onOpenCharacter: onOpen });

    await screen.findByText(/no characters yet/i);
    expect(listCalls).toBe(1);

    await userEvent.setup().click(screen.getByRole('button', { name: /add character/i }));

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith('c-new');
    });

    const postCall = fetchMock.mock.calls.find(
      ([, init]: [string, RequestInit | undefined]) => init && init.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const [, postInit] = postCall as [string, RequestInit];
    expect(postInit.body).toBe(JSON.stringify({ name: 'Untitled character' }));

    await waitFor(() => {
      expect(listCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it('"Add character" with onAddCharacter prop calls the prop and does NOT POST', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/stories/story-1/characters')) {
        if (init && init.method === 'POST') {
          throw new Error('Should not POST when onAddCharacter is provided');
        }
        return Promise.resolve(jsonResponse(200, { characters: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onAdd = vi.fn();
    renderList({ onAddCharacter: onAdd });

    await screen.findByText(/no characters yet/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /add character/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);

    const postCall = fetchMock.mock.calls.find(
      ([, init]: [string, RequestInit | undefined]) => init && init.method === 'POST',
    );
    expect(postCall).toBeUndefined();
  });

  it('renders empty state when the character list is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(jsonResponse(200, { characters: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    expect(await screen.findByText(/no characters yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add character/i })).toBeInTheDocument();
  });

  it('loading state has role="status"', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return pending;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    const status = await screen.findByRole('status');
    expect(status.textContent ?? '').toMatch(/loading characters/i);

    resolveFetch?.(jsonResponse(200, { characters: [] }));
  });

  it('error state shows role="alert"', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(
          jsonResponse(500, { error: { message: 'Server boom', code: 'internal' } }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/could not load characters/i);
  });

  it('renders with design-system token classes (no raw Tailwind colors)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/characters')) {
        return Promise.resolve(
          jsonResponse(200, { characters: [char({ id: 'c-1', name: 'Ana' })] }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList({});

    const list = await screen.findByTestId('character-list');
    expect(list.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);

    const addButton = screen.getByTestId('character-list-add');
    expect(addButton.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
  });
});
