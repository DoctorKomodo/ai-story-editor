import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * Factory for a fresh `QueryClient`. The app uses a single shared client
 * (see `App.tsx`); tests create a new one per render to avoid cross-test
 * cache bleed.
 *
 * Defaults:
 * - `staleTime: 30s` — stories / chapters don't churn in a single session,
 *   so a short freshness window avoids refetch storms on tab switches.
 * - `retry` — one retry, but never on 401 (the api client already did the
 *   refresh-and-retry dance; a further retry here just delays the redirect).
 * - `refetchOnWindowFocus: false` — opinionated; a personal writing tool
 *   doesn't need background refetch and it just flickers the UI.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (failureCount >= 1) return false;
          if (error instanceof ApiError && error.status === 401) return false;
          return true;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// App-wide singleton. Tests should not import this — they should build
// their own client via `createQueryClient()`.
export const queryClient = createQueryClient();
