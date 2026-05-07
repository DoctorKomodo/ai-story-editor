import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVeniceAccountQuery, veniceAccountQueryKey } from '@/hooks/useVeniceAccount';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  function wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper, client };
}

describe('useVeniceAccountQuery [X32]', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('hits GET /api/users/me/venice-account', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        verified: true,
        balanceUsd: 1.23,
        diem: 4567,
        endpoint: 'https://api.venice.ai/api/v1',
        lastSix: 'ABCDEF',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVeniceAccountQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('/api/users/me/venice-account');
  });

  it('returns the VeniceAccount shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          verified: true,
          balanceUsd: 9.99,
          diem: 100,
          endpoint: null,
          lastSix: 'ZZZZZZ',
        }),
      ),
    );

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVeniceAccountQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      verified: true,
      balanceUsd: 9.99,
      diem: 100,
      endpoint: null,
      lastSix: 'ZZZZZZ',
    });
  });

  it('exposes veniceAccountQueryKey for invalidation', () => {
    expect(veniceAccountQueryKey).toEqual(['venice-account']);
  });

  it('respects the enabled flag', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchSpy);

    const { wrapper } = makeWrapper();
    renderHook(() => useVeniceAccountQuery(false), { wrapper });

    // Disabled query doesn't fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
