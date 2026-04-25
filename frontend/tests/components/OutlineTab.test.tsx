import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutlineTab } from '@/components/OutlineTab';
import {
  arrayMove,
  computeReorderedOutline,
  type OutlineItem,
  outlineQueryKey,
  useReorderOutlineMutation,
  withSequentialOrder,
} from '@/hooks/useOutline';
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

function item(overrides: Partial<OutlineItem> & { id: string; order: number }): OutlineItem {
  return {
    storyId: 'story-1',
    title: `Item ${String(overrides.order + 1)}`,
    sub: null,
    status: 'queued',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab(
  props: { onAddItem?: () => void; onEditItem?: (id: string) => void } = {},
  client?: QueryClient,
): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <OutlineTab storyId="story-1" {...props} />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('arrayMove (outline)', () => {
  it('moves first to last', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op when from === to', () => {
    expect(arrayMove(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('returns a copy on out-of-range indices rather than mutating', () => {
    const input = ['a', 'b', 'c'];
    const result = arrayMove(input, -1, 0);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe('withSequentialOrder', () => {
  it('reassigns order to 0..N-1', () => {
    const list = [item({ id: 'a', order: 5 }), item({ id: 'b', order: 9 })];
    const out = withSequentialOrder(list);
    expect(out.map((i) => i.order)).toEqual([0, 1]);
  });

  it('preserves identity for items already at their final order', () => {
    const a = item({ id: 'a', order: 0 });
    const b = item({ id: 'b', order: 1 });
    const out = withSequentialOrder([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});

describe('computeReorderedOutline', () => {
  const list = [
    item({ id: 'a', order: 0 }),
    item({ id: 'b', order: 1 }),
    item({ id: 'c', order: 2 }),
  ];

  it('returns null when overId is null', () => {
    expect(computeReorderedOutline(list, 'a', null)).toBeNull();
  });

  it('returns null when activeId === overId', () => {
    expect(computeReorderedOutline(list, 'b', 'b')).toBeNull();
  });

  it('returns null when an id is unknown', () => {
    expect(computeReorderedOutline(list, 'zzz', 'b')).toBeNull();
  });

  it('moves the active item to the over position and resequences order', () => {
    const next = computeReorderedOutline(list, 'a', 'c');
    expect(next).not.toBeNull();
    expect(next?.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(next?.map((i) => i.order)).toEqual([0, 1, 2]);
  });
});

describe('OutlineTab (F29)', () => {
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

  it('shows the loading state', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) return pending;
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    const status = await screen.findByRole('status');
    expect(status.textContent ?? '').toMatch(/loading outline/i);

    resolveFetch?.(jsonResponse(200, { outline: [] }));
  });

  it('shows the error state', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(jsonResponse(500, { error: { message: 'boom', code: 'internal' } }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/failed to load outline/i);
  });

  it('shows an empty-state message when the outline is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(jsonResponse(200, { outline: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    expect(await screen.findByText(/no outline yet/i)).toBeInTheDocument();
  });

  it('renders all items in `order` ASC', async () => {
    // Fixtures intentionally returned out of order — the component sorts.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(
          jsonResponse(200, {
            outline: [
              item({ id: 'c', order: 2, title: 'Third' }),
              item({ id: 'a', order: 0, title: 'First' }),
              item({ id: 'b', order: 1, title: 'Second' }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    await screen.findByText('First');
    const items = Array.from(document.querySelectorAll('li.outline-item'));
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('First');
    expect(items[1]?.textContent).toContain('Second');
    expect(items[2]?.textContent).toContain('Third');
  });

  it('applies data-status reflecting status bucket', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(
          jsonResponse(200, {
            outline: [
              item({ id: 'a', order: 0, title: 'Done', status: 'done' }),
              item({ id: 'b', order: 1, title: 'Active', status: 'active' }),
              item({ id: 'c', order: 2, title: 'Queued', status: 'queued' }),
              item({ id: 'd', order: 3, title: 'Unknown', status: 'whatever' }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    await screen.findByText('Done');
    const items = Array.from(document.querySelectorAll('li.outline-item'));
    expect(items[0]?.getAttribute('data-status')).toBe('done');
    expect(items[1]?.getAttribute('data-status')).toBe('active');
    expect(items[2]?.getAttribute('data-status')).toBe('queued');
    // Unknown statuses fall back to 'queued' styling.
    expect(items[3]?.getAttribute('data-status')).toBe('queued');

    // Bullet element exists per row with the matching outline-bullet-* class.
    expect(items[0]?.querySelector('.outline-bullet-done')).not.toBeNull();
    expect(items[1]?.querySelector('.outline-bullet-active')).not.toBeNull();
    expect(items[2]?.querySelector('.outline-bullet-queued')).not.toBeNull();
  });

  it('renders the sub line when present and omits it when null/empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(
          jsonResponse(200, {
            outline: [
              item({ id: 'a', order: 0, title: 'With sub', sub: 'A subtitle' }),
              item({ id: 'b', order: 1, title: 'Without sub', sub: null }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderTab();

    expect(await screen.findByText('A subtitle')).toBeInTheDocument();
    const items = Array.from(document.querySelectorAll('li.outline-item'));
    expect(items[1]?.querySelector('.sub')).toBeNull();
  });

  it('clicking an item calls onEditItem with the item id', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(
          jsonResponse(200, {
            outline: [item({ id: 'a', order: 0, title: 'Open me' })],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onEdit = vi.fn();
    renderTab({ onEditItem: onEdit });

    const row = await screen.findByText('Open me');
    await userEvent.setup().click(row);
    expect(onEdit).toHaveBeenCalledWith('a');
  });

  it('Add button calls onAddItem', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/outline')) {
        return Promise.resolve(jsonResponse(200, { outline: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onAdd = vi.fn();
    renderTab({ onAddItem: onAdd });

    await screen.findByText(/no outline yet/i);
    const btn = screen.getByRole('button', { name: /add outline item/i });
    await userEvent.setup().click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('useReorderOutlineMutation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
    setAccessToken('test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    useSessionStore.getState().clearSession();
  });

  function wrapper(qc = createQueryClient()): {
    qc: ReturnType<typeof createQueryClient>;
    Wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  } {
    const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, Wrapper };
  }

  it('optimistically updates the cache before the PATCH resolves and sends the right body', async () => {
    const original = [
      item({ id: 'a', order: 0 }),
      item({ id: 'b', order: 1 }),
      item({ id: 'c', order: 2 }),
    ];
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(outlineQueryKey('story-1'), original);

    let resolvePatch!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { result } = renderHook(() => useReorderOutlineMutation('story-1'), {
      wrapper: Wrapper,
    });

    const reordered = computeReorderedOutline(original, 'a', 'c');
    expect(reordered).not.toBeNull();

    act(() => {
      result.current.mutate({
        items: reordered!.map((it) => ({ id: it.id, order: it.order })),
        previousItems: reordered!,
      });
    });

    await waitFor(() => {
      const cached = qc.getQueryData<OutlineItem[]>(outlineQueryKey('story-1'));
      expect(cached?.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/stories\/story-1\/outline\/reorder$/);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as {
      items: Array<{ id: string; order: number }>;
    };
    expect(body.items).toEqual([
      { id: 'b', order: 0 },
      { id: 'c', order: 1 },
      { id: 'a', order: 2 },
    ]);

    resolvePatch(new Response(null, { status: 204 }));
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('rolls back the cache when the PATCH returns 500', async () => {
    const original = [
      item({ id: 'a', order: 0 }),
      item({ id: 'b', order: 1 }),
      item({ id: 'c', order: 2 }),
    ];
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(outlineQueryKey('story-1'), original);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/reorder')) {
        return jsonResponse(500, { error: { message: 'boom', code: 'internal' } });
      }
      return jsonResponse(200, { outline: original });
    });

    const { result } = renderHook(() => useReorderOutlineMutation('story-1'), {
      wrapper: Wrapper,
    });

    const reordered = computeReorderedOutline(original, 'a', 'c')!;

    act(() => {
      result.current.mutate({
        items: reordered.map((it) => ({ id: it.id, order: it.order })),
        previousItems: reordered,
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const cached = qc.getQueryData<OutlineItem[]>(outlineQueryKey('story-1'));
    expect(cached?.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the new order in the cache when the PATCH succeeds', async () => {
    const original = [
      item({ id: 'a', order: 0 }),
      item({ id: 'b', order: 1 }),
      item({ id: 'c', order: 2 }),
    ];
    const reordered = computeReorderedOutline(original, 'a', 'c')!;
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(outlineQueryKey('story-1'), original);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/reorder')) {
        return new Response(null, { status: 204 });
      }
      // onSettled invalidates; the server responds with the new order.
      return jsonResponse(200, { outline: reordered });
    });

    const { result } = renderHook(() => useReorderOutlineMutation('story-1'), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate({
        items: reordered.map((it) => ({ id: it.id, order: it.order })),
        previousItems: reordered,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await waitFor(() => {
      const cached = qc.getQueryData<OutlineItem[]>(outlineQueryKey('story-1'));
      expect(cached?.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    });
  });
});
