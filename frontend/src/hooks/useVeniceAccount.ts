/**
 * [X32] TanStack Query hook for the unified Venice account-info endpoint.
 *
 * Replaces the old `useBalanceQuery` (F17) AND the per-click verify mutation
 * in Settings. One query, one cache key, one refetch path. The Settings
 * "Verify" button invalidates this query rather than POSTing separately.
 *
 * Backend contract (X32): `GET /api/users/me/venice-account` returns
 * `{ verified, balanceUsd, diem, endpoint, lastSix }`. Either of `balanceUsd`
 * / `diem` may be null when Venice's account-info payload omits them.
 * 409 `venice_key_required` is raised when the user has no BYOK key stored.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface VeniceAccount {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
}

export const veniceAccountQueryKey = ['venice-account'] as const;

export function useVeniceAccountQuery(enabled = true): UseQueryResult<VeniceAccount, Error> {
  return useQuery<VeniceAccount, Error>({
    queryKey: veniceAccountQueryKey,
    queryFn: async (): Promise<VeniceAccount> => {
      return api<VeniceAccount>('/users/me/venice-account');
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
